import type { TitleSummary } from "../brief.js";
import type { Campaign } from "../../../../shared/types/pulse.js";
import { draftWithoutQloo, isFallback } from "../campaign.js";
import { createTtlCache, type TtlCache } from "../campaignCache.js";
import { clientAddress, type RateLimiter } from "../http/rateLimit.js";
import type { Handler } from "../http/router.js";
import { LlmError, type LlmClient } from "../llm/client.js";
import type { TitleKey } from "../resolve.js";
import { sessionKey, type CapDecision } from "../usage.js";
import { json, parseTitleParams } from "./params.js";

export interface GuessRouteDeps {
  /** Its own, stricter instance: a guess is an LLM call, so it must not share
   *  a budget with the cheap read endpoints. */
  rateLimiter: RateLimiter;
  /** True when Spotlight already knows the title (release data, or resolved before). */
  isKnown: (key: TitleKey) => Promise<boolean>;
  /** Title and release date for the prompt; null when no source knows the title. */
  header: (key: TitleKey) => Promise<TitleSummary | null>;
  /** Null when there is no GROQ_API_KEY. */
  llm: LlmClient | null;
  /** Takes one slot of the session's and the day's budget. */
  takeUsage: (session: string) => Promise<CapDecision>;
  /** Successful guesses by title, city and business type; one is made if not given. */
  cache?: TtlCache<Campaign>;
  now?: () => Date;
}

/** GET /guess?city=&type=&mediaType=&tmdbId=: the "What an LLM guesses with no
 *  taste data" campaign, a Campaign with groundedBy "none". Cheapest check
 *  first, and nothing is spent until the last: validation, the per-client rate
 *  limit, the known-title gate (so a made-up id costs no model call), whether
 *  a model is configured at all, the daily cap, and only then the draft. */
export function guessHandler(deps: GuessRouteDeps): Handler {
  // The same hour and size as the brief's campaign cache: toggling the
  // "without Qloo" view back and forth should not spend the daily budget.
  const cache = deps.cache ?? createTtlCache<Campaign>({ ttlMs: 60 * 60 * 1000, max: 50 });
  const fail = (res: Parameters<Handler>[1], what: string, err: unknown) => {
    console.error(`guess ${what} failed:`, err instanceof Error ? err.message : String(err));
    json(res, 503, { error: err instanceof LlmError ? "llm_unavailable" : "unavailable" });
  };

  return async (req, res, url) => {
    const params = parseTitleParams(url);
    if (!params.ok) return json(res, 400, { error: params.error });
    const { city, businessType, key } = params;

    const decision = deps.rateLimiter.check(clientAddress(req));
    if (!decision.allowed) return json(res, 429, { error: "rate_limited" }, { "Retry-After": String(decision.retryAfterSec) });

    let known: boolean;
    try { known = await deps.isKnown(key); } catch (err) { return fail(res, "known-title check", err); }
    if (!known) return json(res, 404, { error: "unknown_title" });

    if (!deps.llm) return json(res, 503, { error: "llm_unavailable" });

    // After the known-title gate, before anything is spent.
    const cacheKey = `guess|${key.tmdbId}|${key.mediaType}|${city.slug}|${businessType}`;
    const cached = cache.get(cacheKey);
    if (cached) return json(res, 200, cached);

    // Before the cap, so a failed lookup does not spend a slot.
    let summary: TitleSummary | null;
    try { summary = await deps.header(key); } catch (err) { return fail(res, "title lookup", err); }
    if (!summary) return json(res, 404, { error: "unknown_title" });

    try {
      const usage = await deps.takeUsage(sessionKey(req, deps.now?.() ?? new Date()));
      if (!usage.allowed) return json(res, 429, { error: "daily_limit" });
      const campaign = await draftWithoutQloo(deps.llm, { title: summary.title, cityName: city.name, businessType, releaseDate: summary.releaseDate });
      // The placeholder idea is not a result worth keeping for an hour.
      if (!isFallback(campaign)) cache.set(cacheKey, campaign);
      json(res, 200, campaign);
    } catch (err) {
      fail(res, "draft", err);
    }
  };
}

import type { TitleSummary } from "../brief.js";
import type { BusinessType, Campaign } from "../../../../shared/types/pulse.js";
import { DRAFT_DEADLINE_MS, draftWithoutQloo, isFallback } from "../campaign.js";
import { createTtlCache, type TtlCache } from "../campaignCache.js";
import { clientAddress, type RateLimiter } from "../http/rateLimit.js";
import type { Handler } from "../http/router.js";
import { LlmError, type LlmClient } from "../llm/client.js";
import type { TitleKey } from "../resolve.js";
import { sessionKey, type CapDecision } from "../usage.js";
import { json, parseTitleParams } from "./params.js";

/** What one shared draft came to: a campaign, or a refusal by the usage cap. */
type Drafted = { campaign: Campaign } | { capped: true } | { busy: true };

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
  /** Drafts in progress by the cache key; one is made if not given. */
  inflight?: Map<string, Promise<Drafted>>;
  /** Told why a draft was unusable (a provider failure); never the key or the prompt. */
  onError?: (context: string, err: unknown) => void;
  /** One draft's whole budget, queue wait included; DRAFT_DEADLINE_MS unless a test says otherwise. */
  draftDeadlineMs?: number;
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
  const inflight = deps.inflight ?? new Map<string, Promise<Drafted>>();
  const report = (context: string, err: unknown) => {
    try {
      if (deps.onError) deps.onError(context, err);
      else console.error(`guess ${context} failed:`, err instanceof Error ? err.message : String(err));
    } catch { /* a broken logger must not break the guess */ }
  };
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

    // The cache may have been filled while the header was awaited.
    const filled = cache.get(cacheKey);
    if (filled) return json(res, 200, filled);

    try {
      // Two simultaneous identical guesses share one draft, and so one usage
      // slot. Nothing awaits between the cache read above, this read and the
      // set below, so the second caller always finds the first one's promise.
      let work = inflight.get(cacheKey);
      if (!work) {
        const mine: Promise<Drafted> = draft(req, summary, city.name, businessType, cacheKey);
        work = mine;
        inflight.set(cacheKey, mine);
        void mine.then(() => undefined, () => undefined).finally(() => { if (inflight.get(cacheKey) === mine) inflight.delete(cacheKey); });
      }
      const result = await work;
      if ("capped" in result) return json(res, 429, { error: "daily_limit" });
      if ("busy" in result) return json(res, 429, { error: "rate_limited" }, { "Retry-After": "10" });
      json(res, 200, result.campaign);
    } catch (err) {
      fail(res, "draft", err);
    }
  };

  async function draft(req: Parameters<Handler>[0], summary: TitleSummary, cityName: string, businessType: BusinessType, cacheKey: string): Promise<Drafted> {
    const usage = await deps.takeUsage(sessionKey(req, deps.now?.() ?? new Date()));
    if (!usage.allowed) return { capped: true };
    // Its own deadline (the draft may be queued behind other model calls), not
    // tied to this connection: overlapping identical guesses share the draft.
    // A cut draft is not cached and the usage slot taken above stays taken.
    const deadline = AbortSignal.timeout(deps.draftDeadlineMs ?? DRAFT_DEADLINE_MS);
    let campaign: Campaign;
    try {
      campaign = await draftWithoutQloo(deps.llm!, { title: summary.title, cityName, businessType, releaseDate: summary.releaseDate }, report, deadline);
    } catch (err) {
      if (err instanceof LlmError && deadline.aborted) { report("campaign writer", err); return { busy: true }; }
      throw err;
    }
    // The placeholder idea is not a result worth keeping for an hour.
    if (!isFallback(campaign)) cache.set(cacheKey, campaign);
    return { campaign };
  }
}

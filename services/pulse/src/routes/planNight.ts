import { buildPlanNight, type PlanNightDeps } from "../planNight.js";
import { clientAddress, type RateLimiter } from "../http/rateLimit.js";
import type { Handler } from "../http/router.js";
import type { TitleKey } from "../resolve.js";
import { json, parsePlanNightParams } from "./params.js";

export interface PlanNightRouteDeps extends PlanNightDeps {
  /** True when Spotlight already knows the title (release data, or resolved before). */
  isKnown: (key: TitleKey) => Promise<boolean>;
  /** Its own instance: /plan-night spends Qloo calls, and must not share a
   *  budget with /brief, /board, /guess or /chat. */
  rateLimiter: RateLimiter;
}

/** GET /plan-night?city=&mediaType=&tmdbId=. Cheapest check first, and nothing
 *  external is touched until the last: validation (a malformed request costs
 *  nothing and spends no rate budget), the per-client rate limit, the
 *  known-title gate (so a made-up id costs no resolve, Qloo or TMDB call), and
 *  only then the work. */
export function planNightHandler(deps: PlanNightRouteDeps): Handler {
  return async (req, res, url) => {
    const params = parsePlanNightParams(url);
    if (!params.ok) return json(res, 400, { error: params.error });
    const { city, key } = params;

    const decision = deps.rateLimiter.check(clientAddress(req));
    if (!decision.allowed) return json(res, 429, { error: "rate_limited" }, { "Retry-After": String(decision.retryAfterSec) });

    let known: boolean;
    try {
      known = await deps.isKnown(key);
    } catch (err) {
      console.error("plan-night known-title check failed:", err instanceof Error ? err.message : String(err));
      return json(res, 503, { error: "unavailable" });
    }
    if (!known) return json(res, 404, { error: "unknown_title" });

    try {
      json(res, 200, await buildPlanNight(deps, { city, key }));
    } catch (err) {
      // buildPlanNight reports failures as sections, so reaching here is a bug.
      console.error("plan-night failed:", err instanceof Error ? err.message : String(err));
      json(res, 503, { error: "unavailable" });
    }
  };
}

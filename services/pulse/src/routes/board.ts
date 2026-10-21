import { buildBoard, type BoardDeps } from "../board.js";
import { isBusinessType } from "../businessTypes.js";
import { getCity } from "../cities.js";
import { clientAddress, type RateLimiter } from "../http/rateLimit.js";
import type { Handler } from "../http/router.js";

export interface BoardRouteDeps extends BoardDeps {
  /** Its own instance, so board polling does not spend a client's brief budget. */
  rateLimiter: RateLimiter;
  now?: () => Date;
}

function json(res: Parameters<Handler>[1], status: number, body: object, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/** GET /board?city=&type=. Cheapest check first: validation (a malformed
 *  request costs nothing and spends no rate budget), then the per-client
 *  limit, then the board itself, which only reads the cache. */
export function boardHandler(deps: BoardRouteDeps): Handler {
  return async (req, res, url) => {
    const city = getCity(url.searchParams.get("city") ?? "");
    if (!city) return json(res, 400, { error: "unknown_city" });
    const type = url.searchParams.get("type") ?? "";
    if (!isBusinessType(type)) return json(res, 400, { error: "unknown_business_type" });

    const decision = deps.rateLimiter.check(clientAddress(req));
    if (!decision.allowed) return json(res, 429, { error: "rate_limited" }, { "Retry-After": String(decision.retryAfterSec) });

    try {
      json(res, 200, await buildBoard(deps, city, type, deps.now?.()));
    } catch (err) {
      console.error("board failed:", err instanceof Error ? err.message : String(err));
      json(res, 503, { error: "unavailable" });
    }
  };
}

import { streamBrief, type BriefDeps } from "../brief.js";
import { isBusinessType } from "../businessTypes.js";
import { getCity } from "../cities.js";
import { startNdjson } from "../http/ndjson.js";
import { clientAddress, type RateLimiter } from "../http/rateLimit.js";
import type { Handler } from "../http/router.js";
import type { TitleKey } from "../resolve.js";

export interface BriefRouteDeps extends BriefDeps {
  /** True when Spotlight already knows the title (release data, or resolved before). */
  isKnown: (key: TitleKey) => Promise<boolean>;
  rateLimiter: RateLimiter;
}

function json(res: Parameters<Handler>[1], status: number, body: object, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/** GET /brief?city=&type=&mediaType=&tmdbId=. Everything is decided before
 *  the first byte of the stream, because after that the status is already 200
 *  and the only way to report a problem is inside the stream. The order is
 *  cheapest first: validation, then the per-client rate limit (so a flood is
 *  refused before any database work), then the known-title gate (so a made-up
 *  id costs no Qloo or TMDB call), then the stream. */
export function briefHandler(deps: BriefRouteDeps): Handler {
  return async (req, res, url) => {
    const city = getCity(url.searchParams.get("city") ?? "");
    if (!city) return json(res, 400, { error: "unknown_city" });
    const type = url.searchParams.get("type") ?? "";
    if (!isBusinessType(type)) return json(res, 400, { error: "unknown_business_type" });
    const mediaType = url.searchParams.get("mediaType");
    const rawId = url.searchParams.get("tmdbId") ?? "";
    const tmdbId = /^\d{1,15}$/.test(rawId) ? Number(rawId) : 0;
    if ((mediaType !== "movie" && mediaType !== "tv") || tmdbId < 1) return json(res, 400, { error: "bad_request" });

    const decision = deps.rateLimiter.check(clientAddress(req));
    if (!decision.allowed) return json(res, 429, { error: "rate_limited" }, { "Retry-After": String(decision.retryAfterSec) });

    const key: TitleKey = { tmdbId, mediaType };
    let known: boolean;
    try {
      known = await deps.isKnown(key);
    } catch (err) {
      console.error("brief known-title check failed:", err instanceof Error ? err.message : String(err));
      return json(res, 503, { error: "unavailable" });
    }
    if (!known) return json(res, 404, { error: "unknown_title" });

    const stream = startNdjson(res);
    try {
      for await (const event of streamBrief(deps, { city, businessType: type, key, signal: stream.signal })) {
        if (!stream.write(event)) break; // the client is gone; leaving the loop also stops the generator
      }
    } catch (err) {
      // streamBrief reports failures as sections, so reaching here is a bug.
      // The stream is already open, so end it (without `done`, which tells the
      // client it is incomplete) rather than send a second, broken response.
      console.error("brief stream failed:", err instanceof Error ? err.message : String(err));
    } finally {
      stream.end();
    }
  };
}

import { streamBrief, type BriefDeps } from "../brief.js";
import { isBusinessType } from "../businessTypes.js";
import { getCity } from "../cities.js";
import type { Handler } from "../http/router.js";
import { startNdjson } from "../http/ndjson.js";

function badRequest(res: Parameters<Handler>[1], error: string): void {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error }));
}

/** GET /brief?city=&type=&mediaType=&tmdbId=. Everything is validated before
 *  the first byte of the stream, because after that the status is already 200
 *  and the only way to report a problem is inside the stream. */
export function briefHandler(deps: BriefDeps): Handler {
  return async (_req, res, url) => {
    const city = getCity(url.searchParams.get("city") ?? "");
    if (!city) return badRequest(res, "unknown_city");
    const type = url.searchParams.get("type") ?? "";
    if (!isBusinessType(type)) return badRequest(res, "unknown_business_type");
    const mediaType = url.searchParams.get("mediaType");
    const rawId = url.searchParams.get("tmdbId") ?? "";
    const tmdbId = /^\d{1,15}$/.test(rawId) ? Number(rawId) : 0;
    if ((mediaType !== "movie" && mediaType !== "tv") || tmdbId < 1) return badRequest(res, "bad_request");

    const stream = startNdjson(res);
    try {
      for await (const event of streamBrief(deps, { city, businessType: type, key: { tmdbId, mediaType }, signal: stream.signal })) {
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

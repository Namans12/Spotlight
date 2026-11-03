import type { TitleLocationEntry } from "../../../../shared/types/pulse.js";
import { getCity } from "../cities.js";
import { getLocationsForTitle, type LocationsSql, type TitleCityLocation } from "../db/locations.js";
import { clientAddress, type RateLimiter } from "../http/rateLimit.js";
import type { Handler } from "../http/router.js";
import { json, parseTitleKey } from "./params.js";

export interface TitleLocationsRouteDeps {
  sql: LocationsSql;
  /** Its own instance, so this panel's read does not spend any other endpoint's budget. */
  rateLimiter: RateLimiter;
  onError?: (context: string, err: unknown) => void;
}

/** The most rows one title can return; the launch list is shorter than this. */
const MAX_ROWS = 20;

/** Rows to the response shape: launch cities only, filmed before set, then by
 *  city name (then slug, then the order the database gave), capped at `limit`. */
export function shapeTitleLocations(rows: TitleCityLocation[], limit = MAX_ROWS): TitleLocationEntry[] {
  const out: TitleLocationEntry[] = [];
  for (const r of rows) {
    const city = getCity(r.citySlug);
    if (city) out.push({ city_slug: city.slug, cityName: city.name, kind: r.kind, landmark_label: r.landmark, source: r.source });
  }
  const rank = (k: string) => (k === "filmed" ? 0 : 1);
  out.sort((a, b) => rank(a.kind) - rank(b.kind) || a.cityName.localeCompare(b.cityName) || a.city_slug.localeCompare(b.city_slug));
  return out.slice(0, limit);
}

/** GET /title-locations?mediaType=&tmdbId=. A database-only read: no Qloo, no
 *  TMDB, so there is no known-title gate and an unknown title is simply `[]`.
 *  Validation, then the per-client limit, then the read. Filmed comes before
 *  set, then by city name; a row for a city that is not a launch city is
 *  dropped, since there is no page to link it to. */
export function titleLocationsHandler(deps: TitleLocationsRouteDeps): Handler {
  return async (req, res, url) => {
    const params = parseTitleKey(url);
    if (!params.ok) return json(res, 400, { error: params.error });

    const decision = deps.rateLimiter.check(clientAddress(req));
    if (!decision.allowed) return json(res, 429, { error: "rate_limited" }, { "Retry-After": String(decision.retryAfterSec) });

    try {
      const rows = await getLocationsForTitle(deps.sql, params.key);
      json(res, 200, shapeTitleLocations(rows));
    } catch (err) {
      try { deps.onError?.("title-locations", err); } catch { /* a broken logger must not break the response */ }
      json(res, 503, { error: "unavailable" });
    }
  };
}

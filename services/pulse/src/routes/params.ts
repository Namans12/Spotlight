import type { ServerResponse } from "node:http";
import type { BusinessType } from "../../../../shared/types/pulse.js";
import { isBusinessType } from "../businessTypes.js";
import { getCity, type City } from "../cities.js";
import type { TitleKey } from "../resolve.js";

export function json(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

export type TitleKeyParams = { ok: true; key: TitleKey } | { ok: false; error: "bad_request" };

/** The `mediaType` and `tmdbId` query parameters on their own, for routes that
 *  take a title but no city or business type. */
export function parseTitleKey(url: URL): TitleKeyParams {
  const mediaType = url.searchParams.get("mediaType");
  const rawId = url.searchParams.get("tmdbId") ?? "";
  const tmdbId = /^\d{1,15}$/.test(rawId) ? Number(rawId) : 0;
  if ((mediaType !== "movie" && mediaType !== "tv") || tmdbId < 1) return { ok: false, error: "bad_request" };
  return { ok: true, key: { tmdbId, mediaType } };
}

export type PlanNightParams = { ok: true; city: City; key: TitleKey } | { ok: false; error: "unknown_city" | "bad_request" };

/** `city`, `mediaType` and `tmdbId` for /plan-night (no business type). The
 *  city is checked first, as in parseTitleParams. */
export function parsePlanNightParams(url: URL): PlanNightParams {
  const city = getCity(url.searchParams.get("city") ?? "");
  if (!city) return { ok: false, error: "unknown_city" };
  const title = parseTitleKey(url);
  return title.ok ? { ok: true, city, key: title.key } : title;
}

export type TitleParams = { ok: true; city: City; businessType: BusinessType; key: TitleKey } | { ok: false; error: "unknown_city" | "unknown_business_type" | "bad_request" };

/** The `city`, `type`, `mediaType` and `tmdbId` query parameters shared by
 *  /brief and /guess. A failure names which one, and is always a 400. */
export function parseTitleParams(url: URL): TitleParams {
  const city = getCity(url.searchParams.get("city") ?? "");
  if (!city) return { ok: false, error: "unknown_city" };
  const type = url.searchParams.get("type") ?? "";
  if (!isBusinessType(type)) return { ok: false, error: "unknown_business_type" };
  const title = parseTitleKey(url);
  return title.ok ? { ok: true, city, businessType: type, key: title.key } : title;
}

// Reads of title_locations and neighbourhoods, both filled by the data build
// (scripts under pipeline); the service never writes them.

import type { EntityKey } from "./entities.js";

export type LocationsSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<Record<string, unknown>[]>;

export interface TitleLocation {
  kind: "filmed" | "set";
  source: "wikidata" | "wikipedia" | "both";
  landmark: string | null;
}

/** What the build recorded for one title in one city. tmdb_id is BIGINT, but
 *  it is only ever a query parameter here, never read back, so the driver's
 *  string-for-BIGINT behaviour cannot reach a comparison. Rows with no source
 *  are skipped: a claim with no attribution cannot be shown with provenance. */
export async function getTitleLocations(sql: LocationsSql, key: EntityKey, citySlug: string): Promise<TitleLocation[]> {
  const rows = await sql`
    SELECT kind, source, landmark_label
    FROM title_locations
    WHERE tmdb_id = ${key.tmdbId} AND media_type = ${key.mediaType} AND city_slug = ${citySlug}
      AND source IS NOT NULL
    ORDER BY kind`;
  return rows.map((r) => ({
    kind: r.kind as TitleLocation["kind"],
    source: r.source as TitleLocation["source"],
    landmark: (r.landmark_label as string | null) ?? null,
  }));
}

export interface TitleLocationRow extends TitleLocation { tmdbId: number; mediaType: "movie" | "tv" }

/** The same read for many titles in one statement, for the board: twenty
 *  candidates must not cost twenty queries on every poll. Keyed by
 *  `<mediaType>:<tmdbId>`, in the same kind order as getTitleLocations.
 *  tmdb_id is BIGINT, which the driver may return as a string, so it is
 *  coerced here because this one is compared. */
export async function getTitleLocationsBatch(sql: LocationsSql, keys: EntityKey[], citySlug: string): Promise<Map<string, TitleLocation[]>> {
  const out = new Map<string, TitleLocation[]>();
  if (keys.length === 0) return out;
  const ids = [...new Set(keys.map((k) => k.tmdbId))];
  const wanted = new Set(keys.map((k) => `${k.mediaType}:${k.tmdbId}`));
  const rows = await sql`
    SELECT tmdb_id, media_type, kind, source, landmark_label
    FROM title_locations
    WHERE city_slug = ${citySlug} AND tmdb_id = ANY(${ids})
      AND source IS NOT NULL
    ORDER BY kind`;
  for (const r of rows) {
    const key = `${String(r.media_type)}:${Number(r.tmdb_id)}`;
    if (!wanted.has(key)) continue; // same id, other media type
    const list = out.get(key) ?? [];
    list.push({ kind: r.kind as TitleLocation["kind"], source: r.source as TitleLocation["source"], landmark: (r.landmark_label as string | null) ?? null });
    out.set(key, list);
  }
  return out;
}

export interface Neighbourhood { name: string; lat: number; lon: number }

/** Centroids for one city. DOUBLE PRECISION arrives as a number, but a
 *  numeric-typed column would arrive as a string, so coordinates are coerced
 *  and rows without usable ones are dropped. */
export async function getNeighbourhoods(sql: LocationsSql, citySlug: string): Promise<Neighbourhood[]> {
  const rows = await sql`SELECT name, lat, lon FROM neighbourhoods WHERE city_slug = ${citySlug}`;
  const out: Neighbourhood[] = [];
  for (const r of rows) {
    if (r.lat === null || r.lon === null || r.lat === undefined || r.lon === undefined) continue;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ name: String(r.name), lat, lon });
  }
  return out;
}

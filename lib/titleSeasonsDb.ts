import type postgres from "postgres";

// Read/write layer for the title_seasons cache (migrations/0011_title_seasons.sql).
//
// Same shape as lib/ratingsDb.ts by design: every grid render is a batch read
// here and nothing else. Refreshing stale rows is the backfill cron's job
// (scripts/backfill_seasons.py) — a stale row is served as-is rather than
// blocking a request on a live TMDB call.

/** A cached row older than this is due for a refresh by the backfill. Requests
 *  still serve it in the meantime. Long TTL: a season count changes far less
 *  often than a rating does. */
export const SEASONS_TTL_DAYS = 30;
const TTL_MS = SEASONS_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface SeasonKey {
  tmdbId: number;
  mediaType: "tv";
}

/** A row exactly as stored, including the `notFound` tombstone. */
export interface CachedSeasons extends SeasonKey {
  numberOfSeasons: number | null;
  notFound: boolean;
  fetchedAt: string;
}

/** What the API hands the frontend. Only ever produced for shows that
 *  actually have a known season count. */
export interface TitleSeasonsDTO {
  tmdbId: number;
  mediaType: "tv";
  numberOfSeasons: number;
  fetchedAt: string;
  stale: boolean;
}

export function seasonsCacheKey(key: SeasonKey): string {
  return `${key.mediaType}:${key.tmdbId}`;
}

export function isStale(fetchedAt: string): boolean {
  const at = Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return true;
  return Date.now() - at > TTL_MS;
}

function toCached(row: postgres.Row): CachedSeasons {
  return {
    tmdbId: Number(row.tmdb_id),
    mediaType: row.media_type,
    numberOfSeasons:
      row.number_of_seasons !== null && row.number_of_seasons !== undefined ? Number(row.number_of_seasons) : null,
    notFound: Boolean(row.not_found),
    fetchedAt: new Date(row.fetched_at).toISOString(),
  };
}

/** Cached row -> wire shape, or null when there is nothing worth rendering.
 *  "We looked and found nothing" and "we have never looked" deliberately
 *  collapse to the same answer for the client. */
export function toSeasonsDTO(row: CachedSeasons): TitleSeasonsDTO | null {
  if (row.notFound) return null;
  if (row.numberOfSeasons === null || row.numberOfSeasons <= 0) return null;
  return {
    tmdbId: row.tmdbId,
    mediaType: row.mediaType,
    numberOfSeasons: row.numberOfSeasons,
    fetchedAt: row.fetchedAt,
    stale: isStale(row.fetchedAt),
  };
}

/** Batch cache read, keyed by `${mediaType}:${tmdbId}`. Missing keys are simply
 *  absent from the map. Never touches TMDB — this is the call a poster grid
 *  makes, and it must stay free. */
export async function getCachedSeasons(
  sql: postgres.Sql,
  keys: SeasonKey[],
): Promise<Map<string, CachedSeasons>> {
  const found = new Map<string, CachedSeasons>();
  if (keys.length === 0) return found;

  const ids = keys.map((key) => key.tmdbId);
  const mediaTypes = keys.map((key) => key.mediaType);

  const rows = await sql`
    SELECT tmdb_id, media_type, number_of_seasons, not_found, fetched_at
    FROM title_seasons
    WHERE (tmdb_id, media_type) IN (
      SELECT id, media_type FROM unnest(${ids}::bigint[], ${mediaTypes}::text[]) AS pairs(id, media_type)
    )
  `;

  for (const row of rows) {
    const cached = toCached(row);
    found.set(seasonsCacheKey(cached), cached);
  }
  return found;
}

/** Writes a TMDB answer — including a `notFound` tombstone — and returns the
 *  stored row. Only ever called with a real answer; an unknown result (network
 *  failure, unset key) must not be cached or it would mask a title for the
 *  full TTL. */
export async function upsertSeasons(
  sql: postgres.Sql,
  key: SeasonKey,
  numberOfSeasons: number | null,
  notFound: boolean,
): Promise<CachedSeasons> {
  const [row] = await sql`
    INSERT INTO title_seasons (tmdb_id, media_type, number_of_seasons, not_found, fetched_at)
    VALUES (${key.tmdbId}, ${key.mediaType}, ${numberOfSeasons}, ${notFound}, now())
    ON CONFLICT (tmdb_id, media_type) DO UPDATE SET
      number_of_seasons = EXCLUDED.number_of_seasons,
      not_found         = EXCLUDED.not_found,
      fetched_at        = now()
    RETURNING tmdb_id, media_type, number_of_seasons, not_found, fetched_at
  `;
  return toCached(row);
}

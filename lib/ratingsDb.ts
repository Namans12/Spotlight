import type postgres from "postgres";
import type { OmdbRatings } from "./omdb.js";

// Read/write layer for the title_ratings cache (migrations/0002_title_ratings.sql).
//
// The cache is what keeps OMDb's 1,000/day free tier out of reach of ordinary
// browsing: every grid render is a batch read here and nothing else. Refreshing
// stale rows is the backfill cron's job (scripts/backfill_ratings.py) — a stale
// row is served as-is rather than blocking a request on a live OMDb call.

/** A cached row older than this is due for a refresh by the backfill. Requests
 *  still serve it in the meantime. */
export const RATINGS_TTL_DAYS = 7;
const TTL_MS = RATINGS_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface RatingKey {
  tmdbId: number;
  mediaType: "movie" | "tv";
}

/** A row exactly as stored, including the `notFound` tombstone. */
export interface CachedRating extends RatingKey {
  imdbId: string | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  rtScore: number | null;
  metacritic: number | null;
  notFound: boolean;
  fetchedAt: string;
}

/** What the API hands the frontend. Only ever produced for titles that actually
 *  have something to show. */
export interface TitleRatingDTO {
  tmdbId: number;
  mediaType: "movie" | "tv";
  imdbId: string | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  rtScore: number | null;
  metacritic: number | null;
  fetchedAt: string;
  stale: boolean;
}

export function ratingCacheKey(key: RatingKey): string {
  return `${key.mediaType}:${key.tmdbId}`;
}

export function isStale(fetchedAt: string): boolean {
  const at = Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return true;
  return Date.now() - at > TTL_MS;
}

function toCached(row: any): CachedRating {
  return {
    tmdbId: Number(row.tmdb_id),
    mediaType: row.media_type,
    imdbId: row.imdb_id ?? null,
    imdbRating: row.imdb_rating !== null && row.imdb_rating !== undefined ? Number(row.imdb_rating) : null,
    imdbVotes: row.imdb_votes !== null && row.imdb_votes !== undefined ? Number(row.imdb_votes) : null,
    rtScore: row.rt_score !== null && row.rt_score !== undefined ? Number(row.rt_score) : null,
    metacritic: row.metacritic !== null && row.metacritic !== undefined ? Number(row.metacritic) : null,
    notFound: Boolean(row.not_found),
    fetchedAt: new Date(row.fetched_at).toISOString(),
  };
}

/** Cached row -> wire shape, or null when there is nothing worth rendering.
 *  The product rule is that a title with neither an IMDb score nor an RT score
 *  shows no ratings UI at all, so "we looked and found nothing" and "we have
 *  never looked" deliberately collapse to the same answer for the client. */
export function toRatingDTO(row: CachedRating): TitleRatingDTO | null {
  if (row.notFound) return null;
  if (row.imdbRating === null && row.rtScore === null) return null;
  return {
    tmdbId: row.tmdbId,
    mediaType: row.mediaType,
    imdbId: row.imdbId,
    imdbRating: row.imdbRating,
    imdbVotes: row.imdbVotes,
    rtScore: row.rtScore,
    metacritic: row.metacritic,
    fetchedAt: row.fetchedAt,
    stale: isStale(row.fetchedAt),
  };
}

/** Batch cache read, keyed by `${mediaType}:${tmdbId}`. Missing keys are simply
 *  absent from the map. Never touches OMDb — this is the call a poster grid
 *  makes, and it must stay free. */
export async function getCachedRatings(
  sql: postgres.Sql,
  keys: RatingKey[],
): Promise<Map<string, CachedRating>> {
  const found = new Map<string, CachedRating>();
  if (keys.length === 0) return found;

  const ids = keys.map((key) => key.tmdbId);
  const mediaTypes = keys.map((key) => key.mediaType);

  const rows = await sql`
    SELECT tmdb_id, media_type, imdb_id, imdb_rating, imdb_votes, rt_score, metacritic, not_found, fetched_at
    FROM title_ratings
    WHERE (tmdb_id, media_type) IN (
      SELECT id, media_type FROM unnest(${ids}::bigint[], ${mediaTypes}::text[]) AS pairs(id, media_type)
    )
  `;

  for (const row of rows) {
    const cached = toCached(row);
    found.set(ratingCacheKey(cached), cached);
  }
  return found;
}

/** Writes an OMDb answer — including a `notFound` tombstone — and returns the
 *  stored row. Only ever called with a real answer; an unknown result (network
 *  failure, unset key) must not be cached or it would mask a title for a week. */
export async function upsertRatings(
  sql: postgres.Sql,
  key: RatingKey,
  ratings: OmdbRatings,
): Promise<CachedRating> {
  const [row] = await sql`
    INSERT INTO title_ratings
      (tmdb_id, media_type, imdb_id, imdb_rating, imdb_votes, rt_score, metacritic, not_found, fetched_at)
    VALUES (
      ${key.tmdbId}, ${key.mediaType}, ${ratings.imdbId}, ${ratings.imdbRating}, ${ratings.imdbVotes},
      ${ratings.rtScore}, ${ratings.metacritic}, ${ratings.notFound}, now()
    )
    ON CONFLICT (tmdb_id, media_type) DO UPDATE SET
      imdb_id     = EXCLUDED.imdb_id,
      imdb_rating = EXCLUDED.imdb_rating,
      imdb_votes  = EXCLUDED.imdb_votes,
      rt_score    = EXCLUDED.rt_score,
      metacritic  = EXCLUDED.metacritic,
      not_found   = EXCLUDED.not_found,
      fetched_at  = now()
    RETURNING tmdb_id, media_type, imdb_id, imdb_rating, imdb_votes, rt_score, metacritic, not_found, fetched_at
  `;
  return toCached(row);
}

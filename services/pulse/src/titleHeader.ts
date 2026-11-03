// Where the brief's header gets its title, poster and date: the release tables
// Spotlight already keeps, and TMDB only for a title neither one holds, since
// a TMDB call is a network round trip and a quota unit.

import type { TitleSummary } from "./brief.js";
import type { EntityKey } from "./db/entities.js";

export type TitleSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<Record<string, unknown>[]>;

/** The slice of lib/tmdbProxy's tmdbDetail this needs, so tests need no network. */
export type TmdbDetail = (mediaType: "movie" | "tv", id: number) => Promise<{ title: string; posterUrl: string | null; releaseDate: string }>;

const summary = (r: Record<string, unknown>): TitleSummary => ({
  title: String(r.title),
  posterUrl: (r.poster_url as string | null) ?? null,
  releaseDate: (r.release_date as string | null) ?? null,
});

/** A database error propagates (the brief reports it and still streams); a
 *  TMDB error does not, because "unknown title" is the honest answer then. */
export function createTitleLookup(sql: TitleSql, tmdbDetail: TmdbDetail): (key: EntityKey) => Promise<TitleSummary | null> {
  return async (key) => {
    const [release] = await sql`
      SELECT title, poster_url, release_date::text AS release_date
      FROM release_items
      WHERE tmdb_id = ${key.tmdbId} AND media_type = ${key.mediaType}
      ORDER BY release_date DESC NULLS LAST
      LIMIT 1`;
    if (release) return summary(release);

    const [calendar] = await sql`
      SELECT title, poster_url, release_date::text AS release_date
      FROM calendar_entries
      WHERE tmdb_id = ${key.tmdbId} AND media_type = ${key.mediaType}
      ORDER BY release_date DESC NULLS LAST
      LIMIT 1`;
    if (calendar) return summary(calendar);

    try {
      const d = await tmdbDetail(key.mediaType, key.tmdbId);
      return { title: d.title, posterUrl: d.posterUrl, releaseDate: d.releaseDate || null };
    } catch {
      return null;
    }
  };
}

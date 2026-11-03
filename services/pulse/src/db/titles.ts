// Whether Spotlight already knows a title, which is what gates /brief: the
// endpoint is public and each brief can cost Qloo and TMDB calls, so it only
// briefs titles that are in the release data or were resolved before.

import type { EntityKey } from "./entities.js";

export type TitlesSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<Record<string, unknown>[]>;

/** True when the title is in release_items, in calendar_entries, or already
 *  resolved to a Qloo entity (a cached miss does not count). calendar_entries
 *  rows often have a NULL media_type, so, as lib/calendarDb.ts does, the type
 *  is derived from entry_type when the column is empty. */
export async function isKnownTitle(sql: TitlesSql, key: EntityKey): Promise<boolean> {
  const rows = await sql`
    SELECT (
      EXISTS (SELECT 1 FROM release_items WHERE tmdb_id = ${key.tmdbId} AND media_type = ${key.mediaType})
      OR EXISTS (
        SELECT 1 FROM calendar_entries WHERE tmdb_id = ${key.tmdbId}
          AND COALESCE(media_type, CASE lower(btrim(entry_type)) WHEN 'movie' THEN 'movie' WHEN 'show' THEN 'tv' END) = ${key.mediaType})
      OR EXISTS (SELECT 1 FROM qloo_entities WHERE tmdb_id = ${key.tmdbId} AND media_type = ${key.mediaType} AND not_found = false)
    ) AS known`;
  return rows[0]?.known === true;
}

/** TMDB popularity per title, from release_items, in one statement. The
 *  calendar merge in lib/calendarDb.ts does not carry popularity, and the
 *  board needs it to pick which twenty releases to show. A title with no
 *  release_items row is simply absent (the caller counts it as 0). Keyed by
 *  `<mediaType>:<tmdbId>`; the highest value wins across a title's rows. */
export async function getPopularity(sql: TitlesSql, keys: EntityKey[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (keys.length === 0) return out;
  const wanted = new Set(keys.map((k) => `${k.mediaType}:${k.tmdbId}`));
  const rows = await sql`
    SELECT tmdb_id, media_type, MAX(popularity) AS popularity
    FROM release_items
    WHERE tmdb_id = ANY(${[...new Set(keys.map((k) => k.tmdbId))]})
    GROUP BY tmdb_id, media_type`;
  for (const r of rows) {
    const key = `${String(r.media_type)}:${Number(r.tmdb_id)}`;
    const value = Number(r.popularity);
    if (wanted.has(key) && Number.isFinite(value)) out.set(key, value);
  }
  return out;
}

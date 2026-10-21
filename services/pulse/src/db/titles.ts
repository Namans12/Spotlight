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

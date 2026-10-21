import { cleanText } from "../../campaign.js";
import type { EvidenceSql } from "../../db/evidence.js";
import type { AgentTool, AgentToolDeps } from "./types.js";

const MAX_QUERY = 80;
const LIMIT = 10;
/** How many hits the model is shown (the brief tool still searches the wider 10 to pick a media type). */
const SHOWN = 6;

export interface ReleaseHit { tmdbId: number; mediaType: "movie" | "tv"; title: string; date: string | null; platform: string | null }

/** The model's text is matched literally: `%` and `_` are LIKE wildcards and
 *  `\` is the escape character, so each is escaped before the text is wrapped
 *  in the pattern's own `%…%`. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Case-insensitive title search over release_items and calendar_entries
 *  (rows with a TMDB id only: the others cannot be briefed). The text is a
 *  bound parameter, never part of the statement. One row per title, the exact
 *  title first, then the most recent. Rows come back at most `limit`. */
export async function searchReleases(sql: EvidenceSql, query: string, limit = LIMIT): Promise<ReleaseHit[]> {
  const pattern = `%${escapeLike(query)}%`;
  const rows = await sql`
    SELECT tmdb_id, media_type, title, release_date::text AS release_date, platform
    FROM (
      SELECT DISTINCT ON (tmdb_id, media_type) tmdb_id, media_type, title, release_date, platform
      FROM (
        SELECT tmdb_id, media_type, title, release_date, providers[1] AS platform
        FROM release_items
        WHERE title ILIKE ${pattern} ESCAPE '\\'
        UNION ALL
        SELECT tmdb_id,
               COALESCE(media_type, CASE lower(btrim(entry_type)) WHEN 'movie' THEN 'movie' WHEN 'show' THEN 'tv' END) AS media_type,
               title, release_date, platform_or_distributor AS platform
        FROM calendar_entries
        WHERE tmdb_id IS NOT NULL AND title ILIKE ${pattern} ESCAPE '\\'
      ) u
      WHERE media_type IS NOT NULL
      ORDER BY tmdb_id, media_type, release_date DESC NULLS LAST
    ) d
    ORDER BY (lower(title) = lower(${query})) DESC, release_date DESC NULLS LAST, tmdb_id
    LIMIT 10`;
  return rows.slice(0, limit).map((r) => ({
    tmdbId: Number(r.tmdb_id),
    mediaType: r.media_type as "movie" | "tv",
    title: cleanText(r.title, 100),
    date: typeof r.release_date === "string" ? r.release_date : null,
    platform: typeof r.platform === "string" && r.platform ? cleanText(r.platform, 40) : null,
  }));
}

/** The query as it will be searched, or null when there is nothing to search for. */
export function queryArg(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const q = [...v.trim()].slice(0, MAX_QUERY).join("").trim();
  return q === "" ? null : q;
}

export function searchReleasesTool(deps: AgentToolDeps): AgentTool {
  return {
    spec: {
      type: "function",
      function: {
        name: "search_releases",
        description: "Find releases Spotlight knows by part of the title (case-insensitive). Returns up to 6 with tmdbId, mediaType, title, date and platform. Use it to turn a title the user names into a tmdbId before release_brief.",
        parameters: { type: "object", properties: { query: { type: "string", description: "Part of a title, at most 80 characters." } }, required: ["query"], additionalProperties: false },
      },
    },
    async run(args) {
      const query = queryArg(args.query);
      if (query === null) return { error: "empty_query", hint: "Pass part of a release title." };
      const results = (await searchReleases(deps.sql, query)).slice(0, SHOWN);
      return {
        summary: `${results.length} release(s) match "${query}".`,
        query,
        results: results.map((r) => ({ tmdbId: r.tmdbId, mediaType: r.mediaType, title: r.title, date: r.date, platform: r.platform })),
        ...(results.length === 0 ? { note: "No release in Spotlight's data matches that text; it may not be tracked, or may be spelled differently." } : {}),
      };
    },
  };
}

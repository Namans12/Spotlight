import { cleanText } from "../../campaign.js";
import { cityArg, citySchema } from "./args.js";
import type { AgentTool, AgentToolDeps } from "./types.js";

const LIMIT = 20;

export function titlesShotInTool(deps: AgentToolDeps): AgentTool {
  return {
    spec: {
      type: "function",
      function: {
        name: "titles_shot_in",
        description: "List releases Spotlight knows that are recorded as filmed or set in a launch city, with the kind (filmed or set) and a landmark when one is known. Up to 20.",
        parameters: { type: "object", properties: { city: citySchema() }, required: ["city"], additionalProperties: false },
      },
    },
    async run(args) {
      const c = cityArg(args.city);
      if (!c.ok) return c.error;
      const { city } = c;
      // Titles come from title_locations, restricted to the ones the release
      // tables know, so every row can be briefed. Rows with no source are
      // skipped, as everywhere: a claim with no attribution is not shown.
      const rows = await deps.sql`
        WITH known AS (
          SELECT DISTINCT ON (tmdb_id, media_type) tmdb_id, media_type, title, release_date
          FROM (
            SELECT tmdb_id, media_type, title, release_date FROM release_items
            UNION ALL
            SELECT tmdb_id,
                   COALESCE(media_type, CASE lower(btrim(entry_type)) WHEN 'movie' THEN 'movie' WHEN 'show' THEN 'tv' END) AS media_type,
                   title, release_date
            FROM calendar_entries WHERE tmdb_id IS NOT NULL
          ) u
          WHERE media_type IS NOT NULL
            AND tmdb_id IN (SELECT tmdb_id FROM title_locations WHERE city_slug = ${city.slug} AND source IS NOT NULL)
          ORDER BY tmdb_id, media_type, release_date DESC NULLS LAST
        )
        SELECT k.tmdb_id, k.media_type, k.title, k.release_date::text AS release_date, tl.kind, tl.landmark_label
        FROM title_locations tl
        JOIN known k ON k.tmdb_id = tl.tmdb_id AND k.media_type = tl.media_type
        WHERE tl.city_slug = ${city.slug} AND tl.source IS NOT NULL
        ORDER BY (tl.landmark_label IS NOT NULL) DESC, k.release_date DESC NULLS LAST, k.tmdb_id, tl.kind
        LIMIT 20`;
      const titles = rows.slice(0, LIMIT).map((r) => ({
        tmdbId: Number(r.tmdb_id),
        mediaType: r.media_type as "movie" | "tv",
        title: cleanText(r.title, 100),
        releaseDate: typeof r.release_date === "string" ? r.release_date : null,
        kind: r.kind as "filmed" | "set",
        landmark: typeof r.landmark_label === "string" && r.landmark_label ? cleanText(r.landmark_label, 60) : null,
      }));
      return {
        summary: `${titles.length} title(s) recorded as shot or set in ${city.name}.`,
        city: city.slug,
        titles,
        ...(titles.length === 0
          ? { note: `No title in Spotlight's release data is recorded as shot or set in ${city.name}. Coverage is partial (public Wikipedia and Wikidata records, patchy for India), so this does not mean none were.` }
          : {}),
      };
    },
  };
}

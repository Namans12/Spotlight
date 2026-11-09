import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../lib/db.js";
import type { DigestResponse, DigestWindow, ReleaseEvidenceDTO, ReleaseItemDTO, SectionKey, WindowKind } from "../shared/types/release.js";

const SECTION_ORDER: SectionKey[] = ["hindi", "english", "popular"];
const WINDOW_KINDS: WindowKind[] = ["out_now", "coming_up"];

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const region = url.searchParams.get("region") ?? process.env.REGION ?? "IN";

  try {
    const sql = getDb();

    const windows: Record<WindowKind, DigestWindow> = {
      out_now: { start: "", end: "", sections: { hindi: [], english: [], popular: [] } },
      coming_up: { start: "", end: "", sections: { hindi: [], english: [], popular: [] } },
    };
    let generatedAt = "";

    for (const windowKind of WINDOW_KINDS) {
      const rows = await sql<
        Array<{
          tmdb_id: string;
          media_type: "movie" | "tv";
          title: string;
          language: string;
          release_date: string | null;
          rating: string | null;
          popularity: string;
          overview: string;
          tmdb_url: string;
          poster_url: string | null;
          providers: string[];
          section: SectionKey;
          window_start: string;
          window_end: string;
          generated_at: string;
          evidence: ReleaseEvidenceDTO | null;
        }>
      >`
        SELECT tmdb_id, media_type, title, language, release_date::text AS release_date, rating, popularity,
               overview, tmdb_url, poster_url, providers, section,
               window_start::text AS window_start, window_end::text AS window_end, generated_at, evidence
        FROM release_items
        WHERE region = ${region} AND window_kind = ${windowKind}
        ORDER BY release_date ASC NULLS LAST, popularity DESC, title ASC
      `;

      if (rows.length > 0) {
        windows[windowKind].start = rows[0].window_start;
        windows[windowKind].end = rows[0].window_end;
        generatedAt = rows[0].generated_at;
      }

      for (const section of SECTION_ORDER) {
        windows[windowKind].sections[section] = rows
          .filter((row) => row.section === section && row.release_date !== null &&
            row.release_date >= row.window_start && row.release_date <= row.window_end &&
            row.evidence?.region === region && row.evidence?.date_source === "tmdb_regional_digital")
          .map(
            (row): ReleaseItemDTO => ({
              tmdb_id: Number(row.tmdb_id),
              title: row.title,
              media_type: row.media_type,
              language: row.language,
              release_date: row.release_date ?? "TBA",
              rating: row.rating !== null ? Number(row.rating) : null,
              popularity: Number(row.popularity),
              overview: row.overview,
              tmdb_url: row.tmdb_url,
              poster_url: row.poster_url,
              providers: row.evidence?.provider_source === "tmdb_regional_availability" ? row.providers : [],
              evidence: row.evidence,
            }),
          );
      }
    }

    const payload: DigestResponse = {
      generated_at: generatedAt,
      region,
      out_now: windows.out_now,
      coming_up: windows.coming_up,
    };

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800");
    res.end(JSON.stringify(payload));
  } catch (err) {
    console.error("[releases] lookup failed", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    // Generic message to the client — the real error (which can include raw
    // Postgres driver detail) is logged server-side, never shipped to the browser.
    res.end(JSON.stringify({ error: "could not load releases" }));
  }
}

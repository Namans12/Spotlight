import { describe, expect, it } from "vitest";
import { getPopularity, isKnownTitle, type TitlesSql } from "./titles.js";

function recorder(rows: Record<string, unknown>[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((s: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: s.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(rows);
  }) as unknown as TitlesSql;
  return { sql, calls };
}
const key = { tmdbId: 7, mediaType: "tv" as const };

describe("isKnownTitle", () => {
  it("checks release_items, calendar_entries and resolved qloo_entities with parameters only", async () => {
    const { sql, calls } = recorder([{ known: true }]);
    expect(await isKnownTitle(sql, key)).toBe(true);
    const t = calls[0].text;
    expect(t).toContain("FROM release_items WHERE tmdb_id = ? AND media_type = ?");
    expect(t).toContain("FROM calendar_entries WHERE tmdb_id = ?");
    expect(t).toContain("COALESCE(media_type, CASE lower(btrim(entry_type)) WHEN 'movie' THEN 'movie' WHEN 'show' THEN 'tv' END) = ?");
    expect(t).toContain("FROM qloo_entities WHERE tmdb_id = ? AND media_type = ? AND not_found = false");
    expect(calls[0].values).toEqual([7, "tv", 7, "tv", 7, "tv"]);
  });
  it("is false when nothing matches or the row is missing", async () => {
    expect(await isKnownTitle(recorder([{ known: false }]).sql, key)).toBe(false);
    expect(await isKnownTitle(recorder([]).sql, key)).toBe(false);
  });
});

describe("getPopularity", () => {
  it("reads the highest popularity per title in one statement, coercing NUMERIC strings", async () => {
    const { sql, calls } = recorder([
      { tmdb_id: "7", media_type: "movie", popularity: "41.250" },
      { tmdb_id: "7", media_type: "tv", popularity: "3" }, // same id, other media type, not asked for
      { tmdb_id: "8", media_type: "tv", popularity: "n/a" },
    ]);
    const out = await getPopularity(sql, [{ tmdbId: 7, mediaType: "movie" }, { tmdbId: 8, mediaType: "tv" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("MAX(popularity)");
    expect(calls[0].text).toContain("FROM release_items WHERE tmdb_id = ANY(?) GROUP BY tmdb_id, media_type");
    expect(calls[0].values).toEqual([[7, 8]]);
    expect(out.get("movie:7")).toBe(41.25);
    expect(out.has("tv:7")).toBe(false);
    expect(out.has("tv:8")).toBe(false); // not a number
  });

  it("issues no statement for no titles", async () => {
    const { sql, calls } = recorder([]);
    expect((await getPopularity(sql, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

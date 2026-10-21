import { describe, expect, it } from "vitest";
import { isKnownTitle, type TitlesSql } from "./titles.js";

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

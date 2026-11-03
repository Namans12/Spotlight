import { describe, expect, it } from "vitest";
import { getCachedEntities, type EntitySql } from "./entities.js";

function recorder(rows: Record<string, unknown>[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((s: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: s.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(rows);
  }) as unknown as EntitySql;
  return { sql, calls };
}
const resolvedAt = new Date("2026-10-20T00:00:00Z");

describe("getCachedEntities", () => {
  it("reads the cache for many titles in one statement, keyed by media type and id", async () => {
    const { sql, calls } = recorder([
      { tmdb_id: "7", media_type: "movie", qloo_entity_id: "e7", method: "imdb", not_found: false, resolved_at: resolvedAt },
      { tmdb_id: "8", media_type: "tv", qloo_entity_id: null, method: null, not_found: true, resolved_at: resolvedAt },
      { tmdb_id: "7", media_type: "tv", qloo_entity_id: "other", method: "search", not_found: false, resolved_at: resolvedAt }, // not asked for
    ]);
    const out = await getCachedEntities(sql, [{ tmdbId: 7, mediaType: "movie" }, { tmdbId: 8, mediaType: "tv" }, { tmdbId: 9, mediaType: "movie" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("FROM qloo_entities WHERE tmdb_id = ANY(?)");
    expect(calls[0].values).toEqual([[7, 8, 9]]);
    expect(out.get("movie:7")).toEqual({ entityId: "e7", method: "imdb", notFound: false, resolvedAt });
    expect(out.get("tv:8")).toEqual({ entityId: null, method: null, notFound: true, resolvedAt });
    expect(out.has("tv:7")).toBe(false);
    expect(out.has("movie:9")).toBe(false);
  });

  it("issues no statement for no titles", async () => {
    const { sql, calls } = recorder([]);
    expect((await getCachedEntities(sql, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

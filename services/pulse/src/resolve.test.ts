import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QlooClient, QlooEntityRef } from "./qloo/client.js";
import { notFoundIsStale, pickSearchMatch, resolveTitle } from "./resolve.js";
import type { EntitySql } from "./db/entities.js";

// resolve.ts reads TMDB through ./tmdbLookup.js: null is a definite 404, a
// throw is an outage (see that module). The default answer here is the 404.
vi.mock("./tmdbLookup.js", async (orig) => ({ ...(await orig<typeof import("./tmdbLookup.js")>()), lookupTmdbTitle: vi.fn() }));
import { lookupTmdbTitle, TmdbUnavailableError } from "./tmdbLookup.js";
const tmdb = vi.mocked(lookupTmdbTitle);

type Row = Record<string, unknown>;
interface Call { text: string; values: unknown[] }

const INSERT_COLUMNS =
  "INSERT INTO qloo_entities (tmdb_id, media_type, imdb_id, qloo_entity_id, method, not_found, resolved_at)";

/**
 * Stands in for the postgres.js tagged-template client, routing on the table a
 * statement reads or writes. postgres.js interleaves values into the strings
 * array, so position is the only thing identifying a column; the INSERT's
 * column list is asserted first so an edit to the statement fails loudly here
 * instead of silently checking the wrong field (same discipline as
 * lib/relationsDb.test.ts).
 */
function fakeSql(tables: { qloo_entities?: Row[]; title_ratings?: Row[]; fail?: "read" | "write" } = {}) {
  const calls: Call[] = [];
  const upserts: Row[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push({ text, values });
    if (text.startsWith("INSERT INTO qloo_entities")) {
      expect(text).toContain(INSERT_COLUMNS);
      expect(text).toContain("ON CONFLICT (tmdb_id, media_type) DO UPDATE");
      if (tables.fail === "write") return Promise.reject(new Error("db write down"));
      const [tmdb_id, media_type, imdb_id, qloo_entity_id, method, not_found, resolved_at] = values;
      upserts.push({ tmdb_id, media_type, imdb_id, qloo_entity_id, method, not_found, resolved_at });
      return Promise.resolve([]);
    }
    if (text.includes("FROM qloo_entities")) {
      if (tables.fail === "read") return Promise.reject(new Error("db read down"));
      return Promise.resolve(tables.qloo_entities ?? []);
    }
    if (text.includes("FROM title_ratings")) return Promise.resolve(tables.title_ratings ?? []);
    throw new Error(`unexpected statement: ${text}`);
  }) as unknown as EntitySql;
  return { sql, calls, upserts };
}

function fakeQloo(over: Partial<Pick<QlooClient, "entityByImdb" | "searchTitles">> = {}) {
  const entityByImdb = vi.fn(over.entityByImdb ?? (async () => null));
  const searchTitles = vi.fn(over.searchTitles ?? (async () => []));
  return { qloo: { entityByImdb, searchTitles } as unknown as QlooClient, entityByImdb, searchTitles };
}

const ref = (entityId: string, type: "movie" | "tv_show", year: number | null, name = "X"): QlooEntityRef =>
  ({ entityId, name, type, year });

beforeEach(() => {
  tmdb.mockReset();
  tmdb.mockResolvedValue(null);
});

describe("pickSearchMatch", () => {
  it("accepts a search match only within ±1 year and the same type", () => {
    const c = [ref("a", "movie", 2019), ref("b", "tv_show", 2024)];
    expect(pickSearchMatch(c, { year: 2024, type: "tv_show" })?.entityId).toBe("b");
    expect(pickSearchMatch(c, { year: 2022, type: "movie" })).toBeNull();
  });

  it("treats exactly one year apart as a match and two as a miss", () => {
    expect(pickSearchMatch([ref("a", "movie", 2023)], { year: 2024, type: "movie" })?.entityId).toBe("a");
    expect(pickSearchMatch([ref("a", "movie", 2025)], { year: 2024, type: "movie" })?.entityId).toBe("a");
    expect(pickSearchMatch([ref("a", "movie", 2026)], { year: 2024, type: "movie" })).toBeNull();
  });

  it("rejects a candidate with no year when a year is wanted", () => {
    expect(pickSearchMatch([ref("a", "movie", null)], { year: 2024, type: "movie" })).toBeNull();
  });

  it("never guesses when the wanted year is unknown", () => {
    const c = [ref("a", "movie", 2024), ref("b", "movie", null)];
    expect(pickSearchMatch(c, { year: null, type: "movie" })).toBeNull();
  });

  it("prefers the closest year, then the earliest listed", () => {
    const c = [ref("far", "movie", 2023), ref("exact", "movie", 2024), ref("also-exact", "movie", 2024)];
    expect(pickSearchMatch(c, { year: 2024, type: "movie" })?.entityId).toBe("exact");
    const tie = [ref("first", "movie", 2023), ref("second", "movie", 2025)];
    expect(pickSearchMatch(tie, { year: 2024, type: "movie" })?.entityId).toBe("first");
  });

  it("returns null for no candidates", () => {
    expect(pickSearchMatch([], { year: 2024, type: "movie" })).toBeNull();
  });
});

describe("notFoundIsStale", () => {
  it("retries a not_found older than 3 days", () => {
    expect(notFoundIsStale(new Date("2026-10-17"), new Date("2026-10-21"))).toBe(true);
  });
  it("is strictly more than 3 days: exactly 3 is still fresh", () => {
    expect(notFoundIsStale(new Date("2026-10-18T00:00:00Z"), new Date("2026-10-21T00:00:00Z"))).toBe(false);
    expect(notFoundIsStale(new Date("2026-10-18T00:00:00Z"), new Date("2026-10-21T00:00:01Z"))).toBe(true);
  });
});

describe("resolveTitle", () => {
  const key = { tmdbId: 9, mediaType: "movie" as const };
  const NOW = new Date("2026-10-21T12:00:00Z");

  it("returns a cached entity without touching Qloo, TMDB or title_ratings", async () => {
    const { sql, calls } = fakeSql({ qloo_entities: [{ qloo_entity_id: "q1", method: "search", not_found: false, resolved_at: new Date("2026-01-01") }] });
    const { qloo, entityByImdb, searchTitles } = fakeQloo();
    expect(await resolveTitle(sql, qloo, key, NOW)).toEqual({ entityId: "q1", method: "search" });
    expect(entityByImdb).not.toHaveBeenCalled();
    expect(searchTitles).not.toHaveBeenCalled();
    expect(tmdb).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("FROM qloo_entities");
    expect(calls[0].values).toEqual([9, "movie"]);
  });

  it("does not re-ask Qloo for a fresh not_found", async () => {
    const qloo = { entityByImdb: vi.fn(), searchTitles: vi.fn() } as unknown as QlooClient;
    const { sql, upserts } = fakeSql({ qloo_entities: [{ not_found: true, resolved_at: new Date("2026-10-20") }] });
    expect(await resolveTitle(sql, qloo, { tmdbId: 1, mediaType: "movie" }, new Date("2026-10-21"))).toEqual({ entityId: null, reason: "not_in_qloo" });
    expect(qloo.entityByImdb).not.toHaveBeenCalled();
    expect(qloo.searchTitles).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it("retries a stale not_found and overwrites the row on success", async () => {
    const { sql, upserts } = fakeSql({
      qloo_entities: [{ not_found: true, resolved_at: new Date("2026-10-01") }],
      title_ratings: [{ imdb_id: "tt5" }],
    });
    const { qloo, entityByImdb } = fakeQloo({ entityByImdb: async () => ref("q5", "movie", 2024) });
    expect(await resolveTitle(sql, qloo, key, NOW)).toEqual({ entityId: "q5", method: "imdb" });
    expect(entityByImdb).toHaveBeenCalledWith("tt5");
    expect(upserts).toEqual([{ tmdb_id: 9, media_type: "movie", imdb_id: "tt5", qloo_entity_id: "q5", method: "imdb", not_found: false, resolved_at: NOW }]);
  });

  it("uses the title_ratings IMDb id and skips TMDB", async () => {
    const { sql, calls } = fakeSql({ title_ratings: [{ imdb_id: "tt1" }] });
    const { qloo } = fakeQloo({ entityByImdb: async () => ref("q1", "movie", 2024) });
    await resolveTitle(sql, qloo, key, NOW);
    expect(tmdb).not.toHaveBeenCalled();
    const ratings = calls.find((c) => c.text.includes("FROM title_ratings"))!;
    expect(ratings.values).toEqual([9, "movie"]);
  });

  it("falls back to the TMDB lookup when title_ratings has no IMDb id", async () => {
    tmdb.mockResolvedValue({ imdbId: "tt2", title: "Dune", year: "2021" });
    for (const title_ratings of [[], [{ imdb_id: null }]]) {
      const { sql, upserts } = fakeSql({ title_ratings });
      const { qloo, entityByImdb } = fakeQloo({ entityByImdb: async () => ref("q2", "movie", 2021) });
      expect(await resolveTitle(sql, qloo, key, NOW)).toEqual({ entityId: "q2", method: "imdb" });
      expect(tmdb).toHaveBeenLastCalledWith("movie", 9);
      expect(entityByImdb).toHaveBeenCalledWith("tt2");
      expect(upserts[0]).toMatchObject({ imdb_id: "tt2", qloo_entity_id: "q2", method: "imdb", not_found: false });
    }
  });

  it("searches by title and year when the IMDb id misses, mapping tv to tv_show", async () => {
    tmdb.mockResolvedValue({ imdbId: "tt3", title: "Severance", year: "2022" });
    const { sql, upserts } = fakeSql();
    const { qloo, searchTitles } = fakeQloo({
      searchTitles: async () => [ref("wrong", "movie", 2022), ref("q3", "tv_show", 2022)],
    });
    const r = await resolveTitle(sql, qloo, { tmdbId: 3, mediaType: "tv" }, NOW);
    expect(r).toEqual({ entityId: "q3", method: "search" });
    expect(searchTitles).toHaveBeenCalledWith("Severance", "tv_show");
    expect(upserts[0]).toMatchObject({ imdb_id: "tt3", qloo_entity_id: "q3", method: "search", not_found: false });
  });

  it("fetches the title lazily, once, when the IMDb id came from title_ratings and missed", async () => {
    tmdb.mockResolvedValue({ imdbId: "tt1", title: "Heat", year: "1995" });
    const { sql, upserts } = fakeSql({ title_ratings: [{ imdb_id: "tt1" }] });
    const { qloo, searchTitles } = fakeQloo({ searchTitles: async () => [ref("q9", "movie", 1995)] });
    expect(await resolveTitle(sql, qloo, key, NOW)).toEqual({ entityId: "q9", method: "search" });
    expect(tmdb).toHaveBeenCalledTimes(1);
    expect(searchTitles).toHaveBeenCalledWith("Heat", "movie");
    expect(upserts[0]).toMatchObject({ imdb_id: "tt1", method: "search" });
  });

  it("does not search without a year; the miss is cached", async () => {
    tmdb.mockResolvedValue({ imdbId: null, title: "Heat", year: null });
    const { sql, upserts } = fakeSql();
    const { qloo } = fakeQloo({ searchTitles: async () => [ref("q9", "movie", 1995)] });
    expect(await resolveTitle(sql, qloo, key, NOW)).toEqual({ entityId: null, reason: "no_imdb_and_no_match" });
    expect(upserts[0]).toMatchObject({ qloo_entity_id: null, method: null, not_found: true });
  });

  it("returns no_imdb_and_no_match and caches it when neither IMDb id nor title can be found", async () => {
    const { sql, upserts } = fakeSql();
    const { qloo, entityByImdb, searchTitles } = fakeQloo();
    expect(await resolveTitle(sql, qloo, key, NOW)).toEqual({ entityId: null, reason: "no_imdb_and_no_match" });
    expect(entityByImdb).not.toHaveBeenCalled();
    expect(searchTitles).not.toHaveBeenCalled();
    expect(upserts).toEqual([{ tmdb_id: 9, media_type: "movie", imdb_id: null, qloo_entity_id: null, method: null, not_found: true, resolved_at: NOW }]);
  });

  it("gives up on search when title_ratings had an id but TMDB yields no title", async () => {
    const { sql, upserts } = fakeSql({ title_ratings: [{ imdb_id: "tt1" }] });
    const { qloo, searchTitles } = fakeQloo();
    expect(await resolveTitle(sql, qloo, key, NOW)).toEqual({ entityId: null, reason: "no_imdb_and_no_match" });
    expect(searchTitles).not.toHaveBeenCalled();
    expect(upserts[0]).toMatchObject({ imdb_id: "tt1", not_found: true });
  });

  it("records a miss as not_found instead of throwing (Review Focus 1)", async () => {
    const qloo = { entityByImdb: vi.fn().mockResolvedValue(null), searchTitles: vi.fn().mockResolvedValue([]) } as unknown as QlooClient;
    tmdb.mockResolvedValue({ imdbId: null, title: "Nope", year: "2024" });
    const { sql, upserts } = fakeSql({ title_ratings: [{ imdb_id: "tt1" }] });
    const r = await resolveTitle(sql, qloo, { tmdbId: 9, mediaType: "movie" });
    expect(r).toEqual({ entityId: null, reason: "not_in_qloo" });
    expect(upserts[0]).toMatchObject({ imdb_id: "tt1", qloo_entity_id: null, method: null, not_found: true });
    expect(upserts[0].resolved_at).toBeInstanceOf(Date);
  });

  describe("outages are not misses (R17)", () => {
    it("lets a TMDB outage propagate and caches nothing, not even in qloo_entities", async () => {
      tmdb.mockRejectedValue(new TmdbUnavailableError("TMDB lookup failed after 3 attempts (HTTP 503) for movie 9", 3));
      const { sql, upserts, calls } = fakeSql();
      const { qloo, entityByImdb, searchTitles } = fakeQloo();
      await expect(resolveTitle(sql, qloo, key, NOW)).rejects.toBeInstanceOf(TmdbUnavailableError);
      expect(entityByImdb).not.toHaveBeenCalled();
      expect(searchTitles).not.toHaveBeenCalled();
      expect(upserts).toHaveLength(0);
      expect(calls.some((c) => c.text.startsWith("INSERT"))).toBe(false);
    });

    it("lets a TMDB outage on the late title lookup propagate too, after Qloo's IMDb match missed", async () => {
      tmdb.mockRejectedValue(new TmdbUnavailableError("TMDB lookup failed after 3 attempts (timed out) for movie 9", 3));
      const { sql, upserts } = fakeSql({ title_ratings: [{ imdb_id: "tt1" }] });
      const { qloo, entityByImdb, searchTitles } = fakeQloo();
      await expect(resolveTitle(sql, qloo, key, NOW)).rejects.toBeInstanceOf(TmdbUnavailableError);
      expect(entityByImdb).toHaveBeenCalledWith("tt1");
      expect(searchTitles).not.toHaveBeenCalled();
      expect(upserts).toHaveLength(0);
    });

    it("a TMDB 404 is a definite miss: cached once, from a single TMDB call", async () => {
      tmdb.mockResolvedValue(null);
      const { sql, upserts } = fakeSql();
      const { qloo, entityByImdb, searchTitles } = fakeQloo();
      expect(await resolveTitle(sql, qloo, key, NOW)).toEqual({ entityId: null, reason: "no_imdb_and_no_match" });
      expect(tmdb).toHaveBeenCalledTimes(1);
      expect(entityByImdb).not.toHaveBeenCalled();
      expect(searchTitles).not.toHaveBeenCalled();
      expect(upserts).toEqual([{ tmdb_id: 9, media_type: "movie", imdb_id: null, qloo_entity_id: null, method: null, not_found: true, resolved_at: NOW }]);
    });

    it("lets an entityByImdb failure propagate and caches nothing", async () => {
      const { sql, upserts } = fakeSql({ title_ratings: [{ imdb_id: "tt1" }] });
      const { qloo, searchTitles } = fakeQloo({ entityByImdb: async () => { throw new Error("Qloo timeout"); } });
      await expect(resolveTitle(sql, qloo, key, NOW)).rejects.toThrow("Qloo timeout");
      expect(searchTitles).not.toHaveBeenCalled();
      expect(upserts).toHaveLength(0);
    });

    it("lets a searchTitles failure propagate and caches nothing", async () => {
      tmdb.mockResolvedValue({ imdbId: "tt1", title: "Heat", year: "1995" });
      const { sql, upserts } = fakeSql();
      const { qloo } = fakeQloo({ searchTitles: async () => { throw new Error("429 exhausted"); } });
      await expect(resolveTitle(sql, qloo, key, NOW)).rejects.toThrow("429 exhausted");
      expect(upserts).toHaveLength(0);
    });

    it("lets a database read failure propagate", async () => {
      const { sql } = fakeSql({ fail: "read" });
      const { qloo, entityByImdb } = fakeQloo();
      await expect(resolveTitle(sql, qloo, key, NOW)).rejects.toThrow("db read down");
      expect(entityByImdb).not.toHaveBeenCalled();
    });

    it("lets a database write failure propagate", async () => {
      const { sql } = fakeSql({ fail: "write", title_ratings: [{ imdb_id: "tt1" }] });
      const { qloo } = fakeQloo({ entityByImdb: async () => ref("q1", "movie", 2024) });
      await expect(resolveTitle(sql, qloo, key, NOW)).rejects.toThrow("db write down");
    });

    it("forgets a failed in-flight call so the next one retries", async () => {
      const { sql } = fakeSql({ title_ratings: [{ imdb_id: "tt1" }] });
      let n = 0;
      const { qloo } = fakeQloo({
        entityByImdb: async () => { if (n++ === 0) throw new Error("boom"); return ref("q1", "movie", 2024); },
      });
      await expect(resolveTitle(sql, qloo, key, NOW)).rejects.toThrow("boom");
      expect(await resolveTitle(sql, qloo, key, NOW)).toEqual({ entityId: "q1", method: "imdb" });
    });
  });

  describe("concurrency", () => {
    it("shares one resolution between concurrent calls for the same key", async () => {
      const { sql, upserts } = fakeSql({ title_ratings: [{ imdb_id: "tt1" }] });
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const { qloo, entityByImdb } = fakeQloo({ entityByImdb: async () => { await gate; return ref("q1", "movie", 2024); } });
      const a = resolveTitle(sql, qloo, key, NOW);
      const b = resolveTitle(sql, qloo, { ...key }, NOW);
      release();
      expect(await Promise.all([a, b])).toEqual([{ entityId: "q1", method: "imdb" }, { entityId: "q1", method: "imdb" }]);
      expect(entityByImdb).toHaveBeenCalledTimes(1);
      expect(upserts).toHaveLength(1);
    });

    it("does not share between different keys, including the same id as movie and tv", async () => {
      const { sql } = fakeSql({ title_ratings: [{ imdb_id: "tt1" }] });
      const { qloo, entityByImdb } = fakeQloo({ entityByImdb: async () => ref("q1", "movie", 2024) });
      await Promise.all([
        resolveTitle(sql, qloo, { tmdbId: 9, mediaType: "movie" }, NOW),
        resolveTitle(sql, qloo, { tmdbId: 9, mediaType: "tv" }, NOW),
        resolveTitle(sql, qloo, { tmdbId: 10, mediaType: "movie" }, NOW),
      ]);
      expect(entityByImdb).toHaveBeenCalledTimes(3);
    });
  });
});

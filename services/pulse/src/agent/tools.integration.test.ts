import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildTools, type AgentToolDeps } from "./tools.js";
import { createFixtureClient } from "../qloo/fixtures.js";

// Real-database check of the two statements the agent writes itself
// (search_releases and titles_shot_in): LIKE escaping, de-duplication across
// the two release tables, the join to title_locations, and the limits. See
// resolve.integration.test.ts for how to run. Fake TMDB ids start at
// 999400001 and every row is deleted afterwards.
const url = process.env.PULSE_TEST_DATABASE_URL;
const BASE = 999_400_000;
const LAST = BASE + 200;

describe.skipIf(!url)("agent SQL tools against Postgres", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 3 });
  const cleanup = async () => {
    await sql`DELETE FROM title_locations WHERE tmdb_id BETWEEN ${BASE} AND ${LAST}`;
    await sql`DELETE FROM release_items WHERE tmdb_id BETWEEN ${BASE} AND ${LAST}`;
    await sql`DELETE FROM calendar_entries WHERE tmdb_id BETWEEN ${BASE} AND ${LAST} OR title = 'Zzqx Frobnicate No Id'`;
  };
  const release = (id: number, title: string, mediaType: "movie" | "tv" = "movie", window = "out_now", section = "english", date = "2026-10-22", providers: string[] = ["Netflix"]) => sql`
    INSERT INTO release_items (tmdb_id, media_type, title, language, release_date, tmdb_url, providers, section, window_kind, window_start, window_end, generated_at)
    VALUES (${id}, ${mediaType}, ${title}, 'en', ${date}::date, 'https://example.test/x', ${providers}, ${section}, ${window}, '2026-10-01', '2026-11-30', now())`;
  const calendar = (id: number | null, title: string, entryType = "Movie", mediaType: string | null = null, date = "2026-10-25") => sql`
    INSERT INTO calendar_entries (release_date, title, entry_type, tmdb_id, media_type, platform_or_distributor)
    VALUES (${date}::date, ${title}, ${entryType}, ${id}, ${mediaType}, 'PVR')`;
  const location = (id: number, citySlug: string, kind: "filmed" | "set", source: string | null, landmark: string | null, mediaType = "movie") => sql`
    INSERT INTO title_locations (tmdb_id, media_type, city_slug, kind, source, landmark_label) VALUES (${id}, ${mediaType}, ${citySlug}, ${kind}, ${source}, ${landmark})`;

  const deps = (): AgentToolDeps => ({
    sql: sql as unknown as AgentToolDeps["sql"],
    qloo: createFixtureClient(),
    resolve: async () => ({ entityId: null, reason: "not_in_qloo" as const }),
    header: async () => null,
    isKnown: async () => true,
    enqueueWarm: () => {},
  });
  const tool = async (name: string) => (await buildTools(deps())).find((t) => t.spec.function.name === name)!;
  const search = async (query: string) => ((await (await tool("search_releases")).run({ query })) as { results: { tmdbId: number; mediaType: string; title: string; platform: string | null; date: string | null }[] }).results;

  beforeAll(cleanup);
  afterAll(async () => { await cleanup(); await sql.end(); });

  it("matches case-insensitively as a substring, one row per title across both tables", async () => {
    await release(BASE + 1, "Zzqx Frobnicate Returns");
    await release(BASE + 1, "Zzqx Frobnicate Returns", "movie", "coming_up", "popular"); // the same title in another window
    await calendar(BASE + 1, "Zzqx Frobnicate Returns", "Movie", "movie", "2026-10-30"); // and in the calendar
    await calendar(BASE + 2, "ZZQX FROBNICATE: THE SHOW", "Show"); // media type derived from entry_type
    await calendar(null, "Zzqx Frobnicate No Id"); // cannot be briefed, so not offered
    const hits = await search("zzqx frobnicate");
    expect(hits.map((h) => `${h.tmdbId}:${h.mediaType}`).sort()).toEqual([`${BASE + 1}:movie`, `${BASE + 2}:tv`]);
    expect(hits.find((h) => h.tmdbId === BASE + 1)!.date).toBe("2026-10-30"); // the latest of its rows
    expect(hits.find((h) => h.tmdbId === BASE + 1)).toMatchObject({ title: "Zzqx Frobnicate Returns" });
  });

  it("puts an exact title first", async () => {
    await release(BASE + 3, "Qwvk");
    await release(BASE + 4, "Qwvk Part Two", "movie", "out_now", "english", "2026-12-01");
    const hits = await search("QWVK");
    expect(hits.map((h) => h.tmdbId)).toEqual([BASE + 3, BASE + 4]);
  });

  describe("LIKE wildcards and the escape character in the query match literally", () => {
    beforeAll(async () => {
      await release(BASE + 10, "Wxyz 100% Pure");
      await release(BASE + 11, "Wxyz 100 Percent");
      await release(BASE + 12, "Wxyz a_b");
      await release(BASE + 13, "Wxyz axb");
      await release(BASE + 14, "Wxyz back\\slash");
      await release(BASE + 15, "Wxyz backXslash");
    });
    it("% is a percent sign, not 'anything'", async () => {
      expect((await search("Wxyz 100%")).map((h) => h.tmdbId)).toEqual([BASE + 10]);
    });
    it("_ is an underscore, not 'any one character'", async () => {
      expect((await search("Wxyz a_b")).map((h) => h.tmdbId)).toEqual([BASE + 12]);
    });
    it("\\ is a backslash", async () => {
      expect((await search("back\\slash")).map((h) => h.tmdbId)).toEqual([BASE + 14]);
    });
    it("a lone % or _ matches only titles that contain one", async () => {
      const pct = (await search("%")).map((h) => h.tmdbId);
      expect(pct).toContain(BASE + 10);
      expect(pct).not.toContain(BASE + 11);
      const us = (await search("_")).map((h) => h.tmdbId);
      expect(us).toContain(BASE + 12);
      expect(us).not.toContain(BASE + 13);
    });
  });

  it("returns at most 10, and a quote in the query is only text", async () => {
    for (let i = 0; i < 14; i++) await release(BASE + 60 + i, `Plmn Bulk ${i}`);
    expect(await search("plmn bulk")).toHaveLength(10);
    expect(await search("'; DROP TABLE release_items; --")).toEqual([]);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM release_items WHERE tmdb_id BETWEEN ${BASE} AND ${LAST}`;
    expect(n).toBeGreaterThan(0); // the table is still there
  });

  describe("titles_shot_in", () => {
    const shot = async (city: string) => (await (await tool("titles_shot_in")).run({ city })) as { titles: { tmdbId: number; title: string; kind: string; landmark: string | null; releaseDate: string | null }[]; note?: string };
    beforeAll(async () => {
      await release(BASE + 30, "Shot Here One");
      await release(BASE + 31, "Shot Here Two");
      await calendar(BASE + 32, "Shot Here Calendar", "Movie", "movie");
      await location(BASE + 30, "delhi", "filmed", "both", "Chandni Chowk");
      await location(BASE + 30, "delhi", "set", "wikipedia", null);
      await location(BASE + 31, "delhi", "set", "wikidata", null);
      await location(BASE + 32, "delhi", "filmed", "wikidata", "India Gate");
      await location(BASE + 33, "delhi", "filmed", "wikidata", null); // not a title Spotlight knows: no release row
      await location(BASE + 31, "mumbai", "filmed", "both", "Gateway of India");
      await location(BASE + 34, "delhi", "filmed", null, "No Source"); // no attribution: skipped
      await release(BASE + 34, "Shot Here No Source");
      await location(BASE + 35, "delhi", "filmed", "both", "Wrong Type Landmark", "tv"); // same id, but only known as a movie
      await release(BASE + 35, "Shot Here Movie Only");
    });
    it("lists known titles shot or set in the city, with kind and landmark, landmarks first", async () => {
      const out = await shot("delhi");
      const mine = out.titles.filter((t) => t.tmdbId >= BASE);
      expect(mine.map((t) => `${t.tmdbId}:${t.kind}:${t.landmark ?? "-"}`)).toEqual([
        `${BASE + 32}:filmed:India Gate`,
        `${BASE + 30}:filmed:Chandni Chowk`,
        `${BASE + 30}:set:-`,
        `${BASE + 31}:set:-`,
      ]);
      expect(mine.find((t) => t.tmdbId === BASE + 32)).toMatchObject({ title: "Shot Here Calendar", releaseDate: "2026-10-25" });
    });
    it("does not leak another city's titles", async () => {
      const out = await shot("mumbai");
      expect(out.titles.filter((t) => t.tmdbId >= BASE).map((t) => t.tmdbId)).toEqual([BASE + 31]);
    });
    it("is an honest empty list, with a note, when a city has none", async () => {
      await sql`DELETE FROM title_locations WHERE tmdb_id BETWEEN ${BASE} AND ${LAST}`;
      const out = await shot("bengaluru");
      expect(out.titles.filter((t) => t.tmdbId >= BASE)).toEqual([]);
      if (out.titles.length === 0) expect(out.note).toMatch(/no title/i);
    });
    it("is capped at 20", async () => {
      for (let i = 0; i < 25; i++) { await release(BASE + 100 + i, `Shot Cap ${i}`); await location(BASE + 100 + i, "delhi", "filmed", "both", null); }
      const out = await shot("delhi");
      expect(out.titles.length).toBeLessThanOrEqual(20);
    });
  });
});

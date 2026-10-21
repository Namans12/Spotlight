import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import type { QlooClient } from "./qloo/client.js";
import { resolveTitle } from "./resolve.js";

vi.mock("../../../lib/omdb.js", () => ({ resolveOmdbLookup: vi.fn(async () => null) }));

// Runs only against a real, migrated database:
//   PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test npm --prefix services/pulse test
// It uses ids far above any real TMDB id and deletes its rows afterwards.
const url = process.env.PULSE_TEST_DATABASE_URL;
const HIT = 990000001;
const MISS = 990000002;

describe.skipIf(!url)("resolveTitle against Postgres", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 2 });
  const cleanup = async () => {
    await sql`DELETE FROM qloo_entities WHERE tmdb_id IN (${HIT}, ${MISS})`;
    await sql`DELETE FROM title_ratings WHERE tmdb_id IN (${HIT}, ${MISS})`;
  };
  beforeAll(async () => {
    await cleanup();
    await sql`INSERT INTO title_ratings (tmdb_id, media_type, imdb_id) VALUES (${HIT}, 'movie', 'tt9900001'), (${MISS}, 'movie', 'tt9900002')`;
  });
  afterAll(async () => {
    await cleanup();
    await sql.end();
  });

  const stub = () => ({
    entityByImdb: vi.fn(async (id: string) => (id === "tt9900001" ? { entityId: "q-hit", name: "Hit", type: "movie" as const, year: 2024 } : null)),
    searchTitles: vi.fn(async () => []),
  });

  it("writes a hit, then serves it from the cache", async () => {
    const s = stub();
    const qloo = s as unknown as QlooClient;
    expect(await resolveTitle(sql, qloo, { tmdbId: HIT, mediaType: "movie" })).toEqual({ entityId: "q-hit", method: "imdb" });
    const [row] = await sql`SELECT * FROM qloo_entities WHERE tmdb_id = ${HIT} AND media_type = 'movie'`;
    expect(row).toMatchObject({ imdb_id: "tt9900001", qloo_entity_id: "q-hit", method: "imdb", not_found: false });
    expect(await resolveTitle(sql, qloo, { tmdbId: HIT, mediaType: "movie" })).toEqual({ entityId: "q-hit", method: "imdb" });
    expect(s.entityByImdb).toHaveBeenCalledTimes(1);
  });

  it("stores a miss as not_found, does not re-ask inside 3 days, retries after", async () => {
    const s = stub();
    const qloo = s as unknown as QlooClient;
    const key = { tmdbId: MISS, mediaType: "movie" as const };
    const t0 = new Date();
    expect(await resolveTitle(sql, qloo, key, t0)).toEqual({ entityId: null, reason: "no_imdb_and_no_match" });
    const [row] = await sql`SELECT * FROM qloo_entities WHERE tmdb_id = ${MISS} AND media_type = 'movie'`;
    expect(row).toMatchObject({ imdb_id: "tt9900002", qloo_entity_id: null, method: null, not_found: true });
    expect(s.entityByImdb).toHaveBeenCalledTimes(1);

    const in2Days = new Date(t0.getTime() + 2 * 86_400_000);
    expect(await resolveTitle(sql, qloo, key, in2Days)).toEqual({ entityId: null, reason: "not_in_qloo" });
    expect(s.entityByImdb).toHaveBeenCalledTimes(1);

    const in4Days = new Date(t0.getTime() + 4 * 86_400_000);
    await resolveTitle(sql, qloo, key, in4Days);
    expect(s.entityByImdb).toHaveBeenCalledTimes(2);
    const rows = await sql`SELECT count(*)::int AS n FROM qloo_entities WHERE tmdb_id = ${MISS}`;
    expect(rows[0].n).toBe(1); // upsert, not a second row
  });
});

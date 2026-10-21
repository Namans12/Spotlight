import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { isKnownTitle } from "./titles.js";

// Real-database check of the known-title gate against each table it reads
// (see resolve.integration.test.ts for how to run). Ids are far above real TMDB ids.
const url = process.env.PULSE_TEST_DATABASE_URL;
const IDS = [990000011, 990000012, 990000013, 990000014, 990000015, 990000016];
const [REL, CAL_MEDIA, CAL_NULL_SHOW, QLOO_HIT, QLOO_MISS, NOWHERE] = IDS;

describe.skipIf(!url)("isKnownTitle against Postgres", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 2 });
  const cleanup = async () => {
    await sql`DELETE FROM release_items WHERE tmdb_id = ANY(${IDS})`;
    await sql`DELETE FROM calendar_entries WHERE tmdb_id = ANY(${IDS})`;
    await sql`DELETE FROM qloo_entities WHERE tmdb_id = ANY(${IDS})`;
  };
  beforeAll(async () => {
    await cleanup();
    await sql`INSERT INTO release_items (tmdb_id, media_type, title, language, release_date, tmdb_url, section, window_kind, window_start, window_end, generated_at)
      VALUES (${REL}, 'movie', 'Pulse Test Rel', 'en', '2026-12-12', 'https://example.invalid', 'english', 'coming_up', '2026-12-01', '2026-12-31', now())`;
    await sql`INSERT INTO calendar_entries (release_date, title, entry_type, tmdb_id, media_type)
      VALUES ('2026-12-12', 'Pulse Test Cal A', 'movie', ${CAL_MEDIA}, 'movie'), ('2026-12-12', 'Pulse Test Cal B', 'show', ${CAL_NULL_SHOW}, NULL)`;
    await sql`INSERT INTO qloo_entities (tmdb_id, media_type, qloo_entity_id, method, not_found)
      VALUES (${QLOO_HIT}, 'movie', 'q-hit', 'imdb', false), (${QLOO_MISS}, 'movie', NULL, NULL, true)`;
  });
  afterAll(async () => { await cleanup(); await sql.end(); });

  it("knows a title from each of the three tables", async () => {
    expect(await isKnownTitle(sql, { tmdbId: REL, mediaType: "movie" })).toBe(true);
    expect(await isKnownTitle(sql, { tmdbId: CAL_MEDIA, mediaType: "movie" })).toBe(true);
    expect(await isKnownTitle(sql, { tmdbId: CAL_NULL_SHOW, mediaType: "tv" })).toBe(true); // media_type NULL, derived from entry_type
    expect(await isKnownTitle(sql, { tmdbId: QLOO_HIT, mediaType: "movie" })).toBe(true);
  });

  it("does not know a cached miss, the wrong media type, or an unknown id", async () => {
    expect(await isKnownTitle(sql, { tmdbId: QLOO_MISS, mediaType: "movie" })).toBe(false);
    expect(await isKnownTitle(sql, { tmdbId: REL, mediaType: "tv" })).toBe(false);
    expect(await isKnownTitle(sql, { tmdbId: CAL_NULL_SHOW, mediaType: "movie" })).toBe(false);
    expect(await isKnownTitle(sql, { tmdbId: NOWHERE, mediaType: "movie" })).toBe(false);
  });
});

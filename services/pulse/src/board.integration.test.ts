import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { buildBoard, listCandidates } from "./board.js";
import { getCity } from "./cities.js";

// Runs only against a real, migrated database (see resolve.integration.test.ts).
// It checks what the fakes cannot: that the batch statements (ANY over BIGINT
// ids, MAX over NUMERIC) and lib/calendarDb.ts's merge behave on real Postgres.
// Ids are far above any real TMDB id and every row is deleted afterwards.
const url = process.env.PULSE_TEST_DATABASE_URL;
const [STREAM, THEATRICAL_DUP, CAL_ONLY, FILMED, RESOLVED, MISSED] = [990000101, 990000102, 990000103, 990000104, 990000105, 990000106];
const IDS = [STREAM, THEATRICAL_DUP, CAL_ONLY, FILMED, RESOLVED, MISSED];
const delhi = getCity("delhi")!;
const TODAY = new Date("2026-10-21T06:00:00Z");

describe.skipIf(!url)("board against Postgres", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 2 });
  const cleanup = async () => {
    await sql`DELETE FROM release_items WHERE tmdb_id = ANY(${IDS})`;
    await sql`DELETE FROM calendar_entries WHERE tmdb_id = ANY(${IDS})`;
    await sql`DELETE FROM title_locations WHERE tmdb_id = ANY(${IDS})`;
    await sql`DELETE FROM qloo_entities WHERE tmdb_id = ANY(${IDS})`;
    await sql`DELETE FROM qloo_evidence WHERE entity_id = 'q-board-int'`;
  };
  const release = (id: number, title: string, date: string, popularity: number) => sql`
    INSERT INTO release_items (tmdb_id, media_type, title, language, release_date, popularity, tmdb_url, section, window_kind, window_start, window_end, generated_at, providers)
    VALUES (${id}, 'movie', ${title}, 'en', ${date}, ${popularity}, 'https://example.invalid', 'english', 'coming_up', '2026-10-01', '2026-11-30', now(), ARRAY['Netflix'])`;

  beforeAll(async () => {
    await cleanup();
    await release(STREAM, "Board Int Streaming", "2026-10-28", 50.5);
    await release(FILMED, "Board Int Filmed", "2026-11-02", 20); // next month: the window spans two
    await release(RESOLVED, "Board Int Resolved", "2026-10-22", 10);
    await release(MISSED, "Board Int Missed", "2026-10-22", 5);
    await sql`INSERT INTO calendar_entries (release_date, title, entry_type, platform_or_distributor, tmdb_id, media_type, is_theatrical)
      VALUES ('2026-10-24', 'Board Int Theatrical Dup', 'Movie', 'PVR', ${STREAM}, 'movie', true),
             ('2026-10-24', 'Board Int Cal Only', 'Movie', 'PVR', ${CAL_ONLY}, 'movie', true),
             ('2026-10-17', 'Board Int Too Early', 'Movie', 'PVR', ${THEATRICAL_DUP}, 'movie', true)`;
    await sql`INSERT INTO title_locations (tmdb_id, media_type, city_slug, kind, source, landmark_label)
      VALUES (${FILMED}, 'movie', 'delhi', 'set', 'wikipedia', NULL), (${FILMED}, 'movie', 'delhi', 'filmed', 'both', 'Chandni Chowk'),
             (${FILMED}, 'movie', 'mumbai', 'filmed', 'both', 'Elsewhere')`;
    await sql`INSERT INTO qloo_entities (tmdb_id, media_type, qloo_entity_id, method, not_found, resolved_at)
      VALUES (${RESOLVED}, 'movie', 'q-board-int', 'imdb', false, now()), (${MISSED}, 'movie', NULL, NULL, true, now())`;
    await sql`INSERT INTO qloo_evidence (entity_id, city_slug, kind, params, status, payload, fetched_at)
      VALUES ('q-board-int', 'delhi', 'heatmap', '{}'::jsonb, 'ok', ${JSON.stringify({ status: "ok", data: [{ lat: 28.55, lon: 77.2, geohash: "x", affinity: 0.7, popularity: 0.1 }], provenance: [] })}::text::jsonb, now())`;
  });
  afterAll(async () => { await cleanup(); await sql.end(); });

  it("lists the window's releases across both months, deduped, with popularity and hooks", async () => {
    const out = (await listCandidates(sql, delhi, TODAY)).filter((c) => IDS.includes(c.card.tmdbId));
    expect(out.map((c) => c.card.tmdbId)).toEqual([STREAM, FILMED, RESOLVED, MISSED, CAL_ONLY]);
    const stream = out[0];
    expect(stream).toMatchObject({ popularity: 50.5, daysAhead: 7 });
    expect(stream.card).toMatchObject({ title: "Board Int Streaming", kind: "streaming", platform: "Netflix", releaseDate: "2026-10-28" });
    expect(out[1].hook).toEqual({ kind: "filmed", placeName: "Delhi", landmark: "Chandni Chowk", source: "both" });
    expect(out[4]).toMatchObject({ popularity: 0, card: { kind: "theatrical", mediaType: "movie" } });
  });

  it("buckets by what the cache holds", async () => {
    const enqueueWarm = vi.fn();
    const board = await buildBoard({ sql, enqueueWarm }, delhi, "cafe", TODAY);
    const mine = (cards: { tmdbId: number }[]) => cards.filter((c) => IDS.includes(c.tmdbId)).map((c) => c.tmdbId);
    expect(mine(board.ranked)).toEqual([RESOLVED]);
    expect(mine(board.unresolved)).toEqual([MISSED]);
    expect(mine(board.pending).sort()).toEqual([STREAM, FILMED, CAL_ONLY].sort());
    expect(board.ranked.find((c) => c.tmdbId === RESOLVED)!.why).toBe("Release order · no comparable local ranking");
  });
});

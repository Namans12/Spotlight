import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { getCity } from "./cities.js";
import { getLocationsForTitle } from "./db/locations.js";
import { buildPlanNight } from "./planNight.js";
import { createFixtureClient } from "./qloo/fixtures.js";

// Runs only against a real, migrated database (see resolve.integration.test.ts).
// It checks what a fake cannot: the title_locations read against the real
// columns and CHECK constraints, and that plan-night writes `places_open` and
// `artists` rows without ever creating a `places` row.
const url = process.env.PULSE_TEST_DATABASE_URL;
const TMDB = 990000014;
const ENTITY = "pulse-test-entity-plan-night";

describe.skipIf(!url)("title locations and plan-night against Postgres", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 2 });
  const cleanup = async () => {
    await sql`DELETE FROM title_locations WHERE tmdb_id = ${TMDB}`;
    await sql`DELETE FROM qloo_evidence WHERE entity_id = ${ENTITY}`;
  };
  beforeAll(async () => {
    await cleanup();
    await sql`INSERT INTO title_locations (tmdb_id, media_type, city_slug, kind, source, landmark_label)
      VALUES (${TMDB}, 'movie', 'delhi', 'filmed', 'both', 'Chandni Chowk'),
             (${TMDB}, 'movie', 'new-york', 'set', 'wikipedia', NULL),
             (${TMDB}, 'movie', 'mumbai', 'set', NULL, NULL),
             (${TMDB}, 'tv', 'london', 'filmed', 'wikidata', NULL)`;
  });
  afterAll(async () => { await cleanup(); await sql.end(); });

  it("reads one title's cities for its media type, skipping unattributed rows", async () => {
    const rows = await getLocationsForTitle(sql, { tmdbId: TMDB, mediaType: "movie" });
    expect(rows).toEqual([
      { citySlug: "delhi", kind: "filmed", source: "both", landmark: "Chandni Chowk" },
      { citySlug: "new-york", kind: "set", source: "wikipedia", landmark: null },
    ]);
    expect(await getLocationsForTitle(sql, { tmdbId: TMDB + 1, mediaType: "movie" })).toEqual([]);
  });

  it("writes places_open and artists rows, and no places row", async () => {
    const qloo = createFixtureClient();
    const out = await buildPlanNight(
      { sql, qloo, resolve: async () => ({ entityId: ENTITY, method: "imdb" }), header: async () => ({ title: "T", posterUrl: null, releaseDate: null }) },
      { city: getCity("delhi")!, key: { tmdbId: TMDB, mediaType: "movie" } },
    );
    expect(out.places.status).toBe("ok");
    expect(out.places.data!.length).toBeLessThanOrEqual(6);
    expect(out.artists.data!.length).toBeLessThanOrEqual(5);
    const rows = await sql`SELECT city_slug, kind, status FROM qloo_evidence WHERE entity_id = ${ENTITY} ORDER BY kind`;
    expect(rows.map((r) => `${r.kind}:${r.city_slug}:${r.status}`)).toEqual(["artists::ok", "places_open:delhi:ok"]);
  });
});

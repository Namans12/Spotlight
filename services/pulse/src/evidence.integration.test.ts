import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import type { EvidenceSection } from "../../../shared/types/pulse.js";
import { getCity } from "./cities.js";
import { getNeighbourhoods, getTitleLocations } from "./db/locations.js";
import { getEvidence, peekEvidence } from "./evidence.js";

// Runs only against a real, migrated database (see resolve.integration.test.ts).
// It exists because the jsonb round trip and ON CONFLICT cannot be checked by
// a fake: a payload stored as a JSON *string* would pass every fake-based test.
const url = process.env.PULSE_TEST_DATABASE_URL;
const ENTITY = "pulse-test-entity-evidence";
const TMDB = 990000003;
const CITY = "pulse-test-city";

describe.skipIf(!url)("evidence cache and locations against Postgres", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 2 });
  const delhi = getCity("delhi")!;
  const cleanup = async () => {
    await sql`DELETE FROM qloo_evidence WHERE entity_id = ${ENTITY}`;
    await sql`DELETE FROM title_locations WHERE tmdb_id = ${TMDB}`;
    await sql`DELETE FROM neighbourhoods WHERE city_slug = ${CITY}`;
  };
  beforeAll(cleanup);
  afterAll(async () => { await cleanup(); await sql.end(); });

  const section = (data: string[], status: EvidenceSection<string[]>["status"] = "ok"): EvidenceSection<string[]> =>
    ({ status, data, provenance: [{ source: "qloo", call: "c", params: { entity_id: ENTITY }, limits: "l" }], note: "n" });

  it("stores the section as a jsonb object, serves it back, and upserts in place", async () => {
    const t0 = new Date();
    await getEvidence(sql, "places", ENTITY, delhi, async () => section(["a"]), t0);
    const [row] = await sql`SELECT params, status, payload, jsonb_typeof(payload) AS t FROM qloo_evidence WHERE entity_id = ${ENTITY}`;
    expect(row.t).toBe("object");
    expect(row.status).toBe("ok");
    expect(row.params).toEqual({ entity_id: ENTITY });
    expect(row.payload).toEqual(section(["a"]));

    const fetch = vi.fn(async () => section(["b"]));
    expect((await getEvidence(sql, "places", ENTITY, delhi, fetch, t0)).data).toEqual(["a"]);
    expect(fetch).not.toHaveBeenCalled();
    expect((await peekEvidence(sql, "places", ENTITY, delhi, t0))?.data).toEqual(["a"]);

    const t5 = new Date(t0.getTime() + 5 * 86_400_000);
    expect(await peekEvidence(sql, "places", ENTITY, delhi, t5)).toBeNull();
    expect((await getEvidence(sql, "places", ENTITY, delhi, fetch, t5)).data).toEqual(["b"]);
    const rows = await sql`SELECT payload FROM qloo_evidence WHERE entity_id = ${ENTITY}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.data).toEqual(["b"]);
  });

  it("keeps a city-independent kind under city_slug '' and never stores an error", async () => {
    await getEvidence(sql, "demographics", ENTITY, null, async () => section(["d"]));
    await getEvidence(sql, "artists", ENTITY, null, async () => ({ status: "error", data: null, provenance: [] }));
    const rows = await sql`SELECT city_slug, kind FROM qloo_evidence WHERE entity_id = ${ENTITY} ORDER BY kind`;
    expect(rows.map((r) => `${r.kind}:${r.city_slug}`)).toEqual(["demographics:", "places:delhi"]);
  });

  it("reads title_locations and neighbourhoods", async () => {
    await sql`INSERT INTO title_locations (tmdb_id, media_type, city_slug, kind, source, landmark_label)
      VALUES (${TMDB}, 'movie', 'delhi', 'filmed', 'both', 'India Gate'), (${TMDB}, 'movie', 'delhi', 'set', NULL, NULL)`;
    expect(await getTitleLocations(sql, { tmdbId: TMDB, mediaType: "movie" }, "delhi")).toEqual([
      { kind: "filmed", source: "both", landmark: "India Gate" },
    ]);
    expect(await getTitleLocations(sql, { tmdbId: TMDB, mediaType: "tv" }, "delhi")).toEqual([]);
    await sql`INSERT INTO neighbourhoods (city_slug, name, lat, lon) VALUES (${CITY}, 'Nowhere', 1.5, 2.5), (${CITY}, 'Unplaced', NULL, NULL)`;
    expect(await getNeighbourhoods(sql, CITY)).toEqual([{ name: "Nowhere", lat: 1.5, lon: 2.5 }]);
  });
});

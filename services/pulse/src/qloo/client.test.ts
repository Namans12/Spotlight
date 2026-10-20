import { describe, expect, it } from "vitest";
import type { PulseConfig } from "../config.js";
import { getCity } from "../cities.js";
import { createHarnessQlooClient, createQlooClient, mapHarnessResult } from "./client.js";
import type { HarnessTransport } from "./harness.js";

const baseConfig: PulseConfig = {
  port: 8787,
  allowedOrigins: [],
  databaseUrl: "postgres://fake",
  qlooFixtures: false,
  groqApiKey: null,
  groqBaseUrl: "https://example.invalid",
  groqModel: "m",
  warmSecret: null,
  sessionDailyChat: 30,
  globalDailyLlm: 800,
};
const delhi = getCity("delhi")!;

describe("mapHarnessResult", () => {
  it("maps a harness ok result into an EvidenceSection with provenance", () => {
    const s = mapHarnessResult({ status: "ok", results: [{ name: "A" }], result_count: 1 }, "recommend", { target_type: "place" }, r => r.length);
    expect(s).toEqual({ status: "ok", data: 1, provenance: [{ source: "qloo", call: "recommend", params: { target_type: "place" }, limits: expect.any(String) }] });
  });

  it("passes empty and error through without inventing data", () => {
    expect(mapHarnessResult({ status: "empty", results: [] }, "recommend", {}, r => r).data).toBeNull();
    expect(mapHarnessResult({ status: "error", error: { code: "x", retryable: false } }, "recommend", {}, r => r).status).toBe("error");
  });

  it("keeps the harness summary and recovery text as a note on non-ok results", () => {
    const s = mapHarnessResult(
      { status: "needs_input", summary: "Choose the intended Qloo entity.", results: [] },
      "recommend", {}, r => r,
    );
    expect(s.status).toBe("needs_input");
    expect(s.data).toBeNull();
    expect(s.note).toContain("Choose the intended Qloo entity.");

    const e = mapHarnessResult(
      { status: "error", summary: "Qloo failed.", results: [], error: { code: "QLOO_AUTH", retryable: false, recovery: "Set QLOO_API_KEY." } },
      "recommend", {}, r => r,
    );
    expect(e.note).toContain("Qloo failed.");
    expect(e.note).toContain("Set QLOO_API_KEY.");
  });

  it("reports an ok result with no rows as empty rather than ok-with-nothing", () => {
    const s = mapHarnessResult({ status: "ok", results: [], result_count: 0 }, "recommend", {}, r => r);
    expect(s.status).toBe("empty");
    expect(s.data).toBeNull();
  });

  it("keeps the data of partial and degraded results but flags the status", () => {
    const s = mapHarnessResult({ status: "partial", summary: "Some inputs dropped.", results: [{ a: 1 }] }, "recommend", {}, r => r.length);
    expect(s.status).toBe("partial");
    expect(s.data).toBe(1);
    expect(s.note).toContain("Some inputs dropped.");
  });

  it("turns a result it cannot read into an error section instead of throwing", () => {
    expect(mapHarnessResult("not an envelope", "recommend", {}, r => r).status).toBe("error");
    const s = mapHarnessResult({ status: "ok", results: [{}] }, "where_popular", {}, () => { throw new Error("cell has no lat"); });
    expect(s.status).toBe("error");
    expect(s.data).toBeNull();
    expect(s.note).toContain("cell has no lat");
  });
});

describe("the fixture client", () => {
  it("returns shaped, synthetic data for every method", async () => {
    const q = createQlooClient({ ...baseConfig, qlooFixtures: true });
    expect((await q.heatmap("fx-1", delhi)).status).toBe("ok");
    expect((await q.demographics("fx-1")).data?.age["25_to_29"]).toEqual(expect.any(Number));

    const ref = await q.entityByImdb("tt0000001");
    expect(ref?.entityId).toMatch(/^fx-/);
    expect((await q.searchTitles("Anything", "movie")).every(r => r.entityId.startsWith("fx-"))).toBe(true);
    expect((await q.places("fx-1", delhi, ["fx-tag-1"])).data?.[0]?.name).toMatch(/^Fixture /);
    expect((await q.placeTags("fx-1", delhi)).status).toBe("ok");
    expect((await q.artists("fx-1")).status).toBe("ok");
    expect((await q.brands("fx-1")).status).toBe("ok");
    expect((await q.trends("fx-1")).data?.[0]?.percentile).toEqual(expect.any(Number));
    expect((await q.findTags("pizza", "place")).length).toBeGreaterThan(0);
    expect((await q.listTools()).length).toBeGreaterThan(0);
    expect(await q.callTool("qloo_fixture_echo", { a: 1 })).toMatchObject({ status: "ok" });
  });

  it("places heatmap cells within a few km of the requested city", async () => {
    const q = createQlooClient({ ...baseConfig, qlooFixtures: true });
    for (const slug of ["delhi", "london", "new-york"]) {
      const city = getCity(slug)!;
      const cells = (await q.heatmap("fx-1", city)).data!;
      expect(cells.length).toBeGreaterThan(5);
      for (const c of cells) {
        const km = Math.hypot((c.lat - city.lat) * 111, (c.lon - city.lon) * 111 * Math.cos((city.lat * Math.PI) / 180));
        expect(km).toBeLessThan(8);
        expect(c.geohash).toHaveLength(6);
      }
    }
  });

  it("marks every section as fixture data so it cannot pass for Qloo evidence", async () => {
    const q = createQlooClient({ ...baseConfig, qlooFixtures: true });
    const s = await q.heatmap("fx-1", delhi);
    expect(s.note).toMatch(/synthetic/i);
    expect(s.provenance[0]?.call).toMatch(/^fixture:/);
  });
});

// A scripted stand-in for the harness: it records every call and answers from
// a per-tool queue, so these tests pin what we send and how we read replies
// without a Qloo key or a child process.
function fakeTransport(replies: Record<string, unknown[]>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rest: { path: string; params: Record<string, string> }[] = [];
  const t: HarnessTransport = {
    async listTools() { return [{ name: "qloo_recommend", description: "d", inputSchema: {} }]; },
    async callTool(name, args) {
      calls.push({ name, args });
      const q = replies[name];
      if (!q || q.length === 0) throw new Error(`no scripted reply for ${name}`);
      return q.length > 1 ? q.shift() : q[0];
    },
    async getJson(path, params) {
      rest.push({ path, params });
      const q = replies[`GET ${path}`];
      if (!q || q.length === 0) throw new Error(`no scripted reply for GET ${path}`);
      return q.length > 1 ? q.shift() : q[0];
    },
    async close() {},
  };
  return { t, calls, rest };
}
const noSleep = async () => {};

describe("the harness-backed client", () => {
  it("asks where_popular for the city's heatmap using only the city's location query", async () => {
    const { t, calls } = fakeTransport({
      qloo_where_popular: [{
        status: "ok", result_count: 2,
        results: [
          { query: { affinity: 0.9, popularity: 0.2 }, location: { geohash: "ttnfv2", latitude: 28.61, longitude: 77.2 } },
          { query: { affinity: 0.5, popularity: 0.1 }, location: { geohash: "ttnfv3", latitude: 28.62, longitude: 77.21 } },
        ],
      }],
    });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.heatmap("ent-1", delhi);
    expect(calls).toEqual([{ name: "qloo_where_popular", args: { entity: "ent-1", within: "Delhi", limit: 20 } }]);
    expect(s.status).toBe("ok");
    expect(s.data).toEqual([
      { lat: 28.61, lon: 77.2, geohash: "ttnfv2", affinity: 0.9, popularity: 0.2 },
      { lat: 28.62, lon: 77.21, geohash: "ttnfv3", affinity: 0.5, popularity: 0.1 },
    ]);
    expect(s.provenance[0]?.limits).toMatch(/top cells only/);
  });

  it("reads the demographics skew and keeps the fixed not-a-percentage limit", async () => {
    const age = { "24_and_younger": 0.1, "25_to_29": 0.2, "30_to_34": 0.1, "35_to_44": -0.1, "45_to_54": -0.2, "55_and_older": -0.3 };
    const { t, calls } = fakeTransport({
      qloo_audience_demographics: [{ status: "ok", result_count: 1, results: [{ entity_id: "ent-1", query: { age, gender: { male: -0.1, female: 0.1 } } }] }],
    });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.demographics("ent-1");
    expect(calls[0]).toEqual({ name: "qloo_audience_demographics", args: { entity: "ent-1" } });
    expect(s.data).toEqual({ age, gender: { male: -0.1, female: 0.1 } });
    expect(s.provenance[0]?.limits).toBe("Global audience skew relative to average, not specific to this city; not a percentage.");
  });

  it("recommends venues filtered to the city and the supplied tag ids", async () => {
    const { t, calls } = fakeTransport({
      qloo_recommend: [{
        status: "ok", result_count: 1,
        results: [{ entity_id: "v-1", name: "Fixture Café 1", affinity: 0.7, properties: { address: "1 Test Road", price_level: 2 } }],
      }],
    });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.places("ent-1", delhi, ["urn:tag:genre:place:restaurant:pizza"]);
    expect(calls[0]).toEqual({
      name: "qloo_recommend",
      args: { target_type: "place", signals: ["ent-1"], filter_location: "Delhi", include_tags: ["urn:tag:genre:place:restaurant:pizza"], limit: 20, explain: false },
    });
    expect(s.data).toEqual([{ entityId: "v-1", name: "Fixture Café 1", address: "1 Test Road", lat: null, lon: null, priceLevel: 2, tags: [], affinity: 0.7 }]);
  });

  it("omits include_tags when none are given", async () => {
    const { t, calls } = fakeTransport({ qloo_recommend: [{ status: "empty", results: [] }] });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.places("ent-1", delhi, []);
    expect(calls[0]?.args).not.toHaveProperty("include_tags");
    expect(s.status).toBe("empty");
    expect(s.data).toBeNull();
  });

  it("derives place tags from the venues recommended for the city, and cites both calls", async () => {
    const { t, calls } = fakeTransport({
      qloo_recommend: [{ status: "ok", result_count: 2, results: [{ entity_id: "v-1", name: "A" }, { entity_id: "v-2", name: "B" }] }],
      qloo_entity_tags: [{ status: "ok", result_count: 1, results: [{ id: "urn:tag:x", name: "Fixture Tag", affinity: 0.4 }] }],
    });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.placeTags("ent-1", delhi);
    expect(calls.map(c => c.name)).toEqual(["qloo_recommend", "qloo_entity_tags"]);
    expect(calls[1]?.args).toMatchObject({ entities: ["v-1", "v-2"], entity_type: "place" });
    expect(s.data).toEqual([{ tagId: "urn:tag:x", name: "Fixture Tag", affinity: 0.4 }]);
    expect(s.provenance).toHaveLength(2);
  });

  it("returns the empty venue step as the section when there are no venues to tag", async () => {
    const { t, calls } = fakeTransport({ qloo_recommend: [{ status: "empty", results: [] }] });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.placeTags("ent-1", delhi);
    expect(calls).toHaveLength(1);
    expect(s.status).toBe("empty");
  });

  it("retries a rate-limited call and then succeeds", async () => {
    const waits: number[] = [];
    const rateLimited = { status: "error", results: [], error: { code: "QLOO_RATE_LIMIT", layer: "qloo", retryable: true, recovery: "wait" } };
    const { t, calls } = fakeTransport({
      qloo_recommend: [rateLimited, { status: "ok", result_count: 1, results: [{ entity_id: "a-1", name: "Fixture Artist 1", affinity: 0.3 }] }],
    });
    const q = createHarnessQlooClient(t, { sleep: async ms => { waits.push(ms); } });
    const s = await q.artists("ent-1");
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([3000]);
    expect(s.data).toEqual([{ entityId: "a-1", name: "Fixture Artist 1", affinity: 0.3 }]);
  });

  it("returns an error section, not a throw, when a call still fails after the backoffs", async () => {
    const rateLimited = { status: "error", results: [], error: { code: "QLOO_RATE_LIMIT", layer: "qloo", retryable: true, recovery: "wait" } };
    const { t, calls } = fakeTransport({ qloo_recommend: [rateLimited] });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.brands("ent-1");
    expect(calls).toHaveLength(3);
    expect(s.status).toBe("error");
    expect(s.data).toBeNull();
  });

  it("does not retry a non-retryable harness error", async () => {
    const auth = { status: "error", results: [], summary: "needs key", error: { code: "QLOO_AUTH", layer: "qloo", retryable: false, recovery: "Set QLOO_API_KEY." } };
    const { t, calls } = fakeTransport({ qloo_recommend: [auth] });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.brands("ent-1");
    expect(calls).toHaveLength(1);
    expect(s.status).toBe("error");
    expect(s.note).toContain("Set QLOO_API_KEY.");
  });

  it("looks up the entity type before asking for trends, since the tool requires it", async () => {
    const { t, calls } = fakeTransport({
      qloo_describe: [{ status: "ok", result_count: 1, results: [{ entity_id: "ent-1", name: "Fixture Title", type: "urn:entity:tv_show" }] }],
      qloo_trends: [{ status: "ok", series: [{ entity: {}, points: [{ date: "2026-10-01", query: { popularity_percentile: 0.8 } }] }], result_count: 1 }],
    });
    const q = createHarnessQlooClient(t, { sleep: noSleep, now: () => new Date("2026-10-21T00:00:00Z") });
    const s = await q.trends("ent-1");
    expect(calls[1]).toEqual({
      name: "qloo_trends",
      args: { entities: ["ent-1"], entity_type: "tv_show", start_date: "2026-07-23", end_date: "2026-10-21", limit: 20 },
    });
    expect(s.data).toEqual([{ date: "2026-10-01", percentile: 0.8 }]);
  });

  it("skips the type lookup for an entity it already resolved", async () => {
    const { t, calls, rest } = fakeTransport({
      "GET /entities": [{ results: [{ entity_id: "ent-9", name: "Fixture Film", type: "urn:entity:movie", properties: { release_year: 2024 } }] }],
      qloo_trends: [{ status: "empty", series: [], result_count: 0 }],
    });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    expect(await q.entityByImdb("tt0000009")).toEqual({ entityId: "ent-9", name: "Fixture Film", type: "movie", year: 2024 });
    expect(rest[0]).toEqual({ path: "/entities", params: { "external.imdb.ids": "tt0000009" } });
    await q.trends("ent-9");
    expect(calls.map(c => c.name)).toEqual(["qloo_trends"]);
    expect(calls[0]?.args).toMatchObject({ entity_type: "movie" });
  });

  it("finds tags and keeps only those under the requested parent type", async () => {
    const { t, calls } = fakeTransport({
      qloo_find_tags: [{
        status: "ok", result_count: 3,
        results: [
          { id: "urn:tag:genre:place:restaurant:pizza", name: "Pizza", type: "urn:tag:genre:place" },
          { id: "urn:tag:genre:media:pizza_film", name: "Pizza film", type: "urn:tag:genre:media" },
          { id: "urn:tag:category:place:italian_restaurant", name: "Italian", type: "urn:tag:category:place" },
        ],
      }],
    });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    expect(await q.findTags("pizza", "place")).toEqual([
      { tagId: "urn:tag:genre:place:restaurant:pizza", name: "Pizza" },
      { tagId: "urn:tag:category:place:italian_restaurant", name: "Italian" },
    ]);
    expect(calls[0]?.args).toEqual({ query: "pizza", limit: 20 });
  });

  it("returns null for an IMDb id Qloo does not know, and rejects an entity that names a different IMDb id", async () => {
    const { t } = fakeTransport({ "GET /entities": [{ results: [] }] });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    expect(await q.entityByImdb("tt0000001")).toBeNull();

    const wrong = fakeTransport({ "GET /entities": [{ results: [{ entity_id: "e", name: "X", type: "urn:entity:movie", properties: { external: { imdb: { id: "tt9999999" } } } }] }] });
    const q2 = createHarnessQlooClient(wrong.t, { sleep: noSleep });
    expect(await q2.entityByImdb("tt0000001")).toBeNull();
  });

  it("searches titles by type, newest data first as Qloo returns it", async () => {
    const { t, rest } = fakeTransport({
      "GET /search": [{ results: [
        { entity_id: "e1", name: "Fixture Show", type: "urn:entity:tv_show", properties: { release_year: 2020 } },
        { entity_id: "e2", name: "Fixture Show 2", types: ["urn:entity:tv_show"] },
      ] }],
    });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    expect(await q.searchTitles("Fixture Show", "tv_show")).toEqual([
      { entityId: "e1", name: "Fixture Show", type: "tv_show", year: 2020 },
      { entityId: "e2", name: "Fixture Show 2", type: "tv_show", year: null },
    ]);
    expect(rest[0]).toEqual({ path: "/search", params: { query: "Fixture Show", types: "urn:entity:tv_show", take: "5" } });
  });

  it("passes agent tool calls straight through, behind the limiter", async () => {
    const { t, calls } = fakeTransport({ qloo_describe: [{ status: "ok", results: [{ x: 1 }] }] });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    expect(await q.callTool("qloo_describe", { entity: "x" })).toEqual({ status: "ok", results: [{ x: 1 }] });
    expect(calls).toEqual([{ name: "qloo_describe", args: { entity: "x" } }]);
    expect((await q.listTools())[0]?.name).toBe("qloo_recommend");
  });
});

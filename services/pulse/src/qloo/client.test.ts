import { describe, expect, it, vi } from "vitest";
import type { PulseConfig } from "../config.js";
import { getCity } from "../cities.js";
import { getEvidence } from "../evidence.js";
import { fakeSql, newDb } from "../testing/fakes.js";
import { createHarnessQlooClient, createQlooClient, mapHarnessResult } from "./client.js";
import { RateLimitedError } from "./limiter.js";
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

  it("sends at most 10 include_tags, the harness maximum, and cites the same 10", async () => {
    const { t, calls } = fakeTransport({ qloo_recommend: [{ status: "ok", result_count: 1, results: [{ entity_id: "v-1", name: "Fixture Café 1" }] }] });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const twelve = Array.from({ length: 12 }, (_, i) => `urn:tag:fx:${i + 1}`);
    const s = await q.places("ent-1", delhi, twelve);
    expect(calls[0]?.args.include_tags).toEqual(twelve.slice(0, 10));
    expect(s.provenance[0]?.params.include_tags).toBe(twelve.slice(0, 10).join(","));
  });

  it("omits include_tags when none are given", async () => {
    const { t, calls } = fakeTransport({ qloo_recommend: [{ status: "empty", results: [] }] });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.places("ent-1", delhi, []);
    expect(calls[0]?.args).not.toHaveProperty("include_tags");
    expect(s.provenance[0]?.params).not.toHaveProperty("include_tags");
    expect(s.status).toBe("empty");
    expect(s.data).toBeNull();
  });

  it("derives place tags from the venues recommended for the city, and cites both calls", async () => {
    const { t, calls } = fakeTransport({
      qloo_recommend: [{ status: "ok", result_count: 2, results: [{ entity_id: "v-1", name: "A" }, { entity_id: "v-2", name: "B" }] }],
      qloo_entity_tags: [{ status: "ok", result_count: 1, results: [{ id: "urn:tag:genre:place:fx-1", name: "Fixture Tag", affinity: 0.4 }] }],
    });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.placeTags("ent-1", delhi);
    expect(calls.map(c => c.name)).toEqual(["qloo_recommend", "qloo_entity_tags"]);
    expect(calls[1]?.args).toMatchObject({ entities: ["v-1", "v-2"], entity_type: "place" });
    expect(s.data).toEqual([{ tagId: "urn:tag:genre:place:fx-1", name: "Fixture Tag", affinity: 0.4 }]);
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

  it("reports a hung or failed REST lookup as an error instead of hanging", async () => {
    const t: HarnessTransport = {
      ...fakeTransport({}).t,
      async getJson() { throw new DOMException("The operation timed out.", "TimeoutError"); },
    };
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    await expect(q.searchTitles("x", "movie")).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("turns an isError text reply from the harness into an error section carrying that text", async () => {
    const t: HarnessTransport = {
      ...fakeTransport({}).t,
      async callTool() { throw new Error("Invalid arguments for qloo_recommend"); },
    };
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.artists("ent-1");
    expect(s.status).toBe("error");
    expect(s.note).toContain("Invalid arguments for qloo_recommend");
  });

  it("an agent call whose signal is aborted while queued behind the limiter never reaches the harness", async () => {
    const started: string[] = [];
    const gates: (() => void)[] = [];
    const t: HarnessTransport = {
      ...fakeTransport({}).t,
      async callTool(name) { started.push(name); await new Promise<void>((r) => gates.push(r)); return { status: "ok", results: [] }; },
    };
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const running = [q.callTool("qloo_a", {}), q.callTool("qloo_b", {})]; // the limiter's two slots
    const ac = new AbortController();
    const queued = q.callTool("qloo_c", {}, { signal: ac.signal });
    await vi.waitFor(() => expect(started).toEqual(["qloo_a", "qloo_b"]));
    ac.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    gates.forEach((g) => g());
    await Promise.all(running);
    expect(started).toEqual(["qloo_a", "qloo_b"]); // qloo_c was never sent
  });

  it("passes agent tool calls straight through, behind the limiter", async () => {
    const { t, calls } = fakeTransport({ qloo_describe: [{ status: "ok", results: [{ x: 1 }] }] });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    expect(await q.callTool("qloo_describe", { entity: "x" })).toEqual({ status: "ok", results: [{ x: 1 }] });
    expect(calls).toEqual([{ name: "qloo_describe", args: { entity: "x" } }]);
    expect((await q.listTools())[0]?.name).toBe("qloo_recommend");
  });
});


// ---- live spike lock-in (2026-10-21) -------------------------------------

const BRAND_FOOD_TAG = "urn:tag:genre:brand:food_and_beverage";

describe("demographics on a title Qloo has no audience profile for (L2)", () => {
  it("explains an empty result honestly, and says nothing odd for an ok one", async () => {
    const { t } = fakeTransport({ qloo_audience_demographics: [{ status: "ok", result_count: 0, results: [] }] });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    const s = await q.demographics("ent-new");
    expect(s.status).toBe("empty");
    expect(s.data).toBeNull();
    expect(s.note).toBe("Qloo doesn't have an audience profile for this title yet \u2014 common for releases that haven't been out long.");
    expect(s.provenance[0]?.call).toBe("audience_demographics");

    const e = fakeTransport({ qloo_audience_demographics: [{ status: "empty", summary: "Nothing found.", results: [] }] });
    const s2 = await createHarnessQlooClient(e.t, { sleep: noSleep }).demographics("ent-new");
    expect(s2.note).toBe(s.note);
  });
});

describe("a thin-signal title Qloo rejects with a contract error (L3)", () => {
  const contract = { status: "error", results: [], summary: "Qloo rejected the request.", error: { code: "QLOO_CONTRACT", layer: "qloo", retryable: false, recovery: "Check the arguments." } };
  const THIN_NOTE = "Qloo doesn't have enough taste data on this title yet to suggest this.";
  const venuesOk = { status: "ok", result_count: 1, results: [{ entity_id: "v-1", name: "Fixture Cafe 1" }] };

  const calls: [string, (q: ReturnType<typeof createHarnessQlooClient>) => Promise<{ status: string; data: unknown; note?: string }>, string][] = [
    ["artists", (q) => q.artists("ent-1"), "recommend_artists"],
    ["brands", (q) => q.brands("ent-1"), "recommend_brands"],
    ["places", (q) => q.places("ent-1", delhi, ["urn:tag:genre:place:fx-1"]), "recommend_places"],
    ["placeTags (venue step)", (q) => q.placeTags("ent-1", delhi), "recommend_places"],
  ];

  it.each(calls)("%s maps it to empty with the thin-signal note, and warns once with no params", async (_n, run, callName) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { t, calls: sent } = fakeTransport({ qloo_recommend: [contract] });
      const s = await run(createHarnessQlooClient(t, { sleep: noSleep }));
      expect(sent).toHaveLength(1); // not retried
      expect(s.status).toBe("empty");
      expect(s.data).toBeNull();
      expect(s.note).toBe(THIN_NOTE);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(`qloo contract rejection (${callName}): QLOO_CONTRACT`);
    } finally { warn.mockRestore(); }
  });

  it("placeTags stops at the rejected venue step: no entity_tags call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { t, calls: sent } = fakeTransport({ qloo_recommend: [contract], qloo_entity_tags: [{ status: "ok", results: [{ id: "urn:tag:genre:place:x", name: "X", affinity: 1 }] }] });
      await createHarnessQlooClient(t, { sleep: noSleep }).placeTags("ent-1", delhi);
      expect(sent.map((c) => c.name)).toEqual(["qloo_recommend"]);
    } finally { warn.mockRestore(); }
  });

  it.each(calls)("%s still reports QLOO_AUTH as an error, with no contract warning", async (_n, run) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const auth = { status: "error", results: [], error: { code: "QLOO_AUTH", layer: "qloo", retryable: false, recovery: "Set QLOO_API_KEY." } };
      const { t } = fakeTransport({ qloo_recommend: [auth] });
      const s = await run(createHarnessQlooClient(t, { sleep: noSleep }));
      expect(s.status).toBe("error");
      expect(s.note).toContain("Set QLOO_API_KEY.");
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it.each(calls)("%s still backs off on a rate limit and then fails as an error section", async (_n, run) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const rateLimited = { status: "error", results: [], error: { code: "QLOO_RATE_LIMIT", layer: "qloo", retryable: true, recovery: "wait" } };
      const { t, calls: sent } = fakeTransport({ qloo_recommend: [rateLimited] });
      const s = await run(createHarnessQlooClient(t, { sleep: noSleep }));
      expect(sent).toHaveLength(3);
      expect(s.status).toBe("error");
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it("agent tool calls keep the raw envelope: only the recipe-backed sections are remapped", async () => {
    const { t } = fakeTransport({ qloo_recommend: [contract] });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    expect(await q.callTool("qloo_recommend", {})).toEqual(contract);
  });

  it("does not touch a venue step that succeeded", async () => {
    const { t } = fakeTransport({ qloo_recommend: [venuesOk], qloo_entity_tags: [{ status: "ok", results: [{ id: "urn:tag:genre:place:chinese", name: "Chinese", affinity: 0.5 }] }] });
    const s = await createHarnessQlooClient(t, { sleep: noSleep }).placeTags("ent-1", delhi);
    expect(s.status).toBe("ok");
  });
});

describe("place themes keep only food and drink tag families (L4)", () => {
  const tagReply = (rows: { id: string; name: string; affinity?: number }[]) => ({
    qloo_recommend: [{ status: "ok", result_count: 1, results: [{ entity_id: "v-1", name: "Fixture Cafe 1" }] }],
    qloo_entity_tags: [{ status: "ok", result_count: rows.length, results: rows }],
  });
  const themes = async (rows: { id: string; name: string; affinity?: number }[]) =>
    createHarnessQlooClient(fakeTransport(tagReply(rows)).t, { sleep: noSleep }).placeTags("ent-1", delhi);

  it("drops hobby, keyword, archetype, brand, music and other noise families", async () => {
    const s = await themes([
      { id: "urn:tag:specialty_dish:place:fx_a", name: "Dish A", affinity: 0.9 },
      { id: "urn:tag:keyword:qloo:fx", name: "Keyword", affinity: 0.99 },
      { id: "urn:tag:hobby:qloo:fx", name: "Hobby", affinity: 0.98 },
      { id: "urn:tag:category:qloo:fx", name: "Category", affinity: 0.97 },
      { id: "urn:tag:archetype:qloo:fx", name: "Archetype", affinity: 0.96 },
      { id: "urn:tag:genre:brand:fx", name: "Brand genre", affinity: 0.95 },
      { id: "urn:tag:genre:music:fx", name: "Music genre", affinity: 0.94 },
      { id: "urn:tag:genre:media:fx", name: "Media genre", affinity: 0.93 },
      { id: "urn:tag:decor:qloo:fx", name: "Decor", affinity: 0.92 },
      { id: "urn:tag:hotel_rating:place:fx", name: "Stars", affinity: 0.91 },
      { id: "urn:tag:credit_card:place:fx", name: "Cards", affinity: 0.9 },
      { id: "urn:tag:cuisine:qloo:fx_b", name: "Cuisine B", affinity: 0.5 },
    ]);
    expect(s.status).toBe("ok");
    expect(s.data?.map((t) => t.name)).toEqual(["Dish A", "Cuisine B"]);
  });

  it("keeps each of the five food families", async () => {
    const ids = [
      "urn:tag:specialty_dish:place:a", "urn:tag:genre:place:b", "urn:tag:cuisine:qloo:c",
      "urn:tag:dining_option:qloo:d", "urn:tag:popular_food_item:qloo:e",
    ];
    const s = await themes(ids.map((id, i) => ({ id, name: `Name ${i}`, affinity: 0.9 - i / 10 })));
    expect(s.data?.map((t) => t.tagId)).toEqual(ids);
  });

  it("does not match a family by loose substring (genre:place must be the id's prefix)", async () => {
    const s = await themes([
      { id: "urn:tag:genre:place:ok", name: "Ok", affinity: 0.1 },
      { id: "urn:tag:genre:media:urn:tag:genre:place:", name: "Sneaky", affinity: 0.9 },
      { id: "x-urn:tag:cuisine:qloo:y", name: "Sneakier", affinity: 0.8 },
    ]);
    expect(s.data?.map((t) => t.name)).toEqual(["Ok"]);
  });

  it("dedupes by lowercased name keeping the highest affinity, sorts by affinity, caps at 12", async () => {
    const rows = [
      { id: "urn:tag:genre:place:dessert", name: "Dessert shop", affinity: 0.4 },
      { id: "urn:tag:specialty_dish:place:dessert", name: "dessert SHOP", affinity: 0.8 },
      ...Array.from({ length: 14 }, (_, i) => ({ id: `urn:tag:specialty_dish:place:f${i}`, name: `Dish ${i}`, affinity: 0.7 - i * 0.01 })),
    ];
    const s = await themes(rows);
    const data = s.data!;
    expect(data).toHaveLength(12);
    expect(data[0]).toEqual({ tagId: "urn:tag:specialty_dish:place:dessert", name: "dessert SHOP", affinity: 0.8 });
    expect(data.filter((t) => t.name.toLowerCase() === "dessert shop")).toHaveLength(1);
    const aff = data.map((t) => t.affinity as number);
    expect(aff).toEqual([...aff].sort((a, b) => b - a));
    expect(data.map((t) => t.name)).toEqual(["dessert SHOP", ...Array.from({ length: 11 }, (_, i) => `Dish ${i}`)]);
  });

  it("puts a tag with no affinity after those that have one", async () => {
    const s = await themes([
      { id: "urn:tag:genre:place:a", name: "No affinity" },
      { id: "urn:tag:genre:place:b", name: "Has affinity", affinity: 0.1 },
    ]);
    expect(s.data?.map((t) => t.name)).toEqual(["Has affinity", "No affinity"]);
  });

  it("answers empty with an honest note when nothing food-related is left, keeping provenance", async () => {
    const s = await themes([
      { id: "urn:tag:keyword:qloo:fx", name: "Keyword", affinity: 0.9 },
      { id: "urn:tag:lifestyle:qloo:fx", name: "Lifestyle", affinity: 0.8 },
    ]);
    expect(s.status).toBe("empty");
    expect(s.data).toBeNull();
    expect(s.note).toBe("No food or drink themes stood out for this audience in this city.");
    expect(s.provenance.map((p) => p.call)).toEqual(["recommend_places", "entity_tags"]);
  });

  it("keeps the provenance of both calls when there are themes", async () => {
    const s = await themes([{ id: "urn:tag:genre:place:a", name: "A", affinity: 0.5 }]);
    expect(s.provenance.map((p) => p.call)).toEqual(["recommend_places", "entity_tags"]);
  });
});

describe("what a business owner's tag names look like to businessFit (L4)", () => {
  it("still matches realistic food-family names against a business type's query words", async () => {
    const { businessFit } = await import("../score.js");
    // Invented names that contain a business type's query words, as real tag names do.
    const names = ["Test Dessert Shop", "Test Coffee Stop", "Test Bakery Counter", "Test Grill Restaurant", "Test Rice Dish"];
    expect(businessFit(names, "cafe")).toBeCloseTo(3 / 5); // dessert, coffee, bakery
    expect(businessFit(["Test Dessert Shop", "Test Snacks Box", "Test Rice Dish", "Test Cold Beverage"], "d2c_food")).toBeCloseTo(3 / 4);
    expect(businessFit(["Caf\u00e9"], "cafe")).toBe(1);
  });
});

describe("food and beverage brands (L5)", () => {
  it("asks qloo_recommend for brands tagged food & beverage, and cites the tag", async () => {
    const { t, calls } = fakeTransport({
      qloo_recommend: [{ status: "ok", result_count: 1, results: [{ entity_id: "b-1", name: "Fixture Brand 1", affinity: 0.4 }] }],
    });
    const s = await createHarnessQlooClient(t, { sleep: noSleep }).brands("ent-1");
    expect(calls).toEqual([{
      name: "qloo_recommend",
      args: { target_type: "brand", signals: ["ent-1"], include_tags: [BRAND_FOOD_TAG], limit: 10, explain: false },
    }]);
    expect(s.data).toEqual([{ entityId: "b-1", name: "Fixture Brand 1", affinity: 0.4 }]);
    expect(s.provenance[0]?.params).toEqual({ entity_id: "ent-1", target_type: "brand", include_tags: BRAND_FOOD_TAG });
    expect(s.provenance[0]?.limits).toBe("Global food & beverage brand recommendations for this title signal, not city-specific preferences, endorsements or sales figures.");
  });

  it("leaves artist recommendations untagged", async () => {
    const { t, calls } = fakeTransport({ qloo_recommend: [{ status: "ok", results: [{ entity_id: "a-1", name: "Fixture Artist 1" }] }] });
    const s = await createHarnessQlooClient(t, { sleep: noSleep }).artists("ent-1");
    expect(calls[0]?.args).toEqual({ target_type: "artist", signals: ["ent-1"], limit: 10, explain: false });
    expect(s.provenance[0]?.params).toEqual({ entity_id: "ent-1", target_type: "artist" });
  });
});

describe("duplicate venues (L6)", () => {
  const v = (id: string, name: string, address: string | null, affinity: number | null) =>
    ({ entity_id: id, name, affinity, properties: address === null ? {} : { address } });
  const placesFor = async (results: unknown[]) =>
    createHarnessQlooClient(fakeTransport({ qloo_recommend: [{ status: "ok", result_count: results.length, results }] }).t, { sleep: noSleep })
      .places("ent-1", delhi, []);

  it("keeps the highest-affinity copy of a venue with the same name and address, ignoring case and padding", async () => {
    const s = await placesFor([
      v("a", "Fixture Cafe 1", "1 Test Road", 0.5),
      v("b", "Other Place", "2 Test Road", 0.4),
      v("c", "  fixture cafe 1 ", " 1 TEST road", 0.9),
    ]);
    expect(s.data?.map((x) => x.entityId)).toEqual(["c", "b"]);
  });

  it("keeps same-named venues at different addresses, and ones with no address to compare", async () => {
    const s = await placesFor([
      v("a", "Fixture Cafe 1", "1 Test Road", 0.5),
      v("b", "Fixture Cafe 1", "9 Other Road", 0.4),
      v("c", "Fixture Cafe 2", null, 0.3),
      v("d", "Fixture Cafe 2", null, 0.2),
    ]);
    expect(s.data?.map((x) => x.entityId)).toEqual(["a", "b", "c", "d"]);
  });

  it("treats a missing affinity as lower than any number", async () => {
    const s = await placesFor([v("a", "Fixture Cafe 1", "1 Road", null), v("b", "Fixture Cafe 1", "1 Road", 0.1)]);
    expect(s.data?.map((x) => x.entityId)).toEqual(["b"]);
  });

  it("dedupes before any cap: 20 rows with a duplicate yield 19", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => v(`id${i}`, i === 19 ? "Fixture Cafe 0" : `Fixture Cafe ${i}`, i === 19 ? "0 Road" : `${i} Road`, 0.9 - i * 0.01));
    expect((await placesFor(rows)).data).toHaveLength(19);
  });
});


describe("every entity-signal call maps a contract rejection to empty (follow-up)", () => {
  const contract = { status: "error", results: [], summary: "Qloo rejected the request.", error: { code: "QLOO_CONTRACT", layer: "qloo", retryable: false, recovery: "Check the arguments." } };
  const auth = { status: "error", results: [], error: { code: "QLOO_AUTH", layer: "qloo", retryable: false, recovery: "Set QLOO_API_KEY." } };
  const rateLimited = { status: "error", results: [], error: { code: "QLOO_RATE_LIMIT", layer: "qloo", retryable: true, recovery: "wait" } };
  const THIN = "Qloo doesn't have enough taste data on this title yet to suggest this.";
  const THIN_LOCAL = "Qloo doesn't have enough local taste data on this title yet to map where its fans are.";
  type Client = ReturnType<typeof createHarnessQlooClient>;

  // Each case scripts the one harness tool the call under test depends on; the
  // setup replies are what earlier steps of that call need to get that far.
  const cases: { name: string; call: string; note: string; tool: string; setup?: Record<string, unknown[]>; run: (q: Client) => Promise<{ status: string; data: unknown; note?: string; provenance: { call: string }[] }> }[] = [
    { name: "heatmap", call: "where_popular", note: THIN_LOCAL, tool: "qloo_where_popular", run: (q) => q.heatmap("ent-1", delhi) },
    { name: "demographics", call: "audience_demographics", note: THIN, tool: "qloo_audience_demographics", run: (q) => q.demographics("ent-1") },
    {
      name: "trends", call: "trends", note: THIN, tool: "qloo_trends",
      setup: { qloo_describe: [{ status: "ok", result_count: 1, results: [{ entity_id: "ent-1", name: "Fixture Title", type: "urn:entity:movie" }] }] },
      run: (q) => q.trends("ent-1"),
    },
    {
      name: "placeTags (entity_tags step)", call: "entity_tags", note: THIN, tool: "qloo_entity_tags",
      setup: { qloo_recommend: [{ status: "ok", result_count: 1, results: [{ entity_id: "v-1", name: "Fixture Cafe 1" }] }] },
      run: (q) => q.placeTags("ent-1", delhi),
    },
    { name: "artists", call: "recommend_artists", note: THIN, tool: "qloo_recommend", run: (q) => q.artists("ent-1") },
    { name: "brands", call: "recommend_brands", note: THIN, tool: "qloo_recommend", run: (q) => q.brands("ent-1") },
    { name: "places", call: "recommend_places", note: THIN, tool: "qloo_recommend", run: (q) => q.places("ent-1", delhi, []) },
  ];

  async function withWarn<T>(fn: (warn: ReturnType<typeof vi.spyOn>) => Promise<T>): Promise<T> {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try { return await fn(warn); } finally { warn.mockRestore(); }
  }

  it.each(cases)("$name: QLOO_CONTRACT becomes empty with the right note, one warning, no retry", async (c) => {
    await withWarn(async (warn) => {
      const { t, calls } = fakeTransport({ ...c.setup, [c.tool]: [contract] });
      const s = await c.run(createHarnessQlooClient(t, { sleep: noSleep }));
      expect(calls.filter((x) => x.name === c.tool)).toHaveLength(1);
      expect(s.status).toBe("empty");
      expect(s.data).toBeNull();
      expect(s.note).toBe(c.note);
      expect(s.provenance.at(-1)?.call).toBe(c.call);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(`qloo contract rejection (${c.call}): QLOO_CONTRACT`);
    });
  });

  it.each(cases)("$name: QLOO_AUTH is still an error and does not warn", async (c) => {
    await withWarn(async (warn) => {
      const { t } = fakeTransport({ ...c.setup, [c.tool]: [auth] });
      const s = await c.run(createHarnessQlooClient(t, { sleep: noSleep }));
      expect(s.status).toBe("error");
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it.each(cases)("$name: a rate limit is still retried, then an error section (never empty)", async (c) => {
    await withWarn(async (warn) => {
      const { t, calls } = fakeTransport({ ...c.setup, [c.tool]: [rateLimited] });
      const s = await c.run(createHarnessQlooClient(t, { sleep: noSleep }));
      expect(calls.filter((x) => x.name === c.tool)).toHaveLength(3);
      expect(s.status).toBe("error");
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("a rate limit on the agent's raw callTool still raises RateLimitedError", async () => {
    const { t } = fakeTransport({ qloo_where_popular: [rateLimited] });
    await expect(createHarnessQlooClient(t, { sleep: noSleep }).callTool("qloo_where_popular", {})).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("demographics keeps its own wording when it is simply empty", async () => {
    const { t } = fakeTransport({ qloo_audience_demographics: [{ status: "ok", result_count: 0, results: [] }] });
    const s = await createHarnessQlooClient(t, { sleep: noSleep }).demographics("ent-1");
    expect(s.note).toBe("Qloo doesn't have an audience profile for this title yet \u2014 common for releases that haven't been out long.");
  });

  it("a heatmap that is simply empty keeps the harness's own words, not the thin-signal note", async () => {
    const { t } = fakeTransport({ qloo_where_popular: [{ status: "empty", summary: "No cells.", results: [] }] });
    const s = await createHarnessQlooClient(t, { sleep: noSleep }).heatmap("ent-1", delhi);
    expect(s.status).toBe("empty");
    expect(s.note).toBe("No cells.");
  });

  it("findTags, entityByImdb and searchTitles are not entity-signal calls: a failure still throws", async () => {
    await withWarn(async (warn) => {
      const { t } = fakeTransport({ qloo_find_tags: [contract] });
      await expect(createHarnessQlooClient(t, { sleep: noSleep }).findTags("cafe", "place")).rejects.toThrow();
      const failing: HarnessTransport = { ...fakeTransport({}).t, async getJson() { throw new Error("boom"); } };
      const q = createHarnessQlooClient(failing, { sleep: noSleep });
      await expect(q.entityByImdb("tt0000001")).rejects.toThrow("boom");
      await expect(q.searchTitles("x", "movie")).rejects.toThrow("boom");
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("a thin-signal heatmap is cached as empty: the second request is served from the cache with no Qloo call", async () => {
    await withWarn(async (warn) => {
      const { t, calls } = fakeTransport({ qloo_where_popular: [contract] });
      const q = createHarnessQlooClient(t, { sleep: noSleep });
      const sql = fakeSql(newDb());
      const fetchIt = () => q.heatmap("ent-1", delhi);
      const first = await getEvidence(sql, "heatmap", "ent-1", delhi, fetchIt);
      const second = await getEvidence(sql, "heatmap", "ent-1", delhi, fetchIt);
      expect(first.status).toBe("empty");
      expect(second).toMatchObject({ status: "empty", note: THIN_LOCAL });
      expect(calls).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});


describe("describe lookup behind trends is not an entity-signal call", () => {
  it("a QLOO_CONTRACT on it is an error, with no thin-signal warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const contract = { status: "error", results: [], error: { code: "QLOO_CONTRACT", layer: "qloo", retryable: false, recovery: "x" } };
      const { t, calls } = fakeTransport({ qloo_describe: [contract], qloo_trends: [{ status: "ok", series: [] }] });
      const s = await createHarnessQlooClient(t, { sleep: noSleep }).trends("ent-1");
      expect(s.status).toBe("error");
      expect(calls.map((c) => c.name)).toEqual(["qloo_describe"]);
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});

describe("venue ids to tag are unique (review fix)", () => {
  it("a venue returned twice costs one entity_tags slot", async () => {
    const { t, calls } = fakeTransport({
      qloo_recommend: [{ status: "ok", result_count: 3, results: [{ entity_id: "v-1", name: "A" }, { entity_id: "v-1", name: "A2" }, { entity_id: "v-2", name: "B" }] }],
      qloo_entity_tags: [{ status: "ok", results: [{ id: "urn:tag:genre:place:x", name: "X", affinity: 0.5 }] }],
    });
    await createHarnessQlooClient(t, { sleep: noSleep }).placeTags("ent-1", delhi);
    expect(calls[1]?.args.entities).toEqual(["v-1", "v-2"]);
  });
});

// The reviewer's guard: a recipe or argument bug also surfaces as QLOO_CONTRACT
// (the harness uses it for every HTTP 400), so a call that is rejected nearly
// every time is not "a thin-signal title" and must not be hidden as `empty`.
describe("contract-rejection circuit guard", () => {
  const R = { status: "error", results: [], error: { code: "QLOO_CONTRACT", layer: "qloo", retryable: false, recovery: "x" } };
  const OK = { status: "ok", result_count: 1, results: [{ entity_id: "a-1", name: "Test Artist", affinity: 0.3 }] };
  const AUTH = { status: "error", results: [], error: { code: "QLOO_AUTH", layer: "qloo", retryable: false, recovery: "key" } };
  const TRIP = "qloo contract rejections for recommend_artists exceed 90% of the last 20 calls \u2014 the recipe may be broken (not a thin-signal title)";

  async function harness(replies: unknown[], tool = "qloo_recommend") {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { t } = fakeTransport({ [tool]: replies });
    const q = createHarnessQlooClient(t, { sleep: noSleep });
    return { q, warn, error, done: () => { warn.mockRestore(); error.mockRestore(); } };
  }

  it("9 consecutive rejections are still empty; the 10th is an error with exactly one console.error", async () => {
    const h = await harness(Array.from({ length: 12 }, () => R));
    try {
      for (let i = 0; i < 9; i++) expect((await h.q.artists("e")).status).toBe("empty");
      expect(h.error).not.toHaveBeenCalled();
      const tenth = await h.q.artists("e");
      expect(tenth.status).toBe("error");
      expect(tenth.data).toBeNull();
      expect(h.error).toHaveBeenCalledTimes(1);
      expect(h.error).toHaveBeenCalledWith(TRIP);
      // Still tripped, still an error, and the message is not repeated.
      expect((await h.q.artists("e")).status).toBe("error");
      expect((await h.q.artists("e")).status).toBe("error");
      expect(h.error).toHaveBeenCalledTimes(1);
      // The per-rejection warning only fires while not tripped.
      expect(h.warn).toHaveBeenCalledTimes(9);
    } finally { h.done(); }
  });

  it("a realistic pattern (every 4th call rejected, 40 calls) never trips", async () => {
    const h = await harness(Array.from({ length: 40 }, (_, i) => (i % 4 === 3 ? R : OK)));
    try {
      const statuses: string[] = [];
      for (let i = 0; i < 40; i++) statuses.push((await h.q.artists("e")).status);
      expect(statuses.filter((s) => s === "error")).toHaveLength(0);
      expect(statuses.filter((s) => s === "empty")).toHaveLength(10);
      expect(h.error).not.toHaveBeenCalled();
    } finally { h.done(); }
  });

  it("after a trip, a run of successes brings the ratio under 50% and empty mapping resumes", async () => {
    const h = await harness([...Array.from({ length: 10 }, () => R), ...Array.from({ length: 11 }, () => OK), R, R]);
    try {
      for (let i = 0; i < 10; i++) await h.q.artists("e");
      expect(h.error).toHaveBeenCalledTimes(1);
      // 10 rejections + 10 successes is exactly 50%: still tripped (a rejection would still be an error).
      for (let i = 0; i < 10; i++) expect((await h.q.artists("e")).status).toBe("ok");
      // The 11th success pushes the oldest rejection out: 9/20 < 50%, so the trip resets.
      expect((await h.q.artists("e")).status).toBe("ok");
      expect((await h.q.artists("e")).status).toBe("empty");
      expect((await h.q.artists("e")).status).toBe("empty");
      expect(h.error).toHaveBeenCalledTimes(1);
    } finally { h.done(); }
  });

  it("can trip again after it has reset, with a new message", async () => {
    const h = await harness([...Array.from({ length: 10 }, () => R), ...Array.from({ length: 20 }, () => OK), ...Array.from({ length: 18 }, () => R)]);
    try {
      for (let i = 0; i < 30; i++) await h.q.artists("e");
      expect(h.error).toHaveBeenCalledTimes(1);
      // The ring is all successes now, so it takes 18 rejections of the last 20 to reach 90% again.
      for (let i = 0; i < 17; i++) expect((await h.q.artists("e")).status).toBe("empty");
      expect(h.error).toHaveBeenCalledTimes(1);
      expect((await h.q.artists("e")).status).toBe("error");
      expect(h.error).toHaveBeenCalledTimes(2);
    } finally { h.done(); }
  });

  it("rings are per call name: a broken heatmap does not affect artists", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { t } = fakeTransport({ qloo_where_popular: [R], qloo_recommend: [R] });
      const q = createHarnessQlooClient(t, { sleep: noSleep });
      for (let i = 0; i < 10; i++) await q.heatmap("e", delhi);
      expect((await q.heatmap("e", delhi)).status).toBe("error");
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("for where_popular exceed 90%"));
      expect((await q.artists("e")).status).toBe("empty");
      expect((await q.brands("e")).status).toBe("empty");
    } finally { warn.mockRestore(); error.mockRestore(); }
  });

  it("state belongs to the client instance, not the module", async () => {
    const h1 = await harness(Array.from({ length: 12 }, () => R));
    try {
      for (let i = 0; i < 10; i++) await h1.q.artists("e");
      expect(h1.error).toHaveBeenCalledTimes(1);
      const { t } = fakeTransport({ qloo_recommend: [R] });
      const fresh = createHarnessQlooClient(t, { sleep: noSleep });
      expect((await fresh.artists("e")).status).toBe("empty");
    } finally { h1.done(); }
  });

  it("auth and other errors count as non-rejections, stay errors, and keep the guard from tripping", async () => {
    const h = await harness([...Array.from({ length: 9 }, () => R), AUTH, R, R]);
    try {
      for (let i = 0; i < 9; i++) expect((await h.q.artists("e")).status).toBe("empty");
      const auth = await h.q.artists("e");
      expect(auth.status).toBe("error");
      expect(auth.note).toContain("key");
      // 9 rejections out of 10 samples is 90%: the next rejection (10/11) trips.
      expect((await h.q.artists("e")).status).toBe("error");
      expect(h.error).toHaveBeenCalledTimes(1);
    } finally { h.done(); }
  });

  it("a thrown transport failure counts as a non-rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let n = 0;
      const t: HarnessTransport = {
        ...fakeTransport({}).t,
        async callTool() { n++; if (n <= 5) throw new Error("socket hang up"); return R; },
      };
      const q = createHarnessQlooClient(t, { sleep: noSleep });
      for (let i = 0; i < 5; i++) expect((await q.artists("e")).status).toBe("error");
      // 5 failures then rejections: 5 rejections out of 10 samples is 50%, nowhere near a trip.
      for (let i = 0; i < 5; i++) expect((await q.artists("e")).status).toBe("empty");
      expect(error).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); error.mockRestore(); }
  });

  it("while tripped the error section is not cached, so the next request retries", async () => {
    const h = await harness(Array.from({ length: 12 }, () => R));
    try {
      for (let i = 0; i < 10; i++) await h.q.artists("e");
      const sql = fakeSql(newDb());
      const a = await getEvidence(sql, "artists", "e", null, () => h.q.artists("e"));
      const b = await getEvidence(sql, "artists", "e", null, () => h.q.artists("e"));
      expect([a.status, b.status]).toEqual(["error", "error"]);
    } finally { h.done(); }
  });
});

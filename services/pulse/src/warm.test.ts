import { describe, expect, it, vi } from "vitest";
import type { EvidenceSection } from "../../../shared/types/pulse.js";
import { getCity } from "./cities.js";
import { buildBoard } from "./board.js";
import type { Resolution } from "./resolve.js";
import { boardSql, newBoardDb, seedEvidence, type BoardDb } from "./testing/boardFakes.js";
import { fixtureDeps } from "./testing/fakes.js";
import { createHarnessQlooClient } from "./qloo/client.js";
import type { HarnessTransport } from "./qloo/harness.js";
import { createBackgroundWarmer, createWarmQueue, warmCities, warmCity, warmTitle, warmBoardRanks, type WarmDeps } from "./warm.js";

const delhi = getCity("delhi")!;
const mumbai = getCity("mumbai")!;
const NOW = new Date("2026-10-21T06:00:00Z");
const rel = (id: number, popularity = 1) => ({ tmdb_id: id, media_type: "movie" as const, title: `Fake Release ${id}`, release_date: "2026-10-23", popularity });

/** A promise a test resolves by hand, so ordering never depends on timers. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async (turns = 20) => { for (let i = 0; i < turns; i++) await Promise.resolve(); };

describe("createWarmQueue", () => {
  it("runs a job once per key however often it is enqueued while in flight", async () => {
    const q = createWarmQueue();
    const gate = deferred();
    const job = vi.fn(() => gate.promise);
    expect(q.enqueue("k", job)).toBe(true);
    expect(q.enqueue("k", job)).toBe(false);
    expect(q.enqueue("k", job)).toBe(false);
    await flush();
    expect(job).toHaveBeenCalledTimes(1);
    gate.resolve();
    await flush();
    expect(q.size()).toBe(0);
    expect(q.enqueue("k", job)).toBe(true); // finished, so a later poll may ask again
  });

  it("frees the key when a job fails, reports the error, and keeps going", async () => {
    const onError = vi.fn();
    const q = createWarmQueue({ onError });
    const after = vi.fn(async () => {});
    q.enqueue("bad", async () => { throw new Error("boom"); });
    q.enqueue("good", after);
    await flush();
    expect(onError).toHaveBeenCalledWith("bad", expect.objectContaining({ message: "boom" }));
    expect(after).toHaveBeenCalled();
    expect(q.size()).toBe(0);
  });

  it("runs only a few jobs at once and starts the next as each finishes", async () => {
    const q = createWarmQueue({ concurrency: 2 });
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    gates.forEach((g, i) => q.enqueue(`k${i}`, () => { started.push(i); return g.promise; }));
    await flush();
    expect(started).toEqual([0, 1]);
    gates[0].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);
  });

  it("drops new work silently once 200 are queued or running, and accepts it again when room frees up", async () => {
    const q = createWarmQueue();
    const gate = deferred();
    for (let i = 0; i < 200; i++) expect(q.enqueue(`k${i}`, () => gate.promise)).toBe(true);
    expect(q.size()).toBe(200);
    expect(q.enqueue("k200", async () => {})).toBe(false);
    expect(q.size()).toBe(200);
    gate.resolve();
    await flush(5000); // 200 jobs drain a few at a time
    expect(q.size()).toBe(0);
    expect(q.enqueue("k200", async () => {})).toBe(true);
  });
});

// --- warming -----------------------------------------------------------

function setup(init: Partial<BoardDb> = {}, over: { resolve?: (key: { tmdbId: number; mediaType: "movie" | "tv" }) => Promise<Resolution>; heatmap?: unknown; placeTags?: unknown } = {}) {
  const db = newBoardDb(init);
  const fx = fixtureDeps({ ...(over.heatmap ? { heatmap: over.heatmap } : {}), ...(over.placeTags ? { placeTags: over.placeTags } : {}) });
  const resolve = vi.fn(over.resolve ?? (async (key: { tmdbId: number }) => ({ entityId: `fx-e${key.tmdbId}`, method: "imdb" as const })));
  const onError = vi.fn();
  const deps: WarmDeps = { sql: boardSql(db), qloo: fx.qloo, resolve, now: () => NOW, onError };
  return { db, deps, fx, resolve, onError };
}

describe("warmCity", () => {
  it("resolves each candidate and caches its heatmap and place tags for the city", async () => {
    const s = setup({ releases: [rel(1, 9), rel(2, 8)] });
    expect(await warmCity(s.deps, delhi, "cafe")).toEqual({ warmed: 2, failed: 0 });
    expect(s.resolve).toHaveBeenCalledTimes(2);
    expect(s.fx.qlooCalls.heatmap).toBe(2);
    expect(s.fx.qlooCalls.placeTags).toBe(2);
    expect([...s.db.evidence.keys()].sort()).toEqual([
      "fx-e1|delhi|heatmap", "fx-e1|delhi|place_tags", "fx-e2|delhi|heatmap", "fx-e2|delhi|place_tags",
    ]);
  });

  it("makes the board rank what it warmed", async () => {
    const s = setup({ releases: [rel(1, 9), rel(2, 8)] });
    // The resolver's answer is what qloo_entities would hold afterwards.
    s.db.entities.push(
      { tmdb_id: 1, media_type: "movie", qloo_entity_id: "fx-e1", method: "imdb", not_found: false, resolved_at: NOW },
      { tmdb_id: 2, media_type: "movie", qloo_entity_id: "fx-e2", method: "imdb", not_found: false, resolved_at: NOW },
    );
    const enqueueWarm = vi.fn();
    const before = await buildBoard({ sql: s.deps.sql, enqueueWarm }, delhi, "cafe", NOW);
    expect(before.rankingPending).toBe(true);
    expect(before.rankingBasis).toBe("release_order");
    await warmCity(s.deps, delhi, "cafe");
    enqueueWarm.mockClear();
    const after = await buildBoard({ sql: s.deps.sql, enqueueWarm }, delhi, "cafe", NOW);
    expect(after.ranked).toHaveLength(2);
    expect(enqueueWarm).not.toHaveBeenCalled();
  });

  it("does not refetch evidence that is already fresh, and counts it warmed", async () => {
    const s = setup({ releases: [rel(1)] });
    const section: EvidenceSection<unknown> = { status: "ok", data: [], provenance: [] };
    seedEvidence(s.db, "fx-e1", "delhi", "heatmap", section, NOW);
    seedEvidence(s.db, "fx-e1", "delhi", "place_tags", section, NOW);
    expect(await warmCity(s.deps, delhi, "cafe")).toEqual({ warmed: 1, failed: 0 });
    expect(s.fx.qlooCalls.heatmap ?? 0).toBe(0);
    expect(s.fx.qlooCalls.placeTags ?? 0).toBe(0);
  });

  it("counts an empty or degraded section as warmed", async () => {
    const s = setup({ releases: [rel(1), rel(2)] }, {
      heatmap: async () => ({ status: "empty", data: null, provenance: [], note: "none" }),
      placeTags: async () => ({ status: "degraded", data: [], provenance: [], note: "partial" }),
    });
    expect(await warmCity(s.deps, delhi, "cafe")).toEqual({ warmed: 2, failed: 0 });
  });

  it("counts a Qloo error section as failed (and stores nothing for it)", async () => {
    const s = setup({ releases: [rel(1)] }, { heatmap: async () => ({ status: "error", data: null, provenance: [], note: "Qloo call failed: x" }) });
    expect(await warmCity(s.deps, delhi, "cafe")).toEqual({ warmed: 0, failed: 1 });
    expect(s.db.evidence.has("fx-e1|delhi|heatmap")).toBe(false);
  });

  it("counts a thrown evidence fetch as failed and still tries the other kind", async () => {
    const s = setup({ releases: [rel(1)] }, { heatmap: async () => { throw new Error("rate limited"); } });
    expect(await warmCity(s.deps, delhi, "cafe")).toEqual({ warmed: 0, failed: 1 });
    expect(s.fx.qlooCalls.placeTags).toBe(1);
    expect(s.onError).toHaveBeenCalled();
  });

  it("a resolver failure for one candidate counts failed and never aborts the run", async () => {
    const s = setup({ releases: [rel(1, 9), rel(2, 8), rel(3, 7)] }, {
      resolve: async (key) => { if (key.tmdbId === 2) throw new Error("qloo down"); return { entityId: `fx-e${key.tmdbId}`, method: "imdb" as const }; },
    });
    expect(await warmCity(s.deps, delhi, "cafe")).toEqual({ warmed: 2, failed: 1 });
    expect(s.resolve).toHaveBeenCalledTimes(3);
  });

  it("counts a title Qloo definitely does not know as warmed: there is nothing left to fetch for it", async () => {
    const s = setup({ releases: [rel(1)] }, { resolve: async () => ({ entityId: null, reason: "not_in_qloo" as const }) });
    expect(await warmCity(s.deps, delhi, "cafe")).toEqual({ warmed: 1, failed: 0 });
    expect(s.fx.qlooCalls.heatmap ?? 0).toBe(0);
  });

  it("goes one candidate at a time", async () => {
    let active = 0;
    let peak = 0;
    const s = setup({ releases: [rel(1, 9), rel(2, 8), rel(3, 7)] }, {
      resolve: async (key) => {
        active++; peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        return { entityId: `fx-e${key.tmdbId}`, method: "imdb" as const };
      },
    });
    await warmCity(s.deps, delhi, "cafe");
    expect(peak).toBe(1);
  });

  it("counts a failed candidate list as one failure rather than throwing", async () => {
    const s = setup();
    const broken = { ...s.deps, sql: (() => Promise.reject(new Error("db down"))) as unknown as WarmDeps["sql"] };
    await expect(warmCity(broken, delhi, "cafe")).rejects.toThrow("db down");
    expect(await warmCities(broken, [delhi])).toEqual({ warmed: 0, failed: 2 }); // once per business type
    expect(s.onError).toHaveBeenCalledTimes(2);
  });
});

describe("a thin-signal title (Qloo's QLOO_CONTRACT rejection) through the real client", () => {
  const contract = { status: "error", results: [], error: { code: "QLOO_CONTRACT", layer: "qloo", retryable: false, recovery: "Check the arguments." } };

  it("caches thin title evidence but reports a failed rank and shows release order", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const sent: string[] = [];
      const transport: HarnessTransport = {
        async listTools() { return []; },
        async callTool(name) { sent.push(name); return contract; },
        async getJson() { throw new Error("not used"); },
        async close() {},
      };
      const db = newBoardDb({ releases: [rel(1, 9)] });
      db.entities.push({ tmdb_id: 1, media_type: "movie", qloo_entity_id: "q-thin", method: "imdb", not_found: false, resolved_at: NOW });
      const deps: WarmDeps = {
        sql: boardSql(db),
        qloo: createHarnessQlooClient(transport, { sleep: async () => {} }),
        resolve: async () => ({ entityId: "q-thin", method: "imdb" as const }),
        now: () => NOW,
      };
      const enqueueWarm = vi.fn();
      const before = await buildBoard({ sql: deps.sql, enqueueWarm }, delhi, "cafe", NOW);
      expect(before.rankingPending).toBe(true);

      expect(await warmCity(deps, delhi, "cafe")).toEqual({ warmed: 1, failed: 1 });
      expect(db.evidence.get("q-thin|delhi|heatmap")?.status).toBe("empty");
      expect(db.evidence.get("q-thin|delhi|place_tags")?.status).toBe("empty");

      enqueueWarm.mockClear();
      const callsBefore = sent.length;
      const after = await buildBoard({ sql: deps.sql, enqueueWarm }, delhi, "cafe", NOW);
      expect(after.pending).toHaveLength(0);
      expect(after.ranked).toHaveLength(1);
      expect(after.ranked[0].why).toContain("no comparable local ranking");
      expect(enqueueWarm).not.toHaveBeenCalled(); // not re-enqueued on every poll
      expect(sent.length).toBe(callsBefore);
      // A second warm run is all cache hits.
      expect(await warmCity(deps, delhi, "cafe")).toEqual({ warmed: 1, failed: 1 });
      expect(sent.length).toBe(callsBefore + 1); // failed rank is not cached
    } finally { warn.mockRestore(); }
  });
});

describe("warmTitle", () => {
  it("reports failed when the resolver throws, and why", async () => {
    const s = setup({}, { resolve: async () => { throw new Error("nope"); } });
    expect(await warmTitle(s.deps, delhi, { tmdbId: 1, mediaType: "movie" })).toBe("failed");
    expect(s.onError).toHaveBeenCalledWith(expect.stringContaining("resolve"), expect.objectContaining({ message: "nope" }));
  });
});

describe("warmCities", () => {
  it("covers each city with both business types, one city after another", async () => {
    const s = setup({ releases: [rel(1)] });
    const report = await warmCities({ ...s.deps, onError: undefined }, [delhi, mumbai]);
    // Evidence is not business-type specific, so the second type is all cache hits.
    expect(report).toEqual({ warmed: 4, failed: 0 });
    expect(s.fx.qlooCalls.heatmap).toBe(2); // one per city
    expect([...s.db.evidence.keys()].filter((k) => k.endsWith("|heatmap")).sort()).toEqual(["fx-e1|delhi|heatmap", "fx-e1|mumbai|heatmap"]);
  });

  it("defaults to the prewarm cities", async () => {
    const s = setup();
    await warmCities(s.deps);
    const prewarmed = (await import("./cities.js")).allCities().filter((c) => c.prewarm).length;
    expect(s.db.calls.filter((c) => c.text.includes("DISTINCT ON") && String(c.values[0]).startsWith("2026-10"))).toHaveLength(prewarmed * 2);
  });
});

describe("createBackgroundWarmer", () => {
  it("queues one warm job per city, title and type no matter how often the board is polled", async () => {
    const s = setup({ releases: [rel(1)] });
    s.db.entities.push({ tmdb_id: 1, media_type: "movie", qloo_entity_id: "fx-e1", method: "imdb", not_found: false, resolved_at: NOW });
    const gate = deferred<Resolution>();
    s.resolve.mockImplementation(() => gate.promise);
    const queue = createWarmQueue();
    const enqueueWarm = createBackgroundWarmer(s.deps, queue);
    const poll = () => buildBoard({ sql: s.deps.sql, enqueueWarm }, delhi, "cafe", NOW);
    await poll(); await poll(); await poll();
    await flush();
    expect(s.resolve).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(1);
    // A different business type is a different key.
    await buildBoard({ sql: s.deps.sql, enqueueWarm }, delhi, "d2c_food", NOW);
    await flush();
    expect(s.resolve).toHaveBeenCalledTimes(2);
    gate.resolve({ entityId: "fx-e1", method: "imdb" });
    await flush();
    expect(queue.size()).toBe(0);
  });

  it("keys jobs city|tmdbId|mediaType|type", () => {
    const keys: string[] = [];
    const enqueueWarm = createBackgroundWarmer(setup().deps, { enqueue: (k) => { keys.push(k); return true; }, size: () => 0 });
    enqueueWarm(delhi, "cafe", { tmdbId: 42, mediaType: "tv" });
    expect(keys).toEqual(["delhi|42|tv|cafe"]);
  });

  it("does not start any Qloo call before the job runs: polling alone spends nothing", async () => {
    const s = setup({ releases: [rel(1)] });
    const enqueueWarm = createBackgroundWarmer(s.deps, { enqueue: () => true, size: () => 0 });
    await buildBoard({ sql: s.deps.sql, enqueueWarm }, delhi, "cafe", NOW);
    await flush();
    expect(s.resolve).not.toHaveBeenCalled();
    expect(Object.values(s.fx.qlooCalls).reduce((a, b) => a + b, 0)).toBe(0);
  });
});


describe("independent media ranking failures", () => {
  it("still ranks TV when the movie request fails", async () => {
    const s=setup({releases:[rel(1),{...rel(2),media_type:"tv"}]});
    s.db.entities.push(
      {tmdb_id:1,media_type:"movie",qloo_entity_id:"film",method:"imdb",not_found:false,resolved_at:NOW},
      {tmdb_id:2,media_type:"tv",qloo_entity_id:"show",method:"imdb",not_found:false,resolved_at:NOW},
    );
    s.deps.qloo.callTool=vi.fn(async (_name,args)=>args.option_type==="movie"
      ? {status:"error",results:[],error:{code:"QLOO_CONTRACT",retryable:false}}
      : {status:"ok",results:[{entity_id:"show"}]});
    await expect(warmBoardRanks(s.deps,delhi)).rejects.toThrow("One or more");
    expect(s.deps.qloo.callTool).toHaveBeenCalledTimes(2);
    expect([...s.db.evidence.values()].some(row=>(row.payload as EvidenceSection<string[]>)?.data?.includes("show"))).toBe(true);
  });
});

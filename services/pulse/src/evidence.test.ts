import { describe, expect, it, vi } from "vitest";
import type { EvidenceSection } from "../../../shared/types/pulse.js";
import { getCity } from "./cities.js";
import { getEvidence, peekEvidence } from "./evidence.js";
import { EVIDENCE_INSERT_COLUMNS, fakeSql, newDb, type FakeDb } from "./testing/fakes.js";

const delhi = getCity("delhi")!;
const NOW = new Date("2026-10-21T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const section = (over: Partial<EvidenceSection<string[]>> = {}): EvidenceSection<string[]> =>
  ({ status: "ok", data: ["fresh"], provenance: [{ source: "qloo", call: "recommend_artists", params: { entity_id: "e1" }, limits: "l" }], ...over });

function seed(db: FakeDb, row: { status: string; ageDays: number; payload?: unknown; kind?: string; city?: string }) {
  const key = `e1|${row.city ?? ""}|${row.kind ?? "artists"}`;
  db.evidence.set(key, { status: row.status, payload: row.payload ?? section({ data: ["cached"] }), fetched_at: daysAgo(row.ageDays) });
}

describe("getEvidence", () => {
  it("serves cached evidence younger than 3 days without calling Qloo", async () => {
    const db = newDb();
    seed(db, { status: "ok", ageDays: 2 });
    const fetch = vi.fn(async () => section());
    const out = await getEvidence(fakeSql(db), "artists", "e1", null, fetch, NOW);
    expect(fetch).not.toHaveBeenCalled();
    expect(out.data).toEqual(["cached"]);
    expect(db.upserts).toHaveLength(0);
  });

  it("serves exactly 3 days old but refetches anything older", async () => {
    const db = newDb();
    seed(db, { status: "ok", ageDays: 3 });
    const fetch = vi.fn(async () => section());
    await getEvidence(fakeSql(db), "artists", "e1", null, fetch, NOW);
    expect(fetch).not.toHaveBeenCalled();
    seed(db, { status: "ok", ageDays: 3.01 });
    await getEvidence(fakeSql(db), "artists", "e1", null, fetch, NOW);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["empty", "partial", "degraded"])("treats a cached %s section as fresh", async (status) => {
    const db = newDb();
    seed(db, { status, ageDays: 1 });
    const fetch = vi.fn(async () => section());
    await getEvidence(fakeSql(db), "artists", "e1", null, fetch, NOW);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refetches cached evidence whose status was error", async () => {
    const db = newDb();
    seed(db, { status: "error", ageDays: 0 });
    const fetch = vi.fn(async () => section());
    const out = await getEvidence(fakeSql(db), "artists", "e1", null, fetch, NOW);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(out.data).toEqual(["fresh"]);
  });

  it("refetches cached needs_input rows too", async () => {
    const db = newDb();
    seed(db, { status: "needs_input", ageDays: 0 });
    const fetch = vi.fn(async () => section());
    await getEvidence(fakeSql(db), "artists", "e1", null, fetch, NOW);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stores city-independent kinds under city_slug ''", async () => {
    const db = newDb();
    await getEvidence(fakeSql(db), "demographics", "e1", null, async () => section(), NOW);
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0]).toMatchObject({ entity_id: "e1", city_slug: "", kind: "demographics", status: "ok" });
  });

  it("stores city kinds under the city slug and reads them back by it", async () => {
    const db = newDb();
    const fetch = vi.fn(async () => section());
    await getEvidence(fakeSql(db), "places", "e1", delhi, fetch, NOW);
    expect(db.upserts[0]).toMatchObject({ city_slug: "delhi", kind: "places" });
    await getEvidence(fakeSql(db), "places", "e1", delhi, fetch, NOW);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("writes the section as returned, with params from its first provenance entry", async () => {
    const db = newDb();
    const s = section({ note: "n" });
    await getEvidence(fakeSql(db), "artists", "e1", null, async () => s, NOW);
    const sql = db.calls.find((c) => c.text.startsWith("INSERT INTO qloo_evidence"))!;
    expect(sql.text).toContain(EVIDENCE_INSERT_COLUMNS);
    expect(db.upserts[0].payload).toEqual(s);
    expect(db.upserts[0].params).toEqual({ entity_id: "e1" });
    expect(db.upserts[0].fetched_at).toEqual(NOW);
  });

  it("uses empty params when the section has no provenance", async () => {
    const db = newDb();
    await getEvidence(fakeSql(db), "artists", "e1", null, async () => section({ provenance: [] }), NOW);
    expect(db.upserts[0].params).toEqual({});
  });

  it.each(["ok", "empty", "partial", "degraded"] as const)("persists a %s result", async (status) => {
    const db = newDb();
    await getEvidence(fakeSql(db), "artists", "e1", null, async () => section({ status, data: status === "empty" ? null : ["x"] }), NOW);
    expect(db.upserts.map((u) => u.status)).toEqual([status]);
  });

  it.each(["error", "needs_input"] as const)("never persists a %s result, and returns it as is", async (status) => {
    const db = newDb();
    const s = section({ status, data: null, note: "boom" });
    const out = await getEvidence(fakeSql(db), "artists", "e1", null, async () => s, NOW);
    expect(out).toEqual(s);
    expect(db.upserts).toHaveLength(0);
  });

  it("does not overwrite a still-good older row with an error", async () => {
    const db = newDb();
    seed(db, { status: "ok", ageDays: 5, payload: section({ data: ["old good"] }) });
    const out = await getEvidence(fakeSql(db), "artists", "e1", null, async () => section({ status: "error", data: null }), NOW);
    expect(out.status).toBe("error");
    expect(db.upserts).toHaveLength(0);
    expect((db.evidence.get("e1||artists")!.payload as EvidenceSection<string[]>).data).toEqual(["old good"]);
  });

  it("propagates a fetch that throws and caches nothing", async () => {
    const db = newDb();
    await expect(getEvidence(fakeSql(db), "artists", "e1", null, async () => { throw new Error("429"); }, NOW)).rejects.toThrow("429");
    expect(db.upserts).toHaveLength(0);
  });

  it("returns the fetched result even when the cache write fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = newDb();
    const base = fakeSql(db);
    const sql = ((s: TemplateStringsArray, ...v: unknown[]) =>
      s.join("?").includes("INSERT INTO qloo_evidence") ? Promise.reject(new Error("db write down")) : base(s, ...v)) as typeof base;
    const out = await getEvidence(sql, "artists", "e1", null, async () => section(), NOW);
    expect(out.data).toEqual(["fresh"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("artists"), "db write down");
    log.mockRestore();
  });
});

describe("getEvidence in-flight sharing", () => {
  const deferred = <T>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  it("shares one fetch between concurrent callers for the same key, with one upsert", async () => {
    const db = newDb();
    const d = deferred<EvidenceSection<string[]>>();
    const fetch = vi.fn(() => d.promise);
    const a = getEvidence(fakeSql(db), "artists", "e1", null, fetch, NOW);
    const b = getEvidence(fakeSql(db), "artists", "e1", null, fetch, NOW);
    const c = getEvidence(fakeSql(db), "artists", "e1", null, fetch, NOW);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const s = section();
    d.resolve(s);
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rb).toBe(ra);
    expect(rc).toBe(ra);
    expect(db.upserts).toHaveLength(1);
  });

  it("clears the entry when the fetch rejects, so a later call fetches again", async () => {
    const db = newDb();
    const d = deferred<EvidenceSection<string[]>>();
    const first = vi.fn(() => d.promise);
    const a = getEvidence(fakeSql(db), "artists", "e1", null, first, NOW);
    const b = getEvidence(fakeSql(db), "artists", "e1", null, first, NOW);
    d.reject(new Error("429"));
    await expect(a).rejects.toThrow("429");
    await expect(b).rejects.toThrow("429");
    const second = vi.fn(async () => section());
    expect((await getEvidence(fakeSql(db), "artists", "e1", null, second, NOW)).data).toEqual(["fresh"]);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not share between different entity, city or kind", async () => {
    const db = newDb();
    const ds = [deferred<EvidenceSection<string[]>>(), deferred<EvidenceSection<string[]>>(), deferred<EvidenceSection<string[]>>(), deferred<EvidenceSection<string[]>>()];
    const fetches = ds.map((d) => vi.fn(() => d.promise));
    const calls = [
      getEvidence(fakeSql(db), "artists", "e1", null, fetches[0], NOW),
      getEvidence(fakeSql(db), "artists", "e2", null, fetches[1], NOW),
      getEvidence(fakeSql(db), "places", "e1", delhi, fetches[2], NOW),
      getEvidence(fakeSql(db), "places", "e1", getCity("mumbai")!, fetches[3], NOW),
    ];
    await vi.waitFor(() => fetches.forEach((f) => expect(f).toHaveBeenCalledTimes(1)));
    ds.forEach((d) => d.resolve(section()));
    await Promise.all(calls);
    expect(db.upserts).toHaveLength(4);
  });

  it("skips persisting when the caller says the result is a stopgap", async () => {
    const db = newDb();
    const out = await getEvidence(fakeSql(db), "places", "e1", delhi, async () => section({ status: "degraded" }), NOW, { skipPersist: () => true });
    expect(out.status).toBe("degraded");
    expect(db.upserts).toHaveLength(0);
  });
});

describe("peekEvidence", () => {
  it("returns a fresh cached section without calling anything else", async () => {
    const db = newDb();
    seed(db, { status: "ok", ageDays: 1 });
    expect((await peekEvidence(fakeSql(db), "artists", "e1", null, NOW))?.data).toEqual(["cached"]);
    expect(db.calls).toHaveLength(1);
    expect(db.upserts).toHaveLength(0);
  });

  it.each([
    ["a missing row", null],
    ["a stale row", { status: "ok", ageDays: 4 }],
    ["an error row", { status: "error", ageDays: 0 }],
    ["a needs_input row", { status: "needs_input", ageDays: 0 }],
  ])("returns null for %s", async (_name, row) => {
    const db = newDb();
    if (row) seed(db, row);
    expect(await peekEvidence(fakeSql(db), "artists", "e1", null, NOW)).toBeNull();
    expect(db.upserts).toHaveLength(0);
  });
});

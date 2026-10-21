import { describe, expect, it, vi } from "vitest";
import type { EvidenceSection, HeatCell } from "../../../shared/types/pulse.js";
import { buildBoard, listCandidates } from "./board.js";
import { getCity } from "./cities.js";
import { boardSql, newBoardDb, seedEvidence, type BoardDb } from "./testing/boardFakes.js";

const delhi = getCity("delhi")!;
// 11:30 on 21 Oct in India. The window is 18 Oct .. 4 Nov.
const TODAY = new Date("2026-10-21T06:00:00Z");
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);

const rel = (id: number, date: string, popularity = 1, title = `Fake Release ${id}`, mediaType: "movie" | "tv" = "movie") =>
  ({ tmdb_id: id, media_type: mediaType, title, release_date: date, popularity });

describe("listCandidates", () => {
  it("keeps releases from today-3 to today+14 inclusive and drops the day either side", async () => {
    const db = newBoardDb({ releases: [
      rel(1, "2026-10-17"), rel(2, "2026-10-18"), rel(3, "2026-10-21"), rel(4, "2026-11-04"), rel(5, "2026-11-05"),
    ] });
    const out = await listCandidates(boardSql(db), delhi, TODAY);
    expect(out.map((c) => c.card.tmdbId).sort()).toEqual([2, 3, 4]);
  });

  it("reads each calendar month the window touches, and only those", async () => {
    const db = newBoardDb({ releases: [rel(1, "2026-10-30"), rel(2, "2026-11-02")] });
    const out = await listCandidates(boardSql(db), delhi, TODAY);
    expect(out.map((c) => c.card.tmdbId).sort()).toEqual([1, 2]);
    const months = db.calls.filter((c) => c.text.includes("DISTINCT ON")).map((c) => c.values[0]);
    expect(months).toEqual(["2026-10-01", "2026-11-01"]);
    // A window inside one month reads one month.
    const db2 = newBoardDb({ releases: [rel(1, "2026-10-12")] });
    await listCandidates(boardSql(db2), delhi, new Date("2026-10-10T06:00:00Z"));
    expect(db2.calls.filter((c) => c.text.includes("DISTINCT ON")).map((c) => c.values[0])).toEqual(["2026-10-01"]);
  });

  it("spans a year end", async () => {
    const db = newBoardDb({ releases: [rel(1, "2026-12-30"), rel(2, "2027-01-05")] });
    const out = await listCandidates(boardSql(db), delhi, new Date("2026-12-31T06:00:00Z"));
    expect(out.map((c) => c.card.tmdbId).sort()).toEqual([1, 2]);
  });

  it("computes daysAhead on the India calendar day, not the UTC instant", async () => {
    const db = newBoardDb({ releases: [rel(1, "2026-10-22")] });
    // 19:00 UTC on the 21st is 00:30 on the 22nd in India.
    const late = await listCandidates(boardSql(db), delhi, new Date("2026-10-21T19:00:00Z"));
    expect(late[0].daysAhead).toBe(0);
    const early = await listCandidates(boardSql(db), delhi, new Date("2026-10-21T17:00:00Z"));
    expect(early[0].daysAhead).toBe(1);
  });

  it("reports negative daysAhead for something already out", async () => {
    const out = await listCandidates(boardSql(newBoardDb({ releases: [rel(1, "2026-10-19")] })), delhi, TODAY);
    expect(out[0].daysAhead).toBe(-2);
  });

  it("drops calendar rows without a TMDB id (or a media type)", async () => {
    const db = newBoardDb({ calendar: [
      { tmdb_id: null, media_type: null, title: "Fake No Id", release_date: "2026-10-25", entry_type: "Movie", platform_or_distributor: "Netflix" },
      { tmdb_id: 77, media_type: null, title: "Fake No Type", release_date: "2026-10-25", entry_type: "Documentary", platform_or_distributor: "Netflix" },
      { tmdb_id: 78, media_type: "movie", title: "Fake Has Id", release_date: "2026-10-25", entry_type: "Movie", platform_or_distributor: "Netflix" },
    ] });
    const out = await listCandidates(boardSql(db), delhi, TODAY);
    expect(out.map((c) => c.card.tmdbId)).toEqual([78]);
  });

  it("derives kind and mediaType from the calendar row at read time, not from is_theatrical", async () => {
    const db = newBoardDb({ calendar: [
      // is_theatrical is true on every fake row; the show on a network must still not be a film.
      { tmdb_id: 80, media_type: null, title: "Fake Show", release_date: "2026-10-25", entry_type: "Show", platform_or_distributor: "HBO" },
    ] });
    const [c] = await listCandidates(boardSql(db), delhi, TODAY);
    expect(c.card).toMatchObject({ tmdbId: 80, mediaType: "tv", kind: "tv_network", platform: "HBO" });
  });

  it("dedupes by media type and id, preferring the streaming row over a theatrical one", async () => {
    const db = newBoardDb({
      releases: [rel(5, "2026-10-28", 40, "Fake Streaming Title")],
      calendar: [
        { tmdb_id: 5, media_type: "movie", title: "Fake Theatrical Title", release_date: "2026-10-23", entry_type: "Movie", platform_or_distributor: "PVR Pictures" },
        // The same number as a show is a different title.
        { tmdb_id: 5, media_type: "tv", title: "Fake Other Kind", release_date: "2026-10-24", entry_type: "Show", platform_or_distributor: "HBO" },
      ],
    });
    const out = await listCandidates(boardSql(db), delhi, TODAY);
    expect(out).toHaveLength(2);
    const movie = out.find((c) => c.card.mediaType === "movie")!;
    expect(movie.card).toMatchObject({ title: "Fake Streaming Title", kind: "streaming", releaseDate: "2026-10-28" });
    expect(out.find((c) => c.card.mediaType === "tv")!.card.title).toBe("Fake Other Kind");
  });

  it("keeps the earlier theatrical row when there is no streaming one", async () => {
    const db = newBoardDb({ calendar: [
      { tmdb_id: 6, media_type: "movie", title: "Fake Late", release_date: "2026-10-30", entry_type: "Movie", platform_or_distributor: "PVR" },
      { tmdb_id: 6, media_type: "movie", title: "Fake Early", release_date: "2026-10-24", entry_type: "Movie", platform_or_distributor: "PVR" },
    ] });
    const out = await listCandidates(boardSql(db), delhi, TODAY);
    expect(out.map((c) => c.card.title)).toEqual(["Fake Early"]);
  });

  it("takes the 20 most popular, with calendar-only rows counting as popularity 0", async () => {
    const releases = Array.from({ length: 22 }, (_, i) => rel(100 + i, "2026-10-25", i + 1)); // popularity 1..22
    const db = newBoardDb({
      releases,
      calendar: [{ tmdb_id: 500, media_type: "movie", title: "Fake Cal Only", release_date: "2026-10-25", entry_type: "Movie", platform_or_distributor: "PVR" }],
    });
    const out = await listCandidates(boardSql(db), delhi, TODAY);
    expect(out).toHaveLength(20);
    expect(out[0].card.tmdbId).toBe(121);
    expect(out[0].popularity).toBe(22);
    expect(out.map((c) => c.card.tmdbId)).not.toContain(500);
    expect(out.map((c) => c.card.tmdbId)).not.toContain(100); // popularity 1, the least popular release
    expect(out.map((c) => c.card.tmdbId)).not.toContain(101);
    const small = await listCandidates(boardSql(newBoardDb({ calendar: db.calendar })), delhi, TODAY);
    expect(small[0]).toMatchObject({ popularity: 0 });
  });

  it("fetches every candidate's popularity and hook in one statement each, not one per title", async () => {
    const db = newBoardDb({ releases: [rel(1, "2026-10-22"), rel(2, "2026-10-23"), rel(3, "2026-10-24")] });
    await listCandidates(boardSql(db), delhi, TODAY);
    expect(db.calls.filter((c) => c.text.includes("MAX(popularity)"))).toHaveLength(1);
    expect(db.calls.filter((c) => c.text.includes("FROM title_locations"))).toHaveLength(1);
  });

  it("attaches the best hook for this city: filmed over set, carrying the landmark", async () => {
    const loc = (tmdb_id: number, kind: "filmed" | "set", landmark: string | null, city_slug = "delhi") =>
      ({ tmdb_id, media_type: "movie", city_slug, kind, source: "both", landmark_label: landmark });
    const db = newBoardDb({
      releases: [rel(1, "2026-10-22"), rel(2, "2026-10-22"), rel(3, "2026-10-22"), rel(4, "2026-10-22")],
      titleLocations: [
        loc(1, "set", null), loc(1, "filmed", "Chandni Chowk"),
        loc(2, "set", null),
        loc(3, "filmed", "Gateway of India", "mumbai"),
      ],
    });
    const out = await listCandidates(boardSql(db), delhi, TODAY);
    const by = (id: number) => out.find((c) => c.card.tmdbId === id)!.hook;
    expect(by(1)).toEqual({ kind: "filmed", placeName: "Delhi", landmark: "Chandni Chowk", source: "both" });
    expect(by(2)).toEqual({ kind: "set", placeName: "Delhi", landmark: null, source: "both" });
    expect(by(3)).toBeNull(); // filmed in Mumbai, not here
    expect(by(4)).toBeNull();
  });

  it("returns candidates with nothing resolved yet", async () => {
    const [c] = await listCandidates(boardSql(newBoardDb({ releases: [rel(1, "2026-10-22")] })), delhi, TODAY);
    expect(c).toMatchObject({ entityId: null, heat: null, placeTagNames: null });
  });
});

// --- buildBoard ---------------------------------------------------------

const cells = (...affinities: number[]): Omit<HeatCell, "neighbourhood">[] =>
  affinities.map((affinity, i) => ({ lat: 28.55 + i * 0.001, lon: 77.2, geohash: `g${i}`, affinity, popularity: 0.1 }));
const ok = <T,>(data: T): EvidenceSection<T> => ({ status: "ok", data, provenance: [{ source: "qloo", call: "x", params: {}, limits: "l" }] });
const tagSection = (...names: string[]) => ok(names.map((name, i) => ({ tagId: `t${i}`, name, affinity: 0.5 })));

function setup(init: Partial<BoardDb> = {}) {
  const db = newBoardDb(init);
  const enqueueWarm = vi.fn();
  const onError = vi.fn();
  const deps = { sql: boardSql(db), enqueueWarm, onError };
  const resolved = (id: number, entityId: string) =>
    db.entities.push({ tmdb_id: id, media_type: "movie", qloo_entity_id: entityId, method: "imdb", not_found: false, resolved_at: daysAgo(1) });
  const missed = (id: number, ageDays: number) =>
    db.entities.push({ tmdb_id: id, media_type: "movie", qloo_entity_id: null, method: null, not_found: true, resolved_at: daysAgo(ageDays) });
  const heat = (entityId: string, ...affinities: number[]) => seedEvidence(db, entityId, "delhi", "heatmap", ok(cells(...affinities)), daysAgo(1));
  const tags = (entityId: string, ...names: string[]) => seedEvidence(db, entityId, "delhi", "place_tags", tagSection(...names), daysAgo(1));
  return { db, deps, enqueueWarm, onError, resolved, missed, heat, tags };
}

describe("buildBoard buckets", () => {
  it("ranks a resolved title with heatmap evidence and says why", async () => {
    const s = setup({
      releases: [rel(1, "2026-10-22", 10, "Fake Alpha"), rel(2, "2026-10-23", 5, "Fake Beta")],
      neighbourhoods: [{ name: "Hauz Khas", lat: 28.55, lon: 77.2 }],
      titleLocations: [{ tmdb_id: 1, media_type: "movie", city_slug: "delhi", kind: "filmed", source: "both", landmark_label: "Chandni Chowk" }],
    });
    s.resolved(1, "fx-a"); s.resolved(2, "fx-b");
    s.heat("fx-a", 0.9, 0.5); s.heat("fx-b", 0.3);
    s.tags("fx-a", "Gym"); s.tags("fx-b", "Gym");
    const board = await buildBoard(s.deps, delhi, "cafe", TODAY);
    expect(board).toMatchObject({ city: "delhi", cityName: "Delhi", businessType: "cafe", pending: [], unresolved: [] });
    expect(board.ranked.map((c) => c.title)).toEqual(["Fake Alpha", "Fake Beta"]);
    expect(board.ranked[0].why).toBe("#1 of 2 for Delhi audiences · strongest around Hauz Khas · shot in Chandni Chowk");
    expect(board.ranked[0].score).toBeCloseTo(0.55 + 0.1 + 0.1, 2);
    expect(board.ranked[1].why).toMatch(/^#2 of 2 for Delhi audiences/);
    expect(s.enqueueWarm).not.toHaveBeenCalled();
  });

  it("puts a resolved title whose heatmap is not cached in pending and queues it", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22")] });
    s.resolved(1, "fx-a");
    const board = await buildBoard(s.deps, delhi, "cafe", TODAY);
    expect(board.ranked).toEqual([]);
    expect(board.pending).toHaveLength(1);
    expect(board.pending[0]).toMatchObject({ tmdbId: 1, score: null, why: null });
    expect(s.enqueueWarm).toHaveBeenCalledTimes(1);
    expect(s.enqueueWarm).toHaveBeenCalledWith(delhi, "cafe", { tmdbId: 1, mediaType: "movie" });
  });

  it("treats a stale heatmap as not cached", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22")] });
    s.resolved(1, "fx-a");
    seedEvidence(s.db, "fx-a", "delhi", "heatmap", ok(cells(0.5)), daysAgo(3.5));
    expect((await buildBoard(s.deps, delhi, "cafe", TODAY)).pending).toHaveLength(1);
  });

  it("puts a title with no qloo_entities row in pending and queues it", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22")] });
    const board = await buildBoard(s.deps, delhi, "cafe", TODAY);
    expect(board.pending.map((c) => c.tmdbId)).toEqual([1]);
    expect(s.enqueueWarm).toHaveBeenCalledTimes(1);
  });

  it("puts a fresh not-found title in unresolved, never ranked and never queued (Review Focus 1)", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22", 9, "Fake Known"), rel(2, "2026-10-22", 8, "Fake Unknown")] });
    s.resolved(1, "fx-a"); s.heat("fx-a", 0.6); s.tags("fx-a", "Gym");
    s.missed(2, 1);
    const board = await buildBoard(s.deps, delhi, "cafe", TODAY);
    expect(board.unresolved).toHaveLength(1);
    expect(board.unresolved[0]).toMatchObject({ title: "Fake Unknown", score: null, why: null });
    expect(board.ranked.every((c) => c.score !== null && c.why !== null)).toBe(true);
    expect(board.ranked.map((c) => c.title)).toEqual(["Fake Known"]);
    expect(s.enqueueWarm).not.toHaveBeenCalled();
  });

  it("a not-found row older than 3 days is stale: pending and queued for another look", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22")] });
    s.missed(1, 4);
    const board = await buildBoard(s.deps, delhi, "cafe", TODAY);
    expect(board.unresolved).toEqual([]);
    expect(board.pending).toHaveLength(1);
    expect(s.enqueueWarm).toHaveBeenCalledTimes(1);
  });

  it("ranks a title whose heatmap came back empty, with local affinity 0, and no NaN", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22"), rel(2, "2026-10-22")] });
    s.resolved(1, "fx-a"); s.resolved(2, "fx-b");
    seedEvidence(s.db, "fx-a", "delhi", "heatmap", { status: "empty", data: null, provenance: [], note: "none" }, daysAgo(1));
    seedEvidence(s.db, "fx-b", "delhi", "heatmap", { status: "empty", data: null, provenance: [], note: "none" }, daysAgo(1));
    const board = await buildBoard(s.deps, delhi, "cafe", TODAY);
    expect(board.ranked).toHaveLength(2);
    board.ranked.forEach((c) => { expect(Number.isFinite(c.score)).toBe(true); expect(c.why).toContain("no local signal yet"); });
    expect(board.pending).toEqual([]);
  });

  it("uses cached place tags for business fit, and still ranks when they are not cached (queueing them)", async () => {
    const s = setup({ releases: [rel(1, "2026-10-30", 2), rel(2, "2026-10-30", 1)] });
    s.resolved(1, "fx-a"); s.resolved(2, "fx-b");
    s.heat("fx-a", 0.5); s.heat("fx-b", 0.5);
    s.tags("fx-a", "Cafe", "Coffee Shop", "Bakery", "Gym");
    const board = await buildBoard(s.deps, delhi, "cafe", TODAY);
    expect(board.ranked.map((c) => c.tmdbId)).toEqual([1, 2]);
    expect(board.ranked[0].score!).toBeGreaterThan(board.ranked[1].score!);
    expect(s.enqueueWarm).toHaveBeenCalledTimes(1);
    expect(s.enqueueWarm).toHaveBeenCalledWith(delhi, "cafe", { tmdbId: 2, mediaType: "movie" });
  });

  it("names the neighbourhood of the single strongest cell as topHood, read once", async () => {
    const s = setup({
      releases: [rel(1, "2026-10-22")],
      neighbourhoods: [{ name: "Hauz Khas", lat: 28.5494, lon: 77.2001 }, { name: "Saket", lat: 28.5245, lon: 77.2066 }],
    });
    s.resolved(1, "fx-a");
    seedEvidence(s.db, "fx-a", "delhi", "heatmap", ok([
      { lat: 28.5494, lon: 77.2001, geohash: "a", affinity: 0.4, popularity: 0 },
      { lat: 28.5245, lon: 77.2066, geohash: "b", affinity: 0.9, popularity: 0 },
    ]), daysAgo(1));
    const board = await buildBoard(s.deps, delhi, "cafe", TODAY);
    expect(board.ranked[0].why).toContain("strongest around Saket");
    expect(s.db.calls.filter((c) => c.text.includes("FROM neighbourhoods"))).toHaveLength(1);
  });

  it("still ranks, without a neighbourhood, when the neighbourhoods read fails", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22")], fail: { neighbourhoods: true } });
    s.resolved(1, "fx-a"); s.heat("fx-a", 0.5);
    const board = await buildBoard(s.deps, delhi, "cafe", TODAY);
    expect(board.ranked[0].why).toContain("strong local affinity");
    expect(s.onError).toHaveBeenCalled();
  });

  it("never reads a heatmap or place tags for another city", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22")] });
    s.resolved(1, "fx-a");
    seedEvidence(s.db, "fx-a", "mumbai", "heatmap", ok(cells(0.9)), daysAgo(1));
    expect((await buildBoard(s.deps, delhi, "cafe", TODAY)).pending).toHaveLength(1);
  });

  it("an all-empty city ranks every card, none pending", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22"), rel(2, "2026-10-22"), rel(3, "2026-10-22")] });
    [1, 2, 3].forEach((i) => { s.resolved(i, `fx-${i}`); seedEvidence(s.db, `fx-${i}`, "delhi", "heatmap", { status: "empty", data: [], provenance: [] }, daysAgo(1)); });
    const board = await buildBoard(s.deps, delhi, "d2c_food", TODAY);
    expect(board.ranked).toHaveLength(3);
    expect(board.businessType).toBe("d2c_food");
  });

  it("reads the cache in one entity query and never needs a Qloo or resolver dependency", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22"), rel(2, "2026-10-23"), rel(3, "2026-10-24")] });
    await buildBoard(s.deps, delhi, "cafe", TODAY);
    expect(s.db.calls.filter((c) => c.text.includes("FROM qloo_entities"))).toHaveLength(1);
    // buildBoard's deps carry no client at all: warming is behind enqueueWarm.
    expect(Object.keys(s.deps).sort()).toEqual(["enqueueWarm", "onError", "sql"]);
  });

  it("a failing enqueue does not fail the board", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22")] });
    s.enqueueWarm.mockImplementation(() => { throw new Error("boom"); });
    const board = await buildBoard(s.deps, delhi, "cafe", TODAY);
    expect(board.pending).toHaveLength(1);
    expect(s.onError).toHaveBeenCalled();
  });

  it("rounds scores for the wire", async () => {
    const s = setup({ releases: [rel(1, "2026-10-22"), rel(2, "2026-10-22")] });
    s.resolved(1, "fx-a"); s.resolved(2, "fx-b");
    s.heat("fx-a", 0.9); s.heat("fx-b", 0.2);
    s.tags("fx-a", "Cafe", "Gym", "Spa");
    const board = await buildBoard(s.deps, delhi, "cafe", TODAY);
    for (const c of board.ranked) expect(c.score).toBe(Math.round(c.score! * 1000) / 1000);
  });
});

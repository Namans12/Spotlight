import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvidenceSection, NamedEntity, Venue } from "../../../../shared/types/pulse.js";
import { createRateLimiter } from "../http/rateLimit.js";
import { createRouter } from "../http/router.js";
import { RateLimitedError } from "../qloo/limiter.js";
import { fixtureDeps, type FixtureOverrides } from "../testing/fakes.js";
import { briefHandler } from "./brief.js";
import { planNightHandler } from "./planNight.js";

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

async function start(over: FixtureOverrides = {}, planLimiter = createRateLimiter({ max: 100_000, windowMs: 60_000 })) {
  const deps = fixtureDeps(over);
  const route = createRouter({
    "GET /plan-night": planNightHandler({ ...deps, rateLimiter: planLimiter }),
    "GET /brief": briefHandler(deps),
  });
  server = createServer((req, res) => { void route(req, res, new URL(req.url ?? "/", "http://pulse.local")); });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    deps,
    get: (qs: string, headers: Record<string, string> = {}) => fetch(`${base}/plan-night?${qs}`, { headers }),
    brief: (qs: string) => fetch(`${base}/brief?${qs}`),
  };
}

const GOOD = "city=delhi&mediaType=movie&tmdbId=1";
const venue = (i: number, name = `Spot ${i}`, tags: string[] = []): Venue =>
  ({ entityId: `v${i}`, name, address: `${i} Lane`, lat: null, lon: null, priceLevel: 2, tags, affinity: 0.5 });
const placesOf = (venues: Venue[], extra: Partial<EvidenceSection<Venue[]>> = {}): EvidenceSection<Venue[]> =>
  ({ status: "ok", data: venues, provenance: [{ source: "qloo", call: "recommend_places", params: { entity_id: "fx-entity-1" }, limits: "L" }], ...extra });
const artistsOf = (n: number): EvidenceSection<NamedEntity[]> =>
  ({ status: "ok", data: Array.from({ length: n }, (_, i) => ({ entityId: `a${i}`, name: `Artist ${i}`, affinity: 0.4 })), provenance: [{ source: "qloo", call: "recommend_artists", params: { entity_id: "fx-entity-1" }, limits: "A" }] });

describe("GET /plan-night validation", () => {
  it.each([
    ["missing city", "mediaType=movie&tmdbId=1", "unknown_city"],
    ["unknown city", "city=atlantis&mediaType=movie&tmdbId=1", "unknown_city"],
    ["inherited key as city", "city=constructor&mediaType=movie&tmdbId=1", "unknown_city"],
    ["missing mediaType", "city=delhi&tmdbId=1", "bad_request"],
    ["bad mediaType", "city=delhi&mediaType=anime&tmdbId=1", "bad_request"],
    ["missing tmdbId", "city=delhi&mediaType=movie", "bad_request"],
    ["zero tmdbId", "city=delhi&mediaType=movie&tmdbId=0", "bad_request"],
    ["fractional tmdbId", "city=delhi&mediaType=movie&tmdbId=1.5", "bad_request"],
    ["huge tmdbId", "city=delhi&mediaType=movie&tmdbId=99999999999999999999", "bad_request"],
  ])("answers 400 %s before the limiter, the gate or any call", async (_n, qs, error) => {
    const isKnown = vi.fn(async () => true);
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    const { get, deps } = await start({ isKnown }, limiter);
    for (let i = 0; i < 3; i++) {
      const res = await get(qs);
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(await res.json()).toEqual({ error });
    }
    expect(isKnown).not.toHaveBeenCalled();
    expect(Object.keys(deps.qlooCalls)).toEqual([]);
    // The budget (1) is untouched by the three failures.
    expect((await get(GOOD)).status).toBe(200);
  });

  it("does not require a business type", async () => {
    const { get } = await start();
    expect((await get(GOOD)).status).toBe(200);
  });
});

describe("GET /plan-night rate limit (R35)", () => {
  function limited(max = 20) {
    let t = 1_000_000;
    const limiter = createRateLimiter({ max, windowMs: 60_000, now: () => t });
    return { limiter, advance: (ms: number) => { t += ms; } };
  }

  it("lets 20 through and answers the 21st 429 with Retry-After, before the gate or any work", async () => {
    const { limiter, advance } = limited(20);
    const isKnown = vi.fn(async () => true);
    const resolve = vi.fn(async () => ({ entityId: "fx-entity-1", method: "imdb" as const }));
    const { get, deps } = await start({ isKnown, resolve }, limiter);
    for (let i = 0; i < 20; i++) { advance(10); expect((await get(GOOD)).status).toBe(200); }
    const known = isKnown.mock.calls.length;
    const resolved = resolve.mock.calls.length;
    const qloo = { ...deps.qlooCalls };
    const res = await get(GOOD);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(isKnown.mock.calls.length).toBe(known);
    expect(resolve.mock.calls.length).toBe(resolved);
    expect(deps.qlooCalls).toEqual(qloo);
  });

  it("keys on the rightmost X-Forwarded-For entry", async () => {
    const { limiter } = limited(1);
    const { get } = await start({}, limiter);
    expect((await get(GOOD, { "X-Forwarded-For": "1.1.1.1, 203.0.113.9" })).status).toBe(200);
    expect((await get(GOOD, { "X-Forwarded-For": "2.2.2.2, 203.0.113.9" })).status).toBe(429);
    expect((await get(GOOD, { "X-Forwarded-For": "203.0.113.10" })).status).toBe(200);
  });

  it("is a separate budget from /brief: spending it leaves /brief available", async () => {
    const { limiter } = limited(1);
    const { get, brief } = await start({}, limiter);
    expect((await get(GOOD)).status).toBe(200);
    expect((await get(GOOD)).status).toBe(429);
    const res = await brief("city=delhi&type=cafe&mediaType=movie&tmdbId=1");
    expect(res.status).toBe(200);
    await res.text();
  });
});

describe("GET /plan-night known-title gate (R35, R22)", () => {
  it("answers 404 unknown_title with NO resolve, header or Qloo call", async () => {
    const resolve = vi.fn();
    const header = vi.fn();
    const { get, deps } = await start({ isKnown: async () => false, resolve, header });
    const res = await get(GOOD);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "unknown_title" });
    expect(resolve).not.toHaveBeenCalled();
    expect(header).not.toHaveBeenCalled();
    expect(Object.keys(deps.qlooCalls)).toEqual([]);
    expect(deps.db.calls).toEqual([]);
  });

  it("asks isKnown with the validated key", async () => {
    const isKnown = vi.fn(async () => true);
    const { get } = await start({ isKnown });
    await get("city=mumbai&mediaType=tv&tmdbId=42");
    expect(isKnown).toHaveBeenCalledWith({ tmdbId: 42, mediaType: "tv" });
  });

  it("answers 503 when the known-title check itself fails, still before any work", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const resolve = vi.fn();
    const { get } = await start({ isKnown: async () => { throw new Error("db down"); }, resolve });
    const res = await get(GOOD);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(resolve).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("GET /plan-night happy path", () => {
  it("returns the title, city name and capped, filtered places and artists", async () => {
    const venues = [
      venue(1), venue(2, "Grand Hotel Lobby Bar"), venue(3), venue(4, "Banquet Royale"), venue(5),
      venue(6, "Quiet Spot", ["Boutique Resort"]), venue(7), venue(8), venue(9), venue(10, "Hotel Chai"), venue(11),
    ];
    const places = vi.fn(async () => placesOf(venues));
    const artists = vi.fn(async () => artistsOf(9));
    const { get } = await start({ places, artists });
    const res = await get(GOOD);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json() as { title: string | null; cityName: string; places: EvidenceSection<Venue[]>; artists: EvidenceSection<NamedEntity[]> };
    expect(body.title).toBe("Fixture Film");
    expect(body.cityName).toBe("Delhi");
    expect(body.places.status).toBe("ok");
    expect(body.places.data!.map((v) => v.name)).toEqual(["Spot 1", "Spot 3", "Spot 5", "Spot 7", "Spot 8", "Spot 9"]);
    expect(body.places.provenance).toEqual(placesOf([]).provenance);
    expect(body.artists.status).toBe("ok");
    expect(body.artists.data!).toHaveLength(5);
    expect(body.artists.data![0].name).toBe("Artist 0");
    expect(body.artists.provenance).toEqual(artistsOf(1).provenance);
  });

  it("asks Qloo for places filtered to food-and-drink place tags (never unfiltered) and for artists once", async () => {
    const places = vi.fn(async () => placesOf([venue(1)]));
    const artists = vi.fn(async () => artistsOf(1));
    const findTags = vi.fn(async (q: string) => [1, 2, 3].map((n) => ({ tagId: `t-${q}-${n}`, name: `${q} ${n}` })));
    const { get } = await start({ places, artists, findTags });
    await (await get(GOOD)).text();
    expect(findTags.mock.calls.map((c) => [c[0], c[1]])).toEqual([["restaurant", "place"], ["cafe", "place"], ["bar", "place"], ["dessert", "place"]]);
    expect(places).toHaveBeenCalledTimes(1);
    // The first two tags of each query, in query order.
    expect(places.mock.calls[0]).toEqual([
      "fx-entity-1", expect.objectContaining({ slug: "delhi" }),
      ["t-restaurant-1", "t-restaurant-2", "t-cafe-1", "t-cafe-2", "t-bar-1", "t-bar-2", "t-dessert-1", "t-dessert-2"],
    ]);
    expect(artists).toHaveBeenCalledTimes(1);
  });

  it("dedupes tag ids across queries", async () => {
    const places = vi.fn(async () => placesOf([venue(1)]));
    const { get } = await start({ places }); // the fixture's findTags answers the same two ids for every query
    await (await get(GOOD)).text();
    expect(places.mock.calls[0][2]).toEqual(["fx-tag-place-1", "fx-tag-place-2"]);
  });

  it("looks the tag ids up inside the cache fetch: a cache hit costs no findTags call", async () => {
    const { get, deps } = await start();
    await (await get(GOOD)).text();
    const tagCalls = deps.qlooCalls.findTags;
    expect(tagCalls).toBe(4);
    await (await get(GOOD)).text();
    expect(deps.qlooCalls.findTags).toBe(tagCalls);
    expect(deps.qlooCalls.places).toBe(1);
  });

  it("shares the brief's per-process tag lookups: the queries both use are asked once", async () => {
    const { get, brief, deps } = await start();
    await (await brief("city=delhi&type=cafe&mediaType=movie&tmdbId=1")).text(); // cafe, coffee, bakery, dessert
    expect(deps.qlooCalls.findTags).toBe(4);
    await (await get(GOOD)).text(); // restaurant, cafe, bar, dessert: only restaurant and bar are new
    expect(deps.qlooCalls.findTags).toBe(6);
  });

  it("when the tag lookup fails the places are degraded, say why, and are NOT cached", async () => {
    const places = vi.fn(async () => placesOf([venue(1)]));
    const { get, deps } = await start({ places, findTags: async () => { throw new Error("qloo down"); } });
    const body = await (await get(GOOD)).json() as { places: EvidenceSection<Venue[]>; artists: EvidenceSection<NamedEntity[]> };
    expect(places.mock.calls[0][2]).toEqual([]);
    expect(body.places).toMatchObject({ status: "degraded", note: "Venue category filter was unavailable; results are broader than usual." });
    expect(body.places.data!.map((v) => v.name)).toEqual(["Spot 1"]);
    expect(body.artists.status).toBe("ok");
    expect(deps.db.evidence.has("fx-entity-1|delhi|places_open")).toBe(false);
    expect(deps.errors.some((e) => e.context.startsWith("findTags("))).toBe(true);
    // The next request retries the tags and, once they work, caches the proper answer.
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    const healthy = await start({ places, db: deps.db });
    const again = await (await healthy.get(GOOD)).json() as { places: EvidenceSection<Venue[]> };
    expect(again.places.status).toBe("ok");
    expect(deps.db.evidence.has("fx-entity-1|delhi|places_open")).toBe(true);
  });

  it("goes through the evidence cache with kinds places_open and artists (never places)", async () => {
    const { get, deps } = await start();
    await (await get(GOOD)).text();
    expect([...deps.db.evidence.keys()].sort()).toEqual(["fx-entity-1|delhi|places_open", "fx-entity-1||artists"].sort());
    expect(deps.db.upserts.map((r) => r.kind).sort()).toEqual(["artists", "places_open"]);
  });

  it("serves the second request from the cache without calling Qloo again", async () => {
    const places = vi.fn(async () => placesOf([venue(1)]));
    const artists = vi.fn(async () => artistsOf(2));
    const { get } = await start({ places, artists });
    await (await get(GOOD)).text();
    const body = await (await get(GOOD)).json() as { places: EvidenceSection<Venue[]> };
    expect(places).toHaveBeenCalledTimes(1);
    expect(artists).toHaveBeenCalledTimes(1);
    expect(body.places.data![0].name).toBe("Spot 1");
  });

  it("falls back to a null title when the header lookup fails or knows nothing", async () => {
    const onNull = await start({ header: async () => null });
    expect((await (await onNull.get(GOOD)).json() as { title: unknown }).title).toBeNull();
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    const onThrow = await start({ header: async () => { throw new Error("tmdb down"); } });
    const res = await onThrow.get(GOOD);
    expect(res.status).toBe(200);
    const body = await res.json() as { title: unknown; places: EvidenceSection<unknown> };
    expect(body.title).toBeNull();
    expect(body.places.status).toBe("ok");
    expect(onThrow.deps.errors.map((e) => e.context)).toContain("header");
  });

  it("keeps a degraded section's status and note, capping its data", async () => {
    const places = vi.fn(async () => placesOf([venue(1), venue(2)], { status: "degraded", note: "partial answer" }));
    const { get } = await start({ places });
    const body = await (await get(GOOD)).json() as { places: EvidenceSection<Venue[]> };
    expect(body.places.status).toBe("degraded");
    expect(body.places.note).toBe("partial answer");
    expect(body.places.data).toHaveLength(2);
  });

  it("says so when every place was a hotel or banquet hall, keeping provenance", async () => {
    const places = vi.fn(async () => placesOf([venue(1, "Hotel One"), venue(2, "Banquet Two")]));
    const { get } = await start({ places });
    const body = await (await get(GOOD)).json() as { places: EvidenceSection<Venue[]> };
    expect(body.places.status).toBe("empty");
    expect(body.places.data).toBeNull();
    expect(body.places.note).toMatch(/hotel|banquet/i);
    expect(body.places.provenance).toEqual(placesOf([]).provenance);
  });

  it("passes an empty section from Qloo through untouched", async () => {
    const empty: EvidenceSection<Venue[]> = { status: "empty", data: null, provenance: [], note: "Qloo returned nothing." };
    const { get } = await start({ places: async () => empty });
    const body = await (await get(GOOD)).json() as { places: EvidenceSection<Venue[]> };
    expect(body.places).toEqual(empty);
  });
});

describe("GET /plan-night cache separation (R36)", () => {
  const NOW = new Date("2026-10-21T10:00:00Z");

  it("does not serve a cached `places` row (the brief's tag-filtered venues) to plan-night", async () => {
    const places = vi.fn(async () => placesOf([venue(1, "Open Spot")]));
    const { get, deps } = await start({ places, now: () => NOW });
    deps.db.evidence.set("fx-entity-1|delhi|places", {
      entity_id: "fx-entity-1", city_slug: "delhi", kind: "places", params: {}, status: "ok", fetched_at: NOW,
      payload: placesOf([venue(99, "Filtered Cafe")]),
    });
    const body = await (await get(GOOD)).json() as { places: EvidenceSection<Venue[]> };
    expect(places).toHaveBeenCalledTimes(1);
    expect(body.places.data!.map((v) => v.name)).toEqual(["Open Spot"]);
  });

  it("does not touch the `places` row when it writes places_open", async () => {
    const cached = placesOf([venue(99, "Filtered Cafe")]);
    const { get, deps } = await start({ now: () => NOW });
    const row = { entity_id: "fx-entity-1", city_slug: "delhi", kind: "places", params: {}, status: "ok", fetched_at: NOW, payload: cached };
    deps.db.evidence.set("fx-entity-1|delhi|places", row);
    await (await get(GOOD)).text();
    expect(deps.db.evidence.get("fx-entity-1|delhi|places")).toBe(row);
    expect(deps.db.upserts.some((u) => u.kind === "places")).toBe(false);
    expect(deps.db.evidence.has("fx-entity-1|delhi|places_open")).toBe(true);
  });

  it("does not leak plan-night's unfiltered venues into the brief's venues section", async () => {
    const places = vi.fn(async (_id: string, _c: unknown, tags: string[]) => placesOf([venue(1, tags.length ? "Tagged Cafe" : "Open Spot")]));
    const { get, brief } = await start({ places, now: () => NOW });
    await (await get(GOOD)).text();
    const text = await (await brief("city=delhi&type=cafe&mediaType=movie&tmdbId=1")).text();
    const venues = text.trimEnd().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "section" && e.key === "venues");
    expect(venues.section.data.map((v: Venue) => v.name)).toEqual(["Tagged Cafe"]);
  });

  it("shares the brief's city-independent artists cache", async () => {
    const artists = vi.fn(async () => artistsOf(3));
    const { get, brief } = await start({ artists, now: () => NOW });
    await (await brief("city=delhi&type=cafe&mediaType=movie&tmdbId=1")).text();
    const body = await (await get(GOOD)).json() as { artists: EvidenceSection<NamedEntity[]> };
    expect(artists).toHaveBeenCalledTimes(1);
    expect(body.artists.data).toHaveLength(3);
  });
});

describe("GET /plan-night failures stay sections, never a 500", () => {
  const RESOLVE_FAILED = "Qloo could not be reached to look this title up, so there is no taste data for it right now. Try again shortly.";
  const NO_ENTITY = "Qloo has no entity for this title yet, so there is no taste data for it.";

  it("turns a throwing resolve into two fixed-sentence error sections with status 200, no Qloo call", async () => {
    const { get, deps } = await start({ resolve: async () => { throw new Error("secret upstream detail"); } });
    const res = await get(GOOD);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("secret upstream detail");
    const body = JSON.parse(text);
    for (const k of ["places", "artists"]) {
      expect(body[k]).toEqual({ status: "error", data: null, provenance: [], note: RESOLVE_FAILED });
    }
    expect(body.title).toBe("Fixture Film");
    expect(deps.qlooCalls.places ?? 0).toBe(0);
    expect(deps.errors.map((e) => e.context)).toContain("resolveTitle");
  });

  it("turns an unresolved title into two empty sections with the exact note", async () => {
    const { get, deps } = await start({ resolve: async () => ({ entityId: null, reason: "not_in_qloo" as const }) });
    const body = await (await get(GOOD)).json();
    for (const k of ["places", "artists"]) {
      expect(body[k]).toEqual({ status: "empty", data: null, provenance: [], note: NO_ENTITY });
    }
    expect(deps.qlooCalls.places ?? 0).toBe(0);
  });

  it("sanitises an error section from the client: fixed sentence, original to onError", async () => {
    const leaky: EvidenceSection<Venue[]> = { status: "error", data: null, provenance: [], note: "Qloo call failed: 401 key sk-secret" };
    const { get, deps } = await start({ places: async () => leaky });
    const text = await (await get(GOOD)).text();
    expect(text).not.toContain("sk-secret");
    const body = JSON.parse(text);
    expect(body.places.status).toBe("error");
    expect(body.places.note).toBe("This section could not be loaded just now. Try again shortly.");
    expect(deps.errors.some((e) => String((e.err as Error).message).includes("sk-secret"))).toBe(true);
    expect(body.artists.status).toBe("ok");
  });

  it("says Qloo is busy when the original error mentions rate limiting", async () => {
    const busy: EvidenceSection<Venue[]> = { status: "error", data: null, provenance: [], note: "Qloo call failed: 429 rate limit" };
    const { get } = await start({ places: async () => busy });
    const body = await (await get(GOOD)).json();
    expect(body.places.note).toMatch(/busy/i);
  });

  it("turns a throwing Qloo call into a fixed error section for that section only", async () => {
    const { get, deps } = await start({ artists: async () => { throw new RateLimitedError("slow down sk-x"); } });
    const res = await get(GOOD);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("sk-x");
    const body = JSON.parse(text);
    expect(body.artists.status).toBe("error");
    expect(body.artists.note).toMatch(/busy/i);
    expect(body.places.status).toBe("ok");
    expect(deps.db.evidence.has("fx-entity-1|delhi|places_open")).toBe(true);
    expect(deps.db.evidence.has("fx-entity-1||artists")).toBe(false);
  });

  it("survives a database failure on the evidence read as error sections, not a 500", async () => {
    const { newDb } = await import("../testing/fakes.js");
    const db = newDb({ fail: { evidenceRead: true } });
    const { get } = await start({ db });
    const res = await get(GOOD);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.places.status).toBe("error");
    expect(body.artists.status).toBe("error");
  });
});

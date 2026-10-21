import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "../http/rateLimit.js";
import { createRouter } from "../http/router.js";
import type { LocationsSql } from "../db/locations.js";
import { titleLocationsHandler } from "./titleLocations.js";

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

type Row = Record<string, unknown>;

async function start(rows: Row[] | (() => Promise<Row[]>) = [], rateLimiter = createRateLimiter({ max: 100_000, windowMs: 60_000 })) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((s: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: s.join("?").replace(/\s+/g, " ").trim(), values });
    return typeof rows === "function" ? rows() : Promise.resolve(rows);
  }) as unknown as LocationsSql;
  const onError = vi.fn();
  const route = createRouter({ "GET /title-locations": titleLocationsHandler({ sql, rateLimiter, onError }) });
  server = createServer((req, res) => { void route(req, res, new URL(req.url ?? "/", "http://pulse.local")); });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { calls, onError, get: (qs: string, headers: Record<string, string> = {}) => fetch(`${base}/title-locations?${qs}`, { headers }) };
}

const GOOD = "mediaType=movie&tmdbId=42";

describe("GET /title-locations validation", () => {
  it.each([
    ["missing mediaType", "tmdbId=1"],
    ["bad mediaType", "mediaType=anime&tmdbId=1"],
    ["missing tmdbId", "mediaType=movie"],
    ["zero tmdbId", "mediaType=movie&tmdbId=0"],
    ["negative tmdbId", "mediaType=movie&tmdbId=-4"],
    ["fractional tmdbId", "mediaType=movie&tmdbId=1.5"],
    ["non-numeric tmdbId", "mediaType=movie&tmdbId=12abc"],
    ["huge tmdbId", "mediaType=movie&tmdbId=99999999999999999999"],
  ])("answers 400 bad_request for %s, with no database call", async (_n, qs) => {
    const { get, calls } = await start();
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(calls).toEqual([]);
  });

  it("needs no city or type parameter", async () => {
    const { get } = await start();
    expect((await get(GOOD)).status).toBe(200);
  });
});

describe("GET /title-locations rate limit", () => {
  it("answers 429 rate_limited with Retry-After before any database call", async () => {
    let t = 1_000_000;
    const limiter = createRateLimiter({ max: 60, windowMs: 60_000, now: () => t });
    const { get, calls } = await start([], limiter);
    for (let i = 0; i < 60; i++) { t += 10; expect((await get(GOOD)).status).toBe(200); }
    const before = calls.length;
    const res = await get(GOOD);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBe(before);
  });

  it("does not spend the budget on invalid requests", async () => {
    const { get } = await start([], createRateLimiter({ max: 1, windowMs: 60_000 }));
    expect((await get("mediaType=nope&tmdbId=1")).status).toBe(400);
    expect((await get(GOOD)).status).toBe(200);
  });

  it("keys on the rightmost X-Forwarded-For entry", async () => {
    const { get } = await start([], createRateLimiter({ max: 1, windowMs: 60_000 }));
    expect((await get(GOOD, { "X-Forwarded-For": "1.1.1.1, 203.0.113.9" })).status).toBe(200);
    expect((await get(GOOD, { "X-Forwarded-For": "2.2.2.2, 203.0.113.9" })).status).toBe(429);
  });
});

describe("GET /title-locations answers", () => {
  it("returns [] for an unknown or unmatched title (no 404)", async () => {
    const { get } = await start([]);
    const res = await get(GOOD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("queries only title_locations with the validated key", async () => {
    const { get, calls } = await start([]);
    await get("mediaType=tv&tmdbId=77");
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("FROM title_locations");
    expect(calls[0].values).toEqual([77, "tv"]);
  });

  it("maps slugs to city names and orders filmed before set, then by city name", async () => {
    const { get } = await start([
      { city_slug: "new-york", kind: "set", source: "wikipedia", landmark_label: null },
      { city_slug: "mumbai", kind: "filmed", source: "wikidata", landmark_label: null },
      { city_slug: "delhi", kind: "set", source: "both", landmark_label: null },
      { city_slug: "delhi", kind: "filmed", source: "both", landmark_label: "Chandni Chowk" },
      { city_slug: "london", kind: "filmed", source: "wikipedia", landmark_label: "Camden" },
    ]);
    const body = await (await get(GOOD)).json();
    expect(body).toEqual([
      { city_slug: "delhi", cityName: "Delhi", kind: "filmed", landmark_label: "Chandni Chowk", source: "both" },
      { city_slug: "london", cityName: "London", kind: "filmed", landmark_label: "Camden", source: "wikipedia" },
      { city_slug: "mumbai", cityName: "Mumbai", kind: "filmed", landmark_label: null, source: "wikidata" },
      { city_slug: "delhi", cityName: "Delhi", kind: "set", landmark_label: null, source: "both" },
      { city_slug: "new-york", cityName: "New York City", kind: "set", landmark_label: null, source: "wikipedia" },
    ]);
  });

  it("drops rows whose city is not a launch city and caps the list at 20", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ city_slug: i === 0 ? "atlantis" : "delhi", kind: i % 2 ? "filmed" : "set", source: "both", landmark_label: `L${i}` }));
    const { get } = await start(many);
    const body = await (await get(GOOD)).json() as { city_slug: string }[];
    expect(body.length).toBeLessThanOrEqual(20);
    expect(body.some((r) => r.city_slug === "atlantis")).toBe(false);
  });

  it("answers 503 unavailable when the database fails, logging the real cause", async () => {
    const { get, onError } = await start(async () => { throw new Error("db down"); });
    const res = await get(GOOD);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "unavailable" });
    expect(text).not.toContain("db down");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

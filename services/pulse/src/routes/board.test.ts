import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardResponse } from "../../../../shared/types/pulse.js";
import { createRateLimiter } from "../http/rateLimit.js";
import { createRouter } from "../http/router.js";
import { boardSql, newBoardDb } from "../testing/boardFakes.js";
import { boardHandler, type BoardRouteDeps } from "./board.js";

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

const TODAY = new Date("2026-10-21T06:00:00Z");

async function start(over: Partial<BoardRouteDeps> = {}) {
  const db = newBoardDb({ releases: [{ tmdb_id: 1, media_type: "movie", title: "Fake Release", release_date: "2026-10-23", popularity: 3 }] });
  const enqueueWarm = vi.fn();
  const deps: BoardRouteDeps = {
    sql: boardSql(db),
    enqueueWarm,
    rateLimiter: createRateLimiter({ max: 100_000, windowMs: 60_000 }),
    now: () => TODAY,
    ...over,
  };
  const route = createRouter({ "GET /board": boardHandler(deps) });
  server = createServer((req, res) => { void route(req, res, new URL(req.url ?? "/", "http://pulse.local")); });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { db, enqueueWarm, deps, get: (qs: string, headers: Record<string, string> = {}) => fetch(`${base}/board?${qs}`, { headers }) };
}

describe("GET /board", () => {
  it("answers with a BoardResponse", async () => {
    const { get, enqueueWarm } = await start();
    const res = await get("city=delhi&type=cafe");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json() as BoardResponse;
    expect(body).toMatchObject({ city: "delhi", cityName: "Delhi", businessType: "cafe", ranked: [], unresolved: [] });
    expect(body.pending.map((c) => c.title)).toEqual(["Fake Release"]);
    expect(enqueueWarm).toHaveBeenCalledTimes(1);
  });

  it("answers 400 unknown_city and unknown_business_type, without spending rate budget", async () => {
    const rateLimiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    const { get } = await start({ rateLimiter });
    for (let i = 0; i < 3; i++) {
      const city = await get("city=atlantis&type=cafe");
      expect(city.status).toBe(400);
      expect(await city.json()).toEqual({ error: "unknown_city" });
      const type = await get("city=delhi&type=constructor");
      expect(type.status).toBe(400);
      expect(await type.json()).toEqual({ error: "unknown_business_type" });
    }
    expect((await get("")).status).toBe(400);
    // The one allowed request is still available.
    expect((await get("city=delhi&type=cafe")).status).toBe(200);
  });

  it("answers 429 with Retry-After once a client is over its limit, validation first", async () => {
    let t = 0;
    const rateLimiter = createRateLimiter({ max: 30, windowMs: 60_000, now: () => t });
    const { get } = await start({ rateLimiter });
    for (let i = 0; i < 30; i++) expect((await get("city=delhi&type=cafe", { "x-forwarded-for": "9.9.9.9" })).status).toBe(200);
    const limited = await get("city=delhi&type=cafe", { "x-forwarded-for": "9.9.9.9" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    // A bad city is still a 400 for a limited client, and another client is unaffected.
    expect((await get("city=atlantis&type=cafe", { "x-forwarded-for": "9.9.9.9" })).status).toBe(400);
    expect((await get("city=delhi&type=cafe", { "x-forwarded-for": "8.8.8.8" })).status).toBe(200);
  });

  it("answers 503 unavailable when the database cannot be read, and does not leak why", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { get } = await start({ sql: (() => Promise.reject(new Error("password authentication failed for user x"))) as unknown as BoardRouteDeps["sql"] });
    const res = await get("city=delhi&type=cafe");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    err.mockRestore();
  });
});

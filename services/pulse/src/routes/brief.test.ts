import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BriefEvent } from "../../../../shared/types/pulse.js";
import { createRateLimiter } from "../http/rateLimit.js";
import { createRouter } from "../http/router.js";
import { fixtureDeps, type FixtureOverrides } from "../testing/fakes.js";
import { briefHandler } from "./brief.js";

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

async function start(over: FixtureOverrides = {}) {
  const deps = fixtureDeps(over);
  const route = createRouter({ "GET /brief": briefHandler(deps) });
  server = createServer((req, res) => { void route(req, res, new URL(req.url ?? "/", "http://pulse.local")); });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { deps, get: (qs: string, headers: Record<string, string> = {}) => fetch(`${base}/brief?${qs}`, { headers }) };
}

const GOOD = "city=delhi&type=cafe&mediaType=movie&tmdbId=1";

describe("GET /brief validation", () => {
  it("answers 400 unknown_city before streaming (Review Focus 5)", async () => {
    const { get } = await start();
    const res = await get("city=atlantis&type=cafe&mediaType=movie&tmdbId=1");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "unknown_city" });
  });

  it("answers 400 unknown_business_type", async () => {
    const { get } = await start();
    const res = await get("city=delhi&type=bank&mediaType=movie&tmdbId=1");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_business_type" });
  });

  it("does not treat inherited object keys as business types", async () => {
    const { get } = await start();
    expect((await (await get("city=delhi&type=constructor&mediaType=movie&tmdbId=1")).json())).toEqual({ error: "unknown_business_type" });
  });

  it.each([
    ["missing mediaType", "city=delhi&type=cafe&tmdbId=1"],
    ["bad mediaType", "city=delhi&type=cafe&mediaType=anime&tmdbId=1"],
    ["missing tmdbId", "city=delhi&type=cafe&mediaType=movie"],
    ["zero tmdbId", "city=delhi&type=cafe&mediaType=movie&tmdbId=0"],
    ["negative tmdbId", "city=delhi&type=cafe&mediaType=movie&tmdbId=-4"],
    ["fractional tmdbId", "city=delhi&type=cafe&mediaType=movie&tmdbId=1.5"],
    ["non-numeric tmdbId", "city=delhi&type=cafe&mediaType=movie&tmdbId=12abc"],
    ["huge tmdbId", "city=delhi&type=cafe&mediaType=movie&tmdbId=99999999999999999999"],
  ])("answers 400 bad_request for %s", async (_n, qs) => {
    const { get, deps } = await start();
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(Object.keys(deps.qlooCalls)).toEqual([]);
  });
});

describe("GET /brief streaming", () => {
  it("frames one BriefEvent per line, header first and done last, with ndjson headers", async () => {
    const { get } = await start();
    const res = await get(GOOD);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text.endsWith("\n")).toBe(true);
    const events = text.trimEnd().split("\n").map((l) => JSON.parse(l) as BriefEvent);
    expect(events[0].type).toBe("header");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.filter((e) => e.type === "section")).toHaveLength(8);
  });
});

describe("GET /brief known-title gate (R22a)", () => {
  it("answers 404 unknown_title before any resolve, Qloo or header work", async () => {
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
  });

  it("asks isKnown with the validated key, and streams when it says yes", async () => {
    const isKnown = vi.fn(async () => true);
    const { get } = await start({ isKnown });
    const res = await get("city=delhi&type=cafe&mediaType=tv&tmdbId=42");
    expect(res.status).toBe(200);
    await res.text();
    expect(isKnown).toHaveBeenCalledWith({ tmdbId: 42, mediaType: "tv" });
  });

  it("answers 503 when the known-title check itself fails, still before streaming", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { get } = await start({ isKnown: async () => { throw new Error("db down"); } });
    const res = await get(GOOD);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    log.mockRestore();
  });

  it("does not run the gate for requests that fail validation", async () => {
    const isKnown = vi.fn(async () => true);
    const { get } = await start({ isKnown });
    await get("city=atlantis&type=cafe&mediaType=movie&tmdbId=1");
    expect(isKnown).not.toHaveBeenCalled();
  });
});

describe("GET /brief rate limit (R22b)", () => {
  function limited(max = 30) {
    let t = 1_000_000;
    const limiter = createRateLimiter({ max, windowMs: 60_000, now: () => t });
    return { limiter, advance: (ms: number) => { t += ms; } };
  }

  it("lets 30 through and answers the 31st 429 rate_limited with Retry-After, before any work", async () => {
    const { limiter, advance } = limited();
    const isKnown = vi.fn(async () => true);
    const { get, deps } = await start({ rateLimiter: limiter, isKnown });
    for (let i = 0; i < 30; i++) { advance(10); expect((await get(GOOD)).status).toBe(200); }
    const callsBefore = { ...deps.qlooCalls };
    const known = isKnown.mock.calls.length;
    const res = await get(GOOD);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(deps.qlooCalls).toEqual(callsBefore);
    expect(isKnown.mock.calls.length).toBe(known);
  });

  it("keys on the rightmost X-Forwarded-For entry, so a spoofed leftmost one changes nothing", async () => {
    const { limiter } = limited(2);
    const { get } = await start({ rateLimiter: limiter });
    const h = (spoof: string) => ({ "X-Forwarded-For": `${spoof}, 203.0.113.9` });
    expect((await get(GOOD, h("1.1.1.1"))).status).toBe(200);
    expect((await get(GOOD, h("2.2.2.2"))).status).toBe(200);
    expect((await get(GOOD, h("3.3.3.3"))).status).toBe(429);
    expect((await get(GOOD, { "X-Forwarded-For": "203.0.113.10" })).status).toBe(200);
  });

  it("does not spend the budget on requests that fail validation", async () => {
    const { limiter } = limited(1);
    const { get } = await start({ rateLimiter: limiter });
    expect((await get("city=atlantis&type=cafe&mediaType=movie&tmdbId=1")).status).toBe(400);
    expect((await get(GOOD)).status).toBe(200);
  });
});

/** A minimal ServerResponse: enough surface for the handler, with a close the test fires. */
function fakeRes() {
  const em = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const written: string[] = [];
  Object.assign(em, {
    headersSent: false,
    writableEnded: false,
    setHeader: vi.fn(),
    writeHead: vi.fn(function () { em.headersSent = true; return em; }),
    flushHeaders: vi.fn(),
    write: vi.fn((s: string) => { written.push(s); return true; }),
    end: vi.fn(() => { em.writableEnded = true; }),
  });
  return { res: em as unknown as ServerResponse, written, em };
}

describe("client disconnect", () => {
  it("stops writing and never drafts the campaign once the client has closed", async () => {
    const draft = vi.fn(async () => ({ status: "empty", data: null, provenance: [] }) as never);
    const slow = new Promise<never>(() => { /* never settles: the client leaves first */ });
    const deps = fixtureDeps({ draftCampaign: draft, heatmap: () => slow });
    const handler = briefHandler(deps);
    const { res, written, em } = fakeRes();
    const done = handler({ headers: {}, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage, res, new URL(`http://x/brief?${GOOD}`));
    // Wait until at least the header has been written, then hang up.
    await vi.waitFor(() => expect(written.length).toBeGreaterThan(0));
    em.emit("close");
    await done;
    const countAtClose = written.length;
    await new Promise((r) => setImmediate(r));
    expect(written.length).toBe(countAtClose);
    expect(draft).not.toHaveBeenCalled();
    expect(written.every((l) => l.endsWith("\n") && JSON.parse(l))).toBe(true);
  });
});

import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BriefEvent } from "../../../../shared/types/pulse.js";
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
  return { deps, get: (qs: string) => fetch(`${base}/brief?${qs}`) };
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
    const done = handler({} as IncomingMessage, res, new URL(`http://x/brief?${GOOD}`));
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

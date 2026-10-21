import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCity } from "../cities.js";
import { createRouter } from "../http/router.js";
import { warmHandler, type WarmRouteDeps } from "./warm.js";

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

async function start(over: Partial<WarmRouteDeps> = {}) {
  const warm = vi.fn(async () => ({ warmed: 3, failed: 1 }));
  const deps: WarmRouteDeps = { secret: "s3cret-value", warm, onError: vi.fn(), ...over };
  const route = createRouter({ "POST /warm": warmHandler(deps) });
  server = createServer((req, res) => { void route(req, res, new URL(req.url ?? "/", "http://pulse.local")); });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { deps, warm: deps.warm as ReturnType<typeof vi.fn>, post: (qs = "", headers: Record<string, string> = {}) => fetch(`${base}/warm${qs}`, { method: "POST", headers }) };
}
const bearer = (s: string) => ({ Authorization: `Bearer ${s}` });

describe("POST /warm", () => {
  it.each([
    ["no header", {}],
    ["wrong secret", bearer("nope")],
    ["a longer wrong secret", bearer("s3cret-value-and-more")],
    ["a prefix of the secret", bearer("s3cret")],
    ["the secret without Bearer", { Authorization: "s3cret-value" }],
    ["another scheme", { Authorization: "Basic s3cret-value" }],
    ["an empty bearer", { Authorization: "Bearer " }],
  ])("answers 401 for %s and starts nothing", async (_n, headers) => {
    const { post, warm } = await start();
    const res = await post("", headers);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(warm).not.toHaveBeenCalled();
  });

  it("answers 503 warm_disabled when no secret is configured, even for a request that sends one", async () => {
    const { post, warm } = await start({ secret: null });
    for (const headers of [{}, bearer("anything"), bearer("")]) {
      const res = await post("", headers);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "warm_disabled" });
    }
    expect(warm).not.toHaveBeenCalled();
  });

  it("answers 202 started at once and warms in the background", async () => {
    let release!: (r: { warmed: number; failed: number }) => void;
    const { post, warm } = await start({ warm: vi.fn(() => new Promise((r) => { release = r; })) });
    const res = await post("", bearer("s3cret-value"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true });
    expect(warm).toHaveBeenCalledWith(null); // not yet finished, yet the answer is out
    release({ warmed: 0, failed: 0 });
  });

  it("with wait=1 waits and returns the report", async () => {
    const { post, warm } = await start();
    const res = await post("?wait=1", bearer("s3cret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ warmed: 3, failed: 1 });
    expect(warm).toHaveBeenCalledWith(null);
  });

  it("limits the run to one city with ?city, and rejects an unknown one with 400", async () => {
    const { post, warm } = await start();
    await post("?wait=1&city=mumbai", bearer("s3cret-value"));
    expect(warm).toHaveBeenCalledWith(getCity("mumbai"));
    const bad = await post("?city=atlantis", bearer("s3cret-value"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "unknown_city" });
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("checks the secret before the city, so an unauthenticated caller learns nothing about cities", async () => {
    const { post } = await start();
    expect((await post("?city=atlantis", {})).status).toBe(401);
  });

  it("a background failure is logged, not thrown", async () => {
    const onError = vi.fn();
    const { post } = await start({ warm: vi.fn(async () => { throw new Error("db down"); }), onError });
    const res = await post("", bearer("s3cret-value"));
    expect(res.status).toBe(202);
    await new Promise((r) => setImmediate(r));
    expect(onError).toHaveBeenCalledWith("warm", expect.objectContaining({ message: "db down" }));
  });

  it("with wait=1 a failed run answers 500 without the cause", async () => {
    const { post } = await start({ warm: vi.fn(async () => { throw new Error("password=hunter2"); }) });
    const res = await post("?wait=1", bearer("s3cret-value"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "warm_failed" });
  });
});

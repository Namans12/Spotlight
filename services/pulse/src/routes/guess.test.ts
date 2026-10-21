import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Campaign } from "../../../../shared/types/pulse.js";
import { createTtlCache } from "../campaignCache.js";
import { createRateLimiter } from "../http/rateLimit.js";
import { createRouter } from "../http/router.js";
import { LlmError } from "../llm/client.js";
import { sessionKey } from "../usage.js";
import { fakeLlm, type FakeLlm } from "../testing/llm.js";
import { guessHandler, type GuessRouteDeps } from "./guess.js";

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

const idea = (kind: string) => ({ kind, title: `${kind} idea`, timing: "Release day", clauses: [{ text: `A ${kind} clause`, evidence: [] as string[] }] });
const REPLY = JSON.stringify({ ideas: [idea("special"), idea("social"), idea("event")] });
const GOOD = "city=delhi&type=cafe&mediaType=movie&tmdbId=1";

async function start(over: Partial<GuessRouteDeps> = {}, llm: FakeLlm | null = fakeLlm([REPLY])) {
  const deps: GuessRouteDeps = {
    rateLimiter: createRateLimiter({ max: 100_000, windowMs: 60_000 }),
    isKnown: vi.fn(async () => true),
    header: vi.fn(async () => ({ title: "Dune", posterUrl: null, releaseDate: "2026-11-06" })),
    llm,
    takeUsage: vi.fn(async () => ({ allowed: true }) as const),
    now: () => new Date("2026-10-21T10:00:00Z"),
    ...over,
  };
  const route = createRouter({ "GET /guess": guessHandler(deps) });
  server = createServer((req, res) => { void route(req, res, new URL(req.url ?? "/", "http://pulse.local")); });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { deps, llm, get: (qs: string, headers: Record<string, string> = {}) => fetch(`${base}/guess?${qs}`, { headers }) };
}

describe("GET /guess", () => {
  it("answers 200 with a Campaign grounded by none, drafted without a bundle", async () => {
    const { get, llm } = await start();
    const res = await get(GOOD);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as Campaign;
    expect(body.groundedBy).toBe("none");
    expect(body.ideas).toHaveLength(3);
    expect(String(llm!.calls[0][1].content)).toContain("Dune");
    expect(String(llm!.calls[0][1].content)).toContain("Delhi");
    expect(String(llm!.calls[0].map((m) => m.content).join("\n"))).toMatch(/no audience data/i);
  });

  it("charges the usage cap once with the hashed session from X-Pulse-Session, not per retry", async () => {
    const { get, deps } = await start({}, fakeLlm(["nope", REPLY]));
    await (await get(GOOD, { "x-pulse-session": "abc" })).json();
    expect(deps.takeUsage).toHaveBeenCalledTimes(1);
    const hash = vi.mocked(deps.takeUsage).mock.calls[0][0];
    expect(hash).toBe(sessionKey({ headers: { "x-pulse-session": "abc" }, socket: {} } as never, new Date("2026-10-21T10:00:00Z")));
    expect(hash).not.toContain("abc");
  });

  describe("validation 400s share /brief's bodies, and cost nothing", () => {
    it.each([
      ["city=atlantis&type=cafe&mediaType=movie&tmdbId=1", "unknown_city"],
      ["city=delhi&type=bank&mediaType=movie&tmdbId=1", "unknown_business_type"],
      ["city=delhi&type=constructor&mediaType=movie&tmdbId=1", "unknown_business_type"],
      ["city=delhi&type=cafe&mediaType=anime&tmdbId=1", "bad_request"],
      ["city=delhi&type=cafe&mediaType=movie&tmdbId=0", "bad_request"],
      ["city=delhi&type=cafe&mediaType=movie&tmdbId=12abc", "bad_request"],
    ])("%s -> 400 %s", async (qs, error) => {
      const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
      const { get, deps, llm } = await start({ rateLimiter: limiter });
      const res = await get(qs);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
      expect(deps.isKnown).not.toHaveBeenCalled();
      expect(deps.takeUsage).not.toHaveBeenCalled();
      expect(llm!.calls).toHaveLength(0);
      expect(limiter.check("x").allowed).toBe(true); // the budget was not spent on a bad request
    });
  });

  it("429 rate_limited with Retry-After comes before any work (its own, stricter limiter)", async () => {
    const { get, deps, llm } = await start({ rateLimiter: createRateLimiter({ max: 10, windowMs: 60_000 }) });
    for (let i = 0; i < 10; i++) expect((await get(GOOD)).status).toBe(200);
    const calls = vi.mocked(deps.isKnown).mock.calls.length;
    const res = await get(GOOD);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(deps.isKnown).mock.calls.length).toBe(calls);
  });

  describe("cache", () => {
    const frozen = () => ({ ttlMs: 3_600_000, max: 50, now: () => 0 });

    it("serves a repeat guess from the cache: no usage, no LLM call", async () => {
      const { get, deps, llm } = await start();
      const first = await (await get(GOOD)).json();
      const second = await (await get(GOOD, { "x-pulse-session": "someone-else" })).json();
      expect(second).toEqual(first);
      expect(llm!.calls).toHaveLength(1);
      expect(deps.takeUsage).toHaveBeenCalledTimes(1);
    });

    it("keys on title, media type, city and business type", async () => {
      const { get, llm } = await start();
      for (const qs of [GOOD, "city=mumbai&type=cafe&mediaType=movie&tmdbId=1", "city=delhi&type=d2c_food&mediaType=movie&tmdbId=1", "city=delhi&type=cafe&mediaType=tv&tmdbId=1", "city=delhi&type=cafe&mediaType=movie&tmdbId=2"]) {
        expect((await get(qs)).status).toBe(200);
      }
      expect(llm!.calls).toHaveLength(5);
      await get(GOOD);
      expect(llm!.calls).toHaveLength(5);
    });

    it("stores under guess|tmdbId|mediaType|citySlug|businessType, only after a good draft", async () => {
      const cache = createTtlCache<Campaign>(frozen());
      const { get } = await start({ cache });
      await get(GOOD);
      expect(cache.get("guess|1|movie|delhi|cafe")).toMatchObject({ groundedBy: "none" });
    });

    it("does not cache the fallback idea, a cap refusal or a failure", async () => {
      const cache = createTtlCache<Campaign>(frozen());
      const garbled = await start({ cache }, fakeLlm(["a", "b", "c", REPLY]));
      expect(((await (await garbled.get(GOOD)).json()) as Campaign).ideas[0].title).toBe("Campaign draft unavailable");
      expect(cache.size()).toBe(0);
      expect(((await (await garbled.get(GOOD)).json()) as Campaign).ideas).toHaveLength(3); // retried, then cached
      expect(cache.size()).toBe(1);
      await new Promise<void>((r) => server!.close(() => r()));

      const capped = createTtlCache<Campaign>(frozen());
      const c = await start({ cache: capped, takeUsage: async () => ({ allowed: false, reason: "session_cap" }) });
      expect((await c.get(GOOD)).status).toBe(429);
      expect(capped.size()).toBe(0);
    });

    it("is consulted after the known-title gate and before the cap, so a hit takes no usage even at the cap", async () => {
      const cache = createTtlCache<Campaign>(frozen());
      cache.set("guess|1|movie|delhi|cafe", { ideas: [], groundedBy: "none" });
      const { get, llm } = await start({ cache, takeUsage: async () => ({ allowed: false, reason: "global_cap" }) });
      expect((await get(GOOD)).status).toBe(200);
      expect(llm!.calls).toHaveLength(0);
      await new Promise<void>((r) => server!.close(() => r()));
      const unknown = await start({ cache, isKnown: async () => false });
      expect((await unknown.get(GOOD)).status).toBe(404);
    });
  });

  describe("in-flight de-duplication", () => {
    const deferred = <T>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
    const flush = () => new Promise<void>((r) => setTimeout(r, 25));
    function gatedLlm() {
      const gates: ReturnType<typeof deferred<string>>[] = [];
      const llm = { chat: () => { const g = deferred<string>(); gates.push(g); return g.promise.then((content) => ({ role: "assistant" as const, content })); } };
      return { llm: llm as unknown as FakeLlm, gates };
    }

    it("two simultaneous identical guesses share one draft and take one usage slot", async () => {
      const { llm, gates } = gatedLlm();
      const { get, deps } = await start({}, llm);
      const a = get(GOOD, { "x-pulse-session": "a" });
      const b = get(GOOD, { "x-pulse-session": "b" });
      await flush();
      expect(gates).toHaveLength(1);
      gates[0].resolve(REPLY);
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra.status).toBe(200);
      expect(rb.status).toBe(200);
      expect(await rb.json()).toEqual(await ra.json());
      expect(gates).toHaveLength(1);
      expect(deps.takeUsage).toHaveBeenCalledTimes(1);
    });

    it("different keys do not share a draft", async () => {
      const { llm, gates } = gatedLlm();
      const { get, deps } = await start({}, llm);
      const a = get(GOOD);
      const b = get("city=mumbai&type=cafe&mediaType=movie&tmdbId=1");
      await flush();
      expect(gates).toHaveLength(2);
      gates.forEach((g) => g.resolve(REPLY));
      await Promise.all([a, b]);
      expect(deps.takeUsage).toHaveBeenCalledTimes(2);
    });

    it("a failure reaches every waiter, clears the entry, and the next guess tries again", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const { llm, gates } = gatedLlm();
      const { get, deps } = await start({}, llm);
      const a = get(GOOD);
      const b = get(GOOD);
      await flush();
      expect(gates).toHaveLength(1);
      gates[0].reject(new LlmError("unavailable", "x"));
      const [ra, rb] = await Promise.all([a, b]);
      expect([ra.status, rb.status]).toEqual([503, 503]);
      expect(deps.takeUsage).toHaveBeenCalledTimes(1);
      const c = get(GOOD);
      await flush();
      expect(gates).toHaveLength(2);
      gates[1].resolve(REPLY);
      expect((await c).status).toBe(200);
      expect(deps.takeUsage).toHaveBeenCalledTimes(2);
      log.mockRestore();
    });

    it("a shared cap refusal is shared and answers 429 to both", async () => {
      const { get, deps, llm } = await start({ takeUsage: vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return { allowed: false, reason: "session_cap" } as const; }) });
      const [ra, rb] = await Promise.all([get(GOOD), get(GOOD)]);
      expect([ra.status, rb.status]).toEqual([429, 429]);
      expect(deps.takeUsage).toHaveBeenCalledTimes(1);
      expect(llm!.calls).toHaveLength(0);
    });
  });

  it("keys the limiter on the rightmost X-Forwarded-For entry", async () => {
    const { get } = await start({ rateLimiter: createRateLimiter({ max: 1, windowMs: 60_000 }) });
    expect((await get(GOOD, { "x-forwarded-for": "1.1.1.1, 9.9.9.9" })).status).toBe(200);
    expect((await get(GOOD, { "x-forwarded-for": "2.2.2.2, 9.9.9.9" })).status).toBe(429);
  });

  it("404 unknown_title comes before the LLM and the usage cap", async () => {
    const { get, deps, llm } = await start({ isKnown: vi.fn(async () => false) });
    const res = await get(GOOD);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_title" });
    expect(deps.takeUsage).not.toHaveBeenCalled();
    expect(llm!.calls).toHaveLength(0);
  });

  it("503 unavailable when the known-title check fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { get } = await start({ isKnown: async () => { throw new Error("db down"); } });
    const res = await get(GOOD);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    log.mockRestore();
  });

  it("503 llm_unavailable when no key is configured, before the usage cap", async () => {
    const { get, deps } = await start({}, null);
    const res = await get(GOOD);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "llm_unavailable" });
    expect(deps.takeUsage).not.toHaveBeenCalled();
  });

  it("429 daily_limit when the cap says no, with nothing drafted", async () => {
    for (const reason of ["session_cap", "global_cap"] as const) {
      const { get, llm } = await start({ takeUsage: async () => ({ allowed: false, reason }) });
      const res = await get(GOOD);
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: "daily_limit" });
      expect(llm!.calls).toHaveLength(0);
    }
  });

  it("reports a persistent provider bad_response to onError (a misconfigured model is not silent) and still answers with the placeholder", async () => {
    const onError = vi.fn();
    const { get } = await start({ onError }, fakeLlm([new LlmError("bad_response", "The model provider answered HTTP 404.")]));
    const res = await get(GOOD);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Campaign).ideas[0].title).toBe("Campaign draft unavailable");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("campaign writer", expect.objectContaining({ kind: "bad_response" }));
  });

  it("503 llm_unavailable when the model fails, without leaking the cause", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { get } = await start({}, fakeLlm([new LlmError("rate_limited", "Groq HTTP 429")]));
    const res = await get(GOOD);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "llm_unavailable" });
    log.mockRestore();
  });

  it("looks the title up with the validated key and drafts nothing for a title with no header", async () => {
    const header = vi.fn(async () => null);
    const { get, llm } = await start({ header });
    const res = await get("city=delhi&type=cafe&mediaType=tv&tmdbId=42");
    expect(header).toHaveBeenCalledWith({ tmdbId: 42, mediaType: "tv" });
    expect(res.status).toBe(404);
    expect(llm!.calls).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { COMPLETION_ALLOWANCE, createPacer, estimateTokens, parseDuration, rateLimitWaitMs } from "./pacer.js";

const h = (o: Record<string, string>) => new Headers(o);

describe("parseDuration (Groq reset headers)", () => {
  it.each([
    ["1.38s", 1380],
    ["7s", 7000],
    ["250ms", 250],
    ["0.5ms", 1],
    ["4m19.2s", 259_200],
    ["2m", 120_000],
    ["1h2m3s", 3_723_000],
    ["1d", 86_400_000],
    ["12", 12_000],
    ["12.5", 12_500],
    [" 3s ", 3000],
    ["2M59.56S", 179_560],
  ])("%s -> %i ms", (raw, ms) => {
    expect(parseDuration(raw)).toBe(ms);
  });
  it.each([[""], ["  "], ["soon"], ["5x"], ["s"], ["1s2"], ["-3s"], ["1.2.3s"], [null], [undefined]])("%s -> null", (raw) => {
    expect(parseDuration(raw as string | null | undefined)).toBeNull();
  });
});

describe("rateLimitWaitMs (what a 429 asks for)", () => {
  it("retry-after (seconds) wins over the reset headers", () => {
    expect(rateLimitWaitMs(h({ "retry-after": "3", "x-ratelimit-reset-tokens": "9s", "x-ratelimit-reset-requests": "4m19.2s" }))).toBe(3000);
  });
  it("without retry-after, the token reset is used", () => {
    expect(rateLimitWaitMs(h({ "x-ratelimit-reset-tokens": "1.38s", "x-ratelimit-reset-requests": "4m19.2s", "x-ratelimit-remaining-requests": "900" }))).toBe(1380);
  });
  it("a request limit with nothing left reads reset-requests (the daily cap)", () => {
    expect(rateLimitWaitMs(h({ "x-ratelimit-reset-tokens": "1s", "x-ratelimit-reset-requests": "4m19.2s", "x-ratelimit-remaining-requests": "0" }))).toBe(259_200);
  });
  it("falls back to reset-requests when only that is present, and to null when nothing is", () => {
    expect(rateLimitWaitMs(h({ "x-ratelimit-reset-requests": "250ms" }))).toBe(250);
    expect(rateLimitWaitMs(h({}))).toBeNull();
    expect(rateLimitWaitMs(h({ "retry-after": "garbage" }))).toBeNull();
  });
});

describe("estimateTokens", () => {
  it("is chars / 3 (JSON-heavy prompts run near 3 characters a token) plus a completion allowance capped by max_tokens", () => {
    expect(estimateTokens(3000, 4096)).toBe(1000 + COMPLETION_ALLOWANCE);
    expect(estimateTokens(3000, 200)).toBe(1000 + 200);
    expect(estimateTokens(0, 1200)).toBe(COMPLETION_ALLOWANCE);
  });
});

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => { open = r; });
  return { promise, open };
}

describe("the single-flight queue", () => {
  it("runs one task at a time, in arrival order", async () => {
    const pacer = createPacer();
    const log: string[] = [];
    const a = gate();
    const b = gate();
    const first = pacer.schedule(undefined, async () => { log.push("a start"); await a.promise; log.push("a end"); return "A"; });
    const second = pacer.schedule(undefined, async () => { log.push("b start"); await b.promise; log.push("b end"); return "B"; });
    const third = pacer.schedule(undefined, async () => { log.push("c"); return "C"; });
    await Promise.resolve();
    expect(log).toEqual(["a start"]);
    expect(pacer.waiting()).toBe(2);
    a.open();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(["a start", "a end", "b start"]);
    b.open();
    expect(await Promise.all([first, second, third])).toEqual(["A", "B", "C"]);
    expect(log).toEqual(["a start", "a end", "b start", "b end", "c"]);
    expect(pacer.waiting()).toBe(0);
  });

  it("a task that throws still hands the slot on", async () => {
    const pacer = createPacer();
    const failing = pacer.schedule(undefined, async () => { throw new Error("boom"); });
    const after = pacer.schedule(undefined, async () => "ok");
    await expect(failing).rejects.toThrow("boom");
    expect(await after).toBe("ok");
  });

  it("rejects the request after the waiting limit immediately, as rate_limited", async () => {
    const pacer = createPacer({ maxWaiting: 12 });
    const g = gate();
    const held = Array.from({ length: 13 }, () => pacer.schedule(undefined, () => g.promise)); // 1 running + 12 waiting
    expect(pacer.waiting()).toBe(12);
    await expect(pacer.schedule(undefined, async () => "13th waiting")).rejects.toMatchObject({ name: "LlmError", kind: "rate_limited" });
    expect(pacer.waiting()).toBe(12);
    g.open();
    await Promise.all(held);
  });

  it("abort while queued rejects promptly and frees the place", async () => {
    const pacer = createPacer({ maxWaiting: 1 });
    const g = gate();
    const running = pacer.schedule(undefined, () => g.promise);
    const ac = new AbortController();
    const queued = pacer.schedule(ac.signal, async () => "never");
    expect(pacer.waiting()).toBe(1);
    ac.abort();
    await expect(queued).rejects.toMatchObject({ name: "LlmError" });
    expect(pacer.waiting()).toBe(0);
    // the place is free again
    const next = pacer.schedule(undefined, async () => "next");
    expect(pacer.waiting()).toBe(1);
    g.open();
    await running;
    expect(await next).toBe("next");
  });

  it("an already-aborted signal is rejected without taking a place", async () => {
    const pacer = createPacer();
    const ac = new AbortController();
    ac.abort();
    await expect(pacer.schedule(ac.signal, async () => "x")).rejects.toMatchObject({ name: "LlmError" });
    expect(await pacer.schedule(undefined, async () => "fine")).toBe("fine");
  });
});

describe("proactive pacing", () => {
  function clocked() {
    let t = 5_000;
    const sleeps: number[] = [];
    const pacer = createPacer({ now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
    return { pacer, sleeps, advance: (ms: number) => { t += ms; } };
  }
  const rec = (remaining: number, reset: string) => h({ "x-ratelimit-remaining-tokens": String(remaining), "x-ratelimit-reset-tokens": reset });

  it("waits for the reset when the remaining tokens are below the estimate and the reset is within 20 s", async () => {
    const { pacer, sleeps } = clocked();
    pacer.record(rec(100, "3.5s"));
    await pacer.beforeSend(1500);
    expect(sleeps).toEqual([3500]);
  });
  it("does not wait when there is room", async () => {
    const { pacer, sleeps } = clocked();
    pacer.record(rec(7000, "1s"));
    await pacer.beforeSend(1500);
    expect(sleeps).toEqual([]);
  });
  it("does not wait for a reset more than 20 s away", async () => {
    const { pacer, sleeps } = clocked();
    pacer.record(rec(100, "45s"));
    await pacer.beforeSend(1500);
    expect(sleeps).toEqual([]);
  });
  const recL = (remaining: number, reset: string, limit = 8000) => h({ "x-ratelimit-remaining-tokens": String(remaining), "x-ratelimit-reset-tokens": reset, "x-ratelimit-limit-tokens": String(limit) });
  it("when the whole window is far from reset, waits only for the shortfall to refill (limit/60 tokens a second)", async () => {
    // Live shape: 1,282 left, 50 s to a full reset, an 8,000-token minute. A 2,600-token request needs 1,318 more tokens: 9.885 s.
    const { pacer, sleeps } = clocked();
    pacer.record(recL(1282, "50s"));
    await pacer.beforeSend(2600);
    expect(sleeps).toEqual([9885 + 250]);
  });
  it("credits the refill that has happened since the report", async () => {
    const { pacer, sleeps, advance } = clocked();
    pacer.record(recL(1282, "50s"));
    advance(4000); // +533 tokens
    await pacer.beforeSend(2600);
    expect(sleeps).toEqual([Math.ceil((2600 - 1282 - 4000 * (8000 / 60_000)) / (8000 / 60_000)) + 250]);
  });
  it("does not wait for a shortfall that needs more than 20 s, or when the limit is unknown", async () => {
    const a = clocked();
    a.pacer.record(recL(100, "58s"));
    await a.pacer.beforeSend(6000); // 5,900 tokens = 44 s
    expect(a.sleeps).toEqual([]);
    const b = clocked();
    b.pacer.record(rec(1282, "50s")); // no limit header
    await b.pacer.beforeSend(2600);
    expect(b.sleeps).toEqual([]);
  });
  it("counts time already passed, waits only once per report, and ignores a missing report", async () => {
    const { pacer, sleeps, advance } = clocked();
    await pacer.beforeSend(1500);
    pacer.record(rec(100, "3s"));
    advance(1000);
    await pacer.beforeSend(1500);
    expect(sleeps).toEqual([2000]);
    await pacer.beforeSend(1500);
    expect(sleeps).toEqual([2000]);
    pacer.record(rec(100, "3s"));
    advance(5000); // the reset has passed
    await pacer.beforeSend(1500);
    expect(sleeps).toEqual([2000]);
  });
  it("keeps the report when a proactive wait is aborted, so the next request still paces", async () => {
    let t = 5_000;
    const sleeps: number[] = [];
    const ac = new AbortController();
    const pacer = createPacer({
      now: () => t,
      sleep: (ms, signal) => new Promise<void>((resolve, reject) => {
        sleeps.push(ms);
        if (signal?.aborted) return reject(new Error("cancelled"));
        signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        if (!signal) { t += ms; resolve(); }
      }),
    });
    pacer.record(rec(100, "3s"));
    const waiting = pacer.beforeSend(1500, ac.signal);
    ac.abort();
    await expect(waiting).rejects.toThrow("cancelled");
    await pacer.beforeSend(1500); // no signal: this one sleeps (and completes)
    expect(sleeps).toEqual([3000, 3000]);
    await pacer.beforeSend(1500); // a completed wait clears the report
    expect(sleeps).toEqual([3000, 3000]);
  });
  it("forget() drops the report", async () => {
    const { pacer, sleeps } = clocked();
    pacer.record(rec(100, "3s"));
    pacer.forget();
    await pacer.beforeSend(1500);
    expect(sleeps).toEqual([]);
  });
  it("ignores headers it cannot read", async () => {
    const { pacer, sleeps } = clocked();
    pacer.record(h({ "x-ratelimit-remaining-tokens": "lots", "x-ratelimit-reset-tokens": "soon" }));
    pacer.record(h({}));
    await pacer.beforeSend(99_999);
    expect(sleeps).toEqual([]);
  });
});

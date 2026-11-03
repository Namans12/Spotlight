import { describe, expect, it } from "vitest";
import { createLimiter, RateLimitedError } from "./limiter.js";

describe("the Qloo call limiter", () => {
  it("never runs more than 2 calls at once", async () => {
    const run = createLimiter({ concurrency: 2, backoffMs: [3000, 8000], sleep: async () => {} });
    let live = 0, peak = 0;
    await Promise.all(Array.from({ length: 6 }, () => run(async () => { live++; peak = Math.max(peak, live); await Promise.resolve(); live--; })));
    expect(peak).toBe(2);
  });

  it("retries a 429 after 3s then 8s, then rethrows", async () => {
    const waits: number[] = [];
    const run = createLimiter({ concurrency: 2, backoffMs: [3000, 8000], sleep: async ms => { waits.push(ms); } });
    await expect(run(async () => { throw new RateLimitedError("429"); })).rejects.toBeInstanceOf(RateLimitedError);
    expect(waits).toEqual([3000, 8000]);
  });

  it("returns the result of a retry that succeeds, without waiting longer than needed", async () => {
    const waits: number[] = [];
    const run = createLimiter({ concurrency: 2, backoffMs: [3000, 8000], sleep: async ms => { waits.push(ms); } });
    let attempts = 0;
    const value = await run(async () => {
      attempts++;
      if (attempts === 1) throw new RateLimitedError("429");
      return "ok";
    });
    expect(value).toBe("ok");
    expect(attempts).toBe(2);
    expect(waits).toEqual([3000]);
  });

  it("does not retry errors that are not rate limits", async () => {
    const waits: number[] = [];
    const run = createLimiter({ concurrency: 2, backoffMs: [3000, 8000], sleep: async ms => { waits.push(ms); } });
    let attempts = 0;
    await expect(run(async () => { attempts++; throw new Error("boom"); })).rejects.toThrow("boom");
    expect(attempts).toBe(1);
    expect(waits).toEqual([]);
  });

  it("frees its slot when a call fails, so later calls still run", async () => {
    const run = createLimiter({ concurrency: 1, backoffMs: [], sleep: async () => {} });
    await expect(run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(run(async () => "next")).resolves.toBe("next");
  });

  describe("cancelled jobs", () => {
    const hold = () => { let release!: () => void; const p = new Promise<void>((r) => { release = r; }); return { p, release }; };

    it("rejects with an AbortError, without running, a job whose signal is already aborted", async () => {
      const run = createLimiter({ concurrency: 2, backoffMs: [], sleep: async () => {} });
      const ac = new AbortController(); ac.abort();
      let ran = false;
      await expect(run(async () => { ran = true; }, { signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
      expect(ran).toBe(false);
    });

    it("drops a queued job whose signal aborts while it waits, and never calls it", async () => {
      const run = createLimiter({ concurrency: 1, backoffMs: [], sleep: async () => {} });
      const gate = hold();
      const first = run(() => gate.p);
      const ac = new AbortController();
      let ran = false;
      const queued = run(async () => { ran = true; }, { signal: ac.signal });
      ac.abort();
      await expect(queued).rejects.toMatchObject({ name: "AbortError" });
      gate.release();
      await first;
      expect(ran).toBe(false);
    });

    it("hands the slot to the next waiter when a cancelled one is skipped, and does not leak it", async () => {
      const run = createLimiter({ concurrency: 1, backoffMs: [], sleep: async () => {} });
      const gate = hold();
      const first = run(() => gate.p);
      const ac = new AbortController();
      const cancelled = run(async () => "never", { signal: ac.signal });
      const third = run(async () => "third");
      ac.abort();
      await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
      gate.release();
      await first;
      await expect(third).resolves.toBe("third");
      await expect(run(async () => "later")).resolves.toBe("later");
    });

    it("does not retry a 429 after the job was cancelled during the backoff", async () => {
      const ac = new AbortController();
      const run = createLimiter({ concurrency: 1, backoffMs: [3000, 8000], sleep: async () => { ac.abort(); } });
      let attempts = 0;
      await expect(run(async () => { attempts++; throw new RateLimitedError("429"); }, { signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
      expect(attempts).toBe(1);
    });

    it("leaves a job that is already running alone", async () => {
      const run = createLimiter({ concurrency: 1, backoffMs: [], sleep: async () => {} });
      const ac = new AbortController();
      const out = run(async () => { ac.abort(); return "finished"; }, { signal: ac.signal });
      await expect(out).resolves.toBe("finished");
    });
  });
});

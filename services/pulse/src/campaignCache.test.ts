import { describe, expect, it } from "vitest";
import { createTtlCache } from "./campaignCache.js";

describe("createTtlCache", () => {
  const clock = (start = 1_000) => { let t = start; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

  it("returns what was set until the ttl passes, then forgets it", () => {
    const c = clock();
    const cache = createTtlCache<string>({ ttlMs: 3_600_000, max: 50, now: c.now });
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");
    c.advance(3_599_999);
    expect(cache.get("k")).toBe("v");
    c.advance(1);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("evicts the oldest entry past max, never holding more than max", () => {
    const cache = createTtlCache<number>({ ttlMs: 1e9, max: 50, now: () => 0 });
    for (let i = 0; i < 60; i++) cache.set(`k${i}`, i);
    expect(cache.size()).toBe(50);
    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k9")).toBeUndefined();
    expect(cache.get("k10")).toBe(10);
    expect(cache.get("k59")).toBe(59);
  });

  it("re-setting a key refreshes its age and position instead of growing the table", () => {
    const c = clock();
    const cache = createTtlCache<number>({ ttlMs: 100, max: 2, now: c.now });
    cache.set("a", 1);
    cache.set("b", 2);
    c.advance(60);
    cache.set("a", 3);
    cache.set("c", 4); // evicts b, the oldest
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(3);
    c.advance(60); // a is 60 old (refreshed), c is 60 old
    expect(cache.get("a")).toBe(3);
  });

  it("sweeps expired entries before evicting live ones", () => {
    const c = clock();
    const cache = createTtlCache<number>({ ttlMs: 100, max: 2, now: c.now });
    cache.set("old", 1);
    c.advance(50);
    cache.set("mid", 2);
    c.advance(60); // old expired, mid live
    cache.set("new", 3);
    expect(cache.get("mid")).toBe(2);
    expect(cache.get("new")).toBe(3);
    expect(cache.get("old")).toBeUndefined();
  });
});

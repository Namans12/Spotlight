import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { clientAddress, createRateLimiter } from "./rateLimit.js";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("createRateLimiter", () => {
  it("allows max requests in a window and refuses the next with a retry hint", () => {
    const c = clock();
    const rl = createRateLimiter({ max: 30, windowMs: 60_000, now: c.now });
    for (let i = 0; i < 30; i++) expect(rl.check("a").allowed).toBe(true);
    const r = rl.check("a");
    expect(r).toEqual({ allowed: false, retryAfterSec: 60 });
  });

  it("slides: capacity returns as the oldest requests age out", () => {
    const c = clock();
    const rl = createRateLimiter({ max: 2, windowMs: 60_000, now: c.now });
    rl.check("a"); c.advance(30_000); rl.check("a");
    expect(rl.check("a")).toEqual({ allowed: false, retryAfterSec: 30 });
    c.advance(30_001); // the first has aged out, the second has not
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
  });

  it("does not count refused requests against the client", () => {
    const c = clock();
    const rl = createRateLimiter({ max: 1, windowMs: 60_000, now: c.now });
    rl.check("a");
    for (let i = 0; i < 50; i++) rl.check("a");
    c.advance(60_001);
    expect(rl.check("a").allowed).toBe(true);
  });

  it("tracks clients independently", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60_000, now: clock().now });
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
  });

  it("bounds memory by evicting the least recently active client", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60_000, maxKeys: 3, now: clock().now });
    for (const k of ["a", "b", "c", "d"]) rl.check(k);
    expect(rl.size()).toBe(3);
    expect(rl.check("a").allowed).toBe(true); // evicted, so treated as new
    expect(rl.check("d").allowed).toBe(false); // still tracked
  });

  it("drops lapsed clients so steady-state memory follows active ones", () => {
    const c = clock();
    const rl = createRateLimiter({ max: 5, windowMs: 60_000, maxKeys: 100, now: c.now });
    for (let i = 0; i < 50; i++) rl.check(`k${i}`);
    c.advance(61_000);
    rl.check("fresh");
    expect(rl.size()).toBe(1);
  });
});

describe("clientAddress", () => {
  const req = (xff: string | string[] | undefined, remote: string | null = "10.0.0.1") =>
    ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: remote ?? undefined } }) as unknown as IncomingMessage;

  it("takes the rightmost X-Forwarded-For entry, which the platform proxy appended", () => {
    expect(clientAddress(req("6.6.6.6, 7.7.7.7, 203.0.113.9"))).toBe("203.0.113.9");
    expect(clientAddress(req(" 203.0.113.9 "))).toBe("203.0.113.9");
  });
  it("handles a repeated header and trailing commas", () => {
    expect(clientAddress(req(["1.1.1.1", "2.2.2.2, 3.3.3.3"]))).toBe("3.3.3.3");
    expect(clientAddress(req("1.1.1.1, "))).toBe("1.1.1.1");
  });
  it("falls back to the socket address, then to a constant", () => {
    expect(clientAddress(req(undefined))).toBe("10.0.0.1");
    expect(clientAddress(req("", "10.0.0.2"))).toBe("10.0.0.2");
    expect(clientAddress(req(undefined, null))).toBe("unknown");
  });
});

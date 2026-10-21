import type { IncomingMessage } from "node:http";

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSec: number };

export interface RateLimiter {
  check(key: string): RateDecision;
  /** Number of clients currently tracked, for tests. */
  size(): number;
}

export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  /** Upper bound on tracked clients; the least recently active is evicted past it. */
  maxKeys?: number;
  now?: () => number;
}

/** A sliding-window limiter: at most `max` accepted requests in any `windowMs`.
 *  lib/rateLimit.ts is a fixed-window counter keyed on the spoofable leftmost
 *  X-Forwarded-For entry with no injectable clock or retry hint, so it does
 *  not fit. Refused requests are not recorded, so hammering does not extend
 *  a client's lockout. Memory: each client holds at most `max` timestamps and
 *  the table is capped at `maxKeys` (lapsed clients are swept first, then the
 *  least recently active is dropped, which costs that client at most a fresh
 *  window). */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { max, windowMs } = opts;
  const maxKeys = opts.maxKeys ?? 10_000;
  const now = opts.now ?? Date.now;
  // Map iteration order is insertion order; re-inserting on every accepted
  // request keeps it least-recently-active first.
  const hits = new Map<string, number[]>();
  let lastSweep = 0;

  const sweep = (t: number) => {
    if (t - lastSweep < windowMs) return;
    lastSweep = t;
    for (const [k, ts] of hits) if (ts[ts.length - 1] <= t - windowMs) hits.delete(k);
  };

  return {
    check(key) {
      const t = now();
      sweep(t);
      const recent = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000)) };
      }
      recent.push(t);
      hits.delete(key);
      hits.set(key, recent);
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      return { allowed: true };
    },
    size: () => hits.size,
  };
}

/** The client's address as the platform proxy saw it: the RIGHTMOST
 *  X-Forwarded-For entry, which the proxy appended itself. Entries to its
 *  left are whatever the caller sent, so keying on them would let one client
 *  mint a fresh budget per request. Without the header, the socket address. */
export function clientAddress(req: IncomingMessage): string {
  const raw = req.headers["x-forwarded-for"];
  const joined = Array.isArray(raw) ? raw.join(",") : raw;
  const last = joined?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last ?? req.socket.remoteAddress ?? "unknown";
}

import type { IncomingMessage } from "http";

// Simple per-instance fixed-window counter. Resets on cold start; not shared
// across concurrent Lambda instances. Sufficient at this traffic scale — the
// job is deterring a single bad actor from burning the shared TMDB key, not
// protecting TMDB itself (its own limits are far above what this allows through).
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

// A warm Lambda instance can serve requests for hours, and every distinct
// client IP it sees adds an entry that nothing ever removed. That is a slow
// leak in a process with a fixed memory budget, and it is trivially
// accelerated: X-Forwarded-For is attacker-influenced, so a caller can mint a
// new bucket key per request. Two bounds, because they fail differently — the
// sweep keeps steady-state memory proportional to *active* clients, and the
// hard cap is what holds under a deliberate flood of unique keys.
const MAX_TRACKED_CLIENTS = 10_000;
const SWEEP_INTERVAL_MS = WINDOW_MS;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

/** Drops every bucket whose window has already lapsed — those are pure
 *  bookkeeping, since a lapsed bucket is reset on its owner's next request
 *  anyway. Runs at most once per window so the cost is amortised rather than
 *  paid on every call. */
function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS) buckets.delete(key);
  }
}

export function isRateLimited(req: IncomingMessage): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(ip);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    // Only a *new* key can push past the cap; an existing client refreshing
    // its own window must never be turned away for capacity reasons. If a
    // flood of unique keys fills the table anyway, fail closed: an untracked
    // caller is treated as limited rather than waved through, which is what
    // stops "exhaust the table, then attack freely" from working.
    if (!bucket && buckets.size >= MAX_TRACKED_CLIENTS) return true;
    buckets.set(ip, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

/** Test-only. The module holds process-wide state, so a test that asserts on
 *  bucket behaviour has to be able to start from a known one. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
  lastSweep = 0;
}

export const __rateLimitInternals = {
  MAX_REQUESTS_PER_WINDOW,
  MAX_TRACKED_CLIENTS,
  WINDOW_MS,
  size: () => buckets.size,
};

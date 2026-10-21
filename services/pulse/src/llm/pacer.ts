// Pacing for Groq's free tier: a process-wide single-flight queue, plus the
// header arithmetic that decides when to wait for a rate limit instead of
// failing.
//
// What the live key allows (measured 2026-10-21, every chat model it exposes):
// 8,000 tokens per MINUTE (a rolling refill of about 133 tokens a second) and
// 1,000 requests per DAY. Responses carry `x-ratelimit-remaining-tokens`,
// `x-ratelimit-reset-tokens` ("1.38s") and `x-ratelimit-reset-requests`
// ("4m19.2s"); a 429 carries `retry-after` in seconds. One chat round costs
// about 3,000 tokens before history, so two rounds in a row can need a short
// wait. Waiting a few seconds is a better answer than "busy right now"; waiting
// minutes (the daily limit) is not, so anything beyond MAX_WAIT_MS fails at once.
//
// Everything here is injectable (clock, sleep, queue size) so tests run
// instantly and deterministically. No header, key or prompt text is ever put in
// an error message.

import { LlmError } from "./errors.js";

/** The longest a request will sleep for a rate limit, in one go. */
export const MAX_WAIT_MS = 20_000;
/** Added to a computed wait so the retry lands just after the provider's reset. */
export const JITTER_MS = 250;
/** Requests that may wait behind the one in flight; the next one is rejected. */
export const MAX_WAITING = 12;
/** Retries after a 429 (so a request is sent at most 1 + this many times). */
export const MAX_429_RETRIES = 2;
/** Prompt characters per token, for the estimate (a deliberately cautious ratio). */
export const CHARS_PER_TOKEN = 3.6;
/** The completion allowance in the estimate, capped by the request's max_tokens. */
export const COMPLETION_ALLOWANCE = 600;

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "1.38s", "4m19.2s", "250ms", "1h2m3s", "2m": a Groq reset duration, in
 *  milliseconds; a bare number is read as seconds. Anything else is null. */
export function parseDuration(raw: string | null | undefined): number | null {
  const text = raw?.trim().toLowerCase();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const part = /(\d+(?:\.\d+)?)(ms|d|h|m|s)/y;
  let total = 0;
  let at = 0;
  while (at < text.length) {
    part.lastIndex = at;
    const m = part.exec(text);
    if (!m) return null;
    total += Number(m[1]) * UNIT_MS[m[2]];
    at = part.lastIndex;
  }
  return Math.round(total);
}

/** How long a 429 says to wait, in milliseconds (no jitter), or null when it
 *  says nothing usable. `retry-after` (seconds) wins. Without it, a request
 *  limit with nothing left (the daily cap) reads `reset-requests`, otherwise the
 *  token window's `reset-tokens`, then `reset-requests`. */
export function rateLimitWaitMs(headers: Headers): number | null {
  const retryAfter = parseDuration(headers.get("retry-after"));
  if (retryAfter !== null) return retryAfter;
  const requests = parseDuration(headers.get("x-ratelimit-reset-requests"));
  const tokens = parseDuration(headers.get("x-ratelimit-reset-tokens"));
  if (headers.get("x-ratelimit-remaining-requests")?.trim() === "0" && requests !== null) return requests;
  return tokens ?? requests;
}

/** About how many tokens a request will use: its characters at CHARS_PER_TOKEN
 *  plus the completion allowance (at most `maxTokens`). */
export function estimateTokens(promptChars: number, maxTokens: number): number {
  return Math.ceil(promptChars / CHARS_PER_TOKEN) + Math.min(maxTokens, COMPLETION_ALLOWANCE);
}

export interface PacerDeps {
  now?: () => number;
  /** Resolves after `ms`; rejects (any error) if `signal` aborts first. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  maxWaiting?: number;
}

export interface Pacer {
  /** Runs `task` alone: FIFO behind whatever is in flight, at most `maxWaiting` waiting. */
  schedule<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T>;
  /** Remembers the token headroom a response reported. */
  record(headers: Headers): void;
  /** Before sending: when the last reported headroom is below `estimate`, waits
   *  for the token window to reset if that is at most MAX_WAIT_MS away, else for
   *  just the shortfall to refill (when the limit is known) if that is. */
  beforeSend(estimate: number, signal?: AbortSignal): Promise<void>;
  /** An abortable sleep (the clock the pacer was built with). */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** How many requests are waiting behind the one in flight. */
  waiting(): number;
}

const cancelled = () => new LlmError("unavailable", "The model request was cancelled.");

function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelled()); return; }
    const onAbort = () => { clearTimeout(handle); reject(cancelled()); };
    const handle = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createPacer(deps: PacerDeps = {}): Pacer {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const maxWaiting = deps.maxWaiting ?? MAX_WAITING;
  let running = false;
  const queue: { start: () => void; cancel: () => void }[] = [];
  let seen: { remaining: number; resetAt: number; at: number; limit: number | null } | null = null;

  function release(): void {
    const next = queue.shift();
    if (next) next.start(); else running = false;
  }

  return {
    schedule(signal, task) {
      if (signal?.aborted) return Promise.reject(cancelled());
      const run = async () => {
        try { return await task(); } finally { release(); }
      };
      if (!running) { running = true; return run(); }
      if (queue.length >= maxWaiting) return Promise.reject(new LlmError("rate_limited", "The AI service queue is full."));
      return new Promise((resolve, reject) => {
        const entry = {
          start: () => { signal?.removeEventListener("abort", entry.cancel); run().then(resolve, reject); },
          cancel: () => {
            const i = queue.indexOf(entry);
            if (i >= 0) queue.splice(i, 1);
            reject(cancelled());
          },
        };
        queue.push(entry);
        signal?.addEventListener("abort", entry.cancel, { once: true });
      });
    },

    record(headers) {
      const remainingRaw = headers.get("x-ratelimit-remaining-tokens");
      const reset = parseDuration(headers.get("x-ratelimit-reset-tokens"));
      const remaining = remainingRaw !== null && /^\d+(\.\d+)?$/.test(remainingRaw.trim()) ? Number(remainingRaw) : null;
      if (remaining === null || reset === null) return;
      const limitRaw = headers.get("x-ratelimit-limit-tokens");
      const limit = limitRaw !== null && /^\d+$/.test(limitRaw.trim()) && Number(limitRaw) > 0 ? Number(limitRaw) : null;
      seen = { remaining, resetAt: now() + reset, at: now(), limit };
    },

    async beforeSend(estimate, signal) {
      if (!seen || seen.remaining >= estimate) return;
      const t = now();
      let wait = seen.resetAt - t;
      if (wait <= 0) return; // the window has already reset
      if (wait > MAX_WAIT_MS) {
        // `reset-tokens` is the time for the WHOLE window to refill, which is far
        // longer than a request needs when only part of it is spent (live: 50 s
        // reported while 10 s of refill would have covered the next request). The
        // window refills at limit/60 tokens a second, so wait only for the shortfall.
        if (seen.limit === null) return;
        const perMs = seen.limit / 60_000;
        const have = seen.remaining + (t - seen.at) * perMs;
        if (have >= estimate) return;
        wait = Math.ceil((estimate - have) / perMs) + JITTER_MS;
        if (wait > MAX_WAIT_MS) return;
      }
      seen = null; // one wait per report: the refill is assumed done afterwards
      await sleep(wait, signal);
    },

    sleep,
    waiting: () => queue.length,
  };
}

/** The pacer every Groq client shares unless it is handed another: one queue per process. */
export const sharedPacer: Pacer = createPacer();

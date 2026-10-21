// Qloo's hackathon tier rate-limits aggressively, and a brief fans out into
// several calls at once, so every call funnels through this limiter: a hard
// cap on calls in flight, plus a bounded wait-and-retry for 429s only. Any
// other failure is the caller's to handle; retrying it would just hide bugs.

/** Thrown (by the transport or the 429 detector) to ask the limiter to back
 *  off and retry. It is the only error the limiter ever retries. */
export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitedError";
  }
}

export interface LimiterOptions {
  concurrency: number;
  /** Waits between attempts; the call is tried backoffMs.length + 1 times. */
  backoffMs: number[];
  /** Injectable so tests do not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RunOptions {
  /** A job whose signal is aborted before it starts is rejected with an
   *  AbortError and never reaches the harness: a chat that was cut off, or
   *  whose client left, must not spend queued Qloo calls. A call already
   *  running is not interrupted (the slot stays held until it ends). */
  signal?: AbortSignal;
}

export type Limited = <T>(fn: () => Promise<T>, opts?: RunOptions) => Promise<T>;

const abortError = () => new DOMException("The Qloo call was cancelled before it started.", "AbortError");

export function createLimiter(opts: LimiterOptions): Limited {
  const sleep = opts.sleep ?? realSleep;
  let live = 0;
  const waiting: (() => void)[] = [];

  const acquire = async (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) throw abortError();
    if (live < opts.concurrency) {
      live++;
      return;
    }
    // The releasing call hands its slot straight to the next waiter, so
    // `live` never dips below the cap while work is queued.
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const i = waiting.indexOf(grant);
        if (i >= 0) waiting.splice(i, 1);
        reject(abortError());
      };
      const grant = () => { signal?.removeEventListener("abort", onAbort); resolve(); };
      waiting.push(grant);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else live--;
  };

  return async <T>(fn: () => Promise<T>, run: RunOptions = {}): Promise<T> => {
    await acquire(run.signal);
    try {
      for (let attempt = 0; ; attempt++) {
        // Checked before every attempt, so a call cancelled during a 429 backoff is not retried.
        if (run.signal?.aborted) throw abortError();
        try {
          return await fn();
        } catch (err) {
          const wait = opts.backoffMs[attempt];
          // The slot stays held through the wait: a rate-limited Qloo is the
          // moment to slow every caller down, not to let others rush in.
          if (!(err instanceof RateLimitedError) || wait === undefined) throw err;
          await sleep(wait);
        }
      }
    } finally {
      release();
    }
  };
}

// TMDB title lookup for entity resolution, written for the Pulse service
// rather than reused from lib/omdb.ts. That module (shared with the Vercel
// functions, and rightly "never throws" for decorative ratings) reports a 404,
// a timeout, a 500 and a missing key all as null. Resolution cannot afford
// that: a null would be cached as "Qloo has no such title" for three days, so
// a TMDB blip during a live run poisoned real titles.
//
// Contract:
//   - an object: TMDB answered 200. Its fields may be null (a real title that
//     has no IMDb id yet is still an answer).
//   - null: TMDB answered 404. A definite "no such title", safe to cache.
//   - throws TmdbUnavailableError: TMDB could not be asked or did not give a
//     usable answer after the attempts below. Callers must cache nothing.
//   - throws TmdbNotConfiguredError: no API key. A deployment fault, never a
//     verdict on the title.
//
// Neither the key nor the request URL (which carries the key) ever appears in
// an error message, a stack or a log line from here.

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;
/** Waits before the 2nd and 3rd attempt. */
const BACKOFF_MS = [250, 750];
const RETRY_AFTER_CAP_MS = 2_000;

export interface TmdbTitle { imdbId: string | null; title: string | null; year: string | null }

export class TmdbUnavailableError extends Error {
  constructor(message: string, readonly attempts: number) {
    super(message);
    this.name = "TmdbUnavailableError";
  }
}

export class TmdbNotConfiguredError extends Error {
  constructor() {
    super("TMDB_API_KEY is not set, so titles cannot be looked up on TMDB");
    this.name = "TmdbNotConfiguredError";
  }
}

export interface TmdbLookupDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Omit to read TMDB_API_KEY; null or "" means "not configured". */
  apiKey?: string | null;
  timeoutMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function nonEmpty(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === "N/A") return null;
  return trimmed;
}

/** Seconds only; an HTTP-date Retry-After falls back to the normal backoff. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Math.min(Number(raw.trim()) * 1000, RETRY_AFTER_CAP_MS);
}

/** What went wrong, in words that cannot carry a URL or a key. */
function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  return name === "TimeoutError" || name === "AbortError" ? "timed out" : "network error";
}

type Attempt =
  | { kind: "answer"; payload: Record<string, unknown> }
  | { kind: "missing" }
  | { kind: "retry"; reason: string; waitMs: number | null }
  | { kind: "fatal"; reason: string };

async function attempt(url: string, doFetch: typeof fetch, timeoutMs: number): Promise<Attempt> {
  let res: Response;
  try {
    res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    return { kind: "retry", reason: describeFailure(err), waitMs: null };
  }
  if (res.status === 404) return { kind: "missing" };
  if (res.status === 429) return { kind: "retry", reason: "HTTP 429", waitMs: retryAfterMs(res) };
  if (res.status >= 500) return { kind: "retry", reason: `HTTP ${res.status}`, waitMs: null };
  // Any other non-200 (a rejected key, a bad request) will not improve with a
  // retry, and must not be mistaken for "no such title".
  if (!res.ok) return { kind: "fatal", reason: `HTTP ${res.status}` };
  try {
    const payload: unknown = await res.json();
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      return { kind: "answer", payload: payload as Record<string, unknown> };
    }
    return { kind: "retry", reason: "unreadable response", waitMs: null };
  } catch {
    return { kind: "retry", reason: "unreadable response", waitMs: null };
  }
}

/** Movies carry `imdb_id` on the detail payload; TV needs external ids,
 *  appended so it stays one TMDB call either way. Title and year come back
 *  too, as the fallback for titles TMDB has no IMDb id for. */
export async function lookupTmdbTitle(
  mediaType: "movie" | "tv",
  tmdbId: number,
  deps: TmdbLookupDeps = {},
): Promise<TmdbTitle | null> {
  const apiKey = deps.apiKey === undefined ? process.env.TMDB_API_KEY : deps.apiKey;
  if (!apiKey) throw new TmdbNotConfiguredError();

  const url =
    mediaType === "movie"
      ? `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${encodeURIComponent(apiKey)}`
      : `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${encodeURIComponent(apiKey)}&append_to_response=external_ids`;
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? realSleep;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;

  let lastReason = "no attempt made";
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    const a = await attempt(url, doFetch, timeoutMs);
    if (a.kind === "missing") return null;
    if (a.kind === "answer") {
      const p = a.payload;
      const ext = typeof p.external_ids === "object" && p.external_ids !== null ? (p.external_ids as Record<string, unknown>) : {};
      const imdbId = mediaType === "movie" ? nonEmpty(p.imdb_id) : nonEmpty(ext.imdb_id);
      const title = nonEmpty(p.title) ?? nonEmpty(p.name);
      const releaseDate = nonEmpty(p.release_date) ?? nonEmpty(p.first_air_date);
      return { imdbId, title, year: releaseDate ? releaseDate.slice(0, 4) : null };
    }
    lastReason = a.reason;
    if (a.kind === "fatal") {
      throw new TmdbUnavailableError(`TMDB lookup failed (${a.reason}) for ${mediaType} ${tmdbId}`, n);
    }
    if (n < MAX_ATTEMPTS) await sleep(a.waitMs ?? BACKOFF_MS[n - 1]);
  }
  throw new TmdbUnavailableError(`TMDB lookup failed after ${MAX_ATTEMPTS} attempts (${lastReason}) for ${mediaType} ${tmdbId}`, MAX_ATTEMPTS);
}

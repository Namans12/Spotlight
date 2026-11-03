/**
 * Browser client for the Release Pulse service (services/pulse).
 *
 * Pulse is a separate deployment from Spotlight's own /api, so it has its own
 * base URL and its own error shape ({ error: "<code>" } plus Retry-After on a
 * 429). lib/http.ts's fetchJson throws away the body of a failed response, and
 * here the body is the point: "unknown_city" should reopen the picker,
 * "rate_limited" should say how long to wait, and a dropped connection should
 * offer a retry — three different screens from three different failures.
 */
import type { AgentEvent, BoardResponse, BriefEvent, BusinessType, Campaign, PlanNightResponse, TitleLocationEntry } from '../../shared/types/pulse';
import { HttpError, TimeoutError } from './http';
import { isBusinessType, isPulseCitySlug } from './pulseCities';

/** No trailing slash, so `${PULSE_URL}/board` never becomes `//board`. Empty
 *  when the deployment has no Pulse service. */
export const PULSE_URL: string = (import.meta.env.VITE_PULSE_URL ?? '').trim().replace(/\/+$/, '');

export function pulseConfigured(): boolean {
  return PULSE_URL !== '';
}

/** Same budget as lib/http.ts's DEFAULT_TIMEOUT_MS: a JSON call still open past
 *  this is not coming back. Streams get no overall timeout — a brief or a chat
 *  is legitimately long-lived — only the caller's AbortSignal. */
const JSON_TIMEOUT_MS = 16_000;

/**
 * A non-2xx answer from the Pulse service. Extends HttpError so the repo-wide
 * `shouldRetry` already does the right thing: no retry of a 4xx (a 429 retried
 * only deepens the limit), two retries of a 5xx.
 */
export class PulseApiError extends HttpError {
  /** The server's `error` code, or null when the body was not Pulse's JSON (a proxy's HTML page). */
  readonly code: string | null;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string | null, retryAfterSeconds?: number) {
    super(status, `Pulse request failed: ${status}${code ? ` ${code}` : ''}`);
    this.name = 'PulseApiError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const SESSION_KEY = 'spotlight:pulse-session';
const PROFILE_KEY = 'spotlight:pulse-profile';
const SESSION_ID_SHAPE = /^[\w-]{8,100}$/;

/** Used when storage is unavailable (private windows, blocked site data), so
 *  one page load still presents one identity to the daily budget. */
let memorySessionId: string | null = null;

function randomId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (!c?.getRandomValues) throw new Error('Secure random generation is unavailable.');
  return Array.from(c.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
}

/** An anonymous, random id the service hashes to count a visitor's daily
 *  usage. It carries no personal data and is never derived from any. */
export function pulseSessionId(): string {
  try {
    const stored = window.localStorage.getItem(SESSION_KEY);
    if (stored && SESSION_ID_SHAPE.test(stored)) return stored;
  } catch {
    /* unreadable storage: fall through to the in-memory id */
  }
  memorySessionId ??= randomId();
  try {
    window.localStorage.setItem(SESSION_KEY, memorySessionId);
  } catch {
    /* unwritable storage: the in-memory id still holds for this page load */
  }
  return memorySessionId;
}

// ---------------------------------------------------------------------------
// Profile (city + business type)
// ---------------------------------------------------------------------------

export interface PulseProfile {
  city: string | null;
  type: BusinessType | null;
}

function storedProfile(): PulseProfile {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      const { city, type } = parsed as Record<string, unknown>;
      return { city: isPulseCitySlug(city) ? city : null, type: isBusinessType(type) ? type : null };
    }
  } catch {
    /* corrupt JSON or unreadable storage: no stored profile */
  }
  return { city: null, type: null };
}

/**
 * The profile for this page load. A value in the URL beats a stored one, field
 * by field, because the URL is what a shared link carries. A URL value that is
 * present but invalid yields null rather than quietly falling back to storage:
 * a link to an unknown city should not silently show a different one.
 */
export function readProfile(search: URLSearchParams): PulseProfile {
  const stored = storedProfile();
  const urlCity = search.get('city');
  const urlType = search.get('type');
  return {
    city: urlCity !== null ? (isPulseCitySlug(urlCity) ? urlCity : null) : stored.city,
    type: urlType !== null ? (isBusinessType(urlType) ? urlType : null) : stored.type,
  };
}

export function saveProfile(profile: { city: string; type: BusinessType }): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ city: profile.city, type: profile.type }));
  } catch {
    /* the URL still carries the profile; losing the stored copy only costs a re-pick next visit */
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

interface RequestOptions {
  query?: Record<string, string | number>;
  body?: unknown;
  signal?: AbortSignal;
  /** Overall timeout; omit for streams. */
  timeoutMs?: number;
}

/** Fires when either signal does. AbortSignal.any is newer than some of the
 *  browsers this site still serves, so it is not assumed. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const ac = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ac.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ac.abort(s.reason), { once: true });
  }
  return ac.signal;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

async function errorFromResponse(res: Response): Promise<PulseApiError> {
  let code: string | null = null;
  try {
    const body: unknown = await res.json();
    const error = (body as { error?: unknown } | null)?.error;
    if (typeof error === 'string') code = error;
  } catch {
    /* not JSON — a proxy's error page; the status alone has to do */
  }
  const retryAfter = Number.parseInt(res.headers.get('Retry-After') ?? '', 10);
  return new PulseApiError(res.status, code, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
}

async function pulseFetch(path: string, opts: RequestOptions = {}): Promise<Response> {
  const url = new URL(`${PULSE_URL}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));

  const headers: Record<string, string> = { 'X-Pulse-Session': pulseSessionId() };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const signals: AbortSignal[] = [];
  if (opts.signal) signals.push(opts.signal);
  if (opts.timeoutMs) signals.push(AbortSignal.timeout(opts.timeoutMs));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.body !== undefined ? 'POST' : 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: signals.length ? anySignal(signals) : undefined,
    });
  } catch (err) {
    // Only the timeout is remapped; a caller's own abort must stay an AbortError.
    if (err instanceof DOMException && err.name === 'TimeoutError') throw new TimeoutError(url.toString(), opts.timeoutMs ?? 0);
    throw err;
  }
  if (!res.ok) throw await errorFromResponse(res);
  return res;
}

export interface TitleParams {
  city: string;
  type: BusinessType;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
}

const titleQuery = (p: TitleParams) => ({ city: p.city, type: p.type, mediaType: p.mediaType, tmdbId: p.tmdbId });

export async function fetchBoard(city: string, type: BusinessType, signal?: AbortSignal): Promise<BoardResponse> {
  const res = await pulseFetch('/board', { query: { city, type }, signal, timeoutMs: JSON_TIMEOUT_MS });
  return (await res.json()) as BoardResponse;
}

export async function fetchGuess(params: TitleParams, signal?: AbortSignal): Promise<Campaign> {
  const res = await pulseFetch('/guess', { query: titleQuery(params), signal, timeoutMs: JSON_TIMEOUT_MS });
  return (await res.json()) as Campaign;
}

/** Where a title was filmed or set, among the launch cities. A database-only
 *  read on the service, so it is cheap; `[]` for a title with no record. */
export async function fetchTitleLocations(mediaType: 'movie' | 'tv', tmdbId: number, signal?: AbortSignal): Promise<TitleLocationEntry[]> {
  const res = await pulseFetch('/title-locations', { query: { mediaType, tmdbId }, signal, timeoutMs: JSON_TIMEOUT_MS });
  return (await res.json()) as TitleLocationEntry[];
}

/** City-filtered venue recommendations and global artist affinities for a title. Spends
 *  the service's Qloo budget, so it is only called on an explicit request. */
export async function fetchPlanNight(
  params: { city: string; mediaType: 'movie' | 'tv'; tmdbId: number },
  signal?: AbortSignal,
): Promise<PlanNightResponse> {
  const res = await pulseFetch('/plan-night', {
    query: { city: params.city, mediaType: params.mediaType, tmdbId: params.tmdbId },
    signal,
    timeoutMs: JSON_TIMEOUT_MS,
  });
  return (await res.json()) as PlanNightResponse;
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

/**
 * Lines of a response body, as they arrive. The decoder runs in streaming mode
 * so a multibyte character cut between two network chunks is held back until
 * its second half arrives, instead of becoming two replacement characters.
 */
const MAX_STREAM_BUFFER = 1024 * 1024;

async function* readLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) {
    const text = await res.text();
    if (text.length > MAX_STREAM_BUFFER) throw new Error('Pulse stream exceeded the buffer limit.');
    for (const line of text.split(/\r?\n/)) yield line;
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      // A cancelled body can end cleanly rather than throwing, so the abort is
      // checked on its own — the caller must see an abort, not a short stream.
      if (signal?.aborted) throw abortError();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        if (nl > MAX_STREAM_BUFFER) throw new Error('Pulse stream exceeded the buffer limit.');
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        yield line.endsWith('\r') ? line.slice(0, -1) : line;
      }
      if (buffer.length > MAX_STREAM_BUFFER) throw new Error('Pulse stream exceeded the buffer limit.');
    }
    buffer += decoder.decode();
    if (buffer !== '') yield buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** One bad frame must not kill a stream that has more good ones coming. */
function parseFrame<T>(text: string, what: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    console.warn(`Pulse: skipped a malformed ${what} line`);
    return null;
  }
}

export async function streamBrief(
  params: TitleParams,
  onEvent: (e: BriefEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await pulseFetch('/brief', { query: titleQuery(params), signal });
  for await (const line of readLines(res, signal)) {
    if (line.trim() === '') continue;
    const event = parseFrame<BriefEvent>(line, 'NDJSON');
    if (!event) continue;
    if (signal?.aborted) throw abortError();
    onEvent(event);
  }
}

export async function streamChat(
  messages: { role: 'user' | 'assistant'; content: string }[],
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await pulseFetch('/chat', { body: { messages }, signal });
  let data: string[] = [];
  let frameLength = 0;
  const dispatch = () => {
    if (data.length === 0) return;
    const event = parseFrame<AgentEvent>(data.join('\n'), 'SSE');
    data = [];
    frameLength = 0;
    if (!event) return;
    if (signal?.aborted) throw abortError();
    onEvent(event);
  };
  for await (const line of readLines(res, signal)) {
    if (line === '') dispatch(); // a blank line ends an event
    else if (line.startsWith(':')) continue; // comment: the server's keep-alive ping
    else if (line.startsWith('data:')) {
      frameLength += line.length;
      if (frameLength > MAX_STREAM_BUFFER) throw new Error('Pulse stream exceeded the buffer limit.');
      data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
    }
    // event:, id: and retry: are not used by this server.
  }
  dispatch(); // a stream that ends without its final blank line
}

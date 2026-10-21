import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, BoardResponse, BriefEvent } from '../../shared/types/pulse';

// PULSE_URL is read once at import, so each test that cares about it loads a
// fresh copy of the module after stubbing the env.
async function loadApi(url: string | undefined = 'http://pulse.test') {
  vi.resetModules();
  vi.stubEnv('VITE_PULSE_URL', url as string);
  return import('./pulseApi');
}

const enc = new TextEncoder();

/** A Response whose body arrives in exactly the given chunks. */
function streamResponse(chunks: (string | Uint8Array)[], init: ResponseInit = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const params = { city: 'delhi', type: 'cafe' as const, mediaType: 'movie' as const, tmdbId: 603 };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PULSE_URL', () => {
  it('trims trailing slashes', async () => {
    expect((await loadApi('http://pulse.test///')).PULSE_URL).toBe('http://pulse.test');
  });

  it('is empty, and pulseConfigured() false, when the env var is unset', async () => {
    const api = await loadApi('');
    expect(api.PULSE_URL).toBe('');
    expect(api.pulseConfigured()).toBe(false);
  });
});

describe('pulseSessionId', () => {
  it('persists one id in localStorage and returns the same one afterwards', async () => {
    const api = await loadApi();
    const id = api.pulseSessionId();
    expect(id.length).toBeGreaterThanOrEqual(16);
    expect(window.localStorage.getItem('spotlight:pulse-session')).toBe(id);
    expect(api.pulseSessionId()).toBe(id);
  });

  it('reuses an id already in storage (a new tab, a reload)', async () => {
    window.localStorage.setItem('spotlight:pulse-session', 'stored-session-id-0001');
    const api = await loadApi();
    expect(api.pulseSessionId()).toBe('stored-session-id-0001');
  });

  it('falls back to a stable in-memory id when localStorage throws', async () => {
    const api = await loadApi();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const a = api.pulseSessionId();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(api.pulseSessionId()).toBe(a);
  });
});

describe('readProfile / saveProfile', () => {
  it('URL profile wins over the stored one', async () => {
    const api = await loadApi();
    window.localStorage.setItem('spotlight:pulse-profile', JSON.stringify({ city: 'delhi', type: 'd2c_food' }));
    expect(api.readProfile(new URLSearchParams('city=mumbai&type=cafe'))).toEqual({ city: 'mumbai', type: 'cafe' });
  });

  it('falls back to the stored profile per field when the URL is silent', async () => {
    const api = await loadApi();
    window.localStorage.setItem('spotlight:pulse-profile', JSON.stringify({ city: 'delhi', type: 'd2c_food' }));
    expect(api.readProfile(new URLSearchParams(''))).toEqual({ city: 'delhi', type: 'd2c_food' });
    expect(api.readProfile(new URLSearchParams('type=cafe'))).toEqual({ city: 'delhi', type: 'cafe' });
  });

  it('treats unknown slugs and types as null, and does not substitute a stored value for a URL value that was given', async () => {
    const api = await loadApi();
    window.localStorage.setItem('spotlight:pulse-profile', JSON.stringify({ city: 'delhi', type: 'cafe' }));
    expect(api.readProfile(new URLSearchParams('city=atlantis&type=creator'))).toEqual({ city: null, type: null });
  });

  it('ignores a corrupt or hostile stored profile', async () => {
    const api = await loadApi();
    window.localStorage.setItem('spotlight:pulse-profile', '{not json');
    expect(api.readProfile(new URLSearchParams(''))).toEqual({ city: null, type: null });
    window.localStorage.setItem('spotlight:pulse-profile', JSON.stringify({ city: 'nowhere', type: 7 }));
    expect(api.readProfile(new URLSearchParams(''))).toEqual({ city: null, type: null });
  });

  it('survives localStorage throwing', async () => {
    const api = await loadApi();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(api.readProfile(new URLSearchParams(''))).toEqual({ city: null, type: null });
    expect(() => api.saveProfile({ city: 'delhi', type: 'cafe' })).not.toThrow();
  });

  it('saveProfile round-trips through readProfile', async () => {
    const api = await loadApi();
    api.saveProfile({ city: 'london', type: 'd2c_food' });
    expect(api.readProfile(new URLSearchParams(''))).toEqual({ city: 'london', type: 'd2c_food' });
  });
});

describe('fetchBoard', () => {
  const board: BoardResponse = {
    city: 'delhi',
    cityName: 'Delhi',
    businessType: 'cafe',
    ranked: [],
    pending: [],
    unresolved: [],
  };

  it('GETs /board with the profile and the session header, and returns the body', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse(board));
    await expect(api.fetchBoard('delhi', 'cafe')).resolves.toEqual(board);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://pulse.test/board?city=delhi&type=cafe');
    expect(new Headers(init.headers).get('X-Pulse-Session')).toBe(api.pulseSessionId());
  });

  it('throws a PulseApiError carrying the server error code', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unknown_city' }, 400));
    const err = await api.fetchBoard('delhi', 'cafe').catch((e) => e);
    expect(err).toBeInstanceOf(api.PulseApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.code).toBe('unknown_city');
  });

  it('exposes Retry-After on a 429', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'rate_limited' }, 429, { 'Retry-After': '12' }));
    const err = await api.fetchBoard('delhi', 'cafe').catch((e) => e);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBe(12);
  });

  it('copes with a non-JSON error body (a proxy page): status kept, code null', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    const err = await api.fetchBoard('delhi', 'cafe').catch((e) => e);
    expect(err).toBeInstanceOf(api.PulseApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBeNull();
  });

  it('is not retried by the shared retry policy on a 4xx, but is on a 5xx', async () => {
    const api = await loadApi();
    const { shouldRetry } = await import('./http');
    expect(shouldRetry(0, new api.PulseApiError(400, 'unknown_city'))).toBe(false);
    expect(shouldRetry(0, new api.PulseApiError(429, 'rate_limited', 5))).toBe(false);
    expect(shouldRetry(0, new api.PulseApiError(503, 'unavailable'))).toBe(true);
  });

  it('lets a network failure through untouched so the UI can offer a retry', async () => {
    const api = await loadApi();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.fetchBoard('delhi', 'cafe')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('fetchGuess', () => {
  it('returns the campaign and sends the title params', async () => {
    const api = await loadApi();
    const campaign = { ideas: [], groundedBy: 'none' as const };
    fetchMock.mockResolvedValue(jsonResponse(campaign));
    await expect(api.fetchGuess(params)).resolves.toEqual(campaign);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://pulse.test/guess?city=delhi&type=cafe&mediaType=movie&tmdbId=603');
    expect(new Headers(init.headers).get('X-Pulse-Session')).toBeTruthy();
  });

  it('surfaces llm_unavailable and daily_limit codes', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'llm_unavailable' }, 503));
    expect((await api.fetchGuess(params).catch((e) => e)).code).toBe('llm_unavailable');
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'daily_limit' }, 429));
    expect((await api.fetchGuess(params).catch((e) => e)).code).toBe('daily_limit');
  });
});

describe('streamBrief (NDJSON)', () => {
  const header = { type: 'header', header: { tmdbId: 603, title: 'The Matrix' } };

  it('parses NDJSON split across chunk boundaries', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(
      streamResponse(['{"type":"hea', 'der","header":{"tmdbId":603,"title":"The Matrix"}}\n{"type":"done"}\n']),
    );
    const events: BriefEvent[] = [];
    await api.streamBrief(params, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(['header', 'done']);
    expect((events[0] as { header: { title: string } }).header.title).toBe('The Matrix');
  });

  it('keeps a multibyte character that is split between chunks intact', async () => {
    const api = await loadApi();
    const bytes = enc.encode(`${JSON.stringify({ type: 'header', header: { title: 'Café ☕' } })}\n`);
    // Cut inside the two-byte "é" (0xC3 0xA9).
    const cut = bytes.indexOf(0xc3) + 1;
    fetchMock.mockResolvedValue(streamResponse([bytes.slice(0, cut), bytes.slice(cut)]));
    const events: BriefEvent[] = [];
    await api.streamBrief(params, (e) => events.push(e));
    expect((events[0] as { header: { title: string } }).header.title).toBe('Café ☕');
  });

  it('emits a final line that has no trailing newline', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(streamResponse([`${JSON.stringify(header)}\n{"type":"done"}`]));
    const events: BriefEvent[] = [];
    await api.streamBrief(params, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(['header', 'done']);
  });

  it('ignores blank lines and skips a malformed line without failing the stream', async () => {
    const api = await loadApi();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue(streamResponse([`\n${JSON.stringify(header)}\n\n{oops not json\n\r\n{"type":"done"}\n`]));
    const events: BriefEvent[] = [];
    await api.streamBrief(params, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(['header', 'done']);
    warn.mockRestore();
  });

  it('throws a PulseApiError before any event on a non-2xx response', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'rate_limited' }, 429, { 'Retry-After': '30' }));
    const onEvent = vi.fn();
    const err = await api.streamBrief(params, onEvent).catch((e) => e);
    expect(err).toBeInstanceOf(api.PulseApiError);
    expect(err.status).toBe(429);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBe(30);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('sends the title params, the session header and the caller signal', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(streamResponse(['{"type":"done"}\n']));
    const ac = new AbortController();
    await api.streamBrief(params, () => {}, ac.signal);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://pulse.test/brief?city=delhi&type=cafe&mediaType=movie&tmdbId=603');
    expect(new Headers(init.headers).get('X-Pulse-Session')).toBeTruthy();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('honours the AbortSignal: rejects with an AbortError and stops delivering events', async () => {
    const api = await loadApi();
    const ac = new AbortController();
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(enc.encode(`${JSON.stringify(header)}\n`));
      },
    });
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', () => body.cancel().catch(() => {}));
      return new Response(body, { status: 200 });
    });
    const events: BriefEvent[] = [];
    const run = api.streamBrief(params, (e) => {
      events.push(e);
      ac.abort();
    }, ac.signal);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    const seen = events.length;
    await new Promise((r) => setTimeout(r, 10));
    expect(events.length).toBe(seen);
    expect(sent).toBeGreaterThan(0);
  });
});

describe('streamChat (SSE)', () => {
  const messages = [{ role: 'user' as const, content: 'which release should I theme my menu around?' }];
  const sse = (e: AgentEvent) => `data: ${JSON.stringify(e)}\n\n`;

  it('POSTs the messages as JSON with the session header', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(streamResponse([sse({ type: 'done' })]));
    await api.streamChat(messages, () => {});
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://pulse.test/chat');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Pulse-Session')).toBeTruthy();
    expect(JSON.parse(init.body)).toEqual({ messages });
  });

  it('parses data lines, ignores ping comments, and handles events split across chunks', async () => {
    const api = await loadApi();
    const full = [sse({ type: 'tool', name: 'pulse_board', args: '{}' }), ': ping\n\n', sse({ type: 'message', text: 'Café ☕ night' }), sse({ type: 'done' })].join('');
    const bytes = enc.encode(full);
    // Awkward cuts: mid-"data:", mid-JSON, and inside the multibyte "é".
    const cuts = [3, 20, bytes.indexOf(0xc3) + 1];
    const chunks: Uint8Array[] = [];
    let from = 0;
    for (const c of [...cuts].sort((a, b) => a - b)) {
      chunks.push(bytes.slice(from, c));
      from = c;
    }
    chunks.push(bytes.slice(from));
    fetchMock.mockResolvedValue(streamResponse(chunks));
    const events: AgentEvent[] = [];
    await api.streamChat(messages, (e) => events.push(e));
    expect(events).toEqual([
      { type: 'tool', name: 'pulse_board', args: '{}' },
      { type: 'message', text: 'Café ☕ night' },
      { type: 'done' },
    ]);
  });

  it('accepts CRLF line endings and skips a malformed data payload', async () => {
    const api = await loadApi();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue(streamResponse(['data: {"type":"message","text":"hi"}\r\n\r\n', 'data: {nope\n\n', 'data: {"type":"done"}\r\n\r\n']));
    const events: AgentEvent[] = [];
    await api.streamChat(messages, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(['message', 'done']);
  });

  it('throws a PulseApiError on a non-2xx response before any event', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'daily_limit' }, 429));
    const onEvent = vi.fn();
    const err = await api.streamChat(messages, onEvent).catch((e) => e);
    expect(err).toBeInstanceOf(api.PulseApiError);
    expect(err.code).toBe('daily_limit');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('stops when the signal aborts', async () => {
    const api = await loadApi();
    const ac = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(enc.encode(sse({ type: 'message', text: 'x' })));
      },
    });
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', () => body.cancel().catch(() => {}));
      return new Response(body, { status: 200 });
    });
    const run = api.streamChat(messages, () => ac.abort(), ac.signal);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetchTitleLocations and fetchPlanNight', () => {
  it('fetchTitleLocations GETs /title-locations with the title only', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse([{ city_slug: 'delhi', cityName: 'Delhi', kind: 'filmed', landmark_label: null, source: 'both' }]));
    const rows = await api.fetchTitleLocations('tv', 77);
    expect(rows).toHaveLength(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('http://pulse.test/title-locations');
    expect(Object.fromEntries(url.searchParams)).toEqual({ mediaType: 'tv', tmdbId: '77' });
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('fetchPlanNight GETs /plan-night with city and title', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({ title: 'T', cityName: 'Delhi', places: { status: 'empty', data: null, provenance: [] }, artists: { status: 'empty', data: null, provenance: [] } }));
    const out = await api.fetchPlanNight({ city: 'delhi', mediaType: 'movie', tmdbId: 5 });
    expect(out.cityName).toBe('Delhi');
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/plan-night');
    expect(Object.fromEntries(url.searchParams)).toEqual({ city: 'delhi', mediaType: 'movie', tmdbId: '5' });
  });

  it('surfaces the service error code and Retry-After for plan-night', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'rate_limited' }, 429, { 'Retry-After': '12' }));
    await expect(api.fetchPlanNight({ city: 'delhi', mediaType: 'movie', tmdbId: 5 })).rejects.toMatchObject({ status: 429, code: 'rate_limited', retryAfterSeconds: 12 });
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unknown_title' }, 404));
    await expect(api.fetchPlanNight({ city: 'delhi', mediaType: 'movie', tmdbId: 5 })).rejects.toMatchObject({ status: 404, code: 'unknown_title' });
  });
});

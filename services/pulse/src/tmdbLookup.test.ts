import { describe, expect, it, vi } from "vitest";
import { lookupTmdbTitle, TMDB_TIMEOUT_MS, TmdbNotConfiguredError, TmdbUnavailableError } from "./tmdbLookup.js";

// A made-up key that must never appear in an error message or a request log.
const KEY = "test-key-not-real-0000";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A scripted fetch: each call takes the next reply; an Error is thrown, not returned. */
function scripted(replies: (Response | Error)[]) {
  const urls: string[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request) => {
    urls.push(String(url));
    const next = replies.shift();
    if (!next) throw new Error("no scripted reply left");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, urls, calls: fetchFn };
}

function deps(replies: (Response | Error)[], over: { apiKey?: string | null } = {}) {
  const s = scripted(replies);
  const waits: number[] = [];
  return { ...s, waits, d: { fetch: s.fetchFn, sleep: async (ms: number) => { waits.push(ms); }, apiKey: KEY, ...over } };
}

describe("lookupTmdbTitle: answers", () => {
  it("reads imdb id, title and year from a movie", async () => {
    const { d, urls } = deps([json({ imdb_id: "tt0000001", title: "Fixture Film", release_date: "2024-05-17" })]);
    expect(await lookupTmdbTitle("movie", 42, d)).toEqual({ imdbId: "tt0000001", title: "Fixture Film", year: "2024" });
    expect(urls).toHaveLength(1);
    const u = new URL(urls[0]);
    expect(u.origin + u.pathname).toBe("https://api.themoviedb.org/3/movie/42");
    expect(u.searchParams.get("api_key")).toBe(KEY);
    expect(u.searchParams.has("append_to_response")).toBe(false);
  });

  it("reads a show's imdb id from external_ids, and its name and first air date", async () => {
    const { d, urls } = deps([json({ name: "Fixture Show", first_air_date: "2022-02-18", external_ids: { imdb_id: "tt0000002" } })]);
    expect(await lookupTmdbTitle("tv", 7, d)).toEqual({ imdbId: "tt0000002", title: "Fixture Show", year: "2022" });
    const u = new URL(urls[0]);
    expect(u.pathname).toBe("/3/tv/7");
    expect(u.searchParams.get("append_to_response")).toBe("external_ids");
  });

  it("returns null fields, not null, for a real title with no IMDb id, title or date", async () => {
    const { d } = deps([json({ imdb_id: "", title: "N/A" })]);
    expect(await lookupTmdbTitle("movie", 1, d)).toEqual({ imdbId: null, title: null, year: null });
  });

  it("returns null only for a definite 404, without retrying", async () => {
    const { d, calls, waits } = deps([json({ status_code: 34 }, 404)]);
    expect(await lookupTmdbTitle("movie", 1, d)).toBeNull();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
});

describe("lookupTmdbTitle: outages", () => {
  it("throws TmdbUnavailableError after three 500s, waiting 250 ms then 750 ms", async () => {
    const { d, calls, waits } = deps([json({}, 500), json({}, 502), json({}, 503)]);
    const err = await lookupTmdbTitle("movie", 1, d).catch((e) => e);
    expect(err).toBeInstanceOf(TmdbUnavailableError);
    expect(err.attempts).toBe(3);
    expect(calls).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([250, 750]);
  });

  it("recovers when a 500 is followed by a 200", async () => {
    const { d, calls, waits } = deps([json({}, 500), json({ imdb_id: "tt0000003", title: "T", release_date: "2020-01-01" })]);
    expect(await lookupTmdbTitle("movie", 1, d)).toEqual({ imdbId: "tt0000003", title: "T", year: "2020" });
    expect(calls).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([250]);
  });

  it("retries a timeout and a network error", async () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    const { d, calls } = deps([timeout, new TypeError("fetch failed"), json({ imdb_id: "tt0000004" })]);
    expect(await lookupTmdbTitle("movie", 1, d)).toMatchObject({ imdbId: "tt0000004" });
    expect(calls).toHaveBeenCalledTimes(3);
  });

  it("throws TmdbUnavailableError when every attempt times out", async () => {
    const t = () => new DOMException("The operation timed out.", "TimeoutError");
    const { d } = deps([t(), t(), t()]);
    await expect(lookupTmdbTitle("movie", 1, d)).rejects.toBeInstanceOf(TmdbUnavailableError);
  });

  it("gives every attempt an 8 second timeout, and 8 seconds is the default", async () => {
    expect(TMDB_TIMEOUT_MS).toBe(8000);
    const spy = vi.spyOn(AbortSignal, "timeout");
    try {
      const { d, calls } = deps([json({}, 500), json({}, 503), json({ imdb_id: "tt0000005" })]);
      await lookupTmdbTitle("movie", 1, d);
      expect(calls).toHaveBeenCalledTimes(3);
      expect(spy.mock.calls).toEqual([[8000], [8000], [8000]]);
    } finally { spy.mockRestore(); }
  });

  it("releases the socket: an unused response body is cancelled on 404, 429, 5xx and other 4xx", async () => {
    for (const status of [404, 429, 500, 401]) {
      const res = new Response("unused body", { status });
      const cancel = vi.spyOn(res.body!, "cancel");
      const replies: (Response | Error)[] = status === 404 ? [res] : status === 401 ? [res] : [res, json({ imdb_id: "tt0000008" })];
      const { d } = deps(replies);
      await lookupTmdbTitle("movie", 1, d).catch(() => {});
      expect(cancel, `status ${status}`).toHaveBeenCalled();
    }
  });

  it("a body that cannot be cancelled does not break the lookup", async () => {
    const res = new Response("x", { status: 404 });
    vi.spyOn(res.body!, "cancel").mockRejectedValue(new Error("already closed"));
    const { d } = deps([res]);
    expect(await lookupTmdbTitle("movie", 1, d)).toBeNull();
  });

  it("honours Retry-After on a 429, capped at 2 seconds", async () => {
    const a = deps([json({}, 429, { "retry-after": "1" }), json({ imdb_id: "tt0000006" })]);
    await lookupTmdbTitle("movie", 1, a.d);
    expect(a.waits).toEqual([1000]);

    const b = deps([json({}, 429, { "retry-after": "30" }), json({ imdb_id: "tt0000006" })]);
    await lookupTmdbTitle("movie", 1, b.d);
    expect(b.waits).toEqual([2000]);

    const c = deps([json({}, 429), json({ imdb_id: "tt0000006" })]);
    await lookupTmdbTitle("movie", 1, c.d);
    expect(c.waits).toEqual([250]);
  });

  it("treats a 200 whose body is not JSON as an outage, not as an answer", async () => {
    const bad = () => new Response("<html>gateway</html>", { status: 200 });
    const { d } = deps([bad(), bad(), bad()]);
    await expect(lookupTmdbTitle("movie", 1, d)).rejects.toBeInstanceOf(TmdbUnavailableError);
  });

  it("does not retry a rejected key (401), but still never reports it as a missing title", async () => {
    const { d, calls } = deps([json({ status_code: 7 }, 401)]);
    await expect(lookupTmdbTitle("movie", 1, d)).rejects.toBeInstanceOf(TmdbUnavailableError);
    expect(calls).toHaveBeenCalledTimes(1);
  });
});

describe("lookupTmdbTitle: configuration and secrecy", () => {
  it("throws a clear configuration error when the key is missing, before any request", async () => {
    for (const apiKey of [null, ""]) {
      const { d, calls } = deps([json({})], { apiKey });
      const err = await lookupTmdbTitle("movie", 1, d).catch((e) => e);
      expect(err).toBeInstanceOf(TmdbNotConfiguredError);
      expect(err.message).toContain("TMDB_API_KEY");
      expect(err).not.toBeInstanceOf(TmdbUnavailableError);
      expect(calls).not.toHaveBeenCalled();
    }
  });

  it("reads the key from TMDB_API_KEY when none is injected", async () => {
    const prev = process.env.TMDB_API_KEY;
    delete process.env.TMDB_API_KEY;
    try {
      const { d, calls } = deps([json({})]);
      const { apiKey: _drop, ...noKey } = d;
      await expect(lookupTmdbTitle("movie", 1, noKey)).rejects.toBeInstanceOf(TmdbNotConfiguredError);
      expect(calls).not.toHaveBeenCalled();
      process.env.TMDB_API_KEY = KEY;
      const ok = deps([json({ imdb_id: "tt0000007" })]);
      const { apiKey: _drop2, ...noKey2 } = ok.d;
      expect(await lookupTmdbTitle("movie", 1, noKey2)).toMatchObject({ imdbId: "tt0000007" });
      expect(new URL(ok.urls[0]).searchParams.get("api_key")).toBe(KEY);
    } finally {
      if (prev === undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY = prev;
    }
  });

  it("never puts the key or the request URL in an error, even when the network error names them", async () => {
    const leaky = () => new TypeError(`fetch failed: https://api.themoviedb.org/3/movie/1?api_key=${KEY}`);
    const cases: (Response | Error)[][] = [
      [json({}, 500), json({}, 500), json({}, 500)],
      [leaky(), leaky(), leaky()],
      [json({}, 401)],
    ];
    for (const replies of cases) {
      const { d } = deps(replies);
      const err = await lookupTmdbTitle("movie", 1, d).catch((e) => e);
      expect(err).toBeInstanceOf(TmdbUnavailableError);
      const text = `${err.message} ${err.stack ?? ""} ${JSON.stringify(err)} ${String(err.cause ?? "")}`;
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("api_key");
      expect(text).not.toContain("themoviedb.org");
    }
  });
});

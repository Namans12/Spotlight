import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveProviders, tmdbWatchProvidersBatch, providerCacheKey, tmdbCollectionParts } from './tmdbProxy';

function watchProvidersPayload(region: string, buckets: Record<string, { provider_name: string }[]>) {
  return { 'watch/providers': { results: { [region]: buckets } } };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubEnv('TMDB_API_KEY', 'test-key');
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('resolveProviders', () => {
  it('prefers a local subscription over everything else', () => {
    const details = watchProvidersPayload('IN', {
      flatrate: [{ provider_name: 'Netflix' }],
      buy: [{ provider_name: 'Apple TV' }],
    });
    expect(resolveProviders(details, 'IN')).toEqual(['Netflix']);
  });

  it('tags a purchase-only listing so it can never read as a subscription', () => {
    // "Apple TV" normalizes to the canonical "Apple TV+" (shared/platforms.json's
    // alias table) before tagging -- asserting the raw input name back would
    // just be testing a stub, not this function.
    const details = watchProvidersPayload('IN', { rent: [{ provider_name: 'Apple TV' }] });
    expect(resolveProviders(details, 'IN')).toEqual(['Apple TV+ (Buy/Rent)']);
  });

  it('falls back to a generic label when a purchase listing has no usable name', () => {
    const details = watchProvidersPayload('IN', { buy: [{ provider_name: '' }] });
    expect(resolveProviders(details, 'IN')).toEqual(['Buy/Rent']);
  });

  it('returns nothing when no tier has an answer', () => {
    expect(resolveProviders({}, 'IN')).toEqual([]);
  });
});

describe('tmdbWatchProvidersBatch', () => {
  it('resolves every key from a single fetch attempt each, with no retries', async () => {
    // Two keys: one succeeds immediately, one fails immediately. If a failed
    // leg were still going through fetchWithRetry's default 3 attempts, this
    // mock would be called 4 times (1 + 3), not 2 -- that difference is the
    // whole point of the fix (an 8s-timeout leg retried 3x costs ~25s, and
    // Promise.allSettled waits for the slowest leg before returning anything).
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, watchProvidersPayload('IN', { flatrate: [{ provider_name: 'Netflix' }] })))
      .mockResolvedValueOnce(jsonResponse(500, {}));

    const result = await tmdbWatchProvidersBatch(
      [{ mediaType: 'movie', id: 1 }, { mediaType: 'movie', id: 2 }],
      'IN',
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.providers).toEqual({ 'movie:1': ['Netflix'] });
    expect(result.hadFailures).toBe(true);
  });

  it('omits a failed key rather than reporting it as confirmed-empty', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(500, {}));

    const result = await tmdbWatchProvidersBatch([{ mediaType: 'movie', id: 1 }], 'IN');

    // The distinction under test: a real "checked, nothing to watch it on"
    // answer is `[]`; a failed check must not look like that, or a transient
    // TMDB error reads as a permanent fact about the title.
    expect(result.providers).toEqual({});
    expect(Object.keys(result.providers)).not.toContain(providerCacheKey({ mediaType: 'movie', id: 1 }));
    expect(result.hadFailures).toBe(true);
  });

  it('reports no failures when every key genuinely has no providers', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, watchProvidersPayload('IN', {})));

    const result = await tmdbWatchProvidersBatch([{ mediaType: 'movie', id: 1 }], 'IN');

    // A real empty answer IS cacheable at the long TTL -- only a failure isn't.
    expect(result.providers).toEqual({ 'movie:1': [] });
    expect(result.hadFailures).toBe(false);
  });

  it('never fires more requests than keys passed in, one per key', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, watchProvidersPayload('IN', {})));

    await tmdbWatchProvidersBatch(
      [{ mediaType: 'movie', id: 1 }, { mediaType: 'tv', id: 2 }, { mediaType: 'movie', id: 3 }],
      'IN',
    );

    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('tmdbCollectionParts retry budget', () => {
  // Two sequential legs at 3 attempts each is ~50s worst case against a 15s
  // maxDuration. The budget is what makes retrying safe on a request path, so
  // it is asserted rather than assumed.
  it('stops retrying once the wall-clock budget is spent', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() => Promise.reject(new Error('ECONNRESET')));

    const started = Date.now();
    await expect(tmdbCollectionParts(603, 3, 300)).rejects.toThrow();
    // Without the budget this would burn 3 attempts plus ~750ms of backoff.
    expect(Date.now() - started).toBeLessThan(1_500);
    // At least one attempt is always made, and fewer than the full three.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.length).toBeLessThan(3);
  });

  it('still retries a transient failure when there is budget for it', async () => {
    const fetchMock = vi.mocked(fetch);
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('ECONNRESET'));
      if (calls === 2) {
        return Promise.resolve(jsonResponse(200, { belongs_to_collection: { id: 10 } }));
      }
      return Promise.resolve(
        jsonResponse(200, {
          name: 'Star Wars Collection',
          parts: [
            { id: 11, title: 'Star Wars', release_date: '1977-05-25' },
            { id: 1891, title: 'The Empire Strikes Back', release_date: '1980-05-20' },
          ],
        }),
      );
    });

    const collection = await tmdbCollectionParts(603, 3, 10_000);
    expect(collection?.id).toBe(10);
    expect(collection?.parts).toHaveLength(2);
    expect(calls).toBe(3); // one failure, then both legs
  });

  it('returns the collection id so the caller can classify its shape', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { belongs_to_collection: { id: 645 } }) as never)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          name: 'James Bond Collection',
          parts: [
            { id: 646, title: 'Dr. No', release_date: '1962-10-07' },
            { id: 657, title: 'From Russia with Love', release_date: '1963-10-10' },
          ],
        }) as never,
      );

    const collection = await tmdbCollectionParts(646);
    expect(collection).toMatchObject({ id: 645, name: 'James Bond Collection' });
  });

  it('returns null for a title in no collection', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { belongs_to_collection: null }) as never);
    expect(await tmdbCollectionParts(603)).toBeNull();
  });
});

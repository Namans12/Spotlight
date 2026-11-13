import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOmdbRatings, parseOmdbPayload, resolveOmdbLookup } from './omdb';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('OMDb response boundaries', () => {
  it('ignores malformed rating entries while preserving valid scores', () => {
    expect(parseOmdbPayload({ imdbID: 'tt1234567', Ratings: [null, 'bad', { Source: 'Rotten Tomatoes', Value: '86%' }] }))
      .toMatchObject({ imdbId: 'tt1234567', rtScore: 86, notFound: false });
  });

  it('does not cache a malformed upstream response as a missing title', async () => {
    vi.stubEnv('OMDB_API_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ['unexpected'] }));
    expect(await fetchOmdbRatings({ imdbId: 'tt1234567', title: null, year: null })).toBeNull();
  });

  it('tolerates malformed TV external IDs', async () => {
    vi.stubEnv('TMDB_API_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'Example', external_ids: 'unexpected' }) }));
    expect(await resolveOmdbLookup('tv', 1)).toEqual({ imdbId: null, title: 'Example', year: null });
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Same shape-free alias lib/tmdbProxy.ts uses for raw TMDB JSON: these
// fixtures are deliberately partial payloads, not typed records.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TmdbRow = any;
import {
  resolveProviders,
  tmdbWatchProvidersBatch,
  providerCacheKey,
  tmdbCollectionParts,
  tmdbPerson,
  tmdbDetail,
} from './tmdbProxy';

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

// ---------------------------------------------------------------------------
// tmdbPerson
//
// The filmography behind every cast link. Its whole job is ordering, and the
// ordering has one dangerous failure mode (see isAppearanceNotARole): TMDB's
// popularity score for a nightly talk show is an order of magnitude above any
// film's, so a naive popularity sort opens an actor's page with six chat shows
// they once sat on a sofa for.
// ---------------------------------------------------------------------------

function personPayload(cast: TmdbRow[], crew: TmdbRow[] = []) {
  return {
    id: 887,
    name: 'Owen Wilson',
    profile_path: '/face.jpg',
    biography: 'An actor.',
    known_for_department: 'Acting',
    birthday: '1968-11-18',
    place_of_birth: 'Dallas, Texas, USA',
    combined_credits: { cast, crew },
  };
}

const FILM = {
  id: 920,
  media_type: 'movie',
  title: 'Cars',
  release_date: '2006-06-08',
  character: 'Lightning McQueen',
  popularity: 40,
  poster_path: '/cars.jpg',
};

const TALK_SHOW = {
  id: 2224,
  media_type: 'tv',
  name: 'The Daily Show',
  first_air_date: '1996-07-22',
  character: 'Self',
  popularity: 900,
  genre_ids: [10767], // Talk
  episode_count: 3,
};

describe('tmdbPerson', () => {
  it('does not let a talk-show appearance outrank an actual film', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, personPayload([TALK_SHOW, FILM])));

    const person = await tmdbPerson(887);

    expect(person.credits.map((c) => c.title)).toEqual(['Cars']);
  });

  it('drops a one-off guest spot on a scripted show but keeps a real part', async () => {
    const guestSpot = {
      id: 1,
      media_type: 'tv',
      name: 'Anthology',
      first_air_date: '2015-01-01',
      character: 'Waiter',
      popularity: 500,
      genre_ids: [18],
      episode_count: 1,
    };
    const realRole = {
      id: 2,
      media_type: 'tv',
      name: 'Loki',
      first_air_date: '2021-06-09',
      character: 'Mobius',
      popularity: 80,
      genre_ids: [10765],
      episode_count: 12,
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, personPayload([guestSpot, realRole])));

    const person = await tmdbPerson(887);

    expect(person.credits.map((c) => c.title)).toEqual(['Loki']);
  });

  it('drops playing yourself even in a film', async () => {
    const asSelf = { ...FILM, id: 5, title: 'A Documentary', character: 'Himself', popularity: 999 };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, personPayload([asSelf, FILM])));

    const person = await tmdbPerson(887);

    expect(person.credits.map((c) => c.title)).toEqual(['Cars']);
  });

  it('ranks released work ahead of an unreleased project, however hyped', async () => {
    const unmade = {
      id: 99,
      media_type: 'movie',
      title: 'Announced Sequel',
      release_date: '2031-01-01',
      character: 'Lead',
      popularity: 5000,
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, personPayload([unmade, FILM])));

    const person = await tmdbPerson(887);

    expect(person.credits.map((c) => c.title)).toEqual(['Cars', 'Announced Sequel']);
  });

  it('keeps one entry per title when a person is credited twice on it', async () => {
    // Directed and starred in the same film: two rows, one piece of work. The
    // acting credit wins because `cast` is read first.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, personPayload([FILM], [{ ...FILM, character: undefined, job: 'Director' }])),
    );

    const person = await tmdbPerson(887);

    expect(person.credits).toHaveLength(1);
    expect(person.credits[0].role).toBe('Lightning McQueen');
  });

  it('reports a crew job as the role when there is no character', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, personPayload([], [{ ...FILM, character: undefined, job: 'Director' }])),
    );

    const person = await tmdbPerson(887);

    expect(person.credits[0].role).toBe('Director');
  });

  it('carries the person themselves, not only their credits', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, personPayload([FILM])));

    const person = await tmdbPerson(887);

    expect(person).toMatchObject({
      id: 887,
      name: 'Owen Wilson',
      knownFor: 'Acting',
      birthday: '1968-11-18',
      placeOfBirth: 'Dallas, Texas, USA',
      deathday: null,
    });
  });
});

// ---------------------------------------------------------------------------
// tmdbDetail — the fields the title page's facts panel is built from.
// ---------------------------------------------------------------------------

describe('tmdbDetail certification', () => {
  function movieWithCertificates(results: TmdbRow[]) {
    return {
      id: 1,
      title: 'A Film',
      release_date: '2026-01-01',
      runtime: 93,
      budget: 80_000_000,
      revenue: 117_234_000,
      release_dates: { results },
    };
  }

  it('prefers the region the reader is in', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        200,
        movieWithCertificates([
          { iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] },
          { iso_3166_1: 'IN', release_dates: [{ certification: 'U/A 13+' }] },
        ]),
      ),
    );

    const detail = await tmdbDetail('movie', 1, 'IN');

    expect(detail.certification).toEqual({ value: 'U/A 13+', region: 'IN' });
  });

  // TMDB's Indian certification coverage is thin. "PG-13 (US)" is a more
  // useful answer than none, as long as the label says whose rating it is.
  it('falls back to the US certificate, tagged as such', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, movieWithCertificates([{ iso_3166_1: 'US', release_dates: [{ certification: 'R' }] }])),
    );

    const detail = await tmdbDetail('movie', 1, 'IN');

    expect(detail.certification).toEqual({ value: 'R', region: 'US' });
  });

  it('skips a region entry whose certificate is an empty string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        200,
        movieWithCertificates([
          { iso_3166_1: 'IN', release_dates: [{ certification: '' }, { certification: 'A' }] },
        ]),
      ),
    );

    const detail = await tmdbDetail('movie', 1, 'IN');

    expect(detail.certification).toEqual({ value: 'A', region: 'IN' });
  });

  it('reports no certificate rather than inventing one', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, movieWithCertificates([])));

    const detail = await tmdbDetail('movie', 1, 'IN');

    expect(detail.certification).toBeNull();
  });

  it('reads a TV certificate from content_ratings instead', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        id: 1396,
        name: 'Breaking Bad',
        first_air_date: '2008-01-20',
        number_of_seasons: 5,
        number_of_episodes: 62,
        status: 'Ended',
        content_ratings: { results: [{ iso_3166_1: 'IN', rating: 'A' }] },
      }),
    );

    const detail = await tmdbDetail('tv', 1396, 'IN');

    expect(detail.certification).toEqual({ value: 'A', region: 'IN' });
    expect(detail.numberOfEpisodes).toBe(62);
    expect(detail.status).toBe('Ended');
    // Budget and revenue are movie-only concepts; a series must not report $0.
    expect(detail.budget).toBeNull();
    expect(detail.revenue).toBeNull();
  });
});

describe('tmdbDetail money', () => {
  it('treats the TMDB zero as unknown rather than as a real figure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { id: 1, title: 'Unreleased', release_date: '2027-01-01', budget: 0, revenue: 0 }),
    );

    const detail = await tmdbDetail('movie', 1, 'IN');

    expect(detail.budget).toBeNull();
    expect(detail.revenue).toBeNull();
  });

  it('passes real figures straight through for the formatter to handle', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, {
        id: 1,
        title: 'A Film',
        release_date: '2026-01-01',
        budget: 80_000_000,
        revenue: 117_234_000,
      }),
    );

    const detail = await tmdbDetail('movie', 1, 'IN');

    expect(detail.budget).toBe(80_000_000);
    expect(detail.revenue).toBe(117_234_000);
  });
});

describe('tmdbDetail logo', () => {
  function withLogos(logos: TmdbRow[]) {
    return { id: 1, title: 'A Film', release_date: '2026-01-01', images: { logos } };
  }

  it('prefers an English logo over the title’s own language', () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        200,
        withLogos([
          { iso_639_1: 'hi', file_path: '/hindi-logo.png' },
          { iso_639_1: 'en', file_path: '/english-logo.png' },
        ]),
      ),
    );

    const detail = tmdbDetail('movie', 1, 'IN');
    return expect(detail).resolves.toMatchObject({ logoPath: '/english-logo.png' });
  });

  // A language-untagged mark is usually a generic symbol, which sits more
  // comfortably in an English UI than a wordmark in a third language would.
  it('falls back to a language-untagged logo before anything else', () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        200,
        withLogos([
          { iso_639_1: 'fr', file_path: '/french-logo.png' },
          { iso_639_1: null, file_path: '/untagged-logo.png' },
        ]),
      ),
    );

    const detail = tmdbDetail('movie', 1, 'IN');
    return expect(detail).resolves.toMatchObject({ logoPath: '/untagged-logo.png' });
  });

  it('takes whatever is available when neither English nor untagged exists', () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, withLogos([{ iso_639_1: 'fr', file_path: '/french-logo.png' }])));

    const detail = tmdbDetail('movie', 1, 'IN');
    return expect(detail).resolves.toMatchObject({ logoPath: '/french-logo.png' });
  });

  it('is null for a title with no logo artwork at all', () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, withLogos([])));

    const detail = tmdbDetail('movie', 1, 'IN');
    return expect(detail).resolves.toMatchObject({ logoPath: null });
  });
});

describe('tmdbDetail trailer', () => {
  function withVideos(results: TmdbRow[]) {
    return { id: 1, title: 'A Film', release_date: '2026-01-01', videos: { results } };
  }

  it('prefers an official trailer over an unofficial one', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        200,
        withVideos([
          { type: 'Trailer', site: 'YouTube', official: false, key: 'fan-cut', name: 'Fan Trailer' },
          { type: 'Trailer', site: 'YouTube', official: true, key: 'real-trailer', name: 'Official Trailer' },
        ]),
      ),
    );

    const detail = await tmdbDetail('movie', 1, 'IN');
    expect(detail.trailer).toEqual({ key: 'real-trailer', site: 'YouTube', name: 'Official Trailer' });
  });

  // No trailer yet is common for a freshly announced or obscure title; a
  // teaser is a better answer than nothing, as long as it is labelled as one.
  it('falls back to a teaser when there is no trailer', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, withVideos([{ type: 'Teaser', site: 'YouTube', official: true, key: 'teaser-1', name: 'Teaser' }])),
    );

    const detail = await tmdbDetail('movie', 1, 'IN');
    expect(detail.trailer).toEqual({ key: 'teaser-1', site: 'YouTube', name: 'Teaser' });
  });

  it('ignores a video that is not hosted on YouTube', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, withVideos([{ type: 'Trailer', site: 'Vimeo', official: true, key: 'x', name: 'Trailer' }])),
    );

    const detail = await tmdbDetail('movie', 1, 'IN');
    expect(detail.trailer).toBeNull();
  });

  it('is null when there are no videos at all', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, withVideos([])));

    const detail = await tmdbDetail('movie', 1, 'IN');
    expect(detail.trailer).toBeNull();
  });
});

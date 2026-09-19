import { describe, it, expect } from 'vitest';
import { computeWrapped, wrappedSummary, MIN_TITLES_FOR_WRAPPED, type WrappedInput } from './wrapped';
import type { WatchlistItem } from '@/types/movie';

const NOW = new Date('2026-09-19T12:00:00Z');

function item(overrides: Partial<WatchlistItem> & { id: number }): WatchlistItem {
  return {
    dbId: overrides.id,
    title: `Title ${overrides.id}`,
    posterPath: null,
    overview: '',
    releaseDate: '2024-01-01',
    mediaType: 'movie',
    voteAverage: 7,
    originalLanguage: 'en',
    addedAt: Date.parse('2026-03-04T00:00:00Z'),
    ...overrides,
  };
}

function build(overrides: Partial<WrappedInput> = {}): WrappedInput {
  return {
    watchlist: [],
    watchLater: [],
    watched: [],
    runtimeFor: () => undefined,
    genresFor: () => undefined,
    platformsFor: () => undefined,
    now: NOW,
    ...overrides,
  };
}

describe('what counts as this year', () => {
  it('counts only titles saved in the current year', () => {
    const stats = computeWrapped(
      build({
        watchlist: [
          item({ id: 1, addedAt: Date.parse('2026-02-01') }),
          item({ id: 2, addedAt: Date.parse('2025-12-31') }),
        ],
      }),
    );
    expect(stats.savedThisYear).toBe(1);
    expect(stats.year).toBe(2026);
  });

  // You can mark a film you saw in March at any point. The mark belongs to
  // your year even though the row was created today.
  it('counts everything marked seen, regardless of when it was saved', () => {
    const stats = computeWrapped(
      build({ watched: [item({ id: 1, addedAt: Date.parse('2021-01-01') })] }),
    );
    expect(stats.seenThisYear).toBe(1);
  });
});

describe('hours', () => {
  it('adds up film runtimes', () => {
    const stats = computeWrapped(
      build({
        watched: [item({ id: 1 }), item({ id: 2 })],
        runtimeFor: (_t, id) => (id === 1 ? 117 : 93),
      }),
    );
    expect(stats.minutesFromFilms).toBe(210);
  });

  // The central honesty rule. Marking a 62-episode series seen says "I have
  // seen this show", not "I watched 62 episodes this year" — multiplying
  // episode length by episode count would invent roughly 47 hours.
  it('never turns a series into hours, and counts it separately', () => {
    const stats = computeWrapped(
      build({
        watched: [item({ id: 1396, mediaType: 'tv' }), item({ id: 920 })],
        runtimeFor: (type) => (type === 'tv' ? 47 : 117),
      }),
    );
    expect(stats.minutesFromFilms).toBe(117);
    expect(stats.seriesSeen).toBe(1);
  });

  it('skips a film TMDB has no runtime for rather than counting it as zero', () => {
    const stats = computeWrapped(
      build({ watched: [item({ id: 1 }), item({ id: 2 })], runtimeFor: (_t, id) => (id === 1 ? 117 : undefined) }),
    );
    expect(stats.minutesFromFilms).toBe(117);
  });

  it('names the longest film', () => {
    const stats = computeWrapped(
      build({
        watched: [item({ id: 1, title: 'Short' }), item({ id: 2, title: 'Long' }), item({ id: 3, title: 'Middle' })],
        runtimeFor: (_t, id) => ({ 1: 90, 2: 201, 3: 130 })[id],
      }),
    );
    expect(stats.longestFilm).toEqual({ title: 'Long', minutes: 201 });
  });

  it('names no longest film when no runtime is known', () => {
    const stats = computeWrapped(build({ watched: [item({ id: 1 })] }));
    expect(stats.longestFilm).toBeNull();
  });
});

describe('tallies', () => {
  it('ranks genres across everything saved this year', () => {
    const stats = computeWrapped(
      build({
        watchlist: [item({ id: 1 }), item({ id: 2 })],
        watchLater: [item({ id: 3 })],
        genresFor: (_t, id) => (id === 3 ? ['Comedy'] : ['Thriller', 'Drama']),
      }),
    );
    expect(stats.topGenres).toEqual([
      { label: 'Drama', count: 2 },
      { label: 'Thriller', count: 2 },
      { label: 'Comedy', count: 1 },
    ]);
  });

  it('resolves language codes to names', () => {
    const stats = computeWrapped(
      build({ watchlist: [item({ id: 1, originalLanguage: 'hi' }), item({ id: 2, originalLanguage: 'hi' })] }),
    );
    expect(stats.topLanguages[0]).toEqual({ label: 'Hindi', count: 2 });
  });

  // A title on four services would otherwise cast four votes and drown out one
  // carried by a single service, which says nothing about where you watch.
  it('counts only the primary platform per title', () => {
    const stats = computeWrapped(
      build({
        watchlist: [item({ id: 1 }), item({ id: 2 })],
        platformsFor: (_t, id) => (id === 1 ? ['Netflix', 'Prime Video', 'JioHotstar'] : ['Prime Video']),
      }),
    );
    expect(stats.topPlatforms).toEqual([
      { label: 'Netflix', count: 1 },
      { label: 'Prime Video', count: 1 },
    ]);
  });

  // "Apple TV+ (Buy/Rent)" is a shop, not a subscription you keep.
  it('does not count a purchase-only listing as a platform you watch on', () => {
    const stats = computeWrapped(
      build({ watchlist: [item({ id: 1 })], platformsFor: () => ['Apple TV+ (Buy/Rent)'] }),
    );
    expect(stats.topPlatforms).toEqual([]);
  });

  it('keeps ties in a stable, alphabetical order rather than insertion order', () => {
    const a = computeWrapped(
      build({ watchlist: [item({ id: 1 }), item({ id: 2 })], genresFor: (_t, id) => (id === 1 ? ['Zulu'] : ['Action']) }),
    );
    const b = computeWrapped(
      build({ watchlist: [item({ id: 2 }), item({ id: 1 })], genresFor: (_t, id) => (id === 1 ? ['Zulu'] : ['Action']) }),
    );
    expect(a.topGenres).toEqual(b.topGenres);
    expect(a.topGenres[0].label).toBe('Action');
  });
});

describe('busiest month', () => {
  it('names the month you saved the most in', () => {
    const stats = computeWrapped(
      build({
        watchlist: [
          item({ id: 1, addedAt: Date.parse('2026-05-02') }),
          item({ id: 2, addedAt: Date.parse('2026-05-19') }),
          item({ id: 3, addedAt: Date.parse('2026-07-01') }),
        ],
      }),
    );
    expect(stats.busiestMonth).toEqual({ label: 'May', count: 2 });
  });

  // With one title in each of three months every month is the busiest, and
  // the stat is noise dressed as a finding.
  it('names no month when nothing stands out', () => {
    const stats = computeWrapped(
      build({
        watchlist: [
          item({ id: 1, addedAt: Date.parse('2026-01-02') }),
          item({ id: 2, addedAt: Date.parse('2026-05-02') }),
        ],
      }),
    );
    expect(stats.busiestMonth).toBeNull();
  });
});

describe('the one still waiting', () => {
  it('finds the oldest thing saved and not seen', () => {
    const stats = computeWrapped(
      build({
        watchlist: [
          item({ id: 1, title: 'Recent', addedAt: Date.parse('2026-09-01') }),
          item({ id: 2, title: 'Ancient', addedAt: Date.parse('2026-01-10') }),
        ],
      }),
    );
    expect(stats.oldestUnwatched?.title).toBe('Ancient');
    expect(stats.oldestUnwatched?.daysWaiting).toBe(252);
  });

  it('ignores a saved title that has since been marked seen', () => {
    const stats = computeWrapped(
      build({
        watchlist: [item({ id: 1, title: 'Waiting', addedAt: Date.parse('2026-06-01') })],
        watched: [item({ id: 2, title: 'Done', addedAt: Date.parse('2026-01-01') })],
      }),
    );
    expect(stats.oldestUnwatched?.title).toBe('Waiting');
  });

  it('reports nothing waiting when the list is clear', () => {
    const stats = computeWrapped(build({ watched: [item({ id: 1 })] }));
    expect(stats.oldestUnwatched).toBeNull();
  });
});

describe('sparse accounts', () => {
  it('flags an account with too little to say anything about', () => {
    const stats = computeWrapped(build({ watchlist: [item({ id: 1 }), item({ id: 2 })] }));
    expect(stats.sparse).toBe(true);
  });

  it('stops flagging once there is enough', () => {
    const watchlist = Array.from({ length: MIN_TITLES_FOR_WRAPPED }, (_, i) => item({ id: i + 1 }));
    expect(computeWrapped(build({ watchlist })).sparse).toBe(false);
  });

  it('computes without throwing on a completely empty account', () => {
    const stats = computeWrapped(build());
    expect(stats).toMatchObject({
      savedThisYear: 0,
      seenThisYear: 0,
      minutesFromFilms: 0,
      seriesSeen: 0,
      topGenres: [],
      busiestMonth: null,
      longestFilm: null,
      oldestUnwatched: null,
      sparse: true,
    });
  });
});

describe('wrappedSummary', () => {
  it('reads as sentences, not as a data dump', () => {
    const stats = computeWrapped(
      build({
        watchlist: [item({ id: 3, originalLanguage: 'hi' })],
        watched: [item({ id: 1 }), item({ id: 2 })],
        runtimeFor: () => 120,
        genresFor: () => ['Thriller'],
      }),
    );

    const summary = wrappedSummary(stats);

    // One clause, saved first: the watched titles are a subset of the saved
    // ones, so "2 titles watched. 3 saved." would read as five titles.
    expect(summary).toContain('My 2026 on Spotlight:');
    expect(summary).toContain('3 titles saved, 2 watched — about 4 hours of film.');
    expect(summary).toContain('Mostly Thriller.');
    // Ranked, then joined with "and": English twice (the two watched), Hindi once.
    expect(summary).toContain('In English and Hindi.');
  });

  it('omits the hours clause rather than claiming zero', () => {
    const stats = computeWrapped(build({ watched: [item({ id: 1 })] }));
    const summary = wrappedSummary(stats);
    expect(summary).toContain('1 title saved, 1 watched.');
    expect(summary).not.toContain('0 hours');
  });

  it('says nothing beyond the heading for an empty year', () => {
    expect(wrappedSummary(computeWrapped(build()))).toBe('My 2026 on Spotlight:');
  });

  // A film saved last week is not a guilt trip.
  it('only mentions the waiting title once it has genuinely been waiting', () => {
    const recent = computeWrapped(
      build({ watchlist: [item({ id: 1, title: 'Fresh', addedAt: Date.parse('2026-09-15') })] }),
    );
    expect(wrappedSummary(recent)).not.toContain('Fresh');

    const old = computeWrapped(
      build({ watchlist: [item({ id: 1, title: 'Stale', addedAt: Date.parse('2026-01-01') })] }),
    );
    expect(wrappedSummary(old)).toContain('Stale has been waiting');
  });
});

describe('the summary reads as English', () => {
  // "In English and Hindi and Korean." is what joining three items with " and "
  // produces, and it is the kind of sentence that makes the whole page look
  // generated.
  it('joins three items with commas and a final "and"', () => {
    const stats = computeWrapped(
      build({
        watchlist: [
          item({ id: 1, originalLanguage: 'en' }),
          item({ id: 2, originalLanguage: 'hi' }),
          item({ id: 3, originalLanguage: 'ko' }),
        ],
        genresFor: (_t, id) => [['Drama'], ['Animation'], ['Comedy']][id - 1],
      }),
    );

    const summary = wrappedSummary(stats);

    expect(summary).toContain('In English, Hindi and Korean.');
    expect(summary).toContain('Mostly Animation, Comedy and Drama.');
    expect(summary).not.toContain('and Hindi and');
  });

  it('uses no comma for two items', () => {
    const stats = computeWrapped(
      build({ watchlist: [item({ id: 1, originalLanguage: 'en' }), item({ id: 2, originalLanguage: 'hi' })] }),
    );
    expect(wrappedSummary(stats)).toContain('In English and Hindi.');
  });
});

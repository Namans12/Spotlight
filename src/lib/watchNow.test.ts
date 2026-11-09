import { describe, expect, it } from 'vitest';
import type { WatchlistItem } from '@/types/movie';
import {
  EMPTY_FILTERS,
  availablePlatforms,
  availableRuntimeBands,
  basePlatform,
  filterWatchNow,
  hasActiveFilters,
} from './watchNow';

// Availability filters only match explicit regional offers. Runtime may be unknown.

function item(id: number, over: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    dbId: id,
    id,
    title: `Title ${id}`,
    mediaType: 'movie',
    posterPath: null,
    backdropPath: null,
    overview: '',
    releaseDate: '2020-01-01',
    voteAverage: 7,
    originalLanguage: 'en',
    addedAt: 0,
    ...over,
  } as WatchlistItem;
}

function lookups(
  providers: Record<number, string[] | undefined>,
  runtimes: Record<number, number | undefined> = {},
) {
  return {
    providersFor: (_m: string, id: number) => providers[id],
    availabilityFor: (_m: string, id: number) => providers[id]?.map(name => ({
      provider: basePlatform(name), type: (name.includes('(Buy/Rent)') ? 'rent' : 'subscription') as 'rent' | 'subscription',
    })),
    runtimeFor: (_m: string, id: number) => runtimes[id],
  };
}

describe('filterWatchNow', () => {
  const list = [item(1), item(2), item(3, { mediaType: 'tv' })];

  it('returns everything when nothing is selected', () => {
    expect(filterWatchNow(list, EMPTY_FILTERS, lookups({}))).toEqual(list);
  });

  it('narrows to one platform', () => {
    const got = filterWatchNow(
      list,
      { ...EMPTY_FILTERS, platforms: ['Netflix'] },
      lookups({ 1: ['Netflix'], 2: ['JioHotstar'], 3: ['Netflix', 'Prime Video'] }),
    );
    expect(got.map((i) => i.id)).toEqual([1, 3]);
  });

  it('treats a rental as being on that service', () => {
    // Someone filtering to Apple TV+ wants everything on Apple TV+. The
    // "(Buy/Rent)" suffix matters on the card, so a rental never reads as a
    // subscription — it should not also silently empty a filter.
    const got = filterWatchNow(
      [item(1)],
      { ...EMPTY_FILTERS, platforms: ['Apple TV+'] },
      lookups({ 1: ['Apple TV+ (Buy/Rent)'] }),
    );
    expect(got.map((i) => i.id)).toEqual([1]);
  });

  it('does not treat a title whose providers have not loaded as a platform match', () => {
    const got = filterWatchNow([item(1)], { ...EMPTY_FILTERS, platforms: ['Netflix'] }, lookups({ 1: undefined }));
    expect(got).toEqual([]);
  });

  it('does not treat an empty provider response as a platform match', () => {
    // An empty response does not establish that the title is unavailable.
    const got = filterWatchNow([item(1)], { ...EMPTY_FILTERS, platforms: ['Netflix'] }, lookups({ 1: [] }));
    expect(got).toEqual([]);
  });

  it('filters by runtime band', () => {
    const got = filterWatchNow(
      [item(1), item(2), item(3)],
      { ...EMPTY_FILTERS, runtime: 'short' },
      lookups({}, { 1: 22, 2: 95, 3: 140 }),
    );
    expect(got.map((i) => i.id)).toEqual([1]);
  });

  it('puts the band boundary on the lower edge, not both', () => {
    // Exactly 45 minutes is "45 min - 2 hr", never also "under 45".
    const l = lookups({}, { 1: 45 });
    expect(filterWatchNow([item(1)], { ...EMPTY_FILTERS, runtime: 'short' }, l)).toEqual([]);
    expect(filterWatchNow([item(1)], { ...EMPTY_FILTERS, runtime: 'medium' }, l).map((i) => i.id)).toEqual([1]);
  });

  it('keeps a title with no known runtime rather than guessing', () => {
    const got = filterWatchNow([item(1)], { ...EMPTY_FILTERS, runtime: 'short' }, lookups({}, { 1: undefined }));
    expect(got.map((i) => i.id)).toEqual([1]);
  });

  it('filters films from series', () => {
    expect(
      filterWatchNow(list, { ...EMPTY_FILTERS, mediaType: 'tv' }, lookups({})).map((i) => i.id),
    ).toEqual([3]);
  });

  it('applies every active filter together', () => {
    const got = filterWatchNow(
      [item(1), item(2), item(3, { mediaType: 'tv' })],
      { platforms: ['Netflix'], runtime: 'short', mediaType: 'tv' },
      lookups({ 1: ['Netflix'], 2: ['Netflix'], 3: ['Netflix'] }, { 1: 20, 2: 20, 3: 30 }),
    );
    expect(got.map((i) => i.id)).toEqual([3]);
  });
});

describe('hasActiveFilters', () => {
  it('is false only for a completely empty selection', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, platforms: ['Netflix'] })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, runtime: 'short' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, mediaType: 'movie' })).toBe(true);
  });
});

describe('availablePlatforms', () => {
  it('offers only platforms this list actually has something on, commonest first', () => {
    const got = availablePlatforms(
      [item(1), item(2), item(3)],
      lookups({ 1: ['Netflix'], 2: ['Netflix', 'JioHotstar'], 3: ['JioHotstar'] }).availabilityFor,
    );
    expect(got).toEqual(['JioHotstar', 'Netflix']); // 2 each, alphabetical tiebreak
  });

  it('counts a service once even when a title is on both its tiers', () => {
    const got = availablePlatforms([item(1)], lookups({ 1: ['Apple TV+', 'Apple TV+ (Buy/Rent)'] }).availabilityFor);
    expect(got).toEqual(['Apple TV+']);
  });

  it('ignores titles whose providers are unknown', () => {
    expect(availablePlatforms([item(1)], lookups({ 1: undefined }).availabilityFor)).toEqual([]);
  });
});

describe('availableRuntimeBands', () => {
  it('offers only bands that would match something', () => {
    const got = availableRuntimeBands([item(1), item(2)], lookups({}, { 1: 22, 2: 30 }).runtimeFor);
    expect(got.map((b) => b.id)).toEqual(['short']);
  });

  it('is empty when no runtime is known, so no dead control is shown', () => {
    expect(availableRuntimeBands([item(1)], lookups({}, {}).runtimeFor)).toEqual([]);
  });
});

describe('basePlatform', () => {
  it('strips the rental suffix and nothing else', () => {
    expect(basePlatform('Apple TV+ (Buy/Rent)')).toBe('Apple TV+');
    expect(basePlatform('Netflix')).toBe('Netflix');
    expect(basePlatform('Buy/Rent')).toBe('Buy/Rent');
  });
});

describe('availability categories', () => {
  const base = lookups({});
  const availabilityFor = (_type: string, id: number) => ({
    1: [{ provider: 'Netflix', type: 'rent' as const }, { provider: 'Hulu', type: 'subscription' as const }],
    2: [{ provider: 'Netflix', type: 'subscription' as const }],
    3: [{ provider: 'Netflix', type: 'buy' as const }],
    4: [],
  } as Record<number, import('../../shared/types/availability').ProviderOffer[]>)[id];
  const opts = { ...base, availabilityFor };
  const items = [item(1), item(2), item(3), item(4), item(5)];
  it('requires provider and category to match the same offer', () => {
    const filters = { ...EMPTY_FILTERS, platforms: ['Netflix'], availabilityTypes: ['subscription' as const] };
    expect(filterWatchNow(items, filters, opts).map(x => x.id)).toEqual([2]);
  });
  it('distinguishes rent and buy', () => {
    expect(filterWatchNow(items, { ...EMPTY_FILTERS, availabilityTypes: ['rent'] }, opts).map(x => x.id)).toEqual([1]);
    expect(filterWatchNow(items, { ...EMPTY_FILTERS, availabilityTypes: ['buy'] }, opts).map(x => x.id)).toEqual([3]);
  });
  it('shows missing and empty offers only under the unknown option, without assuming a platform', () => {
    expect(filterWatchNow(items, { ...EMPTY_FILTERS, availabilityTypes: ['unknown'] }, opts).map(x => x.id)).toEqual([4, 5]);
    expect(filterWatchNow(items, { ...EMPTY_FILTERS, platforms: ['Netflix'], availabilityTypes: ['unknown'] }, opts)).toEqual([]);
  });
  it('does not let missing availability bypass a runtime or media type constraint', () => {
    const filters = { ...EMPTY_FILTERS, platforms: ['Netflix'], runtime: 'short' as const, mediaType: 'tv' as const };
    expect(filterWatchNow([item(5)], filters, opts)).toEqual([]);
  });
});

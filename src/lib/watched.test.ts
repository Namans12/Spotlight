import { describe, it, expect } from 'vitest';
import { titleKey, watchedKeys, isWatched, withoutWatched, findWatched } from './watched';
import type { WatchlistItem } from '@/types/movie';

function item(id: number, mediaType: 'movie' | 'tv', dbId = id): WatchlistItem {
  return {
    dbId,
    id,
    title: `Title ${id}`,
    posterPath: null,
    overview: '',
    releaseDate: '2020-01-01',
    mediaType,
    voteAverage: 7,
    originalLanguage: 'en',
    addedAt: 0,
  };
}

describe('titleKey', () => {
  // TMDB ids are only unique within a media type. Breaking Bad is tv:1396 and
  // there is also a movie 1396; keying on the id alone would mark one seen
  // when the reader marked the other.
  it('keys on the media type as well as the id', () => {
    expect(titleKey('movie', 1396)).not.toBe(titleKey('tv', 1396));
  });
});

describe('isWatched', () => {
  const keys = watchedKeys([item(920, 'movie'), item(1396, 'tv')]);

  it('finds a title that was marked', () => {
    expect(isWatched(keys, 'movie', 920)).toBe(true);
    expect(isWatched(keys, 'tv', 1396)).toBe(true);
  });

  it('does not confuse a film with a series of the same id', () => {
    expect(isWatched(keys, 'tv', 920)).toBe(false);
    expect(isWatched(keys, 'movie', 1396)).toBe(false);
  });

  it('is false for anything unmarked', () => {
    expect(isWatched(keys, 'movie', 1)).toBe(false);
  });

  it('is false for everything when nothing is marked', () => {
    expect(isWatched(watchedKeys([]), 'movie', 920)).toBe(false);
  });
});

describe('withoutWatched', () => {
  const candidates = [
    { id: 920, mediaType: 'movie' as const, title: 'Cars' },
    { id: 49013, mediaType: 'movie' as const, title: 'Cars 2' },
    { id: 1396, mediaType: 'tv' as const, title: 'Breaking Bad' },
  ];

  it('drops a suggestion the reader has already taken', () => {
    const keys = watchedKeys([item(920, 'movie')]);
    expect(withoutWatched(candidates, keys).map((c) => c.title)).toEqual(['Cars 2', 'Breaking Bad']);
  });

  it('keeps a series when the film of the same id was seen', () => {
    const keys = watchedKeys([item(1396, 'movie')]);
    expect(withoutWatched(candidates, keys).map((c) => c.title)).toContain('Breaking Bad');
  });

  // The common case is an empty watched list, and returning the same array
  // reference keeps React from re-rendering a row that did not change.
  it('returns the input untouched when nothing is marked', () => {
    const keys = watchedKeys([]);
    expect(withoutWatched(candidates, keys)).toBe(candidates);
  });

  it('can empty a row entirely', () => {
    const keys = watchedKeys([item(920, 'movie'), item(49013, 'movie'), item(1396, 'tv')]);
    expect(withoutWatched(candidates, keys)).toEqual([]);
  });
});

describe('findWatched', () => {
  const watched = [item(920, 'movie', 11), item(1396, 'tv', 22)];

  // Un-marking needs the row id, not the TMDB id — the delete endpoint takes
  // no other identifier.
  it('returns the row so it can be un-marked', () => {
    expect(findWatched(watched, { id: 920, mediaType: 'movie' })?.dbId).toBe(11);
  });

  it('matches on the media type too', () => {
    expect(findWatched(watched, { id: 1396, mediaType: 'movie' })).toBeUndefined();
    expect(findWatched(watched, { id: 1396, mediaType: 'tv' })?.dbId).toBe(22);
  });

  it('is undefined for a title that was never marked', () => {
    expect(findWatched(watched, { id: 1, mediaType: 'movie' })).toBeUndefined();
  });
});

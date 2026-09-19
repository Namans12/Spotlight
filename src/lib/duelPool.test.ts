import { describe, it, expect } from 'vitest';
import { buildPool, type PoolSource } from './duelPool';
import type { DuelCandidate } from '@/lib/duel';

function candidate(id: number, over: Partial<DuelCandidate> = {}): DuelCandidate {
  return {
    id,
    title: `Title ${id}`,
    posterPath: `/poster${id}.jpg`,
    overview: '',
    releaseDate: '2015-06-01',
    mediaType: 'movie',
    voteAverage: 7,
    originalLanguage: 'en',
    ...over,
  };
}

function source(name: string, ids: number[], over: Partial<DuelCandidate> = {}): PoolSource {
  return { name, items: ids.map((id) => candidate(id, over)) };
}

/** Identity shuffle, so a test asserts the pooling rules and not the RNG. */
const noShuffle = () => 0.999999;

const NONE = new Set<string>();

describe('buildPool', () => {
  // The failure the whole feature exists to avoid. Concatenating sources looks
  // like blending them and is not: the first source simply wins.
  it('does not let the biggest source crowd out the others', () => {
    const pool = buildPool(
      [source('trending', [1, 2, 3, 4, 5, 6]), source('saved', [100, 101]), source('recommended', [200, 201, 202])],
      { watchedKeys: NONE, limit: 6, random: noShuffle },
    );

    expect(pool.map((c) => c.id)).toContain(100);
    expect(pool.map((c) => c.id)).toContain(200);
    // Round-robin: three sources, six slots, so no source gets more than two
    // before every source has had two.
    expect(pool.filter((c) => c.id < 100)).toHaveLength(2);
  });

  it('keeps taking from the sources that still have titles once one runs dry', () => {
    const pool = buildPool([source('small', [1]), source('big', [10, 11, 12, 13])], {
      watchedKeys: NONE,
      limit: 5,
      random: noShuffle,
    });

    expect(pool).toHaveLength(5);
    expect(pool.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 10, 11, 12, 13]);
  });

  // The payoff for the eye: before watch history existed there was no way to
  // know, and a decider offering something you have already seen is broken.
  it('never offers something already watched', () => {
    const watched = new Set(['movie:2', 'movie:3']);
    const pool = buildPool([source('trending', [1, 2, 3, 4])], { watchedKeys: watched, limit: 4, random: noShuffle });

    expect(pool.map((c) => c.id)).toEqual([1, 4]);
  });

  it('distinguishes a film from a series with the same id', () => {
    const watched = new Set(['tv:5']);
    const pool = buildPool([{ name: 's', items: [candidate(5), candidate(5, { mediaType: 'tv' })] }], {
      watchedKeys: watched,
      limit: 4,
      random: noShuffle,
    });

    expect(pool).toHaveLength(1);
    expect(pool[0].mediaType).toBe('movie');
  });

  // The same film is routinely in both trending and someone's recommendations.
  it('shows a title once even when several sources offer it', () => {
    const pool = buildPool([source('a', [1, 2]), source('b', [1, 3])], {
      watchedKeys: NONE,
      limit: 10,
      random: noShuffle,
    });

    expect(pool.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  // A poster is the entire interface here.
  it('drops a title with no poster rather than offering a blank card', () => {
    const pool = buildPool([{ name: 's', items: [candidate(1), candidate(2, { posterPath: null }), candidate(3)] }], {
      watchedKeys: NONE,
      limit: 5,
      random: noShuffle,
    });

    expect(pool.map((c) => c.id)).toEqual([1, 3]);
  });

  it('respects the limit', () => {
    const pool = buildPool([source('a', [1, 2, 3, 4, 5, 6, 7, 8])], { watchedKeys: NONE, limit: 3, random: noShuffle });
    expect(pool).toHaveLength(3);
  });

  // A signed-out reader has no saves and no recommendations. The answer is a
  // smaller pool, not one topped up with whatever ranked twenty-first.
  it('returns a short pool rather than padding it', () => {
    const pool = buildPool([source('a', [1, 2]), { name: 'empty', items: [] }], {
      watchedKeys: NONE,
      limit: 20,
      random: noShuffle,
    });
    expect(pool).toHaveLength(2);
  });

  it('copes with nothing at all', () => {
    expect(buildPool([], { watchedKeys: NONE, limit: 10 })).toEqual([]);
    expect(buildPool([{ name: 'a', items: [] }], { watchedKeys: NONE, limit: 10 })).toEqual([]);
  });

  // TMDB's trending list barely moves day to day, and a decider that asks the
  // same question twice is a quiz rather than a decision.
  it('varies between runs so two visits are not the same eight posters', () => {
    const ids = Array.from({ length: 20 }, (_, i) => i + 1);
    const first = buildPool([source('trending', ids)], { watchedKeys: NONE, limit: 8 });
    const second = buildPool([source('trending', ids)], { watchedKeys: NONE, limit: 8 });

    expect(first.map((c) => c.id)).not.toEqual(second.map((c) => c.id));
  });

  it('does not consume the sources it was given', () => {
    const trending = source('trending', [1, 2, 3]);
    buildPool([trending], { watchedKeys: NONE, limit: 2, random: noShuffle });
    expect(trending.items).toHaveLength(3);
  });
});

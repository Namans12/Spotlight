import { describe, it, expect } from 'vitest';
import {
  buildTaste,
  tasteScore,
  rerankByTaste,
  likedSeeds,
  opinionKey,
  EMPTY_TASTE,
  MIN_OPINIONS_TO_RERANK,
  type Opinions,
} from './taste';
import type { Attributed } from '@/lib/titleAttributes';

function title(id: number, over: Partial<Attributed> = {}): Attributed {
  return {
    id,
    title: `Title ${id}`,
    posterPath: null,
    overview: '',
    releaseDate: '2015-06-01',
    mediaType: 'movie',
    voteAverage: 7,
    originalLanguage: 'en',
    genres: ['Drama'],
    runtime: 100,
    ...over,
  };
}

/** Enough opinions to clear the rerank gate, all on throwaway attributes. */
function padding(opinions: Opinions, rated: Attributed[], count: number) {
  for (let i = 0; i < count; i += 1) {
    const filler = title(9000 + i, { genres: [`Filler${i}`] });
    rated.push(filler);
    opinions[opinionKey('movie', filler.id)] = true;
  }
}

describe('buildTaste', () => {
  it('counts a like toward everything that title is', () => {
    const liked = title(1, { genres: ['Thriller'] });
    const taste = buildTaste([liked], { [opinionKey('movie', 1)]: true });

    expect(taste.liked).toBe(1);
    expect(taste.weights['genre:Thriller']).toBe(1);
  });

  // A dislike counts as much as a like, in the opposite direction. Quietly
  // discounting it would make the control do less than it appears to.
  it('counts a dislike as hard as a like', () => {
    const hated = title(1, { genres: ['Horror'] });
    const taste = buildTaste([hated], { [opinionKey('movie', 1)]: false });

    expect(taste.disliked).toBe(1);
    expect(taste.weights['genre:Horror']).toBe(-1);
  });

  it('cancels an attribute that was both liked and disliked', () => {
    const rated = [title(1, { genres: ['Drama'] }), title(2, { genres: ['Drama'] })];
    const taste = buildTaste(rated, { [opinionKey('movie', 1)]: true, [opinionKey('movie', 2)]: false });

    expect(taste.weights['genre:Drama']).toBe(0);
  });

  // Otherwise a reader with forty opinions exerts forty times the pull of one
  // with two, and the rerank bound stops meaning anything.
  it('normalises so a long history does not overpower a short one', () => {
    const many = Array.from({ length: 10 }, (_, i) => title(i, { genres: ['Thriller'] }));
    const manyOpinions: Opinions = {};
    for (const t of many) manyOpinions[opinionKey('movie', t.id)] = true;

    const few = buildTaste([title(1, { genres: ['Thriller'] })], { [opinionKey('movie', 1)]: true });
    const lots = buildTaste(many, manyOpinions);

    expect(lots.weights['genre:Thriller']).toBeCloseTo(few.weights['genre:Thriller']);
  });

  // Absent is not neutral — it means the reader has not said.
  it('ignores titles with no opinion', () => {
    const taste = buildTaste([title(1), title(2)], { [opinionKey('movie', 1)]: true });
    expect(taste.liked).toBe(1);
    expect(taste.disliked).toBe(0);
  });

  it('is empty when nothing has been rated', () => {
    expect(buildTaste([title(1)], {})).toEqual(EMPTY_TASTE);
    expect(buildTaste([], {})).toEqual(EMPTY_TASTE);
  });
});

describe('tasteScore', () => {
  it('is positive for a title like the ones you liked', () => {
    const taste = buildTaste([title(1, { genres: ['Thriller'] })], { [opinionKey('movie', 1)]: true });
    expect(tasteScore(title(2, { genres: ['Thriller'] }), taste)).toBeGreaterThan(0);
  });

  it('is negative for a title like the ones you disliked', () => {
    const taste = buildTaste([title(1, { genres: ['Horror'] })], { [opinionKey('movie', 1)]: false });
    expect(tasteScore(title(2, { genres: ['Horror'] }), taste)).toBeLessThan(0);
  });

  it('is zero against an empty profile', () => {
    expect(tasteScore(title(1), EMPTY_TASTE)).toBe(0);
  });
});

describe('rerankByTaste', () => {
  // One thumb is not a taste, it is an echo of one film.
  it('does not rerank at all below the opinion threshold', () => {
    const taste = buildTaste([title(1, { genres: ['Thriller'] })], { [opinionKey('movie', 1)]: true });
    const candidates = [title(10, { genres: ['Drama'] }), title(11, { genres: ['Thriller'] })];

    expect(taste.liked).toBeLessThan(MIN_OPINIONS_TO_RERANK);
    expect(rerankByTaste(candidates, taste)).toBe(candidates);
  });

  it('lifts a matching title once there is a real profile', () => {
    const rated: Attributed[] = [];
    const opinions: Opinions = {};
    padding(opinions, rated, 2);
    const loved = title(1, { genres: ['Thriller'] });
    rated.push(loved);
    opinions[opinionKey('movie', 1)] = true;

    const taste = buildTaste(rated, opinions);
    const candidates = [
      title(10, { genres: ['Drama'] }),
      title(11, { genres: ['Drama'] }),
      title(12, { genres: ['Thriller'] }),
    ];

    expect(rerankByTaste(candidates, taste)[0].id).toBe(12);
  });

  // The server ranked these on real evidence about these specific titles —
  // shared director, shared cast, same franchise. Taste is broader and weaker,
  // so it must not be able to haul something from the bottom to the top.
  it('cannot move a title more than five places', () => {
    const rated: Attributed[] = [];
    const opinions: Opinions = {};
    padding(opinions, rated, 3);
    rated.push(title(1, { genres: ['Thriller'] }));
    opinions[opinionKey('movie', 1)] = true;

    const taste = buildTaste(rated, opinions);
    const candidates = Array.from({ length: 20 }, (_, i) =>
      title(100 + i, { genres: i === 19 ? ['Thriller'] : ['Drama'] }),
    );

    const reranked = rerankByTaste(candidates, taste);
    const moved = reranked.findIndex((c) => c.id === 119);

    expect(moved).toBeGreaterThanOrEqual(14);
    expect(moved).toBeLessThan(19);
  });

  // You disliked one Adam Sandler film, not comedy.
  it('demotes rather than removes a title resembling something disliked', () => {
    const rated: Attributed[] = [];
    const opinions: Opinions = {};
    padding(opinions, rated, 3);
    rated.push(title(1, { genres: ['Horror'] }));
    opinions[opinionKey('movie', 1)] = false;

    const taste = buildTaste(rated, opinions);
    const candidates = [title(10, { genres: ['Horror'] }), title(11, { genres: ['Drama'] })];
    const reranked = rerankByTaste(candidates, taste);

    expect(reranked).toHaveLength(2);
    expect(reranked.map((c) => c.id)).toContain(10);
  });

  it('keeps the original order wherever taste has nothing to say', () => {
    const rated: Attributed[] = [];
    const opinions: Opinions = {};
    padding(opinions, rated, 3);
    const taste = buildTaste(rated, opinions);

    const candidates = [title(10, { genres: ['Western'] }), title(11, { genres: ['Western'] })];
    expect(rerankByTaste(candidates, taste).map((c) => c.id)).toEqual([10, 11]);
  });

  it('copes with an empty list', () => {
    expect(rerankByTaste([], EMPTY_TASTE)).toEqual([]);
  });
});

describe('likedSeeds', () => {
  // Seeding a "because you liked…" row from something someone disliked would
  // be an unusually direct way of ignoring them.
  it('never seeds from a dislike', () => {
    const rated = [
      { ...title(1), addedAt: 2 },
      { ...title(2), addedAt: 1 },
    ];
    const opinions = { [opinionKey('movie', 1)]: false, [opinionKey('movie', 2)]: true };

    expect(likedSeeds(rated, opinions, 5).map((t) => t.id)).toEqual([2]);
  });

  it('puts the most recently rated first', () => {
    const rated = [
      { ...title(1), addedAt: 100 },
      { ...title(2), addedAt: 300 },
      { ...title(3), addedAt: 200 },
    ];
    const opinions: Opinions = {
      [opinionKey('movie', 1)]: true,
      [opinionKey('movie', 2)]: true,
      [opinionKey('movie', 3)]: true,
    };

    expect(likedSeeds(rated, opinions, 5).map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it('respects the limit', () => {
    const rated = [
      { ...title(1), addedAt: 1 },
      { ...title(2), addedAt: 2 },
      { ...title(3), addedAt: 3 },
    ];
    const opinions: Opinions = {
      [opinionKey('movie', 1)]: true,
      [opinionKey('movie', 2)]: true,
      [opinionKey('movie', 3)]: true,
    };

    expect(likedSeeds(rated, opinions, 2)).toHaveLength(2);
  });

  it('has nothing to offer without opinions', () => {
    expect(likedSeeds([{ ...title(1), addedAt: 1 }], {}, 3)).toEqual([]);
  });
});

describe('the shift is relative, not absolute', () => {
  // Most of what a profile knows is shared by nearly every candidate. With an
  // uncentred score, every candidate in a list can sit around 4.0, the shift
  // saturates at its bound for all of them, and the rerank silently becomes a
  // no-op — which is exactly what happened before the scores were centred on
  // the list's own mean.
  it('still reorders when every candidate scores highly', () => {
    const rated: Attributed[] = [];
    const opinions: Opinions = {};
    // Four likes that all share language, type, decade and runtime band, so
    // those attributes carry weight 1.0 and every candidate below collects
    // them. Only the genre distinguishes anything.
    for (let i = 0; i < 3; i += 1) {
      const t = title(i, { genres: ['Drama'] });
      rated.push(t);
      opinions[opinionKey('movie', t.id)] = true;
    }
    const oddOne = title(50, { genres: ['Thriller'] });
    rated.push(oddOne);
    opinions[opinionKey('movie', 50)] = true;

    const taste = buildTaste(rated, opinions);
    const candidates = [
      title(10, { genres: ['Western'] }),
      title(11, { genres: ['Western'] }),
      title(12, { genres: ['Drama'] }),
    ];

    // Every candidate scores well on the shared attributes; only the Drama
    // has anything extra, and it must still be able to reach the front.
    expect(scoresAreAllHigh(candidates, taste)).toBe(true);
    expect(rerankByTaste(candidates, taste)[0].id).toBe(12);
  });

  it('leaves the order alone when every candidate scores identically', () => {
    const rated: Attributed[] = [];
    const opinions: Opinions = {};
    for (let i = 0; i < 3; i += 1) {
      const t = title(i, { genres: ['Drama'] });
      rated.push(t);
      opinions[opinionKey('movie', t.id)] = true;
    }
    const taste = buildTaste(rated, opinions);
    const candidates = [title(10, { genres: ['Drama'] }), title(11, { genres: ['Drama'] })];

    expect(rerankByTaste(candidates, taste).map((c) => c.id)).toEqual([10, 11]);
  });
});

function scoresAreAllHigh(candidates: Attributed[], taste: Parameters<typeof tasteScore>[1]): boolean {
  return candidates.every((c) => tasteScore(c, taste) > 1);
}

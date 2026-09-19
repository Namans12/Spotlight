import { describe, it, expect } from 'vitest';
import {
  attributeKeys,
  recordPick,
  scoreCandidate,
  nextPair,
  duelWinner,
  explainWinner,
  type DuelCandidate,
  type Weights,
} from './duel';

function candidate(id: number, over: Partial<DuelCandidate> = {}): DuelCandidate {
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

describe('attributeKeys', () => {
  it('describes a title in terms a taste can be about', () => {
    const keys = attributeKeys(
      candidate(1, { genres: ['Thriller', 'Drama'], originalLanguage: 'hi', releaseDate: '2018-04-02', runtime: 150 }),
    );
    expect(keys).toEqual([
      'genre:Thriller',
      'genre:Drama',
      'lang:hi',
      'type:movie',
      'decade:2010s',
      'runtime:long',
    ]);
  });

  // An attribute nobody knows should cast no vote rather than vote for
  // "unknown", which would be a taste in missing data.
  it('omits what is not known rather than inventing a bucket for it', () => {
    const keys = attributeKeys({ ...candidate(1), genres: undefined, runtime: undefined, releaseDate: '' });
    expect(keys).toEqual(['lang:en', 'type:movie']);
  });

  it('bands runtimes at the boundaries the rest of the app uses', () => {
    expect(attributeKeys(candidate(1, { runtime: 44 }))).toContain('runtime:short');
    expect(attributeKeys(candidate(1, { runtime: 45 }))).toContain('runtime:medium');
    expect(attributeKeys(candidate(1, { runtime: 119 }))).toContain('runtime:medium');
    expect(attributeKeys(candidate(1, { runtime: 120 }))).toContain('runtime:long');
  });
});

describe('recordPick', () => {
  it('credits everything the winner is', () => {
    const weights = recordPick(
      {},
      { winner: candidate(1, { genres: ['Thriller'] }), loser: candidate(2, { genres: ['Comedy'] }) },
    );
    expect(weights['genre:Thriller']).toBe(1);
  });

  it('discredits what the loser had and the winner did not', () => {
    const weights = recordPick(
      {},
      { winner: candidate(1, { genres: ['Thriller'] }), loser: candidate(2, { genres: ['Comedy'] }) },
    );
    expect(weights['genre:Comedy']).toBe(-0.5);
  });

  // The central rule. If both posters are thrillers and you pick one,
  // "thriller" was held constant across the choice — docking it would be
  // reading a preference out of a coin flip.
  it('does not discredit an attribute both titles shared', () => {
    const weights = recordPick(
      {},
      {
        winner: candidate(1, { genres: ['Thriller', 'Drama'] }),
        loser: candidate(2, { genres: ['Thriller', 'Comedy'] }),
      },
    );
    expect(weights['genre:Thriller']).toBe(1);
    expect(weights['genre:Comedy']).toBe(-0.5);
    expect(weights['genre:Drama']).toBe(1);
  });

  it('accumulates across picks', () => {
    let weights: Weights = {};
    weights = recordPick(weights, { winner: candidate(1, { genres: ['Thriller'] }), loser: candidate(2, { genres: ['Comedy'] }) });
    weights = recordPick(weights, { winner: candidate(3, { genres: ['Thriller'] }), loser: candidate(4, { genres: ['Romance'] }) });
    expect(weights['genre:Thriller']).toBe(2);
  });

  it('does not mutate the weights it was given', () => {
    const before: Weights = { 'genre:Thriller': 3 };
    recordPick(before, { winner: candidate(1, { genres: ['Thriller'] }), loser: candidate(2) });
    expect(before['genre:Thriller']).toBe(3);
  });
});

describe('scoreCandidate', () => {
  // Averaged, not summed: a title TMDB happens to list under five genres
  // should not outrank a better match listed under two.
  it('averages over a title’s own attributes so breadth is not an advantage', () => {
    const weights: Weights = { 'genre:Thriller': 2 };
    const focused = candidate(1, { genres: ['Thriller'], runtime: undefined, releaseDate: '' });
    const sprawling = candidate(2, {
      genres: ['Thriller', 'Drama', 'Comedy', 'Romance', 'Action'],
      runtime: undefined,
      releaseDate: '',
    });
    expect(scoreCandidate(focused, weights)).toBeGreaterThan(scoreCandidate(sprawling, weights));
  });

  it('is zero for a title nothing is known about', () => {
    expect(scoreCandidate({ ...candidate(1), genres: [], originalLanguage: '', mediaType: '' as 'movie', releaseDate: '', runtime: undefined }, { 'genre:X': 5 })).toBe(0);
  });
});

describe('nextPair', () => {
  const pool = [
    candidate(1, { genres: ['Thriller'] }),
    candidate(2, { genres: ['Thriller'] }),
    candidate(3, { genres: ['Comedy'], originalLanguage: 'hi', runtime: 30, releaseDate: '1995-01-01' }),
    candidate(4, { genres: ['Drama'] }),
  ];

  it('offers two titles', () => {
    const pair = nextPair(pool, {}, new Set());
    expect(pair).not.toBeNull();
    expect(pair![0].id).not.toBe(pair![1].id);
  });

  // Pairing the top two asks the reader to separate titles the evidence
  // already says are alike, which teaches nothing.
  it('pits the front-runner against the most different plausible title', () => {
    const weights: Weights = { 'genre:Thriller': 3 };
    const [leader, challenger] = nextPair(pool, weights, new Set())!;
    expect(leader.genres).toEqual(['Thriller']);
    expect(challenger.id).toBe(3);
  });

  it('never offers a title already shown', () => {
    const seen = new Set(['movie:1', 'movie:2']);
    const pair = nextPair(pool, {}, seen)!;
    expect([pair[0].id, pair[1].id].sort()).toEqual([3, 4]);
  });

  it('stops when fewer than two remain', () => {
    expect(nextPair(pool, {}, new Set(['movie:1', 'movie:2', 'movie:3']))).toBeNull();
    expect(nextPair([], {}, new Set())).toBeNull();
  });
});

describe('duelWinner', () => {
  // "You chose these five, so watch this sixth thing you never saw" is a
  // non-sequitur however good the maths behind it is.
  it('only ever answers with something the reader actually picked', () => {
    const never = candidate(99, { genres: ['Thriller'] });
    const picks = [
      { winner: candidate(1, { genres: ['Comedy'] }), loser: candidate(2) },
      { winner: candidate(3, { genres: ['Comedy'] }), loser: candidate(4) },
    ];
    const weights: Weights = { 'genre:Thriller': 100 };

    const winner = duelWinner(picks, weights);

    expect(winner!.id).not.toBe(never.id);
    expect([1, 3]).toContain(winner!.id);
  });

  it('picks the chosen title that best fits the accumulated evidence', () => {
    const picks = [
      { winner: candidate(1, { genres: ['Comedy'] }), loser: candidate(2) },
      { winner: candidate(3, { genres: ['Thriller'] }), loser: candidate(4) },
    ];
    expect(duelWinner(picks, { 'genre:Thriller': 5 })!.id).toBe(3);
    expect(duelWinner(picks, { 'genre:Comedy': 5 })!.id).toBe(1);
  });

  // A preference expressed once the evidence had accumulated is worth more
  // than one expressed cold in round one.
  it('breaks an exact tie toward the later pick', () => {
    const picks = [
      { winner: candidate(1, { genres: ['Drama'] }), loser: candidate(2) },
      { winner: candidate(3, { genres: ['Drama'] }), loser: candidate(4) },
    ];
    expect(duelWinner(picks, {})!.id).toBe(3);
  });

  it('has no answer without any picks', () => {
    expect(duelWinner([], {})).toBeNull();
  });
});

describe('explainWinner', () => {
  it('names what the choices had in common', () => {
    const weights: Weights = { 'genre:Thriller': 3, 'decade:2010s': 2 };
    const winner = candidate(1, { genres: ['Thriller'], releaseDate: '2015-01-01' });
    expect(explainWinner(winner, weights)).toBe('You kept choosing thriller, from the 2010s.');
  });

  // A justification citing something the winner does not have is the moment
  // someone stops believing the rest of the page. The winner here has one
  // attribute with real evidence behind it, so there IS an explanation to
  // give — it just must not reach for the heavily-weighted genre the winner
  // does not happen to be.
  it('never cites an attribute the winner does not have', () => {
    const weights: Weights = { 'genre:Horror': 10, 'genre:Comedy': 2 };
    const winner = candidate(1, { genres: ['Comedy'] });
    const explanation = explainWinner(winner, weights)!;
    expect(explanation).toContain('comedy');
    expect(explanation).not.toContain('horror');
  });

  it('cites nothing when the evidence is against everything the winner is', () => {
    const weights: Weights = { 'genre:Drama': -2, 'lang:en': -1, 'type:movie': -1, 'decade:2010s': -1, 'runtime:medium': -1 };
    expect(explainWinner(candidate(1), weights)).toBeNull();
  });

  // The reader knows what language they watch in; saying it back is an
  // observation about them rather than about the films.
  it('does not tell the reader their own language', () => {
    const weights: Weights = { 'lang:hi': 10, 'genre:Drama': 1 };
    const winner = candidate(1, { originalLanguage: 'hi', genres: ['Drama'] });
    const explanation = explainWinner(winner, weights)!;
    expect(explanation).not.toContain('hi');
    expect(explanation).toContain('drama');
  });
});

describe('the whole run diverges on different answers', () => {
  // The requirement behind this feature: a fixed question tree lands everyone
  // on the same film. Two readers starting from the same pool and picking
  // differently must end up somewhere different.
  it('sends two readers who pick differently to different titles', () => {
    const pool = [
      candidate(1, { genres: ['Thriller'], runtime: 150, releaseDate: '2019-01-01' }),
      candidate(2, { genres: ['Comedy'], runtime: 95, releaseDate: '2003-01-01' }),
      candidate(3, { genres: ['Thriller'], runtime: 140, releaseDate: '2021-01-01' }),
      candidate(4, { genres: ['Comedy'], runtime: 90, releaseDate: '2001-01-01' }),
      candidate(5, { genres: ['Documentary'], runtime: 80, releaseDate: '2010-01-01' }),
      candidate(6, { genres: ['Action'], runtime: 130, releaseDate: '2016-01-01' }),
    ];

    function run(prefer: (a: DuelCandidate, b: DuelCandidate) => DuelCandidate) {
      let weights: Weights = {};
      const seen = new Set<string>();
      const picks = [];
      for (let round = 0; round < 3; round += 1) {
        const pair = nextPair(pool, weights, seen);
        if (!pair) break;
        const [a, b] = pair;
        seen.add(`${a.mediaType}:${a.id}`);
        seen.add(`${b.mediaType}:${b.id}`);
        const winner = prefer(a, b);
        const loser = winner === a ? b : a;
        picks.push({ winner, loser });
        weights = recordPick(weights, { winner, loser });
      }
      return duelWinner(picks, weights);
    }

    const thrillerFan = run((a, b) => (a.genres?.includes('Thriller') ? a : b));
    const comedyFan = run((a, b) => (a.genres?.includes('Comedy') ? a : b));

    expect(thrillerFan!.genres).toContain('Thriller');
    expect(comedyFan!.genres).toContain('Comedy');
    expect(thrillerFan!.id).not.toBe(comedyFan!.id);
  });
});

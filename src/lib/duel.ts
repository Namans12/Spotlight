import type { Movie } from '@/types/movie';
import { RUNTIME_BANDS } from '@/lib/watchNow';

/**
 * "I don't know what to watch."
 *
 * Two posters, pick one, repeat. The output is a single title and a sentence
 * saying why it won.
 *
 * The brief for this was explicit: not hard coded. A fixed set of questions —
 * "action or comedy? old or new?" — is a decision tree with a few dozen
 * leaves, so everyone who answers the same way lands on the same film, and
 * the film is always whatever was popular the week the list was written. So
 * there is no list here and no questions. The candidates are fetched live
 * (the reader's own unwatched saves, their recommendations, what is trending)
 * and the *picks themselves* are the only input.
 *
 * What makes it diverge rather than converge on the same few titles is that
 * the picks reweight the pool as you go. Two people who start from the same
 * eight posters and pick differently are looking at different candidates by
 * round three.
 */

export interface DuelCandidate extends Movie {
  /** From the providers batch, which already carries both. Absent is fine —
   *  an attribute nobody knows simply casts no vote. */
  genres?: string[];
  runtime?: number;
}

/** Accumulated evidence, keyed "genre:Thriller", "lang:hi", "decade:2010s". */
export type Weights = Record<string, number>;

export interface DuelPick {
  winner: DuelCandidate;
  loser: DuelCandidate;
}

/** Enough picks to have said something, few enough not to be a chore. Five
 *  binary choices distinguish 32 outcomes, which is far more resolution than
 *  a pool of two dozen needs. */
export const DUEL_ROUNDS = 5;

function decadeOf(releaseDate: string | undefined): string | null {
  if (!releaseDate || releaseDate.length < 4) return null;
  const year = Number(releaseDate.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

function runtimeBandOf(runtime: number | undefined): string | null {
  if (!runtime) return null;
  return RUNTIME_BANDS.find((band) => runtime >= band.min && runtime < band.max)?.id ?? null;
}

/**
 * The things about a title that a preference could be *about*.
 *
 * Deliberately coarse. "Thriller" and "2010s" are things someone can have a
 * taste in; a vote average or a TMDB id is not, and including finer attributes
 * would let the scoring latch onto coincidences — with five picks there is not
 * enough signal to support more than a handful of dimensions.
 */
export function attributeKeys(candidate: DuelCandidate): string[] {
  const keys: string[] = [];
  for (const genre of candidate.genres ?? []) keys.push(`genre:${genre}`);
  if (candidate.originalLanguage) keys.push(`lang:${candidate.originalLanguage}`);
  keys.push(`type:${candidate.mediaType}`);

  const decade = decadeOf(candidate.releaseDate);
  if (decade) keys.push(`decade:${decade}`);

  const band = runtimeBandOf(candidate.runtime);
  if (band) keys.push(`runtime:${band}`);

  return keys;
}

/**
 * Updates the evidence from one choice.
 *
 * The important part is what is *not* penalised. If both posters are thrillers
 * and you pick one, "thriller" was not the deciding factor — it was held
 * constant across the choice, and docking it would be reading a preference out
 * of a coin flip. Only the attributes the loser had and the winner did not are
 * evidence against.
 *
 * The penalty is half the reward because a rejection is weaker evidence than a
 * choice: you picked the winner for some reason, but you rejected the loser
 * for one of several, and this cannot tell which.
 */
export function recordPick(weights: Weights, pick: DuelPick): Weights {
  const next = { ...weights };
  const winnerKeys = new Set(attributeKeys(pick.winner));

  for (const key of winnerKeys) next[key] = (next[key] ?? 0) + 1;
  for (const key of attributeKeys(pick.loser)) {
    if (winnerKeys.has(key)) continue;
    next[key] = (next[key] ?? 0) - 0.5;
  }
  return next;
}

/** How well a candidate matches the evidence so far. Averaged over its own
 *  attributes rather than summed, so a title TMDB happens to list under five
 *  genres does not outrank a better match listed under two. */
export function scoreCandidate(candidate: DuelCandidate, weights: Weights): number {
  const keys = attributeKeys(candidate);
  if (keys.length === 0) return 0;
  return keys.reduce((sum, key) => sum + (weights[key] ?? 0), 0) / keys.length;
}

function candidateKey(candidate: DuelCandidate): string {
  return `${candidate.mediaType}:${candidate.id}`;
}

/**
 * The next two posters.
 *
 * One is the current front-runner; the other is the most *different* title
 * among the next few. Pairing the top two would ask the reader to separate
 * two titles the evidence already says are alike, which teaches nothing —
 * a choice is only worth making if the answer changes something.
 *
 * Returns null when there is nothing left to ask.
 */
export function nextPair(
  pool: DuelCandidate[],
  weights: Weights,
  seen: Set<string>,
): [DuelCandidate, DuelCandidate] | null {
  const remaining = pool.filter((c) => !seen.has(candidateKey(c)));
  if (remaining.length < 2) return null;

  const ranked = [...remaining].sort((a, b) => scoreCandidate(b, weights) - scoreCandidate(a, weights));
  const leader = ranked[0];
  const leaderKeys = new Set(attributeKeys(leader));

  // Among a shortlist of plausible titles, not the whole tail: the most
  // different title in a pool of 24 is usually the one with the least data,
  // and offering a poster with nothing known about it wastes a round.
  //
  // The floor of four matters more than the half. "Top half of the pool"
  // collapses to a single candidate once the pool is down to four — which is
  // exactly where the rounds end up — and a shortlist of one is not a choice
  // between anything, it is whatever happened to rank second.
  const shortlist = ranked.slice(1, Math.max(4, Math.ceil(ranked.length / 2)));
  let challenger = shortlist[0];
  let fewestShared = Infinity;

  for (const candidate of shortlist) {
    const shared = attributeKeys(candidate).filter((key) => leaderKeys.has(key)).length;
    if (shared < fewestShared) {
      fewestShared = shared;
      challenger = candidate;
    }
  }

  return [leader, challenger];
}

/**
 * The answer.
 *
 * Chosen from the titles the reader actually picked, never from the pool at
 * large. "You chose these five, so watch this sixth thing you never saw" is a
 * non-sequitur however good the maths behind it is — the point of asking was
 * that the asking should matter.
 *
 * Later picks break ties, because a preference expressed once the evidence had
 * accumulated is worth more than one expressed cold in round one.
 */
export function duelWinner(picks: DuelPick[], weights: Weights): DuelCandidate | null {
  if (picks.length === 0) return null;

  let best = picks[0].winner;
  let bestScore = -Infinity;

  picks.forEach((pick, index) => {
    // A thousandth of a point per round — enough to break an exact tie,
    // far too small to overturn a real difference in fit.
    const score = scoreCandidate(pick.winner, weights) + index * 0.001;
    if (score >= bestScore) {
      bestScore = score;
      best = pick.winner;
    }
  });

  return best;
}

const ATTRIBUTE_PHRASES: Record<string, (value: string) => string> = {
  genre: (value) => value.toLowerCase(),
  decade: (value) => `from the ${value}`,
  runtime: (value) => RUNTIME_BANDS.find((b) => b.id === value)?.label.toLowerCase() ?? value,
  type: (value) => (value === 'tv' ? 'series' : 'films'),
};

/**
 * Why this one won, in the reader's own terms.
 *
 * Only attributes with real positive evidence behind them are named, and only
 * ones the winner actually has. A justification that cites something the
 * winner does not have is worse than no justification: it is the moment
 * someone stops believing the rest of the page.
 *
 * Language is deliberately left out — the reader knows what language they
 * watch in, and "you kept choosing Hindi" reads as an observation about them
 * rather than about the films.
 */
export function explainWinner(winner: DuelCandidate, weights: Weights): string | null {
  const reasons = attributeKeys(winner)
    .filter((key) => !key.startsWith('lang:'))
    .map((key) => ({ key, weight: weights[key] ?? 0 }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map(({ key }) => {
      const [kind, ...rest] = key.split(':');
      const value = rest.join(':');
      return ATTRIBUTE_PHRASES[kind]?.(value) ?? value;
    });

  if (reasons.length === 0) return null;
  return `You kept choosing ${reasons.join(', ')}.`;
}

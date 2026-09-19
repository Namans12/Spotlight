import type { DuelCandidate } from '@/lib/duel';
import { isWatched } from '@/lib/watched';

/**
 * What goes in front of someone who does not know what to watch.
 *
 * This is the part of the duel that decides whether it is any good. The
 * mechanic is only as interesting as the posters it has to offer, and the
 * failure the brief named explicitly — everyone landing on the same few films
 * — is a pool problem, not a scoring problem. A pool of "this week's top
 * twenty" produces the same twenty for everybody no matter how cleverly they
 * are ranked afterwards.
 *
 * So the pool is drawn from several sources at once and round-robined rather
 * than concatenated. Concatenation looks like it blends sources and does not:
 * take the first twenty of [trending(20), saved(6), recommended(20)] and you
 * get trending, exactly trending, and nothing else.
 */

export interface PoolSource {
  /** Only for reading the code and the tests — never shown. */
  name: string;
  items: DuelCandidate[];
}

export interface BuildPoolOptions {
  /** Titles the reader has already seen, from the watched bucket. */
  watchedKeys: Set<string>;
  limit: number;
  /** Injected so a test can be deterministic. */
  random?: () => number;
}

function key(candidate: DuelCandidate): string {
  return `${candidate.mediaType}:${candidate.id}`;
}

/** Fisher-Yates. In place, on a copy. */
function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * One pool, drawn evenly from every source that has anything to give.
 *
 * Each source is shuffled first, so two visits in the same hour do not offer
 * the same eight posters — TMDB's trending list barely moves day to day, and a
 * decider that asks the same question twice is a quiz, not a decision.
 *
 * Sources that run dry are skipped rather than padded: a signed-out reader has
 * no saves and no recommendations, and the right answer there is a smaller
 * pool of the sources that do exist, not a pool topped up to size with
 * whatever ranked twenty-first.
 */
export function buildPool(sources: PoolSource[], options: BuildPoolOptions): DuelCandidate[] {
  const random = options.random ?? Math.random;
  const queues = sources.map((source) => shuffle(source.items, random));
  const pool: DuelCandidate[] = [];
  const taken = new Set<string>();

  let exhausted = false;
  while (pool.length < options.limit && !exhausted) {
    exhausted = true;
    for (const queue of queues) {
      if (pool.length >= options.limit) break;
      // Each source contributes one title per lap. A source with two entries
      // is fully represented after two laps and then simply stops, which is
      // what keeps a six-title watchlist from being drowned by trending.
      const candidate = queue.shift();
      if (!candidate) continue;
      exhausted = false;

      const candidateKey = key(candidate);
      // Deduped across sources, not within them: the same film is routinely in
      // both trending and someone's recommendations, and showing it twice in
      // one duel makes the whole thing look broken.
      if (taken.has(candidateKey)) continue;
      // Something already watched is not a suggestion. This is the payoff for
      // the eye: before it existed there was no way to know.
      if (isWatched(options.watchedKeys, candidate.mediaType, candidate.id)) continue;
      // A poster is the entire interface. A title without one cannot be
      // chosen between.
      if (!candidate.posterPath) continue;

      taken.add(candidateKey);
      pool.push(candidate);
    }
  }

  return pool;
}

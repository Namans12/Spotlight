import { attributeKeys, type Attributed } from '@/lib/titleAttributes';

/**
 * What someone liked, and what that implies.
 *
 * The eye says "I have seen this". It does not say "I want more of this", and
 * treating it as though it did is how a recommender ends up confidently
 * serving more of whatever you watched on a flight and regretted. The thumb is
 * the missing half: seen is a fact, liked is an opinion, and only the opinion
 * is evidence about what to show next.
 *
 * Attributes come from the same vocabulary the duel uses
 * (src/lib/titleAttributes.ts), deliberately — a thumbs-up and a duel pick
 * have to mean the same thing or the two signals cannot be reconciled.
 */

/** Keyed "movie:920"; true for liked, false for disliked. A title with no
 *  opinion is simply absent, which is not the same as neutral — it means the
 *  reader has not said. */
export type Opinions = Record<string, boolean>;

export interface TasteProfile {
  /** Per attribute, normalised by the number of opinions, so a reader with
   *  forty of them does not exert forty times the pull of one with two. */
  weights: Record<string, number>;
  liked: number;
  disliked: number;
}

export const EMPTY_TASTE: TasteProfile = { weights: {}, liked: 0, disliked: 0 };

/**
 * Below this, there is no profile — there is one film with adjectives.
 *
 * Reranking on a single thumb would take that title's five or six attributes
 * and apply them to everything, which is not a taste, it is an echo. The same
 * refusal-to-pretend as the year in review's sparse gate.
 */
export const MIN_OPINIONS_TO_RERANK = 3;

export function opinionKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/**
 * Builds a profile from rated titles.
 *
 * A dislike counts as much as a like, in the opposite direction. That is a
 * choice worth stating: it would be easy to weaken dislikes on the grounds
 * that people are quicker to condemn than to praise, but someone who bothers
 * to thumb something down has told you something specific, and quietly
 * discounting it means the control does less than it appears to.
 */
export function buildTaste(rated: Attributed[], opinions: Opinions): TasteProfile {
  const net: Record<string, number> = {};
  let liked = 0;
  let disliked = 0;

  for (const title of rated) {
    const opinion = opinions[opinionKey(title.mediaType, title.id)];
    if (opinion === undefined) continue;
    if (opinion) liked += 1;
    else disliked += 1;

    for (const key of attributeKeys(title)) {
      net[key] = (net[key] ?? 0) + (opinion ? 1 : -1);
    }
  }

  const total = liked + disliked;
  if (total === 0) return EMPTY_TASTE;

  const weights: Record<string, number> = {};
  for (const [key, value] of Object.entries(net)) weights[key] = value / total;

  return { weights, liked, disliked };
}

/**
 * How well a title matches the profile.
 *
 * Summed rather than averaged, and the difference matters. Most of what a
 * profile knows is shared by almost every candidate — if every film someone
 * rated is in English, `lang:en` carries weight 1.0 and every English
 * candidate collects it. Averaging lets that constant interact with however
 * many attributes happen to be known about each title, so a thriller with a
 * recorded runtime scores lower than an identical thriller without one.
 * Summed, a shared attribute is a constant offset, and only the attributes
 * that actually differ can change the order.
 *
 * The absolute number is therefore not meaningful on its own — it is a
 * quantity to compare within one list, which is what rerankByTaste does.
 */
export function tasteScore(candidate: Attributed, taste: TasteProfile): number {
  return attributeKeys(candidate).reduce((sum, key) => sum + (taste.weights[key] ?? 0), 0);
}

/** The furthest taste may move a title. */
const MAX_SHIFT = 5;

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * Nudges a ranked list toward what someone likes — and only nudges.
 *
 * The list arriving here was ranked by the server on real evidence about these
 * specific titles: shared director, shared cast, same franchise, overlapping
 * keywords (lib/recommendations.ts). Taste is a weaker and much broader
 * signal, so it adjusts position rather than deciding it, bounded to five
 * places. A reader who dislikes one slow film should not find every long film
 * banished to the bottom of a list that was otherwise right.
 *
 * Applied in the browser rather than on the server on purpose. The
 * /you-may-also-like response is shared by every reader through the edge
 * cache; personalising it there would make that cache per-user and cost every
 * reader the hit rate to serve one.
 *
 * Nothing is ever removed. A title matching a disliked one is still a
 * reasonable suggestion — you disliked one Adam Sandler film, not comedy — and
 * anything actually watched is already filtered out upstream.
 */
export function rerankByTaste<T extends Attributed>(candidates: T[], taste: TasteProfile): T[] {
  if (taste.liked + taste.disliked < MIN_OPINIONS_TO_RERANK) return candidates;
  if (candidates.length < 2) return candidates;

  const scores = candidates.map((candidate) => tasteScore(candidate, taste));
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  // Centred on this list's own mean and divided by its own spread, because
  // what matters is which of THESE titles fits better, not how large the
  // number is. Without centring, a profile where every candidate scores
  // around 4.0 saturates the shift for all of them and nothing moves.
  const spread = Math.max(...scores.map((score) => Math.abs(score - mean)));
  if (spread === 0) return candidates;

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      adjusted: index - clamp(((scores[index] - mean) / spread) * MAX_SHIFT, MAX_SHIFT),
    }))
    // Original position breaks ties, which keeps the server's ranking intact
    // wherever taste has nothing to say.
    .sort((a, b) => a.adjusted - b.adjusted || a.index - b.index)
    .map((entry) => entry.candidate);
}

/**
 * The titles worth seeding "because you liked…" rows from.
 *
 * Most recently rated first, and only ever the liked ones: seeding a
 * recommendation row from something someone disliked would be an unusually
 * direct way of ignoring them.
 */
export function likedSeeds<T extends Attributed & { addedAt?: number }>(
  rated: T[],
  opinions: Opinions,
  limit: number,
): T[] {
  return rated
    .filter((title) => opinions[opinionKey(title.mediaType, title.id)] === true)
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
    .slice(0, limit);
}

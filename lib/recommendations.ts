import type { TmdbMovieResult } from "./tmdbProxy.js";

// Ranking for "You may also like".
//
// The old answer was TMDB's /recommendations topped up with /similar. That is
// right about half the time and silent the rest: measured against a fixed set
// of pairs a viewer would call obvious, /recommendations ranks Troy #1 for The
// Odyssey, Cars 2 #1 for Cars, and Better Call Saul #1 for Breaking Bad — and
// returns nothing at all for Dil Chahta Hai -> Zindagi Na Milegi Dobara,
// Yeh Jawaani Hai Deewani -> Wake Up Sid, or Friends -> The Big Bang Theory.
// It is behavioural data, so it is excellent where a large audience has
// watched both and empty where that audience is small or regional.
//
// So /recommendations stays, as the strongest single signal, and the gaps are
// filled by asking TMDB the questions that actually connect those pairs:
//
//   people    Ranbir Kapoor and Ayan Mukerji made both YJHD and Wake Up Sid.
//             Matched across roles, not per-role: Farhan Akhtar *directed*
//             Dil Chahta Hai and *acted in* Zindagi Na Milegi Dobara, and a
//             cast-to-cast comparison misses that entirely.
//   company   Dharma, Excel, Pixar, Warner Bros. Television. A production
//             house is a real taste signal, especially in Hindi cinema.
//   keywords  What Friends and The Big Bang Theory share is "sitcom"; what
//             The Odyssey and Troy share is "trojan war".
//
// Scoring is by *provenance*, not by re-fetching each candidate. A title that
// comes back from the with_people query provably shares that person — that is
// what the query asked — so no second call is needed to find out. A title
// returned by several queries at once accumulates their weights, which is how
// Wake Up Sid (cast + director + company) outranks a film that merely shares
// a genre.
//
// Genre is deliberately weak and never a filter: YJHD and Brahmastra share
// their lead, their director and their studio, and share no genre at all.

export type SignalKind = "recommendation" | "franchise" | "person" | "director" | "company" | "keyword" | "similar";

/** One TMDB query's worth of candidates, tagged with why it was asked. */
export interface CandidateBucket {
  kind: SignalKind;
  /** Shown to the reader — "Also stars Ranbir Kapoor". Omitted for the
   *  behavioural signals, which have nothing specific to say. */
  label?: string;
  results: TmdbMovieResult[];
}

export interface ScoredRecommendation extends TmdbMovieResult {
  /** Why this title is here, strongest reason first. Drives the poster
   *  subtitle, so a recommendation can explain itself instead of being an
   *  unexplained poster next to the one you're looking at. */
  reasons: string[];
  score: number;
}

/** Base weight per signal.
 *
 *  /recommendations leads because it is the only behavioural signal here and,
 *  where it has data, it is measurably right. The metadata signals below it
 *  are ordered by how specific a claim they make: two people in common is a
 *  much stronger statement than one shared studio, which is stronger than one
 *  shared keyword. /similar trails everything — TMDB builds it from loose
 *  genre and keyword overlap, and in production it has returned a 1941
 *  bullfighting drama and two WWE specials for a Hindi action sequel. */
const WEIGHTS: Record<SignalKind, number> = {
  recommendation: 100,
  // Ranked with the behavioural signal rather than below it: for someone
  // looking at Cars, the other Cars films are the answer, and they are the one
  // group no popularity- or vote-ranked query reliably returns.
  franchise: 92,
  director: 70,
  person: 55,
  company: 34,
  keyword: 30,
  similar: 12,
};

/** How far down each list is worth reading. Behavioural relevance falls off a
 *  cliff; a filmography or a franchise does not. */
const BUCKET_DEPTH: Record<SignalKind, number> = {
  recommendation: 10,
  franchise: 12,
  // A filmography is worth reading to the end — every entry genuinely shares
  // the person the query asked about.
  director: 20,
  person: 20,
  // A studio catalogue is not. Past its best-regarded few in this genre,
  // "same studio" stops being a taste signal: for Friends, reading Warner
  // Bros. Television to depth 20 added Young Sheldon, Gilmore Girls, Full
  // House, Chuck, Jane the Virgin and Lethal Weapon, none of which share
  // anything with it but a corporate parent.
  company: 8,
  keyword: 12,
  similar: 8,
};

/** A result's position within its own bucket carries real information — TMDB
 *  orders /recommendations by relevance and /discover by the sort asked for —
 *  so a later hit is worth less, but never nothing.
 *
 *  The decay is steep on purpose. /recommendations is the heaviest signal
 *  here, and at a shallow decay its *tail* outranked strong evidence from
 *  every other source: for Friends, the 18th-ranked recommendation (The
 *  Jeffersons) beat The Big Bang Theory, which is the top comedy from
 *  Friends' own studio by vote count. Item 18 of a behavioural list is not a
 *  better answer than that, and now it does not score like one. Decays to 25%
 *  rather than to zero, so a real match sitting deep in one list can still
 *  win by appearing in several.
 *
 *  0.6 rather than something steeper: pushing it to 0.75 to promote a strong
 *  studio match also penalised the person and director buckets, and cost more
 *  (Wake Up Sid #5 -> #8, Cars 3 #10 -> #14) than it bought. */
function rankFactor(index: number, size: number): number {
  if (size <= 1) return 1;
  return 1 - 0.6 * (index / (size - 1));
}

/** Language affinity, applied in both directions.
 *
 *  Rewarding a match was not enough on its own. TMDB's behavioural data is
 *  dominated by English-speaking audiences, so /recommendations for an Indian
 *  series answers largely in English however good the show is: measured over a
 *  held-out set, only 15% of The Family Man's results were Hindi, 45% of
 *  Vikram's were Tamil, and 50% of Panchayat's were Hindi. Someone reading a
 *  Hindi show's page is not well served by a list of English ones.
 *
 *  So a mismatch is discounted as well as a match rewarded. It stays a
 *  multiplier, never a filter — a cross-language title carried by a strong
 *  signal (the same director's English-language film, say) still outranks a
 *  same-language title with nothing behind it, which is the correct outcome.
 *  For an English title in an English catalogue neither factor changes the
 *  order at all, since it applies uniformly. */
const SAME_LANGUAGE_BONUS = 1.35;
const CROSS_LANGUAGE_PENALTY = 0.6;

/** Genre overlap breaks ties and nothing more — see the header on YJHD. */
const GENRE_POINTS_EACH = 6;
const MAX_GENRE_POINTS = 18;

/** Below this, a title is too thinly rated for a confident recommendation.
 *  Keeps /discover's long tail of near-unrated entries out without touching
 *  anything a viewer would recognise. */
const MIN_VOTE_COUNT = 20;

export interface ScoreOptions {
  /** The title being viewed. Never recommends itself. */
  originId: number;
  originLanguage?: string;
  originGenreIds?: number[];
  /** Titles already known to be part of this one's watch-order chain. Not
   *  excluded — a sequel is a legitimate "you may also like" and the reader
   *  asked for exactly that — but they are already shown above under Watch
   *  order, so they do not need this row's help to be found. */
  chainIds?: number[];
  limit?: number;
}

export function scoreCandidates(buckets: CandidateBucket[], opts: ScoreOptions): ScoredRecommendation[] {
  const { originId, originLanguage, originGenreIds = [], chainIds = [], limit = 20 } = opts;
  const originGenres = new Set(originGenreIds);
  const chain = new Set(chainIds);

  interface Accumulator {
    movie: TmdbMovieResult;
    score: number;
    /** Deduped by label so three films from one bucket don't each claim the
     *  reason three times. */
    reasons: Map<string, number>;
  }
  const byId = new Map<number, Accumulator>();

  for (const bucket of buckets) {
    const weight = WEIGHTS[bucket.kind];
    // Only the head of each list is considered. /recommendations is the
    // heaviest signal and its first few entries are excellent, but its tail is
    // not: for Friends, items 10-20 are Traffic Light, Archie Bunker's Place
    // and Love, American Style, and at full length they crowded out The Big
    // Bang Theory and Modern Family. Trimming the list is a cleaner
    // instrument than steepening the rank decay, which also penalises the
    // person and director buckets where a deep hit is still a real one.
    const considered = bucket.results.slice(0, BUCKET_DEPTH[bucket.kind]);
    considered.forEach((movie, index) => {
      if (!movie || movie.id === originId) return;

      const points = weight * rankFactor(index, considered.length);
      const existing = byId.get(movie.id);
      const acc: Accumulator = existing ?? { movie, score: 0, reasons: new Map() };
      acc.score += points;
      if (bucket.label) {
        acc.reasons.set(bucket.label, Math.max(acc.reasons.get(bucket.label) ?? 0, points));
      }
      if (!existing) byId.set(movie.id, acc);
    });
  }

  const scored: ScoredRecommendation[] = [];
  for (const acc of byId.values()) {
    const movie = acc.movie;

    // voteAverage is what TmdbMovieResult carries; a title with no rating at
    // all is the long-tail case MIN_VOTE_COUNT is aimed at, and `voteCount`
    // is only present on raw discover rows, so treat a missing one as unknown
    // rather than as zero.
    const voteCount = (movie as TmdbMovieResult & { voteCount?: number }).voteCount;
    if (typeof voteCount === "number" && voteCount < MIN_VOTE_COUNT) continue;

    let score = acc.score;

    if (originLanguage && movie.originalLanguage) {
      score *= movie.originalLanguage === originLanguage ? SAME_LANGUAGE_BONUS : CROSS_LANGUAGE_PENALTY;
    }

    const candidateGenres = (movie as TmdbMovieResult & { genreIds?: number[] }).genreIds ?? [];
    const shared = candidateGenres.filter((g) => originGenres.has(g)).length;
    score += Math.min(shared * GENRE_POINTS_EACH, MAX_GENRE_POINTS);

    // A tiny, bounded nudge so that between two titles with identical
    // provenance the better-regarded one leads. Deliberately too small to
    // move anything past a real signal.
    score += Math.min(movie.voteAverage ?? 0, 10) * 0.8;

    // Already surfaced, prominently, in the Watch order rail above.
    if (chain.has(movie.id)) score *= 0.75;

    scored.push({
      ...movie,
      score,
      reasons: [...acc.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label),
    });
  }

  scored.sort((a, b) => b.score - a.score || (b.voteAverage ?? 0) - (a.voteAverage ?? 0));
  return scored.slice(0, limit);
}

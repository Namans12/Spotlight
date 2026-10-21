// Local relevance score for the board: how well a title's audience lines up
// with a city and a business type, from evidence already in the cache.

import type { BoardCard, BusinessType, LocalHook } from "../../../shared/types/pulse.js";
import { BUSINESS_TYPES } from "./businessTypes.js";

export interface Candidate {
  card: Omit<BoardCard, "score" | "why">;
  /** TMDB popularity, used only to pick the top 20 and to break score ties. */
  popularity: number;
  entityId: string | null;
  /** Heatmap cell affinities; null when the evidence is not cached yet. */
  heat: number[] | null;
  /** Place-tag names for the city; null when not cached yet. */
  placeTagNames: string[] | null;
  hook: LocalHook | null;
  /** Whole days from today (India calendar day) to the release date. */
  daysAhead: number;
}

export interface Parts { local_affinity: number; business_fit: number; local_hook: number; freshness: number }

export interface Scored {
  candidate: Candidate;
  score: number;
  parts: Parts;
  /** Carried so the why-line can word the business-fit part without a sixth argument. */
  businessType: BusinessType;
}

const WEIGHTS: Parts = { local_affinity: 0.55, business_fit: 0.25, local_hook: 0.1, freshness: 0.1 };
/** Declaration order; it is also the tie-break order when two parts weigh the same. */
const PART_ORDER = ["local_affinity", "business_fit", "local_hook", "freshness"] as const;
/** Builder's calls: a part is only claimed in the why-line when it is at least
 *  this strong, so a line never asserts something the numbers barely support.
 *  Business fit is a raw share of tags; local affinity is the normalised value. */
const CLAIM_FLOOR_BUSINESS_FIT = 0.2;
const CLAIM_FLOOR_LOCAL_AFFINITY = 0.2;
const TOP_CELLS = 5;
const TOP_TAGS = 10;

/** 1 for a title out in the last 3 days or due within 7, half that for the
 *  week after, nothing outside the board's window. */
export function freshness(daysAhead: number): number {
  if (daysAhead >= -3 && daysAhead <= 7) return 1;
  if (daysAhead > 7 && daysAhead <= 14) return 0.5;
  return 0;
}

// "Café" in Qloo's tags must match the query word "cafe".
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The share of the top 10 place-tag names that contain any of the business
 *  type's query words, 0..1. */
export function businessFit(tagNames: string[], type: BusinessType): number {
  const top = tagNames.slice(0, TOP_TAGS);
  if (top.length === 0) return 0;
  const words = BUSINESS_TYPES[type].placeTagQueries.map(fold).filter(Boolean);
  const hits = top.filter((name) => {
    const n = fold(name);
    return words.some((w) => n.includes(w));
  }).length;
  return hits / top.length;
}

/** Mean of the strongest cells, or null when there are none to average. */
function localStrength(heat: number[] | null): number | null {
  const usable = (heat ?? []).filter((v) => Number.isFinite(v)).sort((a, b) => b - a).slice(0, TOP_CELLS);
  return usable.length === 0 ? null : usable.reduce((a, b) => a + b, 0) / usable.length;
}

/** A score as the wire shows it: 3 decimals. The ranking compares scores
 *  through this too, so what a client sees is what ordered the cards. */
export const roundScore = (x: number): number => Math.round(x * 1000) / 1000;

/** Scores and ranks (best first). Local affinity is min-max normalised among
 *  the candidates that have cells; one with none is 0 and does not enter the
 *  range, so a city with no heatmap data at all ranks everything on the other
 *  parts instead of dividing 0 by 0. */
export function scoreCandidates(cands: Candidate[], type: BusinessType): Scored[] {
  const strengths = cands.map((c) => localStrength(c.heat));
  const present = strengths.filter((v): v is number => v !== null);
  const lo = Math.min(...present);
  const hi = Math.max(...present);

  const scored = cands.map((candidate, i): Scored => {
    const s = strengths[i];
    const local_affinity = s === null ? 0 : hi === lo ? 1 : (s - lo) / (hi - lo);
    const parts: Parts = {
      local_affinity,
      business_fit: businessFit(candidate.placeTagNames ?? [], type),
      local_hook: candidate.hook ? 1 : 0,
      freshness: freshness(candidate.daysAhead),
    };
    const score = PART_ORDER.reduce((sum, k) => sum + WEIGHTS[k] * parts[k], 0);
    return { candidate, score, parts, businessType: type };
  });

  // Scores are compared as the wire shows them (3 decimals), so float noise
  // far below that cannot outrank popularity.
  return scored.sort((a, b) =>
    roundScore(b.score) - roundScore(a.score)
    || b.candidate.popularity - a.candidate.popularity
    || a.candidate.card.releaseDate.localeCompare(b.candidate.card.releaseDate)
    || a.candidate.card.tmdbId - b.candidate.card.tmdbId);
}

const FIT_WORDS: Record<BusinessType, string> = {
  cafe: "fans over-index on café-style spots",
  d2c_food: "fans over-index on snack & dessert brands",
};

/** "#<rank> of <total> for <City> audiences", then the two parts that added
 *  the most to the score, largest first, equal parts in declaration order.
 *  A part that added nothing, or sits below its claim floor, is left out
 *  rather than claimed. The exception is a candidate with no heatmap cells at
 *  all: that absence is worth saying ("no local signal yet"). It is decided
 *  from the cells, not from the normalised value, because normalisation gives
 *  the weakest candidate WITH cells a 0 too. */
export function whyLine(s: Scored, rank: number, total: number, cityName: string, topHood: string | null): string {
  const hasCells = localStrength(s.candidate.heat) !== null;
  const words: Record<(typeof PART_ORDER)[number], string> = {
    local_affinity: !hasCells
      ? "no local signal yet"
      : topHood ? `strongest around ${topHood}` : "strong local affinity",
    business_fit: FIT_WORDS[s.businessType],
    local_hook: s.candidate.hook?.kind === "filmed"
      ? `shot in ${s.candidate.hook.landmark ?? cityName}`
      : `set in ${cityName}`,
    freshness: s.parts.freshness === 1 ? "out this week" : "out within two weeks",
  };
  const chosen = PART_ORDER
    .map((k, order) => ({ k, order, weighted: WEIGHTS[k] * s.parts[k] }))
    .filter((p) => {
      if (p.k === "local_affinity") return !hasCells || s.parts.local_affinity >= CLAIM_FLOOR_LOCAL_AFFINITY;
      if (p.k === "business_fit") return s.parts.business_fit >= CLAIM_FLOOR_BUSINESS_FIT;
      return p.weighted > 0;
    })
    .sort((a, b) => b.weighted - a.weighted || a.order - b.order)
    .slice(0, 2)
    .map((p) => words[p.k]);
  return [`#${rank} of ${total} for ${cityName} audiences`, ...chosen].join(" · ");
}

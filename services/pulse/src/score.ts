// Board candidate shape and venue-theme helpers. Local ranks come from
// one fixed-slate Qloo query; heatmap scores must never be compared across titles.

import type { BoardCard, BusinessType, LocalHook } from "../../../shared/types/pulse.js";
import { BUSINESS_TYPES } from "./businessTypes.js";

export interface Candidate {
  card: Omit<BoardCard, "score" | "why">;
  /** TMDB popularity, used only to select candidates within each media pool. */
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

// Helpers for interpreting venue-theme names only. These are not audience
// measurements and are never used to create a cross-query demand score.
const TOP_TAGS = 10;
export function freshness(daysAhead: number): number {
  return daysAhead >= -3 && daysAhead <= 7 ? 1 : daysAhead > 7 && daysAhead <= 14 ? 0.5 : 0;
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

import { describe, expect, it } from "vitest";
import type { LocalHook } from "../../../shared/types/pulse.js";
import { businessFit, freshness, scoreCandidates, whyLine, type Candidate } from "./score.js";

let seq = 0;
/** A candidate with nothing going for it unless a test says otherwise: no
 *  hook, no tags, out of the freshness window. Each test then switches on
 *  only the part it is about. */
function cand(over: Partial<Candidate> = {}): Candidate {
  seq += 1;
  return {
    card: { tmdbId: seq, mediaType: "movie", title: `Fake Title ${seq}`, posterUrl: null, releaseDate: "2026-12-01", platform: null, kind: "streaming" },
    popularity: 0,
    entityId: `fx-${seq}`,
    heat: [0.5],
    placeTagNames: [],
    hook: null,
    daysAhead: 20,
    ...over,
  };
}
const filmed = (landmark: string | null = null): LocalHook => ({ kind: "filmed", placeName: "Delhi", landmark, source: "both" });
const setIn: LocalHook = { kind: "set", placeName: "Delhi", landmark: null, source: "wikipedia" };

describe("freshness", () => {
  it.each([
    [-4, 0], [-3, 1], [0, 1], [7, 1], [8, 0.5], [14, 0.5], [15, 0], [30, 0],
  ])("daysAhead %i -> %f", (d, want) => expect(freshness(d)).toBe(want));
});

describe("businessFit", () => {
  it("is the share of the top 10 tag names containing a cafe query word, case-insensitively", () => {
    expect(businessFit(["Coffee Shops", "Rooftop", "BAKERY", "Gym"], "cafe")).toBe(0.5);
  });
  it("only looks at the first 10 names", () => {
    const names = [...Array(10).fill("Gym"), "Cafe", "Cafe"];
    expect(businessFit(names, "cafe")).toBe(0);
    expect(businessFit([...Array(8).fill("Gym"), "Cafe", "Dessert Bar", "Cafe"], "cafe")).toBe(0.2);
  });
  it("uses the words of the business type: d2c_food does not count coffee", () => {
    const tags = ["Coffee", "Street Food Stalls", "Snacks", "Gym"];
    expect(businessFit(tags, "cafe")).toBe(0.25);
    expect(businessFit(tags, "d2c_food")).toBe(0.5);
  });
  it("matches an accented spelling of a query word", () => {
    expect(businessFit(["Café", "Gym"], "cafe")).toBe(0.5);
  });
  it("is 0 for an empty list, never NaN", () => {
    expect(businessFit([], "cafe")).toBe(0);
    expect(businessFit([], "d2c_food")).toBe(0);
  });
  it("is 1 when every tag matches", () => {
    expect(businessFit(["cafe", "coffee"], "cafe")).toBe(1);
  });
});

describe("scoreCandidates", () => {
  it("weights parts 0.55/0.25/0.10/0.10", () => {
    const [a, b] = scoreCandidates([cand({ heat: [0.9] }), cand({ heat: [0.1] })], "cafe");
    expect(a.score).toBeCloseTo(0.55);
    expect(b.score).toBeCloseTo(0);
    const [full] = scoreCandidates([cand({ heat: [0.9], placeTagNames: ["Cafe"], hook: setIn, daysAhead: 2 })], "cafe");
    expect(full.parts).toEqual({ local_affinity: 1, business_fit: 1, local_hook: 1, freshness: 1 });
    expect(full.score).toBeCloseTo(1);
  });

  it("sorts best first, with a stable tie-break on popularity then release date then id", () => {
    const a = cand({ heat: [0.5], popularity: 1 });
    const b = cand({ heat: [0.5], popularity: 9 });
    const c = cand({ heat: [0.5], popularity: 9, card: { ...cand().card, releaseDate: "2026-11-01" } });
    expect(scoreCandidates([a, b, c], "cafe").map((s) => s.candidate)).toEqual([c, b, a]);
    const hi = cand({ heat: [0.95] });
    expect(scoreCandidates([a, hi], "cafe")[0].candidate).toBe(hi);
  });

  it("averages only the top 5 cells", () => {
    const [x, y] = scoreCandidates([cand({ heat: [0.9, 0.9, 0.9, 0.9, 0.9, 0.01, 0.01] }), cand({ heat: [0.8, 0.8, 0.8, 0.8, 0.8] })], "cafe");
    // 0.9 mean beats 0.8 mean; the weak tail of the first is ignored.
    expect(x.parts.local_affinity).toBe(1);
    expect(y.parts.local_affinity).toBe(0);
  });

  it("min-max normalises local affinity across the candidates that have cells", () => {
    const s = scoreCandidates([cand({ heat: [0.2] }), cand({ heat: [0.6] }), cand({ heat: [1.0] })], "cafe");
    const [top, mid, bottom] = s.map((x) => x.parts.local_affinity);
    expect(top).toBe(1);
    expect(mid).toBeCloseTo(0.5);
    expect(bottom).toBe(0);
  });

  it("gives a single candidate local affinity 1", () => {
    expect(scoreCandidates([cand({ heat: [0.3] })], "cafe")[0].parts.local_affinity).toBe(1);
  });

  it("gives every candidate 1 when all have the same affinity", () => {
    const s = scoreCandidates([cand({ heat: [0.4] }), cand({ heat: [0.4, 0.4] })], "cafe");
    expect(s.map((x) => x.parts.local_affinity)).toEqual([1, 1]);
  });

  it("scores a candidate with no cells 0 BEFORE normalising, and leaves the others' range alone (R5)", () => {
    const s = scoreCandidates([cand({ heat: [0.2] }), cand({ heat: [0.8] }), cand({ heat: [] }), cand({ heat: null })], "cafe");
    expect(s.map((x) => x.parts.local_affinity)).toEqual([1, 0, 0, 0]);
  });

  it("a single candidate with cells next to empty ones still gets 1, not a 0/0", () => {
    const s = scoreCandidates([cand({ heat: [0.3] }), cand({ heat: null })], "cafe");
    expect(s[0].parts.local_affinity).toBe(1);
    expect(s[1].parts.local_affinity).toBe(0);
  });

  it("a city with no heatmap cells still ranks every card, without NaN (Review Focus 3)", () => {
    const s = scoreCandidates([cand({ heat: [] }), cand({ heat: null })], "cafe");
    expect(s).toHaveLength(2);
    s.forEach((x) => expect(Number.isFinite(x.score)).toBe(true));
    s.forEach((x) => expect(x.parts.local_affinity).toBe(0));
    expect(whyLine(s[0], 1, 2, "Goa", null)).toContain("no local signal yet");
  });

  it("ignores cell affinities that are not finite numbers", () => {
    const s = scoreCandidates([cand({ heat: [Number.NaN, 0.5] }), cand({ heat: [Number.NaN] })], "cafe");
    s.forEach((x) => expect(Number.isFinite(x.score)).toBe(true));
    expect(s.find((x) => x.candidate.heat?.length === 1)!.parts.local_affinity).toBe(0);
  });

  it("treats null tag names as no tags", () => {
    expect(scoreCandidates([cand({ placeTagNames: null })], "cafe")[0].parts.business_fit).toBe(0);
  });

  it("scores the hook 1 for a filmed or set record and 0 for none", () => {
    const s = scoreCandidates([cand({ hook: filmed() }), cand({ hook: setIn }), cand({ hook: null })], "cafe");
    expect(s.map((x) => x.parts.local_hook).sort()).toEqual([0, 1, 1]);
  });
});

describe("whyLine", () => {
  it("names rank within the city and the two biggest contributors", () => {
    const s = scoreCandidates([cand({ heat: [0.9], hook: filmed("Chandni Chowk"), daysAhead: 2 }), cand({ heat: [0.2] })], "cafe");
    expect(whyLine(s[0], 1, 2, "Delhi", "Hauz Khas")).toBe("#1 of 2 for Delhi audiences · strongest around Hauz Khas · shot in Chandni Chowk");
  });

  it("breaks ties among equal weighted parts by declaration order local_affinity > business_fit > local_hook > freshness (R4)", () => {
    // hook and freshness are both worth 0.10 here; hook is declared first.
    const hookAndFresh = scoreCandidates([cand({ heat: [0.9], hook: setIn, daysAhead: 1 })], "cafe")[0];
    expect(whyLine(hookAndFresh, 1, 1, "Delhi", "Hauz Khas")).toBe("#1 of 1 for Delhi audiences · strongest around Hauz Khas · set in Delhi");
    // local_affinity is worth 0 here, so business_fit (0.25) and then the
    // 0.10 tie, which hook wins over freshness.
    const noLocal = scoreCandidates([cand({ heat: [], placeTagNames: ["Cafe"], hook: filmed(), daysAhead: 1 })], "cafe")[0];
    expect(whyLine(noLocal, 1, 1, "Delhi", null)).toBe("#1 of 1 for Delhi audiences · fans over-index on café-style spots · shot in Delhi");
  });

  it("orders the two parts by weighted size, not by declaration", () => {
    const s = scoreCandidates([cand({ heat: [0.1], placeTagNames: ["Cafe"] }), cand({ heat: [0.9], placeTagNames: [] })], "cafe");
    const low = s.find((x) => x.parts.local_affinity === 0)!;
    // local 0, business_fit 0.25 -> only business_fit is positive; local is the second eligible part.
    expect(whyLine(low, 2, 2, "Delhi", "Hauz Khas")).toBe("#2 of 2 for Delhi audiences · fans over-index on café-style spots · no local signal yet");
  });

  it("says no local signal yet when local affinity is 0 and it is among the top two", () => {
    const s = scoreCandidates([cand({ heat: [] })], "cafe")[0];
    expect(whyLine(s, 1, 1, "Goa", null)).toBe("#1 of 1 for Goa audiences · no local signal yet");
    // With freshness worth something it leads, because it weighs more.
    const fresh = scoreCandidates([cand({ heat: [], daysAhead: 3 })], "cafe")[0];
    expect(whyLine(fresh, 1, 1, "Goa", null)).toBe("#1 of 1 for Goa audiences · out this week · no local signal yet");
  });

  it("never claims a part that contributed nothing", () => {
    const s = scoreCandidates([cand({ heat: [0.9] })], "cafe")[0];
    expect(whyLine(s, 1, 1, "Delhi", "Hauz Khas")).toBe("#1 of 1 for Delhi audiences · strongest around Hauz Khas");
  });

  it("has a wording for each part", () => {
    const base = { heat: [0.5] };
    const line = (c: Partial<Candidate>, type: "cafe" | "d2c_food" = "cafe", hood: string | null = "Bandra") => {
      const s = scoreCandidates([cand({ ...base, ...c })], type)[0];
      return whyLine(s, 1, 1, "Mumbai", hood);
    };
    expect(line({ placeTagNames: ["Cafe"] })).toBe("#1 of 1 for Mumbai audiences · strongest around Bandra · fans over-index on café-style spots");
    expect(line({ placeTagNames: ["Snacks"] }, "d2c_food")).toBe("#1 of 1 for Mumbai audiences · strongest around Bandra · fans over-index on snack & dessert brands");
    expect(line({ hook: filmed("Gateway of India"), daysAhead: 30 })).toBe("#1 of 1 for Mumbai audiences · strongest around Bandra · shot in Gateway of India");
    expect(line({ hook: filmed(null), daysAhead: 30 })).toBe("#1 of 1 for Mumbai audiences · strongest around Bandra · shot in Mumbai");
    expect(line({ hook: setIn, daysAhead: 30 })).toBe("#1 of 1 for Mumbai audiences · strongest around Bandra · set in Mumbai");
    expect(line({ daysAhead: 7 })).toBe("#1 of 1 for Mumbai audiences · strongest around Bandra · out this week");
    expect(line({ daysAhead: -3 })).toBe("#1 of 1 for Mumbai audiences · strongest around Bandra · out this week");
  });

  it("does not call a release 8 to 14 days away 'out this week'", () => {
    const s = scoreCandidates([cand({ heat: [0.5], daysAhead: 12 })], "cafe")[0];
    expect(whyLine(s, 1, 1, "Delhi", "Hauz Khas")).toBe("#1 of 1 for Delhi audiences · strongest around Hauz Khas · out within two weeks");
  });

  it("falls back to a neighbourhood-free phrase when the strongest cell has no label", () => {
    const s = scoreCandidates([cand({ heat: [0.5] })], "cafe")[0];
    expect(whyLine(s, 1, 1, "Delhi", null)).toBe("#1 of 1 for Delhi audiences · strong local affinity");
  });
});

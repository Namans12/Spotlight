import shapeData from "../data/collection-shapes.json" with { type: "json" };

// Turns a TMDB collection into the edges that are actually true about it.
//
// The old rule was "every release-adjacent pair in a collection is a Must
// Watch prerequisite". That is correct for a tight sequel series and wrong for
// an anthology (James Bond, Untold), a multi-timeline franchise (Halloween,
// X-Men), or a collection carrying a spin-off or a recap cut (Hobbs & Shaw,
// The Godfather Coda). Getting it wrong is not a cosmetic miss: a false "you
// must watch these 23 films first" is the single most trust-destroying thing
// this feature can print, which is why scripts/sync_relations_wikidata.py was
// disqualified for a 17% error rate on exactly this question.
//
// So a collection is classified first, then chained:
//
//   chain     one continuous story        -> consecutive pairs become 'must'
//   arcs      several independent stories -> consecutive pairs *within* an arc
//   episodic  a brand, not a story        -> no 'must' edges at all
//
// Anything that ends up outside a chain — every part of an episodic
// collection, a singleton arc, an excluded spin-off — still gets rendered,
// as 'can' edges reading "same series, not required". Losing the franchise
// entirely would be a worse answer than the naive chain; asserting a
// prerequisite that isn't real is the only outcome worth avoiding at any cost.
//
// The classification lives in data/collection-shapes.json and is hand-verified
// rather than inferred. See that file's own $doc for why size is not a usable
// signal (Harry Potter: 8 parts, real chain; Predator: 6 parts, not one).

export interface CollectionPart {
  id: number;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
}

export interface CollectionShape {
  name?: string;
  note?: string;
  episodic?: boolean;
  arcs?: number[][];
  exclude?: number[];
  story?: number[];
}

type ShapeTable = Record<string, CollectionShape>;

const SHAPES: ShapeTable = (shapeData as { collections: ShapeTable }).collections;

/** Size fallback for collections with no hand-verified entry.
 *
 *  Set far above anything legitimate on purpose. The largest genuine single
 *  narrative in the wild is around eight or nine parts (Harry Potter is 8),
 *  while the collections that break the chain rule by size are 20+ (James
 *  Bond 27, Untold 24). Anything between is left to the curated list, because
 *  guessing there would demote real chains — which costs more than the false
 *  prerequisites it would avoid. */
export const EPISODIC_PART_THRESHOLD = 12;

/** Can-Watch siblings emitted on each side of a loose part. Bounded so an
 *  episodic collection cannot blow past the generators' 12-edge-per-kind
 *  fan-out cap (scripts/lib_relations.py MAX_EDGES_PER_KIND). */
export const MAX_CAN_NEIGHBOURS = 3;

export const SAME_SERIES_REASON = "Same series — not required to follow this one.";
export const SIDE_STORY_REASON = "A side story in the same series — not required to follow the main films.";

export type Classification = "chain" | "arcs" | "episodic";

export interface PlannedMustEdge {
  /** The prerequisite. */
  earlier: CollectionPart;
  /** The title that assumes it. */
  later: CollectionPart;
}

export interface PlannedCanEdge {
  from: CollectionPart;
  to: CollectionPart;
  reason: string;
}

export interface CollectionPlan {
  classification: Classification;
  /** Ordered continuity groups; every group has at least two parts. */
  arcs: CollectionPart[][];
  /** Parts in the collection that belong to no chain. */
  loose: CollectionPart[];
  must: PlannedMustEdge[];
  can: PlannedCanEdge[];
  /** Ids listed in the shape's `arcs` that the collection no longer contains,
   *  or parts the shape never mentioned. Non-fatal, but a signal the curated
   *  entry has drifted from TMDB and should be revisited. */
  warnings: string[];
}

export function getCollectionShape(collectionId: number | null | undefined): CollectionShape | undefined {
  if (collectionId === null || collectionId === undefined) return undefined;
  return SHAPES[String(collectionId)];
}

/** Release order, undated last — a part with no date must never slot in ahead
 *  of a dated one and invent a prerequisite that does not exist yet. */
export function sortByRelease<T extends { releaseDate: string | null }>(parts: T[]): T[] {
  return [...parts].sort((a, b) => (a.releaseDate ?? "9999-99-99").localeCompare(b.releaseDate ?? "9999-99-99"));
}

function isUnreleased(releaseDate: string | null, today: string): boolean {
  return releaseDate !== null && releaseDate > today;
}

/** The `n` parts nearest `part` by position in the release-ordered list, up to
 *  `n` on each side. Position rather than date distance, so a franchise with a
 *  decade-long gap still surfaces its actual neighbours. */
function nearestSiblings(ordered: CollectionPart[], index: number, n: number): CollectionPart[] {
  const before = ordered.slice(Math.max(0, index - n), index);
  const after = ordered.slice(index + 1, index + 1 + n);
  return [...before, ...after];
}

/**
 * Classifies one collection and returns the edges to write for it.
 *
 * `parts` may arrive in any order. `today` is injectable so the
 * unreleased-prerequisite rule is testable without freezing the clock.
 */
export function planCollection(
  collectionId: number | null | undefined,
  parts: CollectionPart[],
  today: string = new Date().toISOString().slice(0, 10),
): CollectionPlan {
  const warnings: string[] = [];
  const ordered = sortByRelease(parts.filter((p) => Number.isFinite(p.id)));
  const shape = getCollectionShape(collectionId);

  const excluded = new Set(shape?.exclude ?? []);
  const chainable = ordered.filter((p) => !excluded.has(p.id));

  let classification: Classification;
  let arcs: CollectionPart[][];
  let loose: CollectionPart[];

  const byId = new Map(chainable.map((p) => [p.id, p]));

  if (shape?.episodic || chainable.length > EPISODIC_PART_THRESHOLD) {
    if (!shape?.episodic) {
      warnings.push(
        `collection ${collectionId}: ${chainable.length} parts exceeds EPISODIC_PART_THRESHOLD ` +
          `(${EPISODIC_PART_THRESHOLD}) with no curated entry — treating as episodic`,
      );
    }
    classification = "episodic";
    arcs = [];
    loose = ordered;
  } else if (shape?.arcs) {
    classification = "arcs";
    const claimed = new Set<number>();
    const grouped: CollectionPart[][] = [];

    for (const arcIds of shape.arcs) {
      const members: CollectionPart[] = [];
      for (const id of arcIds) {
        const part = byId.get(id);
        if (!part) {
          warnings.push(`collection ${collectionId}: arc references id ${id}, which the collection no longer contains`);
          continue;
        }
        claimed.add(id);
        members.push(part);
      }
      // Within an arc the chain still follows release order; `story` is where
      // a different narrative order is expressed, so the two never disagree
      // about which one the Must Watch chain encodes.
      grouped.push(sortByRelease(members));
    }

    const unclaimed = chainable.filter((p) => !claimed.has(p.id));
    if (unclaimed.length > 0) {
      warnings.push(
        `collection ${collectionId}: ${unclaimed.length} part(s) not named in any arc ` +
          `(${unclaimed.map((p) => p.id).join(", ")}) — treated as loose`,
      );
    }

    // A one-part arc is a deliberate "this stands alone" marker, not a chain.
    arcs = grouped.filter((a) => a.length >= 2);
    loose = [...ordered.filter((p) => excluded.has(p.id)), ...grouped.filter((a) => a.length < 2).flat(), ...unclaimed];
  } else {
    classification = "chain";
    arcs = chainable.length >= 2 ? [chainable] : [];
    loose = [...ordered.filter((p) => excluded.has(p.id)), ...(chainable.length < 2 ? chainable : [])];
  }

  const must: PlannedMustEdge[] = [];
  for (const arc of arcs) {
    for (let i = 0; i < arc.length - 1; i += 1) {
      const earlier = arc[i];
      const later = arc[i + 1];
      if (earlier.id === later.id) continue;
      // A prerequisite cannot be unreleased. Drops the pair rather than only
      // the 'before' half, so the reciprocal never claims a continuation from
      // a film nobody can watch yet either.
      if (isUnreleased(earlier.releaseDate, today)) continue;
      must.push({ earlier, later });
    }
  }

  // Loose parts still deserve to be findable from their siblings — just never
  // as a prerequisite. Emitted in both directions so the link exists from
  // whichever title the reader is actually looking at.
  const can: PlannedCanEdge[] = [];
  const seen = new Set<string>();
  const positions = new Map(ordered.map((p, i) => [p.id, i]));

  for (const part of loose) {
    const index = positions.get(part.id);
    if (index === undefined) continue;
    for (const sibling of nearestSiblings(ordered, index, MAX_CAN_NEIGHBOURS)) {
      // An excluded spin-off is described as one from both ends; two loose
      // entries of an episodic collection are just siblings.
      const reason = excluded.has(part.id) || excluded.has(sibling.id) ? SIDE_STORY_REASON : SAME_SERIES_REASON;
      for (const [from, to] of [
        [part, sibling],
        [sibling, part],
      ] as const) {
        const key = `${from.id}:${to.id}`;
        if (from.id === to.id || seen.has(key)) continue;
        seen.add(key);
        can.push({ from, to, reason });
      }
    }
  }

  return { classification, arcs, loose, must, can, warnings };
}

/** Narrative position of a title within its franchise, for the connections
 *  view's Story-order toggle. Flat across collections because a chain never
 *  spans two of them, so a single global map is enough and needs no
 *  collection lookup at the call site.
 *
 *  Undefined for the overwhelming majority of titles — release order is the
 *  default and only differs where a prequel, a mid-quel, or a deliberately
 *  out-of-order entry exists. */
const STORY_RANKS: Map<number, number> = (() => {
  const ranks = new Map<number, number>();
  for (const shape of Object.values(SHAPES)) {
    shape.story?.forEach((id, index) => ranks.set(id, index));
  }
  return ranks;
})();

export function storyRank(tmdbId: number): number | undefined {
  return STORY_RANKS.get(tmdbId);
}

/** True when at least one of these titles has a curated narrative order that
 *  differs from release order — i.e. offering the Story-order toggle would
 *  actually change something. */
export function hasStoryOrder(tmdbIds: number[]): boolean {
  return tmdbIds.some((id) => STORY_RANKS.has(id));
}

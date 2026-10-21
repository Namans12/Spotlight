// Every Qloo call the service makes is encoded here and nowhere else: which
// harness tool, which argument keys, how to read the reply. Qloo silently
// ignores parameters it does not recognise (a wrong key gives an empty 200,
// not an error), so a typo in a recipe looks exactly like "no data". Keeping
// them in one file means a live check against Qloo has one place to fix.
//
// What the recipes were built from (the first version had no Qloo key; the
// live spike of 2026-10-21 then checked them against the hackathon host):
//   - tool names and argument schemas: `tools/list` of `qloo mcp` from
//     @qloo/qloo-harness 0.1.26, which runs without a key;
//   - reply envelope and per-tool result fields: that package's
//     dist/qloo-tools.js (compactEntity, compactTag, the where_popular,
//     entity_tags, audience_demographics and trends handlers);
//   - raw Qloo response fields the harness passes through untouched
//     (heatmap location/query, demographics query, trending points) and the
//     two REST lookups.
//
// VERIFIED LIVE (2026-10-21):
//   - where_popular heatmap: cells carry lat, lon and geohash plus
//     query.affinity and query.popularity, as `heatmap` reads them.
//   - recommend for places and artists, including the include_tags filters.
//   - recommend for brands filtered to include_tags
//     ["urn:tag:genre:brand:food_and_beverage"] returns food and drink brands;
//     unfiltered it returns luxury cars and tech for a food business.
//   - entity_tags of venues (`tagsOfVenues`): the tags come in families, and
//     only some describe food (see FOOD_TAG_PREFIXES); the rest is noise.
//   - find_tags (`findTags`), and the IMDb id to entity lookup via /entities.
//   - audience_demographics for established titles.
//
// UNVERIFIED, or verified to come back empty:
//   - trends: empty for every title tried. The point shape and the date and
//     percentile field names remain guesses (see trendPoint); the window (90
//     days) is our choice. The SPA hides a trend section that is not ok.
//   - demographics: ok-with-no-rows (so `empty`) for brand-new releases.
//   - venue lat/lon and tags: the harness's place rows carry an address but
//     no coordinates and no tags, so Venue.lat/lon are null and Venue.tags is [].
//   - findTags: the harness tool has no parent-type argument, so place/brand
//     scoping is a local filter on the returned tag id/type.
//   - searchTitles: the /search REST path, params and entity shape.
//   - EVERY call keyed on one title (heatmap, demographics, trends, venues,
//     place themes, artists, brands) can be rejected with an HTTP 400
//     QLOO_CONTRACT for a thin-signal title (obscure or brand-new, little taste
//     data); the client maps that to `empty` rather than an error. The harness
//     uses QLOO_CONTRACT for every HTTP 400, so a circuit guard in client.ts
//     turns the mapping off for a call name rejected on 90% of its last 20
//     calls: that is a broken recipe, not a thin-signal title.
//   - the hackathon base URL (see harness.ts) works with the harness.

import type {
  AgeBucket, DemographicsData, HeatCell, NamedEntity, TagAffinity, Venue,
} from "../../../../shared/types/pulse.js";
import type { City } from "../cities.js";
import type { QlooEntityRef } from "./client.js";

// ---- per-call provenance text -------------------------------------------

// What each call can and cannot tell a reader. Fixed per call, not computed,
// so the wording a user sees was reviewed rather than generated.
const LIMITS: Record<string, string> = {
  audience_demographics: "Global audience skew relative to average, not specific to this city; not a percentage.",
  where_popular: "Affinity is comparable only within this query and city; top cells only (the harness keeps 20).",
  recommend_places: "Venues are what fans of this title in this city over-index on, not endorsements or a count of visitors.",
  entity_tags: "Tags describe the venues recommended for this title in this city; affinity is relative within this query, not a share of venues.",
  recommend_artists: "Artists are what fans of this title over-index on, not listening counts or an endorsement.",
  recommend_brands: "Food & beverage brands that fans of this title over-index on, not endorsements or sales figures.",
  trends: "A recent popularity percentile as Qloo reports it; not viewership, sales or a forecast.",
};
const DEFAULT_LIMITS = "Qloo affinity is relative to this query only; it is not a count or a percentage of people.";

export function limitsFor(call: string): string {
  return LIMITS[call] ?? DEFAULT_LIMITS;
}

// ---- small readers over untrusted JSON -----------------------------------

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const rec = (v: unknown): Rec => (isRec(v) ? v : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

// ---- harness tool recipes ------------------------------------------------

export const THIN_SIGNAL_NOTE = "Qloo doesn't have enough taste data on this title yet to suggest this.";
export const HEATMAP_THIN_SIGNAL_NOTE = "Qloo doesn't have enough local taste data on this title yet to map where its fans are.";

/** Brand-new releases come back ok with no rows; say why. */
export const DEMOGRAPHICS_EMPTY_NOTE =
  "Qloo doesn't have an audience profile for this title yet \u2014 common for releases that haven't been out long.";

export interface ToolRecipe<T> {
  /** Provenance name; also selects the limits text. */
  call: string;
  tool: string;
  args: Record<string, unknown>;
  /** Shown to the user as provenance; no names, emails or personal ids. */
  params: Record<string, string>;
  pick: (results: unknown[]) => T;
  /** What a QLOO_CONTRACT rejection of this call means to a reader; the client
   *  falls back to THIN_SIGNAL_NOTE. */
  thinSignalNote?: string;
  /** Replaces the harness's own words when the call is simply empty. */
  emptyNote?: string;
  /** For tools whose rows are not under `results` (trends puts them in `series`). */
  envelope?: (raw: unknown) => unknown;
}

const AGE_BUCKETS: AgeBucket[] = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];

export function demographics(entityId: string): ToolRecipe<DemographicsData> {
  return {
    call: "audience_demographics",
    tool: "qloo_audience_demographics",
    // entity_type is optional and a UUID resolves without it, so the
    // title's type need not be known here.
    args: { entity: entityId },
    params: { entity_id: entityId },
    emptyNote: DEMOGRAPHICS_EMPTY_NOTE,
    pick(results) {
      for (const item of results) {
        const q = rec(rec(item).query);
        const age = rec(q.age);
        const gender = rec(q.gender);
        const buckets = AGE_BUCKETS.map((b) => [b, num(age[b])] as const);
        const male = num(gender.male);
        const female = num(gender.female);
        if (buckets.every(([, v]) => v !== null) && male !== null && female !== null) {
          return { age: Object.fromEntries(buckets) as Record<AgeBucket, number>, gender: { male, female } };
        }
      }
      throw new Error("no demographics row had all six age buckets and both genders");
    },
  };
}

export function heatmap(entityId: string, city: City): ToolRecipe<Omit<HeatCell, "neighbourhood">[]> {
  return {
    call: "where_popular",
    tool: "qloo_where_popular",
    // The harness keeps 20 cells at most, whatever `limit` says.
    args: { entity: entityId, within: city.qlooLocationQuery, limit: 20 },
    params: { entity_id: entityId, within: city.qlooLocationQuery },
    thinSignalNote: HEATMAP_THIN_SIGNAL_NOTE,
    pick(results) {
      const cells = results.flatMap((point) => {
        const p = rec(point);
        const loc = rec(p.location);
        const q = rec(p.query);
        const lat = num(loc.latitude ?? loc.lat);
        const lon = num(loc.longitude ?? loc.lon);
        const geohash = str(loc.geohash);
        const affinity = num(q.affinity);
        const popularity = num(q.popularity);
        return lat !== null && lon !== null && geohash && affinity !== null && popularity !== null
          ? [{ lat, lon, geohash, affinity, popularity }]
          : [];
      });
      if (cells.length === 0) throw new Error("no heatmap cell had lat, lon, geohash, affinity and popularity");
      return cells;
    },
  };
}

function venue(item: unknown): Venue | null {
  const e = rec(item);
  const entityId = str(e.entity_id ?? e.id);
  const name = str(e.name);
  if (!entityId || !name) return null;
  const props = rec(e.properties);
  const geo = rec(props.geocode);
  return {
    entityId,
    name,
    address: str(props.address),
    lat: num(geo.latitude ?? geo.lat),
    lon: num(geo.longitude ?? geo.lon),
    priceLevel: num(props.price_level),
    // The harness's compactEntity drops the entity's tags, so there are none
    // to report; the tag ids we filtered by are not a claim about each venue.
    tags: [],
    affinity: num(e.affinity),
  };
}

const venues = (results: unknown[]): Venue[] => results.flatMap((r) => { const v = venue(r); return v ? [v] : []; });

const venueKey = (v: Venue): string | null => {
  const name = v.name.trim().toLowerCase();
  const address = v.address?.trim().toLowerCase();
  // Without an address two same-named venues cannot be told apart from two
  // branches of one chain, so they are left alone.
  return name && address ? `${name}\u0000${address}` : null;
};

/** Qloo can return one venue as two entities. Venues with the same name and
 *  the same address (case and padding aside) collapse to the one with the
 *  higher affinity (a missing affinity is the lowest), in the position of the
 *  first copy. Runs before any cap, so a duplicate does not cost a slot. */
export function dedupeVenues(list: Venue[]): Venue[] {
  const best = new Map<string, Venue>();
  const out: (Venue | string)[] = [];
  for (const v of list) {
    const k = venueKey(v);
    if (k === null) { out.push(v); continue; }
    const held = best.get(k);
    if (!held) { best.set(k, v); out.push(k); continue; }
    if ((v.affinity ?? -Infinity) > (held.affinity ?? -Infinity)) best.set(k, v);
  }
  return out.map((x) => (typeof x === "string" ? best.get(x)! : x));
}

// qloo_recommend accepts 1-10 include_tags; more is rejected outright, which
// would turn the whole section into an error. Empty means "no filter".
const MAX_INCLUDE_TAGS = 10;

export function places(entityId: string, city: City, tagIds: string[]): ToolRecipe<Venue[]> {
  const includeTagIds = tagIds.slice(0, MAX_INCLUDE_TAGS);
  return {
    call: "recommend_places",
    tool: "qloo_recommend",
    args: {
      target_type: "place",
      signals: [entityId],
      filter_location: city.qlooLocationQuery,
      ...(includeTagIds.length > 0 ? { include_tags: includeTagIds } : {}),
      limit: 20,
      explain: false,
    },
    params: {
      entity_id: entityId,
      filter_location: city.qlooLocationQuery,
      ...(includeTagIds.length > 0 ? { include_tags: includeTagIds.join(",") } : {}),
    },
    pick: (results) => dedupeVenues(venues(results)),
  };
}

/** Step one of placeTags: which venues fans of this title go to in this city. */
export function venuesToTag(entityId: string, city: City): ToolRecipe<string[]> {
  const base = places(entityId, city, []);
  return {
    ...base,
    args: { ...base.args, limit: 10 },
    // One venue can come back as two rows; each id is worth one tag-lookup slot.
    pick: (results) => [...new Set(venues(results).map((v) => v.entityId))],
  };
}

function tagAffinity(item: unknown): TagAffinity | null {
  const t = rec(item);
  const tagId = str(t.id ?? t.tag_id);
  const name = str(t.name);
  return tagId && name ? { tagId, name, affinity: num(t.affinity ?? rec(t.query).affinity) } : null;
}

/** Step two of placeTags: the tags that jointly characterise those venues. */
export function tagsOfVenues(venueIds: string[]): ToolRecipe<TagAffinity[]> {
  return {
    call: "entity_tags",
    tool: "qloo_entity_tags",
    args: { entities: venueIds.slice(0, 10), entity_type: "place", limit: 20 },
    params: { entity_count: String(Math.min(venueIds.length, 10)), entity_type: "place" },
    pick: (results) => results.flatMap((r) => { const t = tagAffinity(r); return t ? [t] : []; }),
  };
}

/** The tag families that describe what a place serves. Real venue entity-tags
 *  also carry a lot of noise (keyword, hobby, category, archetype, decor,
 *  amenity, hotel_rating, credit_card, genre:brand/music/media, ...) that says
 *  nothing about food and drink. Matched as an id PREFIX, never a substring. */
export const FOOD_TAG_PREFIXES = [
  "urn:tag:specialty_dish:place:",
  "urn:tag:genre:place:",
  "urn:tag:cuisine:qloo:",
  "urn:tag:dining_option:qloo:",
  "urn:tag:popular_food_item:qloo:",
] as const;
export const MAX_THEMES = 12;

/** Food-family tags only, one per lowercased name (the highest affinity wins),
 *  strongest first (a missing affinity last), at most MAX_THEMES. */
export function foodThemes(tags: TagAffinity[]): TagAffinity[] {
  const score = (t: TagAffinity) => t.affinity ?? -Infinity;
  const byName = new Map<string, TagAffinity>();
  for (const t of tags) {
    if (!FOOD_TAG_PREFIXES.some((p) => t.tagId.startsWith(p))) continue;
    const k = t.name.trim().toLowerCase();
    const held = byName.get(k);
    if (!held || score(t) > score(held)) byName.set(k, t);
  }
  // Array.sort is stable, so equal affinities keep Qloo's order.
  return [...byName.values()].sort((a, b) => score(b) - score(a)).slice(0, MAX_THEMES);
}

function namedEntities(results: unknown[]): NamedEntity[] {
  return results.flatMap((r) => {
    const e = rec(r);
    const entityId = str(e.entity_id ?? e.id);
    const name = str(e.name);
    return entityId && name ? [{ entityId, name, affinity: num(e.affinity) }] : [];
  });
}

/** Verified live 2026-10-21: with this include_tags, qloo_recommend for
 *  target_type "brand" returns food & drink brands; without it a food
 *  business is shown luxury cars and tech. */
export const BRAND_FOOD_TAG = "urn:tag:genre:brand:food_and_beverage";

function recommendFor(kind: "artist" | "brand", entityId: string, includeTags: string[] = []): ToolRecipe<NamedEntity[]> {
  return {
    call: `recommend_${kind}s`,
    tool: "qloo_recommend",
    args: {
      target_type: kind,
      signals: [entityId],
      ...(includeTags.length > 0 ? { include_tags: includeTags } : {}),
      limit: 10,
      explain: false,
    },
    params: { entity_id: entityId, target_type: kind, ...(includeTags.length > 0 ? { include_tags: includeTags.join(",") } : {}) },
    pick: namedEntities,
  };
}
export const artists = (entityId: string) => recommendFor("artist", entityId);
export const brands = (entityId: string) => recommendFor("brand", entityId, [BRAND_FOOD_TAG]);

/** The title's own type, which qloo_trends requires and the client's
 *  interface does not carry. */
export function describeType(entityId: string): ToolRecipe<"movie" | "tv_show" | null> {
  return {
    call: "describe",
    tool: "qloo_describe",
    args: { entity: entityId },
    params: { entity_id: entityId },
    pick: (results) => titleType(rec(results[0]).type),
  };
}

function trendPoint(p: unknown): { date: string; percentile: number } | null {
  const o = rec(p);
  const q = rec(o.query);
  const date = str(o.date ?? q.date);
  const percentile = num(o.percentile ?? q.popularity_percentile ?? q.percentile);
  return date && percentile !== null ? { date, percentile } : null;
}

const DAY_MS = 86_400_000;
const TREND_WINDOW_DAYS = 90;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function trends(entityId: string, type: "movie" | "tv_show", now: Date): ToolRecipe<{ date: string; percentile: number }[]> {
  const start = isoDay(new Date(now.getTime() - TREND_WINDOW_DAYS * DAY_MS));
  const end = isoDay(now);
  return {
    call: "trends",
    tool: "qloo_trends",
    args: { entities: [entityId], entity_type: type, start_date: start, end_date: end, limit: 20 },
    params: { entity_id: entityId, entity_type: type, start_date: start, end_date: end },
    // One entity in, so one series out; its points are the rows.
    envelope(raw) {
      const r = rec(raw);
      const series = Array.isArray(r.series) ? r.series : [];
      return { ...r, results: series.flatMap((s) => (Array.isArray(rec(s).points) ? (rec(s).points as unknown[]) : [])) };
    },
    pick(results) {
      const points = results.flatMap((r) => { const t = trendPoint(r); return t ? [t] : []; });
      if (points.length === 0) throw new Error("no trend point had a date and a percentile");
      return points;
    },
  };
}

export function findTags(query: string, parentType: "place" | "brand"): ToolRecipe<{ tagId: string; name: string }[]> {
  return {
    call: "find_tags",
    tool: "qloo_find_tags",
    args: { query, limit: 20 },
    params: { query, parent_type: parentType },
    // The tool cannot scope by parent type, so keep tags whose urn or type
    // has that segment (urn:tag:genre:place:..., urn:tag:category:place:...).
    pick: (results) => results.flatMap((r) => {
      const t = tagAffinity(r);
      const scope = `${str(rec(r).id) ?? ""} ${str(rec(r).type) ?? ""}`;
      return t && scope.includes(`:${parentType}`) ? [{ tagId: t.tagId, name: t.name }] : [];
    }),
  };
}

// ---- REST lookups the harness has no workflow for ------------------------

const ENTITY_URN: Record<"movie" | "tv_show", string> = { movie: "urn:entity:movie", tv_show: "urn:entity:tv_show" };

function titleType(v: unknown): "movie" | "tv_show" | null {
  const raw = Array.isArray(v) ? v.find((x) => typeof x === "string") : v;
  return raw === ENTITY_URN.movie || raw === "movie" ? "movie" : raw === ENTITY_URN.tv_show || raw === "tv_show" ? "tv_show" : null;
}

export const entityByImdbRequest = (imdbId: string) => ({ path: "/entities", params: { "external.imdb.ids": imdbId } });
export const searchTitlesRequest = (title: string, type: "movie" | "tv_show") => ({
  path: "/search",
  params: { query: title, types: ENTITY_URN[type], take: "5" },
});

/** Entity rows from either body shape (`results: []` or `results.entities`). */
function entityRows(body: unknown): unknown[] {
  const results = rec(body).results;
  if (Array.isArray(results)) return results;
  const nested = rec(results).entities;
  return Array.isArray(nested) ? nested : [];
}

function year(props: Rec): number | null {
  const y = num(props.release_year);
  if (y !== null) return y;
  const m = /^(\d{4})/.exec(str(props.release_date) ?? "");
  return m ? Number(m[1]) : null;
}

export function parseEntityRefs(body: unknown): QlooEntityRef[] {
  return entityRows(body).flatMap((row) => {
    const e = rec(row);
    const entityId = str(e.entity_id ?? e.id);
    const name = str(e.name);
    const type = titleType(e.type ?? e.types);
    return entityId && name && type ? [{ entityId, name, type, year: year(rec(e.properties)) }] : [];
  });
}

/** Qloo ignores parameters it does not know, so an unrecognised lookup key
 *  would return an arbitrary entity. If the row names IMDb ids at all and
 *  ours is not among them, it is the wrong title. */
export function namesDifferentImdbId(row: unknown, imdbId: string): boolean {
  const ids: string[] = JSON.stringify(row).match(/tt\d{6,}/g) ?? [];
  return ids.length > 0 && !ids.includes(imdbId);
}

export function parseImdbMatch(body: unknown, imdbId: string): QlooEntityRef | null {
  const rows = entityRows(body);
  for (const row of rows) {
    if (namesDifferentImdbId(row, imdbId)) continue;
    const [ref] = parseEntityRefs({ results: [row] });
    if (ref) return ref;
  }
  return null;
}

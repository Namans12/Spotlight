// Every Qloo call the service makes is encoded here and nowhere else: which
// harness tool, which argument keys, how to read the reply. Qloo silently
// ignores parameters it does not recognise (a wrong key gives an empty 200,
// not an error), so a typo in a recipe looks exactly like "no data". Keeping
// them in one file means a live check against Qloo has one place to fix.
//
// What the recipes were built from (no Qloo key was available, and none of
// this has touched live Qloo):
//   - tool names and argument schemas: `tools/list` of `qloo mcp` from
//     @qloo/qloo-harness 0.1.26, which runs without a key;
//   - reply envelope and per-tool result fields: that package's
//     dist/qloo-tools.js (compactEntity, compactTag, the where_popular,
//     entity_tags, audience_demographics and trends handlers);
//   - raw Qloo response fields the harness passes through untouched
//     (heatmap location/query, demographics query, trending points) and the
//     two REST lookups: Qloo's documentation, as remembered, not the package.
//
// UNVERIFIED against live data (the Task 1 spike must check each):
//   - heatmap:   point shape {location:{geohash,latitude,longitude},
//                query:{affinity,popularity}}.
//   - demographics: result shape {query:{age:{<AgeBucket>:n},gender:{male,female}}}.
//   - places:    the harness drops entity `location` and `tags`, so lat/lon
//                come only from properties.geocode if present and tags are
//                always empty; the include_tags URNs from findTags must be
//                accepted by recommend for target_type place.
//   - placeTags: a two-step derivation (recommend venues, then entity_tags of
//                those venues); there is no single place-tags-for-a-city tool.
//   - trends:    point shape; the date and percentile field names are guesses
//                (see trendPoint). The window (90 days) is our choice.
//   - findTags:  the harness tool has no parent-type argument, so place/brand
//                scoping is a local filter on the returned tag id/type.
//   - entityByImdb / searchTitles: the REST paths, params and entity shape.
//   - the hackathon base URL (see harness.ts), and that its key works with
//     the harness at all.

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
  recommend_brands: "Brands are what fans of this title over-index on, not sales, sponsorship or an endorsement.",
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

export interface ToolRecipe<T> {
  /** Provenance name; also selects the limits text. */
  call: string;
  tool: string;
  args: Record<string, unknown>;
  /** Shown to the user as provenance; no names, emails or personal ids. */
  params: Record<string, string>;
  pick: (results: unknown[]) => T;
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
    pick: venues,
  };
}

/** Step one of placeTags: which venues fans of this title go to in this city. */
export function venuesToTag(entityId: string, city: City): ToolRecipe<string[]> {
  const base = places(entityId, city, []);
  return {
    ...base,
    args: { ...base.args, limit: 10 },
    pick: (results) => venues(results).map((v) => v.entityId),
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

function namedEntities(results: unknown[]): NamedEntity[] {
  return results.flatMap((r) => {
    const e = rec(r);
    const entityId = str(e.entity_id ?? e.id);
    const name = str(e.name);
    return entityId && name ? [{ entityId, name, affinity: num(e.affinity) }] : [];
  });
}

function recommendFor(kind: "artist" | "brand", entityId: string): ToolRecipe<NamedEntity[]> {
  return {
    call: `recommend_${kind}s`,
    tool: "qloo_recommend",
    args: { target_type: kind, signals: [entityId], limit: 10, explain: false },
    params: { entity_id: entityId, target_type: kind },
    pick: namedEntities,
  };
}
export const artists = (entityId: string) => recommendFor("artist", entityId);
export const brands = (entityId: string) => recommendFor("brand", entityId);

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

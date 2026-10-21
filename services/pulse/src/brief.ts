// Assembles a release brief and yields it section by section, as each one
// finishes, so the page can fill in while the slow Qloo calls are still out.

import type {
  BriefEvent, BriefHeader, BriefSectionKey, BusinessType, EvidenceSection, HeatCell, LocalHook, Provenance, Venue,
} from "../../../shared/types/pulse.js";
import { BUSINESS_TYPES, filterVenues } from "./businessTypes.js";
import type { City } from "./cities.js";
import type { EvidenceSql } from "./db/evidence.js";
import { getNeighbourhoods, getTitleLocations, type LocationsSql } from "./db/locations.js";
import { getEvidence, type EvidenceKind, type GetEvidenceOptions } from "./evidence.js";
import { labelCell } from "./geo.js";
import type { QlooClient } from "./qloo/client.js";
import { RateLimitedError } from "./qloo/limiter.js";
import type { Resolution, TitleKey } from "./resolve.js";

export interface TitleSummary { title: string; posterUrl: string | null; releaseDate: string | null }

export interface CampaignContext {
  sections: Partial<Record<BriefSectionKey, EvidenceSection<unknown>>>;
  header: BriefHeader;
  businessType: BusinessType;
  /** The caller's hashed session (see usage.ts sessionKey), for the usage cap. */
  session?: string;
}
export type DraftCampaign = (ctx: CampaignContext) => Promise<EvidenceSection<unknown>>;

export interface BriefDeps {
  sql: EvidenceSql & LocationsSql;
  qloo: QlooClient;
  resolve: (key: TitleKey) => Promise<Resolution>;
  /** Title, poster and date for the header; null when no source knows the title. */
  header: (key: TitleKey) => Promise<TitleSummary | null>;
  draftCampaign: DraftCampaign;
  now?: () => Date;
  /** Where the real cause of a failed section goes. The section itself only
   *  ever carries a fixed, human sentence. */
  onError?: (context: string, err: unknown) => void;
}

export interface BriefRequest {
  city: City;
  businessType: BusinessType;
  key: TitleKey;
  /** Hashed session of the caller, passed through to the campaign drafter. */
  session?: string;
  /** Aborted when the client has gone; remaining work is skipped. */
  signal?: AbortSignal;
}

export const NO_ENTITY_NOTE = "Qloo has no entity for this title yet, so there is no taste data for it.";
export const RESOLVE_FAILED_NOTE = "Qloo could not be reached to look this title up, so there is no taste data for it right now. Try again shortly.";
const RATE_LIMITED_NOTE = "Qloo is busy and rate limiting requests, so this section is missing. Try again in a moment.";
const GENERIC_ERROR_NOTE = "This section could not be loaded just now. Try again shortly.";
/** Shared with plan-night, which filters its venues by place tags the same way. */
export const BROAD_VENUES_NOTE = "Venue category filter was unavailable; results are broader than usual.";
const HOOK_LIMITS =
  "Built from public Wikipedia categories and Wikidata. Coverage varies by title, and India coverage is partial, so a missing record does not mean the title was not shot or set here.";

// Error sections this module builds carry notes written here, so they are
// exempt from the rewrite below; one that arrives from a client or drafter is not.
const ownErrors = new WeakSet<object>();
export const errorSection = (note: string): EvidenceSection<unknown> => {
  const s: EvidenceSection<unknown> = { status: "error", data: null, provenance: [], note };
  ownErrors.add(s);
  return s;
};
export const emptySection = (note: string): EvidenceSection<unknown> => ({ status: "empty", data: null, provenance: [], note });

/** The real Qloo client reports a failure as an error SECTION whose note is
 *  "Qloo call failed: <upstream text>", and the campaign drafter may do the
 *  same with a model provider's text. Neither belongs in a public stream, so
 *  the note becomes a fixed sentence and the original goes to the log. */
export function sanitiseError(section: EvidenceSection<unknown>, context: string, report: (c: string, e: unknown) => void): EvidenceSection<unknown> {
  if (section.status !== "error" || ownErrors.has(section)) return section;
  const original = section.note ?? "";
  report(context, new Error(original || "error section without a note"));
  return { ...section, note: /rate.?limit|429|busy/i.test(original) ? RATE_LIMITED_NOTE : GENERIC_ERROR_NOTE };
}

export function noteFor(err: unknown): string {
  return err instanceof RateLimitedError ? RATE_LIMITED_NOTE : GENERIC_ERROR_NOTE;
}

// Tag-id lookups (shared by the brief and plan-night) never change within a process's lifetime in practice and cost
// a Qloo call each, so they are remembered per client. A failed lookup is not
// remembered: that would turn one blip into permanently untagged venues.
export const TAGS_PER_QUERY = 2;
const tagMemo = new WeakMap<QlooClient, Map<string, Promise<string[]>>>();

export async function placeTagIds(qloo: QlooClient, queries: string[], onError: (c: string, e: unknown) => void): Promise<{ ids: string[]; failed: boolean }> {
  let memo = tagMemo.get(qloo);
  if (!memo) tagMemo.set(qloo, (memo = new Map()));
  const m = memo;
  let failed = false;
  const perQuery = await Promise.all(queries.map((q) => {
    let p = m.get(q);
    if (!p) {
      p = qloo.findTags(q, "place").then((tags) => tags.slice(0, TAGS_PER_QUERY).map((t) => t.tagId));
      m.set(q, p);
      p.catch((err) => { m.delete(q); onError(`findTags(${q})`, err); });
    }
    return p.catch(() => { failed = true; return [] as string[]; });
  }));
  return { ids: [...new Set(perQuery.flat())], failed };
}

/** The Qloo calls behind the heatmap and place-tag sections. The board's
 *  background warming fetches exactly these, so what it caches is what a brief
 *  for the same title and city will read, with no second copy of the call. */
export const fetchHeatmap = (qloo: QlooClient, city: City, entityId: string) => qloo.heatmap(entityId, city);
export const fetchPlaceTags = (qloo: QlooClient, city: City, entityId: string) => qloo.placeTags(entityId, city);

type Hood = Awaited<ReturnType<typeof getNeighbourhoods>>[number];
type RawCell = Omit<HeatCell, "neighbourhood">;

function sourceEntries(rows: { kind: string; source: string }[], citySlug: string): Provenance[] {
  const seen = new Map<string, Provenance>();
  for (const r of rows) {
    for (const source of r.source === "both" ? (["wikipedia", "wikidata"] as const) : [r.source as "wikipedia" | "wikidata"]) {
      const k = `${source}:${r.kind}`;
      if (!seen.has(k)) seen.set(k, { source, call: "title_locations", params: { city: citySlug, kind: r.kind }, limits: HOOK_LIMITS });
    }
  }
  return [...seen.values()].sort((a, b) => (a.source + a.params.kind).localeCompare(b.source + b.params.kind));
}

/** Header first, then every section of the business type except the campaign
 *  as each completes, then the campaign (which is drafted from the others),
 *  then `done`. Nothing in here throws: a failure becomes an error section. */
export async function* streamBrief(deps: BriefDeps, req: BriefRequest): AsyncGenerator<BriefEvent> {
  const { city, businessType, key, signal, session } = req;
  const { sql, qloo } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const report = (context: string, err: unknown) => {
    try { deps.onError?.(context, err); } catch { /* a broken logger must not break the stream */ }
  };
  const spec = BUSINESS_TYPES[businessType];

  // Resolution and the header lookup are independent, so they overlap.
  const [resolution, summary] = await Promise.all([
    deps.resolve(key).catch((err): { failed: true } => { report("resolveTitle", err); return { failed: true }; }),
    deps.header(key).catch((err) => { report("header", err); return null; }),
  ]);
  const resolveFailed = "failed" in resolution;
  const entityId = !resolveFailed && resolution.entityId ? resolution.entityId : null;

  const header: BriefHeader = {
    tmdbId: key.tmdbId,
    mediaType: key.mediaType,
    title: summary?.title ?? "Untitled",
    posterUrl: summary?.posterUrl ?? null,
    releaseDate: summary?.releaseDate ?? null,
    city: city.slug,
    cityName: city.name,
    businessType,
    qlooEntityId: entityId,
  };
  yield { type: "header", header };

  /** A Qloo-backed section, cached per (entity, city, kind). */
  const cachedQloo = <T>(kind: EvidenceKind, withCity: boolean, fetch: (id: string) => Promise<EvidenceSection<T>>, opts: GetEvidenceOptions = {}) =>
    async (): Promise<EvidenceSection<unknown>> => {
      if (resolveFailed) return errorSection(RESOLVE_FAILED_NOTE);
      if (!entityId) return emptySection(NO_ENTITY_NOTE);
      return getEvidence(sql, kind, entityId, withCity ? city : null, () => fetch(entityId), now(), opts);
    };

  const runners: Partial<Record<BriefSectionKey, () => Promise<EvidenceSection<unknown>>>> = {
    who: cachedQloo("demographics", false, (id) => qloo.demographics(id)),

    where: async () => {
      const raw = await cachedQloo<RawCell[]>("heatmap", true, (id) => fetchHeatmap(qloo, city, id))();
      const cells = raw.data as RawCell[] | null;
      if (!cells) return raw;
      // Labels are applied here, not before caching, so improving the
      // neighbourhoods table improves labels without another Qloo call. A
      // failed read costs the labels, not the map.
      let hoods: Hood[] = [];
      try { hoods = await getNeighbourhoods(sql, city.slug); } catch (err) { report("neighbourhoods", err); }
      const labelled: HeatCell[] = cells.map((c) => ({ ...c, neighbourhood: labelCell(c, hoods) }));
      return { ...raw, data: labelled };
    },

    venues: async () => {
      let unfiltered = false;
      const raw = await cachedQloo<Venue[]>("places", true, async (id) => {
        // Looked up inside the fetch so a cache hit costs no tag calls.
        const tags = await placeTagIds(qloo, spec.placeTagQueries, report);
        const section = await qloo.places(id, city, tags.ids);
        if (!tags.failed || section.status !== "ok") return section;
        // Without its tag filter Qloo answers more broadly. Say so, and do
        // not cache it: the next brief should retry the tags, not inherit
        // three days of the stopgap.
        unfiltered = true;
        return { ...section, status: "degraded", note: BROAD_VENUES_NOTE };
      }, { skipPersist: () => unfiltered })();
      const venues = raw.data as Venue[] | null;
      if (!venues) return raw;
      const kept = filterVenues(venues, spec.venueBlocklist);
      if (kept.length === 0) {
        return { status: "empty", data: null, provenance: raw.provenance, note: "Every match was a hotel, banquet hall or similar lodging venue, which this business type excludes." };
      }
      return { ...raw, data: kept };
    },

    themes: cachedQloo("place_tags", true, (id) => fetchPlaceTags(qloo, city, id)),
    artists: cachedQloo("artists", false, (id) => qloo.artists(id)),
    brands: cachedQloo("brands", false, (id) => qloo.brands(id)),
    trend: cachedQloo("trends", false, (id) => qloo.trends(id)),

    hook: async () => {
      const rows = await getTitleLocations(sql, key, city.slug);
      if (rows.length === 0) return emptySection(`No record of this title being shot or set in ${city.name}.`);
      const data: LocalHook[] = rows.map((r) => ({ kind: r.kind, placeName: city.name, landmark: r.landmark, source: r.source }));
      return { status: "ok", data, provenance: sourceEntries(rows, city.slug) };
    },
  };

  const collected: Partial<Record<BriefSectionKey, EvidenceSection<unknown>>> = {};
  const settled = (k: BriefSectionKey): Promise<[BriefSectionKey, EvidenceSection<unknown>]> => {
    const run = runners[k];
    // A section the business type lists but has no runner for is a bug here,
    // not an outage; say so plainly rather than stream nothing.
    const result = run
      ? run().then((s) => sanitiseError(s, `section ${k}`, report), (err) => { report(`section ${k}`, err); return errorSection(noteFor(err)); })
      : Promise.resolve(errorSection(GENERIC_ERROR_NOTE));
    return result.then((s) => [k, s]);
  };

  // Wake the merge loop when the client leaves, instead of waiting out the
  // slowest section for a reader who is gone.
  let onAbort = () => {};
  const aborted = new Promise<"aborted">((resolve) => {
    if (signal?.aborted) return resolve("aborted");
    onAbort = () => resolve("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
  });

  try {
    const pending = new Map<BriefSectionKey, ReturnType<typeof settled>>(
      spec.sections.filter((k) => k !== "campaign").map((k) => [k, settled(k)]),
    );
    while (pending.size > 0) {
      const next = await Promise.race([...pending.values(), aborted]);
      if (next === "aborted") return;
      const [k, section] = next;
      pending.delete(k);
      collected[k] = section;
      yield { type: "section", key: k, section };
    }

    if (spec.sections.includes("campaign")) {
      if (signal?.aborted) return;
      // Through a promise chain, so a drafter that throws before returning a
      // promise is caught the same way as one that rejects.
      const campaign = await Promise.resolve()
        .then(() => deps.draftCampaign({ sections: { ...collected }, header, businessType, session }))
        .then((s) => sanitiseError(s, "section campaign", report), (err) => { report("section campaign", err); return errorSection(noteFor(err)); });
      yield { type: "section", key: "campaign", section: campaign };
    }
    yield { type: "done" };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

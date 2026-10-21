// "Plan the night": the places and artists fans of a title over-index on in
// one city, for the title page's card. It reads the same Qloo evidence as the
// brief but asks a different question (no business type, so no tag filter),
// and is built from the brief's own fixed-sentence error handling so a Qloo or
// database failure is a section the page can show, never a 500.

import type { EvidenceSection, NamedEntity, PlanNightResponse, Venue } from "../../../shared/types/pulse.js";
import {
  emptySection, errorSection, noteFor, NO_ENTITY_NOTE, RESOLVE_FAILED_NOTE, sanitiseError, type BriefDeps,
} from "./brief.js";
import { BUSINESS_TYPES, filterVenues } from "./businessTypes.js";
import type { City } from "./cities.js";
import { getEvidence, type EvidenceKind } from "./evidence.js";
import type { TitleKey } from "./resolve.js";

export type PlanNightDeps = Pick<BriefDeps, "sql" | "qloo" | "resolve" | "header" | "now" | "onError">;

export const MAX_PLACES = 6;
export const MAX_ARTISTS = 5;

const ALL_LODGING = [...new Set(Object.values(BUSINESS_TYPES).flatMap((b) => b.venueBlocklist))];
const ONLY_LODGING_NOTE = "Every match was a hotel, banquet hall or similar lodging venue, which this card leaves out.";

/** Resolution and the header lookup are independent, so they overlap; then
 *  places (cached as `places_open`, unfiltered) and artists (the brief's
 *  city-independent `artists` row) are fetched through the evidence cache.
 *  Nothing in here throws. */
export async function buildPlanNight(deps: PlanNightDeps, req: { city: City; key: TitleKey }): Promise<PlanNightResponse> {
  const { city, key } = req;
  const { sql, qloo } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const report = (context: string, err: unknown) => {
    try { deps.onError?.(context, err); } catch { /* a broken logger must not break the response */ }
  };

  const [resolution, summary] = await Promise.all([
    deps.resolve(key).catch((err): { failed: true } => { report("resolveTitle", err); return { failed: true }; }),
    deps.header(key).catch((err) => { report("header", err); return null; }),
  ]);
  const title = summary?.title ?? null;
  const resolveFailed = "failed" in resolution;
  const entityId = !resolveFailed && resolution.entityId ? resolution.entityId : null;

  if (resolveFailed) {
    return { title, cityName: city.name, places: errorSection(RESOLVE_FAILED_NOTE) as EvidenceSection<Venue[]>, artists: errorSection(RESOLVE_FAILED_NOTE) as EvidenceSection<NamedEntity[]> };
  }
  if (!entityId) {
    return { title, cityName: city.name, places: emptySection(NO_ENTITY_NOTE) as EvidenceSection<Venue[]>, artists: emptySection(NO_ENTITY_NOTE) as EvidenceSection<NamedEntity[]> };
  }

  const section = async <T>(name: string, kind: EvidenceKind, withCity: boolean, fetch: () => Promise<EvidenceSection<T>>, shape: (s: EvidenceSection<T>) => EvidenceSection<T>): Promise<EvidenceSection<T>> => {
    try {
      const raw = await getEvidence(sql, kind, entityId, withCity ? city : null, fetch, now());
      return sanitiseError(shape(raw) as EvidenceSection<unknown>, `plan-night ${name}`, report) as EvidenceSection<T>;
    } catch (err) {
      report(`plan-night ${name}`, err);
      return errorSection(noteFor(err)) as EvidenceSection<T>;
    }
  };

  const [places, artists] = await Promise.all([
    // `places_open`, not `places`: no tag filter here, so the rows must not
    // share a cache key with the brief's tag-filtered venues (R36).
    section("places", "places_open", true, () => qloo.places(entityId, city, []), (raw) => {
      const venues = raw.data;
      if (!venues) return raw;
      const kept = filterVenues(venues, ALL_LODGING).slice(0, MAX_PLACES);
      if (kept.length > 0) return { ...raw, data: kept };
      return { status: "empty", data: null, provenance: raw.provenance, note: venues.length > 0 ? ONLY_LODGING_NOTE : raw.note };
    }),
    section("artists", "artists", false, () => qloo.artists(entityId), (raw) => (raw.data ? { ...raw, data: raw.data.slice(0, MAX_ARTISTS) } : raw)),
  ]);
  return { title, cityName: city.name, places, artists };
}

// The evidence cache in front of Qloo. Qloo is rate limited and its terms do
// not allow mirroring its data, so a section is asked for once and reused for
// three days; nothing here lists or exports the cache wholesale.

import type { EvidenceSection, EvidenceStatus } from "../../../shared/types/pulse.js";
import type { City } from "./cities.js";
import { readEvidence, upsertEvidence, type EvidenceSql } from "./db/evidence.js";

/** `places_open` is the unfiltered venue list behind "Plan the night". It has
 *  its own kind because the brief's `places` rows are narrowed by the business
 *  type's tag filter, and (entity, city, kind) is the cache key: sharing one
 *  kind would serve each feature the other's answer. qloo_evidence.kind has no
 *  CHECK constraint, so a new kind needs no migration. */
export type EvidenceKind = "board_rank" | "demographics" | "heatmap" | "places" | "places_open" | "place_tags" | "artists" | "brands" | "trends";

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_DAYS = 3;
/** Only an answer is worth keeping. `error` is an outage, and `needs_input` is
 *  a question rather than an answer; caching either would show a transient
 *  failure for three days after Qloo recovered. */
const CACHEABLE: readonly string[] = ["ok", "empty", "partial", "degraded"] satisfies EvidenceStatus[];

const citySlug = (city: City | null) => city?.slug ?? "";

function isFresh(status: string | null, fetchedAt: Date, now: Date): boolean {
  return status !== null && CACHEABLE.includes(status) && now.getTime() - fetchedAt.getTime() <= FRESH_DAYS * DAY_MS;
}

/** A cached section if one exists and is fresh and usable, else null. */
async function cached<T>(sql: EvidenceSql, kind: EvidenceKind, entityId: string, city: City | null, now: Date): Promise<EvidenceSection<T> | null> {
  const row = await readEvidence(sql, entityId, citySlug(city), kind);
  if (!row || !isFresh(row.status, row.fetchedAt, now)) return null;
  const p = row.payload as EvidenceSection<T> | null;
  // A payload that is not a section (hand-edited, or from an older shape) is a miss.
  return p && typeof p === "object" && typeof p.status === "string" ? p : null;
}

/** Cache read only; never calls Qloo. The board uses it to rank what is
 *  already known without spending Qloo calls on titles nobody opened. */
export function peekEvidence<T>(sql: EvidenceSql, kind: EvidenceKind, entityId: string, city: City | null, now: Date = new Date()): Promise<EvidenceSection<T> | null> {
  return cached<T>(sql, kind, entityId, city, now);
}

export interface GetEvidenceOptions {
  /** Called with the fetched section; true means "return it but do not store
   *  it", for a stopgap answer (e.g. venues fetched without their tag filter)
   *  that must not be served for three days. */
  skipPersist?: (section: EvidenceSection<never>) => boolean;
}

// Concurrent requests for one uncached question would each call Qloo, and the
// client's limiter queues them without re-checking the cache, so a burst on
// the public endpoint would multiply Qloo calls. Callers for the same key
// share one promise instead. The whole read-fetch-store sequence is inside it,
// so a caller arriving just as the first finishes still cannot slip between
// the cache read and the flight check.
const inFlight = new Map<string, Promise<EvidenceSection<unknown>>>();

/** Returns the cached section when fresh, else calls `fetch` and stores the
 *  answer. An `error` or `needs_input` result is returned to the caller but
 *  not stored, so it cannot displace an older good row or be served again.
 *  A fetch that throws propagates (to every sharer) and stores nothing. A
 *  failed cache WRITE is logged and ignored: the caller already holds a good
 *  answer. Concurrent calls for one (entity, city, kind) share one fetch, and
 *  so receive the first caller's result. */
export function getEvidence<T>(
  sql: EvidenceSql,
  kind: EvidenceKind,
  entityId: string,
  city: City | null,
  fetch: () => Promise<EvidenceSection<T>>,
  now: Date = new Date(),
  opts: GetEvidenceOptions = {},
): Promise<EvidenceSection<T>> {
  const flightKey = `${entityId}|${citySlug(city)}|${kind}`;
  const existing = inFlight.get(flightKey);
  if (existing) return existing as Promise<EvidenceSection<T>>;
  // Cleared on settle, rejection included, so a failure is retried by the next call.
  const p = readFetchStore(sql, kind, entityId, city, fetch, now, opts).finally(() => inFlight.delete(flightKey));
  inFlight.set(flightKey, p);
  return p;
}

async function readFetchStore<T>(
  sql: EvidenceSql,
  kind: EvidenceKind,
  entityId: string,
  city: City | null,
  fetch: () => Promise<EvidenceSection<T>>,
  now: Date,
  opts: GetEvidenceOptions,
): Promise<EvidenceSection<T>> {
  const hit = await cached<T>(sql, kind, entityId, city, now);
  if (hit) return hit;

  const section = await fetch();
  if (CACHEABLE.includes(section.status) && !opts.skipPersist?.(section as EvidenceSection<never>)) {
    try {
      await upsertEvidence(sql, {
        entityId,
        citySlug: citySlug(city),
        kind,
        params: section.provenance[0]?.params ?? {},
        status: section.status,
        payload: section,
        fetchedAt: now,
      });
    } catch (err) {
      console.error(`evidence cache write failed for ${kind}:`, err instanceof Error ? err.message : String(err));
    }
  }
  return section;
}

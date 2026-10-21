// The evidence cache in front of Qloo. Qloo is rate limited and its terms do
// not allow mirroring its data, so a section is asked for once and reused for
// three days; nothing here lists or exports the cache wholesale.

import type { EvidenceSection, EvidenceStatus } from "../../../shared/types/pulse.js";
import type { City } from "./cities.js";
import { readEvidence, upsertEvidence, type EvidenceSql } from "./db/evidence.js";

export type EvidenceKind = "demographics" | "heatmap" | "places" | "place_tags" | "artists" | "brands" | "trends";

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

/** Returns the cached section when fresh, else calls `fetch` and stores the
 *  answer. An `error` or `needs_input` result is returned to the caller but
 *  not stored, so it cannot displace an older good row or be served again.
 *  A fetch that throws propagates and stores nothing. A failed cache WRITE is
 *  logged and ignored: the caller already holds a good answer. */
export async function getEvidence<T>(
  sql: EvidenceSql,
  kind: EvidenceKind,
  entityId: string,
  city: City | null,
  fetch: () => Promise<EvidenceSection<T>>,
  now: Date = new Date(),
): Promise<EvidenceSection<T>> {
  const hit = await cached<T>(sql, kind, entityId, city, now);
  if (hit) return hit;

  const section = await fetch();
  if (CACHEABLE.includes(section.status)) {
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

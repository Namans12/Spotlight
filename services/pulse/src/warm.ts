// Warming: filling the evidence cache for the board ahead of the people who
// will look at it. The scheduled run (POST /warm, Wed and Fri after the
// release bot) covers every prewarm city; the board's own polling queues the
// titles it found missing, through a bounded queue so a poll can never turn
// into an unbounded pile of Qloo calls.

import type { BusinessType, EvidenceSection } from "../../../shared/types/pulse.js";
import { fetchHeatmap, fetchPlaceTags } from "./brief.js";
import { listCandidates, type BoardDeps, type BoardSql } from "./board.js";
import { fetchBoardRank } from "./boardRank.js";
import { getCachedEntities } from "./db/entities.js";
import { BUSINESS_TYPES } from "./businessTypes.js";
import { allCities, type City } from "./cities.js";
import { getEvidence, type EvidenceKind } from "./evidence.js";
import type { QlooClient } from "./qloo/client.js";
import type { Resolution, TitleKey } from "./resolve.js";

export interface WarmReport { warmed: number; failed: number }

export interface WarmDeps {
  sql: BoardSql;
  qloo: QlooClient;
  resolve: (key: TitleKey) => Promise<Resolution>;
  now?: () => Date;
  /** Where the real cause of a failure goes; the report only carries counts. */
  onError?: (context: string, err: unknown) => void;
}

const report = (deps: WarmDeps, context: string, err: unknown) => {
  try { deps.onError?.(context, err); } catch { /* a broken logger must not stop warming */ }
};

/** Resolves one title and fetches its heatmap and place tags for the city,
 *  through the same cache and fetch calls a brief uses. "warmed" means both
 *  kinds are now in the cache (freshly fetched or already fresh, an empty or
 *  degraded answer included). "failed" means something threw or Qloo
 *  reported an error, so the board will keep it pending and retry. A title
 *  Qloo definitely does not know is "warmed": the miss is cached and there
 *  is nothing further to fetch. Never throws. */
export async function warmTitle(deps: WarmDeps, city: City, key: TitleKey): Promise<"warmed" | "failed"> {
  let resolution: Resolution;
  try {
    resolution = await deps.resolve(key);
  } catch (err) {
    report(deps, `warm resolve ${key.mediaType}:${key.tmdbId}`, err);
    return "failed";
  }
  if (!resolution.entityId) return "warmed";
  const entityId = resolution.entityId;
  const now = deps.now ? deps.now() : new Date();

  const kinds: [EvidenceKind, () => Promise<EvidenceSection<unknown>>][] = [
    ["heatmap", () => fetchHeatmap(deps.qloo, city, entityId)],
    ["place_tags", () => fetchPlaceTags(deps.qloo, city, entityId)],
  ];
  const results = await Promise.all(kinds.map(async ([kind, fetch]) => {
    try {
      const section = await getEvidence(deps.sql, kind, entityId, city, fetch, now);
      // An error is not cached, and neither is a question back (needs_input),
      // so in both cases the board would still be waiting.
      return section.status !== "error" && section.status !== "needs_input";
    } catch (err) {
      report(deps, `warm ${kind} ${key.mediaType}:${key.tmdbId}`, err);
      return false;
    }
  }));
  return results.every(Boolean) ? "warmed" : "failed";
}

/** Warms every board candidate for the city, one at a time (the Qloo client's
 *  limiter bounds concurrency anyway, and one at a time is gentler on it).
 *  Evidence does not depend on the business type, so `_type` changes
 *  nothing; it is in the signature so a run reads per (city, type), and a
 *  second type for the same city finds everything cached. A candidate
 *  that fails counts as failed and the run carries on. */
export async function warmCity(deps: WarmDeps, city: City, _type: BusinessType): Promise<WarmReport> {
  const candidates = await listCandidates(deps.sql, city, deps.now ? deps.now() : new Date());
  const out: WarmReport = { warmed: 0, failed: 0 };
  for (const c of candidates) {
    const outcome = await warmTitle(deps, city, { tmdbId: c.card.tmdbId, mediaType: c.card.mediaType });
    out[outcome] += 1;
  }
  try { await warmBoardRanks(deps, city, candidates); } catch (err) { report(deps, `warm rank ${city.slug}`, err); out.failed += 1; }
  return out;
}

/** The scheduled run: each city (the prewarm cities unless given others),
 *  both business types, cities one after another. A city whose candidate
 *  list cannot be read counts one failure per business type and is logged;
 *  it does not stop the other cities. */
export async function warmCities(deps: WarmDeps, cities: City[] = allCities().filter((c) => c.prewarm)): Promise<WarmReport> {
  const total: WarmReport = { warmed: 0, failed: 0 };
  for (const city of cities) {
    for (const type of Object.keys(BUSINESS_TYPES) as BusinessType[]) {
      try {
        const r = await warmCity(deps, city, type);
        total.warmed += r.warmed;
        total.failed += r.failed;
      } catch (err) {
        report(deps, `warm ${city.slug}/${type}`, err);
        total.failed += 1;
      }
    }
  }
  return total;
}

// --- the bounded queue behind the board -------------------------------------

export interface WarmQueue {
  /** False when the key is already queued or running, or the queue is full. */
  enqueue(key: string, job: () => Promise<unknown>): boolean;
  /** Jobs queued plus running. */
  size(): number;
}

export interface WarmQueueOptions {
  /** Most jobs queued or running at once; further work is dropped, not waited for. */
  maxQueue?: number;
  /** Jobs running at once; the Qloo limiter bounds the calls beneath them. */
  concurrency?: number;
  onError?: (key: string, err: unknown) => void;
}

/** A keyed, bounded, in-process queue. A key already queued or running is not
 *  added again (so polling never double-enqueues), and past `maxQueue` new
 *  work is dropped silently: the next poll asks again, which is the retry. */
export function createWarmQueue(opts: WarmQueueOptions = {}): WarmQueue {
  const maxQueue = opts.maxQueue ?? 200;
  const concurrency = opts.concurrency ?? 4;
  const keys = new Set<string>();
  const waiting: { key: string; job: () => Promise<unknown> }[] = [];
  let running = 0;

  const pump = () => {
    while (running < concurrency && waiting.length > 0) {
      const { key, job } = waiting.shift()!;
      running += 1;
      // Through a promise chain so a job that throws synchronously is caught too.
      Promise.resolve()
        .then(job)
        .catch((err) => { try { opts.onError?.(key, err); } catch { /* ignore */ } })
        .finally(() => { running -= 1; keys.delete(key); pump(); });
    }
  };

  return {
    enqueue(key, job) {
      if (keys.has(key) || keys.size >= maxQueue) return false;
      keys.add(key);
      waiting.push({ key, job });
      pump();
      return true;
    },
    size: () => keys.size,
  };
}

/** The board's `enqueueWarm`: one job per (city, title, media type, business type). */
export function createBackgroundWarmer(deps: WarmDeps, queue: WarmQueue): BoardDeps["enqueueWarm"] {
  return (city, type, key) => {
    queue.enqueue(`${city.slug}|${key.tmdbId}|${key.mediaType}|${type}`, () => warmTitle(deps, city, key));
  };
}

/** Refresh the city/type slates after title resolution. Never compare ranks
 * from distinct media types or split one type into several requests. */
export async function warmBoardRanks(deps: WarmDeps, city: City, slate?: Awaited<ReturnType<typeof listCandidates>>): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const candidates = slate ?? await listCandidates(deps.sql, city, now);
  const entities = await getCachedEntities(deps.sql, candidates.map(c => ({ tmdbId: c.card.tmdbId, mediaType: c.card.mediaType })));
  let failed = false;
  for (const type of ['movie', 'tv'] as const) {
    const ids = candidates.filter(c => c.card.mediaType === type).flatMap(c => {
      const e = entities.get(`${type}:${c.card.tmdbId}`);
      return e?.entityId && !e.notFound ? [e.entityId] : [];
    });
    if (!ids.length) continue;
    try {
      const section = await fetchBoardRank(deps.sql, deps.qloo, city, type, ids, now);
      if (section.status === 'error' || section.status === 'needs_input') throw new Error(`Board ${type} ranking unavailable (${section.status}).`);
    } catch (err) { failed = true; report(deps, `warm rank ${city.slug}/${type}`, err); }
  }
  if (failed) throw new Error('One or more local ranking slates could not be refreshed.');

}

/** Failed ranks cool down between public polls; successful reads use the DB
 * cache. Queue capacity and coalescing are shared with title warming. */
export function createBackgroundRanker(deps: WarmDeps, queue: WarmQueue): NonNullable<BoardDeps['enqueueRank']> {
  const retryAt = new Map<string, number>();
  return city => {
    if ((retryAt.get(city.slug) ?? 0) > Date.now()) return;
    queue.enqueue(`rank|${city.slug}`, async () => {
      try { await warmBoardRanks(deps, city); retryAt.delete(city.slug); }
      catch (err) { retryAt.set(city.slug, Date.now() + 30_000); report(deps, `warm rank ${city.slug}`, err); }
    });
  };
}

// Turns a TMDB title into the Qloo entity that describes it. Qloo has its own
// ids, so every Pulse request starts here; the answer is cached in
// qloo_entities because the lookup costs a Qloo call and Qloo is rate limited.

import { getCachedEntity, getImdbId, upsertEntity, type EntitySql } from "./db/entities.js";
import type { QlooClient, QlooEntityRef } from "./qloo/client.js";
import { lookupTmdbTitle, type TmdbTitle } from "./tmdbLookup.js";

export interface TitleKey { tmdbId: number; mediaType: "movie" | "tv"; }

export type Resolution =
  | { entityId: string; method: "imdb" | "search" }
  | { entityId: null; reason: "not_in_qloo" | "no_imdb_and_no_match" };

type QlooType = "movie" | "tv_show";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a miss is believed. Qloo's catalogue grows, and a new release is
 *  often missing for a few days, so a miss is retried rather than kept forever. */
const NOT_FOUND_RETRY_DAYS = 3;

/** True once a miss is strictly more than 3 days old and worth asking again. */
export function notFoundIsStale(resolvedAt: Date, now: Date): boolean {
  return now.getTime() - resolvedAt.getTime() > NOT_FOUND_RETRY_DAYS * DAY_MS;
}

/** Picks the search hit that is plausibly the same title. A name search is a
 *  guess, so it must agree on type and be within a year on release year (TMDB
 *  and Qloo disagree by a year around festival and regional releases). With no
 *  year to check against it accepts nothing: a wrong entity would put another
 *  title's audience on the page, which is worse than showing none. Among
 *  acceptable hits the closest year wins, then the earlier in Qloo's order. */
export function pickSearchMatch(
  cands: QlooEntityRef[],
  want: { year: number | null; type: QlooType },
): QlooEntityRef | null {
  if (want.year === null) return null;
  let best: QlooEntityRef | null = null;
  let bestDistance = Infinity;
  for (const c of cands) {
    if (c.type !== want.type || c.year === null) continue;
    const distance = Math.abs(c.year - want.year);
    if (distance <= 1 && distance < bestDistance) {
      best = c;
      bestDistance = distance;
    }
  }
  return best;
}

const inFlight = new Map<string, Promise<Resolution>>();

/**
 * Resolves a title to its Qloo entity, caching the outcome in qloo_entities.
 *
 * Order: cached hit; a cached miss that is not yet stale; an IMDb id from
 * title_ratings, else from TMDB; Qloo's IMDb match; then a name+year search.
 *
 * Errors contract (do not weaken): only a definite "Qloo has no such title" is
 * cached as a miss (not_found = true, retried after 3 days). An error THROWN by
 * the Qloo client (outage, timeout, exhausted 429 retries), by the database, or
 * by the TMDB lookup (TmdbUnavailableError once its retries are spent, or a
 * missing TMDB key) propagates to the caller and caches nothing, because an
 * outage must never read as "no such title" for the next three days. Callers
 * (briefs, the board) catch and degrade. Only a TMDB 404 (lookupTmdbTitle
 * returns null) counts as a definite answer, and with no title to search by it
 * is cached as a miss.
 *
 * Concurrent calls for the same title share one resolution, so a burst of
 * requests for one title costs Qloo one call, not one each.
 */
export function resolveTitle(sql: EntitySql, qloo: QlooClient, key: TitleKey, now: Date = new Date()): Promise<Resolution> {
  const flightKey = `${key.mediaType}:${key.tmdbId}`;
  const existing = inFlight.get(flightKey);
  if (existing) return existing;
  // Cleared on settle, rejection included, so a failure is retried by the next call.
  const p = resolve(sql, qloo, key, now).finally(() => inFlight.delete(flightKey));
  inFlight.set(flightKey, p);
  return p;
}

async function resolve(sql: EntitySql, qloo: QlooClient, key: TitleKey, now: Date): Promise<Resolution> {
  const cached = await getCachedEntity(sql, key);
  if (cached) {
    if (!cached.notFound && cached.entityId && cached.method) return { entityId: cached.entityId, method: cached.method };
    if (cached.notFound && !notFoundIsStale(cached.resolvedAt, now)) return { entityId: null, reason: "not_in_qloo" };
  }

  const record = (imdbId: string | null, entityId: string | null, method: "imdb" | "search" | null) =>
    upsertEntity(sql, { ...key, imdbId, entityId, method, notFound: entityId === null, resolvedAt: now });
  const miss = async (imdbId: string | null, reason: "not_in_qloo" | "no_imdb_and_no_match"): Promise<Resolution> => {
    await record(imdbId, null, null);
    return { entityId: null, reason };
  };

  // Memoised for this resolution, a 404 (null) included: `lookup ??=` would
  // re-ask TMDB on the miss path because null is nullish.
  let lookup: { value: TmdbTitle | null } | undefined;
  const tmdbLookup = async () => (lookup ??= { value: await lookupTmdbTitle(key.mediaType, key.tmdbId) }).value;

  let imdbId = await getImdbId(sql, key);
  if (!imdbId) imdbId = (await tmdbLookup())?.imdbId ?? null;

  if (imdbId) {
    const ref = await qloo.entityByImdb(imdbId);
    if (ref) {
      await record(imdbId, ref.entityId, "imdb");
      return { entityId: ref.entityId, method: "imdb" };
    }
  }

  // The title and year are only needed here, so when the IMDb id came from
  // title_ratings this is the one TMDB call that path costs.
  const found = await tmdbLookup();
  if (!found?.title) return miss(imdbId, "no_imdb_and_no_match");
  const year = found.year && /^\d{4}$/.test(found.year) ? Number(found.year) : null;
  const type: QlooType = key.mediaType === "movie" ? "movie" : "tv_show";
  const match = pickSearchMatch(await qloo.searchTitles(found.title, type), { year, type });
  if (match) {
    await record(imdbId, match.entityId, "search");
    return { entityId: match.entityId, method: "search" };
  }
  return miss(imdbId, imdbId ? "not_in_qloo" : "no_imdb_and_no_match");
}

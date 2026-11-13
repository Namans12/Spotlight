import type { ProviderOffer } from '../../shared/types/availability';
import { fetchJson } from '@/lib/http';

export interface ProviderSubject {
  id: number;
  mediaType: string;
}

export function providerKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/** Batch "where to watch" lookup for a grid or row of titles. Requests are
 * limited to 100 unique titles each; TMDB fan-out happens server-side.
 *
 * A key that TMDB failed to resolve (rate limit, transient error) is simply
 * absent from the response rather than mapped to an empty list — see
 * tmdbWatchProvidersBatch's own comment for why that distinction matters. */
export interface ProviderBatch {
  providers: Record<string, string[]>;
  /** True when one or more requested title lookups failed. Missing in older cached responses. */
  hadFailures?: boolean;
  /** Missing key means unknown or an older cached response. */
  availability?: Record<string, ProviderOffer[]>;
  watchLinks?: Record<string, string>;
  /** Minutes for one sitting — a film's runtime, or a series' typical episode
   * length. Absent for a title TMDB has no runtime for. */
  runtimes: Record<string, number>;
  /** Genre names, free from the same detail payload. Read by the year in
   * review, which needs a genre per saved title. Absent for a title TMDB
   * lists no genres for. */
  genres: Record<string, string[]>;
}

/** Retry incomplete results on a later mount or focus instead of treating
 * missing regional offers as fresh for the full six-hour cache period. */
export function providerStaleTime(query: { state: { data?: ProviderBatch } }): number {
  return query.state.data?.hadFailures ? 60_000 : 6 * 60 * 60_000;
}

async function fetchProviderChunk(ids: string[]): Promise<ProviderBatch> {
  const data = await fetchJson<unknown>(`/api/tmdb/providers-batch?ids=${encodeURIComponent(ids.join(','))}`);

  // Two shapes are accepted on purpose. The route now answers
  // `{ providers, runtimes }`, but it used to answer the bare providers map,
  // and that response is cached at the edge for an hour — so for a while after
  // a deploy a new client can still be handed the old shape. Reading both
  // keeps "where to watch" working through that window instead of blanking
  // every card on the page.
  if (data && typeof data === "object" && "providers" in data) {
    const batch = data as Partial<ProviderBatch>;
    // Each field defaulted independently, for the same reason: `genres` is the
    // newest of the three, so for an hour after a deploy the edge can still be
    // serving a `{ providers, runtimes }` response to a client that expects it.
    return { providers: batch.providers ?? {}, availability: batch.availability ?? {}, watchLinks: batch.watchLinks ?? {}, runtimes: batch.runtimes ?? {}, genres: batch.genres ?? {}, hadFailures: batch.hadFailures === true };
  }
  return { providers: (data as Record<string, string[]>) ?? {}, runtimes: {}, genres: {} };
}

/** Match the server limit; omitted chunks remain unknown when a request fails. */
export async function fetchProvidersBatch(keys: ProviderSubject[]): Promise<ProviderBatch> {
  const ids = [...new Set(keys.map((key) => providerKey(key.mediaType, key.id)))];
  const combined: ProviderBatch = { providers: {}, availability: {}, watchLinks: {}, runtimes: {}, genres: {} };
  let successes = 0;
  let lastError: unknown;
  for (let offset = 0; offset < ids.length; offset += 100) {
    try {
      const result = await fetchProviderChunk(ids.slice(offset, offset + 100));
      successes++;
      Object.assign(combined.providers, result.providers);
      Object.assign(combined.availability!, result.availability);
      Object.assign(combined.watchLinks!, result.watchLinks);
      Object.assign(combined.runtimes, result.runtimes);
      Object.assign(combined.genres, result.genres);
      if (result.hadFailures) combined.hadFailures = true;
    } catch (error) {
      lastError = error;
      combined.hadFailures = true;
    }
  }
  if (ids.length && !successes) throw lastError;
  return combined;
}

import { fetchJson } from '@/lib/http';

export interface ProviderSubject {
  id: number;
  mediaType: string;
}

export function providerKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/** Batch "where to watch" lookup ("Netflix", "HBO", "Apple TV+ (Buy/Rent)") for
 * a grid or row of titles. One request no matter how many keys are passed —
 * the fan-out to TMDB happens server-side (see api/tmdb/[...path].ts's
 * "providers-batch" route), so the browser never fires one request per card.
 *
 * A key that TMDB failed to resolve (rate limit, transient error) is simply
 * absent from the response rather than mapped to an empty list — see
 * tmdbWatchProvidersBatch's own comment for why that distinction matters. */
export interface ProviderBatch {
  providers: Record<string, string[]>;
  /** Minutes for one sitting — a film's runtime, or a series' typical episode
   * length. Absent for a title TMDB has no runtime for. */
  runtimes: Record<string, number>;
}

export async function fetchProvidersBatch(keys: ProviderSubject[]): Promise<ProviderBatch> {
  if (keys.length === 0) return { providers: {}, runtimes: {} };
  const ids = [...new Set(keys.map((k) => providerKey(k.mediaType, k.id)))].join(",");
  const data = await fetchJson<unknown>(`/api/tmdb/providers-batch?ids=${encodeURIComponent(ids)}`);

  // Two shapes are accepted on purpose. The route now answers
  // `{ providers, runtimes }`, but it used to answer the bare providers map,
  // and that response is cached at the edge for an hour — so for a while after
  // a deploy a new client can still be handed the old shape. Reading both
  // keeps "where to watch" working through that window instead of blanking
  // every card on the page.
  if (data && typeof data === "object" && "providers" in data) {
    const batch = data as Partial<ProviderBatch>;
    return { providers: batch.providers ?? {}, runtimes: batch.runtimes ?? {} };
  }
  return { providers: (data as Record<string, string[]>) ?? {}, runtimes: {} };
}

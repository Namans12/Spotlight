import { useQuery } from '@tanstack/react-query';
import { fetchProvidersBatch, providerKey, type ProviderSubject } from '@/lib/providers';

/** What every grid actually needs: a title -> platform-list lookup. */
export type ProvidersLookup = (mediaType: string, tmdbId: number) => string[] | undefined;

/**
 * Batch "where to watch" platforms for a grid or row, mirroring useRatings'
 * and useSeasons' own shape: call this ONCE per page over every item it will
 * render, not once per grid, so TanStack Query dedupes by the sorted id list
 * instead of firing a separate request per grid.
 *
 * Returns `undefined` (not `[]`) while unresolved, so a caller can tell "still
 * loading" from "checked, and there's nowhere to watch it" — the latter is a
 * real, renderable answer (nothing to show), the former isn't.
 */
export function useProviders(items: ProviderSubject[]): ProvidersLookup {
  const keys = items.map((i) => ({ mediaType: i.mediaType, id: i.id }));
  const cacheKey = keys.map((k) => providerKey(k.mediaType, k.id)).sort().join(',');

  const query = useQuery({
    queryKey: ['providers', cacheKey],
    queryFn: () => fetchProvidersBatch(keys),
    enabled: keys.length > 0,
    // Availability shifts (a title leaves/joins a service) but not by the
    // minute — long enough to spare a repeat grid view a refetch, short
    // enough that a licensing change shows up within the day.
    staleTime: 6 * 60 * 60_000,
  });

  const map = query.data?.providers;
  return (mediaType: string, tmdbId: number): string[] | undefined => map?.[providerKey(mediaType, tmdbId)];
}

/** Minutes for one sitting, from the same batch `useProviders` already ran —
 * no extra request, and no extra TMDB call behind it either (see
 * lib/tmdbProxy.ts tmdbWatchProvidersBatch). `undefined` means unknown, which
 * a filter must treat as "do not hide it" rather than as zero. */
export type RuntimeLookup = (mediaType: string, tmdbId: number) => number | undefined;

export function useRuntimes(items: ProviderSubject[]): RuntimeLookup {
  const keys = items.map((i) => ({ mediaType: i.mediaType, id: i.id }));
  const cacheKey = keys.map((k) => providerKey(k.mediaType, k.id)).sort().join(',');

  // Same queryKey as useProviders, deliberately: TanStack dedupes on it, so a
  // page using both hooks over the same items still makes exactly one request.
  const query = useQuery({
    queryKey: ['providers', cacheKey],
    queryFn: () => fetchProvidersBatch(keys),
    enabled: keys.length > 0,
    staleTime: 6 * 60 * 60_000,
  });

  const map = query.data?.runtimes;
  return (mediaType: string, tmdbId: number): number | undefined => map?.[providerKey(mediaType, tmdbId)];
}

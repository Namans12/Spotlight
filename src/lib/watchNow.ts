import type { AvailabilityType, ProviderOffer } from '../../shared/types/availability';
import type { WatchlistItem } from '@/types/movie';

// "What can I watch right now" — the filter that turns a saved list into a
// decision.
//
// A watchlist answers "what did I mean to watch", which is a different
// question from the one someone actually has at 9pm on a Tuesday: *I have
// forty minutes and I have Netflix.* Everything needed to answer that is
// already on the page — the providers batch is fetched for the poster cards,
// and it now carries runtime too (lib/tmdbProxy.ts) — so this is assembly
// rather than new data.
//
// Availability must match a regional offer; missing data is selectable as unknown.
// Runtime can remain unknown because it is independent of availability.

export type RuntimeBand = 'short' | 'medium' | 'long';

export interface RuntimeBandSpec {
  id: RuntimeBand;
  label: string;
  /** Inclusive lower bound, exclusive upper. */
  min: number;
  max: number;
}

/** Bands chosen around how people actually describe an evening, not round
 *  numbers: under 45 minutes is one episode, up to 2 hours is a normal film,
 *  and past that is a deliberate commitment. */
export const RUNTIME_BANDS: RuntimeBandSpec[] = [
  { id: 'short', label: 'Under 45 min', min: 0, max: 45 },
  { id: 'medium', label: '45 min - 2 hr', min: 45, max: 120 },
  { id: 'long', label: 'Over 2 hr', min: 120, max: Number.POSITIVE_INFINITY },
];

export interface WatchNowFilters {
  /** Canonical platform names. Empty means "any". */
  platforms: string[];
  availabilityTypes?: (AvailabilityType | 'unknown')[];
  runtime: RuntimeBand | null;
  /** 'movie' | 'tv' | null for both. */
  mediaType: 'movie' | 'tv' | null;
}

export const EMPTY_FILTERS: WatchNowFilters = { platforms: [], availabilityTypes: [], runtime: null, mediaType: null };

export function hasActiveFilters(filters: WatchNowFilters): boolean {
  return filters.platforms.length > 0 || (filters.availabilityTypes?.length ?? 0) > 0 || filters.runtime !== null || filters.mediaType !== null;
}

export interface WatchNowLookups {
  providersFor: (mediaType: string, tmdbId: number) => string[] | undefined;
  availabilityFor: (mediaType: string, tmdbId: number) => ProviderOffer[] | undefined;
  runtimeFor: (mediaType: string, tmdbId: number) => number | undefined;
}

function inBand(minutes: number, band: RuntimeBand): boolean {
  const spec = RUNTIME_BANDS.find((b) => b.id === band);
  if (!spec) return true;
  return minutes >= spec.min && minutes < spec.max;
}

/**
 * Narrows a saved list to what fits the moment.
 *
 * A selected service and price type must match the same regional offer.
 * Unknown availability is never treated as a known service or offer.
 */
export function filterWatchNow(
  items: WatchlistItem[],
  filters: WatchNowFilters,
  lookups: WatchNowLookups,
): WatchlistItem[] {
  if (!hasActiveFilters(filters)) return items;

  const wanted = new Set(filters.platforms.map(basePlatform));

  return items.filter((item) => {
    if (filters.mediaType && item.mediaType !== filters.mediaType) return false;

    const selectedTypes = filters.availabilityTypes ?? [];
    if (wanted.size > 0 || selectedTypes.length > 0) {
      const offers = lookups.availabilityFor(item.mediaType, item.id);
      const hasKnownMatch = (offers ?? []).some((offer) =>
        (wanted.size === 0 || wanted.has(basePlatform(offer.provider))) &&
        (selectedTypes.length === 0 || selectedTypes.includes(offer.type)),
      );
      // Unknown is a separate choice and cannot establish a particular service.
      const unknownMatch = !offers?.length && wanted.size === 0 && selectedTypes.includes('unknown');
      if (!hasKnownMatch && !unknownMatch) return false;
    }

    if (filters.runtime) {
      const minutes = lookups.runtimeFor(item.mediaType, item.id);
      if (minutes === undefined) return true; // unknown length, don't rule it out
      if (!inBand(minutes, filters.runtime)) return false;
    }

    return true;
  });
}

/** "Apple TV+ (Buy/Rent)" -> "Apple TV+". */
export function basePlatform(name: string): string {
  return name.replace(/\s*\(Buy\/Rent\)\s*$/i, '').trim();
}

/**
 * The platforms worth offering as filter options: the ones this list actually
 * has something on, most-carried first.
 *
 * Built from the list rather than from a fixed catalogue of services, so the
 * options can never include a platform that would return nothing — a filter
 * chip that empties the page is worse than no chip.
 */
export function availablePlatforms(
  items: WatchlistItem[],
  availabilityFor: WatchNowLookups['availabilityFor'],
): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const name of new Set((availabilityFor(item.mediaType, item.id) ?? []).map(offer => basePlatform(offer.provider)))) {
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

/** Runtime bands that would actually match something here, so the control
 *  never offers a choice that empties the list. */
export function availableRuntimeBands(
  items: WatchlistItem[],
  runtimeFor: WatchNowLookups['runtimeFor'],
): RuntimeBandSpec[] {
  const present = new Set<RuntimeBand>();
  for (const item of items) {
    const minutes = runtimeFor(item.mediaType, item.id);
    if (minutes === undefined) continue;
    const band = RUNTIME_BANDS.find((b) => minutes >= b.min && minutes < b.max);
    if (band) present.add(band.id);
  }
  return RUNTIME_BANDS.filter((b) => present.has(b.id));
}

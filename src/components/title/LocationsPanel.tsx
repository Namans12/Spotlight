import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import type { TitleLocationEntry } from '../../../shared/types/pulse';
import { shouldRetry } from '@/lib/http';
import { fetchTitleLocations, pulseConfigured } from '@/lib/pulseApi';

interface LocationsPanelProps {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
}

const SOURCE_NOTE =
  "From Wikipedia and Wikidata. Coverage varies, and India coverage is partial — a missing record doesn't mean a title wasn't shot or set somewhere.";

/** "Shot in Chandni Chowk, " before the city link, "Set in " before it, and so on. */
function lead(row: TitleLocationEntry): string {
  if (row.kind === 'set') return 'Set in ';
  return row.landmark_label ? `Shot in ${row.landmark_label}, ` : 'Shot in ';
}

/**
 * Where a title was filmed or set, among Pulse's launch cities, each linking
 * to what is coming for that city.
 *
 * It is an extra, so it is silent about everything that is not good news: no
 * Pulse service configured, still loading, a failed request and an empty
 * answer all render nothing at all, rather than a spinner or an apology on
 * every title page that happens to have no record. The service answers `[]`
 * for a title it has nothing on, and says nothing about people.
 */
export function LocationsPanel({ mediaType, tmdbId }: LocationsPanelProps) {
  const configured = pulseConfigured();
  const { data } = useQuery({
    queryKey: ['pulse-title-locations', mediaType, tmdbId],
    queryFn: ({ signal }) => fetchTitleLocations(mediaType, tmdbId, signal),
    enabled: configured && Number.isFinite(tmdbId),
    // The data build changes this table daily at most.
    staleTime: 6 * 60 * 60_000,
    // Never retry a 4xx (a 429 retried only deepens the limit); two tries for a 5xx.
    retry: shouldRetry,
  });

  if (!configured || !Array.isArray(data) || data.length === 0) return null;

  return (
    <section className="px-1" aria-labelledby="title-locations-heading">
      <div className="rounded-xl bg-card px-4 py-3.5">
        <h2 id="title-locations-heading" className="mb-2.5 flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <MapPin size={16} aria-hidden className="text-accent" />
          Filmed in &amp; set in
        </h2>
        <ul className="space-y-1.5">
          {data.map((row) => (
            <li key={`${row.city_slug}-${row.kind}`} className="text-sm text-foreground">
              {lead(row)}
              <Link
                to={`/pulse?city=${encodeURIComponent(row.city_slug)}`}
                title={`See what's coming for ${row.cityName}`}
                aria-label={`See what's coming for ${row.cityName}`}
                className="inline-flex min-h-6 items-center rounded font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {row.cityName}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-4 text-muted-foreground">{SOURCE_NOTE}</p>
      </div>
    </section>
  );
}

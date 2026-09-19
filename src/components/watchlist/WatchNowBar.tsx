import { Clock, Filter, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  type RuntimeBandSpec,
  type WatchNowFilters,
} from '@/lib/watchNow';

interface WatchNowBarProps {
  filters: WatchNowFilters;
  onChange: (next: WatchNowFilters) => void;
  /** Only the platforms this list actually has something on — see
   * availablePlatforms. A chip that empties the page is worse than no chip. */
  platforms: string[];
  /** Likewise: only bands that would match something. */
  runtimeBands: RuntimeBandSpec[];
  /** Shown after the controls: "6 of 23". */
  shownCount: number;
  totalCount: number;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-accent bg-accent text-accent-foreground'
          : 'border-border text-muted-foreground hover:border-accent/40 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/**
 * "What can I watch right now" — the control that turns a saved list into a
 * decision.
 *
 * A watchlist answers "what did I mean to watch". The question someone
 * actually has is narrower: *I have forty minutes and I have Netflix.* Both
 * halves of that come from data the page already loaded — the providers batch
 * fetched for the poster cards, which now carries runtime too.
 *
 * Renders nothing when there is nothing to narrow. A filter bar over four
 * saved titles is furniture.
 */
export function WatchNowBar({
  filters,
  onChange,
  platforms,
  runtimeBands,
  shownCount,
  totalCount,
}: WatchNowBarProps) {
  const active = hasActiveFilters(filters);
  if (platforms.length === 0 && runtimeBands.length === 0) return null;

  const togglePlatform = (name: string) =>
    onChange({
      ...filters,
      platforms: filters.platforms.includes(name)
        ? filters.platforms.filter((p) => p !== name)
        : [...filters.platforms, name],
    });

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center gap-2">
        <Filter size={13} className="shrink-0 text-accent" />
        <span className="text-xs font-semibold text-foreground">What can I watch right now?</span>
        {active && (
          <>
            <span className="text-xs text-muted-foreground">
              {shownCount} of {totalCount}
            </span>
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <X size={11} /> Clear
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {/* Films vs series first: it is the coarsest cut and the one people
            reach for most ("I want a film tonight, not three more episodes"). */}
        <Chip active={filters.mediaType === 'movie'} onClick={() => onChange({ ...filters, mediaType: filters.mediaType === 'movie' ? null : 'movie' })}>
          Films
        </Chip>
        <Chip active={filters.mediaType === 'tv'} onClick={() => onChange({ ...filters, mediaType: filters.mediaType === 'tv' ? null : 'tv' })}>
          Series
        </Chip>

        {runtimeBands.map((band) => (
          <Chip
            key={band.id}
            active={filters.runtime === band.id}
            onClick={() => onChange({ ...filters, runtime: filters.runtime === band.id ? null : band.id })}
          >
            <span className="inline-flex items-center gap-1">
              <Clock size={10} className="shrink-0" />
              {band.label}
            </span>
          </Chip>
        ))}

        {platforms.map((name) => (
          <Chip key={name} active={filters.platforms.includes(name)} onClick={() => togglePlatform(name)}>
            {name}
          </Chip>
        ))}
      </div>
    </div>
  );
}

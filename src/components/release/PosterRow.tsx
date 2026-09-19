import { Movie } from '@/types/movie';
import { PosterCard } from '@/components/release/PosterCard';
import { fromMovie } from '@/types/digest';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { useRatings } from '@/hooks/useRatings';
import { useSeasons } from '@/hooks/useSeasons';
import { useProviders, type ProvidersLookup } from '@/hooks/useProviders';

interface PosterRowProps {
  title: string;
  items: Movie[];
  icon?: React.ReactNode;
  subtitle?: string;
  /** One-line explanation shown under a card — used by Can Watch, where each
   * title leans on a specific, named reason rather than general taste. */
  reasonFor?: (movie: Movie) => string | null | undefined;
  /** Thumbs-down, owner-only. Omit entirely for rows that shouldn't offer it. */
  onSuppress?: (movie: Movie) => void;
  /** A lookup already covering this row's items, from a page that renders
   * several rows at once (Browse's "For You" strips) and wants one shared
   * providers-batch request instead of one per row -- each provider lookup is
   * a live TMDB fan-out, not a DB-cache read like ratings/seasons, so N rows
   * otherwise means N requests. Omit for a lone row (TitleDetail's "You may
   * also like") and this fetches its own -- one row, one request either way. */
  providersFor?: ProvidersLookup;
}

/** Horizontally scrolling poster row — the shared shape behind every
 * "Trending", "Because you added…" and "You may also like" strip. */
export function PosterRow({ title, items, icon, subtitle, reasonFor, onSuppress, providersFor }: PosterRowProps) {
  const wl = useWatchlistContext();
  const ratingFor = useRatings(items);
  const seasonsFor = useSeasons(items);
  // Empty array when a shared lookup was passed in: useProviders' `enabled`
  // guard turns that into a no-op, so this never fires a second request.
  const ownProvidersFor = useProviders(providersFor ? [] : items);
  const resolveProviders = providersFor ?? ownProvidersFor;
  if (items.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-3">
        {icon && <span className="text-accent shrink-0 self-center">{icon}</span>}
        <h3 className="font-display text-lg font-semibold text-foreground leading-none">{title}</h3>
        {subtitle && <span className="text-xs text-muted-foreground truncate">{subtitle}</span>}
      </div>
      <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2 -mx-1 px-1">
        {items.map((movie) => (
          <PosterCard
            key={`${movie.mediaType}-${movie.id}`}
            item={fromMovie(movie)}
            linkTo={`/title/${movie.mediaType}/${movie.id}`}
            rating={ratingFor(movie.mediaType, movie.id)}
            seasons={seasonsFor(movie.mediaType, movie.id)}
            providers={resolveProviders(movie.mediaType, movie.id)}
            className="flex-shrink-0 w-[130px] sm:w-[150px]"
            onAddToWatchlist={() => wl.addToWatchlist(movie)}
            onAddToWatchLater={() => wl.addToWatchLater(movie)}
            onToggleWatched={() => wl.toggleWatched(movie)}
            watched={wl.isWatched(movie.mediaType, movie.id)}
            reason={reasonFor?.(movie)}
            onSuppress={onSuppress ? () => onSuppress(movie) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

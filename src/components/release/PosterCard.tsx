import { Link } from 'react-router-dom';
import type { ReleaseItem } from '@/types/digest';
import { ActionButton } from '@/components/watchlist/ActionButton';
import { RatingBadges } from '@/components/release/RatingBadges';
import { hasAnyScore, type TitleRating } from '@/lib/ratings';
import { WatchedToggle, WatchedBadge } from '@/components/watchlist/WatchedToggle';
import { ImageOff, Star, Plus, Clock, ThumbsDown } from 'lucide-react';
import { tmdbPosterFluid } from '@/lib/tmdbImage';

interface PosterCardProps {
  item: ReleaseItem;
  linkTo?: string;
  onAddToWatchlist?: () => void;
  onAddToWatchLater?: () => void;
  className?: string;
  /** IMDb/RT scores when the cache has them; falls back to the TMDB score. */
  rating?: TitleRating | null;
  /** TV only, from the seasons cache; null while loading or unknown. */
  seasons?: number | null;
  /** Live-fetched platform names ("Netflix", "HBO"), when the item itself
   * doesn't already carry them (release-calendar items do; search/browse/
   * watchlist items don't). Falls back to `item.providers` when omitted. */
  providers?: string[];
  /** One-line, user-facing explanation shown under the title — used by
   * Can Watch cards ("a running thread of jokes calls back to..."). */
  reason?: string | null;
  /** Thumbs-down, owner-only. Present only on relation cards. */
  onSuppress?: () => void;
  /** "Seen it", from anywhere — the title need not be saved first. Omit on
   * surfaces where the control would be meaningless. */
  onToggleWatched?: () => void;
  watched?: boolean;
}

/** Poster-forward vertical tile for grid contexts (Home, Calendar, Browse,
 * Search) — as opposed to ReleaseCard's horizontal row, used in list contexts
 * (My List) where a drag handle and dense rows make more sense. */
export function PosterCard({
  item,
  linkTo,
  onAddToWatchlist,
  onAddToWatchLater,
  className = '',
  rating,
  seasons,
  providers,
  reason,
  onSuppress,
  onToggleWatched,
  watched = false,
}: PosterCardProps) {
  const year = item.releaseDate?.slice(0, 4);
  const hasActions = onAddToWatchlist || onAddToWatchLater || onToggleWatched;
  const provider = (providers ?? item.providers)?.[0];
  // This card renders both fixed-width (PosterRow, 130-150px) and fluid-grid
  // (ReleaseGrid, 3-7 responsive columns) — sizes covers both rather than
  // picking one true width.
  const posterImg = tmdbPosterFluid(item.posterUrl);

  const poster = (
    <div className={`group relative ${className}`}>
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-secondary">
        {posterImg ? (
          <img
            src={posterImg.src}
            srcSet={posterImg.srcSet}
            sizes="(min-width: 1280px) 180px, (min-width: 640px) 150px, 130px"
            alt=""
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-105 ${
              watched ? 'opacity-50 saturate-50' : ''
            }`}
          />
        ) : (
          <div className="no-poster-stripes w-full h-full rounded-xl border border-dashed border-muted-foreground/40 flex flex-col items-center justify-center gap-1.5 text-muted-foreground px-2">
            <ImageOff size={28} className="shrink-0" />
            <span className="text-[10px] text-center leading-tight">No poster available</span>
          </div>
        )}

        {onSuppress && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSuppress();
            }}
            aria-label="Not interested in this suggestion"
            className="absolute top-2 left-2 inline-flex items-center justify-center w-7 h-7 rounded-md bg-background/70 text-muted-foreground backdrop-blur-sm hover:bg-background/90 hover:text-foreground transition-all"
          >
            <ThumbsDown size={12} />
          </button>
        )}

        {hasAnyScore(rating) ? (
          <div className="absolute top-2 right-2">
            <RatingBadges rating={rating} className="rounded-md bg-background/80 px-1 py-0.5 backdrop-blur-sm" />
          </div>
        ) : (
          item.rating != null &&
          item.rating > 0 && (
            <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-background/80 text-[10px] font-semibold text-gold inline-flex items-center gap-0.5 leading-none backdrop-blur-sm">
              <Star size={9} fill="currentColor" /> {item.rating.toFixed(1)}
            </div>
          )
        )}

        {watched && <WatchedBadge />}
      </div>

      {/* h-9 (fixed, not min-h) reserves exactly 2 lines regardless of actual
          title length — without it, a one-line title's metadata row and Add
          button sit higher than a neighbouring two-line title's in the same
          grid row. It's a hard cap rather than a floor so a long, hard-to-wrap
          title can never push a partial third line past the box and into the
          metadata row below; break-words guards the same edge for a single
          overlong word. */}
      <h4 className="mt-2 h-9 text-xs font-medium text-foreground line-clamp-2 leading-tight break-words">
        {item.title}
      </h4>
      <div className="flex items-center gap-1.5 mt-0.5 leading-none">
        {year && <span className="text-[10px] text-muted-foreground">{year}</span>}
        <span className="text-[9px] uppercase font-semibold text-muted-foreground">
          {item.mediaType === 'tv' ? 'TV' : 'Film'}
        </span>
        {item.mediaType === 'tv' && seasons != null && (
          <span className="text-[10px] text-muted-foreground">
            {seasons} {seasons === 1 ? 'Season' : 'Seasons'}
          </span>
        )}
      </div>
      {/* Its own line, always — folded into the row above it used to wrap in
          only when the combined text happened to overflow, so one card in a
          row would grow a second line while its neighbours didn't. */}
      {provider && <p className="mt-0.5 text-[10px] text-accent font-medium truncate">{provider}</p>}

      {reason && <p className="mt-1 text-[10px] text-muted-foreground leading-snug line-clamp-2">{reason}</p>}

      {/* Always rendered, never hover-gated: as a hover overlay these were
          completely unreachable on touch devices and undiscoverable on desktop,
          which read as "there's no way to add anything". */}
      {hasActions && (
        <div className="flex items-center gap-1.5 mt-2">
          {onAddToWatchlist && (
            <ActionButton
              onClick={onAddToWatchlist}
              icon={<Plus size={13} strokeWidth={2.5} />}
              label="Add"
              className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-accent text-accent-foreground text-[11px] font-semibold leading-none hover:brightness-110"
              successClassName="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-watched/20 text-watched text-[11px] font-semibold leading-none"
            />
          )}
          {onAddToWatchLater && (
            <ActionButton
              onClick={onAddToWatchLater}
              icon={<Clock size={13} />}
              label=""
              ariaLabel="Add to Watch Later"
              className="inline-flex items-center justify-center w-9 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-card-hover"
              successClassName="inline-flex items-center justify-center w-9 py-2 rounded-lg bg-watched/20 text-watched"
            />
          )}
          {onToggleWatched && <WatchedToggle watched={watched} onToggle={onToggleWatched} />}
        </div>
      )}
    </div>
  );

  if (linkTo) {
    return <Link to={linkTo}>{poster}</Link>;
  }
  return poster;
}

import { Link } from "react-router-dom";
import type { ReleaseItem } from "@/types/digest";
import { Eye, Clock, Plus, Star, ImageOff, X } from "lucide-react";
import { ActionButton } from "@/components/watchlist/ActionButton";
import { tmdbPoster } from "@/lib/tmdbImage";

interface ReleaseCardProps {
  item: ReleaseItem;
  onAddToWatchlist?: () => void;
  onAddToWatchLater?: () => void;
  onMarkWatched?: () => void;
  onRemove?: () => void;
  onAddToList?: () => void;
  /** Rendered at the end of the action row. Used by the Watched list for
   * the thumbs, which only make sense once a title has been seen. */
  extraActions?: React.ReactNode;
  compact?: boolean;
  showActions?: boolean;
  dragHandle?: React.ReactNode;
  index?: number;
  /** Internal route (e.g. /title/movie/550) to link the whole card to. When
   * omitted the card renders as a plain div — used by watchlist contexts
   * where the card's job is showing actions, not navigating away. */
  linkTo?: string;
  /** TV only, from the seasons cache; null while loading or unknown. */
  seasons?: number | null;
  /** Live-fetched platform names, when the item itself doesn't already carry
   * them. Falls back to `item.providers` when omitted. */
  providers?: string[];
}

export function ReleaseCard({
  item, onAddToWatchlist, onAddToWatchLater, onMarkWatched,
  onRemove, onAddToList, compact, showActions = true, dragHandle, index, linkTo, seasons, providers,
  extraActions,
}: ReleaseCardProps) {
  const year = item.releaseDate?.slice(0, 4);
  const providerLabel = (providers ?? item.providers ?? []).slice(0, 3).join(", ");
  // Box is 48px, 56px from sm: up. 1x/2x is handled inside tmdbPoster (via
  // srcSet), so passing the smaller width here is deliberate — it's the base
  // the 2x bucket doubles from, not a cap.
  const poster = tmdbPoster(item.posterUrl, 48);

  const body = (
    <>
      {dragHandle}
      {index !== undefined && (
        <div className="flex items-center justify-center w-6 text-muted-foreground font-display text-lg font-bold shrink-0 select-none leading-none">
          {index + 1}
        </div>
      )}
      {/* Poster */}
      <div className="w-[48px] h-[72px] sm:w-[56px] sm:h-[84px] rounded-lg overflow-hidden bg-secondary shrink-0">
        {poster ? (
          <img
            src={poster.src}
            srcSet={poster.srcSet}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="no-poster-stripes w-full h-full rounded-lg border border-dashed border-muted-foreground/40 flex items-center justify-center text-muted-foreground">
            <ImageOff size={18} className="shrink-0" />
          </div>
        )}
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
        <h3 className="font-medium text-sm text-foreground leading-tight line-clamp-2">{item.title}</h3>
        <div className="flex items-center gap-2 leading-none flex-wrap">
          {year && <span className="text-[11px] text-muted-foreground">{year}</span>}
          <span
            className={`inline-flex items-center text-[10px] font-semibold uppercase leading-none ${
              item.mediaType === "tv" ? "text-accent" : "text-muted-foreground"
            }`}
          >
            {item.mediaType === "tv" ? "TV" : "Film"}
          </span>
          {item.mediaType === "tv" && seasons != null && (
            <span className="text-[11px] text-muted-foreground">
              {seasons} {seasons === 1 ? "Season" : "Seasons"}
            </span>
          )}
          {item.rating != null && item.rating > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-gold leading-none">
              <Star size={10} fill="currentColor" className="shrink-0" />
              {item.rating.toFixed(1)}
            </span>
          )}
        </div>
        {providerLabel && <p className="text-[11px] text-accent font-medium">{providerLabel}</p>}
        {!compact && item.overview && (
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{item.overview}</p>
        )}
        {/* Actions */}
        {showActions && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {onAddToWatchlist && (
              <ActionButton
                onClick={onAddToWatchlist}
                icon={<Plus size={11} strokeWidth={2.5} className="shrink-0" />}
                label="Watchlist"
                className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg bg-accent/15 text-accent text-[11px] font-semibold leading-none hover:bg-accent/25 active:scale-95"
                successClassName="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg bg-watched/20 text-watched text-[11px] font-semibold leading-none"
              />
            )}
            {onAddToWatchLater && (
              <ActionButton
                onClick={onAddToWatchLater}
                icon={<Clock size={11} className="shrink-0" />}
                label="Later"
                className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg bg-secondary text-secondary-foreground text-[11px] font-medium leading-none hover:bg-card-hover active:scale-95"
                successClassName="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg bg-watched/20 text-watched text-[11px] font-medium leading-none"
              />
            )}
            {onMarkWatched && (
              <ActionButton
                onClick={onMarkWatched}
                icon={<Eye size={11} className="shrink-0" />}
                label="Watched"
                className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg bg-watched/15 text-watched text-[11px] font-semibold leading-none hover:bg-watched/25 active:scale-95"
                successClassName="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg bg-watched/20 text-watched text-[11px] font-semibold leading-none"
              />
            )}
            {extraActions}
            {onAddToList && (
              <button
                onClick={onAddToList}
                className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg bg-secondary text-secondary-foreground text-[11px] font-medium leading-none hover:bg-card-hover active:scale-95 transition-all"
              >
                <Plus size={11} className="shrink-0" /> List
              </button>
            )}
            {onRemove && (
              <button
                onClick={onRemove}
                className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg bg-danger/10 text-danger text-[11px] font-medium leading-none hover:bg-danger/20 active:scale-95 transition-all"
              >
                <X size={11} className="shrink-0" /> Remove
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );

  const className =
    "group flex items-start gap-3 p-3 bg-card rounded-xl border border-border hover:border-accent/30 hover:bg-card-hover transition-all duration-200";

  if (linkTo) {
    return (
      <Link to={linkTo} className={className}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}

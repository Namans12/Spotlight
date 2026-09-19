import { type ReleaseItem, toMovie } from "@/types/digest";
import { PosterCard } from "./PosterCard";
import type { RatingLookup } from "@/hooks/useRatings";
import { useSeasons } from "@/hooks/useSeasons";
import { useWatchlistContext } from "@/contexts/WatchlistContext";

interface ReleaseGridProps {
  items: ReleaseItem[];
  linkBase?: string; // e.g. "/title" -> links to `${linkBase}/${mediaType}/${id}`
  // Passed down from the page rather than fetched here: a page can render
  // many grids (one per provider group), and calling useRatings per grid
  // turns one page load into 10-20 separate ratings requests instead of one.
  ratingFor: RatingLookup;
}

export function ReleaseGrid({ items, linkBase, ratingFor }: ReleaseGridProps) {
  const wl = useWatchlistContext();
  const seasonsFor = useSeasons(items);

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4">
      {items.map((item) => (
        <PosterCard
          key={`${item.mediaType}-${item.id}`}
          item={item}
          rating={ratingFor(item.mediaType, item.id)}
          seasons={seasonsFor(item.mediaType, item.id)}
          linkTo={linkBase ? `${linkBase}/${item.mediaType}/${item.id}` : undefined}
          // The home digest previously rendered no add controls at all, so the
          // main page offered no way to save anything.
          onAddToWatchlist={() => wl.addToWatchlist(toMovie(item))}
          onAddToWatchLater={() => wl.addToWatchLater(toMovie(item))}
          onToggleWatched={() => wl.toggleWatched(toMovie(item))}
          watched={wl.isWatched(item.mediaType, item.id)}
        />
      ))}
    </div>
  );
}

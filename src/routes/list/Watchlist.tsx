import { useOutletContext } from 'react-router-dom';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { WatchlistView } from '@/components/watchlist/WatchlistView';
import type { Movie } from '@/types/movie';

interface ListOutletContext {
  setAddToListMovie: (movie: Movie | null) => void;
}

export default function Watchlist() {
  const wl = useWatchlistContext();
  const { setAddToListMovie } = useOutletContext<ListOutletContext>();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-foreground">Watch Queue</h2>
        <span className="text-xs text-muted-foreground">{wl.watchlist.length} titles</span>
      </div>
      <WatchlistView
        showWatchNow
        items={wl.watchlist}
        onReorder={wl.reorderWatchlist}
        onMarkWatched={wl.markWatched}
        onRemove={wl.removeFromList}
        onAddToWatchLater={(dbId) => {
          const m = wl.watchlist.find((i) => i.dbId === dbId);
          if (m) wl.addToWatchLater(m);
        }}
        onAddToList={(dbId) => {
          const m = wl.watchlist.find((i) => i.dbId === dbId);
          if (m) setAddToListMovie(m);
        }}
        emptyMessage="Search and add movies to your watchlist"
      />
    </div>
  );
}

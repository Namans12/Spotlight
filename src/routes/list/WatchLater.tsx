import { useOutletContext } from 'react-router-dom';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { WatchlistView } from '@/components/watchlist/WatchlistView';
import type { Movie } from '@/types/movie';

interface ListOutletContext {
  setAddToListMovie: (movie: Movie | null) => void;
}

export default function WatchLater() {
  const wl = useWatchlistContext();
  const { setAddToListMovie } = useOutletContext<ListOutletContext>();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-foreground">Watch Later</h2>
        <span className="text-xs text-muted-foreground">{wl.watchLater.length} saved</span>
      </div>
      <WatchlistView
        showWatchNow
        items={wl.watchLater}
        onReorder={wl.reorderWatchLater}
        onMarkWatched={wl.markWatched}
        onRemove={wl.removeFromList}
        onAddToList={(dbId) => {
          const m = wl.watchLater.find((i) => i.dbId === dbId);
          if (m) setAddToListMovie(m);
        }}
        emptyMessage="Save titles for later"
      />
    </div>
  );
}

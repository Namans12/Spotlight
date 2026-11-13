import { useOutletContext } from 'react-router-dom';
import { useWatchlistContext } from '@/contexts/watchlist-context';
import { WatchedList } from '@/components/watchlist/WatchedList';
import type { Movie } from '@/types/movie';

interface ListOutletContext {
  setAddToListMovie: (movie: Movie | null) => void;
}

export default function Watched() {
  const wl = useWatchlistContext();
  const { setAddToListMovie } = useOutletContext<ListOutletContext>();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-foreground">Watched</h2>
        <span className="text-xs text-muted-foreground">{wl.watched.length} completed</span>
      </div>
      <WatchedList
        items={wl.watched}
        onRemove={wl.removeFromList}
        onMoveBack={wl.moveToWatchlist}
        onAddToWatchLater={(dbId) => {
          const m = wl.watched.find((i) => i.dbId === dbId);
          if (m) wl.addToWatchLater(m);
        }}
        onAddToList={(dbId) => {
          const m = wl.watched.find((i) => i.dbId === dbId);
          if (m) setAddToListMovie(m);
        }}
      />
    </div>
  );
}

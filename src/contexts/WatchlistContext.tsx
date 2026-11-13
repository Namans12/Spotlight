import { type ReactNode } from 'react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { WatchlistContext } from './watchlist-context';

// useWatchlist() must only be instantiated once — calling it in multiple
// route components would each load their own copy of localStorage state and
// drift out of sync. Every route reads the shared instance via useWatchlistContext().
export function WatchlistProvider({ children }: { children: ReactNode }) {
  const watchlist = useWatchlist();
  return <WatchlistContext.Provider value={watchlist}>{children}</WatchlistContext.Provider>;
}

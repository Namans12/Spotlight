import { createContext, useContext } from 'react';
import { useWatchlist } from '@/hooks/useWatchlist';

export type WatchlistContextValue = ReturnType<typeof useWatchlist>;
export const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function useWatchlistContext(): WatchlistContextValue {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error('useWatchlistContext must be used within a WatchlistProvider');
  return ctx;
}

import { vi } from 'vitest';
import type { WatchlistItem } from '@/types/movie';

/**
 * One stand-in for the watchlist context, shared by every suite that renders a
 * component containing a poster card.
 *
 * Three test files used to declare their own partial version of this inline,
 * each listing only the two or three fields it happened to need. Adding
 * `isWatched` to the context broke two suites that have nothing to do with
 * marking titles seen — they were rendering a card that had started asking a
 * question their stub could not answer. A stub that is missing a field fails
 * with `wl.x is not a function` from inside React's render, which points at
 * react-dom rather than at the stub.
 *
 * So: one object, complete, in one place. A new context field is added here
 * once and every suite keeps working.
 *
 * `vi.mock` factories are hoisted above imports, so a suite reaches this
 * through an async factory:
 *
 *     vi.mock('@/contexts/WatchlistContext', async () => {
 *       const { watchlistStub } = await import('@/test/watchlistStub');
 *       return { useWatchlistContext: () => watchlistStub };
 *     });
 */
export const watchlistStub = {
  watchlist: [] as WatchlistItem[],
  watched: [] as WatchlistItem[],
  watchLater: [] as WatchlistItem[],
  customLists: [],
  customListItems: {} as Record<number, WatchlistItem[]>,
  isLoading: false,

  addToWatchlist: vi.fn(),
  addToWatchLater: vi.fn(),
  markWatched: vi.fn(),
  toggleWatched: vi.fn(),
  removeFromList: vi.fn(),
  moveToWatchlist: vi.fn(),
  reorderWatchlist: vi.fn(),
  reorderWatchLater: vi.fn(),
  createList: vi.fn(),
  deleteList: vi.fn(),
  addToCustomList: vi.fn(),
  removeFromCustomList: vi.fn(),

  isWatched: vi.fn((_mediaType: string, _tmdbId: number) => false),
  watchedKeys: new Set<string>(),

  progress: {} as Record<string, { season: number; episode: number }>,
  progressFor: vi.fn((_tmdbId: number) => null as { season: number; episode: number } | null),
  setProgress: vi.fn(),
};

/** Call from `beforeEach`. Resets call history and the "nothing is seen"
 *  default, so one suite's arrangement cannot leak into the next test. */
export function resetWatchlistStub() {
  for (const value of Object.values(watchlistStub)) {
    if (typeof value === 'function' && 'mockReset' in value) {
      (value as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  watchlistStub.isWatched.mockReturnValue(false);
  watchlistStub.progressFor.mockReturnValue(null);
  watchlistStub.watched = [];
  watchlistStub.watchedKeys = new Set<string>();
  watchlistStub.progress = {};
}

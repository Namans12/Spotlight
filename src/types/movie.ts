export interface Movie {
  id: number; // TMDB id — NOT unique alone, always pair with mediaType
  title: string;
  posterPath: string | null;
  backdropPath?: string | null;
  overview: string;
  releaseDate: string;
  mediaType: 'movie' | 'tv';
  voteAverage: number;
  originalLanguage: string;
}

/** A "You may also like" entry: a Movie plus why it was chosen.
 *
 * `reasons` is the point of the shape — a recommendation that can say "also
 * stars Ranbir Kapoor" is a suggestion, and one that can't is just another
 * poster. Empty when the only evidence was behavioural (TMDB's own
 * /recommendations), which has nothing specific to report. */
export interface Recommendation extends Movie {
  reasons: string[];
  score: number;
}

export interface WatchlistItem extends Movie {
  dbId: number; // server-assigned watchlist_items.id — the real identity for mutations
  addedAt: number;
  listId?: number;
}

export interface CustomList {
  id: number;
  name: string;
  createdAt: number;
}

export interface WatchlistState {
  watchlist: WatchlistItem[];
  watched: WatchlistItem[];
  watchLater: WatchlistItem[];
  customLists: CustomList[];
  customListItems: Record<number, WatchlistItem[]>;
}

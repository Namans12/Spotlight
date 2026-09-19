export type Bucket = "watchlist" | "watchLater" | "watched" | "custom";
export type MediaType = "movie" | "tv";

export interface WatchlistItemDTO {
  dbId: number;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  releaseDate: string;
  voteAverage: number;
  originalLanguage: string;
  bucket: Bucket;
  listId: number | null;
  addedAt: number; // epoch ms
}

export interface CustomListDTO {
  id: number;
  name: string;
  createdAt: number; // epoch ms
}

/** Where an account is up to in one series. The last episode watched, not the
 *  next one — see src/lib/progress.ts on why absence means "not started". */
export interface ProgressDTO {
  tmdbId: number;
  mediaType: MediaType;
  season: number;
  episode: number;
}

/** Keyed "tv:1396", the same shape the ratings and providers caches use. */
export type ProgressMap = Record<string, { season: number; episode: number }>;

/** Keyed "movie:920"; true for liked, false for disliked. A title nobody has
 *  an opinion about is absent, which is not the same as indifferent. */
export type OpinionMap = Record<string, boolean>;

export interface WatchlistStateDTO {
  watchlist: WatchlistItemDTO[];
  watchLater: WatchlistItemDTO[];
  watched: WatchlistItemDTO[];
  customLists: CustomListDTO[];
  customListItems: Record<number, WatchlistItemDTO[]>;
  /** Series progress, delivered with the list rather than as a second request:
   *  it is read on exactly the same screens and is a handful of rows. */
  progress: ProgressMap;
  /** Thumbs, same reasoning — and the taste profile needs all of them at once
   *  rather than one at a time. */
  opinions: OpinionMap;
}

export interface AddWatchlistItemBody {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath?: string | null;
  overview: string;
  releaseDate: string;
  voteAverage: number;
  originalLanguage: string;
  bucket: Bucket;
  listId?: number;
}

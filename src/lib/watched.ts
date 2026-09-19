import type { Movie, WatchlistItem } from '@/types/movie';

/**
 * "I've seen this."
 *
 * The `watched` bucket has existed since the first version of the watchlist,
 * and it has four rows in production across four accounts. Not because nobody
 * finishes anything — because the only way to reach it was to *first* save a
 * title as "to watch" and then move it. Almost everything a person has seen,
 * they saw before they ever found this site, so the bucket could only ever
 * collect the small tail of things watched after saving them.
 *
 * These helpers exist so that marking a title watched is a property of the
 * title, answerable anywhere a poster is rendered, rather than a property of a
 * row that may not exist yet.
 *
 * A TMDB id is only unique within its media type — there is a film 1396 and a
 * series 1396 — so every lookup here is keyed on the pair. Getting this wrong
 * is silent and looks like a haunting: mark a film seen, and some unrelated
 * show goes grey.
 */
export function titleKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/** One pass over the watched bucket, so a grid of forty posters does forty set
 *  lookups rather than forty linear scans. */
export function watchedKeys(watched: WatchlistItem[]): Set<string> {
  return new Set(watched.map((item) => titleKey(item.mediaType, item.id)));
}

export function isWatched(keys: Set<string>, mediaType: string, tmdbId: number): boolean {
  return keys.has(titleKey(mediaType, tmdbId));
}

/**
 * Drops titles the reader has already seen.
 *
 * Only for *recommendation* surfaces. A factual listing — what landed on
 * Netflix this week, a franchise's watch order, search results — must still
 * show a title you have seen, because its job is to be complete rather than
 * to be a suggestion. Those surfaces mark it seen instead.
 *
 * This is also the answer to "should watched titles rank lower": no. A
 * suggestion you have already taken is not a weaker suggestion, it is not a
 * suggestion at all.
 */
export function withoutWatched<T extends { id: number; mediaType: string }>(
  items: T[],
  keys: Set<string>,
): T[] {
  if (keys.size === 0) return items;
  return items.filter((item) => !isWatched(keys, item.mediaType, item.id));
}

/** The watched entry for a title, when there is one. Callers need the `dbId`
 *  to un-mark it, which is the only identifier the delete endpoint accepts. */
export function findWatched(
  watched: WatchlistItem[],
  movie: Pick<Movie, 'id' | 'mediaType'>,
): WatchlistItem | undefined {
  return watched.find((item) => item.id === movie.id && item.mediaType === movie.mediaType);
}

export interface TitleRating {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  imdbId: string | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  rtScore: number | null;
  metacritic: number | null;
  fetchedAt: string;
  stale: boolean;
}

export function ratingKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/** True when there is actually something to render. The product rule is that a
 * title with no critic score at all shows nothing — no placeholder, no
 * "unrated". Metacritic counts: it is a real published score, and a handful of
 * titles (mostly older and non-English ones) carry it when OMDb has neither an
 * IMDb rating nor a Tomatometer. */
export function hasAnyScore(rating: TitleRating | null | undefined): boolean {
  return Boolean(
    rating && (rating.imdbRating != null || rating.rtScore != null || rating.metacritic != null),
  );
}

/** Rotten Tomatoes' own Fresh/Rotten boundary. 60 exactly is Fresh. */
export function rtIsFresh(score: number): boolean {
  return score >= 60;
}

/** Metacritic's own colour bands, which is what makes the square legible at a
 *  glance without reading the number: green 61+, yellow 40–60, red below. */
export function metacriticBand(score: number): 'good' | 'mixed' | 'poor' {
  if (score >= 61) return 'good';
  if (score >= 40) return 'mixed';
  return 'poor';
}

/** Single title — the only path allowed to spend an OMDb call, and only on a
 * genuine cache miss. Used by title detail pages. */
export async function fetchRating(mediaType: string, tmdbId: number): Promise<TitleRating | null> {
  const res = await fetch(`/api/ratings?type=${mediaType}&id=${tmdbId}`);
  if (!res.ok) return null;
  return res.json();
}

/** Cache-only batch read for grids — never triggers an OMDb call, so a page of
 * 40 posters costs one query and zero API budget. */
export async function fetchRatingsBatch(
  keys: { mediaType: string; tmdbId: number }[],
): Promise<Record<string, TitleRating | null>> {
  if (keys.length === 0) return {};
  const ids = keys.slice(0, 100).map((k) => ratingKey(k.mediaType, k.tmdbId)).join(',');
  const res = await fetch(`/api/ratings?ids=${encodeURIComponent(ids)}`);
  if (!res.ok) return {};
  return res.json();
}

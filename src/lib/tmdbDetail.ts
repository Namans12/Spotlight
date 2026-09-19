export interface TitleDetail {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  overview: string;
  posterPath: string | null;
  posterUrl: string | null;
  backdropPath: string | null;
  backdropUrl: string | null;
  releaseDate: string;
  rating: number | null;
  runtime: number | null;
  genres: string[];
  providers: string[];
  tmdbUrl: string;
  originalLanguage: string;
  /** TV only; null for movies and for a show TMDB has no season count for. */
  numberOfSeasons: number | null;
  /** TV only. */
  numberOfEpisodes: number | null;
  tagline: string | null;
  status: string | null;
  /** Age rating plus the country whose board issued it. */
  certification: { value: string; region: string } | null;
  /** Movies only, whole US dollars. Null when TMDB doesn't know. */
  budget: number | null;
  revenue: number | null;
}

export async function fetchTitleDetail(mediaType: 'movie' | 'tv', id: number): Promise<TitleDetail> {
  const res = await fetch(`/api/tmdb/detail?type=${mediaType}&id=${id}`);
  if (!res.ok) throw new Error(`Failed to load title: ${res.status}`);
  return res.json();
}

export function titleDetailToMovie(detail: TitleDetail) {
  return {
    id: detail.id,
    title: detail.title,
    posterPath: detail.posterPath,
    backdropPath: detail.backdropPath,
    overview: detail.overview,
    releaseDate: detail.releaseDate,
    mediaType: detail.mediaType,
    voteAverage: detail.rating ?? 0,
    originalLanguage: detail.originalLanguage,
  };
}

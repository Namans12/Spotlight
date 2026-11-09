import type { ReleaseItemDTO, ReleaseEvidenceDTO, DigestResponse, SectionKey } from "../../shared/types/release";
import type { Movie } from "./movie";
import { IMG_BASE } from "@/lib/tmdb";

export type { SectionKey, DigestResponse };

/** Canonical shape for anything rendered as a release/movie/show card —
 * digest items, TMDB search/trending results, and watchlist entries all
 * adapt into this one shape so a single ReleaseCard can render any of them. */
export interface ReleaseItem {
  id: number;
  title: string;
  mediaType: "movie" | "tv";
  releaseDate: string;
  posterUrl?: string | null;
  overview?: string;
  rating?: number;
  providers?: string[];
  tmdbUrl?: string;
  evidence?: ReleaseEvidenceDTO | null;
}

export function tmdbUrlFor(mediaType: "movie" | "tv", id: number): string {
  return `https://www.themoviedb.org/${mediaType === "movie" ? "movie" : "tv"}/${id}`;
}

export function fromDigestDTO(dto: ReleaseItemDTO): ReleaseItem {
  return {
    id: dto.tmdb_id,
    title: dto.title,
    mediaType: dto.media_type,
    releaseDate: dto.release_date,
    posterUrl: dto.poster_url,
    overview: dto.overview,
    rating: dto.rating ?? undefined,
    providers: dto.providers,
    tmdbUrl: dto.tmdb_url,
    // Cached older API payloads have no provenance; show an explicit unknown state.
    evidence: dto.evidence ?? {},
  };
}

/** Reverse of `fromMovie`, for adding a digest/calendar card to the watchlist.
 * The watchlist API stores poster paths, not URLs, so the TMDB image prefix is
 * stripped back off. */
export function toMovie(item: ReleaseItem): Movie {
  return {
    id: item.id,
    title: item.title,
    mediaType: item.mediaType,
    releaseDate: item.releaseDate,
    posterPath: item.posterUrl ? item.posterUrl.replace(/^https?:\/\/image\.tmdb\.org\/t\/p\/\w+/, "") : null,
    backdropPath: null,
    overview: item.overview ?? "",
    voteAverage: item.rating ?? 0,
    originalLanguage: "",
  };
}

export function fromMovie(movie: Movie): ReleaseItem {
  return {
    id: movie.id,
    title: movie.title,
    mediaType: movie.mediaType,
    releaseDate: movie.releaseDate,
    posterUrl: movie.posterPath ? `${IMG_BASE}${movie.posterPath}` : undefined,
    overview: movie.overview,
    rating: movie.voteAverage || undefined,
    tmdbUrl: tmdbUrlFor(movie.mediaType, movie.id),
  };
}

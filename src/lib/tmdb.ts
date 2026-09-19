import { Movie, Recommendation } from '@/types/movie';

export const IMG_BASE = 'https://image.tmdb.org/t/p/w342';
export const IMG_LARGE = 'https://image.tmdb.org/t/p/w500';
export const IMG_BACKDROP = 'https://image.tmdb.org/t/p/w1280';

interface ProxyResult {
  id: number;
  title: string;
  mediaType: 'movie' | 'tv';
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  releaseDate: string;
  voteAverage: number;
  originalLanguage: string;
}

function toMovie(r: ProxyResult): Movie {
  return {
    id: r.id,
    title: r.title,
    posterPath: r.posterPath,
    backdropPath: r.backdropPath,
    overview: r.overview,
    releaseDate: r.releaseDate,
    mediaType: r.mediaType,
    voteAverage: r.voteAverage,
    originalLanguage: r.originalLanguage,
  };
}

async function fetchProxy(path: string): Promise<Movie[]> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const data: ProxyResult[] = await res.json();
  return data.map(toMovie);
}

// The TMDB key lives server-side only (see api/tmdb/*.ts) — the browser never
// needs one, so these functions no longer take an apiKey parameter.
export async function searchMovies(query: string): Promise<Movie[]> {
  if (!query.trim()) return [];
  return fetchProxy(`/api/tmdb/search?q=${encodeURIComponent(query)}`);
}

export async function getTrending(): Promise<Movie[]> {
  return fetchProxy('/api/tmdb/trending');
}

export async function getPopularMovies(): Promise<Movie[]> {
  return fetchProxy('/api/tmdb/popular-movies');
}

export async function getPopularTV(): Promise<Movie[]> {
  return fetchProxy('/api/tmdb/popular-tv');
}

export type MediaType = 'movie' | 'tv';

export async function getRecommendations(type: MediaType, id: number): Promise<Movie[]> {
  return fetchProxy(`/api/tmdb/recommendations?type=${type}&id=${id}`);
}

export async function getSimilar(type: MediaType, id: number): Promise<Movie[]> {
  return fetchProxy(`/api/tmdb/similar?type=${type}&id=${id}`);
}

export interface CreditsPerson {
  id: number;
  name: string;
  /** Bare TMDB path — size it with tmdbProfile() before rendering. */
  profilePath: string | null;
}

export interface CastMember extends CreditsPerson {
  character: string | null;
}

export interface Credits {
  cast: CastMember[];
  directors: CreditsPerson[];
}

export async function getCredits(type: MediaType, id: number): Promise<Credits> {
  const res = await fetch(`/api/tmdb/credits?type=${type}&id=${id}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export interface PersonCredit extends Movie {
  /** Character played, or crew job. */
  role: string | null;
  /** Ordering signal only — the server has already sorted by it. */
  popularity: number;
}

export interface Person {
  id: number;
  name: string;
  profilePath: string | null;
  biography: string;
  knownFor: string | null;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  credits: PersonCredit[];
}

export async function getPerson(id: number): Promise<Person> {
  const res = await fetch(`/api/tmdb/person?id=${id}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export async function discover(
  type: MediaType,
  opts: { genres?: string; cast?: string; crew?: string },
): Promise<Movie[]> {
  const qs = new URLSearchParams({ type });
  if (opts.genres) qs.set('genres', opts.genres);
  if (opts.cast) qs.set('cast', opts.cast);
  if (opts.crew) qs.set('crew', opts.crew);
  return fetchProxy(`/api/tmdb/discover?${qs.toString()}`);
}

/** "You may also like".
 *
 * One request. The ranking — and the seven or eight TMDB calls behind it —
 * happens server-side in api/tmdb/[...path].ts, so the browser makes a single
 * edge-cached round trip and the TMDB key stays on the server. See
 * lib/recommendations.ts for how candidates are gathered and scored.
 *
 * `originalLanguage` is no longer a parameter: language is one of the signals
 * the ranker weighs, and it reads it from the title's own TMDB record rather
 * than needing the caller to have fetched it first. */
export async function getYouMayAlsoLike(type: MediaType, id: number): Promise<Recommendation[]> {
  const res = await fetch(`/api/tmdb/you-may-also-like?type=${type}&id=${id}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const data: (ProxyResult & { reasons?: string[]; score?: number })[] = await res.json();
  // Not fetchProxy: toMovie normalises to exactly the Movie fields, which
  // would drop the reasons this endpoint exists to carry.
  return data.map((r) => ({
    ...toMovie(r),
    reasons: Array.isArray(r.reasons) ? r.reasons : [],
    score: typeof r.score === "number" ? r.score : 0,
  }));
}

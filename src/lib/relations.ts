import type { Movie } from '@/types/movie';
import { fetchJson } from '@/lib/http';

/** Mirrors MAX_DEPTH in lib/relationsDb.ts — the depth the connections view
 * requests, since a timeline's whole job is to show the complete chain.
 * Keep the two in step: the server clamps to its own value, so a larger
 * number here is silently ignored and a smaller one truncates. */
export const MAX_DEPTH = 12;

export interface RelatedTitle {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  reason: string | null;
  source: 'tmdb' | 'wikidata' | 'seed' | 'llm';
  hop: number;
}

/** The viewed title's own display fields, recovered server-side from the
 * reciprocal edges pointing back at it — so the connections view can render
 * its "you are here" node without depending on TMDB. */
export interface RelationOrigin {
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
}

export interface TitleRelations {
  mustWatch: { before: RelatedTitle[]; after: RelatedTitle[] };
  canWatch: RelatedTitle[];
  origin: RelationOrigin | null;
  depth: number;
  hasMore: boolean;
}

export async function fetchRelations(
  mediaType: 'movie' | 'tv',
  id: number,
  depth = 1,
): Promise<TitleRelations | null> {
  // Returning `undefined` here used to make React Query fail the query with
  // "data is undefined" and burn its whole retry budget, so a single 504 became
  // a minute of spinner and then a page confidently claiming the title stands
  // alone. Throw on failure so `isError` can say so, and use `null` for the
  // legitimate "no relations known" answer the API sends.
  return fetchJson<TitleRelations | null>(
    `/api/relations?type=${mediaType}&id=${id}&depth=${depth}`,
  );
}

/** Thumbs-down: hides one edge for good. Owner-only server-side, and the only
 * way to correct a structured edge — the generators' precedence ladder means a
 * lower-trust source can never overwrite a higher-trust one. No un-suppress in
 * v1; reversing it is a one-line SQL update on a single-owner app. */
export async function suppressRelation(
  from: { mediaType: 'movie' | 'tv'; tmdbId: number },
  to: { mediaType: 'movie' | 'tv'; tmdbId: number },
): Promise<void> {
  const res = await fetch('/api/relations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, action: 'suppress' }),
  });
  if (!res.ok) throw new Error(`Could not hide this suggestion (${res.status})`);
}

/** True when there is nothing at all to render — both sections hidden. */
export function hasAnyRelations(r: TitleRelations | undefined): boolean {
  if (!r) return false;
  return r.mustWatch.before.length > 0 || r.mustWatch.after.length > 0 || r.canWatch.length > 0;
}

/** True when this title sits in a continuity chain, i.e. the connections view
 * has a timeline worth showing. `can` edges alone don't qualify — they have no
 * order to plot. */
export function hasChain(r: TitleRelations | undefined): boolean {
  if (!r) return false;
  return r.mustWatch.before.length > 0 || r.mustWatch.after.length > 0;
}

/** Reverses the server's posterUrl composition to recover posterPath, the
 * shape Movie (and every watchlist mutation) expects. */
export function relatedToMovie(related: RelatedTitle): Movie {
  return {
    id: related.tmdbId,
    title: related.title,
    mediaType: related.mediaType,
    releaseDate: related.releaseDate ?? '',
    posterPath: related.posterUrl ? related.posterUrl.replace(/^https?:\/\/image\.tmdb\.org\/t\/p\/\w+/, '') : null,
    backdropPath: null,
    overview: '',
    voteAverage: 0,
    originalLanguage: '',
  };
}

export { formatDayMonthYear as formatReleaseDate } from './utils';

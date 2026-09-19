import type { Movie } from '@/types/movie';
import { RUNTIME_BANDS } from '@/lib/watchNow';

/**
 * How this app describes a title's *character*, as opposed to its identity.
 *
 * Lifted out of the duel, which invented this vocabulary, because taste needs
 * to speak the same language: a thumbs-up has to mean the same thing as a
 * duel pick or the two signals cannot be compared, and two near-identical
 * copies of "what a preference can be about" would drift within a month.
 */

export interface Attributed extends Movie {
  genres?: string[];
  runtime?: number;
}

function decadeOf(releaseDate: string | undefined): string | null {
  if (!releaseDate || releaseDate.length < 4) return null;
  const year = Number(releaseDate.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

function runtimeBandOf(runtime: number | undefined): string | null {
  if (!runtime) return null;
  return RUNTIME_BANDS.find((band) => runtime >= band.min && runtime < band.max)?.id ?? null;
}

/**
 * The things about a title that a preference could be *about*.
 *
 * Deliberately coarse. "Thriller" and "2010s" are things someone can have a
 * taste in; a vote average or a TMDB id is not, and including finer attributes
 * would let the scoring latch onto coincidences — neither a handful of duel
 * picks nor a handful of thumbs is enough signal to support more dimensions
 * than this.
 */
export function attributeKeys(candidate: Attributed): string[] {
  const keys: string[] = [];
  for (const genre of candidate.genres ?? []) keys.push(`genre:${genre}`);
  if (candidate.originalLanguage) keys.push(`lang:${candidate.originalLanguage}`);
  keys.push(`type:${candidate.mediaType}`);

  const decade = decadeOf(candidate.releaseDate);
  if (decade) keys.push(`decade:${decade}`);

  const band = runtimeBandOf(candidate.runtime);
  if (band) keys.push(`runtime:${band}`);

  return keys;
}



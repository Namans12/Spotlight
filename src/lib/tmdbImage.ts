/**
 * Right-sizing for TMDB images.
 *
 * Poster URLs reach the browser with a size already baked in, and it is almost
 * never the size we render at: releasebot.py:374 stores full `/t/p/w500/...`
 * URLs in Postgres, and lib/tmdbProxy.ts hands out w500 for live search/browse
 * results. Meanwhile the same URL gets rendered at 36px in the calendar, 48px
 * on a compact row, and ~150px in a grid. A w500 poster is ~70KB; the w92 the
 * calendar actually needs is ~6.7KB.
 *
 * Rather than migrate stored data (which would still leave one size serving
 * every consumer), this rewrites the size segment at render time. Each call
 * site asks for the width it actually displays. The regex trick is the same one
 * src/types/digest.ts:49 already uses to recover a bare path from a stored URL.
 */

/** TMDB's poster buckets, ascending. Backdrops use a different set. */
const POSTER_WIDTHS = [92, 154, 185, 342, 500, 780] as const;
const BACKDROP_WIDTHS = [300, 780, 1280] as const;
/** Profile photos have only two width buckets — w45 and w185 — and w45 is far
 *  too small even for a 48px avatar at 2x, so a cast row lands on w185 either
 *  way. Listed rather than assumed so the srcSet logic stays honest about it. */
const PROFILE_WIDTHS = [45, 185] as const;
/** TMDB's logo buckets. Some logo assets are SVG rather than raster — TMDB
 *  serves the same full vector at every bucket URL regardless of the width
 *  requested, at a 200, so sizing one is harmless even though it does
 *  nothing; the code stays uniform rather than needing to know which titles
 *  happen to have vector art. */
const LOGO_WIDTHS = [45, 92, 154, 185, 300, 500] as const;

/** Captures the origin+prefix and the trailing path around the size segment, so
 *  the size can be swapped without caring what it currently is. */
const TMDB_SIZED_URL = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|original)(\/.+)$/;

export interface SizedImage {
  src: string;
  /** Undefined when the 1x and 2x buckets coincide — no point emitting a
   *  srcSet that says the same thing twice. */
  srcSet?: string;
}

function smallestCovering(widths: readonly number[], target: number): number {
  return widths.find((w) => w >= target) ?? widths[widths.length - 1];
}

function resize(
  url: string | null | undefined,
  cssWidth: number,
  widths: readonly number[],
): SizedImage | undefined {
  if (!url) return undefined;

  const match = url.match(TMDB_SIZED_URL);
  // Not a TMDB URL (or not one with a size segment) — hand it back untouched
  // rather than guessing. Watchlist items and seeded relations can carry other
  // shapes, and a broken rewrite is worse than an oversized image.
  if (!match) return { src: url };

  const [, prefix, path] = match;
  const at1x = smallestCovering(widths, cssWidth);
  const at2x = smallestCovering(widths, cssWidth * 2);

  return {
    src: `${prefix}w${at1x}${path}`,
    srcSet:
      at2x === at1x
        ? undefined
        : `${prefix}w${at1x}${path} 1x, ${prefix}w${at2x}${path} 2x`,
  };
}

/**
 * A poster sized for a fixed-width slot.
 *
 * @param cssWidth the width in CSS pixels the image actually renders at — not
 *   the width of the source. Retina is handled via srcSet, so pass the 1x width.
 */
export function tmdbPoster(url: string | null | undefined, cssWidth: number) {
  return resize(url, cssWidth, POSTER_WIDTHS);
}

/** A backdrop sized for a fixed-width slot. Heroes here are 192–320px tall, so
 *  w780 covers them; w1280 (the previous default) is ~36KB of waste per view. */
export function tmdbBackdrop(url: string | null | undefined, cssWidth: number) {
  return resize(url, cssWidth, BACKDROP_WIDTHS);
}

/**
 * A cast/crew photo.
 *
 * Takes a bare TMDB path (`/abc.jpg`) rather than a URL, because that is what
 * the credits endpoints return — there is no stored full URL to rewrite here,
 * so there is nothing to be clever about.
 */
export function tmdbProfile(path: string | null | undefined, cssWidth: number): SizedImage | undefined {
  if (!path) return undefined;
  const clean = path.startsWith('/') ? path : `/${path}`;
  const at1x = smallestCovering(PROFILE_WIDTHS, cssWidth);
  const at2x = smallestCovering(PROFILE_WIDTHS, cssWidth * 2);
  const base = 'https://image.tmdb.org/t/p/';
  return {
    src: `${base}w${at1x}${clean}`,
    srcSet: at2x === at1x ? undefined : `${base}w${at1x}${clean} 1x, ${base}w${at2x}${clean} 2x`,
  };
}

/** A title's own logo/wordmark artwork, sized for the hero. Takes a bare
 *  TMDB path, same as tmdbProfile — there is no stored URL to rewrite. */
export function tmdbLogo(path: string | null | undefined, cssWidth: number): SizedImage | undefined {
  if (!path) return undefined;
  const clean = path.startsWith('/') ? path : `/${path}`;
  const at1x = smallestCovering(LOGO_WIDTHS, cssWidth);
  const at2x = smallestCovering(LOGO_WIDTHS, cssWidth * 2);
  const base = 'https://image.tmdb.org/t/p/';
  return {
    src: `${base}w${at1x}${clean}`,
    srcSet: at2x === at1x ? undefined : `${base}w${at1x}${clean} 1x, ${base}w${at2x}${clean} 2x`,
  };
}

/**
 * A poster for a *fluid* slot, where CSS decides the width (the release grid is
 * 3–7 columns depending on viewport). Emits `w` descriptors and leaves the
 * browser to pick, given a `sizes` attribute the caller must also set.
 */
export function tmdbPosterFluid(
  url: string | null | undefined,
  candidateWidths: readonly number[] = [154, 185, 342],
): SizedImage | undefined {
  if (!url) return undefined;
  const match = url.match(TMDB_SIZED_URL);
  if (!match) return { src: url };

  const [, prefix, path] = match;
  const buckets = candidateWidths.map((w) => smallestCovering(POSTER_WIDTHS, w));
  const unique = [...new Set(buckets)];

  return {
    // Middle bucket as the no-srcset fallback.
    src: `${prefix}w${unique[Math.floor(unique.length / 2)]}${path}`,
    srcSet: unique.map((w) => `${prefix}w${w}${path} ${w}w`).join(', '),
  };
}

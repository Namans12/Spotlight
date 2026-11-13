// OMDb (https://www.omdbapi.com/) is the source of the IMDb and Rotten Tomatoes
// numbers. Its free tier is 1,000 requests/day for the whole deployment, which
// is why every function here is a *resolver*, never something a grid render can
// reach: callers hit the title_ratings cache first (see lib/ratingsDb.ts) and
// only fall through to this module on a genuine miss.
//
// Nothing here throws. A missing OMDB_API_KEY, a network blip, or a malformed
// payload all resolve to null so ratings stay a decorative overlay — if neither
// IMDb nor RT is available the product shows nothing at all rather than an error.

const OMDB_BASE_URL = "https://www.omdbapi.com/";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const REQUEST_TIMEOUT_MS = 8_000;

export interface OmdbRatings {
  imdbId: string | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  rtScore: number | null;
  metacritic: number | null;
  /** OMDb answered {"Response":"False"} — a definitive "no such title", worth
   *  caching so the same lookup isn't retried on every request. */
  notFound: boolean;
}

/** What we can hand OMDb to identify a title. `imdbId` is strongly preferred:
 *  the `t=`/`y=` fallback is a fuzzy title match and misfires on remakes. */
export interface OmdbLookup {
  imdbId?: string | null;
  title?: string | null;
  year?: string | null;
}

export function omdbConfigured(): boolean {
  return Boolean(process.env.OMDB_API_KEY);
}

function parseNumeric(raw: string, max: number): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned || cleaned.toUpperCase() === "N/A") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > max) return null;
  return value;
}

/** "8.5" or "8.5/10" -> 8.5 (one decimal, matching NUMERIC(3,1)). */
function parseImdbScore(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const value = parseNumeric(raw.split("/")[0], 10);
  return value === null ? null : Math.round(value * 10) / 10;
}

/** "87%" -> 87, "72/100" -> 72. Splitting on "/" before stripping punctuation
 *  matters: a naive digit-strip turns "72/100" into 72100. */
function parsePercentScore(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const head = trimmed.endsWith("%") ? trimmed.slice(0, -1) : trimmed.split("/")[0];
  const value = parseNumeric(head, 100);
  return value === null ? null : Math.round(value);
}

/** "1,234,567" -> 1234567. */
function parseVotes(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const value = parseNumeric(raw, 2_147_483_647);
  return value === null ? null : Math.round(value);
}

function nonEmpty(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === "N/A") return null;
  return trimmed;
}

/** Maps an OMDb payload onto our shape. The `Ratings` array and the top-level
 *  `imdbRating` disagree often enough (one is "N/A" while the other isn't) that
 *  both are read, with the top-level value winning when present. */
export function parseOmdbPayload(payload: unknown): OmdbRatings {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || (payload as Record<string, unknown>).Response === "False") {
    return { imdbId: null, imdbRating: null, imdbVotes: null, rtScore: null, metacritic: null, notFound: true };
  }
  const record = payload as Record<string, unknown>;

  let imdbFromArray: number | null = null;
  let rtScore: number | null = null;
  let metacritic: number | null = null;

  for (const item of Array.isArray(record.Ratings) ? record.Ratings : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    switch (entry.Source) {
      case "Internet Movie Database":
        imdbFromArray = parseImdbScore(entry.Value);
        break;
      case "Rotten Tomatoes":
        rtScore = parsePercentScore(entry.Value);
        break;
      case "Metacritic":
        metacritic = parsePercentScore(entry.Value);
        break;
      default:
        break;
    }
  }

  return {
    imdbId: nonEmpty(record.imdbID),
    imdbRating: parseImdbScore(record.imdbRating) ?? imdbFromArray,
    imdbVotes: parseVotes(record.imdbVotes),
    rtScore,
    metacritic: metacritic ?? parsePercentScore(record.Metascore),
    notFound: false,
  };
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return null;
    const payload: unknown = await res.json();
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  } catch {
    // Transport-level failure. Deliberately indistinguishable from "no key" to
    // callers: both mean "we learned nothing", and neither may be cached.
    return null;
  }
}

/** One OMDb request. Returns null when the answer is unknown (no key, network
 *  error, bad payload) — callers must NOT cache null. A resolved object with
 *  `notFound: true` is a real answer and SHOULD be cached. */
export async function fetchOmdbRatings(lookup: OmdbLookup): Promise<OmdbRatings | null> {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({ apikey: apiKey, r: "json" });
  if (lookup.imdbId) {
    params.set("i", lookup.imdbId);
  } else if (lookup.title) {
    params.set("t", lookup.title);
    if (lookup.year) params.set("y", lookup.year);
  } else {
    return null;
  }

  const payload = await getJson(`${OMDB_BASE_URL}?${params.toString()}`);
  if (!payload) return null;

  const ratings = parseOmdbPayload(payload);
  // A title-based hit still tells us the IMDb id; keep whichever we know so the
  // next refresh can use the exact-match lookup.
  return { ...ratings, imdbId: ratings.imdbId ?? nonEmpty(lookup.imdbId) };
}

/** TMDB -> OMDb bridge. Movies expose `imdb_id` on the detail payload; TV needs
 *  external ids, appended here so it stays one TMDB call either way. Title and
 *  year come back too, as the fallback for titles TMDB has no IMDb id for.
 *  Returns null when TMDB is unreachable or unconfigured. */
export async function resolveOmdbLookup(mediaType: "movie" | "tv", tmdbId: number): Promise<OmdbLookup | null> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;

  const url =
    mediaType === "movie"
      ? `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${apiKey}`
      : `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${apiKey}&append_to_response=external_ids`;

  const payload = await getJson(url);
  if (!payload) return null;

  const externalIds = payload.external_ids;
  const tvImdbId = externalIds && typeof externalIds === "object" && !Array.isArray(externalIds)
    ? (externalIds as Record<string, unknown>).imdb_id : null;
  const imdbId = mediaType === "movie" ? nonEmpty(payload.imdb_id) : nonEmpty(tvImdbId);
  const title = nonEmpty(payload.title) ?? nonEmpty(payload.name);
  const releaseDate = nonEmpty(payload.release_date) ?? nonEmpty(payload.first_air_date);

  return { imdbId, title, year: releaseDate ? releaseDate.slice(0, 4) : null };
}

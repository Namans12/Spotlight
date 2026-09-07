import { normalizePlatforms, STREAMING_NETWORKS } from "../shared/platforms.js";
import { sortByRelease, type CollectionPart } from "../shared/collectionShapes.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

// TMDB splits availability across buckets. "flatrate" (included with a
// subscription), "ads" (free with adverts) and "free" all mean "you can watch
// it on this service right now", so all three count as a platform.
const AVAILABILITY_BUCKETS = ["flatrate", "ads", "free"] as const;
// These mean "you can watch it, but you pay per title".
const PURCHASE_BUCKETS = ["rent", "buy"] as const;

const BUY_RENT_SUFFIX = " (Buy/Rent)";
// Used when a title is known to be purchase-only but no usable store name
// survived normalization — better than showing nothing, which implies we know
// nothing at all.
const GENERIC_BUY_RENT = "Buy/Rent";
// A title can be purchasable in 30+ territories; listing every store is noise.
const MAX_PROVIDERS = 3;

/** One entry per listing, empty string included. A nameless purchase-bucket
 * entry is kept deliberately: "there is a listing here but we cannot name the
 * store" still means the title is buyable. `normalizePlatforms` drops blanks
 * before anything reaches the UI, so this never yields a phantom platform. */
function namesInRegion(details: any, region: string, buckets: readonly string[]): string[] {
  const payload = details?.["watch/providers"]?.results?.[region] ?? {};
  const names: string[] = [];
  for (const bucket of buckets) {
    for (const entry of payload[bucket] ?? []) {
      names.push(entry?.provider_name ?? "");
    }
  }
  return names;
}

/** Provider names from every territory, most widely-carried first — a store
 * listed in 30 countries is a better one-line answer than one listed in a
 * single small market. */
function namesAnyRegion(details: any, buckets: readonly string[]): string[] {
  const results = details?.["watch/providers"]?.results ?? {};
  const counts = new Map<string, number>();
  for (const region of Object.keys(results)) {
    // A store listed in both rent and buy for one region still counts once.
    for (const name of new Set(namesInRegion(details, region, buckets))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

function flatrateProviders(details: any, region: string): string[] {
  return normalizePlatforms(namesInRegion(details, region, AVAILABILITY_BUCKETS));
}

/** Labels purchase-only availability so it can never read as a subscription —
 * telling someone "Amazon Prime" when the title is really a paid rental there
 * is a worse error than telling them nothing. */
function tagBuyRent(names: string[]): string[] {
  const tagged = normalizePlatforms(names)
    .slice(0, MAX_PROVIDERS)
    .map((n) => `${n}${BUY_RENT_SUFFIX}`);
  if (tagged.length > 0) return tagged;
  return names.length > 0 ? [GENERIC_BUY_RENT] : [];
}

function rentBuyProviders(details: any, region: string): string[] {
  return tagBuyRent(namesInRegion(details, region, PURCHASE_BUCKETS));
}

/** Best available answer to "where can I watch this?", widest-relevance first.
 *
 * The order encodes a preference, not a guess: a subscription in the reader's
 * own region is the most useful answer, and a store in some other territory is
 * the least — but all of them beat showing nothing. The cross-region steps
 * exist because TMDB's India provider data is thin while its US/UK data is
 * rich: a title can carry rent/buy entries in 30+ territories and none in
 * India, so a region-only lookup would report nothing for a title that's
 * plainly available. Mirrors resolve_providers in releasebot.py, the same
 * fallback chain already proven on the release calendar. */
export function resolveProviders(details: any, region: string): string[] {
  const subs = flatrateProviders(details, region);
  if (subs.length > 0) return subs.slice(0, MAX_PROVIDERS);

  const purchase = rentBuyProviders(details, region);
  if (purchase.length > 0) return purchase;

  const subsAnywhere = normalizePlatforms(namesAnyRegion(details, AVAILABILITY_BUCKETS));
  if (subsAnywhere.length > 0) return subsAnywhere.slice(0, MAX_PROVIDERS);

  const purchaseAnywhere = tagBuyRent(namesAnyRegion(details, PURCHASE_BUCKETS));
  if (purchaseAnywhere.length > 0) return purchaseAnywhere;

  // No availability recorded anywhere. The network that made it is the last
  // real signal — a brand-new title often has one before it has providers.
  // Movies carry no `networks` field at all, so this tier is TV-only in practice.
  const networks = normalizePlatforms((details?.networks ?? []).map((n: any) => n?.name ?? ""));
  const fromNetwork = networks.filter((n) => STREAMING_NETWORKS.has(n));
  if (fromNetwork.length > 0) return fromNetwork.slice(0, MAX_PROVIDERS);

  return [];
}

export interface TmdbMovieResult {
  id: number;
  title: string;
  mediaType: "movie" | "tv";
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  releaseDate: string;
  voteAverage: number;
  originalLanguage: string;
}

function mapResult(r: any, mediaType?: string): TmdbMovieResult {
  return {
    id: r.id,
    title: r.title || r.name,
    mediaType: (mediaType || r.media_type || (r.title ? "movie" : "tv")) as "movie" | "tv",
    posterPath: r.poster_path ?? null,
    backdropPath: r.backdrop_path ?? null,
    overview: r.overview || "",
    releaseDate: r.release_date || r.first_air_date || "",
    voteAverage: r.vote_average || 0,
    originalLanguage: r.original_language || "",
  };
}

function requireApiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set");
  return key;
}

export async function tmdbSearchMulti(query: string): Promise<TmdbMovieResult[]> {
  if (!query.trim()) return [];
  const url = `${TMDB_BASE_URL}/search/multi?api_key=${requireApiKey()}&query=${encodeURIComponent(query)}&include_adult=false`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 20)
    .map((r: any) => mapResult(r));
}

export async function tmdbTrending(): Promise<TmdbMovieResult[]> {
  const url = `${TMDB_BASE_URL}/trending/all/week?api_key=${requireApiKey()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`TMDB trending failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 20)
    .map((r: any) => mapResult(r));
}

export async function tmdbPopularMovies(): Promise<TmdbMovieResult[]> {
  const url = `${TMDB_BASE_URL}/movie/popular?api_key=${requireApiKey()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`TMDB popular movies failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).slice(0, 10).map((r: any) => mapResult(r, "movie"));
}

export async function tmdbPopularTV(): Promise<TmdbMovieResult[]> {
  const url = `${TMDB_BASE_URL}/tv/popular?api_key=${requireApiKey()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`TMDB popular TV failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).slice(0, 10).map((r: any) => mapResult(r, "tv"));
}

async function tmdbList(path: string, mediaType?: "movie" | "tv"): Promise<TmdbMovieResult[]> {
  const joiner = path.includes("?") ? "&" : "?";
  const res = await fetchWithRetry(`${TMDB_BASE_URL}${path}${joiner}api_key=${requireApiKey()}`);
  if (!res.ok) throw new Error(`TMDB request failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r: any) => mediaType || r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 20)
    .map((r: any) => mapResult(r, mediaType));
}

/** TMDB's own "recommendations" — behaviour-derived, generally stronger than /similar. */
export function tmdbRecommendations(mediaType: "movie" | "tv", id: number): Promise<TmdbMovieResult[]> {
  return tmdbList(`/${mediaType}/${id}/recommendations`, mediaType);
}

/** Metadata-derived neighbours. Used to backfill when recommendations is thin. */
export function tmdbSimilar(mediaType: "movie" | "tv", id: number): Promise<TmdbMovieResult[]> {
  return tmdbList(`/${mediaType}/${id}/similar`, mediaType);
}

// Vercel kills a function at vercel.json's maxDuration (15s) with a bare
// platform error page — the app's own graceful-degradation code never runs
// if TMDB just hangs rather than erroring. 8s (matching lib/omdb.ts) leaves
// room for a retry to still land inside that budget.
const REQUEST_TIMEOUT_MS = 8_000;

/** The one fetch path every TMDB call in this file goes through: a timeout so
 *  a hung connection fails fast instead of riding the function to its hard
 *  Vercel kill, plus a couple of retries on transient failures. Retries a
 *  network error, a timeout, or a 5xx; never retries a 404, which is a real
 *  answer. */
async function fetchWithRetry(url: string, attempts = 3, deadline?: number): Promise<Response> {
  let lastError: unknown = new Error("no attempt made");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // A caller with a wall-clock budget (see `deadline`) stops retrying once
    // it is spent, rather than at a fixed attempt count. Attempt counts and
    // time budgets are not interchangeable: a call chain that makes several
    // sequential requests can stay under its attempt cap and still blow far
    // past the function's maxDuration.
    const remaining = deadline === undefined ? REQUEST_TIMEOUT_MS : deadline - Date.now();
    if (remaining <= 0) break;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)) });
      if (res.status < 500) return res;
      lastError = new Error(`TMDB HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }

    if (attempt < attempts - 1) {
      const backoff = 250 * 2 ** attempt;
      if (deadline !== undefined && Date.now() + backoff >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw lastError;
}

export type { CollectionPart } from "../shared/collectionShapes.js";

export interface TmdbCollection {
  /** Needed by the caller, not decorative: whether a collection's parts form
   *  a real prerequisite chain is a fact about the *collection*, looked up by
   *  id in data/collection-shapes.json. Returning only the parts (as this used
   *  to) makes that lookup impossible, which is how the known-wrong Star Wars
   *  trilogy-boundary edge reached production. */
  id: number;
  name: string;
  parts: CollectionPart[];
}

/** A movie's TMDB collection, with every part in release order.
 *
 *  Returns null when the title belongs to no collection — a real answer worth
 *  caching as a tombstone. Throws when TMDB could not be reached, which the
 *  caller must NOT cache: "we learned nothing" is not "there is nothing".
 *
 *  This makes *two* sequential calls, so a caller on a request path must cap
 *  the total with `budgetMs` rather than trusting the attempt count: at the
 *  default 3 attempts each the worst case is roughly 50s against
 *  vercel.json's 15s maxDuration, and the platform would kill the function
 *  and replace the caller's graceful degradation with an opaque error page.
 *  With a budget, retries still happen — they just stop when the time is
 *  gone, which keeps a transient reset recoverable without risking the kill.
 *
 *  TV has no collection concept on TMDB, so this is movies only. */
export async function tmdbCollectionParts(
  tmdbId: number,
  attempts = 3,
  budgetMs?: number,
): Promise<TmdbCollection | null> {
  const key = requireApiKey();
  const deadline = budgetMs === undefined ? undefined : Date.now() + budgetMs;

  const detailRes = await fetchWithRetry(`${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${key}`, attempts, deadline);
  if (detailRes.status === 404) return null;
  if (!detailRes.ok) throw new Error(`TMDB detail failed: ${detailRes.status}`);
  const detail = await detailRes.json();

  const collectionId = detail?.belongs_to_collection?.id;
  if (typeof collectionId !== "number") return null;

  const collectionRes = await fetchWithRetry(
    `${TMDB_BASE_URL}/collection/${collectionId}?api_key=${key}`,
    attempts,
    deadline,
  );
  if (collectionRes.status === 404) return null;
  if (!collectionRes.ok) throw new Error(`TMDB collection failed: ${collectionRes.status}`);
  const collection = await collectionRes.json();

  const parts: CollectionPart[] = (collection?.parts ?? [])
    .filter((p: any) => typeof p?.id === "number")
    .map((p: any) => ({
      id: p.id,
      title: p.title || "Untitled",
      posterPath: p.poster_path ?? null,
      releaseDate: p.release_date || null,
    }));

  // Undated parts sort last so an unannounced entry never slots in ahead of a
  // dated one and invents a prerequisite. planCollection re-sorts defensively;
  // this keeps the returned value meaningful on its own.
  const ordered = sortByRelease(parts);
  return ordered.length >= 2
    ? { id: collectionId, name: collection?.name || String(collectionId), parts: ordered }
    : null;
}

export interface CreditsResult {
  cast: { id: number; name: string }[];
  directors: { id: number; name: string }[];
}

export async function tmdbCredits(mediaType: "movie" | "tv", id: number): Promise<CreditsResult> {
  const res = await fetchWithRetry(`${TMDB_BASE_URL}/${mediaType}/${id}/credits?api_key=${requireApiKey()}`);
  if (!res.ok) throw new Error(`TMDB credits failed: ${res.status}`);
  const data = await res.json();
  return {
    cast: (data.cast ?? []).slice(0, 10).map((c: any) => ({ id: c.id, name: c.name })),
    // TV credits expose creators as "Director" rarely; fall back to any
    // directing-department crew so show pages aren't left empty.
    directors: (data.crew ?? [])
      .filter((c: any) => c.job === "Director" || c.department === "Directing")
      .slice(0, 3)
      .map((c: any) => ({ id: c.id, name: c.name })),
  };
}

export interface DiscoverParams {
  mediaType: "movie" | "tv";
  genres?: string;
  cast?: string;
  crew?: string;
}

export function tmdbDiscover({ mediaType, genres, cast, crew }: DiscoverParams): Promise<TmdbMovieResult[]> {
  const qs = new URLSearchParams({ sort_by: "popularity.desc", include_adult: "false" });
  if (genres) qs.set("with_genres", genres);
  // with_cast / with_crew are movie-only on TMDB; /discover/tv ignores them.
  if (cast) qs.set(mediaType === "movie" ? "with_cast" : "with_people", cast);
  if (crew) qs.set(mediaType === "movie" ? "with_crew" : "with_people", crew);
  return tmdbList(`/discover/${mediaType}?${qs.toString()}`, mediaType);
}

export interface TitleDetailResult {
  id: number;
  mediaType: "movie" | "tv";
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
  /** Needed by /discover, which filters on ids rather than names. */
  genreIds: number[];
  providers: string[];
  tmdbUrl: string;
  originalLanguage: string;
  /** TV only; null for movies and for a show TMDB has no season count for.
   *  Free here — this is the one TMDB call already made for every title-detail
   *  page view, so no separate seasons lookup is needed on this page. */
  numberOfSeasons: number | null;
}

const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

export async function tmdbDetail(mediaType: "movie" | "tv", id: number, region = "IN"): Promise<TitleDetailResult> {
  const path = mediaType === "movie" ? "movie" : "tv";
  const append = mediaType === "movie" ? "release_dates,watch/providers" : "watch/providers";
  const url = `${TMDB_BASE_URL}/${path}/${id}?api_key=${requireApiKey()}&append_to_response=${append}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`TMDB detail failed: ${res.status}`);
  const r = await res.json();

  const providers = resolveProviders(r, region);

  return {
    id: r.id,
    mediaType,
    title: r.title || r.name || "Untitled",
    overview: r.overview || "",
    posterPath: r.poster_path ?? null,
    posterUrl: r.poster_path ? `${IMG_BASE}${r.poster_path}` : null,
    backdropPath: r.backdrop_path ?? null,
    backdropUrl: r.backdrop_path ? `${BACKDROP_BASE}${r.backdrop_path}` : null,
    releaseDate: r.release_date || r.first_air_date || "",
    rating: r.vote_average || null,
    runtime: mediaType === "movie" ? r.runtime ?? null : r.episode_run_time?.[0] ?? null,
    genres: (r.genres ?? []).map((g: any) => g.name),
    genreIds: (r.genres ?? []).map((g: any) => g.id).filter((id: any) => typeof id === "number"),
    providers,
    tmdbUrl: `https://www.themoviedb.org/${path}/${id}`,
    originalLanguage: r.original_language || "",
    numberOfSeasons:
      mediaType === "tv" && typeof r.number_of_seasons === "number" && r.number_of_seasons > 0
        ? r.number_of_seasons
        : null,
  };
}

export interface ProviderKey {
  mediaType: "movie" | "tv";
  id: number;
}

export function providerCacheKey(key: ProviderKey): string {
  return `${key.mediaType}:${key.id}`;
}

// A grid can plausibly ask for more titles than fit in one request budget.
// 100 matches api/ratings.ts and api/seasons.ts's own batch caps -- though
// unlike those two (DB-cache-only, per their own comments), every key here is
// a live TMDB fetch. That's safe to match anyway: the legs run concurrently
// (see tmdbWatchProvidersBatch) and each now gets one attempt capped at
// REQUEST_TIMEOUT_MS, so 100 legs in flight cost the same wall-clock worst
// case as 10 -- the ceiling exists to bound the size of one function
// invocation and one upstream burst, not to ration sequential latency.
const MAX_PROVIDER_BATCH_KEYS = 100;

export interface ProviderBatchResult {
  providers: Record<string, string[]>;
  /** True if any key failed to resolve (network error, TMDB 5xx, a 429 from
   *  hitting TMDB's own limit with this many concurrent legs). The caller
   *  (api/tmdb/[...path].ts) must not stamp its usual long cache lifetime on a
   *  response where this is true — see this function's own comment on why a
   *  failed leg is omitted rather than defaulted to `[]`. */
  hadFailures: boolean;
}

/** Providers for many titles in one call. Every key gets its own TMDB fetch —
 * there is no bulk watch/providers endpoint — but they run in parallel and the
 * caller only makes one round trip, which is what keeps a grid of dozens of
 * posters from firing dozens of requests of its own.
 *
 * A failed key (a bad id, a transient TMDB error, a 429) is omitted from
 * `providers` entirely rather than mapped to `[]`. `[]` is a real, cacheable
 * answer -- "checked, nothing to watch it on" -- and a failure is not that; the
 * client's `useProviders` already treats a missing key as "still unknown" the
 * same way it treats one that hasn't resolved yet, so nothing downstream reads
 * this any differently than before. What changes is the cache: see
 * `hadFailures`.
 *
 * Each leg gets exactly one attempt (`fetchWithRetry(url, 1)`), not the
 * default three. `Promise.allSettled` below waits for the *slowest* leg to
 * settle before returning anything -- with up to `MAX_PROVIDER_BATCH_KEYS`
 * legs running concurrently, letting even one of them retry (worst case ~25s:
 * three 8s timeouts plus backoff) would carry the whole batch past Vercel's
 * 15s `maxDuration` and kill every key, not just the slow one. One attempt
 * caps the worst case at REQUEST_TIMEOUT_MS regardless of how many legs are
 * in flight, since they run in parallel rather than queued. */
export async function tmdbWatchProvidersBatch(
  keys: ProviderKey[],
  region = "IN",
): Promise<ProviderBatchResult> {
  const trimmed = keys.slice(0, MAX_PROVIDER_BATCH_KEYS);
  const key = requireApiKey();

  const results = await Promise.allSettled(
    trimmed.map(async ({ mediaType, id }) => {
      const path = mediaType === "movie" ? "movie" : "tv";
      const url = `${TMDB_BASE_URL}/${path}/${id}?api_key=${key}&append_to_response=watch/providers`;
      const res = await fetchWithRetry(url, 1);
      if (!res.ok) throw new Error(`TMDB detail failed: ${res.status}`);
      return resolveProviders(await res.json(), region);
    }),
  );

  const providers: Record<string, string[]> = {};
  let hadFailures = false;
  trimmed.forEach((k, i) => {
    const result = results[i];
    if (result.status === "fulfilled") {
      providers[providerCacheKey(k)] = result.value;
    } else {
      hadFailures = true;
    }
  });
  if (keys.length > trimmed.length) {
    // Not a failure (nothing was fetched and failed) -- a deliberate scope
    // limit -- but still worth a server-side trace, since a caller silently
    // getting fewer answers than keys it sent is otherwise invisible.
    console.warn(
      `[tmdb] providers-batch truncated ${keys.length - trimmed.length} of ${keys.length} requested keys`,
    );
  }
  return { providers, hadFailures };
}

import { normalizePlatforms, STREAMING_NETWORKS } from "../shared/platforms.js";
import { sortByRelease, type CollectionPart } from "../shared/collectionShapes.js";
import type { CandidateBucket } from "./recommendations.js";

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
  /** Present on list/discover rows, absent on some detail-shaped payloads.
   *  Carried through because lib/recommendations.ts scores genre overlap and
   *  filters the thinly-rated long tail, and re-fetching every candidate to
   *  learn two fields TMDB already sent would cost a request per result. */
  genreIds?: number[];
  voteCount?: number;
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
    genreIds: Array.isArray(r.genre_ids) ? r.genre_ids.filter((g: unknown) => typeof g === "number") : undefined,
    voteCount: typeof r.vote_count === "number" ? r.vote_count : undefined,
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

export async function tmdbDiscover({ mediaType, genres, cast, crew }: DiscoverParams): Promise<TmdbMovieResult[]> {
  // /discover/tv has no person filter at all. with_cast and with_crew are
  // movie-only, and with_people — which this used to fall back to — is not a
  // /discover/tv parameter either: TMDB accepts it, ignores it, and answers
  // with all TV sorted by popularity. So the home page's "Starring Bryan
  // Cranston" row for a show was really "popular TV right now", silently.
  //
  // A person's own credit list is the correct source, and a better one:
  // it is the actual filmography rather than a popularity-ranked slice.
  const personId = cast || crew;
  if (mediaType === "tv" && personId) {
    const ids = personId.split("|").filter(Boolean);
    const lists = await Promise.all(ids.map((id) => tmdbPersonCredits("tv", Number(id))));
    const byId = new Map<number, TmdbMovieResult>();
    for (const list of lists) for (const item of list) if (!byId.has(item.id)) byId.set(item.id, item);
    return withoutTvNoise("tv", [...byId.values()]).slice(0, 20);
  }

  const qs = new URLSearchParams({ sort_by: "popularity.desc", include_adult: "false" });
  if (genres) qs.set("with_genres", genres);
  if (cast) qs.set("with_cast", cast);
  if (crew) qs.set("with_crew", crew);
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

// ---------------------------------------------------------------------------
// "You may also like"
// ---------------------------------------------------------------------------

/** A raw TMDB JSON row. The API is untyped and its shapes differ per endpoint
 *  (movie vs tv, credits vs aggregate_credits), so it is named once here
 *  rather than restated as an inline `any` at every field access below. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TmdbRow = any;

/** Talk, News, Reality. Excluded from TV candidates wherever they can appear:
 *  a chat show books every famous guest there is, so it shares a cast member
 *  with almost every series and would otherwise surface as a peer of all of
 *  them. Applied to the person buckets too, which come from person credits
 *  rather than /discover and so cannot use without_genres. */
const TV_NOISE_GENRE_IDS = new Set([10767, 10763, 10764]);

function withoutTvNoise(mediaType: "movie" | "tv", results: TmdbMovieResult[]): TmdbMovieResult[] {
  if (mediaType !== "tv") return results;
  return results.filter((r) => !(r.genreIds ?? []).some((g) => TV_NOISE_GENRE_IDS.has(g)));
}

/** Everything about the viewed title that the ranker asks TMDB questions from.
 *  Fetched in ONE request via append_to_response rather than three. */
interface TitleProfile {
  language: string;
  genreIds: number[];
  /** Billing order preserved — the lead is a far stronger signal than the
   *  eighth-billed actor, so only the top few are ever queried on. */
  cast: { id: number; name: string }[];
  /** Directors for a film, creators for a series. TV rarely credits a
   *  "Director" at series level, so `created_by` is the equivalent. */
  authors: { id: number; name: string }[];
  keywords: { id: number; name: string }[];
  companies: { id: number; name: string }[];
  /** Movies only; TMDB has no TV equivalent. */
  collectionId: number | null;
}

async function fetchTitleProfile(mediaType: "movie" | "tv", id: number): Promise<TitleProfile | null> {
  const key = requireApiKey();
  // Plain /credits for both, deliberately not aggregate_credits for TV.
  // aggregate_credits carries every guest across every season: for Friends it
  // is 286 KB against 13 KB for /credits, and that payload was failing often
  // enough on a normal connection to silently drop five of the seven buckets
  // below — leaving a show with only /recommendations and /similar, which is
  // the behaviour this whole file exists to replace. /credits returns the
  // series regulars, which is exactly what a "you may also like" wants, and
  // the creators come off the detail payload's created_by regardless.
  const url = `${TMDB_BASE_URL}/${mediaType}/${id}?api_key=${key}&append_to_response=credits,keywords`;

  // Three attempts, not two: if this call fails, every metadata signal is lost
  // and the row silently degrades to the old behaviour with nothing to say so.
  const res = await fetchWithRetry(url, 3);
  if (!res.ok) return null;
  const r = await res.json();

  const credits = r?.credits ?? {};
  const cast = (credits.cast ?? []).slice(0, 6).map((c: TmdbRow) => ({ id: c.id, name: c.name }));

  const crewAuthors = (credits.crew ?? [])
    .filter((c: TmdbRow) => c.job === "Director" || c.jobs?.some?.((j: TmdbRow) => j.job === "Director"))
    .map((c: TmdbRow) => ({ id: c.id, name: c.name }));
  const created = (r.created_by ?? []).map((c: TmdbRow) => ({ id: c.id, name: c.name }));
  // Dedupe by id — a director credited on several episodes appears repeatedly
  // in aggregate_credits.
  const authors = [...new Map([...created, ...crewAuthors].map((a: TmdbRow) => [a.id, a])).values()].slice(0, 2) as {
    id: number;
    name: string;
  }[];

  // TMDB puts movie keywords under `keywords` and TV keywords under `results`.
  const rawKeywords = r?.keywords?.keywords ?? r?.keywords?.results ?? [];

  return {
    language: r.original_language || "",
    genreIds: (r.genres ?? []).map((g: TmdbRow) => g.id).filter((g: TmdbRow) => typeof g === "number"),
    cast,
    authors,
    keywords: rawKeywords.slice(0, 6).map((k: TmdbRow) => ({ id: k.id, name: k.name })),
    companies: (r.production_companies ?? []).slice(0, 3).map((c: TmdbRow) => ({ id: c.id, name: c.name })),
    collectionId: typeof r?.belongs_to_collection?.id === "number" ? r.belongs_to_collection.id : null,
  };
}

/** Every other part of a movie's collection, newest first. */
async function collectionSiblings(collectionId: number, excludeId: number): Promise<TmdbMovieResult[]> {
  try {
    const res = await fetchWithRetry(`${TMDB_BASE_URL}/collection/${collectionId}?api_key=${requireApiKey()}`, 2);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.parts ?? [])
      .filter((p: TmdbRow) => typeof p?.id === "number" && p.id !== excludeId)
      .map((p: TmdbRow) => mapResult(p, "movie"))
      .slice(0, 12);
  } catch {
    return [];
  }
}

/** The shows or films one person is credited on, cast or crew.
 *
 *  Needed because /discover/tv has NO person filter. `with_cast` and
 *  `with_crew` are movie-only, and `with_people` — which this used to fall
 *  back to — is not a /discover/tv parameter either: TMDB accepts it, ignores
 *  it, and answers with all TV sorted by popularity. That is not a subtle
 *  degradation. It put Paradise Hotel and Watch What Happens Live in the
 *  "people" bucket for Breaking Bad, identical to the "director" bucket,
 *  because both queries were really just "popular TV".
 *
 *  A person's credit list is also a better answer than a discover query would
 *  have been: it is the actual filmography rather than a popularity-ranked
 *  slice of one. */
/** A TV credit below this many episodes is a guest appearance, not a role.
 *  Jennifer Aniston is in 30 Rock, South Park and The Larry Sanders Show for
 *  one episode each; counting those as "shared cast" put all three above The
 *  Big Bang Theory as peers of Friends. */
const MIN_TV_EPISODES = 5;

async function tmdbPersonCredits(mediaType: "movie" | "tv", personId: number): Promise<TmdbMovieResult[]> {
  const path = mediaType === "tv" ? "tv_credits" : "movie_credits";
  try {
    const res = await fetchWithRetry(`${TMDB_BASE_URL}/person/${personId}/${path}?api_key=${requireApiKey()}`, 2);
    if (!res.ok) return [];
    const data = await res.json();
    const rows = [...(data.cast ?? []), ...(data.crew ?? [])];
    const byId = new Map<number, TmdbRow>();
    for (const row of rows) {
      if (typeof row?.id !== "number") continue;
      // episode_count is absent on movie credits and on some TV crew rows;
      // only exclude when TMDB actually says the run was short.
      if (mediaType === "tv" && typeof row.episode_count === "number" && row.episode_count < MIN_TV_EPISODES) {
        continue;
      }
      // A crew member credited on many episodes appears once per credit.
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
    return [...byId.values()]
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
      .slice(0, 20)
      .map((r) => mapResult(r, mediaType));
  } catch {
    return [];
  }
}

/** /discover, returning [] rather than throwing — one dead signal must not
 *  take the whole row down with it.
 *
 *  `sort_by` matters more than it looks. A person query returns a filmography,
 *  where popularity.desc is the right order. A keyword or studio query returns
 *  a catalogue — "everything Warner Bros. Television made" is thousands of
 *  shows — and popularity.desc there returns whatever is trending this week
 *  rather than the title a viewer would recognise as a peer. Ranked by
 *  vote_count.desc instead, "sitcom" surfaces Friends, The Big Bang Theory and
 *  How I Met Your Mother rather than this month's reality output. */
async function discoverQuietly(mediaType: "movie" | "tv", params: Record<string, string>): Promise<TmdbMovieResult[]> {
  const qs = new URLSearchParams({ sort_by: "popularity.desc", include_adult: "false", ...params });
  try {
    return await tmdbList(`/discover/${mediaType}?${qs.toString()}`, mediaType);
  } catch {
    return [];
  }
}

/**
 * Gathers the candidate pools "You may also like" is ranked from.
 *
 * Every query runs concurrently and every one is allowed to fail: the result
 * degrades from "well-explained" to "still reasonable" rather than to empty.
 * See lib/recommendations.ts for why these particular questions, and why the
 * answers are scored by which query returned them rather than by re-fetching.
 */
export async function tmdbRecommendationBuckets(
  mediaType: "movie" | "tv",
  id: number,
): Promise<{ buckets: CandidateBucket[]; profile: TitleProfile | null }> {
  const profile = await fetchTitleProfile(mediaType, id).catch(() => null);

  // Movies get /discover (with_cast and with_crew are real parameters there,
  // and popularity ordering is what a filmography wants). TV has no person
  // filter on /discover at all, so it goes through tmdbPersonCredits — see
  // that function for what the old with_people fallback actually did.
  //
  // Either way a person is matched across roles, which is the point: Farhan
  // Akhtar directed Dil Chahta Hai and acted in Zindagi Na Milegi Dobara, and
  // a cast-to-cast comparison never connects the two.
  //
  // One query per person rather than one OR'd query for all of them. Two
  // reasons, both load-bearing: /discover cannot say *which* of the people it
  // matched, so a single query can only produce a vague "shares this cast"
  // label; and a title that shares two of them should score twice, which is
  // exactly how Wake Up Sid (Ranbir Kapoor AND Ayan Mukerji) separates itself
  // from a film that merely shares one.
  const creditsFor = async (person: { id: number }, crewSide: boolean): Promise<TmdbMovieResult[]> => {
    if (mediaType === "movie") {
      return discoverQuietly(mediaType, { [crewSide ? "with_crew" : "with_cast"]: String(person.id) });
    }
    return withoutTvNoise(mediaType, await tmdbPersonCredits(mediaType, person.id));
  };

  const leads = profile?.cast.slice(0, 2) ?? [];
  const authors = profile?.authors.slice(0, 1) ?? [];
  const keywords = profile?.keywords.slice(0, 3) ?? [];
  // Just the primary studio. Two OR'd together would make the label a guess —
  // "From Dharma Productions" when the match was actually the other one — and
  // the first credited company is the one a viewer would recognise anyway.
  const companies = profile?.companies.slice(0, 1) ?? [];

  const broadQueryParams: Record<string, string> = {
    sort_by: "vote_count.desc",
    // Broad questions stay in the title's own language. This is the rule the
    // old /similar path already applied and for the same reason: the
    // plausible peers of a Hindi film are other Hindi films, and a keyword
    // like "love" or a studio's back catalogue otherwise answers with whatever
    // is best-rated worldwide. Yeh Jawaani Hai Deewani was returning The
    // Kissing Booth 2 and People We Meet on Vacation this way.
    //
    // Only the broad buckets. The person, director and behavioural queries are
    // left unconstrained — a shared lead is a real connection whatever
    // language the other title is in.
    ...(profile?.language ? { with_original_language: profile.language } : {}),
    ...(profile?.genreIds.length ? { with_genres: profile.genreIds.join("|") } : {}),
    // Talk (10767), News (10763) and Reality (10764). A chat show books every
    // famous guest there is, so it shares a "cast" member with almost any
    // series and surfaces as a peer of everything. Nothing in those three
    // genres is a plausible answer to "you may also like Breaking Bad".
    ...(mediaType === "tv" ? { without_genres: "10767,10763,10764" } : {}),
  };

  const [recommendations, similar, byPeople, byAuthor, byKeyword, byCompany, franchise] = await Promise.all([
    tmdbRecommendations(mediaType, id).catch(() => [] as TmdbMovieResult[]),
    tmdbSimilar(mediaType, id).catch(() => [] as TmdbMovieResult[]),
    Promise.all(leads.map((p) => creditsFor(p, false))),
    Promise.all(authors.map((p) => creditsFor(p, true))),
    // Keyword and studio are broad questions, so they are asked narrowly:
    // constrained to this title's own genres and ranked by vote_count rather
    // than by what happens to be popular right now. Without the genre
    // constraint, "made by Warner Bros. Television" answers with The Mentalist
    // and Reacher when the title in hand is Friends. The person and director
    // queries above are deliberately left unconstrained — a shared lead is
    // specific enough on its own, and constraining by genre there would lose
    // Brahmastra as a peer of Yeh Jawaani Hai Deewani, which it is despite
    // sharing no genre with it at all.
    keywords.length
      ? discoverQuietly(mediaType, { with_keywords: keywords.map((k) => k.id).join("|"), ...broadQueryParams })
      : Promise.resolve([] as TmdbMovieResult[]),
    companies.length
      ? discoverQuietly(mediaType, { with_companies: companies.map((c) => c.id).join("|"), ...broadQueryParams })
      : Promise.resolve([] as TmdbMovieResult[]),
    // The rest of the franchise, straight from the collection. Every other
    // signal here ranks by popularity or votes, which is exactly wrong for a
    // sequel: Cars 3 sits below Toy Story and WALL-E on both counts and fell
    // out of the top 20 of every bucket, while being the single most obvious
    // thing to show someone looking at Cars.
    profile?.collectionId ? collectionSiblings(profile.collectionId, id) : Promise.resolve([] as TmdbMovieResult[]),
  ]);

  const buckets: CandidateBucket[] = [
    { kind: "recommendation", results: recommendations },
    { kind: "similar", results: similar },
  ];

  if (franchise.length) {
    buckets.push({ kind: "franchise", label: "Part of the same series", results: franchise });
  }

  leads.forEach((person, i) => {
    if (byPeople[i]?.length) {
      buckets.push({ kind: "person", label: `Also stars ${person.name}`, results: byPeople[i] });
    }
  });
  authors.forEach((person, i) => {
    if (byAuthor[i]?.length) {
      buckets.push({
        kind: "director",
        label: mediaType === "tv" ? `Also from ${person.name}` : `Also directed by ${person.name}`,
        results: byAuthor[i],
      });
    }
  });
  if (byKeyword.length && keywords.length) {
    // Deliberately unnamed. The query ORs several keywords, so TMDB never says
    // which one matched, and naming the first produced labels that were both
    // clumsy and sometimes false — "Also ship" on Troy, "Also new mexico" on
    // Narcos. "Similar themes" claims exactly as much as is actually known.
    buckets.push({ kind: "keyword", label: "Similar themes", results: byKeyword });
  }
  if (byCompany.length && companies.length) {
    buckets.push({ kind: "company", label: `From ${companies[0].name}`, results: byCompany });
  }

  return { buckets, profile };
}

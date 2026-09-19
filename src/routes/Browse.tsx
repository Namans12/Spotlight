import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { getTrending, getPopularMovies, getPopularTV } from '@/lib/tmdb';
import { tmdbBackdrop } from '@/lib/tmdbImage';
import { ActionButton } from '@/components/watchlist/ActionButton';
import { PosterCard } from '@/components/release/PosterCard';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { fromMovie } from '@/types/digest';
import { PosterRow } from '@/components/release/PosterRow';
import { useSuggestions } from '@/hooks/useSuggestions';
import { useMediaScope } from '@/hooks/useMediaScope';
import { useSeasons } from '@/hooks/useSeasons';
import { useProviders } from '@/hooks/useProviders';
import { cn } from '@/lib/utils';
import { TrendingUp, Film, Tv, Flame, Loader2, RefreshCw, Check, Plus, Clock, Sparkles } from 'lucide-react';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Refetching these three TMDB lists is usually near-instant (often <50ms,
 *  since the proxy or TMDB itself serves a warm response), which reads as
 *  "nothing happened" when a real person clicks it. Floor the spin at this
 *  long so the feedback is always visible regardless of how fast it actually
 *  finishes. */
const MIN_SPIN_MS = 600;
/** How long the success state lingers before reverting to idle. */
const DONE_HOLD_MS = 1100;
/** A query can get stuck in TanStack Query's "paused" state (its retry backs
 *  off waiting for a network-online transition that already happened, e.g.
 *  after a brief connectivity blip) and never settle. Cap the wait so the
 *  button can never be stuck disabled forever — worse than a fast refetch
 *  reporting done a little early. */
const REFRESH_TIMEOUT_MS = 6000;

type RefreshState = 'idle' | 'spinning' | 'done';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([promise, sleep(ms).then(() => 'timeout' as const)]);
}

export default function Browse() {
  const wl = useWatchlistContext();
  const [mediaType] = useMediaScope();
  const suggestionsQuery = useSuggestions();

  const trendingQuery = useQuery({ queryKey: ['tmdb', 'trending'], queryFn: getTrending, staleTime: 5 * 60_000 });
  const popularMoviesQuery = useQuery({ queryKey: ['tmdb', 'popular-movies'], queryFn: getPopularMovies, staleTime: 5 * 60_000 });
  const popularTVQuery = useQuery({ queryKey: ['tmdb', 'popular-tv'], queryFn: getPopularTV, staleTime: 5 * 60_000 });

  const loading = trendingQuery.isLoading || popularMoviesQuery.isLoading || popularTVQuery.isLoading;
  const [refreshState, setRefreshState] = useState<RefreshState>('idle');

  // The topbar scope filters the mixed rows and hides the two rows that are
  // entirely the other media type, so picking "Movies" doesn't leave a full
  // shelf of TV shows underneath.
  const inScope = <T extends { mediaType: string }>(items: T[]) =>
    mediaType === 'all' ? items : items.filter((m) => m.mediaType === mediaType);

  const trending = inScope(trendingQuery.data ?? []);
  const popularMovies = mediaType === 'tv' ? [] : (popularMoviesQuery.data ?? []);
  const popularTV = mediaType === 'movie' ? [] : (popularTVQuery.data ?? []);
  const heroMovie = trending.find((m) => m.backdropPath) || trending[0];
  // Full width of the content column (sidebar-adjacent, not the viewport) —
  // 700 lands the 1x bucket on w780 rather than the flat w1280 this used to
  // request regardless of size.
  const heroBackdrop = heroMovie?.backdropPath
    ? tmdbBackdrop(`https://image.tmdb.org/t/p/w1280${heroMovie.backdropPath}`, 700)
    : undefined;
  const seasonsFor = useSeasons([...trending, ...popularMovies, ...popularTV]);

  const suggestions = (suggestionsQuery.data ?? [])
    .map((row) => ({ ...row, items: inScope(row.items) }))
    .filter((row) => row.items.length > 0);

  // One shared lookup over everything this page renders -- trending, both
  // popular rails, and every "For You" strip -- rather than each PosterRow
  // firing its own providers-batch request. Unlike ratings/seasons (DB-cache
  // reads), a provider lookup is a live TMDB fan-out per key, so N rows used
  // to mean N requests; passing this down turns it back into one.
  const providersFor = useProviders([
    ...trending,
    ...popularMovies,
    ...popularTV,
    ...suggestions.flatMap((row) => row.items),
  ]);

  const handleRefresh = async () => {
    if (refreshState !== 'idle') return;
    setRefreshState('spinning');
    const startedAt = Date.now();

    const outcome = await withTimeout(
      Promise.allSettled([trendingQuery.refetch(), popularMoviesQuery.refetch(), popularTVQuery.refetch()]),
      REFRESH_TIMEOUT_MS,
    );
    const timedOut = outcome === 'timeout';

    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_SPIN_MS) await sleep(MIN_SPIN_MS - elapsed);

    if (timedOut) {
      // Don't claim success we can't back up — quietly drop back to idle
      // rather than showing the checkmark for a refresh that never finished.
      setRefreshState('idle');
      toast.error('Refresh is taking longer than expected. Try again in a moment.');
      return;
    }

    setRefreshState('done');
    toast.success('Discover refreshed.');
    await sleep(DONE_HOLD_MS);
    setRefreshState('idle');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-accent" />
      </div>
    );
  }

  const nothingInScope =
    suggestions.length === 0 && trending.length === 0 && popularMovies.length === 0 && popularTV.length === 0;

  return (
    <div className="space-y-8 animate-[fade-in_0.3s_ease-out]">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-foreground">Discover</h2>
        <button
          onClick={handleRefresh}
          disabled={refreshState !== 'idle'}
          className={cn(
            'inline-flex h-control shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium leading-none transition-all duration-200 disabled:opacity-100',
            refreshState === 'done'
              ? 'bg-watched/15 text-watched'
              : 'bg-secondary text-secondary-foreground hover:bg-card-hover',
          )}
        >
          {refreshState === 'done' ? (
            <Check size={13} className="shrink-0 animate-[btn-press_0.4s_ease-out]" strokeWidth={2.5} />
          ) : (
            <RefreshCw size={13} className={cn('shrink-0', refreshState === 'spinning' && 'animate-spin')} />
          )}
          {refreshState === 'spinning' ? 'Refreshing…' : refreshState === 'done' ? 'Refreshed' : 'Refresh'}
        </button>
      </div>

      {heroMovie && heroBackdrop && (
        <div className="relative rounded-2xl overflow-hidden -mx-1">
          <img
            src={heroBackdrop.src}
            srcSet={heroBackdrop.srcSet}
            alt={heroMovie.title}
            decoding="async"
            className="w-full h-48 sm:h-64 lg:h-80 object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5 lg:p-8">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent uppercase tracking-wider leading-none">
                <Flame size={12} className="shrink-0" /> Trending Now
              </span>
            </div>
            <Link to={`/title/${heroMovie.mediaType}/${heroMovie.id}`}>
              <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-semibold text-foreground leading-tight hover:underline">
                {heroMovie.title}
              </h2>
            </Link>
            <p className="text-xs text-foreground/80 mt-1.5 line-clamp-2 max-w-lg">{heroMovie.overview}</p>
            <div className="flex items-center gap-2 mt-3">
              <ActionButton
                onClick={() => wl.addToWatchlist(heroMovie)}
                icon={<Plus size={12} strokeWidth={2.5} className="shrink-0" />}
                label="Watchlist"
                className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold leading-none hover:brightness-110 active:scale-95"
                successClassName="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-watched/20 text-watched text-xs font-semibold leading-none"
              />
              <ActionButton
                onClick={() => wl.addToWatchLater(heroMovie)}
                icon={<Clock size={12} className="shrink-0" />}
                label="Watch Later"
                className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium leading-none hover:bg-card-hover active:scale-95"
                successClassName="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-watched/20 text-watched text-xs font-medium leading-none"
              />
            </div>
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-8">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent shrink-0" />
            <h3 className="font-display text-lg font-semibold text-foreground leading-none">For You</h3>
            <span className="flex-1 h-px bg-border ml-1" />
          </div>
          {suggestions.map((row) => (
            <PosterRow
              key={row.key}
              title={row.title}
              subtitle={row.subtitle}
              items={row.items}
              providersFor={providersFor}
            />
          ))}
        </div>
      )}

      {trending.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-accent shrink-0" />
            <h3 className="font-display text-lg font-semibold text-foreground leading-none">Trending This Week</h3>
          </div>
          <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2 -mx-1 px-1">
            {trending.map((movie) => (
              <PosterCard
                key={movie.id}
                item={fromMovie(movie)}
                linkTo={`/title/${movie.mediaType}/${movie.id}`}
                seasons={seasonsFor(movie.mediaType, movie.id)}
                providers={providersFor(movie.mediaType, movie.id)}
                className="flex-shrink-0 w-[130px] sm:w-[150px]"
                onAddToWatchlist={() => wl.addToWatchlist(movie)}
                onAddToWatchLater={() => wl.addToWatchLater(movie)}
                onToggleWatched={() => wl.toggleWatched(movie)}
                watched={wl.isWatched(movie.mediaType, movie.id)}
              />
            ))}
          </div>
        </section>
      )}

      {popularMovies.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Film size={16} className="text-accent shrink-0" />
            <h3 className="font-display text-lg font-semibold text-foreground leading-none">Popular Movies</h3>
          </div>
          <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2 -mx-1 px-1">
            {popularMovies.map((movie) => (
              <PosterCard
                key={movie.id}
                item={fromMovie(movie)}
                linkTo={`/title/${movie.mediaType}/${movie.id}`}
                seasons={seasonsFor(movie.mediaType, movie.id)}
                providers={providersFor(movie.mediaType, movie.id)}
                className="flex-shrink-0 w-[130px] sm:w-[150px]"
                onAddToWatchlist={() => wl.addToWatchlist(movie)}
                onAddToWatchLater={() => wl.addToWatchLater(movie)}
                onToggleWatched={() => wl.toggleWatched(movie)}
                watched={wl.isWatched(movie.mediaType, movie.id)}
              />
            ))}
          </div>
        </section>
      )}

      {nothingInScope && (
        <p className="py-20 text-center text-sm text-muted-foreground">
          Nothing here for this media type — switch back to All in the topbar.
        </p>
      )}

      {popularTV.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Tv size={16} className="text-accent shrink-0" />
            <h3 className="font-display text-lg font-semibold text-foreground leading-none">Popular TV Shows</h3>
          </div>
          <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2 -mx-1 px-1">
            {popularTV.map((movie) => (
              <PosterCard
                key={movie.id}
                item={fromMovie(movie)}
                linkTo={`/title/${movie.mediaType}/${movie.id}`}
                seasons={seasonsFor(movie.mediaType, movie.id)}
                providers={providersFor(movie.mediaType, movie.id)}
                className="flex-shrink-0 w-[130px] sm:w-[150px]"
                onAddToWatchlist={() => wl.addToWatchlist(movie)}
                onAddToWatchLater={() => wl.addToWatchLater(movie)}
                onToggleWatched={() => wl.toggleWatched(movie)}
                watched={wl.isWatched(movie.mediaType, movie.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

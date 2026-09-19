import { useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Movie, WatchlistItem, WatchlistState } from '@/types/movie';
import type { WatchlistItemDTO, WatchlistStateDTO } from '../../shared/types/watchlist';
import * as api from '@/lib/watchlistApi';
import { findWatched, watchedKeys, titleKey } from '@/lib/watched';
import { nextEpisode, type SeasonSummary } from '@/lib/progress';
import { opinionKey } from '@/lib/taste';
import { useAuth } from '@/hooks/useAuth';

const QUERY_KEY = ['watchlist'];
/** Named so the progress mutation can ask how many of its own kind are still
 *  in flight — see the onSettled guard below. */
const PROGRESS_MUTATION_KEY = ['watchlist', 'progress'];

function toWatchlistItem(dto: WatchlistItemDTO): WatchlistItem {
  return {
    dbId: dto.dbId,
    id: dto.tmdbId,
    title: dto.title,
    posterPath: dto.posterPath,
    backdropPath: dto.backdropPath,
    overview: dto.overview,
    releaseDate: dto.releaseDate,
    mediaType: dto.mediaType,
    voteAverage: dto.voteAverage,
    originalLanguage: dto.originalLanguage,
    addedAt: dto.addedAt,
    listId: dto.listId ?? undefined,
  };
}

function toState(dto: WatchlistStateDTO): WatchlistState {
  const customListItems: Record<number, WatchlistItem[]> = {};
  for (const [listId, items] of Object.entries(dto.customListItems)) {
    customListItems[Number(listId)] = items.map(toWatchlistItem);
  }
  return {
    watchlist: dto.watchlist.map(toWatchlistItem),
    watched: dto.watched.map(toWatchlistItem),
    watchLater: dto.watchLater.map(toWatchlistItem),
    customLists: dto.customLists,
    customListItems,
    progress: dto.progress ?? {},
    opinions: dto.opinions ?? {},
  };
}

function movieToAddBody(movie: Movie, bucket: 'watchlist' | 'watchLater' | 'watched' | 'custom', listId?: number) {
  return {
    tmdbId: movie.id,
    mediaType: movie.mediaType,
    title: movie.title,
    posterPath: movie.posterPath,
    backdropPath: movie.backdropPath,
    overview: movie.overview,
    releaseDate: movie.releaseDate,
    voteAverage: movie.voteAverage,
    originalLanguage: movie.originalLanguage,
    bucket,
    listId,
  };
}

const EMPTY_STATE: WatchlistState = {
  watchlist: [],
  watched: [],
  watchLater: [],
  customLists: [],
  customListItems: {},
  progress: {},
  opinions: {},
};

export function useWatchlist() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => toState(await api.fetchWatchlistState()),
    staleTime: 0, // private, small, mutable dataset — correctness over cache hits
    enabled: isAuthenticated, // avoid firing a doomed-to-401 request on public pages
  });

  const state = query.data ?? EMPTY_STATE;

  // The mutations report their failures, but a failing *read* fell back to
  // EMPTY_STATE and looked exactly like "you haven't saved anything yet" —
  // which is how a 404 on the load path stayed invisible while only the add
  // button complained.
  useEffect(() => {
    if (!query.isError) return;
    toast.error('Could not load your list', {
      description: query.error instanceof Error ? query.error.message : undefined,
    });
  }, [query.isError, query.error]);

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }

  // Every mutation used to fail silently — no onError anywhere — so a broken
  // endpoint looked identical to a no-op click. Surface it instead.
  function onError(action: string) {
    return (err: unknown) =>
      toast.error(`Could not ${action}`, {
        description: err instanceof Error ? err.message : undefined,
      });
  }

  /** Writes need the owner cookie; without it the request is doomed, so say so
   * rather than firing it and swallowing the 401. */
  function requireLogin(): boolean {
    if (isAuthenticated) return true;
    toast.error('Log in to use your list', { description: 'Sign in with Google to save titles.' });
    return false;
  }

  const addMutation = useMutation({
    mutationFn: (vars: { movie: Movie; bucket: 'watchlist' | 'watchLater' | 'watched' | 'custom'; listId?: number }) =>
      api.addWatchlistItem(movieToAddBody(vars.movie, vars.bucket, vars.listId)),
    onSuccess: invalidate,
    onError: onError('add that title'),
  });

  const moveMutation = useMutation({
    mutationFn: (vars: { dbId: number; bucket: 'watchlist' | 'watchLater' | 'watched' | 'custom'; listId?: number | null }) =>
      api.moveWatchlistItem(vars.dbId, vars.bucket, vars.listId),
    onSuccess: invalidate,
    onError: onError('move that title'),
  });

  const progressMutation = useMutation({
    mutationKey: PROGRESS_MUTATION_KEY,
    mutationFn: (vars: { tmdbId: number; season: number | null; episode?: number }) =>
      api.setTitleProgress(vars.tmdbId, vars.season, vars.episode),
    // Optimistic, unlike the other writes here. Ticking off an episode is the
    // one action someone does repeatedly in a row, and a control that waits a
    // round trip before moving reads as broken by the third tap.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<WatchlistState>(QUERY_KEY);
      queryClient.setQueryData<WatchlistState>(QUERY_KEY, (old) => {
        if (!old) return old;
        const next = { ...old.progress };
        const key = titleKey('tv', vars.tmdbId);
        if (vars.season === null) delete next[key];
        else next[key] = { season: vars.season, episode: vars.episode ?? 1 };
        return { ...old, progress: next };
      });
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
      onError('save your place')(err);
    },
    // Only the LAST tap refetches. Watching four episodes is four taps in a
    // row, and invalidating after each one meant a refetch fired for tap 1
    // could land after tap 3 had already been applied optimistically — the
    // server's honest answer at that moment, and two episodes stale by the
    // time it arrived. The counter still includes this mutation while
    // onSettled runs, so 1 means "no others are pending".
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: PROGRESS_MUTATION_KEY }) === 1) invalidate();
    },
  });

  const opinionMutation = useMutation({
    mutationFn: (vars: { tmdbId: number; mediaType: string; liked: boolean | null }) =>
      api.setTitleOpinion(vars.tmdbId, vars.mediaType, vars.liked),
    // Optimistic: a thumb is a one-tap judgement and a control that waits for
    // a round trip before filling in reads as ignored.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<WatchlistState>(QUERY_KEY);
      queryClient.setQueryData<WatchlistState>(QUERY_KEY, (old) => {
        if (!old) return old;
        const next = { ...old.opinions };
        const key = opinionKey(vars.mediaType, vars.tmdbId);
        if (vars.liked === null) delete next[key];
        else next[key] = vars.liked;
        return { ...old, opinions: next };
      });
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
      onError('save that')(err);
    },
    onSettled: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (dbId: number) => api.removeWatchlistItem(dbId),
    onSuccess: invalidate,
    onError: onError('remove that title'),
  });

  const reorderMutation = useMutation({
    mutationFn: (vars: { bucket: 'watchlist' | 'watchLater'; orderedIds: number[]; items: WatchlistItem[] }) =>
      api.reorderBucket(vars.bucket, null, vars.orderedIds),
    // Drag-and-drop needs the new order to land the instant you drop the
    // card — waiting for the round trip (previously N sequential UPDATEs,
    // now one, but still a network hop) made every reorder look like it had
    // snapped back before catching up. Writing the already-computed order
    // straight into the cache here means the list never has to wait.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<WatchlistState>(QUERY_KEY);
      queryClient.setQueryData<WatchlistState>(QUERY_KEY, (old) =>
        old ? { ...old, [vars.bucket]: vars.items } : old,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
      onError('save the new order')(err);
    },
    // Reconcile with the server either way: confirms the optimistic write on
    // success, and re-syncs past the rollback on error in case something else
    // changed the list in the meantime.
    onSettled: invalidate,
  });

  const createListMutation = useMutation({
    mutationFn: (name: string) => api.createCustomList(name),
    onSuccess: invalidate,
    onError: onError('create that list'),
  });

  const deleteListMutation = useMutation({
    mutationFn: (listId: number) => api.deleteCustomList(listId),
    onSuccess: invalidate,
    onError: onError('delete that list'),
  });

  const addToWatchlist = (movie: Movie) => {
    if (!requireLogin()) return;
    addMutation.mutate({ movie, bucket: 'watchlist' });
  };
  const addToWatchLater = (movie: Movie) => {
    if (!requireLogin()) return;
    addMutation.mutate({ movie, bucket: 'watchLater' });
  };

  const markWatched = (dbId: number) => moveMutation.mutate({ dbId, bucket: 'watched' });

  /**
   * "I've seen this" / "no I haven't", from anywhere.
   *
   * `markWatched` above takes a dbId, which means the title has to already be
   * saved before it can be marked — the reason the watched bucket has stayed
   * almost empty. This takes the title itself, so a poster on Home or a
   * recommendation on a detail page can be marked in one tap by someone who
   * never intended to add it to anything.
   *
   * The add path needs no special casing for a title already sitting in
   * another bucket: addWatchlistItem is purge-then-insert, so the server moves
   * it rather than duplicating it (lib/watchlistDb.ts). Un-marking is a delete
   * rather than a move back, because there is nowhere to move back to —
   * "not seen" is the absence of a row, not a bucket of its own.
   */
  const toggleWatched = (movie: Movie) => {
    if (!requireLogin()) return;
    const existing = findWatched(state.watched, movie);
    if (existing) removeMutation.mutate(existing.dbId);
    else addMutation.mutate({ movie, bucket: 'watched' });
  };

  // Recomputed per render rather than memoised: the watched bucket is a
  // handful of rows, and a stale set here would leave an eye lit on a title
  // that was just un-marked.
  /** Where this account is up to in a series, or null for one not started. */
  const progressFor = (tmdbId: number) => state.progress[titleKey('tv', tmdbId)] ?? null;
  const setProgress = (tmdbId: number, season: number | null, episode?: number) => {
    if (!requireLogin()) return;
    progressMutation.mutate({ tmdbId, season, episode });
  };

  /**
   * "Watched the next one."
   *
   * Reads the pointer out of the query cache at click time rather than taking
   * it from `state`, which is a value captured when the component last
   * rendered. Two taps in quick succession — someone marking off a couple of
   * episodes — would otherwise both compute their "next" from the same stale
   * pointer and the second would be a no-op. The optimistic write in onMutate
   * has already landed in the cache by then, so this sees it.
   */
  const advanceProgress = (tmdbId: number, seasons: SeasonSummary[]) => {
    if (!requireLogin()) return;
    const live = queryClient.getQueryData<WatchlistState>(QUERY_KEY) ?? state;
    const current = live.progress?.[titleKey('tv', tmdbId)] ?? null;
    const next = nextEpisode(seasons, current);
    if (!next) return; // Already finished.
    progressMutation.mutate({ tmdbId, season: next.season, episode: next.episode });
  };

  /** true, false, or null for "not said". */
  const opinionFor = (mediaType: string, tmdbId: number): boolean | null =>
    state.opinions[opinionKey(mediaType, tmdbId)] ?? null;

  /**
   * Taps the thumb. Tapping the one already lit withdraws the opinion, which
   * is the only way back to "not said" — and it has to exist, because a
   * mis-tap that cannot be undone is worse than no control at all.
   */
  const setOpinion = (mediaType: string, tmdbId: number, liked: boolean | null) => {
    if (!requireLogin()) return;
    const current = opinionFor(mediaType, tmdbId);
    opinionMutation.mutate({ tmdbId, mediaType, liked: current === liked ? null : liked });
  };

  // Memoised on the bucket it is built from. Building the Set is cheap, but
  // its *identity* changes on every render, and anything downstream that
  // memoises against it then recomputes every render too — which is how the
  // duel's pool ended up being re-dealt, and a fresh TMDB batch fired, several
  // times per screen.
  const watchedKeySet = useMemo(() => watchedKeys(state.watched), [state.watched]);
  const isWatched = (mediaType: string, tmdbId: number) =>
    watchedKeySet.has(titleKey(mediaType, tmdbId));

  const removeFromList = (dbId: number) => removeMutation.mutate(dbId);

  const moveToWatchlist = (dbId: number) => moveMutation.mutate({ dbId, bucket: 'watchlist' });

  const reorderWatchlist = (oldIndex: number, newIndex: number) => {
    const items = [...state.watchlist];
    const [moved] = items.splice(oldIndex, 1);
    items.splice(newIndex, 0, moved);
    reorderMutation.mutate({ bucket: 'watchlist', orderedIds: items.map((i) => i.dbId), items });
  };

  const reorderWatchLater = (oldIndex: number, newIndex: number) => {
    const items = [...state.watchLater];
    const [moved] = items.splice(oldIndex, 1);
    items.splice(newIndex, 0, moved);
    reorderMutation.mutate({ bucket: 'watchLater', orderedIds: items.map((i) => i.dbId), items });
  };

  const createList = (name: string) => {
    if (!requireLogin()) return;
    createListMutation.mutate(name);
  };
  const deleteList = (listId: number) => deleteListMutation.mutate(listId);

  const addToCustomList = (listId: number, movie: Movie) => {
    if (!requireLogin()) return;
    addMutation.mutate({ movie, bucket: 'custom', listId });
  };
  const removeFromCustomList = (_listId: number, dbId: number) => removeMutation.mutate(dbId);

  return {
    ...state,
    isLoading: query.isLoading,
    addToWatchlist,
    addToWatchLater,
    markWatched,
    toggleWatched,
    isWatched,
    progressFor,
    setProgress,
    advanceProgress,
    opinionFor,
    setOpinion,
    watchedKeys: watchedKeySet,
    removeFromList,
    reorderWatchlist,
    reorderWatchLater,
    createList,
    deleteList,
    addToCustomList,
    removeFromCustomList,
    moveToWatchlist,
  };
}

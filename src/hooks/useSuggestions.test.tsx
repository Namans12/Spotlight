import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movie, WatchlistItem } from '@/types/movie';
import { useSuggestions } from './useSuggestions';

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('@/contexts/watchlist-context', () => ({ useWatchlistContext: () => state.current }));
vi.mock('@/lib/tmdb', () => ({ getRecommendations: vi.fn(), getCredits: vi.fn(), discover: vi.fn() }));
import { getRecommendations, getCredits } from '@/lib/tmdb';

function movie(id: number, mediaType: 'movie' | 'tv', addedAt = 0): WatchlistItem {
  return { id, dbId: id, title: `${mediaType} ${id}`, mediaType, addedAt, posterPath: null,
    overview: '', releaseDate: '', voteAverage: 0, originalLanguage: 'en' };
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  state.current = { watchlist: [movie(1, 'movie', 10)], watchLater: [], watched: [], opinions: {}, customListItems: {} };
  vi.mocked(getCredits).mockResolvedValue(null as never);
  vi.mocked(getRecommendations).mockResolvedValue([movie(7, 'movie'), movie(7, 'tv')] as Movie[]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ genreIds: [], genres: [] }) }));
});

describe('suggestion identity and exclusions', () => {
  it('does not exclude a TV show because a movie has the same numeric ID', async () => {
    state.current = { ...state.current, customListItems: { 8: [movie(7, 'movie')] } };
    const { result } = renderHook(() => useSuggestions(), { wrapper: setup() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].items.map(item => `${item.mediaType}:${item.id}`)).toEqual(['tv:7']);
  });
  it('refreshes exclusions when a non-seed saved title changes', async () => {
    const { result, rerender } = renderHook(() => useSuggestions(), { wrapper: setup() });
    await waitFor(() => expect(result.current.data?.[0].items).toHaveLength(2));
    state.current = { ...state.current, customListItems: { 8: [movie(7, 'tv')] } };
    rerender();
    await waitFor(() => expect(result.current.data?.[0].items.map(item => item.mediaType)).toEqual(['movie']));
  });
});

it('labels liked seeds by media type as well as numeric ID', async () => {
  state.current = { ...state.current, watchlist: [movie(7, 'movie', 10)],
    watched: [movie(7, 'tv', 20)], opinions: { 'tv:7': true } };
  vi.mocked(getRecommendations).mockResolvedValue([movie(8, 'movie')] as Movie[]);
  const { result } = renderHook(() => useSuggestions(), { wrapper: setup() });
  await waitFor(() => expect(result.current.data?.length).toBe(2));
  expect(result.current.data?.map(row => row.title)).toEqual(['Because you liked tv 7', 'Because you added movie 7']);
});

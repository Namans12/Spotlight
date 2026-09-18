import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PosterRow } from './PosterRow';
import type { Movie } from '@/types/movie';

vi.mock('@/contexts/WatchlistContext', () => ({
  useWatchlistContext: () => ({ addToWatchlist: vi.fn(), addToWatchLater: vi.fn() }),
}));

vi.mock('@/lib/providers', () => ({
  fetchProvidersBatch: vi.fn(),
  providerKey: (mediaType: string, tmdbId: number) => `${mediaType}:${tmdbId}`,
}));
import { fetchProvidersBatch } from '@/lib/providers';

function movie(overrides: Partial<Movie>): Movie {
  return {
    id: 1,
    title: 'Some Film',
    posterPath: null,
    overview: '',
    releaseDate: '2026-08-21',
    mediaType: 'movie',
    voteAverage: 0,
    originalLanguage: 'en',
    ...overrides,
  };
}

function renderRow(props: Partial<React.ComponentProps<typeof PosterRow>> & { items: Movie[] }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PosterRow title="Row" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchProvidersBatch).mockReset();
});

describe('PosterRow providers', () => {
  it('fetches its own providers batch when no shared lookup is passed (a lone row)', async () => {
    vi.mocked(fetchProvidersBatch).mockResolvedValue({ providers: { 'movie:1': ['Netflix'] }, runtimes: {} });

    renderRow({ items: [movie({ id: 1 })] });

    await waitFor(() => expect(fetchProvidersBatch).toHaveBeenCalledTimes(1));
    await screen.findByText('Netflix');
  });

  it('fires no request of its own when a shared lookup is passed in', async () => {
    // This is the regression under guard: before PosterRow accepted a shared
    // lookup, a page rendering several rows (Browse's "For You" strips) fired
    // one providers-batch request PER ROW -- each a live TMDB fan-out, not a
    // cheap DB-cache read like ratings/seasons.
    const sharedLookup = (mediaType: string, tmdbId: number) =>
      mediaType === 'movie' && tmdbId === 1 ? ['HBO'] : undefined;

    renderRow({ items: [movie({ id: 1 })], providersFor: sharedLookup });

    await screen.findByText('HBO');
    expect(fetchProvidersBatch).not.toHaveBeenCalled();
  });

  it('renders nothing for an item the shared lookup has no answer for yet', () => {
    const sharedLookup = () => undefined;

    renderRow({ items: [movie({ id: 1, title: 'Unresolved Title' })], providersFor: sharedLookup });

    expect(screen.getByText('Unresolved Title')).toBeInTheDocument();
    expect(fetchProvidersBatch).not.toHaveBeenCalled();
  });
});

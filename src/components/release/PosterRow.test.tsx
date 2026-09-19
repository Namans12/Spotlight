import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PosterRow } from './PosterRow';
import type { Movie } from '@/types/movie';

vi.mock('@/contexts/WatchlistContext', async () => {
  const { watchlistStub } = await import('@/test/watchlistStub');
  return { useWatchlistContext: () => watchlistStub };
});
import { watchlistStub, resetWatchlistStub } from '@/test/watchlistStub';

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
  resetWatchlistStub();
});

describe('PosterRow providers', () => {
  it('fetches its own providers batch when no shared lookup is passed (a lone row)', async () => {
    vi.mocked(fetchProvidersBatch).mockResolvedValue({ providers: { 'movie:1': ['Netflix'] }, runtimes: {}, genres: {} });

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

describe('marking a title seen', () => {
  // The whole point of the feature: the watched bucket used to be reachable
  // only by saving a title first and then moving it, which is why it held four
  // rows in production. This must work on a title the reader has never saved.
  it('marks an unsaved title seen in one tap', async () => {
    const user = userEvent.setup();
    renderRow({ items: [movie({ id: 920, title: 'Cars' })], providersFor: () => undefined });

    await user.click(screen.getByRole('button', { name: /mark as seen/i }));

    expect(watchlistStub.toggleWatched).toHaveBeenCalledTimes(1);
    expect(watchlistStub.toggleWatched.mock.calls[0][0]).toMatchObject({ id: 920, mediaType: 'movie' });
  });

  it('shows an already-seen title as seen, and offers to unmark it', () => {
    watchlistStub.isWatched.mockReturnValue(true);

    renderRow({ items: [movie({ id: 920, title: 'Cars' })], providersFor: () => undefined });

    const toggle = screen.getByRole('button', { name: /unmark/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Still listed. A factual row stays complete; only recommendation
    // surfaces drop what you have seen.
    expect(screen.getByText('Cars')).toBeInTheDocument();
  });

  it('asks the watchlist per title rather than assuming one answer for the row', () => {
    watchlistStub.isWatched.mockImplementation((_type: string, id: number) => id === 920);

    renderRow({
      items: [movie({ id: 920, title: 'Cars' }), movie({ id: 49013, title: 'Cars 2' })],
      providersFor: () => undefined,
    });

    expect(screen.getAllByRole('button', { name: /unmark/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /mark as seen/i })).toHaveLength(1);
  });

  // Every control on a poster card sits inside the card's <Link>. A toggle
  // that doesn't stop the event both marks the title and navigates away from
  // the grid the reader was scanning. Asserted through the router rather than
  // through the event object: an earlier version of this test checked
  // `preventDefault` on a hand-dispatched MouseEvent and passed even with the
  // guard deleted, which made it worse than no test at all.
  it('does not navigate away when the toggle is tapped', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function LocationProbe() {
      return <span data-testid="path">{useLocation().pathname}</span>;
    }

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <LocationProbe />
          <PosterRow title="Row" items={[movie({ id: 920, title: 'Cars' })]} providersFor={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // textContent compared exactly, not toHaveTextContent: that matcher does a
    // SUBSTRING match, so "/title/movie/920" satisfies an assertion of "/" and
    // this test passed with the guard deleted.
    expect(screen.getByTestId('path').textContent).toBe('/');

    await user.click(screen.getByRole('button', { name: /mark as seen/i }));
    expect(watchlistStub.toggleWatched).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('path').textContent).toBe('/');

    // The card itself still navigates — the guard is scoped to the control,
    // not to the card.
    await user.click(screen.getByText('Cars'));
    expect(screen.getByTestId('path').textContent).toBe('/title/movie/920');
  });
});

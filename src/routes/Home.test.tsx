import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToolbarProvider, ToolbarOutlet } from '@/components/layout/Toolbar';
import Home from './Home';
import type { ReleaseItemDTO, DigestResponse } from '../../shared/types/release';

vi.mock('@/lib/api', () => ({ fetchDigest: vi.fn() }));
import { fetchDigest } from '@/lib/api';

// SectionBlock -> ProviderGroup -> ReleaseGrid pulls in ratings and the
// watchlist context for every card it renders — stubbed the same way
// Search.test.tsx stubs them, so this exercises Home's own filtering, not
// those network/localStorage-backed hooks.
vi.mock('@/lib/ratings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ratings')>()),
  fetchRatingsBatch: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/seasons', () => ({
  fetchSeasonsBatch: vi.fn().mockResolvedValue({}),
  seasonsKey: (tmdbId: number) => `tv:${tmdbId}`,
}));
vi.mock('@/contexts/WatchlistContext', async () => {
  const { watchlistStub } = await import('@/test/watchlistStub');
  return { useWatchlistContext: () => watchlistStub };
});
import { fetchSeasonsBatch } from '@/lib/seasons';

function release(overrides: Partial<ReleaseItemDTO>): ReleaseItemDTO {
  return {
    tmdb_id: 1,
    title: 'Some Film',
    media_type: 'movie',
    language: 'hi',
    release_date: '2026-08-21',
    rating: null,
    popularity: 1,
    overview: '',
    tmdb_url: 'https://example.invalid',
    poster_url: null,
    providers: [],
    ...overrides,
  };
}

function digest(outNowHindi: ReleaseItemDTO[]): DigestResponse {
  return {
    generated_at: '2026-08-21T00:00:00Z',
    region: 'IN',
    out_now: { start: '2026-08-15', end: '2026-08-21', sections: { hindi: outNowHindi, english: [], popular: [] } },
    coming_up: { start: '2026-08-22', end: '2026-08-28', sections: { hindi: [], english: [], popular: [] } },
  };
}

/** Toolbar portals its children into a node ToolbarOutlet provides — without
 * both, FiltersBar (the platform filter included) silently renders nothing. */
function renderHome(initialEntries = ['/']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <ToolbarProvider>
          <ToolbarOutlet />
          <Home />
        </ToolbarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchDigest).mockReset();
  vi.mocked(fetchSeasonsBatch).mockReset().mockResolvedValue({});
});

describe('Home platform filter', () => {
  const items = [
    release({ tmdb_id: 1, title: 'Netflix Show', providers: ['Netflix'] }),
    release({ tmdb_id: 2, title: 'Hulu Show', providers: ['Hulu'] }),
    release({ tmdb_id: 3, title: 'Prime Show', providers: ['Prime Video'] }),
  ];

  it('picking a second platform adds to the filter instead of replacing it, and records both in the URL', async () => {
    vi.mocked(fetchDigest).mockResolvedValue(digest(items));
    const user = userEvent.setup();
    renderHome();

    await screen.findByText('Netflix Show');
    expect(screen.getByText('Hulu Show')).toBeInTheDocument();
    expect(screen.getByText('Prime Show')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /platform/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Netflix'));
    // Multi-select: the menu stays open so a second pick doesn't need reopening.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(within(dialog).getByText('Hulu'));

    expect(screen.getByText('Netflix Show')).toBeInTheDocument();
    expect(screen.getByText('Hulu Show')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Prime Show')).not.toBeInTheDocument());
  });

  it('a deep link with two comma-joined platforms filters to their union on load', async () => {
    vi.mocked(fetchDigest).mockResolvedValue(digest(items));
    renderHome(['/?platform=Netflix,Hulu']);

    await screen.findByText('Netflix Show');
    expect(screen.getByText('Hulu Show')).toBeInTheDocument();
    expect(screen.queryByText('Prime Show')).not.toBeInTheDocument();
  });

  it('the clear button resets to all platforms, not just the last-picked one', async () => {
    vi.mocked(fetchDigest).mockResolvedValue(digest(items));
    const user = userEvent.setup();
    renderHome(['/?platform=Netflix,Hulu']);

    await screen.findByText('Netflix Show');
    expect(screen.queryByText('Prime Show')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear platform filter/i }));
    await waitFor(() => expect(screen.getByText('Prime Show')).toBeInTheDocument());
  });
});

describe('Home season count', () => {
  it('shows a TV card\'s season count once the seasons cache resolves, and never asks about a movie', async () => {
    vi.mocked(fetchSeasonsBatch).mockResolvedValue({
      'tv:1668': { tmdbId: 1668, mediaType: 'tv', numberOfSeasons: 10, fetchedAt: '2026-01-01', stale: false },
    });
    vi.mocked(fetchDigest).mockResolvedValue(
      digest([
        release({ tmdb_id: 1668, title: 'Friends', media_type: 'tv', providers: ['Netflix'] }),
        release({ tmdb_id: 550, title: 'Fight Club', media_type: 'movie', providers: ['Netflix'] }),
      ]),
    );
    renderHome();

    expect(await screen.findByText('Friends')).toBeInTheDocument();
    expect(await screen.findByText('10 Seasons')).toBeInTheDocument();
    await waitFor(() => expect(fetchSeasonsBatch).toHaveBeenCalledWith([1668]));
  });
});

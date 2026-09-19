import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Search from './Search';
import type { Movie } from '@/types/movie';

vi.mock('@/lib/tmdb', () => ({ searchMovies: vi.fn() }));
import { searchMovies } from '@/lib/tmdb';

// Search renders PosterCard for every result, which calls into the watchlist
// context for its Add buttons — stubbed so a test doesn't need the real
// hook's localStorage/network behaviour, only that Search wires it up.
vi.mock('@/contexts/WatchlistContext', async () => {
  const { watchlistStub } = await import('@/test/watchlistStub');
  return { useWatchlistContext: () => watchlistStub };
});

function movie(overrides: Partial<Movie>): Movie {
  return {
    id: 1,
    title: 'Some Film',
    posterPath: null,
    overview: '',
    releaseDate: '2026-08-21',
    mediaType: 'movie',
    voteAverage: 0,
    originalLanguage: 'hi',
    ...overrides,
  };
}

// Search now also calls useSeasons (useQuery under the hood) for its TV
// results, which needs a QueryClientProvider in scope — same reason
// Calendar.test.tsx and Home.test.tsx wrap their subject the same way.
function renderSearch(initialEntries = ['/search?q=love']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Search />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(searchMovies).mockReset();
});

describe('Search language filter', () => {
  const results = [
    movie({ id: 1, title: 'Judaa', originalLanguage: 'pa' }),
    movie({ id: 2, title: 'Brahmakamala', originalLanguage: 'kn' }),
    movie({ id: 3, title: 'Bharat Desh Hai Mera', originalLanguage: 'hi' }),
  ];

  it('shows full language names once results load, and offers them as filter options', async () => {
    vi.mocked(searchMovies).mockResolvedValue(results);
    const user = userEvent.setup();
    renderSearch();

    await screen.findByText('Judaa');
    await user.click(screen.getByRole('button', { name: /language/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Punjabi')).toBeInTheDocument();
    expect(within(dialog).getByText('Kannada')).toBeInTheDocument();
    expect(within(dialog).getByText('Hindi')).toBeInTheDocument();
  });

  it('narrows results to the picked language and updates the count line', async () => {
    vi.mocked(searchMovies).mockResolvedValue(results);
    const user = userEvent.setup();
    renderSearch();

    await screen.findByText('Judaa');
    await user.click(screen.getByRole('button', { name: /language/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Punjabi'));

    await waitFor(() => expect(screen.queryByText('Brahmakamala')).not.toBeInTheDocument());
    expect(screen.getByText('Judaa')).toBeInTheDocument();
    expect(screen.getByText(/1 result/i)).toBeInTheDocument();
  });

  it('shows the language-specific empty message, distinct from the media-type one, when a stale ?language filters everything out', async () => {
    // A URL carrying ?language=pa from a previous search, now landing on a
    // result set with no Punjabi title at all — the exact way this message
    // is reachable, since the filter's own option list never offers a
    // language absent from the current results.
    vi.mocked(searchMovies).mockResolvedValue([movie({ id: 1, title: 'Brahmakamala', originalLanguage: 'kn' })]);
    renderSearch(['/search?q=love&language=pa']);

    expect(await screen.findByText(/none in punjabi/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear the language filter/i })).toBeInTheDocument();
    expect(screen.queryByText('Brahmakamala')).not.toBeInTheDocument();
  });

  it('clearing the language filter from that message restores the results', async () => {
    vi.mocked(searchMovies).mockResolvedValue([movie({ id: 1, title: 'Brahmakamala', originalLanguage: 'kn' })]);
    const user = userEvent.setup();
    renderSearch(['/search?q=love&language=pa']);

    await user.click(await screen.findByRole('button', { name: /clear the language filter/i }));
    expect(await screen.findByText('Brahmakamala')).toBeInTheDocument();
  });

  it('picking a second language adds to the filter instead of replacing it, and records both in the URL', async () => {
    vi.mocked(searchMovies).mockResolvedValue(results);
    const user = userEvent.setup();
    renderSearch();

    await screen.findByText('Judaa');
    await user.click(screen.getByRole('button', { name: /language/i }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByText('Punjabi'));
    // Multi-select: the menu stays open so a second pick doesn't need reopening.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(within(dialog).getByText('Kannada'));

    expect(screen.getByText('Judaa')).toBeInTheDocument();
    expect(screen.getByText('Brahmakamala')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Bharat Desh Hai Mera')).not.toBeInTheDocument());
  });
});

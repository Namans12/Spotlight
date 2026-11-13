import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tmdbDetail', () => ({ fetchTitleDetail: vi.fn().mockResolvedValue({
  id: 1399, mediaType: 'tv', title: 'Game of Thrones', overview: '', posterUrl: null, backdropUrl: null,
  releaseDate: '2011-01-01', rating: null, runtime: null, genres: [], providers: [], tmdbUrl: 'https://example.com',
  originalLanguage: 'en', numberOfSeasons: null, numberOfEpisodes: null, seasons: [], tagline: null, status: null,
  certification: null, budget: null, revenue: null, logoPath: null, trailer: null,
}), titleDetailToMovie: vi.fn(() => ({})) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));
vi.mock('@/contexts/watchlist-context', () => ({ useWatchlistContext: () => ({ watched: [], opinions: {}, watchedKeys: new Set() }) }));
vi.mock('@/hooks/useRelations', () => ({ useRelations: () => ({ data: null }) }));
vi.mock('@/hooks/useRatings', () => ({ useRating: () => ({ data: null }) }));
vi.mock('@/hooks/useDocumentMeta', () => ({ useDocumentMeta: () => {}, siteUrl: () => 'https://example.com' }));
vi.mock('@/lib/tmdb', () => ({ getYouMayAlsoLike: vi.fn().mockResolvedValue([]), getCredits: vi.fn().mockResolvedValue(null) }));
vi.mock('@/components/title/FactsPanel', () => ({ FactsPanel: () => null }));

import TitleDetail from './TitleDetail';
import { fetchTitleDetail } from '@/lib/tmdbDetail';

describe('title watch-night sections', () => {
  it('shows local offer types and credits the provider source', async () => {
    vi.mocked(fetchTitleDetail).mockResolvedValueOnce({ id: 1399, mediaType: 'tv', title: 'Game of Thrones', overview: '', posterUrl: null, backdropUrl: null,
      releaseDate: '2011-01-01', rating: null, runtime: null, genres: [], providers: ['Netflix'], tmdbUrl: 'https://example.com',
      availability: [{ provider: 'Netflix', type: 'subscription' }, { provider: 'Netflix', type: 'rent' }], watchUrl: 'https://www.themoviedb.org/tv/1399/watch?locale=IN',
      originalLanguage: 'en', numberOfSeasons: null, numberOfEpisodes: null, seasons: [], tagline: null, status: null,
      certification: null, budget: null, revenue: null, logoPath: null, trailer: null } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/title/tv/1399']}><Routes><Route path="/title/:type/:id" element={<TitleDetail />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Netflix (subscription) · Netflix (rent)')).toBeInTheDocument();
    expect(screen.getByText(/Source: JustWatch via TMDB/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open TMDB watch options' })).toHaveAttribute('href', 'https://www.themoviedb.org/tv/1399/watch?locale=IN');
    client.clear();
  });
  it('keeps exactly one of each card when the title page rerenders', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const app = (tick: number) => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/title/tv/1399']}>
      <span>{tick}</span><Routes><Route path="/title/:type/:id" element={<TitleDetail />} /></Routes>
    </MemoryRouter></QueryClientProvider>;
    const view = render(app(0));
    await screen.findByRole('region', { name: 'Quick trivia' });
    view.rerender(app(1));
    view.rerender(app(2));
    await waitFor(() => expect(screen.getAllByRole('region', { name: 'Watch-night ideas' })).toHaveLength(1));
    expect(screen.getAllByRole('region', { name: 'Quick trivia' })).toHaveLength(1);
    client.clear();
  });
});

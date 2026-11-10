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
vi.mock('@/contexts/WatchlistContext', () => ({ useWatchlistContext: () => ({ watched: [], opinions: {}, watchedKeys: new Set() }) }));
vi.mock('@/hooks/useRelations', () => ({ useRelations: () => ({ data: null }) }));
vi.mock('@/hooks/useRatings', () => ({ useRating: () => ({ data: null }) }));
vi.mock('@/hooks/useDocumentMeta', () => ({ useDocumentMeta: () => {}, siteUrl: () => 'https://example.com' }));
vi.mock('@/lib/tmdb', () => ({ getYouMayAlsoLike: vi.fn().mockResolvedValue([]), getCredits: vi.fn().mockResolvedValue(null) }));
vi.mock('@/components/title/FactsPanel', () => ({ FactsPanel: () => null }));

import TitleDetail from './TitleDetail';

describe('title watch-night sections', () => {
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

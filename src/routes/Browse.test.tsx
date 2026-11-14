import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tmdb', () => ({
  getTrending: vi.fn().mockRejectedValue(new Error('Network unavailable')),
  getPopularMovies: vi.fn().mockRejectedValue(new Error('Network unavailable')),
  getPopularTV: vi.fn().mockRejectedValue(new Error('Network unavailable')),
}));
vi.mock('@/contexts/watchlist-context', () => ({ useWatchlistContext: () => ({}) }));
vi.mock('@/hooks/useSuggestions', () => ({ useSuggestions: () => ({ data: [] }) }));
vi.mock('@/hooks/useSeasons', () => ({ useSeasons: () => () => undefined }));
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => () => undefined }));

import Browse from './Browse';

describe('Browse catalogue failures', () => {
  it('shows a retryable error rather than claiming the catalogue is empty', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><Browse /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Some catalogue titles could not be loaded');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(screen.queryByText(/Nothing here for this media type/)).not.toBeInTheDocument();
    client.clear();
  });
});

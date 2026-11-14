import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Duel from './Duel';
import { discover, getYouMayAlsoLike } from '@/lib/tmdb';
import { fetchProvidersBatch } from '@/lib/providers';
import type { Movie } from '@/types/movie';
const state = vi.hoisted(() => ({ watchlist: [], watchLater: [], watchedKeys: new Set<string>(), addToWatchlist: vi.fn() }));
vi.mock('@/contexts/watchlist-context', () => ({ useWatchlistContext: () => state }));
vi.mock('@/lib/tmdb', () => ({ discover: vi.fn(), getTrending: vi.fn().mockResolvedValue([]), getPopularMovies: vi.fn().mockResolvedValue([]), getPopularTV: vi.fn().mockResolvedValue([]), getYouMayAlsoLike: vi.fn() }));
vi.mock('@/lib/providers', async original => ({ ...await original<typeof import('@/lib/providers')>(), fetchProvidersBatch: vi.fn() }));
const movie = (id: number, releaseDate = '2020-01-01'): Movie => ({ id, title: `Title ${id}`, mediaType: 'movie', releaseDate, originalLanguage: 'en', overview: '', posterPath: '/poster.jpg', voteAverage: 7 });
function page() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 return render(<QueryClientProvider client={client}><MemoryRouter><Duel /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
 state.watchedKeys = new Set();
 vi.mocked(discover).mockResolvedValue(Array.from({ length: 20 }, (_, i) => movie(i + 1)));
 vi.mocked(getYouMayAlsoLike).mockResolvedValue([movie(100), movie(101, '2099-12-18')].map(item => ({ ...item, score: 1, reasons: [] })));
 vi.mocked(fetchProvidersBatch).mockImplementation(async items => ({ providers: {}, genres: Object.fromEntries(items.map(item => [`${item.mediaType}:${item.id}`, ['Comedy']])), runtimes: {} }));
});
describe('Duel discovery', () => {
 it('learns from five pairs and recommends an unseen title outside those pairs', async () => {
  const user = userEvent.setup(); page();
  await user.click(screen.getByRole('button', { name: /Movies/ }));
  for (let round = 1; round <= 5; round++) {
   await screen.findByText(`${round} of 5`);
   const options = await screen.findAllByRole('button', { name: /^Title/ });
   await user.click(options[0]);
  }
  expect(await screen.findByRole('heading', { name: 'Title 100' })).toBeInTheDocument();
  expect(screen.queryByText('Title 101')).not.toBeInTheDocument();
  expect(getYouMayAlsoLike).toHaveBeenCalledTimes(3);
 });
 it('does not deal future releases and waits for attributes before showing a pair', async () => {
  vi.mocked(discover).mockResolvedValue([movie(1), movie(2), movie(99, '2099-12-18')]);
  let complete!: (data: Awaited<ReturnType<typeof fetchProvidersBatch>>) => void;
  vi.mocked(fetchProvidersBatch).mockReturnValue(new Promise(resolve => { complete = resolve; }));
  page(); fireEvent.click(screen.getByRole('button', { name: /Movies/ }));
  await waitFor(() => expect(fetchProvidersBatch).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: /^Title/ })).not.toBeInTheDocument();
  complete({ providers: {}, genres: {}, runtimes: {} });
  expect(await screen.findAllByRole('button', { name: /^Title/ })).toHaveLength(2);
  expect(screen.queryByText('Title 99')).not.toBeInTheDocument();
 });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Tonight from './Tonight';
import type { Movie } from '@/types/movie';

const movie = (id: number, title: string, language = 'en'): Movie => ({ id, title, mediaType: 'movie',
  posterPath: '/poster.jpg', overview: '', releaseDate: '2020-01-01', voteAverage: 7, originalLanguage: language });
const fixtures = [movie(1, 'Comedy choice'), movie(2, 'Mystery choice'), movie(3, 'No provider', 'hi')];
const state = vi.hoisted(() => ({ watchedKeys: new Set<string>(), watchlist: [], watchLater: [], customListItems: {}, isAuthenticated: false, addToWatchlistAsync: vi.fn() }));
vi.mock('@/contexts/watchlist-context', () => ({ useWatchlistContext: () => state }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: state.isAuthenticated }) }));
vi.mock('@/lib/tmdb', () => ({ discover: vi.fn().mockResolvedValue([]), getTrending: vi.fn(), getPopularMovies: vi.fn(), getPopularTV: vi.fn(), getYouMayAlsoLike: vi.fn() }));
vi.mock('@/lib/providers', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/providers')>(), fetchProvidersBatch: vi.fn() }));
import { getTrending, getPopularMovies, getPopularTV } from '@/lib/tmdb';
import { fetchProvidersBatch } from '@/lib/providers';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><Tonight /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  state.isAuthenticated = false;
  state.addToWatchlistAsync.mockReset();
  vi.mocked(getTrending).mockResolvedValue(fixtures);
  vi.mocked(getPopularMovies).mockResolvedValue([]);
  vi.mocked(getPopularTV).mockResolvedValue([]);
  vi.mocked(fetchProvidersBatch).mockResolvedValue({ providers: {},
    availability: { 'movie:1': [{ provider: 'Netflix', type: 'subscription' }], 'movie:2': [{ provider: 'Netflix', type: 'rent' }], 'movie:3': [] },
    runtimes: { 'movie:1': 90, 'movie:2': 120, 'movie:3': 80 },
    genres: { 'movie:1': ['Comedy'], 'movie:2': ['Mystery'], 'movie:3': ['Drama'] } });
});

it('prevents repeated saves in flight and lets the user retry a failed save', async () => {
  state.isAuthenticated = true;
  let rejectSave!: (reason: Error) => void;
  state.addToWatchlistAsync.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; })).mockResolvedValueOnce(true);
  const user = userEvent.setup(); renderPage();
  await user.click(await screen.findByRole('button', { name: 'Find something to watch' }));
  const card = within(screen.getByRole('region', { name: 'Your options' })).getByText('Comedy choice').closest('article') as HTMLElement;
  await user.click(within(card).getByRole('button', { name: 'Save' }));
  expect(within(card).getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(state.addToWatchlistAsync).toHaveBeenCalledTimes(1);
  rejectSave(new Error('unavailable'));
  expect(await within(card).findByRole('alert')).toHaveTextContent('Could not save this title');
  await user.click(within(card).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(state.addToWatchlistAsync).toHaveBeenCalledTimes(2));
  expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
});

describe('Tonight flow', () => {
  it('shows offer types when no service filter is selected', async () => {
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'Find something to watch' }));
    const results = screen.getByRole('region', { name: 'Your options' });
    const subscription = within(results).getByText('Comedy choice').closest('article') as HTMLElement;
    const rental = within(results).getByText('Mystery choice').closest('article') as HTMLElement;
    const unknown = within(results).getByText('No provider').closest('article') as HTMLElement;
    expect(within(subscription).getByText('Reported in India: Netflix (subscription)')).toBeInTheDocument();
    expect(within(rental).getByText('Reported in India: Netflix (rent)')).toBeInTheDocument();
    expect(within(unknown).getByText('Availability unknown in India')).toBeInTheDocument();
  });
  it('works signed out and explains a mood, time and service match', async () => {
    const user = userEvent.setup(); renderPage();
    await user.selectOptions(await screen.findByLabelText('Mood'), 'light');
    await user.selectOptions(screen.getByLabelText('Time available'), '90');
    await user.click(screen.getByLabelText('Netflix'));
    await user.click(await screen.findByRole('button', { name: 'Find something to watch' }));
    const results = screen.getByRole('region', { name: 'Your options' });
    expect(within(results).getByText('Comedy choice')).toBeInTheDocument();
    expect(within(results).getByText('• Comedy genre fits your mood preference')).toBeInTheDocument();
    expect(within(results).getByText(/Netflix \(subscription\)/)).toBeInTheDocument();
    expect(within(results).queryByText('Mystery choice')).not.toBeInTheDocument();
    expect(within(results).getByRole('link', { name: 'Sign in to save' })).toHaveAttribute('href', '/login');
  });
  it('reports no verified matches instead of treating unknown availability as a match', async () => {
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByLabelText('SonyLIV'));
    await user.click(await screen.findByRole('button', { name: 'Find something to watch' }));
    expect(screen.getByText(/No matches with the information available/)).toBeInTheDocument();
  });
});

it('accepts an optional Duel choice and explains supported matching attributes', async () => {
  const user = userEvent.setup(); renderPage();
  const duel = await screen.findByRole('group', { name: /A quick Duel/ });
  await user.click(within(duel).getByRole('button', { name: 'Comedy choice' }));
  await user.click(await screen.findByRole('button', { name: 'Find something to watch' }));
  expect(screen.getByRole('region', { name: 'Your options' })).toHaveTextContent('Shares attributes with your Duel choice');
});

it('keeps partial results usable when a discovery source fails', async () => {
  vi.mocked(getPopularTV).mockRejectedValueOnce(new Error('unavailable'));
  const user = userEvent.setup(); renderPage();
  expect(await screen.findByText(/Some discovery sources could not load/)).toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: 'Find something to watch' }));
  expect(screen.getByRole('region', { name: 'Your options' })).toHaveTextContent('Comedy choice');
});

it('hides feedback items for the session and allows the user to restore them', async () => {
  const user = userEvent.setup(); renderPage();
  await user.click(await screen.findByRole('button', { name: 'Find something to watch' }));
  const results = screen.getByRole('region', { name: 'Your options' });
  const card = within(results).getByText('Comedy choice').closest('article');
  expect(card).not.toBeNull();
  await user.click(within(card as HTMLElement).getByRole('button', { name: 'Not for me' }));
  expect(within(results).queryByText('Comedy choice')).not.toBeInTheDocument();
  expect(within(results).getByText(/Feedback is used only in this session/)).toBeInTheDocument();
  await user.click(within(results).getByRole('button', { name: 'Clear feedback' }));
  expect(within(results).getByText('Comedy choice')).toBeInTheDocument();
});

it('reports unknown availability on failure and recovers after a retry', async () => {
  vi.mocked(fetchProvidersBatch).mockRejectedValueOnce(new Error('unavailable'));
  const user = userEvent.setup(); renderPage();
  expect(await screen.findByText(/Availability and runtime could not be checked/)).toBeInTheDocument();
  await user.click(screen.getByLabelText('Netflix'));
  await user.click(screen.getByRole('button', { name: 'Find something to watch' }));
  expect(screen.getByText(/No matches with the information available/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'try again' }));
  expect(await within(screen.getByRole('region', { name: 'Your options' })).findByText('Comedy choice')).toBeInTheDocument();
});

it('warns about partial checks, keeps verified options and retries', async () => {
  vi.mocked(fetchProvidersBatch).mockResolvedValueOnce({ providers: {}, availability: { 'movie:1': [{ provider: 'Netflix', type: 'subscription' }] },
    runtimes: { 'movie:1': 90 }, genres: { 'movie:1': ['Comedy'] }, hadFailures: true });
  const user = userEvent.setup(); renderPage();
  expect(await screen.findByText(/Some availability and runtime checks failed/)).toBeInTheDocument();
  await user.click(screen.getByLabelText('Netflix'));
  await user.click(screen.getByRole('button', { name: 'Find something to watch' }));
  expect(within(screen.getByRole('region', { name: 'Your options' })).getByText('Comedy choice')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try those checks again' }));
  await waitFor(() => expect(screen.queryByText(/Some availability and runtime checks failed/)).not.toBeInTheDocument());
});

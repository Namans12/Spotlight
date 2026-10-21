import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TitleDetail as TitleDetailData } from '@/lib/tmdbDetail';

// The page's own data sources are replaced; the Pulse components under test
// are real, with only their network functions stubbed.
vi.mock('@/lib/tmdbDetail', () => ({
  fetchTitleDetail: vi.fn(),
  titleDetailToMovie: vi.fn((d: { id: number; title: string }) => ({ id: d.id, title: d.title })),
}));
vi.mock('@/lib/tmdb', () => ({
  getYouMayAlsoLike: vi.fn().mockResolvedValue([]),
  getCredits: vi.fn().mockResolvedValue({ cast: [], directors: [] }),
}));
vi.mock('@/lib/relations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/relations')>()),
  fetchRelations: vi.fn().mockResolvedValue({ origin: null, mustWatch: { before: [], after: [] }, canWatch: [], depth: 1, hasMore: false }),
}));
vi.mock('@/lib/ratings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ratings')>()),
  fetchRating: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));
vi.mock('@/contexts/WatchlistContext', () => ({
  useWatchlistContext: () => ({
    watched: [],
    opinions: {},
    watchedKeys: new Set<string>(),
    isWatched: () => false,
    opinionFor: () => undefined,
    progressFor: () => null,
    addToWatchlist: vi.fn(),
    addToWatchLater: vi.fn(),
    toggleWatched: vi.fn(),
    setOpinion: vi.fn(),
    setProgress: vi.fn(),
    advanceProgress: vi.fn(),
  }),
}));
vi.mock('@/lib/pulseApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pulseApi')>()),
  fetchTitleLocations: vi.fn(),
  fetchPlanNight: vi.fn(),
  pulseConfigured: vi.fn(() => true),
}));
import { fetchTitleDetail } from '@/lib/tmdbDetail';
import { fetchTitleLocations, pulseConfigured } from '@/lib/pulseApi';
import TitleDetail from './TitleDetail';

const detail: TitleDetailData = {
  id: 999900001,
  mediaType: 'movie',
  title: 'Saffron Nights',
  overview: 'A film.',
  posterPath: null,
  posterUrl: null,
  backdropPath: null,
  backdropUrl: null,
  releaseDate: '2026-10-24',
  rating: null,
  runtime: 120,
  genres: [],
  providers: [],
  tmdbUrl: 'https://example.invalid/t',
  originalLanguage: 'hi',
  numberOfSeasons: null,
  numberOfEpisodes: null,
  seasons: [],
  tagline: null,
  status: 'Released',
  certification: null,
  budget: null,
  revenue: null,
  logoPath: null,
  trailer: { key: 'abc123', site: 'YouTube', name: 'Official Trailer' },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/title/movie/999900001']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/title/:type/:id" element={<TitleDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchTitleLocations).mockReset();
  vi.mocked(fetchTitleDetail).mockResolvedValue(detail);
  vi.mocked(fetchTitleLocations).mockResolvedValue([{ city_slug: 'delhi', cityName: 'Delhi', kind: 'filmed', landmark_label: null, source: 'both' }]);
  vi.mocked(pulseConfigured).mockReturnValue(true);
});

/** Document order of the three sections, by their headings. */
const position = (el: HTMLElement) => Array.from(document.body.querySelectorAll('*')).indexOf(el);

describe('TitleDetail Pulse sections', () => {
  it('mounts the locations panel, then the plan card, between the facts and the trailer', async () => {
    renderPage();
    const locations = await screen.findByRole('heading', { name: 'Filmed in & set in' });
    const plan = screen.getByRole('heading', { name: 'Plan the night' });
    const trailer = screen.getByRole('heading', { name: 'Trailer' });
    const facts = screen.getByText('Original language');
    expect(position(facts)).toBeLessThan(position(locations));
    expect(position(locations)).toBeLessThan(position(plan));
    expect(position(plan)).toBeLessThan(position(trailer));
  });

  it('hands the card the page title and asks the service about this title', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Plan the night' });
    expect(vi.mocked(fetchTitleLocations).mock.calls[0].slice(0, 2)).toEqual(['movie', 999900001]);
  });

  it('leaves the rest of the page as it was when Pulse is not configured', async () => {
    vi.mocked(pulseConfigured).mockReturnValue(false);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Trailer' })).toBeInTheDocument();
    expect(screen.getByText('Original language')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Plan the night' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Filmed in & set in' })).toBeNull();
    expect(fetchTitleLocations).not.toHaveBeenCalled();
  });

  it('keeps the plan card and the trailer when there is no location record', async () => {
    vi.mocked(fetchTitleLocations).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Plan the night' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trailer' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Filmed in & set in' })).toBeNull();
  });
});

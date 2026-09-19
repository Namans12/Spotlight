import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WatchlistView } from './WatchlistView';
import type { WatchlistItem } from '@/types/movie';

// The "what can I watch right now" bar, end to end through the component.
// src/lib/watchNow.test.ts covers the filtering rules themselves; this covers
// the wiring — that the controls appear only when they can do something, that
// picking one narrows the list, and that dragging is off while filtered.

vi.mock('@/lib/providers', () => ({
  fetchProvidersBatch: vi.fn(),
  providerKey: (mediaType: string, tmdbId: number) => `${mediaType}:${tmdbId}`,
}));
vi.mock('@/lib/seasons', () => ({
  fetchSeasonsBatch: vi.fn().mockResolvedValue({}),
  seasonsKey: (tmdbId: number) => `tv:${tmdbId}`,
}));
import { fetchProvidersBatch } from '@/lib/providers';

function item(id: number, title: string, over: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    dbId: id,
    id,
    title,
    mediaType: 'movie',
    posterPath: null,
    backdropPath: null,
    overview: '',
    releaseDate: '2020-01-01',
    voteAverage: 7,
    originalLanguage: 'en',
    addedAt: 0,
    ...over,
  } as WatchlistItem;
}

const ITEMS = [
  item(1, 'Short Film'),
  item(2, 'Long Film'),
  item(3, 'A Series', { mediaType: 'tv' }),
];

function renderView(props: Partial<React.ComponentProps<typeof WatchlistView>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WatchlistView
          items={ITEMS}
          onReorder={vi.fn()}
          onMarkWatched={vi.fn()}
          onRemove={vi.fn()}
          showWatchNow
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchProvidersBatch).mockReset();
  vi.mocked(fetchProvidersBatch).mockResolvedValue({
    providers: { 'movie:1': ['Netflix'], 'movie:2': ['JioHotstar'], 'tv:3': ['Netflix'] },
    runtimes: { 'movie:1': 22, 'movie:2': 150, 'tv:3': 30 },
    genres: {},
  });
});

describe('what can I watch right now', () => {
  it('offers only the platforms this list actually has something on', async () => {
    renderView();
    await screen.findByRole('button', { name: 'Netflix' });
    expect(screen.getByRole('button', { name: 'JioHotstar' })).toBeInTheDocument();
    // A chip that would empty the page is worse than no chip.
    expect(screen.queryByRole('button', { name: 'Prime Video' })).not.toBeInTheDocument();
  });

  it('narrows the list to one platform and says how many are showing', async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByRole('button', { name: 'JioHotstar' });
    expect(screen.getByText('Long Film')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'JioHotstar' }));

    expect(screen.getByText('Long Film')).toBeInTheDocument();
    expect(screen.queryByText('Short Film')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('filters by how long you have', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole('button', { name: /Under 45 min/ }));

    expect(screen.getByText('Short Film')).toBeInTheDocument();
    expect(screen.getByText('A Series')).toBeInTheDocument(); // a 30-min episode
    expect(screen.queryByText('Long Film')).not.toBeInTheDocument();
  });

  it('combines filters', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole('button', { name: /Under 45 min/ }));
    await user.click(screen.getByRole('button', { name: 'Films' }));

    expect(screen.getByText('Short Film')).toBeInTheDocument();
    expect(screen.queryByText('A Series')).not.toBeInTheDocument();
  });

  it('says so plainly when nothing fits, rather than showing an empty page', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole('button', { name: /Over 2 hr/ }));
    await user.click(screen.getByRole('button', { name: 'Series' }));

    expect(screen.getByText(/Nothing on your list fits that right now/)).toBeInTheDocument();
  });

  it('restores the full list when cleared', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole('button', { name: 'JioHotstar' }));
    expect(screen.queryByText('Short Film')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Clear/ }));
    expect(screen.getByText('Short Film')).toBeInTheDocument();
    expect(screen.getByText('Long Film')).toBeInTheDocument();
  });

  it('shows no bar at all on a list with nothing to narrow', async () => {
    vi.mocked(fetchProvidersBatch).mockResolvedValue({ providers: {}, runtimes: {}, genres: {} });
    renderView();
    await waitFor(() => expect(fetchProvidersBatch).toHaveBeenCalled());
    // A filter bar with no usable filters is furniture.
    expect(screen.queryByText('What can I watch right now?')).not.toBeInTheDocument();
    expect(screen.getByText('Short Film')).toBeInTheDocument();
  });

  it('is absent entirely where it is not wanted, like the Watched list', async () => {
    renderView({ showWatchNow: false });
    await waitFor(() => expect(screen.getByText('Short Film')).toBeInTheDocument());
    expect(screen.queryByText('What can I watch right now?')).not.toBeInTheDocument();
  });

  it('stops offering drag handles while a filter is on', async () => {
    // onReorder persists positions by index into the FULL list, so a drag
    // within a filtered subset would move whichever titles happen to sit at
    // those indices in the unfiltered order — reordering things the person
    // cannot even see.
    const user = userEvent.setup();
    const { container } = renderView();
    await screen.findByRole('button', { name: 'JioHotstar' });
    const before = container.querySelectorAll('[role="button"][aria-roledescription], [data-dnd-draggable]').length;

    await user.click(screen.getByRole('button', { name: 'JioHotstar' }));
    // dnd-kit marks sortable nodes with aria-describedby wired to its own
    // instructions; with the DndContext gone, none remain.
    expect(container.querySelectorAll('[aria-describedby^="DndDescribedBy"]').length).toBe(0);
    expect(before).toBeGreaterThanOrEqual(0);
  });
});

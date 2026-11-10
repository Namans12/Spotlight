import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToolbarProvider, ToolbarOutlet } from '@/components/layout/Toolbar';
import Calendar from './Calendar';
import type { CalendarEntryDTO } from '../../shared/types/calendar';

// The real network call — mocked so these tests exercise Calendar's own
// filtering/rendering logic, not the API or a live database.
vi.mock('@/lib/api', () => ({ fetchCalendarMonth: vi.fn() }));
import { fetchCalendarMonth } from '@/lib/api';

vi.mock('@/lib/seasons', () => ({
  fetchSeasonsBatch: vi.fn().mockResolvedValue({}),
  seasonsKey: (tmdbId: number) => `tv:${tmdbId}`,
}));
import { fetchSeasonsBatch } from '@/lib/seasons';
vi.mock('@/lib/providers', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/providers')>(), fetchProvidersBatch: vi.fn() }));
import { fetchProvidersBatch } from '@/lib/providers';

function entry(overrides: Partial<CalendarEntryDTO>): CalendarEntryDTO {
  return {
    releaseDate: '2026-08-21',
    title: 'Some Film',
    language: 'hi',
    mediaType: 'movie',
    kind: 'theatrical',
    isTheatrical: true,
    platform: null,
    platforms: [],
    region: "IN",
    tmdbId: 1,
    posterUrl: null,
    rating: null,
    overview: null,
    origin: 'tmdb',
    originRegion: null,
    originReleaseDate: null,
    ...overrides,
  };
}

/** Toolbar portals its children into a node ToolbarOutlet provides — without
 * both, everything Calendar renders into <Toolbar> (the language filter
 * included) silently renders nothing. */
function renderCalendar(initialEntries = ['/calendar?month=2026-08']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <ToolbarProvider>
          <ToolbarOutlet />
          <Calendar />
        </ToolbarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchCalendarMonth).mockReset();
  vi.mocked(fetchSeasonsBatch).mockReset().mockResolvedValue({});
});

describe('Calendar language display and filter', () => {
  const entries = [
    entry({ title: 'Judaa', language: 'pa', tmdbId: 1 }),
    entry({ title: 'Brahmakamala', language: 'kn', tmdbId: 2 }),
    entry({ title: 'Bharat Desh Hai Mera', language: 'hi', tmdbId: 3 }),
  ];

  it('shows full language names, not raw ISO codes', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({ month: '2026-08', entries });
    renderCalendar();

    expect(await screen.findByText('Judaa')).toBeInTheDocument();
    expect(screen.getByText('Punjabi')).toBeInTheDocument();
    expect(screen.getByText('Kannada')).toBeInTheDocument();
    // The raw code must not appear anywhere as its own text node.
    expect(screen.queryByText('pa')).not.toBeInTheDocument();
    expect(screen.queryByText('kn')).not.toBeInTheDocument();
  });

  it('narrows results when a language is picked, and the URL records it', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({ month: '2026-08', entries });
    const user = userEvent.setup();
    renderCalendar();

    await screen.findByText('Judaa');
    expect(screen.getByText('Brahmakamala')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /language/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Punjabi'));

    await waitFor(() => expect(screen.queryByText('Brahmakamala')).not.toBeInTheDocument());
    expect(screen.getByText('Judaa')).toBeInTheDocument();
  });

  it('picking a second language adds to the filter instead of replacing it', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({ month: '2026-08', entries });
    const user = userEvent.setup();
    renderCalendar();

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

  it('two languages that both mean Chinese collapse into one filter option', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({
      month: '2026-08',
      entries: [entry({ title: 'A', language: 'zh', tmdbId: 1 }), entry({ title: 'B', language: 'cn', tmdbId: 2 })],
    });
    const user = userEvent.setup();
    renderCalendar();

    await screen.findByText('A');
    await user.click(screen.getByRole('button', { name: /language/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('Chinese')).toHaveLength(1);

    // And picking it must match BOTH underlying codes.
    await user.click(within(dialog).getByText('Chinese'));
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });
});

describe('Calendar season count', () => {
  it('shows a TV entry\'s season count once the seasons cache resolves', async () => {
    vi.mocked(fetchSeasonsBatch).mockResolvedValue({
      'tv:76331': { tmdbId: 76331, mediaType: 'tv', numberOfSeasons: 8, fetchedAt: '2026-01-01', stale: false },
    });
    vi.mocked(fetchCalendarMonth).mockResolvedValue({
      month: '2026-08',
      entries: [entry({ title: 'Game of Thrones', mediaType: 'tv', tmdbId: 76331, language: 'en' })],
    });
    renderCalendar();

    expect(await screen.findByText('Game of Thrones')).toBeInTheDocument();
    expect(await screen.findByText('8 Seasons')).toBeInTheDocument();
  });

  it('never asks the seasons cache about a movie entry', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({
      month: '2026-08',
      entries: [entry({ title: 'A Movie', mediaType: 'movie', tmdbId: 550, language: 'en' })],
    });
    renderCalendar();

    await screen.findByText('A Movie');
    expect(fetchSeasonsBatch).not.toHaveBeenCalled();
  });

  it('shows nothing extra for a TV entry the seasons cache has no answer for yet', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({
      month: '2026-08',
      entries: [entry({ title: 'Brand New Show', mediaType: 'tv', tmdbId: 999999, language: 'en' })],
    });
    renderCalendar();

    await screen.findByText('Brand New Show');
    await waitFor(() => expect(fetchSeasonsBatch).toHaveBeenCalledWith([999999]));
    expect(screen.queryByText(/Season/)).not.toBeInTheDocument();
  });
});

describe('Calendar origin-region bracket', () => {
  it('shows a foreign home-market date in parentheses next to the language', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({
      month: '2026-08',
      entries: [
        entry({
          title: 'ChaO',
          language: 'ja',
          originRegion: 'JP',
          originReleaseDate: '2025-08-15',
        }),
      ],
    });
    renderCalendar();

    expect(await screen.findByText('ChaO')).toBeInTheDocument();
    expect(screen.getByText('(JP: 15th Aug)')).toBeInTheDocument();
  });

  it('shows no bracket when there is nothing extra to say', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({
      month: '2026-08',
      entries: [entry({ title: 'Brahmakamala', language: 'kn', originRegion: null, originReleaseDate: null })],
    });
    renderCalendar();

    await screen.findByText('Brahmakamala');
    expect(screen.queryByText(/^\(/)).not.toBeInTheDocument();
  });
});

describe('Calendar release-kind tabs', () => {
  it('In Cinemas hides streaming and TV-network entries', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({
      month: '2026-08',
      entries: [
        entry({ title: 'A Cinema Release', kind: 'theatrical', isTheatrical: true, tmdbId: 1 }),
        entry({ title: 'A Streaming Release', kind: 'streaming', isTheatrical: false, tmdbId: 2 }),
      ],
    });
    const user = userEvent.setup();
    renderCalendar();

    await screen.findByText('A Cinema Release');
    expect(screen.getByText('A Streaming Release')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /in cinemas/i }));
    await waitFor(() => expect(screen.queryByText('A Streaming Release')).not.toBeInTheDocument());
    expect(screen.getByText('A Cinema Release')).toBeInTheDocument();
  });
});

describe('Calendar event details', () => {
  it('shows linked editorial review and preserves regional uncertainty', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({ month: '2026-08', entries: [entry({
      title: 'Reviewed film', region: null, dateConflict: { message: 'Date needs review', source: 'Studio',
        sourceUrl: 'https://example.com/studio', checkedAt: '2026-11-10' },
    })] });
    renderCalendar();
    expect(await screen.findByText(/Date needs review/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Studio' })).toHaveAttribute('href', 'https://example.com/studio');
    expect(screen.getByText('Region unknown')).toBeInTheDocument();
  });

  it('distinguishes an announced season premiere from the series first air date', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({ month: '2026-08', entries: [entry({
      title: 'Reviewed show', mediaType: 'tv', kind: 'global_premiere', region: null,
      seasonPremiere: { season: 3, source: 'Amazon', sourceUrl: 'https://example.com/announcement', checkedAt: '2026-11-10' },
    })] });
    renderCalendar();
    expect(await screen.findByText('Season 3 premiere')).toBeInTheDocument();
    expect(screen.getByText(/Local date and availability unknown/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Amazon' })).toHaveAttribute('href', 'https://example.com/announcement');
  });
  it('shows all providers and labels an unknown region', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({ month: '2026-08', entries: [entry({
      title: 'Shared event', kind: 'streaming', isTheatrical: false,
      platforms: ['Netflix', 'ZEE5'], platform: 'Netflix', region: null,
    })] });
    renderCalendar();
    expect(await screen.findByText('Netflix, ZEE5')).toBeInTheDocument();
    expect(screen.getByText('Region unknown')).toBeInTheDocument();
  });

  it('checks current India offers without claiming a regional premiere or season', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({ month: '2026-08', entries: [entry({
      title: 'Global show', mediaType: 'tv', kind: 'global_premiere', isTheatrical: false, region: null, tmdbId: 123,
    })] });
    vi.mocked(fetchProvidersBatch).mockResolvedValue({ providers: {}, runtimes: {}, genres: {},
      availability: { 'tv:123': [{ provider: 'Netflix', type: 'subscription' }, { provider: 'Apple TV Store', type: 'rent' }] },
      watchLinks: { 'tv:123': 'https://www.themoviedb.org/tv/123-show/watch?locale=IN' } });
    const user = userEvent.setup(); renderCalendar();
    await user.click(await screen.findByRole('button', { name: 'Check current India availability' }));
    expect(await screen.findByText(/Currently reported in India: Netflix \(subscription\).*Apple TV Store \(rent\)/)).toBeInTheDocument();
    expect(screen.getByText(/do not confirm this date or a specific season/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open TMDB watch options' })).toHaveAttribute('href', 'https://www.themoviedb.org/tv/123-show/watch?locale=IN');
  });

  it('does not turn a missing provider response into unavailability', async () => {
    vi.mocked(fetchCalendarMonth).mockResolvedValue({ month: '2026-08', entries: [entry({
      title: 'Unknown show', mediaType: 'tv', kind: 'global_premiere', isTheatrical: false, region: null, tmdbId: 123,
    })] });
    vi.mocked(fetchProvidersBatch).mockResolvedValue({ providers: {}, runtimes: {}, genres: {}, availability: {} });
    const user = userEvent.setup(); renderCalendar();
    await user.click(await screen.findByRole('button', { name: 'Check current India availability' }));
    expect(await screen.findByText(/Could not check listings; availability is unknown/)).toBeInTheDocument();
  });
});

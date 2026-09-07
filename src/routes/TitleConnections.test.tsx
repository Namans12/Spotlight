import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TitleConnections from './TitleConnections';
import type { RelatedTitle, TitleRelations } from '@/lib/relations';

vi.mock('@/lib/tmdbDetail', () => ({ fetchTitleDetail: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/seasons', () => ({ fetchSeasons: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/relations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/relations')>('@/lib/relations');
  return {
    ...actual,
    fetchRelations: vi.fn().mockResolvedValue({
      origin: null,
      mustWatch: { before: [], after: [] },
      canWatch: [],
      depth: 1,
      hasMore: false,
    }),
    suppressRelation: vi.fn(),
  };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));

import { fetchRelations } from '@/lib/relations';
import { fetchSeasons } from '@/lib/seasons';

function related(overrides: Partial<RelatedTitle>): RelatedTitle {
  return {
    tmdbId: 1,
    mediaType: 'movie',
    title: 'Some Film',
    posterUrl: null,
    releaseDate: '2020-01-01',
    reason: null,
    source: 'seed',
    hop: 1,
    ...overrides,
  };
}

function titleRelations(overrides: Partial<TitleRelations>): TitleRelations {
  return {
    origin: null,
    mustWatch: { before: [], after: [] },
    canWatch: [],
    depth: 1,
    hasMore: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(fetchRelations).mockReset();
  vi.mocked(fetchRelations).mockResolvedValue(titleRelations({}));
});

/** Stands in for TitleDetail: real enough to prove the bug, without pulling
 * in that whole page's dependency graph. Its back button is the same
 * `navigate(-1)` pattern TitleDetail.tsx actually uses — what matters for
 * this regression is only that it's a genuine history pop, same as here. */
function TitleDetailStub() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div>
      <p>Title Detail Stub</p>
      <button onClick={() => (location.key === 'default' ? navigate('/') : navigate(-1))}>
        Stub back
      </button>
    </div>
  );
}

function renderApp(connectionsPath = '/title/movie/1/connections') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/before', '/title/movie/1', connectionsPath]} initialIndex={2}>
        <Routes>
          <Route path="/before" element={<p>Before Page</p>} />
          <Route path="/title/:type/:id" element={<TitleDetailStub />} />
          <Route path="/title/:type/:id/connections" element={<TitleConnections />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TitleConnections back navigation', () => {
  it('going back from Connections, then back again, reaches the page before it — not a loop back to Connections', async () => {
    // Reproduces the exact loop reported live: Search -> a title -> its Watch
    // order -> back (lands on the title, as expected) -> back again used to
    // land right back on Watch order instead of continuing further back,
    // because the old back link pushed a new history entry onto the title
    // page rather than popping to the one already there.
    const user = userEvent.setup();
    renderApp();

    // Queried by text and its nearest clickable ancestor, not by role — the
    // whole point of this test is to survive a swap between a <button> and
    // an <a>, since that swap (Link vs a real history pop) is the bug.
    const back = (await screen.findByText('Back')).closest('a, button');
    await user.click(back!);
    expect(await screen.findByText('Title Detail Stub')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /stub back/i }));
    expect(await screen.findByText('Before Page')).toBeInTheDocument();
  });
});

describe('Must Watch and Can Watch merged into one timeline', () => {
  it('slots a can-watch title into the chain by release date, not in a separate section', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(titleRelations({
      origin: { title: 'Endgame-like Film', posterUrl: null, releaseDate: '2019-04-24' },
      mustWatch: {
        before: [related({ tmdbId: 2, title: 'Setup Film', releaseDate: '2018-01-01' })],
        after: [],
      },
      canWatch: [
        related({
          tmdbId: 3,
          mediaType: 'tv',
          title: 'Bridging Show',
          releaseDate: '2021-01-15',
          reason: 'Explains what the survivors do in the gap between these two films.',
        }),
      ],
    }));
    renderApp();

    // Chronological order — the can-watch title (2021) sits AFTER the current
    // title (2019) in one continuous list, not off in its own section.
    const titles = (await screen.findAllByRole('heading', { level: 3 })).map((h) => h.textContent);
    expect(titles).toEqual(['Setup Film', 'Endgame-like Film', 'Bridging Show']);
    expect(screen.getByText(/explains what the survivors do/i)).toBeInTheDocument();
    // No leftover standalone "Can Watch" section heading from the old layout.
    expect(screen.queryByRole('heading', { name: /^can watch$/i })).not.toBeInTheDocument();
  });

  it('marks the can-watch node distinctly (dashed) and leaves must-watch nodes solid', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(titleRelations({
      origin: { title: 'Current Film', posterUrl: null, releaseDate: '2020-06-01' },
      mustWatch: { before: [related({ tmdbId: 2, title: 'Required Prequel', releaseDate: '2019-01-01' })], after: [] },
      canWatch: [related({ tmdbId: 3, title: 'Optional Extra', releaseDate: '2020-01-01', reason: 'A specific callback.' })],
    }));
    const { container } = renderApp();

    await screen.findByText('Optional Extra');
    const nodeCircles = container.querySelectorAll('.rounded-full.border.text-\\[11px\\]');
    const dashedCount = [...nodeCircles].filter((el) => el.className.includes('border-dashed')).length;
    // Exactly the one can-watch node is dashed; the required prequel and the
    // current title's own nodes stay solid.
    expect(dashedCount).toBe(1);
    expect(screen.getByText(/can watch/i)).toBeInTheDocument();
  });

  it('keeps "Part X of Y" counting only the required chain, not can-watch extras', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(titleRelations({
      origin: { title: 'Current Film', posterUrl: null, releaseDate: '2020-06-01' },
      mustWatch: { before: [related({ tmdbId: 2, title: 'Required Prequel', releaseDate: '2019-01-01' })], after: [] },
      canWatch: [
        related({ tmdbId: 3, title: 'Optional A', releaseDate: '2020-01-01', reason: 'x' }),
        related({ tmdbId: 4, title: 'Optional B', releaseDate: '2020-03-01', reason: 'y' }),
      ],
    }));
    renderApp();

    // Two required entries (Required Prequel + Current Film) — the two
    // can-watch extras must not inflate this count to 4.
    expect(await screen.findByText('Part 2 of 2')).toBeInTheDocument();
  });
});

describe('release order vs story order', () => {
  // Star Wars is the canonical divergence: The Phantom Menace released 16
  // years after Return of the Jedi but comes first in the story. Ids are real
  // so they resolve against the curated order in data/collection-shapes.json.
  const STAR_WARS_CHAIN = titleRelations({
    origin: { title: 'Return of the Jedi', posterUrl: null, releaseDate: '1983-05-25' },
    mustWatch: {
      before: [
        related({ tmdbId: 11, title: 'Star Wars', releaseDate: '1977-05-25' }),
        related({ tmdbId: 1891, title: 'The Empire Strikes Back', releaseDate: '1980-05-20' }),
      ],
      after: [],
    },
    canWatch: [
      related({
        tmdbId: 1893,
        title: 'The Phantom Menace',
        releaseDate: '1999-05-19',
        reason: 'Same series — not required to follow this one.',
      }),
    ],
  });

  /** Rendered top-to-bottom order of the timeline, by node heading — the same
   *  query the merged-timeline tests above use. */
  async function renderedOrder(): Promise<string[]> {
    return (await screen.findAllByRole('heading', { level: 3 })).map((h) => h.textContent ?? '');
  }

  it('offers the toggle only when a curated story order would change something', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(STAR_WARS_CHAIN);
    renderApp();
    expect(await screen.findByRole('tab', { name: /story order/i })).toBeInTheDocument();
  });

  it('hides the toggle for a franchise told in release order', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(titleRelations({
      origin: { title: 'John Wick: Chapter 2', posterUrl: null, releaseDate: '2017-02-08' },
      mustWatch: {
        before: [related({ tmdbId: 245891, title: 'John Wick', releaseDate: '2014-10-16' })],
        after: [],
      },
    }));
    renderApp();
    expect(await screen.findByText(/Part 2 of 2/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /story order/i })).not.toBeInTheDocument();
  });

  it('reorders the timeline when story order is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchRelations).mockResolvedValue(STAR_WARS_CHAIN);
    renderApp();

    await screen.findByRole('tab', { name: /story order/i });
    // Released 1999, so it lands last chronologically.
    expect(await renderedOrder()).toEqual([
      'Star Wars',
      'The Empire Strikes Back',
      'Return of the Jedi',
      'The Phantom Menace',
    ]);

    await user.click(screen.getByRole('tab', { name: /story order/i }));
    // Episode I opens the story, so it moves to the front.
    expect(await renderedOrder()).toEqual([
      'The Phantom Menace',
      'Star Wars',
      'The Empire Strikes Back',
      'Return of the Jedi',
    ]);
  });

  it('reads the initial order off the URL so the view is shareable', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(STAR_WARS_CHAIN);
    renderApp('/title/movie/1/connections?order=story');
    await screen.findByRole('tab', { name: /story order/i });
    expect(screen.getByRole('tab', { name: /story order/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('counts "Part N of M" off the rendered order, not the raw before/after split', async () => {
    // Under story order the current title's position changes, and the label
    // has to follow the timeline rather than contradict it.
    const user = userEvent.setup();
    vi.mocked(fetchRelations).mockResolvedValue(titleRelations({
      origin: { title: 'Return of the Jedi', posterUrl: null, releaseDate: '1983-05-25' },
      mustWatch: {
        before: [
          related({ tmdbId: 11, title: 'Star Wars', releaseDate: '1977-05-25' }),
          related({ tmdbId: 1891, title: 'The Empire Strikes Back', releaseDate: '1980-05-20' }),
          related({ tmdbId: 1893, title: 'The Phantom Menace', releaseDate: '1999-05-19' }),
        ],
        after: [],
      },
    }));
    renderApp();

    // Release order: ANH, ESB, ROTJ(current), TPM -> the current title is 3rd.
    expect(await screen.findByText(/Part 3 of 4/)).toBeInTheDocument();

    // Story order: TPM, ANH, ESB, ROTJ(current) -> it becomes 4th.
    await user.click(screen.getByRole('tab', { name: /story order/i }));
    expect(await screen.findByText(/Part 4 of 4/)).toBeInTheDocument();
  });
});

describe('a title with no chain', () => {
  it('says a film stands on its own', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(titleRelations({}));
    renderApp();
    expect(await screen.findByText(/it stands on its own/i)).toBeInTheDocument();
  });

  // TMDB has no collection concept for TV, so a show outside the curated seed
  // has no cross-series data at all. Claiming it "stands on its own" states as
  // fact something that was never checked — the same class of error as
  // reporting an outage as an answer.
  it('does not claim a show stands alone when nothing was ever checked', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(titleRelations({}));
    vi.mocked(fetchSeasons).mockResolvedValue(null);
    renderApp('/title/tv/1/connections');

    expect(await screen.findByText(/no connections recorded for this series/i)).toBeInTheDocument();
    expect(screen.queryByText(/stands on its own/i)).not.toBeInTheDocument();
  });

  it('gives a multi-season show the watch order it actually has', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(titleRelations({}));
    vi.mocked(fetchSeasons).mockResolvedValue({
      tmdbId: 1,
      mediaType: 'tv',
      numberOfSeasons: 8,
      fetchedAt: new Date().toISOString(),
      stale: false,
    });
    renderApp('/title/tv/1/connections');

    expect(await screen.findByText(/start at Season 1 and watch all 8 seasons in order/i)).toBeInTheDocument();
  });
});

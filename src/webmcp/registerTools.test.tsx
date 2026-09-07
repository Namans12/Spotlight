import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { WatchlistItemDTO, WatchlistStateDTO } from '../../shared/types/watchlist';

// The WebMCP tools had no coverage, and they are the part of this app an agent
// drives unattended — a wrong answer there is acted on rather than read. These
// tests register the real tools against a fake document.modelContext and call
// them exactly the way Chrome's implementation does.

vi.mock('@/lib/tmdb', () => ({ searchMovies: vi.fn() }));
vi.mock('@/lib/relations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/relations')>('@/lib/relations');
  return { ...actual, fetchRelations: vi.fn(), suppressRelation: vi.fn() };
});
vi.mock('@/lib/tmdbDetail', () => ({
  fetchTitleDetail: vi.fn(),
  titleDetailToMovie: vi.fn(),
}));
vi.mock('@/lib/watchlistApi', () => ({
  fetchWatchlistState: vi.fn(),
  addWatchlistItem: vi.fn(),
  moveWatchlistItem: vi.fn(),
  reorderBucket: vi.fn(),
}));
vi.mock('./demoGuest', () => ({ DEMO_GUEST_ENABLED: true }));

import { searchMovies } from '@/lib/tmdb';
import { fetchRelations } from '@/lib/relations';
import { fetchTitleDetail } from '@/lib/tmdbDetail';
import * as watchlistApi from '@/lib/watchlistApi';
import { registerSpotlightTools } from './registerTools';

interface FakeTool {
  name: string;
  execute: (input: Record<string, unknown>) => Promise<{ structuredContent?: unknown }>;
}

/** Minimal stand-in for document.modelContext. */
function installModelContext(): { tools: Map<string, FakeTool> } {
  const tools = new Map<string, FakeTool>();
  (document as unknown as { modelContext: unknown }).modelContext = {
    registerTool: (tool: FakeTool, opts?: { signal?: AbortSignal }) => {
      tools.set(tool.name, tool);
      opts?.signal?.addEventListener('abort', () => tools.delete(tool.name));
      return Promise.resolve();
    },
    getTools: () => Promise.resolve([...tools.values()]),
  };
  return { tools };
}

async function call(tools: Map<string, FakeTool>, name: string, input: Record<string, unknown> = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`tool "${name}" is not registered`);
  return (await tool.execute(input)).structuredContent as Record<string, unknown> & {
    [key: string]: never | unknown;
  };
}

function movie(id: number, title: string, releaseDate: string) {
  return {
    id,
    title,
    posterPath: null,
    backdropPath: null,
    overview: `About ${title}`,
    releaseDate,
    mediaType: 'movie' as const,
    voteAverage: 7,
    originalLanguage: 'en',
  };
}

function related(tmdbId: number, title: string, releaseDate: string) {
  return {
    tmdbId,
    mediaType: 'movie' as const,
    title,
    posterUrl: null,
    releaseDate,
    reason: null,
    source: 'tmdb' as const,
    hop: 1,
  };
}

let nextDbId = 1;
function item(tmdbId: number, title: string): WatchlistItemDTO {
  return {
    dbId: nextDbId++,
    tmdbId,
    mediaType: 'movie',
    title,
    posterPath: null,
    backdropPath: null,
    overview: '',
    releaseDate: '2020-01-01',
    voteAverage: 0,
    originalLanguage: 'en',
    bucket: 'watchlist',
    listId: null,
    addedAt: 0,
  } as unknown as WatchlistItemDTO;
}

function state(overrides: Partial<WatchlistStateDTO> = {}): WatchlistStateDTO {
  return {
    watchlist: [],
    watched: [],
    watchLater: [],
    customLists: [],
    customListItems: {},
    ...overrides,
  } as WatchlistStateDTO;
}

let queryClient: QueryClient;
let tools: Map<string, FakeTool>;
let controller: AbortController;

beforeEach(async () => {
  nextDbId = 1;
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['auth', 'session'], { authenticated: true });
  ({ tools } = installModelContext());
  controller = new AbortController();

  vi.mocked(watchlistApi.fetchWatchlistState).mockResolvedValue(state());
  vi.mocked(watchlistApi.addWatchlistItem).mockResolvedValue(undefined as never);
  vi.mocked(watchlistApi.reorderBucket).mockResolvedValue(undefined as never);
  vi.mocked(watchlistApi.moveWatchlistItem).mockResolvedValue(undefined as never);
  vi.mocked(fetchTitleDetail).mockRejectedValue(new Error('no detail in tests'));

  await registerSpotlightTools(queryClient, controller.signal);
});

afterEach(() => {
  controller.abort();
  delete (document as unknown as { modelContext?: unknown }).modelContext;
});

describe('plan_watch_order', () => {
  const JOHN_WICK = movie(245891, 'John Wick', '2014-10-16');

  function johnWickChain() {
    vi.mocked(searchMovies).mockResolvedValue([JOHN_WICK]);
    vi.mocked(fetchRelations).mockResolvedValue({
      origin: null,
      mustWatch: {
        before: [],
        after: [
          related(324552, 'John Wick: Chapter 2', '2017-02-08'),
          related(458156, 'John Wick: Chapter 3', '2019-05-15'),
          related(603692, 'John Wick: Chapter 4', '2023-03-21'),
        ],
      },
      canWatch: [],
      depth: 12,
      hasMore: false,
    });
  }

  it('adds the whole chain in order when the list is empty', async () => {
    johnWickChain();
    const result = await call(tools, 'plan_watch_order', { title: 'John Wick' });

    expect(result.ok).toBe(true);
    expect(result.added).toEqual([
      'John Wick',
      'John Wick: Chapter 2',
      'John Wick: Chapter 3',
      'John Wick: Chapter 4',
    ]);
    expect(vi.mocked(watchlistApi.addWatchlistItem).mock.calls.map((c) => c[0].tmdbId)).toEqual([
      245891, 324552, 458156, 603692,
    ]);
  });

  // The regression this test exists for. Adds take MAX(sort_order)+1, so with
  // Chapter 4 already saved the raw result is 4, 1, 2, 3 while the tool
  // reports "in watch order".
  it('puts the chain in real watch order when part of it is already on the list', async () => {
    johnWickChain();
    const chapter4 = item(603692, 'John Wick: Chapter 4');
    const unrelated = item(999, 'Some Other Film');

    vi.mocked(watchlistApi.fetchWatchlistState)
      // Read before adding: Chapter 4 and an unrelated title are already saved.
      .mockResolvedValueOnce(state({ watchlist: [chapter4, unrelated] }))
      // Read after adding, in the order the server would return them.
      .mockResolvedValueOnce(
        state({
          watchlist: [
            chapter4,
            unrelated,
            item(245891, 'John Wick'),
            item(324552, 'John Wick: Chapter 2'),
            item(458156, 'John Wick: Chapter 3'),
          ],
        }),
      );

    const result = await call(tools, 'plan_watch_order', { title: 'John Wick' });

    expect(result.alreadyOnList).toEqual(['John Wick: Chapter 4']);
    expect(result.message).toContain('in watch order');

    // The reorder is what makes the claim true.
    expect(watchlistApi.reorderBucket).toHaveBeenCalledTimes(1);
    const [bucket, listId, orderedIds] = vi.mocked(watchlistApi.reorderBucket).mock.calls[0];
    expect(bucket).toBe('watchlist');
    expect(listId).toBeNull();

    const byId = new Map(
      [chapter4, unrelated, item(0, '')].concat([]).map((i) => [i.dbId, i.title] as const),
    );
    // Resolve the submitted order back to titles via the post-add state.
    const after = await vi.mocked(watchlistApi.fetchWatchlistState).mock.results[1].value;
    for (const i of after.watchlist) byId.set(i.dbId, i.title);

    expect((orderedIds as number[]).map((id) => byId.get(id))).toEqual([
      'John Wick',
      'John Wick: Chapter 2',
      'John Wick: Chapter 3',
      'John Wick: Chapter 4',
      'Some Other Film',
    ]);
  });

  it('skips titles already watched instead of re-adding them', async () => {
    johnWickChain();
    vi.mocked(watchlistApi.fetchWatchlistState).mockResolvedValue(
      state({ watched: [item(245891, 'John Wick')] }),
    );

    const result = await call(tools, 'plan_watch_order', { title: 'John Wick' });
    expect(result.alreadyWatched).toEqual(['John Wick']);
    expect(result.added).not.toContain('John Wick');
  });

  it('does not reorder when it added nothing', async () => {
    johnWickChain();
    vi.mocked(watchlistApi.fetchWatchlistState).mockResolvedValue(
      state({
        watched: [
          item(245891, 'John Wick'),
          item(324552, 'John Wick: Chapter 2'),
          item(458156, 'John Wick: Chapter 3'),
          item(603692, 'John Wick: Chapter 4'),
        ],
      }),
    );

    const result = await call(tools, 'plan_watch_order', { title: 'John Wick' });
    expect(result.added).toEqual([]);
    expect(watchlistApi.reorderBucket).not.toHaveBeenCalled();
  });

  it('reports a truncated chain rather than presenting it as complete', async () => {
    vi.mocked(searchMovies).mockResolvedValue([JOHN_WICK]);
    vi.mocked(fetchRelations).mockResolvedValue({
      origin: null,
      mustWatch: { before: [], after: [related(324552, 'John Wick: Chapter 2', '2017-02-08')] },
      canWatch: [],
      depth: 12,
      hasMore: true,
    });

    const result = await call(tools, 'plan_watch_order', { title: 'John Wick' });
    expect(result.chainComplete).toBe(false);
    expect(result.message).toMatch(/longer than this/i);
  });

  it('still reports success when the cosmetic reorder fails', async () => {
    johnWickChain();
    vi.mocked(watchlistApi.reorderBucket).mockRejectedValue(new Error('network'));
    const result = await call(tools, 'plan_watch_order', { title: 'John Wick' });
    expect(result.ok).toBe(true);
    expect(result.added).toHaveLength(4);
  });
});

describe('mark_watched title matching', () => {
  beforeEach(() => {
    // The tool only registers once the list has something in it.
    queryClient.setQueryData(['watchlist'], {
      watchlist: [{}],
      watched: [],
      watchLater: [],
      customLists: [],
      customListItems: {},
    });
  });

  it('prefers an exact title over a longer one containing it', async () => {
    const dune = item(438631, 'Dune');
    const partTwo = item(693134, 'Dune: Part Two');
    // Part Two first, so a plain `includes` would pick the wrong film.
    vi.mocked(watchlistApi.fetchWatchlistState).mockResolvedValue(
      state({ watchlist: [partTwo, dune] }),
    );

    const result = await call(tools, 'mark_watched', { title: 'Dune' });
    expect(result.ok).toBe(true);
    expect(result.markedWatched).toBe('Dune');
    expect(watchlistApi.moveWatchlistItem).toHaveBeenCalledWith(dune.dbId, 'watched');
  });

  it('refuses to guess between genuine ties', async () => {
    vi.mocked(watchlistApi.fetchWatchlistState).mockResolvedValue(
      state({ watchlist: [item(1, 'Halloween Kills'), item(2, 'Halloween Ends')] }),
    );

    const result = await call(tools, 'mark_watched', { title: 'Halloween' });
    expect(result.ok).toBe(false);
    expect(result.candidates).toEqual(['Halloween Kills', 'Halloween Ends']);
    expect(watchlistApi.moveWatchlistItem).not.toHaveBeenCalled();
  });

  it('reports a miss rather than marking something arbitrary', async () => {
    vi.mocked(watchlistApi.fetchWatchlistState).mockResolvedValue(
      state({ watchlist: [item(1, 'Arrival')] }),
    );
    const result = await call(tools, 'mark_watched', { title: 'Nope' });
    expect(result.ok).toBe(false);
    expect(watchlistApi.moveWatchlistItem).not.toHaveBeenCalled();
  });
});

describe('argument validation', () => {
  it('rejects a non-string title as a readable tool result, not a rejection', async () => {
    const result = await call(tools, 'search_titles', { query: { nested: 'object' } });
    // Without this, String(x) sends "[object Object]" to TMDB and the agent
    // gets a confident, wrong answer back.
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/"query" must be a non-empty string/);
    expect(searchMovies).not.toHaveBeenCalled();
  });

  it('rejects an empty title', async () => {
    const result = await call(tools, 'search_titles', { query: '   ' });
    expect(result.ok).toBe(false);
    expect(searchMovies).not.toHaveBeenCalled();
  });
});

describe('dynamic tool registration', () => {
  it('does not offer mark_watched against an empty list', () => {
    expect(tools.has('mark_watched')).toBe(false);
    expect(tools.has('reorder_watchlist')).toBe(false);
  });

  it('offers mark_watched at one item and reorder_watchlist at two', async () => {
    queryClient.setQueryData(['watchlist'], {
      watchlist: [{}],
      watched: [],
      watchLater: [],
      customLists: [],
      customListItems: {},
    });
    expect(tools.has('mark_watched')).toBe(true);
    expect(tools.has('reorder_watchlist')).toBe(false);

    queryClient.setQueryData(['watchlist'], {
      watchlist: [{}, {}],
      watched: [],
      watchLater: [],
      customLists: [],
      customListItems: {},
    });
    expect(tools.has('reorder_watchlist')).toBe(true);
  });
});

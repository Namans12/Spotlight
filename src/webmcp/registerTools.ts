import type { QueryClient } from '@tanstack/react-query';
import type { Movie } from '@/types/movie';
import type { AddWatchlistItemBody, Bucket, WatchlistItemDTO } from '../../shared/types/watchlist';
import type { WatchlistState } from '@/types/movie';
import { searchMovies } from '@/lib/tmdb';
import { fetchDigest, fetchCalendarMonth } from '@/lib/api';
import { fetchTitleDetail, titleDetailToMovie } from '@/lib/tmdbDetail';
import { fetchRelations, suppressRelation, relatedToMovie, MAX_DEPTH } from '@/lib/relations';
import * as watchlistApi from '@/lib/watchlistApi';
import { DEMO_GUEST_ENABLED } from './demoGuest';

// Every tool here wraps the exact same client-side functions the human UI
// calls (src/lib/watchlistApi.ts, src/lib/relations.ts, src/lib/api.ts) —
// there is no separate "agent" code path, so an agent action and a click
// produce identical results and the on-screen list updates live either way.
//
// Mutating tools call ensureAuthenticated() first rather than failing with
// "please log in": on the demo deployment a judge or an agent opening this
// app cold should be able to just ask for something and have it work, not
// hit a login wall first. See lib/usersDb.ts upsertGuestUser for the shared
// demo account this signs into, and src/webmcp/demoGuest.ts for why it is
// gated off everywhere else — where these tools report "sign in with Google
// first" instead, in words the agent can relay.

const WATCHLIST_KEY = ['watchlist'];
const AUTH_KEY = ['auth', 'session'];

interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

async function ensureAuthenticated(queryClient: QueryClient): Promise<void> {
  const session = queryClient.getQueryData<{ authenticated: boolean }>(AUTH_KEY);
  if (session?.authenticated) return;

  // On a deployment without the shared demo account (DEMO_GUEST unset — see
  // lib/usersDb.ts guestSessionsEnabled), there is no session to start
  // silently, and the agent needs to be told that in words it can relay to
  // the user rather than being handed an opaque failure.
  if (!DEMO_GUEST_ENABLED) {
    throw new Error('Sign in with Google first - this action writes to your own private list.');
  }

  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guest: true }),
  });
  if (!res.ok) throw new Error('Could not start a session for this action.');
  const data: { user: SessionUser } = await res.json();
  queryClient.setQueryData(AUTH_KEY, { authenticated: true, user: data.user });
}

function invalidateWatchlist(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY });
}

async function resolveTitle(query: string, mediaTypeHint?: 'movie' | 'tv'): Promise<Movie | null> {
  const results = await searchMovies(query);
  if (results.length === 0) return null;
  if (mediaTypeHint) {
    const match = results.find((r) => r.mediaType === mediaTypeHint);
    if (match) return match;
  }
  return results[0];
}

function movieToBody(movie: Movie, bucket: Bucket, listId?: number): AddWatchlistItemBody {
  return {
    tmdbId: movie.id,
    mediaType: movie.mediaType,
    title: movie.title,
    posterPath: movie.posterPath,
    backdropPath: movie.backdropPath ?? null,
    overview: movie.overview,
    releaseDate: movie.releaseDate,
    voteAverage: movie.voteAverage,
    originalLanguage: movie.originalLanguage,
    bucket,
    listId,
  };
}

/** Matches a user-supplied title against saved items, strongest match first.
 *
 * A bare `includes` (what this used to be) resolves "Dune" to whichever of
 * "Dune" and "Dune: Part Two" happens to come first in the list, so
 * `mark_watched('Dune')` could silently mark the sequel. Ranking by exactness
 * makes the common case right, and `ambiguous` lets a caller report the
 * remaining genuine ties instead of guessing.
 */
function matchTitle(
  items: WatchlistItemDTO[],
  title: string,
): { match?: WatchlistItemDTO; ambiguous: WatchlistItemDTO[] } {
  const needle = title.trim().toLowerCase();
  if (!needle) return { ambiguous: [] };

  const exact = items.filter((i) => i.title.toLowerCase() === needle);
  if (exact.length > 0) return { match: exact[0], ambiguous: exact.length > 1 ? exact : [] };

  const prefix = items.filter((i) => i.title.toLowerCase().startsWith(needle));
  if (prefix.length === 1) return { match: prefix[0], ambiguous: [] };
  if (prefix.length > 1) return { match: prefix[0], ambiguous: prefix };

  const substring = items.filter((i) => i.title.toLowerCase().includes(needle));
  if (substring.length === 1) return { match: substring[0], ambiguous: [] };
  if (substring.length > 1) return { match: substring[0], ambiguous: substring };

  return { ambiguous: [] };
}

function titleKey(m: { mediaType: string; tmdbId?: number; id?: number }): string {
  return `${m.mediaType}:${m.tmdbId ?? m.id}`;
}

/** Fills in the fields a relation edge doesn't carry.
 *
 * `relatedToMovie` can only recover what the edge denormalises — title,
 * poster, release date — so overview, rating and language come back empty and
 * a chain added by an agent renders visibly poorer than the same title added
 * by a click. One detail call per title fixes that; they run in parallel, and
 * any that fails keeps the edge's own values rather than failing the plan,
 * since a missing overview is not worth losing the add over.
 */
async function enrichChain(chain: Movie[]): Promise<Movie[]> {
  return Promise.all(
    chain.map(async (m) => {
      if (m.overview) return m; // the origin title came from search, already complete
      try {
        return { ...m, ...titleDetailToMovie(await fetchTitleDetail(m.mediaType, m.id)) };
      } catch {
        return m;
      }
    }),
  );
}

/** Reads a required string argument, or throws a message the agent can act on.
 *
 * `String(x)` is not a substitute: handed an object it produces
 * "[object Object]", which then reaches TMDB as a search query and comes back
 * with a confident, wrong result rather than an error. Tool arguments come
 * from a model, so malformed input is a normal event, not an exceptional one.
 */
function requireString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new Error(`"${field}" must be a non-empty string.`);
}

/** One-line human-readable summary for a tool result's `content` part. Tools
 * that already explain themselves carry a `message`; the rest get a compact
 * JSON rendering, which is still far more useful to an agent than nothing. */
function summarize(result: unknown): string {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.message === 'string') return r.message;
  }
  return JSON.stringify(result);
}

/** Wraps a tool's plain-object return in the spec's `content` shape (see
 * `summarize`) and registers it, logging rather than throwing on failure —
 * one registration failing (e.g. a duplicate name) shouldn't take the rest
 * down. Shared by the static tool set and the dynamic ones in
 * registerDynamicTools, so both go through one code path. */
function registerWrapped(
  modelContext: ModelContext,
  tool: ModelContextTool,
  opts: { signal?: AbortSignal },
): Promise<void> {
  const inner = tool.execute;
  const wrapped: ModelContextTool = {
    ...tool,
    execute: async (input, options) => {
      let result: unknown;
      try {
        result = await inner(input, options);
      } catch (err) {
        // An agent handed a rejected promise sees a transport-level failure
        // and usually gives up or retries the same bad call. A structured
        // `{ ok: false, message }` is something it can read and correct —
        // which matters most for the two failures that actually happen here:
        // malformed arguments (see requireString) and "sign in first" on a
        // deployment without the demo account.
        result = { ok: false, message: err instanceof Error ? err.message : 'That action failed.' };
      }
      return {
        content: [{ type: 'text', text: summarize(result) }],
        structuredContent: result,
      };
    },
  };
  return modelContext.registerTool(wrapped, opts).catch((err) => {
    console.error(`[webmcp] failed to register tool "${tool.name}"`, err);
  });
}

/** Registers every Spotlight WebMCP tool. No-ops quietly in a browser that
 * doesn't implement document.modelContext yet (i.e. almost all of them
 * today) — the site works exactly as before there. */
export async function registerSpotlightTools(queryClient: QueryClient, signal: AbortSignal): Promise<void> {
  const modelContext = typeof document !== 'undefined' ? document.modelContext : undefined;
  if (!modelContext?.registerTool) return;

  const opts = { signal };
  const register = (tool: ModelContextTool) => registerWrapped(modelContext, tool, opts);

  await Promise.all([
    register({
      name: 'search_titles',
      description:
        "Search Spotlight's movie/TV catalog by name. Returns matching titles with their media type, release date, and rating.",
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Title to search for' } },
        required: ['query'],
      },
      async execute({ query }) {
        const results = await searchMovies(requireString(query, 'query'));
        return {
          ok: true,
          results: results.slice(0, 10).map((m) => ({
            title: m.title,
            mediaType: m.mediaType,
            tmdbId: m.id,
            releaseDate: m.releaseDate,
            rating: m.voteAverage,
          })),
        };
      },
    }),

    register({
      name: 'get_release_digest',
      description:
        "Get Spotlight's twice-weekly OTT release digest for India - what's Out Now and Coming Up, split into Hindi OTT, English OTT, and Popular (Other Languages), grouped by streaming platform.",
      inputSchema: {
        type: 'object',
        properties: {
          window: { type: 'string', enum: ['out_now', 'coming_up'], description: 'Defaults to both windows if omitted' },
          section: { type: 'string', enum: ['hindi', 'english', 'popular'], description: 'Defaults to all sections if omitted' },
        },
      },
      async execute({ window, section }) {
        const digest = await fetchDigest();
        const windows = (window ? [window] : ['out_now', 'coming_up']) as Array<'out_now' | 'coming_up'>;
        const sections = (section ? [section] : ['hindi', 'english', 'popular']) as Array<'hindi' | 'english' | 'popular'>;

        const out: Record<string, Record<string, unknown>> = {};
        for (const w of windows) {
          out[w] = {};
          for (const s of sections) {
            out[w][s] = digest[w].sections[s].slice(0, 15).map((item) => ({
              title: item.title,
              mediaType: item.media_type,
              tmdbId: item.tmdb_id,
              releaseDate: item.release_date,
              platforms: item.providers,
              rating: item.rating,
            }));
          }
        }
        return { ok: true, generatedAt: digest.generated_at, region: digest.region, windows: out };
      },
    }),

    register({
      name: 'get_calendar',
      description: 'Get the release calendar entries for a given month.',
      inputSchema: {
        type: 'object',
        properties: { month: { type: 'string', description: 'Month in YYYY-MM format' } },
        required: ['month'],
      },
      async execute({ month }) {
        const data = await fetchCalendarMonth(requireString(month, 'month'));
        return {
          ok: true,
          month: data.month,
          entries: data.entries.map((e) => ({
            title: e.title,
            mediaType: e.mediaType,
            releaseDate: e.releaseDate,
            platform: e.platform,
            kind: e.kind,
          })),
        };
      },
    }),

    register({
      name: 'get_watch_order',
      description:
        "Get a title's watch order: the Must Watch chain of prior/later titles you need to have seen (in order), plus optional Can Watch extras with a reason each is worth seeing. Backed by Spotlight's curated relations data (TMDB collections + Wikidata canonical ordering + curated edges), not a guess.",
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title to look up' },
          mediaType: { type: 'string', enum: ['movie', 'tv'] },
        },
        required: ['title'],
      },
      async execute({ title, mediaType }) {
        const movie = await resolveTitle(requireString(title, 'title'), mediaType as 'movie' | 'tv' | undefined);
        if (!movie) return { ok: false, message: `Couldn't find "${title}" in the catalog.` };

        const relations = await fetchRelations(movie.mediaType, movie.id, MAX_DEPTH);
        const before = relations?.mustWatch.before ?? [];
        const after = relations?.mustWatch.after ?? [];

        if (before.length === 0 && after.length === 0 && (relations?.canWatch.length ?? 0) === 0) {
          return { ok: true, resolvedTitle: movie.title, hasChain: false, message: 'This title stands on its own - nothing else required.' };
        }

        const chain = [
          ...before.map((r) => ({ title: r.title, mediaType: r.mediaType, tmdbId: r.tmdbId, releaseDate: r.releaseDate })),
          { title: movie.title, mediaType: movie.mediaType, tmdbId: movie.id, releaseDate: movie.releaseDate, isTheOneAsked: true },
          ...after.map((r) => ({ title: r.title, mediaType: r.mediaType, tmdbId: r.tmdbId, releaseDate: r.releaseDate })),
        ];

        return {
          ok: true,
          resolvedTitle: movie.title,
          hasChain: before.length > 0 || after.length > 0,
          partOfChain: before.length + after.length > 0 ? `${before.length + 1} of ${before.length + 1 + after.length}` : null,
          // The walk is capped at MAX_DEPTH hops per direction. Without this
          // an agent reads a truncated chain as the whole thing and tells the
          // user they are caught up when they are not.
          chainComplete: relations?.hasMore !== true,
          mustWatchOrder: chain,
          optionalExtras: (relations?.canWatch ?? []).map((r) => ({
            title: r.title,
            mediaType: r.mediaType,
            tmdbId: r.tmdbId,
            reason: r.reason,
          })),
        };
      },
    }),

    register({
      name: 'plan_watch_order',
      description:
        "Build a title's full watch-order chain into the user's watchlist, in the correct order, skipping anything already watched or already on their list. This is the one-shot 'get me caught up on X' action - it reads the real relations graph, cross-references the user's real watch history, and writes the remaining titles to their real watchlist in sequence.",
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Any title in the franchise/series to plan from' },
          mediaType: { type: 'string', enum: ['movie', 'tv'] },
        },
        required: ['title'],
      },
      async execute({ title, mediaType }) {
        await ensureAuthenticated(queryClient);

        const movie = await resolveTitle(requireString(title, 'title'), mediaType as 'movie' | 'tv' | undefined);
        if (!movie) return { ok: false, message: `Couldn't find "${title}" in the catalog.` };

        const relations = await fetchRelations(movie.mediaType, movie.id, MAX_DEPTH);
        const before = relations?.mustWatch.before ?? [];
        const after = relations?.mustWatch.after ?? [];
        const chain: Movie[] = await enrichChain([...before.map(relatedToMovie), movie, ...after.map(relatedToMovie)]);

        if (chain.length === 1) {
          return { ok: true, title: movie.title, added: [], message: 'This title stands on its own - nothing else to plan.' };
        }

        const state = await watchlistApi.fetchWatchlistState();
        const watchedKeys = new Set(state.watched.map(titleKey));
        const onListKeys = new Set([...state.watchlist, ...state.watchLater].map(titleKey));

        const added: string[] = [];
        const alreadyWatched: string[] = [];
        const alreadyOnList: string[] = [];

        // Sequential, not Promise.all: each add must land before the next
        // starts so the server-assigned sort order matches chain order.
        for (const m of chain) {
          const key = titleKey(m);
          if (watchedKeys.has(key)) {
            alreadyWatched.push(m.title);
            continue;
          }
          if (onListKeys.has(key)) {
            alreadyOnList.push(m.title);
            continue;
          }
          await watchlistApi.addWatchlistItem(movieToBody(m, 'watchlist'));
          added.push(m.title);
        }

        // Appending alone does NOT produce watch order once any part of the
        // chain is already on the list. Adds take MAX(sort_order)+1, so
        // planning John Wick with Chapter 4 already saved yields 4, 1, 2, 3 —
        // while the tool claims "in watch order". Restating the whole bucket
        // is the only thing that makes the claim true, so it runs whenever
        // anything was added, not only in the partial case.
        let reordered = false;
        if (added.length > 0) {
          const after = await watchlistApi.fetchWatchlistState();
          const chainPositions = new Map(chain.map((m, i) => [titleKey(m), i]));
          const inChain = after.watchlist.filter((i) => chainPositions.has(titleKey(i)));
          const rest = after.watchlist.filter((i) => !chainPositions.has(titleKey(i)));
          inChain.sort((a, b) => chainPositions.get(titleKey(a))! - chainPositions.get(titleKey(b))!);

          // Chain first, then everything the user already had, each keeping
          // its own relative order. Reordering is cosmetic, so a failure here
          // must not turn a successful set of adds into a reported failure.
          try {
            await watchlistApi.reorderBucket('watchlist', null, [...inChain, ...rest].map((i) => i.dbId));
            reordered = true;
          } catch (err) {
            console.error('[webmcp] plan_watch_order could not reorder the watchlist', err);
          }
        }

        await invalidateWatchlist(queryClient);

        return {
          ok: true,
          title: movie.title,
          added,
          alreadyWatched,
          alreadyOnList,
          // The chain is capped at MAX_DEPTH hops in each direction; say so
          // rather than letting an agent present a truncated plan as complete.
          chainComplete: relations?.hasMore !== true,
          message:
            added.length > 0
              ? `Added ${added.length} title(s) to the watchlist${reordered ? ', in watch order' : ''}.` +
                (relations?.hasMore ? ' The chain is longer than this - some titles were beyond the lookup depth.' : '')
              : 'Nothing new to add - already caught up on this one.',
        };
      },
    }),

    register({
      name: 'add_to_watchlist',
      description: "Add a title to the user's watchlist or watch-later list.",
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          bucket: { type: 'string', enum: ['watchlist', 'watchLater'], description: 'Defaults to watchlist' },
        },
        required: ['title'],
      },
      async execute({ title, bucket }) {
        await ensureAuthenticated(queryClient);
        const movie = await resolveTitle(requireString(title, 'title'));
        if (!movie) return { ok: false, message: `Couldn't find "${title}" in the catalog.` };

        try {
          await watchlistApi.addWatchlistItem(movieToBody(movie, (bucket as Bucket) || 'watchlist'));
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : 'Could not add that title.' };
        }
        await invalidateWatchlist(queryClient);
        return { ok: true, added: movie.title, mediaType: movie.mediaType, tmdbId: movie.id };
      },
    }),

    register({
      name: 'correct_watch_order',
      description:
        "Hide one title from another's watch-order connections when a suggested link is wrong for the user. This only affects their own view; it doesn't delete the edge for anyone else.",
      inputSchema: {
        type: 'object',
        properties: {
          fromTitle: { type: 'string', description: 'The title whose connections page this appears on' },
          toTitle: { type: 'string', description: 'The wrongly-linked title to hide' },
        },
        required: ['fromTitle', 'toTitle'],
      },
      async execute({ fromTitle, toTitle }) {
        await ensureAuthenticated(queryClient);
        const [from, to] = await Promise.all([
          resolveTitle(requireString(fromTitle, 'fromTitle')),
          resolveTitle(requireString(toTitle, 'toTitle')),
        ]);
        if (!from || !to) return { ok: false, message: 'Could not resolve one of those titles.' };

        try {
          await suppressRelation({ mediaType: from.mediaType, tmdbId: from.id }, { mediaType: to.mediaType, tmdbId: to.id });
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : 'Could not hide that connection.' };
        }
        await queryClient.invalidateQueries({ queryKey: ['relations'] });
        return { ok: true, message: `Hidden "${to.title}" from ${from.title}'s connections.` };
      },
    }),
  ]);

  registerDynamicTools(modelContext, queryClient, signal);
}

/** `mark_watched` and `reorder_watchlist` register and unregister themselves
 * as the watchlist actually changes shape — the spec's own explainer
 * describes exactly this pattern (a tool appearing once the user picks a
 * template, in its graphic-design example) via the `toolchange` event, which
 * fires automatically whenever registerTool/AbortController add or remove a
 * tool. There's nothing to act on "mark as watched" against an empty list,
 * and reordering one title is a no-op — so neither tool exists until it
 * would do something, instead of existing everywhere and failing loudly.
 * `getTools()` reflects this live: run it before and after adding a title
 * and the returned array is a different length. */
function registerDynamicTools(modelContext: ModelContext, queryClient: QueryClient, parentSignal: AbortSignal): void {
  // Independent controllers, not one shared one: mark_watched and
  // reorder_watchlist have different eligibility thresholds (>0 items vs.
  // >=2), so a single shared "is anything registered" flag would latch true
  // on whichever tool qualifies first and then ignore the other tool's own
  // eligibility changing — which is exactly the bug a first pass at this had
  // (reorder_watchlist never appeared at 2 items if mark_watched had already
  // registered at 1).
  let markWatchedController: AbortController | null = null;
  let reorderController: AbortController | null = null;

  const markWatchedTool: ModelContextTool = {
    name: 'mark_watched',
    description: "Mark a title already on the user's watchlist or watch-later list as watched.",
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
    async execute({ title }) {
      await ensureAuthenticated(queryClient);
      const state = await watchlistApi.fetchWatchlistState();
      const { match, ambiguous } = matchTitle([...state.watchlist, ...state.watchLater], requireString(title, 'title'));
      if (!match) return { ok: false, message: `Couldn't find "${title}" on the watchlist or watch-later list.` };
      if (ambiguous.length > 1) {
        // Marking the wrong film watched silently removes it from the list,
        // so a tie is reported rather than resolved by list position.
        return {
          ok: false,
          message: `"${title}" matches ${ambiguous.length} titles - say which one.`,
          candidates: ambiguous.map((i) => i.title),
        };
      }

      await watchlistApi.moveWatchlistItem(match.dbId, 'watched');
      await invalidateWatchlist(queryClient);
      return { ok: true, markedWatched: match.title };
    },
  };

  const reorderTool: ModelContextTool = {
    name: 'reorder_watchlist',
    description:
      "Reorder the user's watchlist. Give the titles in the desired order (a prefix is fine - anything not mentioned keeps its relative order after the ones you listed).",
    inputSchema: {
      type: 'object',
      properties: {
        orderedTitles: { type: 'array', items: { type: 'string' }, description: 'Titles in the desired order' },
      },
      required: ['orderedTitles'],
    },
    async execute({ orderedTitles }) {
      await ensureAuthenticated(queryClient);
      const state = await watchlistApi.fetchWatchlistState();
      const remaining = [...state.watchlist];
      const matched: WatchlistItemDTO[] = [];

      if (!Array.isArray(orderedTitles)) {
        return { ok: false, message: '"orderedTitles" must be an array of title strings.' };
      }
      for (const t of orderedTitles) {
        if (typeof t !== 'string' || !t.trim()) continue;
        // Same ranking as mark_watched, so "Dune" can't claim "Dune: Part Two"
        // out from under an explicit later mention of it.
        const { match } = matchTitle(remaining, t);
        if (!match) continue;
        const idx = remaining.indexOf(match);
        if (idx !== -1) matched.push(...remaining.splice(idx, 1));
      }

      const finalOrder = [...matched, ...remaining];
      if (matched.length === 0) return { ok: false, message: 'None of those titles are on the watchlist.' };

      await watchlistApi.reorderBucket('watchlist', null, finalOrder.map((i) => i.dbId));
      await invalidateWatchlist(queryClient);
      return { ok: true, newOrder: finalOrder.map((i) => i.title) };
    },
  };

  function syncOne(eligible: boolean, current: AbortController | null, tool: ModelContextTool): AbortController | null {
    if (eligible && !current) {
      const controller = new AbortController();
      parentSignal.addEventListener('abort', () => controller.abort());
      registerWrapped(modelContext, tool, { signal: controller.signal });
      return controller;
    }
    if (!eligible && current) {
      current.abort();
      return null;
    }
    return current;
  }

  function sync(state: WatchlistState | undefined) {
    const canMarkWatched = (state?.watchlist.length ?? 0) + (state?.watchLater.length ?? 0) > 0;
    const canReorder = (state?.watchlist.length ?? 0) >= 2;
    markWatchedController = syncOne(canMarkWatched, markWatchedController, markWatchedTool);
    reorderController = syncOne(canReorder, reorderController, reorderTool);
  }

  sync(queryClient.getQueryData<WatchlistState>(WATCHLIST_KEY));
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryKey.length === 1 && event.query.queryKey[0] === 'watchlist') {
      sync(event.query.state.data as WatchlistState | undefined);
    }
  });
  parentSignal.addEventListener('abort', unsubscribe);
}

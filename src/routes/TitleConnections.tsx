import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchTitleDetail } from '@/lib/tmdbDetail';
import { fetchSeasons } from '@/lib/seasons';
import { useAuth } from '@/hooks/useAuth';
import { useRelations } from '@/hooks/useRelations';
import { MAX_DEPTH, suppressRelation, type RelatedTitle } from '@/lib/relations';
import { hasStoryOrder, storyRank } from '../../shared/collectionShapes';
import { watchOrderMeta, type ChainEntry } from '../../shared/seo';
import { useDocumentMeta, siteUrl } from '@/hooks/useDocumentMeta';
import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
import { TitleTimeline, type TimelineEntry } from '@/components/release/TitleTimeline';
import { ArrowLeft, Loader2, ListOrdered, Popcorn } from 'lucide-react';

function toEntry(related: RelatedTitle, kind: 'must' | 'can'): TimelineEntry {
  return {
    key: `${related.mediaType}-${related.tmdbId}`,
    title: related.title,
    posterUrl: related.posterUrl,
    releaseDate: related.releaseDate,
    mediaType: related.mediaType,
    href: `/title/${related.mediaType}/${related.tmdbId}`,
    isCurrent: false,
    tmdbId: related.tmdbId,
    kind,
    reason: related.reason,
  };
}

/** Release date ascending, undated entries last — a can-watch edge doesn't
 * carry a before/after direction (see docs/relations-seed-prompt.md), so its
 * spot in the merged line is wherever it falls chronologically, the same as
 * everything else here.
 *
 * The both-undated case has to return 0. Returning 1 (as this once did) makes
 * the comparator inconsistent — cmp(a,b) and cmp(b,a) both positive — and
 * V8's sort is entitled to produce arbitrary order from that once the array
 * is long enough to trigger a merge. Mirrors sortByReleaseDate in
 * lib/relationsDb.ts, which already handled it. */
function byReleaseDate(a: TimelineEntry, b: TimelineEntry): number {
  if (!a.releaseDate && !b.releaseDate) return 0;
  if (!a.releaseDate) return 1;
  if (!b.releaseDate) return -1;
  return a.releaseDate.localeCompare(b.releaseDate);
}

/** Narrative order, for the franchises where it differs from release order —
 * the Star Wars prequels, Tokyo Drift, the Insidious prequels. Titles with no
 * curated rank keep their chronological position relative to each other, so a
 * partially-curated chain degrades to release order rather than scrambling. */
function byStoryOrder(a: TimelineEntry, b: TimelineEntry): number {
  const rankA = storyRank(a.tmdbId);
  const rankB = storyRank(b.tmdbId);
  if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
  if (rankA !== undefined) return -1;
  if (rankB !== undefined) return 1;
  return byReleaseDate(a, b);
}

type OrderMode = 'release' | 'story';

const ORDER_OPTIONS: SegmentedOption<OrderMode>[] = [
  { id: 'release', label: 'Release order' },
  { id: 'story', label: 'Story order' },
];

/** Where the viewed title sits in its chain, in words. */
function standing(beforeCount: number, afterCount: number): string {
  if (beforeCount === 0 && afterCount > 0) return 'This is where the story starts.';
  if (afterCount === 0 && beforeCount > 0) return 'This is the latest chapter - everything else comes first.';
  return 'There is more of the story on both sides of this one.';
}

/**
 * The "connections" view: what this title assumes you've seen, plotted in watch
 * order. Split out of the detail page because a chain deserves room — the
 * timeline is the point of the screen, not a strip at the bottom of one.
 *
 * Always asks for MAX_DEPTH: a timeline that stops one hop in would be lying
 * about where the title sits.
 */
export default function TitleConnections() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(id);

  const detailQuery = useQuery({
    queryKey: ['tmdb', 'detail', mediaType, tmdbId],
    queryFn: () => fetchTitleDetail(mediaType, tmdbId),
    enabled: Number.isFinite(tmdbId),
    staleTime: 60 * 60_000,
  });

  const relationsQuery = useRelations(mediaType, tmdbId, MAX_DEPTH);

  // TV only, and only ever read to phrase the no-chain case (see
  // standaloneCopy). Season counts are cached server-side in title_seasons, so
  // this is a Postgres read for almost every show rather than a TMDB call.
  const seasonsQuery = useQuery({
    queryKey: ['seasons', 'single', tmdbId],
    queryFn: () => fetchSeasons(tmdbId),
    enabled: mediaType === 'tv' && Number.isFinite(tmdbId),
    staleTime: 24 * 60 * 60_000,
  });
  const relations = relationsQuery.data;
  const detail = detailQuery.data;

  // Built before the loading/error guards below, because a hook cannot sit
  // behind an early return. Null until the chain is known, which leaves the
  // prerendered tags in place rather than replacing them with a worse guess.
  const originTitleForMeta = relations?.origin?.title ?? detail?.title ?? null;
  const metaChain: ChainEntry[] | null =
    relations && originTitleForMeta
      ? [
          ...relations.mustWatch.before.map((r) => ({
            title: r.title, releaseDate: r.releaseDate, mediaType: r.mediaType, tmdbId: r.tmdbId,
          })),
          {
            title: originTitleForMeta,
            releaseDate: relations.origin?.releaseDate ?? detail?.releaseDate?.slice(0, 10) ?? null,
            mediaType,
            tmdbId,
          },
          ...relations.mustWatch.after.map((r) => ({
            title: r.title, releaseDate: r.releaseDate, mediaType: r.mediaType, tmdbId: r.tmdbId,
          })),
        ]
      : null;
  useDocumentMeta(
    metaChain && originTitleForMeta
      ? watchOrderMeta(
          {
            title: originTitleForMeta,
            mediaType,
            tmdbId,
            posterUrl: relations?.origin?.posterUrl ?? detail?.posterUrl ?? null,
          },
          metaChain,
          siteUrl(),
        )
      : null,
  );

  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  // Suppression is permanent and there is no un-suppress in v1, so this
  // deliberately refetches rather than optimistically removing the row: the
  // list should only lose an entry once the server confirms it actually did.
  const suppress = useMutation({
    mutationFn: (target: { mediaType: 'movie' | 'tv'; tmdbId: number }) =>
      suppressRelation({ mediaType, tmdbId }, target),
    onSuccess: (_data, target) => {
      queryClient.invalidateQueries({ queryKey: ['relations'] });
      toast.success('Hidden from this title', {
        description: `${target.mediaType === 'tv' ? 'Series' : 'Film'} removed from these connections.`,
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const backTo = `/title/${mediaType}/${tmdbId}`;
  // A real history pop, not a push to backTo — a push here is what caused the
  // back-and-forth loop this used to have: arriving at TitleDetail via this
  // link (a push) left Connections still sitting behind it in history, so
  // TitleDetail's own back button (a real pop) landed back on Connections
  // instead of wherever the user actually came from. `location.key ===
  // 'default'` means this page has no history at all (a fresh load, a deep
  // link, a reload) — the only case with nothing to pop back to.
  const goBack = () => (location.key === 'default' ? navigate(backTo) : navigate(-1));

  // Gated on relations alone, never on TMDB. The chain is this page's whole
  // point and it comes from Postgres; the TMDB detail only decorates the
  // "you're here" node, so a slow or failing TMDB must not hide the timeline.
  if (relationsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

  // Without this branch a failed relations fetch fell through to the empty-state
  // copy below and told the user the title "stands on its own" — presenting an
  // outage as a fact about the film. Say we don't know instead.
  if (relationsQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load the watch order for this title.
        </p>
        <button
          type="button"
          onClick={() => relationsQuery.refetch()}
          disabled={relationsQuery.isFetching}
          className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
        >
          {relationsQuery.isFetching && <Loader2 size={13} className="animate-spin" />}
          Try again
        </button>
      </div>
    );
  }

  const before = relations?.mustWatch.before ?? [];
  const after = relations?.mustWatch.after ?? [];
  const canWatch = relations?.canWatch ?? [];

  // Postgres first, TMDB second. The origin's own fields ride along on the
  // relations response (recovered from the reciprocal edges), so the timeline
  // stays whole even when TMDB is unreachable — which is the entire reason
  // relations are stored denormalised in the first place.
  const originTitle = relations?.origin?.title ?? detail?.title ?? null;
  const originPoster = relations?.origin?.posterUrl ?? detail?.posterUrl ?? null;
  const originDate = relations?.origin?.releaseDate ?? detail?.releaseDate?.slice(0, 10) ?? null;

  // The required chain (before/current/after) and every can-watch title share
  // one chronological line — a can edge has no before/after direction of its
  // own (see toEntry's sort), so its place in the merged line is wherever its
  // release date actually falls, same as everything else. TitleTimeline tells
  // the two kinds apart visually (a dashed rail segment and a muted node for
  // 'can'), rather than this splitting them into separate lists.
  const currentEntry: TimelineEntry = {
    key: `current-${mediaType}-${tmdbId}`,
    title: originTitle ?? 'This title',
    posterUrl: originPoster,
    releaseDate: originDate,
    mediaType,
    isCurrent: true,
    tmdbId,
    kind: 'must',
    reason: null,
  };
  const unsorted: TimelineEntry[] = [
    ...before.map((r) => toEntry(r, 'must')),
    currentEntry,
    ...after.map((r) => toEntry(r, 'must')),
    ...canWatch.map((r) => toEntry(r, 'can')),
  ];

  // The toggle is offered only when it would actually reorder something —
  // most franchises are told in the order they were released, and a control
  // that does nothing is worse than no control.
  const storyOrderAvailable = hasStoryOrder(unsorted.map((e) => e.tmdbId));
  const orderMode: OrderMode = storyOrderAvailable && searchParams.get('order') === 'story' ? 'story' : 'release';
  const entries = [...unsorted].sort(orderMode === 'story' ? byStoryOrder : byReleaseDate);

  const setOrderMode = (mode: OrderMode) => {
    const next = new URLSearchParams(searchParams);
    if (mode === 'release') next.delete('order');
    else next.set('order', mode);
    // Replace, not push: flipping the order is a view preference, not a
    // destination, and stacking it in history would make Back mean "undo the
    // toggle" instead of "leave this page".
    setSearchParams(next, { replace: true });
  };

  const hasMustChain = before.length > 0 || after.length > 0;
  const hasTimeline = hasMustChain || canWatch.length > 0;

  // What to say when there is no chain at all.
  //
  // "It stands on its own" was said for every such title, and for a show it
  // was usually not something we knew. TMDB has no collection concept for TV
  // (see api/relations.ts warmFromCollection), so the only cross-title data
  // for shows is the curated seed — and outside those few dozen entries the
  // honest answer is "we have no connections for this", not a claim about the
  // series. For a multi-season show there is also a real watch order to give,
  // and it is the one people actually want: its own seasons, in order.
  const seasons = seasonsQuery.data?.numberOfSeasons ?? null;
  const standaloneCopy =
    mediaType === 'tv'
      ? seasons && seasons > 1
        ? `No other series is required first - start at Season 1 and watch all ${seasons} seasons in order.`
        : 'No connections recorded for this series. Spotlight only tracks cross-series order for franchises it has curated.'
      : 'Nothing else is required to follow this one - it stands on its own.';

  // Counted off the *rendered* order, not off before.length. Those disagree
  // whenever the list is re-sorted — under Story order a prequel moves ahead
  // of films it released after — and a "Part 2 of 4" label sitting next to a
  // timeline whose highlighted node is third is worse than no label.
  const mustEntries = entries.filter((e) => e.kind === 'must');
  const mustCount = mustEntries.length;
  const currentPosition = mustEntries.findIndex((e) => e.isCurrent) + 1;
  const priorCount = Math.max(0, currentPosition - 1);
  const laterCount = Math.max(0, mustCount - currentPosition);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} className="shrink-0" /> {originTitle ?? 'Back'}
        </button>

        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-accent">{hasMustChain ? <ListOrdered size={16} /> : <Popcorn size={16} />}</span>
            <h1 className="font-display text-xl font-bold leading-none text-foreground sm:text-2xl">
              {hasMustChain ? 'Watch order' : 'Connections'}
            </h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasMustChain ? (
              <>
                <span className="font-semibold text-foreground">
                  Part {currentPosition} of {mustCount}
                </span>{' '}
                - {standing(priorCount, laterCount)}
                {canWatch.length > 0 && ' A few more, dashed below, are worth a look but not required.'}
              </>
            ) : canWatch.length > 0 ? (
              'Nothing else is required to follow this one, but a few titles below are worth a look.'
            ) : (
              standaloneCopy
            )}
          </p>
        </div>
      </div>

      {storyOrderAvailable && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmented
            options={ORDER_OPTIONS}
            value={orderMode}
            onChange={setOrderMode}
            aria-label="Watch order"
          />
          <p className="text-xs text-muted-foreground">
            {orderMode === 'story'
              ? 'Sorted by when events happen in the story.'
              : 'Sorted by when each title came out.'}
          </p>
        </div>
      )}

      {hasTimeline && (
        <TitleTimeline
          entries={entries}
          onSuppress={
            isAuthenticated
              ? (entry) => suppress.mutate({ mediaType: entry.mediaType, tmdbId: entry.tmdbId })
              : undefined
          }
        />
      )}
    </div>
  );
}

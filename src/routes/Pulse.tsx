import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Activity, AlertCircle, Clapperboard, RefreshCw, WifiOff } from 'lucide-react';
import type { BoardCard, BusinessType } from '../../shared/types/pulse';
import { CityTypePicker } from '@/components/pulse/CityTypePicker';
import { PendingBoardCard, RankedBoardCard } from '@/components/pulse/BoardCard';
import { PulseChatLauncher } from '@/components/pulse/PulseChatLauncher';
import { UnresolvedStrip } from '@/components/pulse/UnresolvedStrip';
import { Notice, RetryButton } from '@/components/pulse/Notice';
import { Skeleton } from '@/components/ui/skeleton';
import { shouldRetry } from '@/lib/http';
import { PulseApiError, fetchBoard, pulseConfigured, readProfile, saveProfile } from '@/lib/pulseApi';
import { businessTypeLabel, getPulseCity } from '@/lib/pulseCities';

/** Pending titles are being read from Qloo by the service's background warmer;
 *  a few seconds apart is how often there is anything new to see. */
const POLL_MS = 5_000;
/** Past this a title is stuck rather than slow, and polling it forever would
 *  hold a request open every 5 s from a tab nobody is watching. */
const POLL_WINDOW_MS = 2 * 60_000;

const TAGLINE = 'Choose an entertainment theme for your business using aggregate audience affinities.';

const pickerCodes = new Set(['unknown_city', 'unknown_business_type']);

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-lg font-semibold text-foreground">{children}</h2>;
}

function BoardSkeleton() {
  return (
    <div role="status" aria-busy="true" className="grid gap-3 lg:grid-cols-2">
      <span className="sr-only">Loading this week&rsquo;s releases…</span>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex min-h-[8.5rem] items-start gap-3 rounded-xl border border-border bg-card p-3">
          <div className="w-6 shrink-0" />
          <Skeleton className="h-[84px] w-14 shrink-0 rounded-lg sm:h-24 sm:w-16" />
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-2.5 w-2/5" />
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="h-2.5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Pulse() {
  const [searchParams, setSearchParams] = useSearchParams();
  const configured = pulseConfigured();

  // readProfile also consults localStorage; keying on the query string keeps
  // that read to one per navigation rather than one per render.
  const search = searchParams.toString();
  const profile = useMemo(() => readProfile(new URLSearchParams(search)), [search]);
  const city = getPulseCity(profile.city);
  const type: BusinessType | null = profile.type;
  const hasProfile = city !== null && type !== null;

  const changeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const [rateBlocked, setRateBlocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  // A profile that came from storage rather than the URL is mirrored into the
  // URL, so the address bar is always the link to share.
  useEffect(() => {
    if (!hasProfile) return;
    if (searchParams.get('city') === city.slug && searchParams.get('type') === type) return;
    const next = new URLSearchParams(searchParams);
    next.set('city', city.slug);
    next.set('type', type);
    setSearchParams(next, { replace: true });
  }, [hasProfile, city?.slug, type, searchParams, setSearchParams]);

  const profileKey = hasProfile ? `${city.slug}|${type}` : '';
  useEffect(() => {
    setGaveUp(false);
    setEditing(false);
  }, [profileKey]);

  const board = useQuery({
    queryKey: ['pulse-board', city?.slug, type],
    queryFn: ({ signal }) => fetchBoard(city.slug, type, signal),
    enabled: configured && hasProfile,
    staleTime: 10_000,
    // A 4xx (unknown city, rate limited) is a verdict, not a hiccup.
    retry: shouldRetry,
    refetchOnWindowFocus: (query) => !(query.state.error instanceof PulseApiError && query.state.error.status === 429),
    refetchOnReconnect: (query) => !(query.state.error instanceof PulseApiError && query.state.error.status === 429),
    refetchInterval: (query) => (!(query.state.error instanceof PulseApiError && query.state.error.status === 429) && !gaveUp && ((query.state.data?.pending.length ?? 0) > 0 || query.state.data?.rankingPending === true) ? POLL_MS : false),
  });

  useEffect(() => {
    const error = board.error;
    if (!(error instanceof PulseApiError) || error.status !== 429) { setRateBlocked(false); return; }
    const remaining = Math.max(0, board.errorUpdatedAt + (error.retryAfterSeconds ?? 5) * 1000 - Date.now());
    setRateBlocked(remaining > 0);
    const timer = setTimeout(() => setRateBlocked(false), remaining);
    return () => clearTimeout(timer);
  }, [board.error, board.errorUpdatedAt]);

  useEffect(() => {
    if (!editing && returnFocus.current) { changeRef.current?.focus(); returnFocus.current = false; }
  }, [editing, profileKey]);

  const hasPending = (board.data?.pending.length ?? 0) > 0;
  const awaitingRank = board.data?.rankingPending === true;
  const awaitingBoard = hasPending || awaitingRank;
  useEffect(() => {
    if (!awaitingBoard || gaveUp) return;
    const timer = setTimeout(() => setGaveUp(true), POLL_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [awaitingBoard, gaveUp, profileKey]);

  function choose(nextCity: string, nextType: BusinessType) {
    saveProfile({ city: nextCity, type: nextType });
    const next = new URLSearchParams(searchParams);
    next.set('city', nextCity);
    next.set('type', nextType);
    setSearchParams(next);
    setEditing(false);
  }

  if (!configured) {
    return (
      <PageShell>
        <Heading>Pulse</Heading>
        <Notice icon={<Activity size={40} />} title="Pulse isn’t configured on this deployment">
          <p className="max-w-sm text-xs">The Release Pulse service isn’t connected here, so there is nothing to load.</p>
        </Notice>
      </PageShell>
    );
  }

  const error = board.error;
  const apiError = error instanceof PulseApiError ? error : null;
  // The service refusing the profile (a city the SPA lists but it does not)
  // is the picker's problem, not a dead end.
  const pickerNotice =
    apiError && pickerCodes.has(apiError.code ?? '')
      ? apiError.code === 'unknown_city'
        ? 'Pulse doesn’t cover that city yet. Pick another one.'
        : 'Pulse doesn’t know that business type. Pick one below.'
      : undefined;

  if (!hasProfile || pickerNotice || editing) {
    return (
      <PageShell>
        <div className="space-y-1">
          <Heading>Release Pulse</Heading>
          <p className="text-sm text-muted-foreground">{TAGLINE}</p>
        </div>
        <CityTypePicker
          city={city?.slug ?? null}
          type={type}
          notice={pickerNotice}
          onSubmit={choose}
          onCancel={hasProfile && !pickerNotice ? () => { returnFocus.current = true; setEditing(false); } : undefined}
        />
      </PageShell>
    );
  }

  const data = board.data;
  const hrefFor = (card: BoardCard) => `/pulse/${city.slug}/${card.mediaType}/${card.tmdbId}?type=${type}`;
  const isEmpty = data && data.ranked.length + data.pending.length + data.unresolved.length + (data.noSignal?.length ?? 0) === 0;

  return (
    <PageShell>
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Heading>Pulse for {city.name}</Heading>
          <span className="text-xs text-muted-foreground">{businessTypeLabel(type)}</span>
          <button
            type="button"
            ref={changeRef}
            aria-label="Change"
            onClick={() => { returnFocus.current = true; setEditing(true); }}
            className="min-h-11 min-w-11 rounded text-xs font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Change
          </button>
          <PulseChatLauncher city={city.slug} type={type} />
        </div>
        {city.country !== 'IN' && (
          <p className="text-xs text-muted-foreground">Release dates are for India; audience data is for {city.name}.</p>
        )}
      </header>

      {board.isPending && !error && <BoardSkeleton />}

      {error && (!data || apiError?.status === 429) && (
        apiError?.status === 429 ? (
          <Notice icon={<AlertCircle size={40} />} title="Pulse is getting a lot of requests right now.">
            <p className="text-xs">
              {apiError.retryAfterSeconds
                ? `Try again in ${apiError.retryAfterSeconds} ${apiError.retryAfterSeconds === 1 ? 'second' : 'seconds'}.`
                : 'Give it a moment, then try again.'}
            </p>
            <RetryButton onClick={() => board.refetch()} busy={board.isFetching} disabled={rateBlocked} />
          </Notice>
        ) : (
          <Notice icon={<WifiOff size={40} />} title="Couldn’t load the board.">
            <p className="text-xs">Check your connection and try again.</p>
            <RetryButton onClick={() => board.refetch()} busy={board.isFetching} disabled={rateBlocked} />
          </Notice>
        )
      )}

      {isEmpty && (
        <Notice icon={<Clapperboard size={40} />} title="No upcoming releases to rank yet">
          <p className="text-xs">Check back soon.</p>
        </Notice>
      )}

      {data?.rankingBasis === 'qloo_shortlist' && (
        <p className="text-xs text-muted-foreground">Qloo ranks films and TV shows in separate shortlists. Ranks compare these candidates only; they do not forecast demand or attendance.</p>
      )}
      {data?.rankingBasis === 'release_order' && (
        <p className="text-xs text-muted-foreground">Release order · no comparable local ranking. Open a brief to check which audience evidence is available.</p>
      )}

      {data?.rankingBasis === 'qloo_shortlist' && (['movie', 'tv'] as const).map((mediaType) => {
        const cards = data.ranked.filter((card) => card.mediaType === mediaType);
        if (cards.length === 0) return null;
        return (
          <section key={mediaType} className="space-y-3">
            <Heading>{mediaType === 'movie' ? 'Films' : 'TV shows'}</Heading>
            <ol className="grid gap-3 lg:grid-cols-2" aria-label={`${mediaType === 'movie' ? 'Films' : 'TV shows'} ranked for ${data.cityName}`}>
              {cards.map((card) => (
                <li key={`${card.mediaType}-${card.tmdbId}`}><RankedBoardCard card={card} rank={card.localRank} cityName={data.cityName} href={hrefFor(card)} /></li>
              ))}
            </ol>
          </section>
        );
      })}

      {data && data.rankingBasis !== 'qloo_shortlist' && data.ranked.length > 0 && (
        <ol className="grid gap-3 lg:grid-cols-2" aria-label={data.rankingBasis === 'release_order' ? `Releases in release order for ${data.cityName}` : `Releases ranked for ${data.cityName}`}>
          {data.ranked.map((card, i) => (
            <li key={`${card.mediaType}-${card.tmdbId}`}>
              <RankedBoardCard card={card} rank={data.rankingBasis === 'release_order' ? undefined : i + 1} cityName={data.cityName} href={hrefFor(card)} />
            </li>
          ))}
        </ol>
      )}

      {data && awaitingBoard && (
        <div className="space-y-3">
          {awaitingRank && !gaveUp && <p role="status" className="text-xs text-muted-foreground">Reading the local shortlist ranking…</p>}
          {hasPending && <ul className="grid gap-3 lg:grid-cols-2" aria-label={`Releases still being read for ${data.cityName}`}>
            {data.pending.map((card) => (
              <li key={`${card.mediaType}-${card.tmdbId}`}>
                <PendingBoardCard card={card} cityName={data.cityName} />
              </li>
            ))}
          </ul>}
          {gaveUp && (
            <p role="status" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Still reading — refresh to check again
              <button
                type="button"
                disabled={board.isFetching || rateBlocked}
                onClick={() => {
                  setGaveUp(false);
                  board.refetch();
                }}
                className="inline-flex items-center gap-1 rounded font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RefreshCw size={12} /> Check again
              </button>
            </p>
          )}
        </div>
      )}

      {data && <UnresolvedStrip cards={data.unresolved} noSignal={data.noSignal} cityName={data.cityName} hrefFor={hrefFor} />}
    </PageShell>
  );
}

import { useEffect, useId, useMemo, useReducer, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, AlertCircle, ArrowLeft, Clapperboard, ImageOff, WifiOff } from 'lucide-react';
import type { BriefHeader, BriefSectionKey, BusinessType, Campaign, DemographicsData, HeatCell } from '../../shared/types/pulse';
import { AgeBars } from '@/components/pulse/AgeBars';
import { BriefSection } from '@/components/pulse/BriefSection';
import { CampaignView } from '@/components/pulse/CampaignView';
import { CityTypePicker } from '@/components/pulse/CityTypePicker';
import { CampaignCompare, CompareToggle } from '@/components/pulse/CampaignCompare';
import { Notice, RetryButton } from '@/components/pulse/Notice';
import { ProvenanceDrawer } from '@/components/pulse/ProvenanceDrawer';
import { HookList, NameChips, TrendLine, VenueList } from '@/components/pulse/SectionBodies';
import { WhereSection } from '@/components/pulse/WhereSection';
import { Skeleton } from '@/components/ui/skeleton';
import { usePulseGuess } from '@/hooks/usePulseGuess';
import { HttpError } from '@/lib/http';
import { PulseApiError, pulseConfigured, readProfile, saveProfile, streamBrief, type TitleParams } from '@/lib/pulseApi';
import { businessTypeLabel, getPulseCity } from '@/lib/pulseCities';
import { SECTION_TITLES } from '@/lib/pulseCopy';
import { formatReleaseDateFull } from '@/lib/pulseFormat';
import { BRIEF_SECTIONS, briefReducer, initialBriefState, sectionView } from '@/lib/pulseSections';
import { tmdbPoster } from '@/lib/tmdbImage';
import { cn } from '@/lib/utils';

const boardHref = (city: string | null, type: BusinessType | null) => {
  const q = new URLSearchParams();
  if (city) q.set('city', city);
  if (type) q.set('type', type);
  const s = q.toString();
  return s ? `/pulse?${s}` : '/pulse';
};

function BackLink({ href }: { href: string }) {
  return (
    <Link
      to={href}
      className="inline-flex min-h-11 items-center gap-1.5 rounded pr-2 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft size={13} aria-hidden />
      Back to board
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Failures that replace the page
// ---------------------------------------------------------------------------

type Failure = 'unknown_city' | 'unknown_type' | 'unknown_title' | 'rate_limited' | 'other';

/** The service's verdicts are 4xx and each has its own screen; anything else
 *  (a dropped connection, a 5xx) is "try again". A bare 400 is read as an
 *  unsupported city, since the page only ever sends a validated title and the
 *  city is the part the service can still refuse. */
function classify(err: unknown): Failure {
  const code = err instanceof PulseApiError ? err.code : null;
  const status = err instanceof HttpError ? err.status : undefined;
  if (code === 'unknown_city') return 'unknown_city';
  if (code === 'unknown_business_type') return 'unknown_type';
  if (code === 'unknown_title' || status === 404) return 'unknown_title';
  if (code === 'rate_limited' || status === 429) return 'rate_limited';
  if (status === 400) return 'unknown_city';
  return 'other';
}

function rateLimitText(err: unknown): string {
  const s = err instanceof PulseApiError ? err.retryAfterSeconds : undefined;
  return s ? `Try again in ${s} ${s === 1 ? 'second' : 'seconds'}.` : 'Give it a moment, then try again.';
}

function UnknownTitle({ href }: { href: string }) {
  return (
    <Notice icon={<Clapperboard size={40} />} title="We don’t have this title yet.">
      <p className="text-xs">Pulse only covers titles on the board.</p>
      <BackLink href={href} />
    </Notice>
  );
}

/** The city/type picker, for a brief whose city (or type) is not one Pulse
 *  covers. Choosing goes to the board: the title may not exist there. */
function BriefPicker({ city, type, notice }: { city: string | null; type: BusinessType | null; notice: string }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg font-semibold text-foreground">Release Pulse</h2>
      <CityTypePicker
        city={city}
        type={type}
        notice={notice}
        onSubmit={(nextCity, nextType) => {
          saveProfile({ city: nextCity, type: nextType });
          navigate(boardHref(nextCity, nextType));
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

function HeaderBlock({ header, cityName, type, stalled }: { header: BriefHeader | null; cityName: string; type: BusinessType; stalled: boolean }) {
  const poster = header ? tmdbPoster(header.posterUrl, 96) : undefined;
  const meta = [
    header?.mediaType === 'tv' ? 'TV' : header ? 'Film' : null,
    header?.releaseDate ? formatReleaseDateFull(header.releaseDate) : null,
    cityName,
    businessTypeLabel(type),
  ].filter(Boolean);

  return (
    <div className="flex items-start gap-4">
      <div className="h-[8.5rem] w-24 shrink-0 overflow-hidden rounded-lg bg-secondary">
        {!header ? (
          <Skeleton className={cn('h-full w-full rounded-lg', stalled && 'animate-none')} />
        ) : poster ? (
          <img src={poster.src} srcSet={poster.srcSet} alt="" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="no-poster-stripes flex h-full w-full items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground">
            <ImageOff size={20} aria-hidden />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2 pt-1">
        {header ? (
          <h1 className="break-words font-display text-xl font-semibold leading-tight text-foreground sm:text-2xl">{header.title}</h1>
        ) : stalled ? (
          <p className="text-sm text-muted-foreground">The title didn’t load.</p>
        ) : (
          <Skeleton className="h-7 w-3/4" />
        )}
        <p className="text-xs text-muted-foreground">{meta.join(' · ')}</p>
      </div>
    </div>
  );
}

function BriefStream({ city, type, mediaType, tmdbId }: TitleParams) {
  const cityInfo = getPulseCity(city)!;
  const params = useMemo<TitleParams>(() => ({ city, type, mediaType, tmdbId }), [city, type, mediaType, tmdbId]);
  const [state, dispatch] = useReducer(briefReducer, initialBriefState);
  const [fatal, setFatal] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  // Lifted here (not in the compare panel) so the guess survives hiding the panel.
  const [compareOpen, setCompareOpen] = useState(false);
  const guess = usePulseGuess(params);
  const compareRegion = useId();

  // One effect owns the stream. Its cleanup aborts it: on leaving the page, on
  // a Retry (which starts over) and on a change of title.
  useEffect(() => {
    const ac = new AbortController();
    dispatch({ type: 'begin' });
    setFatal(null);
    streamBrief(
      params,
      (event) => {
        if (!ac.signal.aborted) dispatch({ type: 'event', event });
      },
      ac.signal,
    ).then(
      () => {
        if (!ac.signal.aborted) dispatch({ type: 'ended' });
      },
      (err) => {
        if (!ac.signal.aborted) setFatal(err);
      },
    );
    return () => ac.abort();
  }, [params, attempt]);

  const retry = () => setAttempt((n) => n + 1);
  const toggleCompare = () => {
    if (compareOpen) return setCompareOpen(false);
    setCompareOpen(true);
    if (guess.state.status === 'idle' || guess.state.status === 'error') guess.load();
  };
  const failure = fatal ? classify(fatal) : null;
  const back = boardHref(city, type);

  if (failure === 'unknown_city' || failure === 'unknown_type') {
    return (
      <BriefPicker
        city={failure === 'unknown_city' ? null : city}
        type={failure === 'unknown_type' ? null : type}
        notice={failure === 'unknown_city' ? 'That city isn’t supported yet — pick one of these.' : 'That business type isn’t supported — pick one of these.'}
      />
    );
  }
  if (failure === 'unknown_title') return <UnknownTitle href={back} />;

  const { header, sections } = state;
  const hasContent = header !== null || Object.keys(sections).length > 0;

  if (failure && !hasContent) {
    return failure === 'rate_limited' ? (
      <Notice icon={<AlertCircle size={40} />} title="Pulse is getting a lot of requests right now.">
        <p className="text-xs">{rateLimitText(fatal)}</p>
        <RetryButton onClick={retry} />
      </Notice>
    ) : (
      <Notice icon={<WifiOff size={40} />} title="Couldn’t load this brief.">
        <p className="text-xs">Check your connection and try again.</p>
        <RetryButton onClick={retry} />
      </Notice>
    );
  }

  const title = header?.title ?? 'this title';
  const cityName = header?.cityName ?? cityInfo.name;
  const order = BRIEF_SECTIONS[type];
  const streaming = !state.done && !state.interrupted && !failure;
  // Nothing more is coming: a section still waiting should say so, not shimmer.
  const stalled = state.interrupted || failure !== null;
  const refreshing = streaming && Object.keys(state.stale).length > 0;
  const currency = cityInfo.country === 'IN' ? '₹' : '$';

  const render = (key: BriefSectionKey) => {
    const view = sectionView(state, key);
    const common = { title: SECTION_TITLES[key], view, onRetry: retry, stalled };

    switch (key) {
      case 'who':
        return (
          <BriefSection {...common} lede={`How the audience for ${title} differs from the average audience.`} skeletonClass="h-56">
            {(data) => <AgeBars data={data as DemographicsData} />}
          </BriefSection>
        );
      case 'where':
        return (
          <BriefSection {...common} lede={`Where fans of ${title} in ${cityName} are concentrated.`} skeletonClass="h-72 sm:h-80">
            {(data) => <WhereSection cells={data as HeatCell[]} title={title} cityName={cityName} />}
          </BriefSection>
        );
      case 'venues':
        return (
          <BriefSection {...common} lede={`Fans of ${title} in ${cityName} over-index on these places…`} skeletonClass="h-40">
            {(data) => <VenueList data={data} currency={currency} />}
          </BriefSection>
        );
      case 'themes':
        return (
          <BriefSection {...common} lede={`Fans of ${title} in ${cityName} over-index on these place themes…`} skeletonClass="h-16">
            {(data) => <NameChips data={data} label={`Place themes fans of ${title} in ${cityName} over-index on`} />}
          </BriefSection>
        );
      case 'artists':
        return (
          <BriefSection {...common} lede={`Fans of ${title} over-index on these artists…`} skeletonClass="h-16">
            {(data) => <NameChips data={data} label={`Artists fans of ${title} over-index on`} />}
          </BriefSection>
        );
      case 'brands':
        return (
          <BriefSection {...common} lede={`Fans of ${title} over-index on these brands…`} skeletonClass="h-16">
            {(data) => <NameChips data={data} label={`Brands fans of ${title} over-index on`} />}
          </BriefSection>
        );
      case 'hook':
        return (
          <BriefSection {...common} lede={`How ${title} connects to ${cityName}.`} skeletonClass="h-12">
            {(data) => <HookList data={data} cityName={cityName} />}
          </BriefSection>
        );
      case 'trend': {
        // Only a trend that came back ok is shown: a gap, a failure or a note
        // here would be noise, and there is no skeleton for something that
        // may never appear.
        const section = state.sections.trend;
        if (!section || section.status !== 'ok') return null;
        return (
          <BriefSection {...common} lede={`How interest in ${title} has moved recently.`}>
            {(data) => <TrendLine data={data} />}
          </BriefSection>
        );
      }
      case 'campaign': {
        const bundle = sections;
        return (
          <BriefSection
            {...common}
            errorText="The campaign writer didn’t answer"
            skeletonClass="h-64"
            body={
              compareOpen && !(view.kind === 'loading' && stalled) ? (
                <CampaignCompare view={view} guess={guess.state} onRetryGuess={guess.load} bundle={bundle} cityName={cityName} />
              ) : undefined
            }
          >
            {(data, section) => {
              const c = data as Campaign;
              if (!Array.isArray(c.ideas) || c.ideas.length === 0) return <p className="text-sm text-muted-foreground">No data returned</p>;
              return (
                <div className="space-y-3">
                  {section.status === 'ok' && c.groundedBy === 'qloo' && (
                    <p className="text-xs text-muted-foreground">Each clause shows what it cites; clauses marked Agent suggestion are the writer’s own.</p>
                  )}
                  <CampaignView campaign={c} bundle={bundle} cityName={cityName} />
                </div>
              );
            }}
          </BriefSection>
        );
      }
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink href={back} />
        {hasContent && <ProvenanceDrawer order={order} sections={sections} />}
      </div>

      <HeaderBlock header={header} cityName={cityName} type={type} stalled={stalled} />

      {refreshing && (
        <p role="status" className="text-xs text-muted-foreground">
          Refreshing the brief — what is shown below is from the last attempt until it is replaced.
        </p>
      )}

      {(failure || state.interrupted) && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
          <span>
            {failure === 'rate_limited'
              ? `Pulse is getting a lot of requests right now. ${rateLimitText(fatal)}`
              : state.interrupted
                ? 'The connection dropped before the brief finished.'
                : 'Couldn’t refresh the brief.'}
          </span>
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-11 items-center rounded px-1 text-xs font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      )}

      <div className="space-y-4">
        {order.map((key) => {
          const node = render(key);
          if (!node) return null;
          return (
            <div key={key}>
              {/* The compare panel, when open, takes the campaign's place inside this region. */}
              <div id={key === 'campaign' ? compareRegion : undefined}>{node}</div>
              {key === 'campaign' && header && (
                <div className="mt-3">
                  <CompareToggle open={compareOpen} onToggle={toggleCompare} controls={compareRegion} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PulseBrief() {
  const { city: citySlug, mediaType, tmdbId: idParam } = useParams();
  const [searchParams] = useSearchParams();

  const search = searchParams.toString();
  const profile = useMemo(() => readProfile(new URLSearchParams(search)), [search]);
  const type = profile.type;
  const city = getPulseCity(citySlug);
  const id = Number(idParam);
  const titleOk = (mediaType === 'movie' || mediaType === 'tv') && Number.isInteger(id) && id > 0;

  if (!pulseConfigured()) {
    return (
      <div className="space-y-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Pulse</h2>
        <Notice icon={<Activity size={40} />} title="Pulse isn’t configured on this deployment">
          <p className="max-w-sm text-xs">The Release Pulse service isn’t connected here, so there is nothing to load.</p>
        </Notice>
      </div>
    );
  }

  if (!titleOk) return <UnknownTitle href={boardHref(city?.slug ?? null, type)} />;

  if (!city) return <BriefPicker city={null} type={type} notice="That city isn’t supported yet — pick one of these." />;
  if (!type) return <BriefPicker city={city.slug} type={null} notice="Pick a business type to open this brief." />;

  return <BriefStream key={`${city.slug}|${type}|${mediaType}|${id}`} city={city.slug} type={type} mediaType={mediaType as 'movie' | 'tv'} tmdbId={id} />;
}

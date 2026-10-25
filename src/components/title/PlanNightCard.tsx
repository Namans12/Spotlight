import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Copy, Share2, MessageCircle, RefreshCw } from 'lucide-react';
import type { EvidenceSection, NamedEntity, PlanNightResponse, Provenance, Venue } from '../../../shared/types/pulse';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchPlanNight, PulseApiError, pulseConfigured } from '@/lib/pulseApi';
import { inviteText } from '@/lib/planNightInvite';
import { getPulseCity, PULSE_CITIES } from '@/lib/pulseCities';

interface PlanNightCardProps {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  /** The title as the page shows it; "this title" stands in when it is missing. */
  title?: string | null;
}

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const PRIMARY = `${BUTTON} bg-accent text-accent-foreground hover:brightness-110 disabled:pointer-events-none disabled:opacity-50`;
const SECONDARY = `${BUTTON} bg-secondary text-foreground hover:bg-card-hover`;

const currencyFor = (country: string | undefined) => (country === 'IN' ? '₹' : '$');

function PriceMarks({ level, symbol }: { level: number; symbol: string }) {
  const n = Math.min(4, Math.max(1, Math.round(level)));
  return (
    <span className="text-xs text-muted-foreground" aria-label={`Price level ${n} of 4`}>
      <span aria-hidden>
        <span className="text-foreground">{symbol.repeat(n)}</span>
        {symbol.repeat(4 - n)}
      </span>
    </span>
  );
}

function Sources({ provenance }: { provenance: Provenance[] }) {
  const lines = [...new Set(provenance.map((p) => `Source: ${p.source === 'qloo' ? 'Qloo' : p.source}. ${p.limits}`))];
  if (lines.length === 0) return null;
  return (
    <div className="mt-2 space-y-0.5">
      {lines.map((l) => (
        <p key={l} className="text-[11px] leading-4 text-muted-foreground">
          {l}
        </p>
      ))}
    </div>
  );
}

const hasRows = (s: EvidenceSection<unknown>) => s.status !== 'error' && Array.isArray(s.data) && s.data.length > 0;

/** What a section says when it has nothing to list: its note, or a plain line
 *  when it has none. The copy-rule heading is not drawn in that case, because
 *  it would announce a list that is not there. */
function Unavailable({ section, what, onRetry, busy }: { section: EvidenceSection<unknown>; what: string; onRetry: () => void; busy: boolean }) {
  const failed = section.status === 'error';
  const fallback = failed ? "Qloo didn't answer this part." : `No ${what} to show for this one.`;
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-muted-foreground">{section.note || fallback}</p>
      {failed && (
        <button type="button" onClick={onRetry} disabled={busy} className={SECONDARY}>
          <RefreshCw size={13} aria-hidden />
          Try again
        </button>
      )}
    </div>
  );
}

function Results({ data, title, inviteTitle, mediaType, country, onRetry, busy }: { data: PlanNightResponse; title: string; inviteTitle: string | null; mediaType: 'movie' | 'tv'; country: string | undefined; onRetry: () => void; busy: boolean }) {
  const { places, artists, cityName } = data;
  const symbol = currencyFor(country);
  const venues = hasRows(places) ? (places.data as Venue[]) : [];
  const names = hasRows(artists) ? (artists.data as NamedEntity[]) : [];
  const text = inviteText(inviteTitle, cityName, venues, mediaType);

  return (
    <div className="space-y-5">
      <div>
        {venues.length > 0 ? (
          <>
            <h3 className="mb-2 text-sm font-semibold text-foreground">{`Qloo-recommended venues in ${cityName} for ${title}`}</h3>
            <ul className="divide-y divide-border">
              {venues.map((v, i) => (
                <li key={`${v.entityId}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0">
                  <span className="text-sm font-medium text-foreground">{v.name}</span>
                  {typeof v.priceLevel === 'number' && v.priceLevel > 0 && <PriceMarks level={v.priceLevel} symbol={symbol} />}
                  {v.address && <span className="basis-full text-xs text-muted-foreground">{v.address}</span>}
                </li>
              ))}
            </ul>
            {places.status !== 'ok' && places.note && <p className="mt-2 text-xs text-muted-foreground">{places.note}</p>}
            <Sources provenance={places.provenance} />
          </>
        ) : (
          <Unavailable section={places} what="places" onRetry={onRetry} busy={busy} />
        )}
      </div>

      <div>
        {names.length > 0 ? (
          <>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Qloo-recommended artists (global affinities)</h3>
            <ul aria-label={`Global artist recommendations for ${title}`} className="flex flex-wrap gap-2">
              {names.map((a, i) => (
                <li key={`${a.entityId}-${i}`} className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-foreground">
                  {a.name}
                </li>
              ))}
            </ul>
            {artists.status !== 'ok' && artists.note && <p className="mt-2 text-xs text-muted-foreground">{artists.note}</p>}
            <Sources provenance={artists.provenance} />
          </>
        ) : (
          <Unavailable section={artists} what="artists" onRetry={onRetry} busy={busy} />
        )}
      </div>

      <Invite text={text} />
    </div>
  );
}

/** The invite text and the three ways to take it away. Every one is the
 *  visitor's own action; this component never sends anything. */
function Invite({ text }: { text: string }) {
  const id = useId();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState('');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const share = async () => {
    try {
      await navigator.share({ text });
      setStatus('');
    } catch (err) {
      // Closing the share sheet is a choice, not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setStatus("Sharing isn't available here. Use Copy instead.");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
    } catch {
      // Clipboard access can be blocked; select the text so a manual copy is one gesture.
      areaRef.current?.select();
      setStatus("Couldn't copy automatically. The text is selected, so you can copy it yourself.");
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-semibold text-muted-foreground">
        Invite text
      </label>
      <textarea
        id={id}
        ref={areaRef}
        readOnly
        rows={3}
        value={text}
        className="w-full resize-none rounded-lg border border-border bg-secondary p-3 text-base text-foreground sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap gap-2">
        {canShare && (
          <button type="button" onClick={() => void share()} className={SECONDARY}>
            <Share2 size={13} aria-hidden />
            Share
          </button>
        )}
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={SECONDARY}
        >
          <MessageCircle size={13} aria-hidden />
          WhatsApp
        </a>
        <button type="button" onClick={() => void copy()} className={SECONDARY}>
          <Copy size={13} aria-hidden />
          Copy
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}

function Failure({ error, onRetry, busy }: { error: unknown; onRetry: () => void; busy: boolean }) {
  if (error instanceof PulseApiError && error.code === 'unknown_title') {
    return <p className="text-sm text-muted-foreground">{"Plan the night works for titles on Spotlight's release radar."}</p>;
  }
  if (error instanceof PulseApiError && error.status === 429) {
    const wait = error.retryAfterSeconds;
    return (
      <div className="space-y-2">
        <p className="text-sm text-foreground">
          Lots of people are planning nights right now. {wait ? `Please wait about ${wait} ${wait === 1 ? 'second' : 'seconds'} and try again.` : 'Please wait a moment and try again.'}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground">{"Couldn't load places just now. Check your connection and try again."}</p>
      <button type="button" onClick={onRetry} disabled={busy} className={SECONDARY}>
        <RefreshCw size={13} aria-hidden />
        Retry
      </button>
    </div>
  );
}

/**
 * Qloo venue recommendations filtered to the selected city, global artist
 * affinities and a shareable invite. Nothing is fetched until the visitor asks.
 * A venue location filter does not establish the location of the title's fans.
 */
export function PlanNightCard(props: PlanNightCardProps) {
  if (!pulseConfigured()) return null;
  // Keyed by the title: the picked city, the request it made and any copy
  // message belong to one title, so a different title starts from a collapsed
  // card even if a parent keeps this element mounted across navigations. Without
  // it, the old city would be fetched for the new title with no click.
  return <PlanNightCardForTitle key={`${props.mediaType}-${props.tmdbId}`} {...props} />;
}

function PlanNightCardForTitle({ mediaType, tmdbId, title }: PlanNightCardProps) {
  const configured = pulseConfigured();
  const selectId = useId();
  const [draft, setDraft] = useState('');
  const [requested, setRequested] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['pulse-plan-night', mediaType, tmdbId, requested],
    queryFn: ({ signal }) => fetchPlanNight({ city: requested as string, mediaType, tmdbId }, signal),
    enabled: configured && requested !== null && Number.isFinite(tmdbId),
    staleTime: 10 * 60_000,
    // A failed answer is shown at once with its own Retry; each attempt spends budget.
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!configured) return null;

  const busy = query.isFetching;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!getPulseCity(draft)) return;
    if (draft === requested) {
      if (query.isError) void query.refetch();
    } else {
      setRequested(draft);
    }
  };
  const knownTitle = title?.trim() || query.data?.title?.trim() || null;

  return (
    <section className="px-1" aria-labelledby={`${selectId}-heading`}>
      <div className="space-y-4 rounded-xl bg-card px-4 py-3.5">
        <h2 id={`${selectId}-heading`} className="font-display text-lg font-semibold text-foreground">
          Plan the night
        </h2>
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1.5">
            <label htmlFor={selectId} className="block text-xs font-semibold text-muted-foreground">
              City
            </label>
            <div className="relative">
              <select
                id={selectId}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-11 w-full appearance-none rounded-lg border border-border bg-secondary pl-3 pr-9 text-base font-semibold text-foreground sm:text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="" disabled>
                  Choose a city
                </option>
                {PULSE_CITIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          <button type="submit" disabled={!draft || busy} className={PRIMARY}>
            Show me places
          </button>
        </form>

        {requested !== null && (
          <div>
            {/* One short announcement when the answer lands, rather than making the whole result a live region. */}
            <p role="status" className="sr-only">
              {query.data ? `Venue recommendations in ${query.data.cityName} and global artist affinities are ready.` : ''}
            </p>
            {query.isPending ? (
              <div role="status" aria-busy="true" className="space-y-2">
                <span className="sr-only">Finding places…</span>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            ) : query.isError ? (
              <Failure error={query.error} onRetry={() => void query.refetch()} busy={busy} />
            ) : query.data ? (
              <Results data={query.data} title={knownTitle ?? 'this title'} inviteTitle={knownTitle} mediaType={mediaType} country={getPulseCity(requested)?.country} onRetry={() => void query.refetch()} busy={busy} />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { fetchCalendarMonth } from '@/lib/api';
import { Toolbar } from '@/components/layout/Toolbar';
import { Segmented } from '@/components/ui/segmented';
import { FilterSelect } from '@/components/ui/filter-select';
import { useMediaScope } from '@/hooks/useMediaScope';
import { useSeasons, type SeasonsLookup } from '@/hooks/useSeasons';
import { languageName, compareByLanguageName } from '@/lib/languages';
import { evidenceDate, providerDetails } from '@/components/release/ReleaseEvidence';
import { tmdbPoster } from '@/lib/tmdbImage';
import { fetchProvidersBatch, providerKey } from '@/lib/providers';
import type { CalendarEntryDTO, CalendarKind } from '../../shared/types/calendar';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Film,
  Tv,
  Clapperboard,
  Star,
  Popcorn,
  MonitorPlay,
  Globe,
} from 'lucide-react';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' });
}

function ordinal(day: number): string {
  if (day % 10 === 1 && day !== 11) return `${day}st`;
  if (day % 10 === 2 && day !== 12) return `${day}nd`;
  if (day % 10 === 3 && day !== 13) return `${day}rd`;
  return `${day}th`;
}

/** "13th Aug" — used only for the origin-date parenthetical, which sits next
 * to a title rather than under its own day header, so it needs the day
 * spelled out rather than relying on which section of the page it's in. */
function shortOrdinalDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${ordinal(d.getDate())} ${month}`;
}

type KindFilter = 'all' | CalendarKind;

const SECTIONS: { kind: CalendarKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'theatrical', label: 'In Cinemas', icon: <Popcorn size={14} /> },
  { kind: 'streaming', label: 'Streaming', icon: <MonitorPlay size={14} /> },
  { kind: 'tv_network', label: 'On TV', icon: <Tv size={14} /> },
  { kind: 'global_premiere', label: 'Global premieres', icon: <Tv size={14} /> },
];

/** Tabs, not filter chips: theatrical and OTT are two different questions
 * ("what's in cinemas" vs "what lands on my subscriptions"), so each gets its
 * own view rather than a toggle on one list. */
const TABS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'theatrical', label: 'In Cinemas' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'tv_network', label: 'On TV' },
  { id: 'global_premiere', label: 'Global premieres' },
];

function EntryRow({ entry, seasons }: { entry: CalendarEntryDTO; seasons: number | null }) {
  const [checkAvailability, setCheckAvailability] = useState(false);
  const query = useQuery({
    queryKey: ['calendar-current-availability', entry.mediaType, entry.tmdbId],
    queryFn: () => fetchProvidersBatch([{ mediaType: entry.mediaType!, id: entry.tmdbId! }]),
    enabled: checkAvailability && entry.mediaType === 'tv' && entry.tmdbId != null,
    staleTime: 0, retry: false,
  });
  const poster = tmdbPoster(entry.posterUrl, 36); // box is w-9 = 36px
  const body = (
    <div className="flex items-center gap-3 p-3 bg-card rounded-xl border border-border hover:border-accent/30 hover:bg-card-hover transition-all duration-200">
      {/* Poster once the TMDB backfill has resolved the row; the icon tile is
          the fallback for rows that never matched confidently. */}
      {poster ? (
        <img
          src={poster.src}
          srcSet={poster.srcSet}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-9 h-[54px] rounded-lg object-cover bg-secondary shrink-0"
        />
      ) : (
        <div className="no-poster-stripes w-9 h-[54px] rounded-lg border border-dashed border-muted-foreground/40 flex items-center justify-center shrink-0 text-muted-foreground">
          {entry.kind === 'theatrical' ? (
            <Popcorn size={16} />
          ) : entry.mediaType === 'tv' ? (
            <Tv size={16} />
          ) : (
            <Film size={16} />
          )}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{entry.title}</p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          {(entry.platforms?.length ? entry.platforms.join(', ') : entry.platform) && <span>{entry.platforms?.length ? entry.platforms.join(', ') : entry.platform}</span>}
          {entry.region === null && <span className="shrink-0">Region unknown</span>}
          {entry.mediaType === 'tv' && seasons != null && (
            <span className="opacity-60 shrink-0">
              {seasons} {seasons === 1 ? 'Season' : 'Seasons'}
            </span>
          )}
          {entry.language && <span className="opacity-60 shrink-0">{languageName(entry.language)}</span>}
          {entry.originRegion && entry.originReleaseDate && (
            <span className="opacity-60 shrink-0">
              ({entry.originRegion}: {shortOrdinalDate(entry.originReleaseDate)})
            </span>
          )}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
          Source: {entry.source || 'unknown'} · Region: {entry.region || 'unknown'} · {evidenceDate(entry.observedAt)}
        </p>
        <p className="text-[10px] text-muted-foreground leading-snug">
          {entry.kind === 'streaming' ? providerDetails(entry.platforms ?? [], entry.availabilityTypes) : entry.kind === 'theatrical' ? 'Theatrical' : entry.kind === 'global_premiere' ? 'Global first-air date · Local availability unknown' : 'TV network'}
          {' · '}{entry.evidenceStatus === 'regional' || entry.evidenceStatus === 'global' ? 'Date reported by source; may change' : 'Date and release type unverified'}
        </p>
      </div>
      {entry.rating != null && (
        <span className="inline-flex items-center gap-0.5 text-xs text-gold font-semibold shrink-0">
          <Star size={11} fill="currentColor" /> {entry.rating.toFixed(1)}
        </span>
      )}
    </div>
  );

  const offers = entry.tmdbId && entry.mediaType ? query.data?.availability?.[providerKey(entry.mediaType, entry.tmdbId)] : undefined;
  const offerNames = [...new Set((offers ?? []).map(offer => offer.provider))];
  const offerTypes: Record<string, string[]> = {};
  for (const offer of offers ?? []) offerTypes[offer.provider] = [...new Set([...(offerTypes[offer.provider] ?? []), offer.type])];
  return <div>
    {entry.tmdbId && entry.mediaType ? <Link to={`/title/${entry.mediaType}/${entry.tmdbId}`}>{body}</Link> : body}
    {entry.mediaType === 'tv' && entry.tmdbId != null && <div className="px-3 pb-2 text-xs text-muted-foreground">
      <button type="button" className="underline" onClick={() => { if (checkAvailability) void query.refetch(); else setCheckAvailability(true); }}>
        {checkAvailability ? 'Check India availability again' : 'Check current India availability'}
      </button>
      {checkAvailability && <p role="status" className="mt-1">
        {query.isFetching ? 'Checking current listings…' : query.isError || offers === undefined ? 'Could not check listings; availability is unknown.' :
          offers.length ? `Currently reported in India: ${providerDetails(offerNames, offerTypes)}.` : 'No India listings reported; availability is unknown.'}
        {' '}Source: TMDB / JustWatch; results may be cached and do not confirm this date or a specific season.
      </p>}
    </div>}
  </div>;
}

function DayGroups({ entries, seasonsFor }: { entries: CalendarEntryDTO[]; seasonsFor: SeasonsLookup }) {
  const groups = new Map<string, CalendarEntryDTO[]>();
  for (const entry of entries) {
    if (!groups.has(entry.releaseDate)) groups.set(entry.releaseDate, []);
    groups.get(entry.releaseDate)!.push(entry);
  }
  const days = [...groups.keys()].sort();

  return (
    <div className="space-y-4">
      {days.map((day) => (
        <div key={day} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dayLabel(day)}</p>
          <div className="space-y-1.5">
            {groups.get(day)!.map((entry, i) => (
              <EntryRow
                key={`${entry.title}-${i}`}
                entry={entry}
                seasons={entry.mediaType && entry.tmdbId ? seasonsFor(entry.mediaType, entry.tmdbId) : null}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Calendar() {
  const [params, setParams] = useSearchParams();
  const [mediaType] = useMediaScope();
  const month = params.get('month') || currentMonth();
  const kind = (params.get('kind') as KindFilter) || 'all';
  // Comma-joined in the URL so a deep link can carry more than one language
  // (e.g. ?language=hi,ta) the same way `kind` and `month` are single values.
  const languages = useMemo(() => {
    const raw = params.get('language');
    return raw ? raw.split(',').filter(Boolean) : [];
  }, [params]);

  function updateLanguages(next: string[]) {
    const updated = new URLSearchParams(params);
    if (next.length === 0) updated.delete('language');
    else updated.set('language', next.join(','));
    setParams(updated, { replace: true });
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['calendar', month],
    queryFn: () => fetchCalendarMonth(month),
    staleTime: 60 * 60_000,
  });

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'all' || (key === 'month' && value === currentMonth())) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  // The topbar's Movies/Shows scope narrows the calendar too. Rows whose media
  // type was never resolved stay visible under "All" only, rather than being
  // silently dropped from both halves of the split.
  const allEntries = data?.entries ?? [];
  const scopedEntries = mediaType === 'all' ? allEntries : allEntries.filter((e) => e.mediaType === mediaType);

  // Options come from the media-scoped list (not yet language-filtered) so
  // picking a language never makes other options disappear from the menu.
  // Deduped by DISPLAY name, not raw code: a data-quality artifact stores some
  // rows as 'cn' instead of the correct 'zh', and both mean "Chinese" — one
  // representative code per distinct name, or the filter shows two
  // identical-looking "Chinese" options that quietly do different things.
  const languageOptions = useMemo(() => {
    const byName = new Map<string, string>();
    for (const e of scopedEntries) {
      if (!e.language) continue;
      const name = languageName(e.language);
      if (!byName.has(name)) byName.set(name, e.language);
    }
    return [...byName.values()].sort(compareByLanguageName);
  }, [scopedEntries]);

  // Matched by display name (see above), so selecting either "cn" or "zh"
  // catches every row that means Chinese, not just the one exact code chosen.
  const selectedLanguageNames = useMemo(() => new Set(languages.map(languageName)), [languages]);
  const entries =
    selectedLanguageNames.size > 0
      ? scopedEntries.filter((e) => e.language && selectedLanguageNames.has(languageName(e.language)))
      : scopedEntries;
  const counts: Record<CalendarKind, number> = { theatrical: 0, streaming: 0, tv_network: 0, global_premiere: 0 };
  for (const entry of entries) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;

  // CalendarEntryDTO carries tmdbId/mediaType rather than Movie's id/mediaType
  // shape, and either can be null for a not-yet-linked row — filtered out here
  // rather than asking useSeasons to understand this DTO's nullability.
  const seasonsFor = useSeasons(
    entries
      .filter((e): e is CalendarEntryDTO & { tmdbId: number; mediaType: 'movie' | 'tv' } => e.tmdbId != null && e.mediaType != null)
      .map((e) => ({ id: e.tmdbId, mediaType: e.mediaType })),
  );

  const visibleSections = kind === 'all' ? SECTIONS : SECTIONS.filter((s) => s.kind === kind);
  const hasAny = visibleSections.some((s) => counts[s.kind] > 0);

  const tabOptions = TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
  }));

  return (
    <div className="space-y-5">
      <Toolbar>
        <div className="flex h-toolbar items-center gap-2 overflow-x-auto px-4 hide-scrollbar sm:px-gutter">
          {/* Month stepper reads as one unit: two arrows either side of a fixed
              label width, so the month name doesn't shift the arrows around. */}
          <div className="inline-flex h-control shrink-0 items-center rounded-lg border border-border bg-secondary">
            <button
              onClick={() => updateParam('month', shiftMonth(month, -1))}
              aria-label="Previous month"
              className="grid h-full w-8 place-items-center rounded-l-lg text-muted-foreground hover:text-foreground active:!scale-100"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[8.5rem] px-1 text-center font-display text-xs font-semibold text-foreground">
              {monthLabel(month)}
            </span>
            <button
              onClick={() => updateParam('month', shiftMonth(month, 1))}
              aria-label="Next month"
              className="grid h-full w-8 place-items-center rounded-r-lg text-muted-foreground hover:text-foreground active:!scale-100"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

          <Segmented
            options={tabOptions}
            value={kind}
            onChange={(id) => updateParam('kind', id)}
            aria-label="Release kind"
          />

          {languageOptions.length > 0 && (
            <FilterSelect
              multiple
              label="Language"
              allLabel="All languages"
              icon={<Globe size={13} />}
              value={languages}
              onChange={updateLanguages}
              options={languageOptions}
              getLabel={languageName}
            />
          )}

          {data && (
            <span className="shrink-0 pl-1 text-[11px] tabular-nums text-muted-foreground">
              {entries.length} {entries.length === 1 ? 'release' : 'releases'}
            </span>
          )}
        </div>
      </Toolbar>

      <div className="flex items-baseline gap-2">
        <h2 className="font-display text-lg font-semibold text-foreground">{monthLabel(month)}</h2>
        <span className="text-xs text-muted-foreground">
          {kind === 'all' ? 'All releases' : TABS.find((t) => t.id === kind)?.label}
        </span>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-accent" size={28} />
        </div>
      )}

      {error && <p className="text-center text-sm text-muted-foreground py-20">Could not load the calendar for this month.</p>}

      {data && !hasAny && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Clapperboard size={40} className="mb-3 opacity-30" />
          <p className="text-sm font-medium">No known releases for {monthLabel(month)} yet</p>
        </div>
      )}

      {data &&
        visibleSections.map((section) => {
          const sectionEntries = entries.filter((e) => e.kind === section.kind);
          if (sectionEntries.length === 0) return null;
          return (
            <section key={section.kind} className="space-y-3">
              <div className="flex items-center gap-2 pt-2">
                <span className="text-accent shrink-0">{section.icon}</span>
                <h3 className="font-display text-sm font-bold uppercase tracking-wide text-foreground">
                  {section.label}
                </h3>
                <span className="text-xs text-muted-foreground">{sectionEntries.length}</span>
                <span className="flex-1 h-px bg-border ml-1" />
              </div>
              <DayGroups entries={sectionEntries} seasonsFor={seasonsFor} />
            </section>
          );
        })}
    </div>
  );
}

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { fetchDigest } from '@/lib/api';
import { fromDigestDTO } from '@/types/digest';
import { SECTION_ORDER, allProviders, matchesFilters } from '@/lib/digest';
import { FiltersBar, type SectionFilter } from '@/components/release/FiltersBar';
import { SectionBlock } from '@/components/release/SectionBlock';
import { Toolbar } from '@/components/layout/Toolbar';
import { Segmented } from '@/components/ui/segmented';
import { useMediaScope } from '@/hooks/useMediaScope';
import { useRatings } from '@/hooks/useRatings';
import { formatDayMonthYear } from '@/lib/utils';
import { Loader2, PlayCircle, CalendarClock } from 'lucide-react';

type WindowKey = 'out_now' | 'coming_up';

const WINDOW_OPTIONS: { id: WindowKey; label: string; icon: React.ReactNode }[] = [
  { id: 'out_now', label: 'Out Now', icon: <PlayCircle size={13} /> },
  { id: 'coming_up', label: 'Coming Up', icon: <CalendarClock size={13} /> },
];

export default function Home() {
  const [params, setParams] = useSearchParams();
  const [mediaType] = useMediaScope();

  const windowKey: WindowKey = params.get('window') === 'coming_up' ? 'coming_up' : 'out_now';
  const section = (params.get('section') as SectionFilter) || 'all';
  // Comma-joined in the URL so a deep link can carry more than one platform
  // (e.g. ?platform=Netflix,Hulu) the same way the Calendar language filter does.
  const selectedPlatforms = useMemo(() => {
    const raw = params.get('platform');
    return raw ? raw.split(',').filter(Boolean) : [];
  }, [params]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['digest', 'current'],
    queryFn: fetchDigest,
    staleTime: 10 * 60_000,
  });

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === 'all' || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  function updatePlatforms(next: string[]) {
    const updated = new URLSearchParams(params);
    if (next.length === 0) updated.delete('platform');
    else updated.set('platform', next.join(','));
    setParams(updated, { replace: true });
  }

  const win = data?.[windowKey];

  // Every DTO in the current window, mapped exactly once per fetch.
  //
  // This used to run as four separate full traversals on *every* render — one
  // for the ratings batch, one for the platform list (over both windows), one
  // for the empty-state check, and one more inside the section map below — so
  // each filter click or URL change re-mapped ~80 items four times over before
  // React even began diffing.
  const sectionItems = useMemo(() => {
    if (!win) return null;
    const bySection = new Map<string, ReturnType<typeof fromDigestDTO>[]>();
    for (const [key, dtos] of Object.entries(win.sections)) {
      bySection.set(key, dtos.map(fromDigestDTO));
    }
    return bySection;
  }, [win]);

  // One batch ratings request for the whole window, not one per provider
  // group — see useRatings' own comment. Every section/provider grid below
  // shares this single lookup instead of each fetching its own subset.
  const allWindowItems = useMemo(
    () => (sectionItems ? [...sectionItems.values()].flat() : []),
    [sectionItems],
  );
  const ratingFor = useRatings(allWindowItems);

  // Stable identity so SectionBlock's props don't change on unrelated renders.
  const filters = useMemo(
    () => ({ mediaType, platform: selectedPlatforms }),
    [mediaType, selectedPlatforms],
  );

  // Spans both windows, so it depends on `data` rather than the selected
  // window — the platform dropdown shouldn't gain and lose options as you
  // toggle Out Now / Coming Up.
  const platforms = useMemo(
    () =>
      data
        ? allProviders([
            ...Object.values(data.out_now.sections).flat().map(fromDigestDTO),
            ...Object.values(data.coming_up.sections).flat().map(fromDigestDTO),
          ])
        : [],
    [data],
  );

  const visibleSections = useMemo(
    () => (section === 'all' ? SECTION_ORDER : SECTION_ORDER.filter((s) => s === section)),
    [section],
  );

  const anyResults = useMemo(
    () =>
      !!sectionItems &&
      visibleSections.some((s) =>
        (sectionItems.get(s) ?? []).some((item) => matchesFilters(item, filters)),
      ),
    [sectionItems, visibleSections, filters],
  );

  return (
    <div className="space-y-6">
      {/* Filters stay mounted through loading and error states, so the strip
          under the topbar never appears and disappears between fetches. */}
      <Toolbar>
        <FiltersBar
          section={section}
          onSectionChange={(s) => updateParam('section', s)}
          platform={selectedPlatforms}
          onPlatformChange={updatePlatforms}
          platforms={platforms}
          leading={
            <Segmented
              options={WINDOW_OPTIONS}
              value={windowKey}
              onChange={(w) => updateParam('window', w === 'out_now' ? '' : w)}
              aria-label="Release window"
            />
          }
        />
      </Toolbar>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-accent" size={28} />
        </div>
      )}

      {(error || (!isLoading && !data)) && (
        <p className="py-20 text-center text-sm text-muted-foreground">
          Could not load releases yet. The next scheduled run will populate this dashboard.
        </p>
      )}

      {data && win && (
        <>
          {/* "Generated ..." now lives in the sidebar (visible from every
              page); this line keeps just what's specific to the window being
              viewed on this page. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              {formatDayMonthYear(win.start) && formatDayMonthYear(win.end)
                ? `${formatDayMonthYear(win.start)} → ${formatDayMonthYear(win.end)}`
                : 'Release window dates unavailable'}
            </span>
          </div>

          <div className="space-y-8">
            {visibleSections.map((s) => (
              <SectionBlock
                key={s}
                section={s}
                items={sectionItems?.get(s) ?? []}
                filters={filters}
                linkBase="/title"
                ratingFor={ratingFor}
              />
            ))}
            {!anyResults && (
              <p className="py-16 text-center text-sm text-muted-foreground">Nothing found for this window yet.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

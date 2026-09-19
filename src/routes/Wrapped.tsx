import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Eye, Sparkles, Clock, Copy, Check, Hourglass } from 'lucide-react';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { useProviders, useRuntimes, useGenres } from '@/hooks/useProviders';
import { computeWrapped, wrappedSummary, MIN_TITLES_FOR_WRAPPED, type Tally } from '@/lib/wrapped';
import { formatRuntime } from '@/lib/format';
import { useDocumentMeta, siteUrl } from '@/hooks/useDocumentMeta';
import { staticRouteMeta } from '../../shared/seo';

/**
 * Your year on Spotlight.
 *
 * Computed in the browser from the watchlist the page already has, plus the
 * one providers batch it already knows how to make. No new table, no new
 * endpoint, nothing precomputed — a year in review behind a nightly job would
 * be wrong for anyone who saved something this morning.
 *
 * The page is deliberately quiet about what it does not know. Every block here
 * self-hides, so someone with four saved titles gets a short honest page
 * rather than a long one full of zeroes and em-dashes.
 */
export default function Wrapped() {
  const wl = useWatchlistContext();
  const [copied, setCopied] = useState(false);

  const all = useMemo(
    () => [...wl.watchlist, ...wl.watchLater, ...wl.watched],
    [wl.watchlist, wl.watchLater, wl.watched],
  );

  // One batch over everything, so the three lookups below share a single
  // request (they use the same TanStack query key on purpose).
  const platformsFor = useProviders(all);
  const runtimeFor = useRuntimes(all);
  const genresFor = useGenres(all);

  const stats = useMemo(
    () =>
      computeWrapped({
        watchlist: wl.watchlist,
        watchLater: wl.watchLater,
        watched: wl.watched,
        runtimeFor,
        genresFor,
        platformsFor,
      }),
    [wl.watchlist, wl.watchLater, wl.watched, runtimeFor, genresFor, platformsFor],
  );

  useDocumentMeta(staticRouteMeta('/wrapped', siteUrl()));

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(`${wrappedSummary(stats)} ${siteUrl()}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied outright in some browsers and over http.
      // Say so rather than leaving a button that silently does nothing.
      toast.error('Could not copy', { description: 'Your browser blocked clipboard access.' });
    }
  }

  const hours = Math.round(stats.minutesFromFilms / 60);

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Your year</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-foreground">Spotlight {stats.year}</h1>
      </header>

      {stats.sparse ? (
        <NotEnoughYet saved={all.length} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Saved" value={String(stats.savedThisYear)} hint={`in ${stats.year}`} />
            <Stat label="Watched" value={String(stats.seenThisYear)} hint="marked seen" />
            {hours > 0 && <Stat label="Hours of film" value={String(hours)} hint="from runtimes" />}
            {stats.seriesSeen > 0 && (
              <Stat
                label="Series"
                value={String(stats.seriesSeen)}
                // Series are counted, never converted to hours: marking a show
                // seen says you have seen it, not how many episodes you
                // watched this year. See src/lib/wrapped.ts.
                hint="not counted in hours"
              />
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <TallyCard title="Genres" icon={<Sparkles size={14} />} tallies={stats.topGenres} />
            <TallyCard title="Languages" icon={<Sparkles size={14} />} tallies={stats.topLanguages} />
            <TallyCard title="Platforms" icon={<Sparkles size={14} />} tallies={stats.topPlatforms} />
          </div>

          {(stats.busiestMonth || stats.longestFilm || stats.oldestUnwatched) && (
            <div className="grid gap-2 sm:grid-cols-3">
              {stats.busiestMonth && (
                <Note
                  icon={<Sparkles size={14} />}
                  label="Busiest month"
                  headline={stats.busiestMonth.label}
                  detail={`${stats.busiestMonth.count} titles saved`}
                />
              )}
              {stats.longestFilm && (
                <Note
                  icon={<Clock size={14} />}
                  label="Longest sitting"
                  headline={stats.longestFilm.title}
                  detail={formatRuntime(stats.longestFilm.minutes) ?? ''}
                />
              )}
              {stats.oldestUnwatched && (
                <Note
                  icon={<Hourglass size={14} />}
                  label="Still waiting"
                  headline={stats.oldestUnwatched.title}
                  detail={
                    stats.oldestUnwatched.daysWaiting > 0
                      ? `saved ${stats.oldestUnwatched.daysWaiting} days ago`
                      : 'saved today'
                  }
                />
              )}
            </div>
          )}

          <div className="rounded-xl bg-card p-4 space-y-3">
            <p className="text-sm text-foreground/90 leading-relaxed">{wrappedSummary(stats)}</p>
            <button
              type="button"
              onClick={copySummary}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold hover:brightness-110 active:scale-95 transition-all"
            >
              {copied ? <Check size={13} strokeWidth={3} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The empty state, which most accounts will see first.
 *
 * It says what is missing and where to go, rather than showing a page of
 * zeroes. A year in review built on three titles is a list of three titles
 * with adjectives attached.
 */
function NotEnoughYet({ saved }: { saved: number }) {
  const remaining = MIN_TITLES_FOR_WRAPPED - saved;
  return (
    <div className="rounded-xl bg-card p-6 space-y-3">
      <p className="text-sm text-foreground">
        {saved === 0
          ? 'Nothing here yet.'
          : `${saved} ${saved === 1 ? 'title' : 'titles'} so far — ${remaining} more and there will be something worth reading.`}
      </p>
      <p className="text-sm text-muted-foreground leading-relaxed">
        This page is built from what you save and what you mark seen. The quickest way to fill it is the{' '}
        <Eye size={13} className="inline align-text-bottom" /> on any poster — tap it for anything you have already
        watched, no need to add it to a list first.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          to="/browse"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold hover:brightness-110 active:scale-95 transition-all"
        >
          Browse titles
        </Link>
        <Link
          to="/list/watched"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-card-hover active:scale-95 transition-all"
        >
          <Eye size={12} /> What you have seen
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-card px-3 py-3">
      <p className="font-display text-2xl font-bold text-foreground leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {hint && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</p>}
    </div>
  );
}

/** Self-hiding: a reader with no platform data should see two cards, not three
 *  with one of them apologising. */
function TallyCard({ title, icon, tallies }: { title: string; icon: React.ReactNode; tallies: Tally[] }) {
  if (tallies.length === 0) return null;
  const max = tallies[0].count;

  return (
    <div className="rounded-xl bg-card p-3 space-y-2">
      <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="text-accent">{icon}</span>
        {title}
      </p>
      <ul className="space-y-1.5">
        {tallies.map((tally) => (
          <li key={tally.label}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-foreground truncate">{tally.label}</span>
              <span className="text-[11px] text-muted-foreground shrink-0">{tally.count}</span>
            </div>
            {/* Proportional to the leader rather than to the total: with three
                genres at 4, 3 and 3 a share-of-total bar is three near-identical
                stubs, which says less than the numbers beside it. */}
            <div className="mt-1 h-1 rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(tally.count / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Note({
  icon,
  label,
  headline,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  headline: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl bg-card p-3">
      <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="text-accent">{icon}</span>
        {label}
      </p>
      <p className="mt-1.5 text-sm font-medium text-foreground line-clamp-2 leading-tight">{headline}</p>
      {detail && <p className="text-[11px] text-muted-foreground mt-0.5">{detail}</p>}
    </div>
  );
}

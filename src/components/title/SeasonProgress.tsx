import { Check, RotateCcw, Tv } from 'lucide-react';
import {
  watchableSeasons,
  nextEpisode,
  isComplete,
  episodesWatched,
  totalEpisodes,
  progressPercent,
  formatProgress,
  clampProgress,
  type SeasonSummary,
  type Progress,
} from '@/lib/progress';

interface SeasonProgressProps {
  seasons: SeasonSummary[];
  progress: Progress | null;
  /** Jump to an exact position, or clear it with a null season. */
  onSet: (season: number | null, episode?: number) => void;
  /** "Watched the next one." Separate from onSet because it must resolve the
   *  next episode against the freshest pointer, not against the one this
   *  component last rendered — see useWatchlist.advanceProgress. */
  onAdvance: () => void;
}

/**
 * Where you are in a series, and one button to move.
 *
 * The primary action is deliberately a single "watched the next one" rather
 * than a season picker and an episode picker. Someone following a show
 * finishes one episode at a time, and the common case should be one tap, not
 * two dropdowns. The dropdowns exist too, because the *other* common case is
 * arriving at a show you are already four seasons into and needing to say so
 * once.
 *
 * Nothing here is a claim about what you enjoyed. It is a bookmark.
 */
export function SeasonProgress({ seasons, progress, onSet, onAdvance }: SeasonProgressProps) {
  const watchable = watchableSeasons(seasons);
  // A show TMDB has no episode counts for — an announced series, or one with
  // only specials listed. There is no position to occupy, so the whole block
  // stays out of the way rather than rendering a control that cannot move.
  if (watchable.length === 0) return null;

  const current = clampProgress(seasons, progress);
  const next = nextEpisode(seasons, current);
  const done = isComplete(seasons, current);
  const watched = episodesWatched(seasons, current);
  const total = totalEpisodes(seasons);
  const percent = progressPercent(seasons, current);

  const seasonOf = (n: number) => watchable.find((s) => s.seasonNumber === n) ?? watchable[0];

  return (
    <section className="px-1">
      <div className="rounded-xl bg-card p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="text-accent">
              <Tv size={14} />
            </span>
            Your progress
          </p>
          <p className="text-[11px] text-muted-foreground shrink-0">
            {watched} of {total} episodes
          </p>
        </div>

        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${done ? 'bg-watched' : 'bg-accent'}`}
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {done ? (
            <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-watched/20 text-watched text-xs font-semibold">
              <Check size={13} strokeWidth={3} /> Finished
            </span>
          ) : (
            <button
              type="button"
              onClick={onAdvance}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold hover:brightness-110 active:scale-95 transition-all"
            >
              <Check size={13} strokeWidth={3} />
              {current ? `Watched ${formatProgress(next)}` : `Start — ${formatProgress(next)}`}
            </button>
          )}

          {current && (
            <button
              type="button"
              onClick={() => onSet(null)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-card-hover active:scale-95 transition-all"
            >
              <RotateCcw size={12} /> Reset
            </button>
          )}

          {/* The "I am already four seasons in" path. Changing the season
              lands on its first episode rather than keeping the old episode
              number, which would silently claim you had watched nine episodes
              of a season you just switched to. */}
          <div className="flex items-center gap-1.5 ml-auto">
            <label className="sr-only" htmlFor="progress-season">
              Season
            </label>
            <select
              id="progress-season"
              value={current?.season ?? ''}
              onChange={(e) => onSet(Number(e.target.value), 1)}
              className="rounded-lg bg-secondary text-secondary-foreground text-xs px-2 py-1.5 border-0"
            >
              <option value="" disabled>
                Season
              </option>
              {watchable.map((s) => (
                <option key={s.seasonNumber} value={s.seasonNumber}>
                  Season {s.seasonNumber}
                </option>
              ))}
            </select>

            {current && (
              <>
                <label className="sr-only" htmlFor="progress-episode">
                  Episode
                </label>
                <select
                  id="progress-episode"
                  value={current.episode}
                  onChange={(e) => onSet(current.season, Number(e.target.value))}
                  className="rounded-lg bg-secondary text-secondary-foreground text-xs px-2 py-1.5 border-0"
                >
                  {Array.from({ length: seasonOf(current.season).episodeCount }, (_, i) => i + 1).map((ep) => (
                    <option key={ep} value={ep}>
                      Episode {ep}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

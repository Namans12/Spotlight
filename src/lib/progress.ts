/**
 * Where you are in a series.
 *
 * The watched bucket is binary, and television is not. Marking Breaking Bad
 * seen says "I have finished this show"; it has nothing to say about someone
 * three episodes into season two, which is the state most people are in for
 * most of the shows they care about.
 *
 * Progress is stored as a single pointer — the last episode you watched — not
 * as a tick per episode. A pointer answers every question this app actually
 * asks ("what do I put on next", "how much is left", "am I done") with one row
 * per show, and people watch television in order. Per-episode ticks would be
 * the right model for a service that also wants to know you skipped 4x07, and
 * this is not that.
 *
 * Absence of a row means "not started". There is deliberately no zero pointer:
 * `{season: 1, episode: 0}` would mean "started season one, watched none of
 * it", which is the same thing as not having started.
 */

/** One season, as TMDB describes it on the /tv/{id} payload the detail page
 *  already fetches. */
export interface SeasonSummary {
  seasonNumber: number;
  episodeCount: number;
  airDate: string | null;
  name: string;
}

/** The last episode watched. */
export interface Progress {
  season: number;
  episode: number;
}

/**
 * The seasons progress may point at, in order.
 *
 * Two exclusions, both load-bearing:
 *
 * Season 0 is TMDB's "Specials" — Breaking Bad has nine of them — and it is
 * excluded from TMDB's own `number_of_seasons`. Treating it as a season makes
 * every subsequent number wrong and, worse, makes "next episode after the
 * season one finale" resolve to a special rather than to S2E1.
 *
 * A season with no episodes is an announced-but-unaired one. TMDB lists those
 * ahead of time, and advancing into one strands the pointer somewhere the
 * reader can never watch their way out of.
 */
export function watchableSeasons(seasons: SeasonSummary[]): SeasonSummary[] {
  return seasons
    .filter((season) => season.seasonNumber > 0 && season.episodeCount > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
}

export function totalEpisodes(seasons: SeasonSummary[]): number {
  return watchableSeasons(seasons).reduce((sum, season) => sum + season.episodeCount, 0);
}

/**
 * Pulls a stored pointer back into range.
 *
 * Progress is written once and read forever, while the show underneath it
 * keeps changing: seasons get added, TMDB corrects an episode count, and a
 * pointer saved last year can end up addressing an episode that no longer
 * exists. Every read goes through this rather than trusting the stored value,
 * so a stale row degrades to the nearest sensible episode instead of rendering
 * "S7 E12" for a five-season show.
 *
 * Returns null when there is nothing to point at — no seasons, or a pointer
 * that was never valid.
 */
export function clampProgress(seasons: SeasonSummary[], progress: Progress | null): Progress | null {
  const watchable = watchableSeasons(seasons);
  if (!progress || watchable.length === 0) return null;

  // A pointer at or below the specials is treated as "start of the show"
  // rather than discarded: someone who marked a special has still started.
  const season = watchable.find((s) => s.seasonNumber === progress.season) ?? null;
  if (!season) {
    if (progress.season < watchable[0].seasonNumber) {
      return { season: watchable[0].seasonNumber, episode: 1 };
    }
    const last = watchable[watchable.length - 1];
    return { season: last.seasonNumber, episode: last.episodeCount };
  }

  return { season: season.seasonNumber, episode: Math.min(Math.max(1, progress.episode), season.episodeCount) };
}

/** Episodes watched, counting every earlier season in full. */
export function episodesWatched(seasons: SeasonSummary[], progress: Progress | null): number {
  const watchable = watchableSeasons(seasons);
  const clamped = clampProgress(seasons, progress);
  if (!clamped) return 0;

  let total = 0;
  for (const season of watchable) {
    if (season.seasonNumber < clamped.season) total += season.episodeCount;
    else if (season.seasonNumber === clamped.season) total += clamped.episode;
  }
  return total;
}

/**
 * What to put on next, or null when the show is finished.
 *
 * `null` progress means not started, so the answer is the very first episode —
 * which is what makes this usable as a "start watching" action as well as a
 * "continue" one.
 */
export function nextEpisode(seasons: SeasonSummary[], progress: Progress | null): Progress | null {
  const watchable = watchableSeasons(seasons);
  if (watchable.length === 0) return null;

  const clamped = clampProgress(seasons, progress);
  if (!clamped) return { season: watchable[0].seasonNumber, episode: 1 };

  const index = watchable.findIndex((s) => s.seasonNumber === clamped.season);
  const season = watchable[index];

  if (clamped.episode < season.episodeCount) {
    return { season: season.seasonNumber, episode: clamped.episode + 1 };
  }
  // Season finale. Roll into the next season that actually has episodes —
  // watchableSeasons has already dropped the announced-but-empty ones, so the
  // next entry is genuinely watchable.
  const following = watchable[index + 1];
  return following ? { season: following.seasonNumber, episode: 1 } : null;
}

export function isComplete(seasons: SeasonSummary[], progress: Progress | null): boolean {
  if (watchableSeasons(seasons).length === 0) return false;
  return progress !== null && nextEpisode(seasons, progress) === null;
}

export function remainingEpisodes(seasons: SeasonSummary[], progress: Progress | null): number {
  return Math.max(0, totalEpisodes(seasons) - episodesWatched(seasons, progress));
}

/** 0-100. Zero when nothing is known, so a caller can hide the bar rather than
 *  render a full one for a show with no season data. */
export function progressPercent(seasons: SeasonSummary[], progress: Progress | null): number {
  const total = totalEpisodes(seasons);
  if (total === 0) return 0;
  return Math.round((episodesWatched(seasons, progress) / total) * 100);
}

/** "S2 E4" — the shorthand every TV app uses, and short enough for a card. */
export function formatProgress(progress: Progress | null): string | null {
  return progress ? `S${progress.season} E${progress.episode}` : null;
}

/**
 * The one line a card shows.
 *
 * Deliberately phrased as an instruction rather than as a statistic: "Next:
 * S2 E1" tells you what to do, "42% complete" tells you about yourself.
 */
export function progressLabel(seasons: SeasonSummary[], progress: Progress | null): string | null {
  if (watchableSeasons(seasons).length === 0) return null;
  if (isComplete(seasons, progress)) return 'Finished';

  const next = nextEpisode(seasons, progress);
  if (!next) return null;
  if (!progress) return null; // Not started: the card says nothing rather than nagging.

  const left = remainingEpisodes(seasons, progress);
  return `Next: ${formatProgress(next)} · ${left} left`;
}

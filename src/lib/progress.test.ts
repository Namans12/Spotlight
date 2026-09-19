import { describe, it, expect } from 'vitest';
import {
  watchableSeasons,
  totalEpisodes,
  clampProgress,
  episodesWatched,
  nextEpisode,
  isComplete,
  remainingEpisodes,
  progressPercent,
  formatProgress,
  progressLabel,
  type SeasonSummary,
} from './progress';

function season(seasonNumber: number, episodeCount: number, airDate: string | null = '2010-01-01'): SeasonSummary {
  return { seasonNumber, episodeCount, airDate, name: seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}` };
}

// Breaking Bad exactly as TMDB describes it: nine specials at season 0, then
// five real seasons of 7, 13, 13, 13 and 16. number_of_seasons is 5, which is
// the whole reason season 0 cannot be treated as a season.
const BREAKING_BAD = [season(0, 9), season(1, 7), season(2, 13), season(3, 13), season(4, 13), season(5, 16)];

describe('watchableSeasons', () => {
  it('excludes the specials season', () => {
    expect(watchableSeasons(BREAKING_BAD).map((s) => s.seasonNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  // TMDB lists announced seasons before they have any episodes. Advancing into
  // one strands the pointer somewhere the reader cannot watch their way out of.
  it('excludes an announced season that has no episodes yet', () => {
    const airing = [season(1, 8), season(2, 8), season(3, 0, '2027-01-01')];
    expect(watchableSeasons(airing).map((s) => s.seasonNumber)).toEqual([1, 2]);
  });

  it('sorts by season number rather than trusting the payload order', () => {
    expect(watchableSeasons([season(3, 5), season(1, 5), season(2, 5)]).map((s) => s.seasonNumber)).toEqual([1, 2, 3]);
  });

  it('has nothing to offer for a show with no seasons', () => {
    expect(watchableSeasons([])).toEqual([]);
  });
});

describe('totalEpisodes', () => {
  it('counts the real seasons and not the specials', () => {
    // 7 + 13 + 13 + 13 + 16 = 62, which is Breaking Bad's actual run.
    expect(totalEpisodes(BREAKING_BAD)).toBe(62);
  });
});

describe('nextEpisode', () => {
  it('starts a show that has not been started', () => {
    expect(nextEpisode(BREAKING_BAD, null)).toEqual({ season: 1, episode: 1 });
  });

  it('advances within a season', () => {
    expect(nextEpisode(BREAKING_BAD, { season: 2, episode: 4 })).toEqual({ season: 2, episode: 5 });
  });

  // The bug this whole module exists to avoid: after the season one finale the
  // next episode is S2E1, never a special.
  it('rolls over a season finale into the next season, not into the specials', () => {
    expect(nextEpisode(BREAKING_BAD, { season: 1, episode: 7 })).toEqual({ season: 2, episode: 1 });
  });

  it('skips an empty season when rolling over', () => {
    const gappy = [season(1, 6), season(2, 0, '2027-01-01'), season(3, 6)];
    expect(nextEpisode(gappy, { season: 1, episode: 6 })).toEqual({ season: 3, episode: 1 });
  });

  // Running off the end would produce a season six of a five-season show.
  it('reports nothing after the final episode', () => {
    expect(nextEpisode(BREAKING_BAD, { season: 5, episode: 16 })).toBeNull();
  });

  it('reports nothing for a show with no watchable seasons', () => {
    expect(nextEpisode([season(0, 9)], null)).toBeNull();
  });
});

describe('clampProgress', () => {
  it('leaves a valid pointer alone', () => {
    expect(clampProgress(BREAKING_BAD, { season: 3, episode: 5 })).toEqual({ season: 3, episode: 5 });
  });

  // A pointer is written once and read forever, while the show underneath it
  // keeps changing. A stale row must degrade, not render "S7 E12".
  it('pulls a pointer past the last season back to the finale', () => {
    expect(clampProgress(BREAKING_BAD, { season: 9, episode: 3 })).toEqual({ season: 5, episode: 16 });
  });

  it('pulls an episode past the end of its season back to the finale of that season', () => {
    expect(clampProgress(BREAKING_BAD, { season: 1, episode: 99 })).toEqual({ season: 1, episode: 7 });
  });

  // Marking a special still means you have started the show.
  it('treats a pointer at the specials as the start of season one', () => {
    expect(clampProgress(BREAKING_BAD, { season: 0, episode: 4 })).toEqual({ season: 1, episode: 1 });
  });

  it('refuses a zero episode, which is the same as not having started', () => {
    expect(clampProgress(BREAKING_BAD, { season: 2, episode: 0 })).toEqual({ season: 2, episode: 1 });
  });

  it('is null when there is nothing to point at', () => {
    expect(clampProgress([], { season: 1, episode: 1 })).toBeNull();
    expect(clampProgress(BREAKING_BAD, null)).toBeNull();
  });
});

describe('episodesWatched', () => {
  it('counts every earlier season in full', () => {
    // All of season 1 (7) plus four of season 2.
    expect(episodesWatched(BREAKING_BAD, { season: 2, episode: 4 })).toBe(11);
  });

  it('counts nothing for a show not started', () => {
    expect(episodesWatched(BREAKING_BAD, null)).toBe(0);
  });

  it('never counts the specials toward the total', () => {
    expect(episodesWatched(BREAKING_BAD, { season: 1, episode: 1 })).toBe(1);
  });

  it('counts the whole run at the finale', () => {
    expect(episodesWatched(BREAKING_BAD, { season: 5, episode: 16 })).toBe(62);
  });
});

describe('isComplete', () => {
  it('is true at the final episode', () => {
    expect(isComplete(BREAKING_BAD, { season: 5, episode: 16 })).toBe(true);
  });

  it('is false one episode short', () => {
    expect(isComplete(BREAKING_BAD, { season: 5, episode: 15 })).toBe(false);
  });

  it('is false for a show never started', () => {
    expect(isComplete(BREAKING_BAD, null)).toBe(false);
  });

  // Otherwise a show whose seasons failed to load reads as finished, which is
  // the most misleading thing this page could say.
  it('is false when nothing is known about the seasons', () => {
    expect(isComplete([], { season: 1, episode: 1 })).toBe(false);
  });
});

describe('remainingEpisodes and progressPercent', () => {
  it('reports what is left', () => {
    expect(remainingEpisodes(BREAKING_BAD, { season: 2, episode: 4 })).toBe(51);
    expect(remainingEpisodes(BREAKING_BAD, null)).toBe(62);
    expect(remainingEpisodes(BREAKING_BAD, { season: 5, episode: 16 })).toBe(0);
  });

  it('reports a percentage of the real run', () => {
    expect(progressPercent(BREAKING_BAD, { season: 5, episode: 16 })).toBe(100);
    expect(progressPercent(BREAKING_BAD, null)).toBe(0);
    // 11 of 62.
    expect(progressPercent(BREAKING_BAD, { season: 2, episode: 4 })).toBe(18);
  });

  it('reports zero rather than dividing by nothing', () => {
    expect(progressPercent([], { season: 1, episode: 1 })).toBe(0);
  });
});

describe('labels', () => {
  it('formats a pointer the way every TV app does', () => {
    expect(formatProgress({ season: 2, episode: 4 })).toBe('S2 E4');
    expect(formatProgress(null)).toBeNull();
  });

  // Phrased as an instruction, not a statistic: "Next: S2 E5" tells you what to
  // do, "18% complete" tells you about yourself.
  it('tells you what to put on next', () => {
    expect(progressLabel(BREAKING_BAD, { season: 2, episode: 4 })).toBe('Next: S2 E5 · 51 left');
  });

  it('says so when the show is done', () => {
    expect(progressLabel(BREAKING_BAD, { season: 5, episode: 16 })).toBe('Finished');
  });

  it('says nothing at all about a show not started', () => {
    expect(progressLabel(BREAKING_BAD, null)).toBeNull();
  });

  it('says nothing about a show with no season data', () => {
    expect(progressLabel([], { season: 1, episode: 1 })).toBeNull();
  });
});

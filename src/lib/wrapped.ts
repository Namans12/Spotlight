import type { WatchlistItem } from '@/types/movie';
import { languageName } from '@/lib/languages';

/**
 * Your year on Spotlight.
 *
 * Everything here is derived from rows the app already has — watchlist_items
 * carries the date each title was saved, its media type and its language, and
 * the providers batch hands back runtime and genre for free. There is no new
 * table and nothing is precomputed: a year in review that needed a nightly job
 * would be wrong for anyone who saved something this morning.
 *
 * Two rules run through the whole file.
 *
 * The first is that every number has to be *true*. It is tempting to report
 * "142 hours watched" by multiplying a series' episode length by its episode
 * count, but nobody told us how much of it was watched — marking Breaking Bad
 * seen says "I have seen this show", not "I watched 62 episodes this year".
 * So hours are counted from films only, and series are reported as a count of
 * series. A smaller honest number beats a bigger invented one.
 *
 * The second is that this has to work for someone with four saved titles, not
 * only for someone with four hundred. Most stats here degrade to null rather
 * than to zero, and the page omits what is null. "Top genre: —" is worse than
 * no top genre at all.
 */

export interface WrappedInput {
  watchlist: WatchlistItem[];
  watchLater: WatchlistItem[];
  watched: WatchlistItem[];
  /** From fetchProvidersBatch — keyed "movie:920". */
  runtimeFor: (mediaType: string, tmdbId: number) => number | undefined;
  genresFor: (mediaType: string, tmdbId: number) => string[] | undefined;
  platformsFor: (mediaType: string, tmdbId: number) => string[] | undefined;
  /** Injected so the year boundary is testable and so a page rendered at
   *  23:59 on 31 December does not disagree with itself. */
  now?: Date;
}

export interface Tally {
  label: string;
  count: number;
}

export interface WrappedStats {
  year: number;
  /** Saved at any point this year, across every bucket. */
  savedThisYear: number;
  /** Marked seen. Not necessarily saved this year — you can mark a film you
   *  saw in March, and that still belongs in your year. */
  seenThisYear: number;
  /** Films only, in minutes. See the note above on why series are excluded. */
  minutesFromFilms: number;
  seriesSeen: number;
  topGenres: Tally[];
  topLanguages: Tally[];
  topPlatforms: Tally[];
  /** The month you saved the most in, when one month genuinely leads. */
  busiestMonth: { label: string; count: number } | null;
  longestFilm: { title: string; minutes: number } | null;
  /** Saved longest ago and still not seen — the one the list is quietly
   *  holding over you. Null when everything saved has been watched. */
  oldestUnwatched: { title: string; savedAt: number; daysWaiting: number } | null;
  /** True when there is too little here to say anything worth reading. */
  sparse: boolean;
}

/** Below this, a year in review is a list of three films with adjectives
 *  attached. The page shows an explanation instead of a verdict. */
export const MIN_TITLES_FOR_WRAPPED = 5;

/** How many entries a tally needs before it means anything. One title in a
 *  genre is not a taste, it is a title. */
const MIN_TALLY = 1;
const TOP_N = 3;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function inYear(epochMs: number, year: number): boolean {
  return new Date(epochMs).getFullYear() === year;
}

/** Descending by count, then alphabetical so the order is stable between
 *  renders rather than depending on Map insertion. */
function topTallies(counts: Map<string, number>, limit = TOP_N): Tally[] {
  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_TALLY)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function bump(counts: Map<string, number>, label: string) {
  counts.set(label, (counts.get(label) ?? 0) + 1);
}

export function computeWrapped(input: WrappedInput): WrappedStats {
  const now = input.now ?? new Date();
  const year = now.getFullYear();

  const all = [...input.watchlist, ...input.watchLater, ...input.watched];
  const savedThisYear = all.filter((item) => inYear(item.addedAt, year));
  const seen = input.watched;

  const genres = new Map<string, number>();
  const languages = new Map<string, number>();
  const platforms = new Map<string, number>();
  const months = new Map<number, number>();

  // Taste is read from everything saved this year, not only from what was
  // finished: deciding to save a Korean thriller is a statement about taste
  // whether or not you got round to it.
  for (const item of savedThisYear) {
    for (const genre of input.genresFor(item.mediaType, item.id) ?? []) bump(genres, genre);

    const language = languageName(item.originalLanguage);
    if (language) bump(languages, language);

    // Only the primary platform. A title carried by four services would
    // otherwise cast four votes and drown out one carried by a single
    // service, which says nothing about where the reader actually watches.
    const platform = (input.platformsFor(item.mediaType, item.id) ?? [])[0];
    // Purchase-only listings are tagged "(Buy/Rent)" by resolveProviders and
    // are not somewhere you subscribe, so they do not count as "your
    // platform" — see lib/tmdbProxy.ts.
    if (platform && !platform.includes('Buy/Rent')) bump(platforms, platform);

    const month = new Date(item.addedAt).getMonth();
    months.set(month, (months.get(month) ?? 0) + 1);
  }

  let minutesFromFilms = 0;
  let seriesSeen = 0;
  let longestFilm: WrappedStats['longestFilm'] = null;

  for (const item of seen) {
    if (item.mediaType === 'tv') {
      seriesSeen += 1;
      continue;
    }
    const minutes = input.runtimeFor(item.mediaType, item.id);
    if (!minutes) continue;
    minutesFromFilms += minutes;
    if (!longestFilm || minutes > longestFilm.minutes) {
      longestFilm = { title: item.title, minutes };
    }
  }

  const seenKeys = new Set(seen.map((item) => `${item.mediaType}:${item.id}`));
  const unwatched = [...input.watchlist, ...input.watchLater]
    .filter((item) => !seenKeys.has(`${item.mediaType}:${item.id}`))
    .sort((a, b) => a.addedAt - b.addedAt);

  const oldest = unwatched[0];
  const oldestUnwatched = oldest
    ? {
        title: oldest.title,
        savedAt: oldest.addedAt,
        daysWaiting: Math.max(0, Math.floor((now.getTime() - oldest.addedAt) / 86_400_000)),
      }
    : null;

  // A "busiest month" needs a month that actually stands out. With one title
  // in each of three months, every month is the busiest and the stat is noise.
  const monthEntries = [...months.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const busiestMonth =
    monthEntries.length > 0 && monthEntries[0][1] > 1
      ? { label: MONTHS[monthEntries[0][0]], count: monthEntries[0][1] }
      : null;

  return {
    year,
    savedThisYear: savedThisYear.length,
    seenThisYear: seen.length,
    minutesFromFilms,
    seriesSeen,
    topGenres: topTallies(genres),
    topLanguages: topTallies(languages),
    topPlatforms: topTallies(platforms),
    busiestMonth,
    longestFilm,
    oldestUnwatched,
    sparse: all.length < MIN_TITLES_FOR_WRAPPED,
  };
}

/**
 * The one-paragraph version, for the clipboard.
 *
 * Built from the same stats rather than from a second pass over the data, so
 * the text someone pastes into a group chat cannot say something the page on
 * their screen does not.
 */
/** "A, B and C" — not "A and B and C", which is what joining three items with
 *  " and " produces. shared/seo.ts carries its own copy of this: `shared` is
 *  imported by both the server and the browser and cannot import from `src`,
 *  so the duplication is the module boundary rather than an oversight. */
function sentenceList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function wrappedSummary(stats: WrappedStats): string {
  const parts: string[] = [`My ${stats.year} on Spotlight:`];

  // Saved before watched, and joined into one clause. "2 titles watched. 3
  // saved." reads as five titles — the watched ones are a subset of the
  // saved ones, and the sentence has to make that obvious.
  const counts: string[] = [];
  if (stats.savedThisYear > 0) {
    counts.push(`${stats.savedThisYear} ${stats.savedThisYear === 1 ? 'title' : 'titles'} saved`);
  }
  if (stats.seenThisYear > 0) counts.push(`${stats.seenThisYear} watched`);
  if (counts.length > 0) {
    const hours = Math.round(stats.minutesFromFilms / 60);
    const hoursClause = hours > 0 ? ` — about ${hours} ${hours === 1 ? 'hour' : 'hours'} of film` : '';
    parts.push(`${counts.join(', ')}${hoursClause}.`);
  }
  if (stats.topGenres.length > 0) parts.push(`Mostly ${sentenceList(stats.topGenres.map((g) => g.label))}.`);
  if (stats.topLanguages.length > 0) parts.push(`In ${sentenceList(stats.topLanguages.map((l) => l.label))}.`);
  if (stats.oldestUnwatched && stats.oldestUnwatched.daysWaiting > 30) {
    parts.push(`${stats.oldestUnwatched.title} has been waiting ${stats.oldestUnwatched.daysWaiting} days.`);
  }

  return parts.join(' ');
}

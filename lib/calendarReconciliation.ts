/** Individually reviewed editorial observations. Match the complete original
 * identity, including provenance, so a later ingestion cannot inherit a stale
 * decision merely by reusing a TMDB id. Dates are announcements, not offers. */
export function reviewedCalendarEntry(row: {
  origin: string; tmdb_id: number | null; media_type: string | null;
  title: string; release_date: string; source_url: string | null;
  event_region: string | null; evidence: unknown;
}) {
  if (row.origin !== 'csv_seed' || row.event_region != null || row.evidence != null) return null;
  if (Number(row.tmdb_id) === 84773 && row.media_type === 'tv' &&
      row.title === 'The Lord of the Rings: The Rings of Power' && row.release_date === '2026-11-11' &&
      row.source_url === 'https://deadline.com/feature/2026-tv-premiere-dates-1236391902/') {
    return {
      type: 'season' as const, season: 3, checkedAt: '2026-11-10',
      coverage: 'Prime Video announced a premiere in over 240 countries and territories',
      source: 'Amazon', sourceUrl: 'https://www.aboutamazon.com/news/entertainment/lord-of-the-rings-rings-of-power-season-3-prime-video',
    };
  }
  if (Number(row.tmdb_id) === 85077 && row.media_type === 'tv' && row.title === 'The Chosen' &&
      row.release_date === '2026-11-15' && row.source_url === 'https://deadline.com/feature/2026-tv-premiere-dates-1236391902/') {
    return { type: 'season' as const, season: 6, checkedAt: '2026-11-10',
      coverage: 'Prime Video announced a premiere in the US and selected international markets',
      source: 'The Chosen', sourceUrl: 'https://www.thechosen.tv/en-us/investor-overview/press-releases/season-six-of-the-global-hit-series-the-chosen-premieres-exclusively-on-prime-video-november-15-2026' };
  }
  const americanFilms = 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026';
  if (row.media_type === 'movie' && row.source_url === americanFilms) {
    const matches = [
      [1300968, 'The Hunger Games: Sunrise on the Reaping', '2026-11-20'],
      [1400336, 'Focker-in-Law', '2026-11-25'],
      [1538497, 'Hexed', '2026-11-25'],
      [1078446, 'Violent Night 2', '2026-12-04'],
      [1003596, 'Avengers: Doomsday', '2026-12-18'],
      [1300926, 'The Angry Birds Movie 3', '2026-12-23'],
    ];
    if (matches.some(([id, title, date]) => Number(row.tmdb_id) === id && row.title === title && row.release_date === date)) {
      return { type: 'corroboration' as const, checkedAt: '2026-11-10', source: 'Cinema United',
        sourceUrl: 'https://cinemaunited.org/release-calendar/',
        message: 'Listed on a North American wide theatrical release schedule; local date and availability remain unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1288211 && row.title === 'The Great Beyond' && row.release_date === '2026-11-13') {
      return { type: 'conflict' as const, checkedAt: '2026-11-10', source: 'TheWrap',
        sourceUrl: 'https://www.thewrap.com/creative-content/movies/jj-abrams-great-beyond-delayed-release-date/',
        message: 'Date needs review: industry reporting says the release moved from 13 November 2026 to 1 October 2027; this entry’s region is unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1280115 && row.title === 'Way of the Warrior Kid' && row.release_date === '2026-11-20') {
      return { type: 'conflict' as const, checkedAt: '2026-11-10', source: 'Apple TV Press',
        sourceUrl: 'https://www.apple.com/tv-pr/originals/way-of-the-warrior-kid/',
        message: 'Date needs review: Apple lists a 25 November release. This entry’s region and release event remain unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1461490 && row.title === 'Hershey' && row.release_date === '2026-11-26') {
      return { type: 'conflict' as const, checkedAt: '2026-11-10', source: 'Angel Studios',
        sourceUrl: 'https://shop.angel.com/products/hershey-theatrical-ticket-preorder-now',
        message: 'Date needs review: Angel Studios lists 25 November in US theaters, while the North American exhibitor schedule lists 26 November. The event represented here is unconfirmed.' };
    }
  }
  if (Number(row.tmdb_id) === 1286656 && row.media_type === 'movie' &&
      row.title === 'I Play Rocky' && row.release_date === '2026-11-13' &&
      row.source_url === 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026') {
    return {
      type: 'conflict' as const, checkedAt: '2026-11-10', source: 'Amazon MGM Studios',
      sourceUrl: 'https://www.aboutamazon.com/news/entertainment/i-play-rocky-trailer-cast-release-date-amazon-mgm-studios',
      message: 'Date needs review: the studio reported the film already in select theaters on 6 November. This entry’s region and release event remain unconfirmed.',
    };
  }
  return null;
}

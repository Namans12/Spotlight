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
      source: 'Amazon', sourceUrl: 'https://www.aboutamazon.com/news/entertainment/lord-of-the-rings-rings-of-power-season-3-prime-video',
    };
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

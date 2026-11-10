/** A TMDB observation proves a fact about that TMDB ID, not that a separately
 * sourced editorial record was matched to the correct title. Legacy rechecks
 * did not persist independent identity evidence for these sources. */
export function hasUnverifiedEditorialTmdbIdentity(origin: string, evidence: unknown): boolean {
  if (!['wikipedia', 'csv_seed', 'district_in'].includes(origin) || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  const source = (evidence as Record<string, unknown>).date_source;
  return source === 'tmdb_regional_theatrical' || source === 'tmdb_global_first_air';
}

/** Manual identity reviews are bound to the exact editorial record and TMDB
 * evidence. Names alone are insufficient; reviews cite matching cast/crew. */
export function reviewedEditorialTmdbIdentity(row: {
  origin: string; tmdb_id: number | null; media_type: string | null; title: string;
  language?: string | null; release_date: string; source_url: string | null;
  entry_type: string | null; evidence: unknown;
}) {
  if (row.origin !== 'wikipedia' || row.media_type !== 'movie' || row.entry_type !== 'Movie' ||
      !row.evidence || typeof row.evidence !== 'object' || Array.isArray(row.evidence)) return null;
  const evidence = row.evidence as Record<string, unknown>;
  if (evidence.date_source !== 'tmdb_regional_theatrical' || evidence.region !== 'IN' ||
      evidence.source_url !== `https://www.themoviedb.org/movie/${row.tmdb_id}`) return null;
  const matches = [
    { id: 1733518, title: 'Bouma', language: 'ml', date: '2026-11-12',
      sourceUrl: 'https://www.cinemaexpress.com/malayalam/news/2026/Oct/22/dileesh-pothan-starrer-bouma-gets-a-release-date',
      message: 'The editorial listing and TMDB agree on director Rejin S Babu and leads Dileesh Pothan, Vineeth and Sagar Surya.' },
    { id: 1445172, title: 'Dark Chocolate', language: 'te', date: '2026-11-13',
      sourceUrl: 'https://www.cinemaexpress.com/telugu/news/2026/Oct/26/vishwadev-rachakonda-dark-chocolate-is-a-film-you-will-want-to-watch-again-and-again',
      message: 'The editorial listing and TMDB agree on director Shashank Srivatsavaya and leads Vishwadev Rachakonda and Bindu Madhavi.' },
    { id: 1808841, title: 'Maya Lady', language: 'te', date: '2026-11-13',
      sourceUrl: 'https://www.cinemaexpress.com/telugu/news/2026/Oct/28/rakesh-varres-maya-lady-locks-november-release-date',
      message: 'The editorial listing and TMDB agree on leads Rakesh Varre and Madhumita Sarcar.' },
  ];
  const match = matches.find(item => Number(row.tmdb_id) === item.id && row.title === item.title && row.language === item.language &&
    row.release_date === item.date && row.source_url === `https://en.wikipedia.org/wiki/List_of_${item.language === 'ml' ? 'Malayalam' : 'Telugu'}_films_of_2026`);
  return match ? { source: 'Cinema Express', sourceUrl: match.sourceUrl, checkedAt: '2026-11-10T19:01:57Z', message: match.message } : null;
}

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
    { id: 1417808, title: 'Haindava', language: 'te', date: '2026-11-27', source: 'Telangana Today', checkedAt: '2026-11-10T19:05:44Z',
      sourceUrl: 'https://telanganatoday.com/haindava-teaser-unveiled-bellamkonda-sai-sreenivass-pan-indian-film-set-for-nov-27-release',
      message: 'The editorial listing and TMDB agree on director Ludheer Byreddy and leads Bellamkonda Sai Sreenivas and Samyuktha.' },
    { id: 1179380, title: 'Cosmic Samson', language: 'ml', date: '2026-11-27', checkedAt: '2026-11-10T19:05:44Z',
      sourceUrl: 'https://www.cinemaexpress.com/malayalam/news/2026/Oct/20/cosmic-samson-starring-sandeep-pradeep-gets-release-date',
      message: 'The editorial listing and TMDB agree on director Abhijith Joseph and lead Sandeep Pradeep.' },
    { id: 1654912, title: 'Mayan: Chapter 1', language: 'ml', date: '2026-12-03', source: 'Simply Mollywood', checkedAt: '2026-11-10T19:05:44Z',
      sourceUrl: 'https://simplymollywood.com/movies/december-2026-malayalam-releases-mayan-padayaatra-athimanoharam-iffk',
      message: 'The editorial listing and TMDB agree on director Jithin K Jose and lead Jayasurya.' },
    { id: 1504630, title: 'Mysaa', language: 'te', date: '2026-11-27', checkedAt: '2026-11-10T19:07:49Z',
      sourceUrl: 'https://www.cinemaexpress.com/telugu/news/2026/Sep/01/rashmika-mandannas-mysaa-gets-release-date',
      message: 'The editorial listing and TMDB agree on director Rawindra Pulle and lead Rashmika Mandanna.' },
    { id: 1713050, title: 'Alias Rukmini', language: 'te', date: '2026-12-04', source: 'Telangana Today', checkedAt: '2026-11-10T19:07:49Z',
      sourceUrl: 'https://telanganatoday.com/alias-rukmini-nithiins-new-look-unveiled-ahead-of-december-4-release',
      message: 'The editorial listing and TMDB agree on director Murali Kanth Devasoth and leads Nithiin and Aafiya Sayed.' },
    { id: 1436202, title: 'Legacy', language: 'te', date: '2026-12-04', source: 'The Times of India', checkedAt: '2026-11-10T19:07:49Z',
      sourceUrl: 'https://timesofindia.indiatimes.com/entertainment/telugu/movies/news/legacy-vishwak-sen-announces-december-4-release-date-for-political-action-drama-says-politics-is-personal/articleshow/133837154.cms',
      message: 'The editorial listing and TMDB agree on director Saikiran Reddy Daida and leads Vishwak Sen and Ekta Rathod.' },
    { id: 1395627, title: 'Vrushakarma', language: 'te', date: '2026-12-04', checkedAt: '2026-11-10T19:07:49Z',
      sourceUrl: 'https://www.cinemaexpress.com/telugu/news/2026/Sep/10/naga-chaitanyas-vrushakarma-confirms-december-release-date',
      message: 'The editorial listing and TMDB agree on director Karthik Varma Dandu and lead Naga Chaitanya.' },
    { id: 1505644, title: 'ENE Repeat', language: 'te', date: '2026-11-19', source: 'S Originals', checkedAt: '2026-11-10T19:10:03Z',
      sourceUrl: 'https://www.youtube.com/watch?v=Y4Zzy7SVLp4',
      message: 'The editorial listing and TMDB agree on director Tharun Bhascker and leads Vishwak Sen and Abhinav Gomatam; the producer also identifies them.' },
    { id: 1533928, title: "Bachelor Party D'eux", language: 'ml', date: '2026-11-19', source: 'Onmanorama', checkedAt: '2026-11-10T19:10:03Z',
      sourceUrl: 'https://www.onmanorama.com/entertainment/entertainment-news/2026/09/20/bachelor-party-deux-first-look-poster-amal-neerad-naslen.amp.html',
      message: 'The editorial listing and TMDB agree on director Amal Neerad and cast Naslen, Kunchacko Boban and Tovino Thomas.' },
    { id: 1704200, title: 'Hail Mary', language: 'ml', date: '2026-11-26', checkedAt: '2026-11-10T19:10:03Z',
      sourceUrl: 'https://www.cinemaexpress.com/malayalam/news/2026/Nov/05/kunchacko-bobans-hail-mary-gets-a-release-date',
      message: 'The editorial listing and TMDB agree on director Vishnu Revikumar and leads Kunchacko Boban and Suraj Venjaramoodu.' },
  ];
  const match = matches.find(item => Number(row.tmdb_id) === item.id && row.title === item.title && row.language === item.language &&
    row.release_date === item.date && row.source_url === `https://en.wikipedia.org/wiki/List_of_${item.language === 'ml' ? 'Malayalam' : 'Telugu'}_films_of_2026`);
  return match ? { source: match.source ?? 'Cinema Express', sourceUrl: match.sourceUrl, checkedAt: match.checkedAt ?? '2026-11-10T19:01:57Z', message: match.message } : null;
}

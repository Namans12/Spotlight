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
  entry_type: string | null; evidence: unknown; platform_or_distributor?: string | null;
}) {
  const seedMatches = [
    { id: 1170608, type: 'movie', entry: 'Movie', title: 'Dune: Part Three', language: 'en', date: '2026-12-18', source: 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026', distributor: 'Warner Bros. Pictures / Legendary Pictures', reference: 'https://www.youtube.com/watch?v=RXZhOVd5WWM', referenceName: 'Warner Bros.', message: 'The editorial listing and TMDB match director Denis Villeneuve and leads Timothée Chalamet and Zendaya. The editorial date is a North American schedule; the local event remains unconfirmed.' },
    { id: 1145110, type: 'movie', entry: 'Movie', title: 'King', language: 'hi', date: '2026-12-24', source: 'https://en.wikipedia.org/wiki/List_of_Hindi_films_of_2026', distributor: 'Red Chillies Entertainment, Marflix Pictures', reference: 'https://www.redchillies.com/news/marflix-pictures-and-red-chillies-entertainment-revealed-the-title-of-their-film-king-in-grand-style-on-shah-rukh-khans-birthday-with-an-action-packed-glimpse-unveiled-b', referenceName: 'Red Chillies Entertainment', message: 'The editorial listing and TMDB match director Siddharth Anand and lead Shah Rukh Khan. This identity review does not establish the local event.' },
    { id: 1260649, type: 'movie', entry: 'Movie', title: 'Jumanji: Open World', language: 'en', date: '2026-12-25', source: 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026', distributor: 'Columbia Pictures / Seven Bucks Productions', reference: 'https://jumanji.movie/', referenceName: 'Sony Pictures', message: 'The editorial listing and TMDB match director Jake Kasdan and leads Dwayne Johnson, Kevin Hart, Jack Black and Karen Gillan. The editorial date is a US schedule; the local event remains unconfirmed.' },
    { id: 249565, type: 'tv', entry: 'Show', title: 'The Good Daughter', language: 'en', date: '2026-11-12', source: 'https://deadline.com/feature/2026-tv-premiere-dates-1236391902/', distributor: 'Peacock', reference: 'https://www.peacocktv.com/stream-tv/the-good-daughter', referenceName: 'Peacock', message: 'The Peacock series and TMDB match stars Rose Byrne, Meghann Fahy and Brendan Gleeson. The local premiere and availability remain unconfirmed.' },
  ];
  if (row.origin === 'csv_seed' && row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)) {
    const evidence = row.evidence as Record<string, unknown>;
    const match = seedMatches.find(item => Number(row.tmdb_id) === item.id && row.media_type === item.type && row.entry_type === item.entry &&
      row.title === item.title && row.language === item.language && row.release_date === item.date && row.source_url === item.source &&
      row.platform_or_distributor === item.distributor && evidence.source_url === `https://www.themoviedb.org/${item.type}/${item.id}` &&
      (item.type === 'movie' ? evidence.date_source === 'tmdb_regional_theatrical' && evidence.region === 'IN' : evidence.date_source === 'tmdb_global_first_air' && evidence.region == null));
    if (match) return { source: match.referenceName, sourceUrl: match.reference, checkedAt: '2026-11-10T19:19:12Z', message: match.message, identityOnly: true };
  }
  if (row.origin === 'district_in' && Number(row.tmdb_id) === 1739918 && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.title === 'Anna from Mexico' && row.language === 'kn' && row.release_date === '2026-12-24' &&
      row.source_url === 'https://www.district.in/movies/anna-from-mexico-movie-tickets-in-hyderabad-MV220211' &&
      row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)) {
    const evidence = row.evidence as Record<string, unknown>;
    if (evidence.date_source === 'tmdb_regional_theatrical' && evidence.region === 'IN' && evidence.source_url === 'https://www.themoviedb.org/movie/1739918')
      return { source: 'District / Cinema Express', sourceUrl: 'https://www.cinemaexpress.com/kannada/news/2026/Jul/30/dhananjayas-anna-from-mexico-locks-christmas-release',
        checkedAt: '2026-11-10T19:22:03Z', message: 'The Hyderabad listing and TMDB agree on director Shankar Guru and lead Dhananjaya. The listing announces 24 December; showtimes are unconfirmed.' };
  }
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
    { id: 1443139, title: 'Reality', language: 'te', date: '2026-12-25', source: 'The New Indian Express', checkedAt: '2026-11-10T19:12:41Z',
      sourceUrl: 'https://www.newindianexpress.com/entertainment/entertainment-news/2026/Oct/06/telugunews2026oct05kiran-abbavarams-directorial-debut-titled-reality-locks-release-date',
      message: 'The editorial listing and TMDB agree on actor-director Kiran Abbavaram and cast members Sai Kumar and Rohini.' },
    { id: 1370456, title: 'Mahakāli', language: 'te', date: '2027-01-08', source: 'The Hollywood Reporter India', checkedAt: '2026-11-10T19:12:41Z',
      sourceUrl: 'https://www.hollywoodreporterindia.com/features/insight/mahakali-teaser-akshaye-khannas-shukracharya-sriya-reddys-mahakali-introduced-in-powerful-glimpses',
      message: 'The editorial listing and TMDB agree on director Puja Aparna Kolluru and cast Akshaye Khanna and Sriya Reddy.' },
    { id: 1703718, title: 'Harivarasanam', language: 'ml', date: '2027-01-15', checkedAt: '2026-11-10T19:12:41Z',
      sourceUrl: 'https://www.cinemaexpress.com/malayalam/news/2026/Oct/27/saiju-kurups-harivarasanam-gets-release-date-first-look-out',
      message: 'The editorial listing and TMDB agree on director Rajesh Nair and cast Saiju Kurup and Yogi Babu.' },
    { id: 1783023, title: 'Pocket Rockkets', language: 'te', date: '2026-12-11', checkedAt: '2026-11-10T19:16:51Z',
      sourceUrl: 'https://www.cinemaexpress.com/telugu/news/2026/Nov/03/niharika-konidelas-pocket-rockkets-locks-release-date',
      message: 'The editorial listing and TMDB agree on cast Trinadh Varma, Shriya Kontham and J. D. Chakravarthy.' },
    { id: 1494621, title: 'Dada', language: 'te', date: '2026-12-24', source: 'The Times of India', checkedAt: '2026-11-10T19:16:51Z',
      sourceUrl: 'https://timesofindia.indiatimes.com/articleshow/135545128.cms',
      message: 'The editorial listing and TMDB agree on director Gopichand Malineni and cast Nandamuri Balakrishna and Kajal Aggarwal.' },
    { id: 1511403, title: 'King 100', language: 'te', date: '2026-12-24', checkedAt: '2026-11-10T19:16:51Z',
      sourceUrl: 'https://www.cinemaexpress.com/telugu/news/2026/Aug/29/king100-glimpse-features-nagarjuna-chasing-identity-release-date-out',
      message: 'The editorial listing and TMDB agree on director Ra Karthik and cast Nagarjuna and Tabu.' },
    { id: 1533741, title: 'Kaaka', language: 'te', date: '2027-01-13', source: 'India Today', checkedAt: '2026-11-11T05:08:30Z', identityOnly: true,
      sourceUrl: 'https://www.indiatoday.in/movies/regional-cinema/story/chiranjeevi-next-titled-kaaka-first-glimpse-out-sankranthi-2027-release-set-2977286-2026-08-22',
      message: 'The editorial listing and TMDB agree on lead Chiranjeevi and director Bobby Kolli (K. S. Ravindra). The local date remains disputed.' },
  ];
  const match = matches.find(item => Number(row.tmdb_id) === item.id && row.title === item.title && row.language === item.language &&
    row.release_date === item.date && row.source_url === `https://en.wikipedia.org/wiki/List_of_${item.language === 'ml' ? 'Malayalam' : 'Telugu'}_films_of_${item.date.slice(0, 4)}`);
  return match ? { source: match.source ?? 'Cinema Express', sourceUrl: match.sourceUrl, checkedAt: match.checkedAt ?? '2026-11-10T19:01:57Z', message: match.message,
    identityOnly: 'identityOnly' in match && match.identityOnly === true } : null;
}

/** Later reporting can cast doubt on a scheduled event without confirming a
 * replacement date or proving the TMDB link. */
export function reviewedEditorialDateConflict(row: {
  origin: string; tmdb_id: number | null; media_type: string | null; title: string;
  language?: string | null; release_date: string; source_url: string | null;
  entry_type: string | null; evidence: unknown;
}) {
  if (row.origin !== 'wikipedia' || Number(row.tmdb_id) !== 1533741 || row.media_type !== 'movie' ||
      row.entry_type !== 'Movie' || row.title !== 'Kaaka' || row.language !== 'te' || row.release_date !== '2027-01-13' ||
      row.source_url !== 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2027' || !row.evidence ||
      typeof row.evidence !== 'object' || Array.isArray(row.evidence)) return null;
  const evidence = row.evidence as Record<string, unknown>;
  if (evidence.date_source !== 'tmdb_regional_theatrical' || evidence.region !== 'IN' ||
      evidence.source_url !== 'https://www.themoviedb.org/movie/1533741') return null;
  return { source: 'Deccan Chronicle', checkedAt: '2026-11-10T19:12:41Z',
    sourceUrl: 'https://www.deccanchronicle.com/tabloid/hyderabad-chronicle/chiranjeevi-puts-kaaka-on-hold-2001788',
    message: 'Date needs review: later reporting says the film was reportedly put on hold. The makers have not confirmed a replacement date here; the local release event remains unverified.' };
}

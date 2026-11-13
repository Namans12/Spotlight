/** Individually reviewed editorial observations. Match the complete original
 * identity, including provenance, so a later ingestion cannot inherit a stale
 * decision merely by reusing a TMDB id. Dates are announcements, not offers. */
export function reviewedCalendarEntry(row: {
  origin: string; tmdb_id: number | null; media_type: string | null;
  title: string; release_date: string; source_url: string | null;
  event_region: string | null; evidence: unknown; platform_or_distributor: string | null; entry_type: string | null;
  language?: string | null;
}) {
  if (row.event_region != null || row.evidence != null) return null;
  if (row.origin === 'tmdb_upcoming' && Number(row.tmdb_id) === 1733518 && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.title === 'Bouma' && row.language === 'ml' && row.release_date === '2026-12-04' && row.platform_or_distributor == null &&
      row.source_url === 'https://www.themoviedb.org/movie/1733518') {
    return { type: 'conflict' as const, suppressEvent: true, checkedAt: '2026-11-13T21:19:00Z', source: 'Cinema Express',
      sourceUrl: 'https://www.cinemaexpress.com/malayalam/news/2026/Nov/11/bouma-opens-kerala-bookings-today',
      message: 'The makers announced Kerala bookings for a 12 November theatrical release. This later 4 December observation remains hidden until a separate release event is verified.' };
  }
  if (row.origin === 'tmdb_upcoming' && Number(row.tmdb_id) === 1569041 && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.title === 'Padayaatra' && row.language === 'ml' && row.release_date === '2026-12-04' && row.platform_or_distributor == null &&
      row.source_url === 'https://www.themoviedb.org/movie/1569041') {
    return { type: 'conflict' as const, suppressEvent: true, checkedAt: '2026-11-13T21:14:00Z', source: 'Cinema Express',
      sourceUrl: 'https://www.cinemaexpress.com/malayalam/news/2026/Oct/21/mammootty-adoor-gopalakrishnan-film-padayaatra-gets-release-date',
      message: 'Reports disagree: this source gives 5 December, while other reporting on the producer’s poster gives 4 December. The date remains hidden pending direct confirmation of the announcement.' };
  }
  if (row.origin === 'tmdb_upcoming' && Number(row.tmdb_id) === 335981 && row.media_type === 'tv' && row.entry_type === 'Show' &&
      row.title === 'Cunk on Cinema' && row.language === 'en' && row.release_date === '2026-11-30' &&
      row.platform_or_distributor === 'BBC Two' && row.source_url === 'https://www.themoviedb.org/tv/335981') {
    return { type: 'conflict' as const, suppressEvent: true, checkedAt: '2026-11-13T21:06:00Z', source: 'Royal Television Society',
      sourceUrl: 'https://rts.org.uk/article/diane-morgan-baffles-benedict-cumberbatch-trailer-cunk-cinema',
      message: 'BBC Two’s UK run starts on 12 November, according to reporting on the broadcaster’s announcement. The 30 November observation remains hidden; the India streaming date must be verified separately.' };
  }
  if (row.origin === 'tmdb_upcoming' && row.media_type === 'movie' && row.entry_type === 'Movie' && row.platform_or_distributor == null) {
    const announcement = [
      { id: 1381071, title: 'Godzilla Minus Zero', language: 'ja', date: '2026-11-20', source: 'PVR INOX Pictures / Bollywood Hungama',
        url: 'https://www.bollywoodhungama.com/news/bollywood/exclusive-godzilla-minus-zero-to-finally-release-in-india-on-november-20-pvr-inox-pictures-nayana-bijli-confirms-imax-release/',
        message: 'The Indian distributor confirmed a 20 November theatrical release. Check local showtimes; streaming availability is not established.' },
      { id: 1510775, title: 'Gunmaaster G9', language: 'hi', date: '2026-11-27', source: 'Soham Rockstar Entertainment',
        url: 'https://in.linkedin.com/company/soham-rockstar-entertainment',
        message: 'The production company announced a 27 November cinema release. Check local showtimes; streaming availability is not established.' },
      { id: 1504630, title: 'Mysaa', language: 'te', date: '2026-11-27', source: 'NDTV / Rashmika Mandanna',
        url: 'https://www.ndtv.com/entertainment/after-recovery-from-hip-injury-rashmika-mandanna-announces-mysaa-release-date-11986338',
        message: 'The lead actor announced a worldwide 27 November cinema release. Check local showtimes; streaming availability is not established.' },
      { id: 1555984, title: 'Prempaatta', language: 'ml', date: '2026-11-27', source: 'Cinema Express',
        url: 'https://www.cinemaexpress.com/amp/story/malayalam/news/2026/Oct/14/joemon-jyothir-starrer-prempaatta-moves-out-of-october-makers-announce-new-release-date',
        message: 'The makers announced a 27 November theatrical release after moving it from October. Check local showtimes; streaming availability is not established.' },
      { id: 1417808, title: 'Haindava', language: 'te', date: '2026-11-27', source: 'Cinema Express',
        url: 'https://www.cinemaexpress.com/telugu/news/2026/Oct/14/bellamkonda-sai-sreenivas-haindava-teaser-unveiled-release-date-announced',
        message: 'The makers announced a 27 November theatrical release. Check local showtimes; streaming availability is not established.' },
      { id: 1553480, title: 'Niram', language: 'ta', date: '2026-11-27', source: 'Tamil Film Active Producers Association',
        url: 'https://tfapa.com/wp-content/uploads/2026/11/trade-guide-nov-2026.pdf',
        message: 'The producers association lists a tentative 27 November theatrical release. Check local showtimes; streaming availability is not established.' },
      { id: 1728047, title: 'Delivery Boy', language: 'ta', date: '2026-11-27', source: 'Likit Cinema / Leo Sivakumar',
        url: 'https://likit.in/cinema/delivery-boy-release-date',
        message: 'The lead actor reiterated a worldwide 27 November cinema release after the earlier October date moved. Check local showtimes; streaming availability is not established.' },
      { id: 1654912, title: 'Mayan - Chapter 1', language: 'ml', date: '2026-12-03', source: 'The New Indian Express',
        url: 'https://www.newindianexpress.com/entertainment/2026/Oct/17/malayalamnews2026oct16jayasuryas-mayan-first-look-unveiled',
        message: 'Reporting on the makers’ first look lists a 3 December theatrical release. Check local showtimes; streaming availability is not established.' },
      { id: 1489396, title: 'Eetha', language: 'hi', date: '2026-12-04', source: 'Hindustan Times / Maddock Films',
        url: 'https://www.hindustantimes.com/entertainment/bollywood/eetha-release-postponed-shraddha-kapoor-film-on-vithabai-narayangaonkar-avoids-clash-with-yash-toxic-101786448282411-amp.html',
        message: 'The studio announced a 4 December release after moving the earlier date. Check local showtimes; streaming availability is not established.' },
      { id: 1503283, title: 'Makkal Kaavalan', language: 'ta', date: '2026-12-04', source: 'The New Indian Express / Neelam Studios',
        url: 'https://www.newindianexpress.com/entertainment/2026/Sep/30/tamilnews2026sep29makkal-kaavalan-gets-december-release-date',
        message: 'The studio announced a 4 December theatrical release. Check local showtimes; streaming availability is not established.' },
      { id: 1395627, title: 'Vrushakarma', language: 'te', date: '2026-12-04', source: 'Cinema Express / SVCC',
        url: 'https://www.cinemaexpress.com/telugu/news/2026/Oct/28/dil-raju-acquires-vrushakarma-theatrical-rights-for-ap-telangana-and-karnataka',
        message: 'The makers announced a 4 December release and Indian theatrical distribution. Check local showtimes; streaming availability is not established.' },
      { id: 718833, title: 'Bokshi', language: 'hi', date: '2026-12-04', source: 'Cinema Express / Lorien Motion Pictures',
        url: 'https://www.cinemaexpress.com/hindi/news/2026/Oct/08/bokshi-critically-appreciated-horror-film-gets-new-release-date',
        message: 'The producer announced an India theatrical release on 4 December after postponement. Check local showtimes; streaming availability is not established.' },
      { id: 1213227, title: 'Train', language: 'ta', date: '2026-12-04', checkedAt: '2026-11-13T21:12:00Z', source: 'The Hollywood Reporter India / V Creations',
        url: 'https://www.hollywoodreporterindia.com/features/insight/train-mysskin-vijay-sethupathi-action-thriller-locks-december-2026-release',
        message: 'The producer announced a worldwide theatrical release on 4 December. Check local showtimes; streaming availability is not established.' },
      { id: 1596658, title: 'Hello Kadhal', language: 'ta', date: '2026-12-04', checkedAt: '2026-11-13T21:12:00Z', source: 'Simply Mollywood / film teaser',
        url: 'https://simplymollywood.com/trailers/hello-kadhal-title-teaser-arya-40-nikhila-vimal-nikhil-muraly-december-4',
        message: 'The title teaser announced a 4 December theatrical release. Check local showtimes; streaming availability is not established.' },
      { id: 1475768, title: 'Maatrubhumi:  May War Rest in Peace', language: 'hi', date: '2026-12-04', checkedAt: '2026-11-13T21:12:00Z', source: 'India Today / trailer launch',
        url: 'https://www.indiatoday.in/movies/bollywood/story/salman-khan-maatrubhumi-november-20-release-date-3033620-2026-11-06',
        message: 'The makers announced a 4 December theatrical release at the trailer launch, after earlier dates moved. Check local showtimes; streaming availability is not established.' },
      { id: 1713050, title: 'Alias Rukmini', language: 'te', date: '2026-12-04', checkedAt: '2026-11-13T21:19:00Z', source: 'Telangana Today / Unanimous Productions',
        url: 'https://telanganatoday.com/nithiins-alias-rukmini-to-hit-screens-on-december-4',
        message: 'The production company announced a worldwide 4 December theatrical release. Check local showtimes; streaming availability is not established.' },
      { id: 1763356, title: 'Cousin Isha', language: 'hi', date: '2026-12-04', checkedAt: '2026-11-13T21:19:00Z', source: 'BookMyShow',
        url: 'https://in.bookmyshow.com/movies/pune/cousin-isha/ET00516373',
        message: 'BookMyShow lists a 4 December release; bookings were not open when checked. The makers’ date is unconfirmed. Check local showtimes; streaming availability is not established.' },
    ].find(item => Number(row.tmdb_id) === item.id && row.title === item.title && row.language === item.language && row.release_date === item.date &&
      row.source_url === `https://www.themoviedb.org/movie/${item.id}`);
    if (announcement) return { type: 'regional' as const, region: 'IN', checkedAt: announcement.checkedAt ?? '2026-11-13T20:50:00Z',
      source: announcement.source, sourceUrl: announcement.url, message: announcement.message };
  }
  if (row.origin === 'tmdb_upcoming' && row.media_type === 'movie' && row.entry_type === 'Movie' && row.platform_or_distributor == null) {
    const postponed = [
      { id: 1214368, title: 'Golmaal 5', language: 'hi', date: '2026-12-04', source: 'India Today',
        url: 'https://www.indiatoday.in/movies/bollywood/story/ajay-devgn-akshay-kumars-golmaal-5-locked-for-january-2027-see-new-poster-2998292-2026-09-19',
        message: 'The filmmaker announced an 8 January 2027 theatrical release. This older 4 December observation remains hidden; verify current local showtimes separately.' },
      { id: 1257973, title: 'Fauzi', language: 'te', date: '2026-12-03', source: 'India Today',
        url: 'https://www.indiatoday.in/amp/movies/regional-cinema/story/prabhas-fauzi-release-delayed-makers-confirm-postponement-new-date-awaited-3000129-2026-09-22',
        message: 'The producer confirmed that the announced 3 December release was postponed. This older observation remains hidden; verify any replacement date separately.' },
      { id: 1525648, title: 'Inji Vellam', language: 'ta', date: '2027-01-08', source: 'The Indian Express',
        url: 'https://indianexpress.com/article/entertainment/tamil/mani-ratnam-vijay-sethupathi-sai-pallavi-inji-vellam-gets-release-date-10959097/',
        message: 'Reporting on the makers’ announcement gives 29 January for the theatrical release. This older 8 January observation remains hidden; check local showtimes separately.' },
      { id: 1263040, title: 'The Pride of Bharat: Chhatrapati Shivaji Maharaj', language: 'kn', date: '2027-01-21', source: 'Hindustan Times / PTI',
        url: 'https://www.hindustantimes.com/entertainment/bollywood/bhushan-kumar-rishab-shetty-collaborate-on-two-part-chhatrapati-shivaji-maharaj-biopic-101793341647318.html',
        message: 'A later studio announcement says filming is planned for early 2027, putting the previously announced 21 January release in doubt. The old date remains hidden pending a current release announcement.' },
      { id: 1590846, title: 'V. Shantaram', language: 'hi', date: '2026-11-18', source: 'Bollywood Hungama',
        url: 'https://www.bollywoodhungama.com/news/bollywood/exclusive-v-shantaram-biopic-starring-siddhant-chaturvedi-and-tamannaah-bhatia-pushed-to-2027-director-reveals-reason-for-delay/',
        message: 'The director said filming was moved to 2027, conflicting with the earlier 18 November 2026 release target. This date remains hidden pending a current release announcement.' },
      { id: 1569625, title: 'Mauja Hi Mauja', language: 'hi', date: '2026-12-04', source: 'Bollywood Hungama',
        url: 'https://www.bollywoodhungama.com/news/features/exclusive-pvr-inox-pictures-strengthens-bollywood-slate-to-release-akshay-kumars-mauja-hi-mauja-in-november-end-salman-khans-monster-on-eid-2027/',
        message: 'The distributor described a different release window after the earlier 4 December date. Later reports differ about the replacement, so this date remains hidden pending a current announcement.' },
    ].find(item => Number(row.tmdb_id) === item.id && row.title === item.title && row.language === item.language && row.release_date === item.date &&
      row.source_url === `https://www.themoviedb.org/movie/${item.id}`);
    if (postponed) return { type: 'conflict' as const, suppressEvent: true, checkedAt: '2026-11-13T20:39:00Z',
      source: postponed.source, sourceUrl: postponed.url, message: postponed.message };
  }
  if (row.origin === 'tmdb_upcoming' && Number(row.tmdb_id) === 674527 && row.media_type === 'movie' && row.entry_type === 'Show' &&
      row.platform_or_distributor == null && row.language === 'hi' && row.title === 'Student of the Year 3' && row.release_date === '2026-12-25' &&
      row.source_url === 'https://www.themoviedb.org/tv/334412') {
    return { type: 'conflict' as const, suppressEvent: true, identityMismatch: true, checkedAt: '2026-11-13T20:37:00Z', source: 'Cinema Express',
      sourceUrl: 'https://www.cinemaexpress.com/hindi/news/2026/Oct/19/karan-johars-student-of-the-year-universe-moves-to-streaming-with-new-series-premiere-date-out',
      message: 'Reporting identifies the project as Student of the Year: After Dark, a series announced for JioHotstar on 13 November. The stored movie identity and 25 December observation are not verified and remain hidden.' };
  }
  if (row.origin === 'district_in' && Number(row.tmdb_id) === 1411090 && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.platform_or_distributor == null && row.language === 'hi' && row.title === 'Chamunda' && row.release_date === '2026-12-04' &&
      row.source_url === 'https://www.district.in/movies/chamunda-movie-tickets-in-hyderabad-MV189193') {
    return { type: 'corroboration' as const, suppressTitleLink: true, checkedAt: '2026-11-13T20:31:00Z', source: 'Odisha Post',
      sourceUrl: 'https://odishapostepaper.com/uploads/epaper/2025-01/6778394f42b54.pdf',
      message: 'A 2025 report on the studio slate listed 4 December 2026. The candidate TMDB record lacks matching credits and reports a different date; its identity and the current local release remain unconfirmed.' };
  }
  if (row.origin === 'district_in' && row.media_type === 'movie' && row.entry_type === 'Movie' && row.platform_or_distributor == null &&
      row.language === 'en' && row.release_date === '2027-02-05') {
    const reviewed = [
      { id: 1384758, title: 'Ice Age: Boiling Point', slug: 'ice-age-boiling-point', key: 'MV183060', source: 'Walt Disney Studios India',
        url: 'https://www.youtube.com/watch?v=hjnisLhVFDk', message: 'Disney Studios India advertises a 5 February theatrical release in English and Hindi; cast and director match TMDB. Check local showtimes and current streaming availability.' },
      { id: 1425859, title: 'Remain', slug: 'remain', key: 'MV207238', source: 'BookMyShow',
        url: 'https://in.bookmyshow.com/movies/gonda/remain/ET00516392', message: 'BookMyShow lists a 5 February Indian theatrical release; cast and director match TMDB. Bookings were not open when checked; verify local showtimes and streaming availability.' },
    ].find(item => Number(row.tmdb_id) === item.id && row.title === item.title &&
      row.source_url === `https://www.district.in/movies/${item.slug}-movie-tickets-in-hyderabad-${item.key}`);
    if (reviewed) return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-13T20:31:00Z',
      source: reviewed.source, sourceUrl: reviewed.url, message: reviewed.message };
  }
  if (row.origin === 'district_in' && Number(row.tmdb_id) === 1735225 && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.platform_or_distributor == null && row.language === 'kn' && row.title === 'Tamma Sukhagamana Bayasuva' && row.release_date === '2026-12-25' &&
      row.source_url === 'https://www.district.in/movies/tamma-sukhagamana-bayasuva-movie-tickets-in-hyderabad-MV226322') {
    return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-13T20:29:00Z', source: 'BookMyShow',
      sourceUrl: 'https://in.bookmyshow.com/movies/koraput/tamma-sukhagamana-bayasuva/ET00488629',
      message: 'BookMyShow lists the Kannada film for 25 December in India; its director and cast match TMDB. Bookings were not open when checked; showtimes and streaming availability remain unconfirmed.' };
  }
  if (row.origin === 'district_in' && Number(row.tmdb_id) === 1720486 && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.platform_or_distributor == null && row.language === 'en' && row.title === 'Lilo & Scratch' && row.release_date === '2026-11-25' &&
      row.source_url === 'https://www.district.in/movies/lilo-scratch-movie-tickets-in-hyderabad-MV231108') {
    return { type: 'corroboration' as const, checkedAt: '2026-11-13T20:26:00Z', source: 'The Walt Disney Company',
      sourceUrl: 'https://thewaltdisneycompany.com/news/animation-annecy-2026-announcements/',
      message: 'Disney describes this as an animated short playing with Hexed. The 25 November date and whether it accompanies local screenings in India remain unconfirmed; check the cinema listing.' };
  }
  if (Number(row.tmdb_id) === 1450342 && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.platform_or_distributor == null && row.language === 'te' && row.title === 'Bhogi' &&
      ((row.origin === 'wikipedia' && row.release_date === '2026-11-21' && row.source_url === 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026') ||
       (row.origin === 'tmdb_upcoming' && row.release_date === '2026-11-30' && row.source_url === 'https://www.themoviedb.org/movie/1450342'))) {
    return { type: 'corroboration' as const, suppressEvent: true, checkedAt: '2026-11-13T18:57:00Z', source: 'Telangana Today',
      sourceUrl: 'https://telanganatoday.com/bhogi-release-postponed-due-to-unforeseen-delays-says-production-house',
      message: 'The production house announced a postponement and said a new date will be announced. This later dated observation is unverified and remains hidden pending an official update.' };
  }
  if (row.origin === 'district_in' && Number(row.tmdb_id) === 1555752 && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.platform_or_distributor == null && row.language === 'en' && row.title === 'Love & War' && row.release_date === '2027-01-21' &&
      row.source_url === 'https://www.district.in/movies/love-war-movie-tickets-in-hyderabad-MV169730') {
    return { type: 'regional' as const, region: 'IN', reviewedTmdbId: 1235057, correctedLanguage: 'hi', identityMismatch: true,
      checkedAt: '2026-11-13T18:40:00Z', source: 'The Indian Express',
      sourceUrl: 'https://indianexpress.com/article/entertainment/bollywood/sanjay-leela-bhansali-reveals-release-date-of-ranbir-kapoor-vicky-kaushal-alia-bhatts-love-war-10641389/',
      message: 'The makers announced a 21 January theatrical release. District and TMDB 1235057 match the director and cast; the stored TMDB link refers to a different film. Check local showtimes.' };
  }
  if (row.origin === 'district_in' && Number(row.tmdb_id) === 621304 && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.platform_or_distributor == null && row.language === 'en' && row.title === 'Children of Blood and Bone' && row.release_date === '2027-01-15' &&
      row.source_url === 'https://www.district.in/movies/children-of-blood-and-bone-movie-tickets-in-hyderabad-MV227336') {
    return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-13T18:38:00Z', source: 'Glamsham',
      sourceUrl: 'https://glamsham.com/hollywood/entertainment-news/children-of-blood-and-bone-trailer-fantasy-world-filled-magic-danger/',
      message: 'Indian reporting lists a 15 January theatrical release; the director and cast match Paramount and TMDB. Check local showtimes; streaming availability remains unconfirmed.' };
  }
  if (row.origin === 'district_in' && Number(row.tmdb_id) === 1216701 && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.platform_or_distributor == null && row.language === 'mr' && row.title === 'Khashaba' && row.release_date === '2027-01-01' &&
      row.source_url === 'https://www.district.in/movies/khashaba-movie-tickets-in-hyderabad-MV227187') {
    return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-13T15:23:00Z', source: 'BookMyShow',
      sourceUrl: 'https://in.bookmyshow.com/movies/kolkata/khashaba/ET00505825',
      message: 'BookMyShow lists the Marathi film for 1 January in India; its director and cast match TMDB. Bookings were not open when checked; showtimes and streaming availability remain unconfirmed.' };
  }
  if (row.origin === 'district_in' && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.platform_or_distributor == null && row.release_date === '2026-12-31') {
    const undated = [
      { id: 1389589, title: 'Rakkayie', language: 'ta', slug: 'rakkayie', key: 'MV183794', source: 'BookMyShow',
        url: 'https://in.bookmyshow.com/movies/chennai/rakkayie/ET00420342',
        message: 'BookMyShow lists the film for 2026 without a specific day; another catalogue gives a different December date. This old 31 December observation remains hidden pending stronger evidence.' },
      { id: 1411614, title: 'Raaka', language: 'te', slug: 'raaka', key: 'MV218847', source: 'Telugu Cinema',
        url: 'https://telugucinema.com/news/allu-arjun-and-atlees-raaka-heres-the-latest-on-the-release-date',
        message: 'The director has not confirmed a release date; reporting describes a late-2027 target. The original listing now says coming soon. This old 31 December date remains hidden.' },
      { id: 1389373, title: 'Rowdy Janardhana', language: 'te', slug: 'rowdy-janardhana', key: 'MV212225', source: 'The Hollywood Reporter India',
        url: 'https://www.hollywoodreporterindia.com/amp/story/features/insight/rowdy-janardhana-vijay-deverakondas-next-film-gets-a-title-teaser',
        message: 'The makers announced December 2026 without a specific day, and the original listing now gives only the month. This old 31 December date remains hidden.' },
      { id: 1562979, title: 'Dharman', language: 'ta', slug: 'dharman', key: 'MV226468', source: 'India Today',
        url: 'https://www.indiatoday.in/movies/regional-cinema/story/nayanthara-reunites-with-rajinikanth-after-5-years-in-kamal-haasans-dharman-3024932-2026-10-26',
        message: 'Reporting says the makers have not announced a release date; different 2027 dates have been reported. This old 31 December 2026 date remains hidden.' },
    ].find(item => Number(row.tmdb_id) === item.id && row.title === item.title && row.language === item.language &&
      row.source_url === `https://www.district.in/movies/${item.slug}-movie-tickets-in-hyderabad-${item.key}`);
    if (undated) return { type: 'corroboration' as const, suppressEvent: true, checkedAt: '2026-11-13T15:25:00Z',
      source: undated.source, sourceUrl: undated.url, message: undated.message };
    if (Number(row.tmdb_id) === 1387155 && row.language === 'hi' && row.title === 'Mahavatar' &&
        row.source_url === 'https://www.district.in/movies/mahavatar-movie-tickets-in-hyderabad-MV183233') {
      return { type: 'conflict' as const, suppressEvent: true, checkedAt: '2026-11-13T15:23:00Z', source: 'Bollywood Hungama',
        sourceUrl: 'https://www.bollywoodhungama.com/news/bollywood/breaking-shoot-of-vicky-kaushals-mahavatar-to-commence-in-january-2027-stree-3-goes-on-floors-in-2027-end-horror-comedy-expected-to-release-on-independence-day-or-christmas-2028/',
        message: 'The producer described filming beginning in January 2027. The older 31 December 2026 observation conflicts with that statement and remains hidden; a replacement date is not confirmed.' };
    }
    if (Number(row.tmdb_id) === 1475768 && row.language === 'hi' && row.title === 'Maatrubhumi: May War Rest in Peace' &&
        row.source_url === 'https://www.district.in/movies/maatrubhumi-may-war-rest-in-peace-movie-tickets-in-hyderabad-MV201390') {
      return { type: 'conflict' as const, suppressEvent: true, checkedAt: '2026-11-13T15:20:00Z', source: 'Salman Khan Films',
        sourceUrl: 'https://www.salmankhanfilms.com/news/a-glimpse-into-the-life-of-a-soldier-both-at-the-border-back-home-maatrubhumi-may-war-rest',
        message: 'The production company announces a 4 December theatrical release. The older 31 December observation remains hidden; verify current local showtimes separately.' };
    }
    if (Number(row.tmdb_id) === 1469537 && row.language === 'ta' && row.title === 'Slumdog: 33 Temple Road' &&
        row.source_url === 'https://www.district.in/movies/slumdog-33-temple-road-movie-tickets-in-hyderabad-MV213661') {
      return { type: 'corroboration' as const, suppressEvent: true, checkedAt: '2026-11-13T15:20:00Z', source: 'Simply Mollywood',
        sourceUrl: 'https://simplymollywood.com/movies/slumdog-33-temple-road-wrap-vijay-sethupathi-samyuktha-tabu-malayalam',
        message: 'Reporting cites the production company saying the release date will be announced; the current ticketing listing says coming soon. The older 31 December date remains unverified and hidden.' };
    }
  }
  if (row.origin === 'district_in' && row.tmdb_id == null && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.platform_or_distributor == null && row.release_date === '2027-01-01') {
    if (row.language === 'mr' && row.title === 'Jhimma 3' && row.source_url === 'https://www.district.in/movies/jhimma-3-movie-tickets-in-hyderabad-MV218947') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-13T15:16:00Z', source: 'BookMyShow',
        sourceUrl: 'https://in.bookmyshow.com/movies/pune/jhimma-3/ET00501318',
        message: 'BookMyShow lists the Marathi film for 1 January in India, matching its director and lead. Showtimes, streaming availability and the TMDB identity remain unverified.' };
    }
    if (row.language === 'gu' && row.title === 'Super Kaand' && row.source_url === 'https://www.district.in/movies/super-kaand-movie-tickets-in-hyderabad-MV231030') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-13T15:16:00Z', source: 'Gujarati Jagran',
        sourceUrl: 'https://www.gujaratijagran.com/entertainment/super-kaand-gujarati-movie-official-teaser-release-date-2027-1976467',
        message: 'Gujarati reporting on the teaser lists a 1 January theatrical release and matches the director and production details. Showtimes, streaming availability and the TMDB identity remain unverified.' };
    }
  }
  if (row.origin === 'district_in' && row.tmdb_id == null && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.platform_or_distributor == null && row.language === 'te' && row.title === 'SYG: Sambarala Yeti Gattu' &&
      row.release_date === '2027-01-12' && row.source_url === 'https://www.district.in/movies/syg-sambarala-yeti-gattu-movie-tickets-in-hyderabad-MV185888') {
    return { type: 'regional' as const, region: 'IN', reviewedTmdbId: 1424955, checkedAt: '2026-11-13T15:14:00Z', source: 'BookMyShow',
      sourceUrl: 'https://in.bookmyshow.com/movies/mussoorie/syg-sambarala-yeti-gattu/ET00427854',
      message: 'The ticketing listings and TMDB match the director and cast; BookMyShow and TMDB list a 12 January India theatrical release. Bookings were not open when checked; verify showtimes and streaming availability.' };
  }
  if (row.origin === 'tmdb_upcoming' && row.tmdb_id == null && row.media_type == null && row.entry_type === 'Movie' && row.platform_or_distributor == null) {
    if (row.language === 'ta' && row.title === 'OM Chapter 1: Udhiram - The Blood Wood' &&
        ['2026-11-26', '2026-11-27'].includes(row.release_date) && row.source_url === 'https://www.themoviedb.org/movie/1384528') {
      return { type: 'conflict' as const, suppressEvent: true, checkedAt: '2026-11-13T15:12:00Z', source: 'India Today',
        sourceUrl: 'https://www.indiatoday.in/movies/regional-cinema/story/dhanush-mammootty-om-chapter-1-udhiram-the-blood-wood-locks-release-date-avoiding-clashes-with-jailer-2-scene-3008591-2026-10-03',
        message: 'The makers announced a 20 November theatrical release. This older observation has no verified region, event type or stored title identity and remains hidden.' };
    }
    if (row.language === 'te' && row.title === 'NBK111' && row.release_date === '2026-12-11' &&
        row.source_url === 'https://www.themoviedb.org/movie/1494621') {
      return { type: 'conflict' as const, suppressEvent: true, checkedAt: '2026-11-13T15:12:00Z', source: 'India Today',
        sourceUrl: 'https://www.indiatoday.in/movies/regional-cinema/story/nandamuri-balakrishna-dada-title-glimpse-retro-king-of-chaos-december-24-2026-2988833-2026-09-07',
        message: 'The makers identify NBK111 as Dada and announced a 24 December theatrical release. This older observation has no verified region, event type or stored title identity and remains hidden.' };
    }
  }
  if (row.origin === 'tmdb_upcoming' && Number(row.tmdb_id) === 310209 && row.media_type === 'tv' &&
      row.entry_type === 'Show' && row.language === 'ko' && row.title === 'Nine to Six' && row.release_date === '2026-11-11' &&
      row.source_url === 'https://www.themoviedb.org/tv/310209') {
    return { type: 'conflict' as const, checkedAt: '2026-11-11T05:18:34Z', source: 'SBS',
      sourceUrl: 'https://sbsstar.net/article/N1008839649/nine-to-six-unveils-group-poster-featuring-park-minyoungyook-sungjaego-soo-as-office-aces',
      message: 'Date needs review: SBS announces the Korean premiere for 25 November, while this older entry lists 11 November. India availability and its local date remain unconfirmed.' };
  }
  if (row.origin === 'district_in' && row.media_type === 'movie' && row.entry_type === 'Movie' && row.language === 'en') {
    if (Number(row.tmdb_id) === 1567605 && row.title === 'Ebenezer' && row.release_date === '2026-11-20' &&
        row.source_url === 'https://www.district.in/movies/ebenezer-movie-tickets-in-hyderabad-MV213946') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-10', source: 'BookMyShow',
        sourceUrl: 'https://in.bookmyshow.com/movies/hyderabad/ebenezer-a-christmas-carol/ET00506939',
        message: 'BookMyShow lists Ebenezer: A Christmas Carol for 20 November in Hyderabad; bookings were not yet open when checked.' };
    }
    if (Number(row.tmdb_id) === 1381273 && row.title === 'Paper Tiger' && row.release_date === '2026-11-20' &&
        row.source_url === 'https://www.district.in/movies/paper-tiger-movie-tickets-in-hyderabad-MV227340') {
      return { type: 'conflict' as const, checkedAt: '2026-11-10T19:22:03Z', source: 'BookMyShow',
        sourceUrl: 'https://in.bookmyshow.com/movies/kolkata/paper-tiger/ET00522380',
        message: 'Date needs review: BookMyShow and the original District listing now list 27 November in India; this legacy entry lists 20 November without verified territory. District and TMDB agree on director James Gray and leads Adam Driver, Scarlett Johansson and Miles Teller.' };
    }
  }
  if (row.origin === 'district_in' && row.tmdb_id == null && row.media_type == null && row.entry_type === 'Movie' &&
      row.language === 'te' && row.title === 'NBK111' && row.release_date === '2026-12-31' &&
      row.source_url === 'https://www.district.in/movies/nbk111-movie-tickets-in-hyderabad-MV224943') {
    return { type: 'conflict' as const, checkedAt: '2026-11-10', source: 'The New Indian Express',
      sourceUrl: 'https://www.newindianexpress.com/entertainment/entertainment-news/2026/Sep/09/telugunews2026sep07balakrishnas-nbk111-is-now-titled-dada',
      message: 'Date needs review: reporting identifies NBK111 as Dada and cites the makers’ 24 December announcement, not this legacy 31 December date. The TMDB identity and local event remain unconfirmed.' };
  }
  if (row.origin === 'district_in' && Number(row.tmdb_id) === 1395627 && row.media_type === 'movie' &&
      row.entry_type === 'Movie' && row.language === 'te' && row.title === 'Vrushakarma' && row.release_date === '2026-12-31' &&
      row.source_url === 'https://www.district.in/movies/vrushakarma-movie-tickets-in-hyderabad-MV210428') {
    return { type: 'conflict' as const, checkedAt: '2026-11-10T19:22:03Z', source: 'BookMyShow',
      sourceUrl: 'https://in.bookmyshow.com/movies/dehradun/vrushakarma/ET00472260',
      message: 'Date needs review: BookMyShow and the original District listing now list 4 December in India, while this legacy entry lists 31 December. District and TMDB agree on director Karthik Varma Dandu and leads Naga Chaitanya and Meenakshi Chaudhary.' };
  }
  if (row.origin === 'tmdb_upcoming' && Number(row.tmdb_id) === 1450342 && row.media_type === 'movie' &&
      row.entry_type === 'Movie' && row.language === 'te' && row.title === 'Bhogi' && row.release_date === '2026-11-12' &&
      row.source_url === 'https://www.themoviedb.org/movie/1450342') {
    return { type: 'conflict' as const, checkedAt: '2026-11-10', source: '123telugu',
      sourceUrl: 'https://www.123telugu.com/mnews/sharwanands-bhogi-postponed-heres-why-hk.html',
      message: 'Date needs review: local reporting says the announced 12 November release has been postponed; no replacement date is confirmed here.' };
  }
  if (row.origin === 'tmdb_upcoming' && row.media_type === 'movie' && row.entry_type === 'Movie') {
    if (Number(row.tmdb_id) === 1636756 && row.language === 'bn' && row.title === 'Mrigaya 1.5: The Hunt Continues' &&
        row.platform_or_distributor == null && row.release_date === '2026-11-20' && row.source_url === 'https://www.themoviedb.org/movie/1636756') {
      // Separate streaming announcement: https://www.zee5.com/global/blog/mrigaya-1-5-the-hunt-continues-story-explained-inside-the-cop-universe-at-the-heart-of-the-hunt/
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-13T15:04:00Z', source: 'BookMyShow',
        sourceUrl: 'https://in.bookmyshow.com/movies/chennai/mrigaya-15-the-hunt-continues/ET00489767',
        message: 'BookMyShow lists a 20 November cinema release with matching director and cast; bookings were not open when checked. ZEE5 separately reports streaming from 13 November. Check current showtimes and streaming availability.' };
    }
    const regionalFilms = [
      { id: 1733594, title: 'Shankarabharana', language: 'kn', url: 'https://in.bookmyshow.com/movies/mumbai/shankarabharanna/ET00523262' },
      { id: 1735403, title: 'Brindavihari', language: 'kn', url: 'https://in.bookmyshow.com/movies/karad/brindavihari/ET00520736' },
      { id: 1540824, title: 'Sathyavan Savithiri', language: 'ta', url: 'https://in.bookmyshow.com/movies/delhi/sathyavan-savithiri/ET00522599' },
    ].find(item => Number(row.tmdb_id) === item.id && row.title === item.title && row.language === item.language &&
      row.source_url === `https://www.themoviedb.org/movie/${item.id}`);
    if (regionalFilms && row.release_date === '2026-11-20' && row.platform_or_distributor == null) {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-13T15:02:00Z', source: 'BookMyShow',
        sourceUrl: regionalFilms.url,
        message: 'BookMyShow lists this film for 20 November in India; its director and cast match TMDB. Bookings were not open on the checked listing, and streaming availability is unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1322273 && row.language === 'te' && row.title === 'Aakasam Lo Oka Tara' && row.platform_or_distributor == null &&
        row.release_date === '2026-11-20' && row.source_url === 'https://www.themoviedb.org/movie/1322273') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-13T14:57:00Z', source: 'The New Indian Express',
        sourceUrl: 'https://www.newindianexpress.com/entertainment/2026/Sep/18/telugunews2026sep17dulquer-salmaans-aakasamlo-oka-tara-gets-november-release-date',
        message: 'The makers announced a 20 November theatrical release; reporting and TMDB match the director and cast. Showtimes and streaming availability remain unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1805816 && row.language === 'kn' && row.title === 'Lambodhara 2.0' && row.platform_or_distributor == null &&
        row.release_date === '2026-11-20' && row.source_url === 'https://www.themoviedb.org/movie/1805816') {
      return { type: 'conflict' as const, suppressEvent: true, checkedAt: '2026-11-11T11:48:00Z', source: 'SouthSide Studio',
        sourceUrl: 'https://southsidestudio.in/news/2026-10/lambodhara-2-0-trailer-2026-10-31/',
        message: 'The film’s marketing agency reports the makers moved the theatrical release from 20 November to 13 November. This older observation remains hidden; verify current local showtimes separately.' };
    }
    if (Number(row.tmdb_id) === 1641520 && row.language === 'te' && row.title === 'DNK' && row.platform_or_distributor == null &&
        row.release_date === '2026-11-13' && row.source_url === 'https://www.themoviedb.org/movie/1641520') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-11T11:44:00Z', source: 'BookMyShow',
        sourceUrl: 'https://in.bookmyshow.com/movies/bengaluru/donga-naa-koduku/ET00521157',
        message: 'BookMyShow lists the film for 13 November in India. DNK was previously titled Donga Naa Koduku; its director and cast match TMDB. Showtimes and streaming availability are unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1505644 && row.language === 'te' && row.title === 'ENE Repeat' &&
        row.release_date === '2026-11-19' && row.source_url === 'https://www.themoviedb.org/movie/1505644') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-11T11:42:00Z', source: 'BookMyShow',
        sourceUrl: 'https://in.bookmyshow.com/movies/national-capital-region-ncr/ene-repeat/ET00506990',
        message: 'BookMyShow lists the Telugu film for 19 November in India. Its director and cast match the TMDB title; showtimes and streaming availability remain unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1531050 && row.language === 'ta' && row.title === 'Black Gold' &&
        row.release_date === '2026-11-13' && row.source_url === 'https://www.themoviedb.org/movie/1531050') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-11T05:26:27Z', source: 'Cinema Express',
        sourceUrl: 'https://www.cinemaexpress.com/tamil/news/2026/Oct/04/vetris-black-gold-gets-november-release',
        message: 'The makers announced a 13 November theatrical release; an India ticketing listing identifies the same Tamil film. Showtimes and streaming availability are unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1655020 && row.language === 'ta' && row.title === 'John Doe' &&
        row.release_date === '2026-11-13' && row.source_url === 'https://www.themoviedb.org/movie/1655020') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-11T05:26:27Z', source: 'Cinema Express',
        sourceUrl: 'https://www.cinemaexpress.com/tamil/news/2026/Nov/03/john-doe-trailer-shows-arjun-das-hunting-a-child-serial-killer-release-date-out',
        message: 'Reporting cites the makers’ 13 November theatrical announcement and names a Tamil Nadu distributor. Showtimes and streaming availability are unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1805816 && row.language === 'kn' && row.title === 'Lambodhara 2.0' &&
        row.release_date === '2026-11-13' && row.source_url === 'https://www.themoviedb.org/movie/1805816') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-11T05:26:27Z', source: 'BookMyShow',
        sourceUrl: 'https://in.bookmyshow.com/movies/bengaluru/lambodhara-20/et00524873',
        message: 'BookMyShow lists the film for 13 November in India; showtimes and streaming availability should be checked with the relevant service.' };
    }
    if (Number(row.tmdb_id) === 1445172 && row.language === 'te' && row.title === 'Dark Chocolate' &&
        row.release_date === '2026-11-13' && row.source_url === 'https://www.themoviedb.org/movie/1445172') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-11T05:23:11Z', source: 'BookMyShow',
        sourceUrl: 'https://in.bookmyshow.com/movies/vijayawada/dark-chocolate/ET00522245',
        message: 'BookMyShow lists the Telugu film for 13 November in India; bookings were not yet open when checked.' };
    }
    if (Number(row.tmdb_id) === 1808841 && row.language === 'te' && row.title === 'Maya lady' &&
        row.release_date === '2026-11-13' && row.source_url === 'https://www.themoviedb.org/movie/1808841') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-11T05:23:11Z', source: 'BookMyShow',
        sourceUrl: 'https://in.bookmyshow.com/movies/hyderabad/maya-lady/ET00524575',
        message: 'BookMyShow lists the Telugu film for 13 November in India; bookings were not yet open when checked.' };
    }
    if (Number(row.tmdb_id) === 1434462 && row.language === 'ml' && row.title === 'Melcow Pondicherry' &&
        row.release_date === '2026-11-13' && row.source_url === 'https://www.themoviedb.org/movie/1434462') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-11T05:21:13Z', source: 'Simply Mollywood',
        sourceUrl: 'https://simplymollywood.com/movies/malayalam-releases-this-week-bouma-melcow-gondhal-itllu-november-12-13',
        message: 'Regional reporting cites the makers’ 13 November theatrical announcement and a Kerala distributor. Showtimes and streaming availability are not confirmed by this announcement.' };
    }
    if (Number(row.tmdb_id) === 1562642 && row.language === 'en' && row.title === 'Ghost Soldier' &&
        row.release_date === '2026-11-11' && row.source_url === 'https://www.themoviedb.org/movie/1562642') {
      return { type: 'regional' as const, region: 'US', checkedAt: '2026-11-11T05:17:05Z', source: 'Harkins Theatres',
        sourceUrl: 'https://harkins.com/movies/ghost-soldier/2026-11-10',
        message: 'Harkins lists a US theatrical opening on 11 November, matching Sony’s announcement and the film’s cast. Availability outside the US is unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1733518 && row.language === 'ml' && row.title === 'Bouma' &&
        row.release_date === '2026-11-12' && row.source_url === 'https://www.themoviedb.org/movie/1733518') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-10T18:47:38Z', source: 'Cinema Express',
        sourceUrl: 'https://www.cinemaexpress.com/malayalam/news/2026/Oct/22/dileesh-pothan-starrer-bouma-gets-a-release-date',
        message: 'Reporting cites the makers’ 12 November theatrical announcement and names a Kerala distributor. Actual showtimes and streaming availability are unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1440539 && row.language === 'te' && row.title === 'Itllu Arjuna' &&
        row.release_date === '2026-11-13' && row.source_url === 'https://www.themoviedb.org/movie/1440539') {
      return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-10T18:47:38Z', source: 'BookMyShow',
        sourceUrl: 'https://in.bookmyshow.com/movies/angara/itllu-arjuna/ET00514068',
        message: 'BookMyShow lists the Telugu film for 13 November in India; bookings were not yet open when checked. Streaming availability is unconfirmed.' };
    }
  }
  if (row.origin === 'wikipedia' && row.tmdb_id == null && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.language === 'te' && row.title === 'SVC64' && row.release_date === '2027-01-14' &&
      row.source_url === 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2027') {
    return { type: 'corroboration' as const, checkedAt: '2026-11-10T18:49:55Z', source: 'NTV Telugu',
      sourceUrl: 'https://ntvtelugu.com/movie-news/cinema-news/ravi-teja-svc64-hasith-goli-movie-sankranti-2027-release-update-1010088.html',
      message: 'Reporting cites the makers’ 14 January theatrical announcement but notes unconfirmed speculation about a delay. The final title, TMDB identity and local event remain unconfirmed.' };
  }
  if (row.origin === 'wikipedia' && row.tmdb_id == null && row.media_type === 'movie' && row.entry_type === 'Movie' && row.platform_or_distributor == null) {
    const reviewed = [
      { title: 'Hail Mary', language: 'ml', date: '2026-11-26', id: 1704200, checkedAt: '2026-11-13T14:22:00Z',
        sourceUrl: 'https://www.cinemaexpress.com/malayalam/news/2026/Nov/05/kunchacko-bobans-hail-mary-gets-a-release-date' },
      { title: 'Cosmic Samson', language: 'ml', date: '2026-11-27', id: 1179380, checkedAt: '2026-11-13T14:22:00Z',
        sourceUrl: 'https://www.cinemaexpress.com/malayalam/news/2026/Oct/20/cosmic-samson-starring-sandeep-pradeep-gets-release-date' },
      { title: 'Haindava', language: 'te', date: '2026-11-27', id: 1417808, checkedAt: '2026-11-13T14:22:00Z',
        sourceUrl: 'https://telanganatoday.com/haindava-teaser-unveiled-bellamkonda-sai-sreenivass-pan-indian-film-set-for-nov-27-release', source: 'Telangana Today' },
      { title: 'Mysaa', language: 'te', date: '2026-11-27', id: 1504630, checkedAt: '2026-11-13T14:22:00Z',
        sourceUrl: 'https://www.cinemaexpress.com/telugu/news/2026/Sep/01/rashmika-mandannas-mysaa-gets-release-date' },
      { title: 'Alias Rukmini', language: 'te', date: '2026-12-04', id: 1713050, checkedAt: '2026-11-13T14:47:00Z',
        sourceUrl: 'https://telanganatoday.com/alias-rukmini-nithiins-new-look-unveiled-ahead-of-december-4-release', source: 'Telangana Today' },
      { title: 'Legacy', language: 'te', date: '2026-12-04', id: 1436202, checkedAt: '2026-11-13T14:47:00Z',
        sourceUrl: 'https://timesofindia.indiatimes.com/entertainment/telugu/movies/news/legacy-vishwak-sen-announces-december-4-release-date-for-political-action-drama-says-politics-is-personal/articleshow/133837154.cms', source: 'The Times of India' },
      { title: 'Pocket Rockkets', language: 'te', date: '2026-12-11', id: 1783023, checkedAt: '2026-11-13T14:47:00Z',
        sourceUrl: 'https://www.cinemaexpress.com/telugu/news/2026/Nov/03/niharika-konidelas-pocket-rockkets-locks-release-date' },
      { title: 'Mayan: Chapter 1', language: 'ml', date: '2026-12-03', id: 1654912, checkedAt: '2026-11-13T14:47:00Z',
        sourceUrl: 'https://simplymollywood.com/movies/december-2026-malayalam-releases-mayan-padayaatra-athimanoharam-iffk', source: 'Simply Mollywood' },
      { title: 'Vrushakarma', language: 'te', date: '2026-12-04', id: 1395627, checkedAt: '2026-11-13T14:51:00Z',
        sourceUrl: 'https://telanganatoday.com/naga-chaitanyas-vrushakarma-set-for-december-4-release', source: 'Telangana Today' },
      { title: 'Dada', language: 'te', date: '2026-12-24', id: 1494621, checkedAt: '2026-11-13T14:51:00Z',
        sourceUrl: 'https://www.indiatoday.in/movies/regional-cinema/story/nandamuri-balakrishna-dada-title-glimpse-retro-king-of-chaos-december-24-2026-2988833-2026-09-07', source: 'India Today' },
      { title: 'King 100', language: 'te', date: '2026-12-24', id: 1511403, checkedAt: '2026-11-13T14:51:00Z',
        sourceUrl: 'https://indianexpress.com/article/entertainment/telugu/nagarjuna-tabu-film-king-100-glimpse-blends-action-with-emotion-10855355/', source: 'The Indian Express' },
      { title: 'Reality', language: 'te', date: '2026-12-25', id: 1443139, checkedAt: '2026-11-13T14:51:00Z',
        sourceUrl: 'https://www.newindianexpress.com/entertainment/entertainment-news/2026/Oct/06/telugunews2026oct05kiran-abbavarams-directorial-debut-titled-reality-locks-release-date', source: 'The New Indian Express' },
    ].find(item => row.title === item.title && row.language === item.language && row.release_date === item.date &&
      row.source_url === `https://en.wikipedia.org/wiki/List_of_${item.language === 'ml' ? 'Malayalam' : 'Telugu'}_films_of_2026`);
    if (reviewed) return { type: 'regional' as const, region: 'IN', reviewedTmdbId: reviewed.id, checkedAt: reviewed.checkedAt,
      source: reviewed.source ?? 'Cinema Express', sourceUrl: reviewed.sourceUrl,
      message: 'The editorial listing and TMDB match reviewed cast and other identifying credits; TMDB reports this India theatrical date. Showtimes and streaming availability remain unconfirmed.' };
  }
  if (row.origin === 'wikipedia' && row.entry_type === 'Movie' &&
      (row.media_type === 'movie' || (row.media_type == null && row.tmdb_id == null && row.title === 'Donga Naa Koduku'))) {
    if (Number(row.tmdb_id) === 1635803 && row.media_type === 'movie' && row.language === 'en' &&
        row.title === 'Romeo Juliet' && row.release_date === '2026-11-13' &&
        row.source_url === 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026') {
      return { type: 'regional' as const, region: 'IN', suppressTitleLink: true, identityMismatch: true, correctedLanguage: 'te', checkedAt: '2026-11-10T18:49:55Z', source: 'Telugu Film Producers Council',
        sourceUrl: 'https://photos.tfpc.in/2026/10/25/song-launch-event-from-harshits-romeo-juliet/',
        message: 'The producers’ council reports a 13 November theatrical release, including Andhra Pradesh and Telangana. The stored TMDB link belongs to a different film; the correct title identity and showtimes are unconfirmed.' };
    }
    if (row.tmdb_id == null && row.language === 'te' && row.source_url === 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026') {
      if (row.media_type === 'movie' && row.platform_or_distributor == null &&
          row.title === 'DNK: Donga Naa Koduku' && row.release_date === '2026-11-13') {
        return { type: 'regional' as const, region: 'IN', reviewedTmdbId: 1641520, checkedAt: '2026-11-13T14:15:00Z', source: 'BookMyShow',
          sourceUrl: 'https://in.bookmyshow.com/movies/bengaluru/donga-naa-koduku/ET00521157',
          message: 'The editorial listing, BookMyShow and TMDB identify the same film by its director and cast. The India theatrical date is reported for 13 November; showtimes and streaming availability are unconfirmed.' };
      }
      if (row.media_type === 'movie' && row.platform_or_distributor == null &&
          row.title === 'ENE Repeat' && row.release_date === '2026-11-19') {
        return { type: 'regional' as const, region: 'IN', reviewedTmdbId: 1505644, checkedAt: '2026-11-13T14:15:00Z', source: 'BookMyShow',
          sourceUrl: 'https://in.bookmyshow.com/movies/national-capital-region-ncr/ene-repeat/ET00506990',
          message: 'The editorial listing, BookMyShow and TMDB identify the same film by its director and cast. The India theatrical date is reported for 19 November; showtimes and streaming availability are unconfirmed.' };
      }
      if (row.title === 'High' && row.release_date === '2026-11-27') {
        return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-10T18:30:54Z', source: 'Ticketnew',
          sourceUrl: 'https://ticketnew.com/movies/high-movie-detail-238606',
          message: 'Ticketnew lists the Telugu film for 27 November in India. Showtimes and the TMDB identity remain unverified.' };
      }
      if (row.release_date === '2026-11-13' && (row.title === 'Chandrayan' || (row.title === 'Donga Naa Koduku' && row.platform_or_distributor == null))) {
        // The producer identifies DNK as Donga Naa Koduku; cast and director
        // match TMDB 1641520. https://www.youtube.com/watch?v=8p0CE54v5UE
        return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-10', source: 'BookMyShow',
          sourceUrl: row.title === 'Chandrayan' ? 'https://in.bookmyshow.com/movies/bengaluru/chandrayan/ET00522567' : 'https://in.bookmyshow.com/movies/bengaluru/donga-naa-koduku/ET00521157',
          ...(row.title === 'Donga Naa Koduku' ? { reviewedTmdbId: 1641520, checkedAt: '2026-11-11T11:44:00Z' } : {}),
          message: row.title === 'Donga Naa Koduku' ? 'BookMyShow lists the film for 13 November in India. The film was retitled DNK; its director and cast match TMDB. Showtimes and streaming availability are unconfirmed.' :
            'BookMyShow lists the Telugu film for 13 November in India; bookings were not yet open when checked. The TMDB identity remains unverified.' };
      }
      if (row.title === 'Itlu Arjuna' && row.release_date === '2026-11-13') {
        return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-10', source: 'BookMyShow',
          sourceUrl: 'https://in.bookmyshow.com/movies/angara/itllu-arjuna/ET00514068',
          message: 'BookMyShow lists the Telugu film as Itllu Arjuna for 13 November in India; bookings were not yet open when checked. The TMDB identity remains unverified.' };
      }
      if (row.title === 'Talcum Powder' && row.release_date === '2026-11-13') {
        return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-10', source: 'BookMyShow',
          sourceUrl: 'https://in.bookmyshow.com/movies/balurghat/talcum-powder/ET00521922',
          message: 'BookMyShow lists the Telugu film for 13 November in India; bookings were not yet open when checked. The TMDB identity remains unverified.' };
      }
      if (row.title === 'Aakasamlo Oka Tara' && row.release_date === '2026-11-20' && row.platform_or_distributor == null) {
        return { type: 'regional' as const, region: 'IN', reviewedTmdbId: 1322273, checkedAt: '2026-11-13T14:57:00Z', source: 'The New Indian Express',
          sourceUrl: 'https://www.newindianexpress.com/entertainment/2026/Sep/18/telugunews2026sep17dulquer-salmaans-aakasamlo-oka-tara-gets-november-release-date',
          message: 'The editorial listing and TMDB match the director and cast; the makers announced a 20 November theatrical release. Showtimes and streaming availability remain unconfirmed.' };
      }
      if (row.title === 'Dear Astronaut' && row.release_date === '2026-11-20') {
        return { type: 'corroboration' as const, checkedAt: '2026-11-10', source: 'Cinema Express',
          sourceUrl: 'https://www.cinemaexpress.com/telugu/news/2026/Oct/31/dear-astronaut-locks-release-date',
          message: 'Reporting cites the filmmakers’ 20 November theatrical announcement. The TMDB identity and local release event remain unconfirmed.' };
      }
      if (row.title === 'Jayannth And The Jingo Pen' && row.release_date === '2026-11-12') {
        return { type: 'conflict' as const, checkedAt: '2026-11-10', source: 'The Hans India',
          sourceUrl: 'https://www.thehansindia.com/cinema/jayannth-and-the-jingo-pen-locks-nov-14-release-1140244',
          message: 'Date needs review: the filmmakers’ trailer announcement lists 12 November, while later reporting lists 14 November. The TMDB identity and local release event remain unconfirmed.' };
      }
      if (row.title === 'Jayannth And The Jingo Pen' && row.release_date === '2026-11-14') {
        return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-13T14:54:00Z', source: 'BookMyShow',
          sourceUrl: 'https://in.bookmyshow.com/movies/mumbai/jayannth-the-jingo-pen/ET00526028',
          message: 'BookMyShow lists the Telugu film for 14 November in India, matching its director and cast. Bookings were not open on the checked listing; the TMDB identity remains unverified.' };
      }
    }
    if (Number(row.tmdb_id) === 1450342 && row.title === 'Bhogi' && row.release_date === '2026-11-12' &&
        row.source_url === 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026') {
      return { type: 'conflict' as const, checkedAt: '2026-11-10', source: '123telugu',
        sourceUrl: 'https://www.123telugu.com/mnews/sharwanands-bhogi-postponed-heres-why-hk.html',
        message: 'Date needs review: local reporting says the announced 12 November release has been postponed; no replacement date is confirmed here.' };
    }
    if (Number(row.tmdb_id) === 1434462 && row.title === 'Melcow Pondicherry' && row.release_date === '2026-11-12' &&
        row.source_url === 'https://en.wikipedia.org/wiki/List_of_Malayalam_films_of_2026') {
      return { type: 'conflict' as const, checkedAt: '2026-11-10', source: 'Simply Mollywood',
        sourceUrl: 'https://simplymollywood.com/movies/malayalam-releases-this-week-bouma-melcow-gondhal-itllu-november-12-13',
        message: 'Date needs review: regional reporting citing maker and exhibitor announcements lists 13 November. This entry’s release event and region remain unconfirmed.' };
    }
    return null;
  }
  if (row.origin !== 'csv_seed') return null;
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
  const hindiFilms = 'https://en.wikipedia.org/wiki/List_of_Hindi_films_of_2026';
  const deadlineTv = 'https://deadline.com/feature/2026-tv-premiere-dates-1236391902/';
  if (Number(row.tmdb_id) === 1774728 && row.media_type === 'movie' && row.entry_type === 'Movie' &&
      row.title === 'Untitled film' && row.release_date === '2026-12-04' && row.source_url === hindiFilms &&
      row.platform_or_distributor === 'Sri Venkateswara Creations, Cape of Good Films') {
    return { type: 'conflict' as const, checkedAt: '2026-11-11T05:11:06Z', suppressTitleLink: true, source: 'The Times of India',
      sourceUrl: 'https://timesofindia.indiatimes.com/entertainment/hindi/bollywood/news/akshay-kumars-next-with-anees-bazmee-mauja-hi-mauja-gets-rs-60-crore-all-india-distribution-deal-ahead-of-2027-release-report/articleshow/134502329.cms',
      message: 'Date needs review: reporting says the Anees Bazmee comedy known as Mauja Hi Mauja is planned for 2027, with no new date confirmed. TMDB candidate 1569625 matches its cast and director, but the original untitled entry cannot yet be linked confidently; the stored TMDB ID is unavailable.' };
  }
  if (row.tmdb_id == null && row.media_type == null && row.entry_type === 'Show' && row.source_url === deadlineTv) {
    if (row.title === 'Off the Scales' && row.release_date === '2026-11-11' && row.platform_or_distributor === 'TLC') {
      return { type: 'corroboration' as const, checkedAt: '2026-11-10', source: 'Boston.com',
        sourceUrl: 'https://www.boston.com/culture/tv/2026/09/08/2026-fall-tv-premiere-dates/',
        message: 'A US television schedule lists a new TLC series on 11 November. The title identity, local date and availability remain unconfirmed.' };
    }
    if (row.title === 'Harry Potter and the Philosopher’s Stone' && row.release_date === '2026-12-25' && row.platform_or_distributor === 'HBO Max') {
      return { type: 'corroboration' as const, checkedAt: '2026-11-10', source: 'Warner Bros. Discovery',
        sourceUrl: 'https://press.warnerbrosdiscovery.fi/post/hbo-original-harry-potter-series-premieres-25-december-in-icelan',
        message: 'The broadcaster announces a 25 December series premiere in Iceland. This entry has no verified title identity; local date and availability remain unconfirmed.' };
    }
  }
  if (row.tmdb_id == null && row.media_type == null && row.entry_type === 'Movie' && row.source_url === americanFilms &&
      row.title === 'Ebenezer: A Christmas Carol' && row.release_date === '2026-11-13' && row.platform_or_distributor === 'Paramount Pictures') {
    return { type: 'corroboration' as const, checkedAt: '2026-11-10', source: 'Paramount',
      sourceUrl: 'https://cms-corp.paramount.com/news/paramount-pictures-goes-all-in-on-theatrical-at-cinemaconr',
      message: 'Paramount announced a 13 November theatrical release. This entry has no verified title identity; local date and availability remain unconfirmed.' };
  }
  if (row.media_type === 'movie' && row.source_url === hindiFilms) {
    if (Number(row.tmdb_id) === 1209723 && row.title === 'Yeh Prem Mol Liya' && row.release_date === '2026-11-27') {
      return { type: 'corroboration' as const, checkedAt: '2026-11-10', source: 'Yash Raj Films',
        sourceUrl: 'https://www.yashrajfilms.com/movies/yeh-prem-mol-liya',
        message: 'The worldwide distributor lists a 27 November release; the local event remains unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1389146 && row.title === 'Ranger' && row.release_date === '2026-12-04') {
      return { type: 'conflict' as const, checkedAt: '2026-11-10', source: 'Times of India',
        sourceUrl: 'https://timesofindia.indiatimes.com/entertainment/hindi/bollywood/news/ajay-devgn-and-sanjay-dutt-starrer-ranger-moves-out-of-december-2026-release-roster-leaves-shraddha-kapoors-eetha-to-clash-with-akshay-kumar-and-vidya-balans-film/articleshow/134352179.cms',
        message: 'Date needs review: industry reporting says the earlier 4 December release was pushed to 2027. The new date and this event’s region are unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1411089 && row.title === 'Shakti Shalini' && row.release_date === '2026-12-24') {
      if (row.language === 'hi' && row.entry_type === 'Movie' && row.platform_or_distributor === 'Maddock Films') {
        return { type: 'conflict' as const, checkedAt: '2026-11-13T14:42:00Z', source: 'Mid-day',
          sourceUrl: 'https://www.mid-day.com/amp/entertainment/bollywood-news/article/shakti-shalini-to-be-postponed-to-avoid-clash-with-king-23653896',
          message: 'Date needs review: an earlier report suggested a move to 2027; later reporting observed a promotional video still showing 24 December. The final local release remains unconfirmed.',
          additionalCorroboration: { checkedAt: '2026-11-13T14:42:00Z', source: 'The Free Press Journal',
            sourceUrl: 'https://www.freepressjournal.in/entertainment/is-aneet-paddas-shakti-shalini-not-getting-postponed-all-set-to-clash-with-shah-rukh-khans-king',
            message: 'Later reporting says a cinema promotional video still displayed 24 December; it does not confirm the current release plan.' } };
      }
      return { type: 'conflict' as const, checkedAt: '2026-11-10', source: 'Mid-day',
        sourceUrl: 'https://www.mid-day.com/amp/entertainment/bollywood-news/article/shakti-shalini-to-be-postponed-to-avoid-clash-with-king-23653896',
        message: 'Date needs review: press reports suggest a move to 2027; an official new date has not been established here.' };
    }
  }
  if (row.tmdb_id == null && row.media_type == null && row.title === 'Zero A. D.' && row.release_date === '2026-12-25' &&
      row.source_url === americanFilms && row.platform_or_distributor === 'Angel Studios') {
    return { type: 'conflict' as const, checkedAt: '2026-11-10', source: 'Angel Studios',
      sourceUrl: 'https://www.angel.com/es/press/zero-ad',
      message: 'Date needs review: Angel Studios lists 11 December for Zero A.D.; this entry has no verified title identity or region.' };
  }
  if (row.media_type === 'movie' && row.source_url === americanFilms) {
    if (Number(row.tmdb_id) === 1437882 && row.title === 'A Place in Hell' && row.release_date === '2026-12-25') {
      return { type: 'conflict' as const, checkedAt: '2026-11-10', source: 'Bloody Disgusting',
        sourceUrl: 'https://bloody-disgusting.com/movie/3961082/a-place-in-hell-michelle-williams-thriller-moves-from-christmas-2026-to-april-2027/',
        message: 'Date needs review: industry reporting says the theatrical release moved from 25 December 2026 to 23 April 2027. The region of this entry remains unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1372443 && row.title === 'Mr. Irrelevant' && row.release_date === '2026-12-25') {
      return { type: 'corroboration' as const, checkedAt: '2026-11-10', source: 'Paramount',
        sourceUrl: 'https://www.paramount.com/movies',
        message: 'Paramount lists a 25 December theatrical release. Local date and availability remain unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1421903 && row.title === 'Werwulf' && row.release_date === '2026-12-25') {
      return { type: 'corroboration' as const, checkedAt: '2026-11-10', source: 'Focus Features',
        sourceUrl: 'https://www.focusfeatures.com/werwulf',
        message: 'Focus Features lists a 25 December theatrical release. Local date and availability remain unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1634124 && row.title === 'Nutmeg & Mistletoe' && row.release_date === '2026-12-25') {
      return { type: 'corroboration' as const, checkedAt: '2026-11-10', source: 'The Numbers',
        sourceUrl: 'https://www.the-numbers.com/movie/Nutmeg-and-Mistletoe-%282026%29',
        message: 'The Numbers lists a limited US theatrical release on 25 December. Local date and availability remain unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1457866 && row.title === 'THE FURTHER MIS-ADVENTURES OF CLIFF BOOTH' && row.release_date === '2026-11-25') {
      return { type: 'event' as const, kind: 'theatrical' as const, checkedAt: '2026-11-10', source: 'Netflix Tudum',
        sourceUrl: 'https://www.netflix.com/tudum/articles/david-fincher-new-film-release-date',
        message: 'Netflix announces an IMAX run starting 25 November and a separate Netflix premiere on 23 December. Local dates and availability are unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1137888 && row.title === 'The Man with the Bag' && row.release_date === '2026-12-02') {
      return { type: 'event' as const, kind: 'streaming' as const, checkedAt: '2026-11-10', source: 'Amazon',
        sourceUrl: 'https://www.aboutamazon.com/news/entertainment/the-man-with-the-bag-arnold-schwarzenegger-christmas-movie-prime-video',
        message: 'Amazon announces a 2 December Prime Video premiere. Local date and availability are unconfirmed.' };
    }
    if (Number(row.tmdb_id) === 1131943 && row.title === 'Madden' && row.release_date === '2026-11-26') {
      return { type: 'conflict' as const, checkedAt: '2026-11-10', source: 'Amazon',
        sourceUrl: 'https://www.aboutamazon.com/news/entertainment/madden-movie-nicolas-cage-prime-video',
        message: 'Date needs review: Amazon announces a Prime Video premiere on 18 November. The 26 November entry’s region and release event remain unconfirmed.' };
    }
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

/** Preserve independent reviews after a matching TMDB refresh, without
 * carrying a regional review onto another territory or availability type. */
export function reviewedTmdbReviewAfterEvidence(row: Parameters<typeof reviewedCalendarEntry>[0]) {
  if (row.origin !== 'tmdb_upcoming' || row.tmdb_id == null || !row.evidence ||
      typeof row.evidence !== 'object' || Array.isArray(row.evidence)) return null;
  const evidence = row.evidence as Record<string, unknown>;
  if (evidence.source_url !== `https://www.themoviedb.org/${row.media_type}/${row.tmdb_id}`) return null;
  const review = reviewedCalendarEntry({ ...row, event_region: null, evidence: null });
  if (review?.type === 'regional') {
    return row.media_type === 'movie' && row.event_region === review.region && evidence.region === review.region &&
      evidence.date_source === 'tmdb_regional_theatrical' ? review : null;
  }
  const sameEvent = row.media_type === 'movie'
    ? row.event_region === 'IN' && evidence.region === 'IN' && evidence.date_source === 'tmdb_regional_theatrical'
    : row.media_type === 'tv' && row.event_region == null && evidence.region == null && evidence.date_source === 'tmdb_global_first_air';
  if (!sameEvent) return null;
  return review?.type === 'conflict' || (review?.type === 'corroboration' && 'suppressEvent' in review && review.suppressEvent) ? review : null;
}

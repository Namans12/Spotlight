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
  if (row.origin === 'district_in' && Number(row.tmdb_id) === 1395627 && row.media_type === 'movie' &&
      row.entry_type === 'Movie' && row.language === 'te' && row.title === 'Vrushakarma' && row.release_date === '2026-12-31' &&
      row.source_url === 'https://www.district.in/movies/vrushakarma-movie-tickets-in-hyderabad-MV210428') {
    return { type: 'conflict' as const, checkedAt: '2026-11-10', suppressTitleLink: true, source: 'BookMyShow',
      sourceUrl: 'https://in.bookmyshow.com/movies/dehradun/vrushakarma/ET00472260',
      message: 'Date needs review: BookMyShow lists the Telugu film for 4 December in India, while this legacy entry lists 31 December. The linked TMDB identity and this event remain unconfirmed.' };
  }
  if (row.origin === 'tmdb_upcoming' && Number(row.tmdb_id) === 1450342 && row.media_type === 'movie' &&
      row.entry_type === 'Movie' && row.language === 'te' && row.title === 'Bhogi' && row.release_date === '2026-11-12' &&
      row.source_url === 'https://www.themoviedb.org/movie/1450342') {
    return { type: 'conflict' as const, checkedAt: '2026-11-10', source: '123telugu',
      sourceUrl: 'https://www.123telugu.com/mnews/sharwanands-bhogi-postponed-heres-why-hk.html',
      message: 'Date needs review: local reporting says the announced 12 November release has been postponed; no replacement date is confirmed here.' };
  }
  if (row.origin === 'wikipedia' && row.entry_type === 'Movie' &&
      (row.media_type === 'movie' || (row.media_type == null && row.tmdb_id == null && row.title === 'Donga Naa Koduku'))) {
    if (row.tmdb_id == null && row.language === 'te' && row.source_url === 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026') {
      if (row.release_date === '2026-11-13' && (row.title === 'Chandrayan' || row.title === 'Donga Naa Koduku')) {
        return { type: 'regional' as const, region: 'IN', checkedAt: '2026-11-10', source: 'BookMyShow',
          sourceUrl: row.title === 'Chandrayan' ? 'https://in.bookmyshow.com/movies/bengaluru/chandrayan/ET00522567' : 'https://in.bookmyshow.com/movies/bengaluru/donga-naa-koduku/ET00521157',
          message: 'BookMyShow lists the Telugu film for 13 November in India; bookings were not yet open when checked. The TMDB identity remains unverified.' };
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
      if (row.title === 'Aakasamlo Oka Tara' && row.release_date === '2026-11-20') {
        return { type: 'corroboration' as const, checkedAt: '2026-11-10', source: 'Telangana Today',
          sourceUrl: 'https://telanganatoday.com/dulquer-salmaans-aakasamlo-oka-tara-gets-november-20-release-date',
          message: 'Reporting cites the producers’ 20 November theatrical announcement. The TMDB identity and local release event remain unconfirmed.' };
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
    return { type: 'conflict' as const, checkedAt: '2026-11-10', suppressTitleLink: true, source: 'Bollywood Hungama',
      sourceUrl: 'https://www.bollywoodhungama.com/news/bollywood/scoop-akshay-kumar-shraddha-kapoors-second-consecutive-box-office-clash-averted-as-akshay-vidya-balan-comic-caper-pushed-to-2027-eetha-gets-solo-december-4-release/',
      message: 'Date needs review: the original date and producers match an Anees Bazmee comedy reported as Mauja Hi Mauja, but trade reporting says it may leave 4 December. The title match and replacement date remain unconfirmed.' };
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

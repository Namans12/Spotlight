import { describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';
import { getCalendarMonth } from './calendarDb';

const release = (overrides: Record<string, unknown> = {}) => ({
  tmdb_id: 1, media_type: 'movie', title: 'Title', language: 'en', release_date: '2026-11-10',
  rating: null, poster_url: null, overview: null, providers: ['Netflix'],
  evidence: { source_url: 'https://www.themoviedb.org/movie/1', observed_at: '2026-11-09T00:00:00Z', provider_types: { Netflix: ['subscription'] } }, ...overrides,
});
const editorial = (overrides: Record<string, unknown> = {}) => ({
  id: 1, tmdb_id: 1, media_type: 'movie', title: 'Title', language: 'en', entry_type: 'Movie',
  release_date: '2026-11-10', platform_or_distributor: 'Netflix', details: null, poster_url: null,
  origin_region: null, origin_release_date: null, event_region: 'IN',
  evidence: { date_source: 'tmdb_regional_theatrical', source_url: 'https://www.themoviedb.org/movie/1' }, ...overrides,
});
function db(releases: unknown[], calendar: unknown[]) {
  return vi.fn().mockResolvedValueOnce(releases).mockResolvedValueOnce(calendar);
}

describe('calendar event identity', () => {
  it.each([
    [1733518, 'Bouma', 'ml', '2026-11-12', 'Cinema Express'],
    [1440539, 'Itllu Arjuna', 'te', '2026-11-13', 'BookMyShow'],
  ])('scopes the reviewed theatrical announcement for %s to India only', async (id, title, language, release_date, source) => {
    const item = editorial({ origin: 'tmdb_upcoming', tmdb_id: id, title, language, release_date,
      source_url: `https://www.themoviedb.org/movie/${id}`, event_region: null, evidence: null });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, language: 'en' }]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries.find(entry => entry.dateCorroboration?.source === source)?.region).toBe('IN');
    expect(entries.filter(entry => entry.dateCorroboration?.source === source)).toHaveLength(1);
    expect(await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-11', 'US')).toEqual([]);
  });
  it('scopes the exact Telugu High announcement to India while leaving its identity unresolved', async () => {
    const item = editorial({ origin: 'wikipedia', tmdb_id: null, title: 'High', language: 'te', release_date: '2026-11-27',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026', event_region: null, evidence: null });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, language: 'en' }]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries[0].region).toBe('IN');
    expect(entries[0].tmdbId).toBeNull();
    expect(entries[0].dateCorroboration?.source).toBe('Ticketnew');
    expect(entries[1].region).toBeNull();
    expect(await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-11', 'US')).toEqual([]);
  });
  it('scopes the reviewed Ebenezer announcement to India without asserting bookings', async () => {
    const item = editorial({ origin: 'district_in', tmdb_id: 1567605, title: 'Ebenezer', language: 'en', release_date: '2026-11-20',
      source_url: 'https://www.district.in/movies/ebenezer-movie-tickets-in-hyderabad-MV213946', event_region: null, evidence: null });
    const [entry] = await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entry.region).toBe('IN');
    expect(entry.dateCorroboration?.message).toContain('bookings were not yet open');
    expect(await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-11', 'US')).toEqual([]);
  });
  it('keeps reviewed source evidence when merging the same verified event in either order', async () => {
    const reviewed = editorial({ origin: 'district_in', tmdb_id: 1567605, title: 'Ebenezer', language: 'en', release_date: '2026-11-20',
      source: 'District', source_url: 'https://www.district.in/movies/ebenezer-movie-tickets-in-hyderabad-MV213946', event_region: null, evidence: null });
    const tmdb = editorial({ id: 2, origin: 'tmdb_upcoming', tmdb_id: 1567605, title: 'Ebenezer', language: 'en', release_date: '2026-11-20',
      source: 'TMDB', source_url: 'https://www.themoviedb.org/movie/1567605', event_region: 'IN',
      evidence: { date_source: 'tmdb_regional_theatrical', source_url: 'https://www.themoviedb.org/movie/1567605', observed_at: '2026-11-09T00:00:00Z' } });
    for (const rows of [[tmdb, reviewed], [reviewed, tmdb]]) {
      const entries = await getCalendarMonth(db([], rows) as unknown as postgres.Sql, '2026-11', 'IN');
      expect(entries).toHaveLength(1);
      expect(entries[0].dateCorroboration?.source).toBe('BookMyShow');
      expect(entries[0].additionalSources).toHaveLength(1);
      expect([entries[0].source, entries[0].additionalSources?.[0].source].join(' ')).toContain('TMDB');
      expect([entries[0].source, entries[0].additionalSources?.[0].source].join(' ')).toContain('BookMyShow');
      expect(entries[0].reviewFreshness).toBeTruthy();
    }
  });
  it('flags the legacy Paper Tiger date without asserting that different regions share an event', async () => {
    const item = editorial({ origin: 'district_in', tmdb_id: 1381273, title: 'Paper Tiger', language: 'en', release_date: '2026-11-20',
      source_url: 'https://www.district.in/movies/paper-tiger-movie-tickets-in-hyderabad-MV227340', event_region: null, evidence: null });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, language: 'te' }]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries.filter(entry => entry.dateConflict)).toHaveLength(1);
    expect(entries.find(entry => entry.dateConflict)?.tmdbId).toBeNull();
    expect(entries.find(entry => entry.dateConflict)?.dateConflict?.message).toContain('27 November');
  });
  it('flags the exact legacy NBK111 date without creating a title link', async () => {
    const item = editorial({ origin: 'district_in', tmdb_id: null, media_type: null, title: 'NBK111', language: 'te', release_date: '2026-12-31',
      source_url: 'https://www.district.in/movies/nbk111-movie-tickets-in-hyderabad-MV224943', event_region: null, evidence: null });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, language: 'en' }]) as unknown as postgres.Sql, '2026-12', 'IN');
    expect(entries.filter(entry => entry.dateConflict)).toHaveLength(1);
    expect(entries.find(entry => entry.dateConflict)?.dateConflict?.message).toContain('24 December');
    expect(entries.find(entry => entry.dateConflict)?.tmdbId).toBeNull();
  });
  it('flags the legacy Vrushakarma date without asserting the linked title identity', async () => {
    const item = editorial({ origin: 'district_in', tmdb_id: 1395627, title: 'Vrushakarma', language: 'te', release_date: '2026-12-31',
      source_url: 'https://www.district.in/movies/vrushakarma-movie-tickets-in-hyderabad-MV210428', event_region: null, evidence: null });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, release_date: '2026-12-30' }]) as unknown as postgres.Sql, '2026-12', 'IN');
    const warning = entries.find(entry => entry.dateConflict);
    expect(warning?.dateConflict?.message).toContain('4 December');
    expect(warning?.tmdbId).toBeNull();
    expect(warning?.region).toBeNull();
    expect(entries.filter(entry => entry.dateConflict)).toHaveLength(1);
  });
  it('flags the exact TMDB Bhogi observation without transferring the warning to other records', async () => {
    const item = editorial({ origin: 'tmdb_upcoming', tmdb_id: 1450342, title: 'Bhogi', language: 'te', release_date: '2026-11-12',
      source_url: 'https://www.themoviedb.org/movie/1450342', event_region: null, evidence: null });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, release_date: '2026-11-13' },
      { ...item, id: 3, language: 'en' }]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries.find(entry => entry.dateConflict)?.dateConflict?.source).toBe('123telugu');
    expect(entries.filter(entry => entry.dateConflict)).toHaveLength(1);
  });
  it.each(['Talcum Powder', 'Itlu Arjuna', 'Chandrayan', 'Donga Naa Koduku'])('uses a scoped Indian ticketing announcement for %s only for the exact Telugu record and region', async (title) => {
    const item = editorial({ origin: 'wikipedia', tmdb_id: null, media_type: title === 'Donga Naa Koduku' ? null : 'movie', title, language: 'te', release_date: '2026-11-13',
      source: 'wikipedia', source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026', event_region: null, evidence: null });
    const [entry, mismatch] = await getCalendarMonth(db([], [item, { ...item, id: 2, language: 'en' }]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entry.region).toBe('IN');
    expect(entry.evidenceStatus).toBe('regional');
    expect(entry.tmdbId).toBeNull();
    expect(entry.source).toBe('wikipedia / BookMyShow');
    expect(entry.dateCorroboration?.message).toContain('bookings were not yet open');
    expect(mismatch.region).toBeNull();
    expect(mismatch.evidenceStatus).toBe('unverified');
    expect(await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-11', 'US')).toEqual([]);
  });

  it.each([
    ['Aakasamlo Oka Tara', '2026-11-20', 'Telangana Today'],
    ['Dear Astronaut', '2026-11-20', 'Cinema Express'],
  ])('adds reporting for the exact Telugu record without assigning a region', async (title, release_date, source) => {
    const item = editorial({ origin: 'wikipedia', tmdb_id: null, title, language: 'te', release_date,
      source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026', event_region: null, evidence: null });
    const [entry] = await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entry.dateCorroboration?.source).toBe(source);
    expect(entry.region).toBeNull();
    expect(entry.evidenceStatus).toBe('unverified');
  });
  it('warns that reporting conflicts with the announced Jayannth release date', async () => {
    const item = editorial({ origin: 'wikipedia', tmdb_id: null, title: 'Jayannth And The Jingo Pen', language: 'te', release_date: '2026-11-12',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026', event_region: null, evidence: null });
    const [entry] = await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entry.dateConflict?.source).toBe('The Hans India');
    expect(entry.dateConflict?.message).toContain('14 November');
    expect(entry.dateCorroboration).toBeNull();
    expect(entry.region).toBeNull();
  });
  it('collapses only byte-identical Wikipedia observations and preserves different evidence', async () => {
    const item = editorial({ origin: 'wikipedia', event_region: null, evidence: null, observation_fingerprint: 'same observation' });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2 },
      { ...item, id: 3, observation_fingerprint: 'different source or evidence' },
      { ...item, id: 4, origin: 'csv_seed' }]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries).toHaveLength(3);
  });
  it.each([
    [1450342, 'Bhogi', '2026-11-12', 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026', 'conflict'],
    [1434462, 'Melcow Pondicherry', '2026-11-12', 'https://en.wikipedia.org/wiki/List_of_Malayalam_films_of_2026', 'conflict'],
  ])('attaches scoped regional reporting for the specific Wikipedia row', async (tmdb_id, title, release_date, source_url, kind) => {
    const item = editorial({ origin: 'wikipedia', tmdb_id, title, release_date, source_url, event_region: null, evidence: null });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, source_url: 'https://example.com' }]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(kind === 'conflict' ? entries[0].dateConflict : entries[0].dateCorroboration).toBeTruthy();
    expect(entries[0].region).toBeNull();
    expect(entries[1].dateConflict ?? entries[1].dateCorroboration).toBeNull();
  });
  it('flags the specific untitled film without asserting a replacement date or transferring the warning', async () => {
    const item = editorial({ origin: 'csv_seed', tmdb_id: 1774728, media_type: 'movie', entry_type: 'Movie', title: 'Untitled film',
      release_date: '2026-12-04', platform_or_distributor: 'Sri Venkateswara Creations, Cape of Good Films',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Hindi_films_of_2026', event_region: null, evidence: null });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, platform_or_distributor: 'Other' }]) as unknown as postgres.Sql, '2026-12', 'IN');
    expect(entries[0].dateConflict?.message).toContain('title match and replacement date remain unconfirmed');
    expect(entries[0].releaseDate).toBe('2026-12-04');
    expect(entries[0].title).toBe('Untitled film');
    expect(entries[0].region).toBeNull();
    expect(entries[0].tmdbId).toBeNull();
    expect(entries[0].posterUrl).toBeNull();
    expect(entries[1].tmdbId).toBe(1774728);
    expect(entries[1].dateConflict).toBeNull();
  });
  it.each([
    [null, null, 'Show', 'Off the Scales', '2026-11-11', 'TLC', 'https://deadline.com/feature/2026-tv-premiere-dates-1236391902/', 'Boston.com'],
    [null, null, 'Show', 'Harry Potter and the Philosopher’s Stone', '2026-12-25', 'HBO Max', 'https://deadline.com/feature/2026-tv-premiere-dates-1236391902/', 'Warner Bros. Discovery'],
    [null, null, 'Movie', 'Ebenezer: A Christmas Carol', '2026-11-13', 'Paramount Pictures', 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026', 'Paramount'],
    [1372443, 'movie', 'Movie', 'Mr. Irrelevant', '2026-12-25', 'Paramount Pictures / Skydance Sports', 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026', 'Paramount'],
    [1421903, 'movie', 'Movie', 'Werwulf', '2026-12-25', 'Focus Features', 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026', 'Focus Features'],
    [1634124, 'movie', 'Movie', 'Nutmeg & Mistletoe', '2026-12-25', 'Abyssal Films', 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026', 'The Numbers'],
  ])('attaches scoped evidence to the exact reviewed entry %s %s %s %s', async (tmdb_id, media_type, entry_type, title, release_date, platform_or_distributor, source_url, source) => {
    const item = editorial({ origin: 'csv_seed', tmdb_id, media_type, entry_type, title, release_date, platform_or_distributor, source_url, event_region: null, evidence: null });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, source_url: 'https://example.com' }]) as unknown as postgres.Sql, '2026-12', 'IN');
    expect(entries[0].dateCorroboration?.source).toBe(source);
    expect(entries[0].region).toBeNull();
    expect(entries[0].evidenceStatus).toBe('unverified');
    expect(entries[1].dateCorroboration).toBeNull();
  });

  it('flags the conflicting A Place in Hell theatrical date without replacing it', async () => {
    const item = editorial({ origin: 'csv_seed', tmdb_id: 1437882, title: 'A Place in Hell', release_date: '2026-12-25',
      source_url: 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026', event_region: null, evidence: null });
    const [entry] = await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-12', 'IN');
    expect(entry.dateConflict?.message).toContain('23 April 2027');
    expect(entry.releaseDate).toBe('2026-12-25');
    expect(entry.region).toBeNull();
  });
  it.each([
    [1457866, 'THE FURTHER MIS-ADVENTURES OF CLIFF BOOTH', '2026-11-25', 'Netflix / Plan B Entertainment / Heyday Films', 'theatrical'],
    [1137888, 'The Man with the Bag', '2026-12-02', 'Amazon MGM Studios', 'streaming'],
  ])('corrects the event kind for a specifically reviewed announcement', async (tmdb_id, title, release_date, platform_or_distributor, expectedKind) => {
    const item = editorial({ origin: 'csv_seed', tmdb_id, title, release_date, platform_or_distributor, event_region: null, evidence: null,
      source_url: 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026' });
    const [entry] = await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entry.kind).toBe(expectedKind);
    expect(entry.platforms).toEqual([]);
    expect(entry.region).toBeNull();
    expect(entry.dateCorroboration?.sourceUrl).toMatch(/^https:\/\//);
    expect(entry.evidenceStatus).toBe('unverified');
  });

  it.each([
    [1131943, 'Madden', '2026-11-26', 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026'],
    [1389146, 'Ranger', '2026-12-04', 'https://en.wikipedia.org/wiki/List_of_Hindi_films_of_2026'],
    [1411089, 'Shakti Shalini', '2026-12-24', 'https://en.wikipedia.org/wiki/List_of_Hindi_films_of_2026'],
  ])('flags additional conflicting reporting without changing the stored date', async (tmdb_id, title, release_date, source_url) => {
    const item = editorial({ origin: 'csv_seed', tmdb_id, title, release_date, source_url, event_region: null, evidence: null });
    const [entry] = await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entry.dateConflict?.message).toContain('Date needs review');
    expect(entry.releaseDate).toBe(release_date);
    expect(entry.region).toBeNull();
  });

  it('limits a warning for an unmatched title to the named distributor', async () => {
    const item = editorial({ origin: 'csv_seed', tmdb_id: null, media_type: null, title: 'Zero A. D.', release_date: '2026-12-25',
      platform_or_distributor: 'Angel Studios', event_region: null, evidence: null, source_url: 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026' });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, platform_or_distributor: 'Other' }]) as unknown as postgres.Sql, '2026-12', 'IN');
    expect(entries[0].dateConflict?.source).toBe('Angel Studios');
    expect(entries[1].dateConflict).toBeNull();
  });

  it('shows the distributor announcement without claiming a regional date', async () => {
    const item = editorial({ origin: 'csv_seed', tmdb_id: 1209723, title: 'Yeh Prem Mol Liya', release_date: '2026-11-27',
      event_region: null, evidence: null, source_url: 'https://en.wikipedia.org/wiki/List_of_Hindi_films_of_2026' });
    const [entry] = await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entry.dateCorroboration?.source).toBe('Yash Raj Films');
    expect(entry.region).toBeNull();
  });
  it('attaches a season announcement only to the reviewed Chosen event', async () => {
    const item = editorial({ origin: 'csv_seed', tmdb_id: 85077, media_type: 'tv', entry_type: 'Show', title: 'The Chosen',
      release_date: '2026-11-15', event_region: null, evidence: null,
      source_url: 'https://deadline.com/feature/2026-tv-premiere-dates-1236391902/' });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, tmdb_id: 85078 }]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries[0].seasonPremiere?.season).toBe(6);
    expect(entries[0].seasonPremiere?.coverage).toContain('selected international markets');
    expect(entries[0].region).toBeNull();
    expect(entries[1].seasonPremiere).toBeNull();
  });

  it.each([
    [1300968, 'The Hunger Games: Sunrise on the Reaping', '2026-11-20'],
    [1400336, 'Focker-in-Law', '2026-11-25'], [1538497, 'Hexed', '2026-11-25'],
    [1078446, 'Violent Night 2', '2026-12-04'], [1003596, 'Avengers: Doomsday', '2026-12-18'],
    [1300926, 'The Angry Birds Movie 3', '2026-12-23'],
  ])('corroborates the North American schedule for %s without asserting India', async (tmdb_id, title, release_date) => {
    const item = editorial({ origin: 'csv_seed', tmdb_id, title, release_date, event_region: null, evidence: null,
      source_url: 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026' });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, source_url: 'https://example.com' }]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries[0].dateCorroboration?.source).toBe('Cinema United');
    expect(entries[0].region).toBeNull();
    expect(entries[0].evidenceStatus).toBe('unverified');
    expect(entries[1].dateCorroboration).toBeNull();
  });

  it.each([
    [1288211, 'The Great Beyond', '2026-11-13'],
    [1280115, 'Way of the Warrior Kid', '2026-11-20'],
    [1461490, 'Hershey', '2026-11-26'],
  ])('flags a disputed date for %s without replacing it', async (tmdb_id, title, release_date) => {
    const item = editorial({ origin: 'csv_seed', tmdb_id, title, release_date, event_region: null, evidence: null,
      source_url: 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026' });
    const [entry] = await getCalendarMonth(db([], [item]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entry.dateConflict?.message).toContain('Date needs review');
    expect(entry.releaseDate).toBe(release_date);
    expect(entry.region).toBeNull();
  });
  it('attaches a studio season announcement without claiming a regional offer', async () => {
    const item = editorial({ origin: 'csv_seed', tmdb_id: 84773, media_type: 'tv', entry_type: 'Show',
      title: 'The Lord of the Rings: The Rings of Power', release_date: '2026-11-11', event_region: null,
      source_url: 'https://deadline.com/feature/2026-tv-premiere-dates-1236391902/', evidence: null });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, release_date: '2026-11-12' }]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries[0].seasonPremiere?.season).toBe(3);
    expect(entries[0].kind).toBe('global_premiere');
    expect(entries[0].region).toBeNull();
    expect(entries[0].platforms).toEqual([]);
    expect(entries[1].seasonPremiere).toBeNull();
  });

  it('flags a disputed editorial date without changing it or transferring the warning to a different source', async () => {
    const item = editorial({ origin: 'csv_seed', tmdb_id: 1286656, title: 'I Play Rocky', release_date: '2026-11-13',
      event_region: null, evidence: null, source_url: 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026' });
    const entries = await getCalendarMonth(db([], [item, { ...item, id: 2, source_url: 'https://example.com/' }]) as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries[0].dateConflict?.message).toContain('Date needs review');
    expect(entries[0].releaseDate).toBe('2026-11-13');
    expect(entries[0].region).toBeNull();
    expect(entries[1].dateConflict).toBeNull();
  });
  it('merges only the same region, type, title identity, date and event kind and preserves providers', async () => {
    const sql = db([
      release(), release({ providers: ['Amazon Prime'] }),
      release({ tmdb_id: 2 }), release({ media_type: 'tv' }),
      release({ release_date: '2026-11-11' }), release({ title: 'Title Season 2' }),
    ], [editorial({ platform_or_distributor: 'Studio / Netflix / ZEE5' }),
      editorial({ id: 2, platform_or_distributor: 'Studio' }),
      editorial({ id: 3, event_region: null }), editorial({ id: 4, event_region: null })]);
    const entries = await getCalendarMonth(sql as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries).toHaveLength(8);
    expect(entries.find(e => e.tmdbId === 1 && e.region === 'IN' && e.kind === 'streaming' && e.title === 'Title')?.platforms)
      .toEqual(['Netflix', 'Amazon Prime', 'ZEE5']);
    expect(entries.find(e => e.tmdbId === 1 && e.region === 'IN' && e.kind === 'streaming')?.availabilityTypes?.Netflix).toEqual(['subscription']);
    expect(entries.find(e => e.tmdbId === 1 && e.region === 'IN' && e.kind === 'streaming')?.source).toBe('TMDB / JustWatch');
    expect(entries.filter(e => e.region === null)).toHaveLength(2);
    expect(entries.some(e => e.kind === 'theatrical')).toBe(true);
    const firstSql = String(sql.mock.calls[0][0].join('?'));
    expect(firstSql).not.toContain('DISTINCT ON');
    expect(sql.mock.calls[0]).toContain('IN');
    expect(sql.mock.calls[1]).toContain('IN');
  });

  it('keeps unresolved titles separate even when their names and dates match', async () => {
    const sql = db([], [editorial({ tmdb_id: null, event_region: 'IN' }), editorial({ id: 2, tmdb_id: null, event_region: 'IN' })]);
    const entries = await getCalendarMonth(sql as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries).toHaveLength(2);
  });
  it('labels global first-air evidence without asserting local networks or availability', async () => {
    const sql = db([], [editorial({ entry_type: 'Show', media_type: 'tv', event_region: null,
      source: 'TMDB', platform_or_distributor: 'Netflix', evidence: { date_source: 'tmdb_global_first_air', source_url: 'https://www.themoviedb.org/tv/1', observed_at: '2026-11-09T00:00:00Z' } })]);
    const [entry] = await getCalendarMonth(sql as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entry.kind).toBe('global_premiere');
    expect(entry.evidenceStatus).toBe('global');
    expect(entry.region).toBeNull();
    expect(entry.platforms).toEqual([]);
  });

  it('merges verified observations of the same global first-air event', async () => {
    const item = editorial({ entry_type: 'Show', media_type: 'tv', event_region: null,
      source: 'TMDB', platform_or_distributor: 'Netflix', evidence: { date_source: 'tmdb_global_first_air', source_url: 'https://www.themoviedb.org/tv/1', observed_at: '2026-11-09T00:00:00Z' } });
    const sql = db([], [item, { ...item, id: 2 }, { ...item, id: 3, release_date: '2026-11-11' }]);
    const entries = await getCalendarMonth(sql as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.kind === 'global_premiere' && e.platforms.length === 0)).toBe(true);
  });

  it('attributes a corroborated editorial movie date to TMDB as well as its original source', async () => {
    const sql = db([], [editorial({ source: 'wikipedia', event_region: 'IN', platform_or_distributor: null,
      evidence: { region: 'IN', date_source: 'tmdb_regional_theatrical', source_url: 'https://www.themoviedb.org/movie/1' } })]);
    const [entry] = await getCalendarMonth(sql as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entry.source).toBe('wikipedia / TMDB');
    expect(entry.evidenceStatus).toBe('regional');
  });

  it('never treats evidence for a missing or different identity as regional', async () => {
    const sql = db([], [editorial({ tmdb_id: null }), editorial({ id: 2, tmdb_id: 12 })]);
    const entries = await getCalendarMonth(sql as unknown as postgres.Sql, '2026-11', 'IN');
    expect(entries.every(e => e.region === null && e.evidenceStatus === 'unverified' && e.observedAt === null)).toBe(true);
    expect(String(sql.mock.calls[1][0].join('?'))).toContain("evidence->>'source_url'");
  });
});

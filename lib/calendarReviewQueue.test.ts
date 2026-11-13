import { describe, expect, it } from 'vitest';
import { reviewFreshness } from '../shared/calendarFreshness';
import { buildCalendarReviewQueue, type ReviewQueueRow } from './calendarReviewQueue';

const now = new Date('2026-12-10T00:00:00Z');
const row = (patch: Partial<ReviewQueueRow> = {}): ReviewQueueRow => ({
  id: 1, origin: 'csv_seed', tmdb_id: 123, media_type: 'movie', title: 'Film', release_date: '2026-12-20',
  source_url: 'https://example.org', entry_type: 'Movie', platform_or_distributor: 'Studio', event_region: null, evidence: null, ...patch,
});

describe('calendar evidence freshness', () => {
  it('uses a 30-day threshold and rejects invalid, missing and future observations', () => {
    expect(reviewFreshness('2026-11-11', now)).toBe('fresh');
    expect(reviewFreshness('2026-11-10', now)).toBe('stale');
    expect(reviewFreshness('2026-11-10T00:00:00Z', now)).toBe('stale');
    expect(reviewFreshness('2026-12-09T00:00:00.789013+00:00', now)).toBe('fresh');
    expect(reviewFreshness('2026-02-30', now)).toBe('unknown');
    expect(reviewFreshness('2026-12-11', now)).toBe('unknown');
    expect(reviewFreshness(null, now)).toBe('unknown');
  });
});

describe('calendar reconciliation queue', () => {
  it('flags the wrong stored Love & War identity while exposing the reviewed match', () => {
    const item = row({ origin: 'district_in', tmdb_id: 1555752, title: 'Love & War', language: 'en', release_date: '2027-01-21',
      source_url: 'https://www.district.in/movies/love-war-movie-tickets-in-hyderabad-MV169730', event_region: null, evidence: null, platform_or_distributor: null });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-13T19:00:00Z'));
    expect(review).toMatchObject({ tmdbId: 1555752, reviewedTmdbId: 1235057, region: 'IN' });
    expect(review.reasons).toContain('identity_conflict');
  });
  it.each([
    [1411614, 'Raaka', 'te', 'raaka', 'MV218847', false],
    [1389373, 'Rowdy Janardhana', 'te', 'rowdy-janardhana', 'MV212225', false],
    [1562979, 'Dharman', 'ta', 'dharman', 'MV226468', false],
    [1387155, 'Mahavatar', 'hi', 'mahavatar', 'MV183233', true],
    [1475768, 'Maatrubhumi: May War Rest in Peace', 'hi', 'maatrubhumi-may-war-rest-in-peace', 'MV201390', true],
    [1469537, 'Slumdog: 33 Temple Road', 'ta', 'slumdog-33-temple-road', 'MV213661', false],
  ])('retains reviewed year-end uncertainty for %s', (id, title, language, slug, key, conflict) => {
    const item = row({ origin: 'district_in', tmdb_id: id, title, language, release_date: '2026-12-31', platform_or_distributor: null,
      source_url: `https://www.district.in/movies/${slug}-movie-tickets-in-hyderabad-${key}` });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-13T16:00:00Z'));
    expect(review.reasons).toContain('region_unknown');
    expect(review.reasons.includes('date_conflict')).toBe(conflict);
    expect(review.reviewSourceUrl).toMatch(/^https:\/\//);
  });
  it.each([
    ['OM Chapter 1: Udhiram - The Blood Wood', 'ta', '2026-11-26', 1384528],
    ['OM Chapter 1: Udhiram - The Blood Wood', 'ta', '2026-11-27', 1384528],
    ['NBK111', 'te', '2026-12-11', 1494621],
  ])('flags the unresolved older %s observation while retaining its missing identity', (title, language, release_date, sourceId) => {
    const item = row({ origin: 'tmdb_upcoming', tmdb_id: null, media_type: null, title, language, release_date,
      source_url: `https://www.themoviedb.org/movie/${sourceId}`, platform_or_distributor: null });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-13T16:00:00Z'));
    expect(review.reasons).toEqual(expect.arrayContaining(['date_conflict', 'identity_missing', 'region_unknown']));
    expect(review.reviewSourceUrl).toContain('indiatoday.in');
    const [changed] = buildCalendarReviewQueue([{ ...item, source_url: 'https://example.org' }], new Date('2026-11-13T16:00:00Z'));
    expect(changed.reasons).not.toContain('date_conflict');
  });
  it('keeps regional review and source freshness separate after a TMDB refresh', () => {
    const item = row({ origin: 'tmdb_upcoming', tmdb_id: 1735403, title: 'Brindavihari', language: 'kn', release_date: '2026-11-20',
      source_url: 'https://www.themoviedb.org/movie/1735403', platform_or_distributor: null, event_region: 'IN',
      evidence: { region: 'IN', date_source: 'tmdb_regional_theatrical', source_url: 'https://www.themoviedb.org/movie/1735403', observed_at: '2026-10-01T00:00:00Z' } });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-13T16:00:00Z'));
    expect(review.reasons).toContain('evidence_stale');
    expect(review.reasons).not.toContain('review_stale');
    expect(review.reviewSourceUrl).toContain('bookmyshow.com');
    expect(review.evidenceObservedAt).toBe('2026-10-01T00:00:00Z');
    expect(review.reviewCheckedAt).toBe('2026-11-13T15:02:00Z');
  });
  it('distinguishes the missing stored identity from the reviewed match', () => {
    const item = row({ origin: 'wikipedia', tmdb_id: null, title: 'Aakasamlo Oka Tara', language: 'te', release_date: '2026-11-20',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026', platform_or_distributor: null });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-13T15:00:00Z'));
    expect(review.region).toBe('IN');
    expect(review.tmdbId).toBeNull();
    expect(review.reviewedTmdbId).toBe(1322273);
    expect(review.reasons).toContain('identity_missing');
    expect(review.reasons).not.toContain('region_unknown');
    const [changed] = buildCalendarReviewQueue([{ ...item, release_date: '2026-11-21' }], new Date('2026-11-13T15:00:00Z'));
    expect(changed.reviewedTmdbId).toBeNull();
  });
  it('tracks the observation and manual review freshness independently', () => {
    const item = row({ origin: 'tmdb_upcoming', tmdb_id: 310209, media_type: 'tv', entry_type: 'Show', title: 'Nine to Six', language: 'ko',
      release_date: '2026-11-11', source_url: 'https://www.themoviedb.org/tv/310209', event_region: null,
      evidence: { date_source: 'tmdb_global_first_air', source_url: 'https://www.themoviedb.org/tv/310209', observed_at: '2026-10-01T00:00:00Z' } });
    const [oldEvidence] = buildCalendarReviewQueue([item], new Date('2026-11-11T06:00:00Z'));
    expect(oldEvidence.reasons).toContain('evidence_stale');
    expect(oldEvidence.reasons).not.toContain('review_stale');
    expect(oldEvidence.evidenceObservedAt).toBe('2026-10-01T00:00:00Z');
    expect(oldEvidence.reviewCheckedAt).toBeTruthy();
    const [oldReview] = buildCalendarReviewQueue([{ ...item, evidence: { ...item.evidence as object, observed_at: '2026-12-11T00:00:00Z' } }], new Date('2026-12-12T00:00:00Z'));
    expect(oldReview.reasons).toContain('review_stale');
    expect(oldReview.reasons).not.toContain('evidence_stale');
    const [missingEvidenceTime] = buildCalendarReviewQueue([{ ...item, evidence: { ...item.evidence as object, observed_at: null } }], new Date('2026-11-11T06:00:00Z'));
    expect(missingEvidenceTime.reasons).toContain('freshness_unknown');
  });
  it('retains a broadcaster conflict after a TMDB first-air observation', () => {
    const item = row({ origin: 'tmdb_upcoming', tmdb_id: 310209, media_type: 'tv', entry_type: 'Show', title: 'Nine to Six', language: 'ko',
      release_date: '2026-11-11', source_url: 'https://www.themoviedb.org/tv/310209', event_region: null,
      evidence: { region: null, date_source: 'tmdb_global_first_air', source_url: 'https://www.themoviedb.org/tv/310209', observed_at: '2026-11-11T05:30:00Z' } });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-11T06:00:00Z'));
    expect(review.reasons).toContain('date_conflict');
    expect(review.reviewSourceUrl).toContain('sbsstar.net');
    const [other] = buildCalendarReviewQueue([{ ...item, evidence: { ...item.evidence as object, source_url: 'https://www.themoviedb.org/tv/999' } }], new Date('2026-11-11T06:00:00Z'));
    expect(other.reasons).not.toContain('date_conflict');
  });
  it('prioritizes the Nine to Six broadcaster date conflict without asserting India', () => {
    const item = row({ origin: 'tmdb_upcoming', tmdb_id: 310209, media_type: 'tv', entry_type: 'Show', title: 'Nine to Six', language: 'ko',
      release_date: '2026-11-11', source_url: 'https://www.themoviedb.org/tv/310209' });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-11T06:00:00Z'));
    expect(review.reasons).toEqual(expect.arrayContaining(['date_conflict', 'region_unknown']));
    expect(review.reviewSourceUrl).toContain('sbsstar.net');
  });
  it('keeps the region unknown for an identity-only review of a US release', () => {
    const item = row({ origin: 'csv_seed', tmdb_id: 1170608, title: 'Dune: Part Three', language: 'en', release_date: '2026-12-18',
      source_url: 'https://en.wikipedia.org/wiki/List_of_American_films_of_2026', platform_or_distributor: 'Warner Bros. Pictures / Legendary Pictures',
      event_region: 'IN', evidence: { region: 'IN', date_source: 'tmdb_regional_theatrical', source_url: 'https://www.themoviedb.org/movie/1170608', observed_at: '2026-11-10T19:00:00Z' } });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-10T20:00:00Z'));
    expect(review.reasons).toContain('region_unknown');
    expect(review.reasons).not.toContain('identity_unverified');
    expect(review.region).toBeNull();
  });
  it('queues the reported Kaaka delay while recognizing its reviewed identity', () => {
    const item = row({ origin: 'wikipedia', tmdb_id: 1533741, title: 'Kaaka', language: 'te', release_date: '2027-01-13',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2027', event_region: 'IN',
      evidence: { region: 'IN', date_source: 'tmdb_regional_theatrical', source_url: 'https://www.themoviedb.org/movie/1533741', observed_at: '2026-11-10T19:00:00Z' } });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-11T06:00:00Z'));
    expect(review.reasons).toEqual(expect.arrayContaining(['date_conflict', 'region_unknown']));
    expect(review.reasons).not.toContain('identity_unverified');
    expect(review.reviewSourceUrl).toContain('deccanchronicle.com');
  });
  it('records a scoped identity review without refreshing the underlying date observation', () => {
    const item = row({ origin: 'wikipedia', tmdb_id: 1733518, title: 'Bouma', language: 'ml', release_date: '2026-11-12',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Malayalam_films_of_2026', event_region: 'IN',
      evidence: { region: 'IN', date_source: 'tmdb_regional_theatrical', source_url: 'https://www.themoviedb.org/movie/1733518', observed_at: '2026-10-01T00:00:00Z' } });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-10T20:00:00Z'));
    expect(review.reasons).toContain('evidence_stale');
    expect(review.reasons).not.toContain('identity_unverified');
    expect(review.region).toBe('IN');
    expect(review.reviewSourceUrl).toContain('cinemaexpress.com');
  });
  it.each(['wikipedia', 'csv_seed', 'district_in'])('queues legacy %s TMDB evidence for independent identity review', origin => {
    const item = row({ origin, event_region: 'IN', evidence: { region: 'IN', date_source: 'tmdb_regional_theatrical',
      source_url: 'https://www.themoviedb.org/movie/123', observed_at: '2026-12-09T00:00:00Z' } });
    const [review] = buildCalendarReviewQueue([item], now);
    expect(review.reasons).toEqual(expect.arrayContaining(['identity_unverified', 'region_unknown']));
    expect(review.region).toBeNull();
  });
  it('does not treat editorial TMDB first-air evidence as an established global event', () => {
    const item = row({ origin: 'csv_seed', media_type: 'tv', event_region: null,
      evidence: { date_source: 'tmdb_global_first_air', source_url: 'https://www.themoviedb.org/tv/123', observed_at: '2026-12-09T00:00:00Z' } });
    const [review] = buildCalendarReviewQueue([item], now);
    expect(review.reasons).toEqual(expect.arrayContaining(['identity_unverified', 'region_unknown']));
    expect(review.reasons).not.toContain('global_premiere_local_unknown');
  });
  it('records the SVC64 announcement and retains its unresolved identity and territory', () => {
    const item = row({ origin: 'wikipedia', tmdb_id: null, title: 'SVC64', language: 'te', release_date: '2027-01-14',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2027' });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-10T19:00:00Z'));
    expect(review.reasons).toEqual(expect.arrayContaining(['identity_missing', 'region_unknown']));
    expect(review.reasons).not.toContain('unreviewed');
    expect(review.reviewSourceUrl).toContain('ntvtelugu.com');
  });
  it('retains duplicate and incorrect identity warnings for the reviewed Romeo Juliet event', () => {
    const item = row({ origin: 'wikipedia', tmdb_id: 1635803, title: 'Romeo Juliet', language: 'en', release_date: '2026-11-13',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026', observation_fingerprint: 'same' });
    const items = buildCalendarReviewQueue([item, { ...item, id: 2 }], new Date('2026-11-10T19:00:00Z'));
    expect(items).toHaveLength(2);
    for (const review of items) {
      expect(review.region).toBe('IN');
      expect(review.reasons).toEqual(expect.arrayContaining(['duplicate_observation', 'identity_unverified', 'identity_conflict']));
      expect(review.reasons).not.toContain('unreviewed');
    }
  });
  it('retains the missing identity of the reviewed High announcement', () => {
    const item = row({ origin: 'wikipedia', tmdb_id: null, title: 'High', language: 'te', release_date: '2026-11-27',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026' });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-11T12:00:00Z'));
    expect(review.region).toBe('IN');
    expect(review.reasons).toContain('identity_missing');
    expect(review.reasons).not.toContain('region_unknown');
  });
  it('flags the legacy Paper Tiger disagreement and keeps the region unknown', () => {
    const item = row({ origin: 'district_in', tmdb_id: 1381273, title: 'Paper Tiger', language: 'en', release_date: '2026-11-20',
      source_url: 'https://www.district.in/movies/paper-tiger-movie-tickets-in-hyderabad-MV227340' });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-10T12:00:00Z'));
    expect(review.reasons).toEqual(expect.arrayContaining(['date_conflict', 'region_unknown']));
    expect(review.reasons).not.toContain('identity_unverified');
  });
  it('flags the legacy NBK111 date while retaining missing identity and region', () => {
    const item = row({ origin: 'district_in', tmdb_id: null, media_type: null, title: 'NBK111', language: 'te', release_date: '2026-12-31',
      source_url: 'https://www.district.in/movies/nbk111-movie-tickets-in-hyderabad-MV224943' });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-10T12:00:00Z'));
    expect(review.reasons).toEqual(expect.arrayContaining(['date_conflict', 'identity_missing', 'region_unknown']));
  });
  it('flags the legacy Vrushakarma date with a reviewed title link', () => {
    const item = row({ origin: 'district_in', tmdb_id: 1395627, title: 'Vrushakarma', language: 'te', release_date: '2026-12-31',
      source_url: 'https://www.district.in/movies/vrushakarma-movie-tickets-in-hyderabad-MV210428' });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-10T12:00:00Z'));
    expect(review.reasons).toEqual(expect.arrayContaining(['date_conflict', 'region_unknown']));
    expect(review.reasons).not.toContain('identity_unverified');
  });
  it('retains the Jayannth date conflict and missing identity for review', () => {
    const item = row({ origin: 'wikipedia', tmdb_id: null, title: 'Jayannth And The Jingo Pen', language: 'te', release_date: '2026-11-12',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026' });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-10T12:00:00Z'));
    expect(review.reasons).toEqual(expect.arrayContaining(['date_conflict', 'identity_missing', 'region_unknown']));
  });
  it('flags the disputed TMDB Bhogi observation as a date conflict', () => {
    const item = row({ origin: 'tmdb_upcoming', tmdb_id: 1450342, title: 'Bhogi', language: 'te', release_date: '2026-11-12',
      source_url: 'https://www.themoviedb.org/movie/1450342' });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-10T12:00:00Z'));
    expect(review.reasons).toContain('date_conflict');
    expect(review.reasons).not.toContain('unreviewed');
    expect(review.reasons).toContain('region_unknown');
  });
  it('flags the older Lambodhara date as a conflict without applying it to other dates', () => {
    const item = row({ origin: 'tmdb_upcoming', tmdb_id: 1805816, title: 'Lambodhara 2.0', language: 'kn', release_date: '2026-11-20',
      platform_or_distributor: null, source_url: 'https://www.themoviedb.org/movie/1805816' });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-11T12:00:00Z'));
    expect(review.reasons).toContain('date_conflict');
    expect(review.reviewSourceUrl).toContain('southsidestudio.in');
    const [different] = buildCalendarReviewQueue([{ ...item, release_date: '2026-11-21' }], new Date('2026-11-11T12:00:00Z'));
    expect(different.reasons).not.toContain('date_conflict');
  });
  it('uses the reviewed India announcement only for the exact ENE Repeat observation', () => {
    const item = row({ origin: 'tmdb_upcoming', tmdb_id: 1505644, title: 'ENE Repeat', language: 'te', release_date: '2026-11-19',
      source_url: 'https://www.themoviedb.org/movie/1505644' });
    const items = buildCalendarReviewQueue([item, { ...item, id: 2, release_date: '2026-11-20' }], new Date('2026-11-11T12:00:00Z'));
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('2');
    expect(items[0].reasons).toEqual(expect.arrayContaining(['unreviewed', 'region_unknown']));
  });
  it.each(['Talcum Powder', 'Itlu Arjuna', 'Chandrayan', 'Donga Naa Koduku'])('recognizes the reviewed regional observation for %s without inventing a TMDB identity', (title) => {
    const item = row({ origin: 'wikipedia', tmdb_id: null, media_type: title === 'Donga Naa Koduku' ? null : 'movie', title, language: 'te', release_date: '2026-11-13',
      platform_or_distributor: title === 'Donga Naa Koduku' ? null : 'Studio', source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026' });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-10T12:00:00Z'));
    expect(review.region).toBe('IN');
    expect(review.reasons).toContain('identity_missing');
    expect(review.reasons).not.toContain('region_unknown');
    expect(review.reviewSourceUrl).toContain('bookmyshow.com');
  });
  it('links only exact Wikipedia observations and keeps both records reviewable', () => {
    const original = row({ id: 1, origin: 'wikipedia', observation_fingerprint: 'same' });
    const items = buildCalendarReviewQueue([original, { ...original, id: 2 },
      { ...original, id: 3, observation_fingerprint: 'different' }, { ...original, id: 4, origin: 'csv_seed' }], now);
    expect(items.find(item => item.id === '1')?.duplicateObservationIds).toEqual(['2']);
    expect(items.find(item => item.id === '2')?.duplicateObservationIds).toEqual(['1']);
    expect(items.find(item => item.id === '1')?.reasons).toContain('duplicate_observation');
    expect(items.find(item => item.id === '3')?.duplicateObservationIds).toEqual([]);
    expect(items.find(item => item.id === '4')?.duplicateObservationIds).toEqual([]);
  });

  it('distinguishes a source-matched global first-air date from an unknown event region', () => {
    const global = row({ id: 1, origin: 'tmdb_upcoming', media_type: 'tv', tmdb_id: 123, evidence: {
      date_source: 'tmdb_global_first_air', source_url: 'https://www.themoviedb.org/tv/123', observed_at: '2026-12-09T00:00:00Z' } });
    const mismatch = row({ id: 2, origin: 'tmdb_upcoming', media_type: 'tv', tmdb_id: 123, evidence: {
      date_source: 'tmdb_global_first_air', source_url: 'https://www.themoviedb.org/tv/999', observed_at: '2026-12-09T00:00:00Z' } });
    const items = buildCalendarReviewQueue([global, mismatch], now);
    expect(items.find(item => item.id === '1')?.reasons).toEqual(['global_premiere_local_unknown']);
    expect(items.find(item => item.id === '2')?.reasons).toEqual(['region_unknown', 'identity_conflict']);
  });
  it('surfaces a regional editorial conflict while preserving the unverified source date', () => {
    const item = row({ origin: 'wikipedia', tmdb_id: 1450342, title: 'Bhogi', release_date: '2026-11-12',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026' });
    const [review] = buildCalendarReviewQueue([item], new Date('2026-11-10T12:00:00Z'));
    expect(review.reasons).toContain('date_conflict');
    expect(review.reviewSourceUrl).toContain('123telugu.com');
    expect(review.releaseDate).toBe('2026-11-12');
  });
  it('prioritizes conflicts and reports separate unresolved region and stale review reasons', () => {
    const conflict = row({ id: 3, tmdb_id: 1774728, title: 'Untitled film', release_date: '2026-12-04',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Hindi_films_of_2026', platform_or_distributor: 'Sri Venkateswara Creations, Cape of Good Films' });
    const items = buildCalendarReviewQueue([row(), conflict], new Date('2026-12-12T00:00:00Z'));
    expect(items[0].id).toBe('3');
    expect(items[0].reasons).toEqual(['date_conflict', 'identity_unverified', 'region_unknown', 'review_stale']);
    expect(items[0].reviewSourceUrl).toContain('timesofindia.indiatimes.com');
    expect(items[1].reasons).toEqual(['unreviewed', 'region_unknown']);
  });

  it('does not promote an observation with missing time or incompatible identity', () => {
    const items = buildCalendarReviewQueue([
      row({ id: 1, origin: 'tmdb_upcoming', event_region: 'IN', evidence: { date_source: 'tmdb_regional_theatrical', source_url: 'https://www.themoviedb.org/movie/123', observed_at: 'invalid' } }),
      row({ id: 2, origin: 'tmdb_upcoming', event_region: 'IN', evidence: { date_source: 'tmdb_regional_theatrical', observed_at: '2026-12-09T00:00:00Z', source_url: 'https://www.themoviedb.org/movie/999' } }),
      row({ id: 3, origin: 'tmdb_upcoming', event_region: 'IN', evidence: { date_source: 'tmdb_regional_theatrical', observed_at: '2026-12-09T00:00:00Z', source_url: 'https://www.themoviedb.org/movie/123' } }),
    ], now);
    expect(items).toHaveLength(2);
    expect(items[0].reasons).toContain('identity_conflict');
    expect(items[1].reasons).toContain('freshness_unknown');
  });

  it('preserves missing identity and flags malformed evidence instead of treating it as verified', () => {
    const [item] = buildCalendarReviewQueue([row({ tmdb_id: null, evidence: 'invalid' })], now);
    expect(item.reasons).toEqual(['unreviewed', 'invalid_evidence', 'identity_missing', 'region_unknown']);
  });

  it('flags observations missing source information even if their timestamp is fresh', () => {
    const [item] = buildCalendarReviewQueue([row({ event_region: 'IN', evidence: { observed_at: '2026-12-09T00:00:00Z' } })], now);
    expect(item.reasons).toContain('evidence_incomplete');
  });
  it('flags TMDB date evidence without a linked identity, media type, or TMDB source', () => {
    const evidence = { date_source: 'tmdb_regional_theatrical', source_url: 'https://www.themoviedb.org/movie/123', observed_at: '2026-12-09T00:00:00Z' };
    const items = buildCalendarReviewQueue([
      row({ id: 1, origin: 'tmdb_upcoming', tmdb_id: null, media_type: null, event_region: 'IN', evidence }),
      row({ id: 2, origin: 'tmdb_upcoming', media_type: null, event_region: 'IN', evidence }),
      row({ id: 3, origin: 'tmdb_upcoming', event_region: 'IN', evidence: { ...evidence, source_url: 'https://example.org/movie/123' } }),
      row({ id: 4, origin: 'tmdb_upcoming', event_region: 'IN', evidence }),
    ], now);
    expect(items).toHaveLength(3);
    for (const item of items) expect(item.reasons).toContain('evidence_incomplete');
    expect(items.find(item => item.id === '1')?.reasons).toContain('identity_missing');
  });
});

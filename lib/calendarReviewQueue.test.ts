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
      expect(review.reasons).toEqual(expect.arrayContaining(['duplicate_observation', 'identity_unverified']));
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
  it.each(['Talcum Powder', 'Itlu Arjuna', 'Chandrayan', 'Donga Naa Koduku'])('recognizes the reviewed regional observation for %s without inventing a TMDB identity', (title) => {
    const item = row({ origin: 'wikipedia', tmdb_id: null, media_type: title === 'Donga Naa Koduku' ? null : 'movie', title, language: 'te', release_date: '2026-11-13',
      source_url: 'https://en.wikipedia.org/wiki/List_of_Telugu_films_of_2026' });
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

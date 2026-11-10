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
    const items = buildCalendarReviewQueue([row(), conflict], now);
    expect(items[0].id).toBe('3');
    expect(items[0].reasons).toEqual(['date_conflict', 'identity_unverified', 'region_unknown', 'evidence_stale']);
    expect(items[0].reviewSourceUrl).toContain('bollywoodhungama.com');
    expect(items[1].reasons).toEqual(['unreviewed', 'region_unknown']);
  });

  it('does not promote an observation with missing time or incompatible identity', () => {
    const items = buildCalendarReviewQueue([
      row({ id: 1, event_region: 'IN', evidence: { date_source: 'tmdb_regional_theatrical', source_url: 'https://www.themoviedb.org/movie/123', observed_at: 'invalid' } }),
      row({ id: 2, event_region: 'IN', evidence: { date_source: 'tmdb_regional_theatrical', observed_at: '2026-12-09T00:00:00Z', source_url: 'https://www.themoviedb.org/movie/999' } }),
      row({ id: 3, event_region: 'IN', evidence: { date_source: 'tmdb_regional_theatrical', observed_at: '2026-12-09T00:00:00Z', source_url: 'https://www.themoviedb.org/movie/123' } }),
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
});

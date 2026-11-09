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
  origin_region: null, origin_release_date: null, event_region: 'IN', ...overrides,
});
function db(releases: unknown[], calendar: unknown[]) {
  return vi.fn().mockResolvedValueOnce(releases).mockResolvedValueOnce(calendar);
}

describe('calendar event identity', () => {
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
});

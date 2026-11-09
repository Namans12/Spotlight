import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler from './releases';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../lib/db.js', () => ({ getDb: () => db.query }));

describe('release digest window', () => {
  it('omits stale and undated records while retaining the window metadata', async () => {
    const row = {
      tmdb_id: '1', media_type: 'movie', title: 'Title', language: 'en',
      release_date: '2026-11-09', rating: null, popularity: '1', overview: '',
      tmdb_url: '', poster_url: null, providers: [], section: 'english',
      window_start: '2026-11-09', window_end: '2026-11-10', generated_at: '2026-11-09',
      evidence: { region: 'IN', date_source: 'tmdb_regional_digital', provider_source: 'tmdb_regional_availability' },
    };
    db.query.mockReset().mockResolvedValueOnce([
      row, { ...row, tmdb_id: '2', release_date: '2026-10-01' },
      { ...row, tmdb_id: '3', release_date: '2026-11-11' },
      { ...row, tmdb_id: '4', release_date: null },
      { ...row, tmdb_id: '5', evidence: null },
      { ...row, tmdb_id: '6', evidence: { ...row.evidence, region: 'US' } },
      { ...row, tmdb_id: '7', providers: ['Foreign'], evidence: { ...row.evidence, provider_source: null } },
    ]).mockResolvedValueOnce([]);
    let body = '';
    const response = { statusCode: 0, setHeader: vi.fn(), end: (value: string) => { body = value; } };
    await handler({ url: '/api/releases?region=IN' } as IncomingMessage, response as unknown as ServerResponse);
    const payload = JSON.parse(body);
    expect(response.statusCode).toBe(200);
    expect(payload.out_now.start).toBe('2026-11-09');
    expect(payload.out_now.sections.english.map((item: { tmdb_id: number }) => item.tmdb_id)).toEqual([1, 7]);
    expect(payload.out_now.sections.english[1].providers).toEqual([]);
  });
});

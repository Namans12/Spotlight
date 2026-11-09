import { describe, expect, it } from 'vitest';
import { fromDigestDTO } from './digest';
import type { ReleaseItemDTO } from '../../shared/types/release';

describe('digest evidence', () => {
  it('keeps legacy cached records explicitly unverified', () => {
    const record: ReleaseItemDTO = { tmdb_id: 1, title: 'A', media_type: 'movie', language: 'en', release_date: '2026-11-09', rating: null, popularity: 1, overview: '', tmdb_url: '', poster_url: null, providers: [] };
    expect(fromDigestDTO(record).evidence).toEqual({});
  });
});

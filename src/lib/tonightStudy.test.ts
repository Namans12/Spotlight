import { describe, expect, it } from 'vitest';
import { createTonightStudy } from './tonightStudy';
import { evaluateOfflineCases, parseOfflineCases } from './tonightOfflineEvaluation';
import type { DuelCandidate } from './duel';
import type { TonightFilters } from './tonight';

const candidate = (id: number, title: string): DuelCandidate => ({ id, title, mediaType: 'movie', posterPath: '/private.jpg',
  overview: 'Not needed in export', releaseDate: '2020-01-01', voteAverage: 8, originalLanguage: 'en', genres: ['Comedy'], runtime: 90 });
const filters: TonightFilters = { mood: '', maxMinutes: null, language: '', services: ['Netflix'], includeRentBuy: false, mediaType: '' };

describe('private evaluation snapshot', () => {
  it('exports only eligible titles in replay order, with no account or poster data', () => {
    const inputs = [candidate(2, 'Zulu'), candidate(1, 'Alpha'), candidate(3, 'Unknown')];
    const study = createTonightStudy(inputs, filters, {}, {}, {
      'movie:1': [{ provider: 'Netflix', type: 'subscription' }], 'movie:2': [{ provider: 'Netflix', type: 'subscription' }],
    });
    expect(study.candidates.map(item => item.title)).toEqual(['Zulu', 'Alpha']);
    expect(JSON.stringify(study)).not.toContain('private.jpg');
    expect(JSON.stringify(study)).not.toContain('Not needed in export');
    study.judgments['movie:1'] = 'relevant';
    study.judgments['movie:2'] = 'not_relevant';
    const parsed = parseOfflineCases({ cases: [study] });
    expect(evaluateOfflineCases(parsed)[0].baseline).toEqual(['movie:2', 'movie:1']);
    filters.services.push('later-change');
    inputs[0].genres?.push('later-change');
    expect(study.filters.services).toEqual(['Netflix']);
    expect(study.candidates[0].genres).toEqual(['Comedy']);
    filters.services.pop();
  });

  it('preserves feedback weights but excludes dismissed items from judgments', () => {
    const items = [candidate(1, 'One'), candidate(2, 'Two')];
    const study = createTonightStudy(items, { ...filters, services: [] }, {}, { 'movie:1': { kind: 'not_interested', genres: ['Comedy'] } }, {});
    expect(study.candidates.map(item => item.id)).toEqual([2]);
    expect(study.feedback['movie:1']).toEqual({ kind: 'not_interested', genres: ['Comedy'] });
  });
});

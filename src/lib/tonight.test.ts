import { describe, expect, it } from 'vitest';
import { rankTonight, type TonightFilters } from './tonight';
import type { DuelCandidate } from './duel';
import type { ProviderOffer } from '../../shared/types/availability';
const candidate = (id: number, over: Partial<DuelCandidate> = {}): DuelCandidate => ({ id, title: `Title ${id}`,
  mediaType: 'movie', posterPath: '/poster.jpg', overview: '', releaseDate: '2020-01-01', voteAverage: 7,
  originalLanguage: 'en', genres: ['Comedy'], runtime: 90, ...over });
const filters: TonightFilters = { mood: '', maxMinutes: null, language: '', services: [], includeRentBuy: false, mediaType: '' };
const offers: Record<number, ProviderOffer[]> = {
  1: [{ provider: 'Netflix', type: 'rent' }, { provider: 'ZEE5', type: 'subscription' }],
  2: [{ provider: 'Netflix', type: 'subscription' }], 3: [],
};
const lookup = (_type: string, id: number) => offers[id];

describe('Tonight ranking', () => {
  it('uses genres as an explainable mood preference, not a hard claim', () => {
    const result = rankTonight([candidate(1, { genres: ['Drama'] }), candidate(2)], { ...filters, mood: 'light' }, {}, lookup);
    expect(result[0].candidate.id).toBe(2);
    expect(result[0].reasons).toContain('Comedy genre fits your mood preference');
    expect(result).toHaveLength(2);
  });
  it('requires time and original language evidence when selected', () => {
    const items = [candidate(1), candidate(2, { runtime: undefined }), candidate(3, { originalLanguage: 'hi' })];
    expect(rankTonight(items, { ...filters, maxMinutes: 90, language: 'en' }, {}, lookup).map(x => x.candidate.id)).toEqual([1]);
  });
  it('matches the selected service and allowed payment on the same offer', () => {
    const items = [candidate(1), candidate(2), candidate(3)];
    expect(rankTonight(items, { ...filters, services: ['Netflix'] }, {}, lookup).map(x => x.candidate.id)).toEqual([2]);
    expect(rankTonight(items, { ...filters, services: ['Netflix'], includeRentBuy: true }, {}, lookup).map(x => x.candidate.id)).toEqual([1, 2]);
  });
  it('does not match a standalone service to its separately listed channel add-on', () => {
    const channel = () => [{ provider: 'MUBI Amazon Channel', type: 'subscription' as const }];
    expect(rankTonight([candidate(1)], { ...filters, services: ['MUBI'] }, {}, channel)).toEqual([]);
    expect(rankTonight([candidate(1)], { ...filters, services: ['MUBI Amazon Channel'] }, {}, channel)).toHaveLength(1);
  });
  it('does not imply that empty or missing provider data is unavailable', () => {
    const result = rankTonight([candidate(3), candidate(4)], filters, {}, lookup);
    expect(result).toHaveLength(2);
    expect(result.map(x => x.offers)).toEqual([[], undefined]);
  });
  it('uses Duel weights and explains only supported matching attributes', () => {
    const result = rankTonight([candidate(1, { genres: ['Drama'] }), candidate(2)], filters, { 'genre:Comedy': 1 }, lookup);
    expect(result[0].candidate.id).toBe(2);
    expect(result[0].reasons).toContain('Shares attributes with your Duel choice');
  });
  it('applies feedback without relaxing availability filters', () => {
    const items = [candidate(1, { genres: ['Drama'] }), candidate(2), candidate(3, { genres: ['Drama'] })];
    const selected = { ...filters, services: ['Netflix'] };
    const baseline = rankTonight(items, selected, {}, lookup);
    expect(rankTonight(items, selected, {}, lookup, {})).toEqual(baseline);
    const result = rankTonight(items, selected, {}, lookup, { 'genre:Comedy': -1 });
    expect(result.map(x => x.candidate.id)).toEqual([2]);
    expect(rankTonight(items, filters, {}, lookup, { 'genre:Comedy': -1 })[0].candidate.genres).toEqual(['Drama']);
  });
});

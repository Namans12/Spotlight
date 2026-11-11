import { describe, expect, it } from 'vitest';
import { evaluateOfflineCases, parseOfflineCases, summarizeOfflineEvaluation } from './tonightOfflineEvaluation';

const candidate = (id: number, mediaType: 'movie' | 'tv', genres: string[]) => ({ id, mediaType, title: `${mediaType} ${id}`, originalLanguage: 'en', releaseDate: '2020-01-01', runtime: 90, genres });
const sample = () => ({ cases: [{ name: 'labelled example',
  filters: { mood: '', maxMinutes: 120, language: 'en', services: ['Netflix'], includeRentBuy: true, mediaType: '' },
  candidates: [candidate(1, 'movie', ['Thriller']), candidate(1, 'tv', ['Comedy']), candidate(2, 'movie', ['Drama'])],
  offers: { 'movie:1': [{ provider: 'Netflix', type: 'subscription' }], 'tv:1': [{ provider: 'Netflix', type: 'rent' }] },
  feedback: { 'movie:90': { kind: 'not_interested', genres: ['Thriller'] }, 'movie:2': { kind: 'already_watched', genres: ['Drama'] } },
  duelWeights: {}, judgments: { 'movie:1': 'not_relevant', 'tv:1': 'relevant', 'movie:2': 'relevant' },
}] });

describe('offline recommendation evaluation', () => {
  it('compares the real rankings on identical eligible titles, removing session dismissals', () => {
    const [result] = evaluateOfflineCases(parseOfflineCases(sample()));
    expect(result.baseline).toEqual(['movie:1', 'tv:1']);
    expect(result.updated).toEqual(['tv:1', 'movie:1']);
    expect(result.baselineMetrics.reciprocalRank).toBe(0.5);
    expect(result.updatedMetrics.reciprocalRank).toBe(1);
    expect(result.baselineMetrics.relevantCoverage).toBe(1);
  });
  it('respects payment filters and counts relevant items excluded by eligibility', () => {
    const input = sample(); input.cases[0].filters.includeRentBuy = false;
    const [result] = evaluateOfflineCases(parseOfflineCases(input));
    expect(result.baseline).toEqual(['movie:1']);
    expect(result.baselineMetrics.relevantCoverage).toBe(0);
    expect(result.updated).toEqual(result.baseline);
  });
  it('does not treat missing judgments as negative labels', () => {
    const input = sample(); delete (input.cases[0].judgments as Record<string, string>)['movie:1'];
    const [result] = evaluateOfflineCases(parseOfflineCases(input));
    expect(result.labelCoverage).toBe(0.5);
    expect(result.baselineMetrics.precisionAtCutoff).toBeNull();
    expect(result.baselineMetrics.topThree).toEqual({ shown: 2, judged: 1, judgedPrecision: 1 });
  });
  it('does not report zero precision when no candidate is eligible', () => {
    const input = sample(); input.cases[0].filters.services = ['Unavailable service'];
    const [result] = evaluateOfflineCases(parseOfflineCases(input));
    expect(result.baseline).toEqual([]);
    expect(result.baselineMetrics.precisionAtCutoff).toBeNull();
    expect(result.updatedMetrics.precisionAtCutoff).toBeNull();
    expect(result.baselineMetrics.relevantCoverage).toBe(0);
    expect(summarizeOfflineEvaluation([result]).precisionAtCutoff.cases).toBe(0);
  });
  it('summarizes paired eligible cases without treating missing metrics as zero', () => {
    const complete = sample();
    const partial = sample(); delete (partial.cases[0].judgments as Record<string, string>)['movie:1'];
    const unlabelled = sample(); unlabelled.cases[0].judgments = {} as typeof unlabelled.cases[0]['judgments'];
    const results = evaluateOfflineCases(parseOfflineCases({ cases: [complete.cases[0], partial.cases[0], unlabelled.cases[0]] }));
    const summary = summarizeOfflineEvaluation(results);
    expect(summary.totalCases).toBe(3);
    expect(summary.reciprocalRank).toEqual({ cases: 2, baseline: 0.5, updated: 1, delta: 0.5 });
    expect(summary.precisionAtCutoff.cases).toBe(1);
    expect(summary.relevantCoverage.cases).toBe(2);
    expect(summarizeOfflineEvaluation([]).reciprocalRank).toEqual({ cases: 0, baseline: null, updated: null, delta: null });
  });
  it('rejects duplicate identities, malformed offers and invalid filters', () => {
    const duplicate = sample(); duplicate.cases[0].candidates.push(candidate(1, 'movie', []));
    expect(() => parseOfflineCases(duplicate)).toThrow();
    const badOffer = sample(); badOffer.cases[0].offers['movie:1'][0].type = 'unknown';
    expect(() => parseOfflineCases(badOffer)).toThrow();
    const badMood = sample(); badMood.cases[0].filters.mood = 'toString';
    expect(() => parseOfflineCases(badMood)).toThrow();
  });
});

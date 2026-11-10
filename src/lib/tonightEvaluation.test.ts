import { describe, expect, it } from 'vitest';
import { compareRankings, rankingMetrics } from './tonightEvaluation';

describe('recommendation evaluation', () => {
  it('reports rank, top-three precision and eligible-label coverage', () => {
    const results = compareRankings(['movie:1', 'tv:1', 'movie:2'], ['tv:1', 'movie:1', 'movie:2'], ['tv:1', 'movie:3']);
    expect(results.baseline.reciprocalRank).toBe(0.5);
    expect(results.updated.reciprocalRank).toBe(1);
    expect(results.baseline.precisionAtCutoff).toBeCloseTo(1 / 3);
    expect(results.baseline.relevantCoverage).toBe(0.5);
  });
  it('rejects different eligibility or duplicate title identities', () => {
    expect(() => compareRankings(['movie:1'], ['tv:1'], ['movie:1'])).toThrow();
    expect(() => compareRankings(['movie:1', 'movie:1'], ['movie:1'], [])).toThrow();
  });
  it('treats empty and unlabelled cases explicitly', () => {
    expect(rankingMetrics([], [])).toEqual({ reciprocalRank: 0, precisionAtCutoff: 0, relevantCoverage: null, eligibleCount: 0 });
  });
});

import { rankTonight, MOODS, type TonightFilters } from './tonight';
import { feedbackWeights, type TonightFeedbackMap } from './tonightFeedback';
import { compareRankings } from './tonightEvaluation';
import type { DuelCandidate, Weights } from './duel';
import type { ProviderOffer } from '../../shared/types/availability';

type Judgment = 'relevant' | 'not_relevant';
interface OfflineCase {
  name: string; filters: TonightFilters; candidates: DuelCandidate[];
  feedback: TonightFeedbackMap; duelWeights: Weights;
  offers: Record<string, ProviderOffer[]>; judgments: Record<string, Judgment>;
  baselineOrder?: string[];
}
const keyOf = (candidate: DuelCandidate) => `${candidate.mediaType}:${candidate.id}`;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyPattern = /^(movie|tv):[1-9]\d*$/;
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

/** Reject malformed fixtures rather than silently changing eligibility. */
export function parseOfflineCases(input: unknown): OfflineCase[] {
  if (!object(input) || !Array.isArray(input.cases) || !input.cases.length) throw new Error('Expected a non-empty cases array');
  const cases = input.cases.map((item: unknown, index: number) => {
    const fail = () => { throw new Error(`Invalid evaluation case at index ${index}`); };
    if (!object(item) || typeof item.name !== 'string' || !item.name.trim() || !object(item.filters) || !Array.isArray(item.candidates) || !item.candidates.length ||
        !object(item.feedback) || !object(item.duelWeights) || !object(item.offers) || !object(item.judgments)) return fail();
    const f = item.filters;
    if (typeof f.mood !== 'string' || (f.mood !== '' && !Object.prototype.hasOwnProperty.call(MOODS, f.mood)) ||
        !(f.maxMinutes === null || (typeof f.maxMinutes === 'number' && Number.isFinite(f.maxMinutes) && f.maxMinutes > 0)) ||
        typeof f.language !== 'string' || f.language !== f.language.toLowerCase() || !stringArray(f.services) ||
        typeof f.includeRentBuy !== 'boolean' || !['', 'movie', 'tv'].includes(String(f.mediaType))) return fail();
    const keys = new Set<string>();
    for (const c of item.candidates) {
      if (!object(c) || !Number.isSafeInteger(c.id) || Number(c.id) <= 0 || !['movie', 'tv'].includes(String(c.mediaType)) ||
          typeof c.title !== 'string' || typeof c.originalLanguage !== 'string' || typeof c.releaseDate !== 'string' ||
          (c.genres !== undefined && !stringArray(c.genres)) ||
          (c.runtime !== undefined && !(typeof c.runtime === 'number' && Number.isFinite(c.runtime) && c.runtime > 0))) return fail();
      const key = `${c.mediaType}:${c.id}`;
      if (keys.has(key)) return fail();
      keys.add(key);
    }
    for (const [key, value] of Object.entries(item.offers)) {
      if (!keys.has(key) || !Array.isArray(value) || value.some(offer => !object(offer) || typeof offer.provider !== 'string' ||
          !offer.provider || !['subscription', 'free', 'ads', 'rent', 'buy'].includes(String(offer.type)))) return fail();
    }
    for (const [key, value] of Object.entries(item.feedback)) {
      if (!keyPattern.test(key) || !object(value) || !['not_interested', 'already_watched', 'not_available'].includes(String(value.kind)) || !stringArray(value.genres)) return fail();
    }
    for (const value of Object.values(item.duelWeights)) if (typeof value !== 'number' || !Number.isFinite(value)) return fail();
    for (const [key, value] of Object.entries(item.judgments)) if (!keys.has(key) || !['relevant', 'not_relevant'].includes(String(value))) return fail();
    if (item.baselineOrder !== undefined && (!stringArray(item.baselineOrder) || item.baselineOrder.length !== keys.size ||
        new Set(item.baselineOrder).size !== keys.size || item.baselineOrder.some((key: string) => !keys.has(key)))) return fail();
    return item as unknown as OfflineCase;
  });
  if (cases.some(item => (item.baselineOrder !== undefined) !== (cases[0].baselineOrder !== undefined)))
    throw new Error('Do not mix baseline types in one evaluation');
  return cases;
}

function judgedTopThree(ranking: string[], judgments: Record<string, Judgment>) {
  const top = ranking.slice(0, 3);
  const judged = top.filter(key => judgments[key] !== undefined);
  return { shown: top.length, judged: judged.length, judgedPrecision: judged.length ? judged.filter(key => judgments[key] === 'relevant').length / judged.length : null };
}

export function evaluateOfflineCases(cases: OfflineCase[]) {
  return cases.map(test => {
    const remaining = test.candidates.filter(candidate => !test.feedback[keyOf(candidate)]);
    const offersFor = (type: string, id: number) => test.offers[`${type}:${id}`];
    const relevant = Object.keys(test.judgments).filter(key => test.judgments[key] === 'relevant' && !test.feedback[key]);
    const noFeedback = rankTonight(remaining, test.filters, test.duelWeights, offersFor).map(choice => keyOf(choice.candidate));
    const eligible = new Set(noFeedback);
    const baseline = test.baselineOrder ? test.baselineOrder.filter(key => eligible.has(key)) : noFeedback;
    const updated = rankTonight(remaining, test.filters, test.duelWeights, offersFor, feedbackWeights(test.feedback)).map(choice => keyOf(choice.candidate));
    const metrics = compareRankings(baseline, updated, relevant);
    // Precision only depends on the displayed cutoff. An unjudged title below
    // it cannot affect that ranking's precision, while one inside it can.
    const precisionKnown = (ranking: string[]) => ranking.length > 0 && ranking.slice(0, 3).every(key => test.judgments[key] !== undefined);
    return { name: test.name, baselineKind: test.baselineOrder ? 'provided_order' as const : 'tonight_without_feedback' as const, baseline, updated, labelCoverage: baseline.length ? baseline.filter(key => test.judgments[key] !== undefined).length / baseline.length : null,
      baselineMetrics: { ...metrics.baseline, reciprocalRank: relevant.length ? metrics.baseline.reciprocalRank : null, precisionAtCutoff: precisionKnown(baseline) ? metrics.baseline.precisionAtCutoff : null, topThree: judgedTopThree(baseline, test.judgments) },
      updatedMetrics: { ...metrics.updated, reciprocalRank: relevant.length ? metrics.updated.reciprocalRank : null, precisionAtCutoff: precisionKnown(updated) ? metrics.updated.precisionAtCutoff : null, topThree: judgedTopThree(updated, test.judgments) } };
  });
}

/** Macro-average paired cases only when both values for a metric are available. */
export function summarizeOfflineEvaluation(results: ReturnType<typeof evaluateOfflineCases>) {
  const paired = (select: (row: typeof results[number]) => [number | null, number | null]) => {
    const values = results.map(select).filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null);
    if (!values.length) return { cases: 0, baseline: null, updated: null, delta: null };
    const baseline = values.reduce((sum, pair) => sum + pair[0], 0) / values.length;
    const updated = values.reduce((sum, pair) => sum + pair[1], 0) / values.length;
    return { cases: values.length, baseline, updated, delta: updated - baseline };
  };
  const deltas = results.flatMap(row => row.baselineMetrics.reciprocalRank === null || row.updatedMetrics.reciprocalRank === null
    ? [] : [row.updatedMetrics.reciprocalRank - row.baselineMetrics.reciprocalRank]);
  const outcomes = { improved: deltas.filter(delta => delta > 0).length,
    declined: deltas.filter(delta => delta < 0).length, unchanged: deltas.filter(delta => delta === 0).length };
  // Paired case-level bootstrap, seeded for reproducible local reports. It
  // describes sampling uncertainty only; it cannot correct a biased dataset.
  let interval95: [number, number] | null = null;
  if (deltas.length >= 2) {
    let state = 0x5b71a4e9;
    const randomIndex = () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) % deltas.length;
    };
    const means = Array.from({ length: 2000 }, () => {
      let total = 0;
      for (let i = 0; i < deltas.length; i++) total += deltas[randomIndex()];
      return total / deltas.length;
    }).sort((a, b) => a - b);
    interval95 = [means[49], means[1949]];
  }
  return { totalCases: results.length, baselineKind: results[0]?.baselineKind ?? null,
    reciprocalRank: paired(row => [row.baselineMetrics.reciprocalRank, row.updatedMetrics.reciprocalRank]),
    reciprocalRankUncertainty: { cases: deltas.length, ...outcomes, interval95 },
    precisionAtCutoff: paired(row => [row.baselineMetrics.precisionAtCutoff, row.updatedMetrics.precisionAtCutoff]),
    relevantCoverage: paired(row => [row.baselineMetrics.relevantCoverage, row.updatedMetrics.relevantCoverage]) };
}

import { rankTonight, type TonightFilters } from '../src/lib/tonight';
import { feedbackWeights, type TonightFeedbackMap } from '../src/lib/tonightFeedback';
import type { DuelCandidate } from '../src/lib/duel';
import { compareRankings } from '../src/lib/tonightEvaluation';
import { readFileSync } from 'node:fs';
import { evaluateOfflineCases, parseOfflineCases } from '../src/lib/tonightOfflineEvaluation';

// Synthetic, hand-labelled examples; these are regression probes, not user outcomes.
const film = (id: number, genre: string): DuelCandidate => ({ id, title: `Film ${id}`, mediaType: 'movie',
  posterPath: '/poster.jpg', overview: '', releaseDate: '2020-01-01', voteAverage: 7,
  originalLanguage: 'en', genres: [genre], runtime: 90 });
const filters: TonightFilters = { mood: '', maxMinutes: null, language: '', services: [], includeRentBuy: false, mediaType: '' };
const cases: { name: string; feedback: TonightFeedbackMap; candidates: DuelCandidate[]; relevant: number[] }[] = [
  { name: 'avoid-thriller', feedback: { 'movie:90': { kind: 'not_interested', genres: ['Thriller'] } },
    candidates: [film(1, 'Thriller'), film(2, 'Comedy'), film(3, 'Thriller'), film(4, 'Drama')], relevant: [2, 4] },
  { name: 'avoid-horror', feedback: { 'movie:91': { kind: 'not_interested', genres: ['Horror'] } },
    candidates: [film(5, 'Horror'), film(6, 'Drama'), film(7, 'Comedy')], relevant: [6, 7] },
  { name: 'watched-is-not-dislike', feedback: { 'movie:92': { kind: 'already_watched', genres: ['Comedy'] } },
    candidates: [film(8, 'Comedy'), film(9, 'Drama')], relevant: [8] },
  { name: 'unavailable-is-not-dislike', feedback: { 'movie:93': { kind: 'not_available', genres: ['Drama'] } },
    candidates: [film(10, 'Drama'), film(11, 'Comedy')], relevant: [10] },
];
function reciprocalRank(ids: number[], relevant: number[]): number {
  const i = ids.findIndex(id => relevant.includes(id));
  return i < 0 ? 0 : 1 / (i + 1);
}
export function evaluateTonight() {
  const rows = cases.map(test => {
    const baseline = rankTonight(test.candidates, filters, {}, () => undefined).map(x => x.candidate.id);
    const updated = rankTonight(test.candidates, filters, {}, () => undefined, feedbackWeights(test.feedback)).map(x => x.candidate.id);
    const metrics = compareRankings(baseline.map(id => `movie:${id}`), updated.map(id => `movie:${id}`), test.relevant.map(id => `movie:${id}`));
    return { name: test.name, baseline, updated, baselineRR: reciprocalRank(baseline, test.relevant), updatedRR: reciprocalRank(updated, test.relevant), metrics };
  });
  return { cases: rows, baselineMRR: rows.reduce((s, r) => s + r.baselineRR, 0) / rows.length,
    updatedMRR: rows.reduce((s, r) => s + r.updatedRR, 0) / rows.length };
}
try {
  const args = process.argv.slice(2);
  if (!args.length) console.log(JSON.stringify(evaluateTonight(), null, 2));
  else if (args.length === 2 && args[0] === '--input') {
    const input: unknown = JSON.parse(readFileSync(args[1], 'utf8'));
    console.log(JSON.stringify({ mode: 'offline_labelled', cases: evaluateOfflineCases(parseOfflineCases(input)) }, null, 2));
  } else throw new Error('Usage: npm run evaluate:tonight -- [--input path.json]');
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Invalid JSON evaluation input' : error instanceof Error ? error.message : 'Evaluation failed');
  process.exitCode = 1;
}

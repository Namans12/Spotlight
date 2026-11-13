import type { DuelCandidate, Weights } from './duel';
import { rankTonight, type TonightFilters } from './tonight';
import type { TonightFeedbackMap } from './tonightFeedback';
import type { ProviderOffer } from '../../shared/types/availability';

export type StudyJudgment = 'relevant' | 'not_relevant';
export interface TonightStudy {
  name: string;
  filters: TonightFilters;
  candidates: DuelCandidate[];
  feedback: TonightFeedbackMap;
  duelWeights: Weights;
  offers: Record<string, ProviderOffer[]>;
  judgments: Record<string, StudyJudgment>;
}

const keyOf = (item: DuelCandidate) => `${item.mediaType}:${item.id}`;

/** Freeze eligible candidates in their original order so ranking can be replayed. */
export function createTonightStudy(
  candidates: DuelCandidate[], filters: TonightFilters, weights: Weights, feedback: TonightFeedbackMap,
  availability: Record<string, ProviderOffer[]>,
): TonightStudy {
  const remaining = candidates.filter(item => !feedback[keyOf(item)]);
  const eligible = new Set(rankTonight(remaining, filters, weights, (type, id) => availability[`${type}:${id}`])
    .map(({ candidate }) => keyOf(candidate)));
  const cleanCandidates = remaining.filter(candidate => eligible.has(keyOf(candidate))).map(candidate => ({
    id: candidate.id, mediaType: candidate.mediaType, title: candidate.title,
    originalLanguage: candidate.originalLanguage, releaseDate: candidate.releaseDate,
    posterPath: null, overview: '', voteAverage: 0,
    ...(candidate.genres ? { genres: [...candidate.genres] } : {}),
    ...(candidate.runtime ? { runtime: candidate.runtime } : {}),
  }));
  const offers = Object.fromEntries(cleanCandidates.flatMap(item => {
    const value = availability[keyOf(item)];
    return value ? [[keyOf(item), value.map(offer => ({ provider: offer.provider, type: offer.type }))]] : [];
  }));
  return { name: 'voluntary-session', filters: { ...filters, services: [...filters.services] }, candidates: cleanCandidates,
    feedback: Object.fromEntries(Object.entries(feedback).map(([key, value]) => [key, { kind: value.kind, genres: [...value.genres] }])),
    duelWeights: { ...weights }, offers, judgments: {} };
}

/** Download only after an explicit user action. No network request is made. */
export function downloadTonightStudy(study: TonightStudy): void {
  const blob = new Blob([JSON.stringify({ cases: [study] }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'spotlight-tonight-evaluation.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

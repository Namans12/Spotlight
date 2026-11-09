import type { DuelCandidate, Weights } from '@/lib/duel';

export type TonightFeedbackKind = 'not_interested' | 'already_watched' | 'not_available';
export interface TonightFeedback { kind: TonightFeedbackKind; genres: string[] }
export type TonightFeedbackMap = Record<string, TonightFeedback>;

/** A bounded, session-only nudge from an explicit negative preference. */
export function feedbackWeights(feedback: TonightFeedbackMap): Weights {
  const weights: Weights = {};
  for (const item of Object.values(feedback)) {
    if (item.kind !== 'not_interested') continue;
    for (const genre of new Set(item.genres)) {
      const key = `genre:${genre}`;
      weights[key] = Math.max(-2, (weights[key] ?? 0) - 0.5);
    }
  }
  return weights;
}
export function recordTonightFeedback(candidate: DuelCandidate, kind: TonightFeedbackKind): TonightFeedback {
  return { kind, genres: [...(candidate.genres ?? [])] };
}

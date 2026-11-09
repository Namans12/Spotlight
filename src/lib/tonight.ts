import type { ProviderOffer } from '../../shared/types/availability';
import { scoreCandidate, type DuelCandidate, type Weights } from '@/lib/duel';
import { languageName } from '@/lib/languages';

export const MOODS = {
  light: { label: 'Light & funny', genres: ['Comedy', 'Family'] },
  suspense: { label: 'Suspenseful', genres: ['Thriller', 'Mystery', 'Crime'] },
  adventure: { label: 'Adventurous', genres: ['Adventure', 'Action', 'Fantasy'] },
  thoughtful: { label: 'Thoughtful', genres: ['Drama', 'Documentary'] },
} as const;
export type Mood = keyof typeof MOODS;
export interface TonightFilters {
  mood: Mood | '';
  maxMinutes: number | null;
  language: string;
  services: string[];
  includeRentBuy: boolean;
  mediaType: 'movie' | 'tv' | '';
}
export interface TonightChoice {
  candidate: DuelCandidate;
  reasons: string[];
  offers: ProviderOffer[] | undefined;
  score: number;
}

/** Hard constraints require evidence; mood and optional Duel picks only rank. */
export function rankTonight(
  candidates: DuelCandidate[], filters: TonightFilters, weights: Weights,
  offersFor: (type: string, id: number) => ProviderOffer[] | undefined,
  feedback: Weights = {},
): TonightChoice[] {
  const moodGenres = filters.mood ? MOODS[filters.mood].genres as readonly string[] : [];
  const wanted = new Set(filters.services);
  const eligibleTypes = new Set(filters.includeRentBuy ? ['subscription', 'free', 'ads', 'rent', 'buy'] : ['subscription', 'free', 'ads']);
  const moodWeights: Weights = { ...weights };
  for (const [key, value] of Object.entries(feedback)) moodWeights[key] = (moodWeights[key] ?? 0) + value;
  for (const genre of moodGenres) moodWeights[`genre:${genre}`] = (moodWeights[`genre:${genre}`] ?? 0) + 2;
  return candidates.flatMap((candidate, index) => {
    const offers = offersFor(candidate.mediaType, candidate.id);
    if (filters.mediaType && candidate.mediaType !== filters.mediaType) return [];
    if (filters.language && candidate.originalLanguage?.toLowerCase() !== filters.language) return [];
    if (filters.maxMinutes && (!candidate.runtime || candidate.runtime > filters.maxMinutes)) return [];
    const matching = (offers ?? []).filter(offer => wanted.has(offer.provider) && eligibleTypes.has(offer.type));
    if (wanted.size && matching.length === 0) return [];
    const reasons: string[] = [];
    const genre = candidate.genres?.find(g => moodGenres.includes(g));
    if (genre) reasons.push(`${genre} genre fits your mood preference`);
    if (filters.maxMinutes && candidate.runtime) reasons.push(`${candidate.runtime} min${candidate.mediaType === 'tv' ? ' per episode' : ''}`);
    if (filters.language) reasons.push(`Original language: ${languageName(candidate.originalLanguage)}`);
    if (matching.length) reasons.push(`Reported on ${matching.map(o => `${o.provider} (${o.type === 'ads' ? 'with ads' : o.type})`).join(', ')}`);
    if (Object.keys(weights).length && scoreCandidate(candidate, weights) > 0) reasons.push('Shares attributes with your Duel choice');
    if (!reasons.length) reasons.push('From your list or current discovery');
    return [{ candidate, offers, reasons, score: scoreCandidate(candidate, moodWeights), index }];
  }).sort((a, b) => b.score - a.score || a.index - b.index);
}

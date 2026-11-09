import { describe, expect, it } from 'vitest';
import { feedbackWeights, recordTonightFeedback } from './tonightFeedback';
import type { DuelCandidate } from './duel';
const title = { id: 1, mediaType: 'movie', genres: ['Comedy', 'Comedy', 'Drama'] } as DuelCandidate;
describe('session feedback', () => {
  it('nudges genres only for explicit not-interested feedback and caps repeated input', () => {
    const value = recordTonightFeedback(title, 'not_interested');
    const feedback = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`movie:${i}`, value]));
    expect(feedbackWeights(feedback)).toEqual({ 'genre:Comedy': -2, 'genre:Drama': -2 });
  });
  it('does not turn watched or unavailable into a genre dislike', () => {
    expect(feedbackWeights({ a: recordTonightFeedback(title, 'already_watched'), b: recordTonightFeedback(title, 'not_available') })).toEqual({});
  });
});

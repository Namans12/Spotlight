export interface TriviaQuestion { prompt: string; choices: string[]; answer: string; source: string; sourceUrl: string }

/** Facts are individually sourced; unavailable titles have no inferred trivia. */
const questions: Record<string, TriviaQuestion> = {
  'tv:1668': { prompt: 'Which café is associated with Friends?', choices: ['Central Perk', 'Central Park', 'The Daily Brew'], answer: 'Central Perk',
    source: 'Warner Bros. Studio Tour', sourceUrl: 'https://www.wbstudiotour.com/' },
  'tv:1399': { prompt: 'Which setting is paired with lemon cakes in George R. R. Martin’s feast guide?', choices: ['The Wall', 'The North', 'King’s Landing'], answer: 'King’s Landing',
    source: 'George R. R. Martin', sourceUrl: 'https://georgerrmartin.com/dining-in-westeros-a-feast-of-ice-and-fire/' },
};

export function watchNightTrivia(mediaType: 'movie' | 'tv', id: number): TriviaQuestion | null {
  return questions[`${mediaType}:${id}`] ?? null;
}

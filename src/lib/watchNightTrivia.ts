export interface TriviaQuestion { prompt: string; choices: string[]; answer: string; source: string; sourceUrl: string }

/** Facts are individually sourced; unavailable titles have no inferred trivia. */
const questions: Record<string, TriviaQuestion> = {
  'tv:1668': { prompt: 'Which café is associated with Friends?', choices: ['Central Perk', 'Central Park', 'The Daily Brew'], answer: 'Central Perk',
    source: 'Warner Bros. Studio Tour', sourceUrl: 'https://www.wbstudiotour.com/' },
  'tv:1399': { prompt: 'Which setting is paired with lemon cakes in George R. R. Martin’s feast guide?', choices: ['The Wall', 'The North', 'King’s Landing'], answer: 'King’s Landing',
    source: 'George R. R. Martin', sourceUrl: 'https://georgerrmartin.com/dining-in-westeros-a-feast-of-ice-and-fire/' },
  'movie:2062': { prompt: 'Which city does Remy dream of cooking in?', choices: ['Paris', 'Rome', 'Lisbon'], answer: 'Paris',
    source: 'Pixar', sourceUrl: 'https://www.pixar.com/ratatouille' },
  'tv:2316': { prompt: 'Which snack has its own day in The Office US?', choices: ['Pretzels', 'Popcorn', 'Waffles'], answer: 'Pretzels',
    source: 'The Office official channel', sourceUrl: 'https://www.youtube.com/watch?v=FldGxkUFuuQ' },
  'movie:673': { prompt: 'Where does Harry enjoy Butterbeer in the official guide to Prisoner of Azkaban?', choices: ['The Three Broomsticks', 'The Leaky Cauldron', 'Hogwarts Express'], answer: 'The Three Broomsticks',
    source: 'Harry Potter', sourceUrl: 'https://www.harrypotter.com/features/delicious-harry-potter-moments-that-will-make-you-hungry' },
};

export function watchNightTrivia(mediaType: 'movie' | 'tv', id: number): TriviaQuestion | null {
  return questions[`${mediaType}:${id}`] ?? null;
}

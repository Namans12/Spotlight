export interface TriviaQuestion { prompt: string; choices: string[]; answer: string; source: string; sourceUrl: string; storyDetail?: boolean }

/** Facts are individually sourced; unavailable titles have no inferred trivia. */
const questions: Record<string, TriviaQuestion> = {
  'tv:1668': { prompt: 'Which café is associated with Friends?', choices: ['Central Perk', 'Central Park', 'The Daily Brew'], answer: 'Central Perk',
    source: 'Warner Bros. Discovery', sourceUrl: 'https://press.wbd.com/na/media-release/hbo-max/max-watch-lists/whats-new-max-december-0' },
  'tv:1399': { prompt: 'Which setting is paired with lemon cakes in George R. R. Martin’s feast guide?', choices: ['The Wall', 'The North', 'King’s Landing'], answer: 'King’s Landing',
    source: 'George R. R. Martin', sourceUrl: 'https://georgerrmartin.com/dining-in-westeros-a-feast-of-ice-and-fire/' },
  'movie:2062': { prompt: 'Which city does Remy dream of cooking in?', choices: ['Paris', 'Rome', 'Lisbon'], answer: 'Paris', storyDetail: true,
    source: 'Pixar', sourceUrl: 'https://www.pixar.com/ratatouille' },
  'tv:2316': { prompt: 'Which snack has its own day in The Office US?', choices: ['Pretzels', 'Popcorn', 'Waffles'], answer: 'Pretzels', storyDetail: true,
    source: 'The Office official channel', sourceUrl: 'https://www.youtube.com/watch?v=FldGxkUFuuQ' },
  'movie:673': { prompt: 'Where does Harry enjoy Butterbeer in the official guide to Prisoner of Azkaban?', choices: ['The Three Broomsticks', 'The Leaky Cauldron', 'Hogwarts Express'], answer: 'The Three Broomsticks', storyDetail: true,
    source: 'Harry Potter', sourceUrl: 'https://www.harrypotter.com/features/delicious-harry-potter-moments-that-will-make-you-hungry' },
  'tv:66732': { prompt: 'Which breakfast food does Eleven enjoy in Stranger Things?', choices: ['Waffles', 'Croissants', 'Porridge'], answer: 'Waffles', storyDetail: true,
    source: 'Netflix Tudum', sourceUrl: 'https://www.netflix.com/tudum/features/stranger-things-props-archive' },
  'movie:10198': { prompt: 'Which New Orleans treat appears in Tiana’s cookbook?', choices: ['Beignets', 'Scones', 'Churros'], answer: 'Beignets',
    source: 'Disney Books', sourceUrl: 'https://books.disney.com/book/tianas-cookbook/' },
  'movie:10340': { prompt: 'Which dish inspired Disney’s Lady and the Tramp cooking video?', choices: ['Spaghetti and meatballs', 'Macaroni and cheese', 'Vegetable soup'], answer: 'Spaghetti and meatballs',
    source: 'Disney', sourceUrl: 'https://video.disney.com/watch/the-lady-and-the-tramp-cooking-show-with-alexys-oh-my-disney-show-by-oh-my-disney-56559b61741f0b10d7a04129' },
  'movie:116149': { prompt: 'What filling does Paddington keep in an emergency sandwich?', choices: ['Marmalade', 'Peanut butter', 'Honey'], answer: 'Marmalade', storyDetail: true,
    source: 'Paddington', sourceUrl: 'https://store.paddington.com/blogs/news/its-marmalade-may-paddingtons-favourite-marmalade-gifts-treats' },
};

export function watchNightTrivia(mediaType: 'movie' | 'tv', id: number): TriviaQuestion | null {
  return questions[`${mediaType}:${id}`] ?? null;
}

const extraQuestions: Record<string, TriviaQuestion[]> = {
  'tv:1668': [{ prompt: 'Whose apartment is featured in the Friends experience?', choices: ['Rachel and Monica', 'Joey and Ross', 'Phoebe and Gunther'], answer: 'Rachel and Monica',
    source: 'Warner Bros. Discovery', sourceUrl: 'https://press.wbd.com/na/media-release/hbo-max/max-watch-lists/whats-new-max-december-0' }],
  'movie:2062': [{ prompt: 'What is the title of Gusteau’s cookbook?', choices: ['Anyone Can Cook', 'The Paris Kitchen', 'A Chef’s Secret'], answer: 'Anyone Can Cook',
    source: 'Pixar', sourceUrl: 'https://www.pixar.com/ratatouille' }],
};

export function watchNightTriviaQuestions(mediaType: 'movie' | 'tv', id: number, releaseDate?: string | null): readonly TriviaQuestion[] {
  const first = watchNightTrivia(mediaType, id);
  if (first) return [first, ...(extraQuestions[`${mediaType}:${id}`] ?? [])];
  if (!Number.isSafeInteger(id) || id <= 0 || !releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return [];
  const date = new Date(`${releaseDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== releaseDate) return [];
  const year = date.getUTCFullYear();
  if (year < 1890 || year > 2100) return [];
  const choices = [String(year - 2), String(year), String(year + 2)];
  const rotation = id % choices.length;
  return [{ prompt: 'Which year does TMDB list for this title?', choices: [...choices.slice(rotation), ...choices.slice(0, rotation)],
    answer: String(year), source: 'TMDB', sourceUrl: `https://www.themoviedb.org/${mediaType}/${id}` }];
}

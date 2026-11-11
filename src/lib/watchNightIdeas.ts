/** Small, manually sourced ideas. IDs include media type to avoid collisions.
 * These are inspiration, not claims about diet, recipes or current ordering. */
export interface WatchNightIdea { food: string; reason: string; source: string; sourceUrl: string }
const ideas: Record<string, WatchNightIdea[]> = {
  'tv:1668': [
    { food: 'Pizza', reason: 'A New York-style choice: the Warner Bros. Studio Tour includes pizza on its Friends-inspired menu.',
      source: 'Warner Bros. Studio Tour', sourceUrl: 'https://www.wbstudiotour.com/it/info/dining/' },
    { food: 'A trifle', reason: 'The tour’s Central Perk Café offers a meat-free version inspired by Rachel’s Thanksgiving trifle.',
      source: 'Warner Bros. Studio Tour', sourceUrl: 'https://www.wbstudiotour.com/it/info/dining/' },
  ],
  'tv:1399': [{ food: 'Lemon cakes', reason: 'A King’s Landing-inspired treat listed in George R. R. Martin’s guide to a feast of ice and fire.',
    source: 'George R. R. Martin', sourceUrl: 'https://georgerrmartin.com/dining-in-westeros-a-feast-of-ice-and-fire/' }],
  'movie:2062': [{ food: 'Ratatouille', reason: 'Disney’s official Pixar cookbook includes a ratatouille inspired by the film.',
    source: 'Disney Books', sourceUrl: 'https://books.disney.com/book/pixar-the-official-cookbook/' }],
  'tv:2316': [{ food: 'Soft pretzels', reason: 'A nod to Pretzel Day in The Office US.',
    source: 'The Office official channel', sourceUrl: 'https://www.youtube.com/watch?v=FldGxkUFuuQ' }],
  'movie:673': [{ food: 'Butterbeer-inspired drink', reason: 'The official Harry Potter guide associates Butterbeer with a visit to Hogsmeade in Prisoner of Azkaban.',
    source: 'Harry Potter', sourceUrl: 'https://www.harrypotter.com/features/delicious-harry-potter-moments-that-will-make-you-hungry' }],
  'tv:66732': [{ food: 'Waffles', reason: 'A nod to Eleven’s favourite breakfast in Stranger Things.',
    source: 'Netflix Tudum', sourceUrl: 'https://www.netflix.com/tudum/features/stranger-things-props-archive' }],
  'movie:10198': [{ food: 'Beignets', reason: 'Disney’s Tiana cookbook includes a beignet recipe inspired by The Princess and the Frog.',
    source: 'Disney Books', sourceUrl: 'https://books.disney.com/book/tianas-cookbook/' }],
  'movie:10340': [{ food: 'Spaghetti and meatballs', reason: 'Disney shares a cooking video inspired by Lady and the Tramp.',
    source: 'Disney', sourceUrl: 'https://video.disney.com/watch/the-lady-and-the-tramp-cooking-show-with-alexys-oh-my-disney-show-by-oh-my-disney-56559b61741f0b10d7a04129' }],
  'movie:116149': [{ food: 'Marmalade sandwich', reason: 'A nod to Paddington’s favourite emergency snack.',
    source: 'Paddington', sourceUrl: 'https://store.paddington.com/blogs/news/its-marmalade-may-paddingtons-favourite-marmalade-gifts-treats' }],
};
export function watchNightIdeas(mediaType: 'movie' | 'tv', id: number): readonly WatchNightIdea[] {
  return ideas[`${mediaType}:${id}`] ?? [];
}

/** User-selected atmosphere, independent of a title's story or metadata. */
export const VIBE_IDEAS = {
  cosy: { label: 'Cosy', foods: ['Pizza or a warm sandwich', 'Tea or hot chocolate'] },
  fresh: { label: 'Fresh', foods: ['Fruit or vegetable sticks', 'Sparkling water or lemonade'] },
  crunchy: { label: 'Crunchy', foods: ['Popcorn or pretzels', 'Iced tea or water'] },
} as const;
export type WatchNightVibe = keyof typeof VIBE_IDEAS;

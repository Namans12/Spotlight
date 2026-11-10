/** Small, manually sourced ideas. IDs include media type to avoid collisions.
 * These are inspiration, not claims about diet, recipes or current ordering. */
export interface WatchNightIdea { food: string; reason: string; source: string; sourceUrl: string }
const ideas: Record<string, WatchNightIdea[]> = {
  'tv:1668': [{ food: 'Pizza', reason: 'A New York-style choice: the Warner Bros. Studio Tour includes pizza on its Friends-inspired menu.',
    source: 'Warner Bros. Studio Tour', sourceUrl: 'https://www.wbstudiotour.com/' }],
  'tv:1399': [{ food: 'Lemon cakes', reason: 'A King’s Landing-inspired treat listed in George R. R. Martin’s guide to a feast of ice and fire.',
    source: 'George R. R. Martin', sourceUrl: 'https://georgerrmartin.com/dining-in-westeros-a-feast-of-ice-and-fire/' }],
  'movie:2062': [{ food: 'Ratatouille', reason: 'Disney’s official Pixar cookbook includes a ratatouille inspired by the film.',
    source: 'Disney Books', sourceUrl: 'https://books.disney.com/book/pixar-the-official-cookbook/' }],
  'tv:2316': [{ food: 'Soft pretzels', reason: 'A nod to Pretzel Day in The Office US.',
    source: 'The Office official channel', sourceUrl: 'https://www.youtube.com/watch?v=FldGxkUFuuQ' }],
  'movie:673': [{ food: 'Butterbeer-inspired drink', reason: 'The official Harry Potter guide associates Butterbeer with a visit to Hogsmeade in Prisoner of Azkaban.',
    source: 'Harry Potter', sourceUrl: 'https://www.harrypotter.com/features/delicious-harry-potter-moments-that-will-make-you-hungry' }],
};
export function watchNightIdeas(mediaType: 'movie' | 'tv', id: number): readonly WatchNightIdea[] {
  return ideas[`${mediaType}:${id}`] ?? [];
}

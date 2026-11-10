/** Small, manually sourced ideas. IDs include media type to avoid collisions.
 * These are inspiration, not claims about diet, recipes or current ordering. */
export interface WatchNightIdea { food: string; reason: string; source: string; sourceUrl: string }
const ideas: Record<string, WatchNightIdea[]> = {
  'tv:1668': [{ food: 'Pizza', reason: 'A New York-style choice: the Warner Bros. Studio Tour includes pizza on its Friends-inspired menu.',
    source: 'Warner Bros. Studio Tour', sourceUrl: 'https://www.wbstudiotour.com/' }],
  'tv:1399': [{ food: 'Lemon cakes', reason: 'A King’s Landing-inspired treat listed in George R. R. Martin’s guide to a feast of ice and fire.',
    source: 'George R. R. Martin', sourceUrl: 'https://georgerrmartin.com/dining-in-westeros-a-feast-of-ice-and-fire/' }],
};
export function watchNightIdeas(mediaType: 'movie' | 'tv', id: number): readonly WatchNightIdea[] {
  return ideas[`${mediaType}:${id}`] ?? [];
}

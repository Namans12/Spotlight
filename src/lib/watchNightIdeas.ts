/** Small, manually sourced ideas. IDs include media type to avoid collisions.
 * These are inspiration, not claims about diet, recipes or current ordering. */
export interface WatchNightIdea { food: string; reason: string; source: string; sourceUrl: string }
const ideas: Record<string, WatchNightIdea[]> = {
  'movie:508943': [{ food: 'Trenette al pesto', reason: 'Disney’s Pixar cookbook includes this pasta inspired by Luca.', source: 'Disney Books', sourceUrl: 'https://books.disney.com/book/pixar-the-official-cookbook/' }],
  'movie:568124': [{ food: 'Arepas', reason: 'Disney’s Encanto cookbook includes Magical Arepas.', source: 'Disney Books', sourceUrl: 'https://books.disney.com/book/encanto-the-official-cookbook/' }],
  'movie:24428': [{ food: 'Shawarma wraps', reason: 'A nod to the team’s post-credits meal in The Avengers (2012).', source: 'Marvel Entertainment', sourceUrl: 'https://www.youtube.com/watch?v=sPemKns0mA4' }],
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
  'movie:673': [{ food: 'Butterbeer-inspired drink', reason: 'Inspired by Butterbeer in the Prisoner of Azkaban book, as described by the official Harry Potter site.',
    source: 'Harry Potter', sourceUrl: 'https://www.harrypotter.com/features/delicious-harry-potter-moments-that-will-make-you-hungry' }],
  'tv:66732': [{ food: 'Waffles', reason: 'A nod to Eleven’s favourite breakfast in Stranger Things.',
    source: 'Netflix Tudum', sourceUrl: 'https://www.netflix.com/tudum/features/stranger-things-props-archive' }],
  'movie:10198': [{ food: 'Beignets', reason: 'Disney’s Tiana cookbook includes a beignet recipe inspired by The Princess and the Frog.',
    source: 'Disney Books', sourceUrl: 'https://books.disney.com/book/tianas-cookbook/' }],
  'movie:10340': [{ food: 'Spaghetti and meatballs', reason: 'Disney shares a cooking video inspired by Lady and the Tramp.',
    source: 'Disney', sourceUrl: 'https://video.disney.com/watch/the-lady-and-the-tramp-cooking-show-with-alexys-oh-my-disney-show-by-oh-my-disney-56559b61741f0b10d7a04129' }],
  'movie:116149': [{ food: 'Marmalade sandwich', reason: 'Inspired by Paddington’s marmalade sandwiches, featured by the official character store.',
    source: 'Paddington', sourceUrl: 'https://store.paddington.com/blogs/news/its-marmalade-may-paddingtons-favourite-marmalade-gifts-treats' }],
};
export function watchNightIdeas(mediaType: 'movie' | 'tv', id: number): readonly WatchNightIdea[] {
  return ideas[`${mediaType}:${id}`] ?? [];
}

export type WatchNightDiet = '' | 'vegetarian' | 'vegan';

/** Serving suggestions are our adaptations, not quotes or official recipes. */
const servings: Record<string, { preparation: string; vegan: string; minutes: number; safeBeforeWatching?: boolean }> = {
 'Trenette al pesto': { preparation: 'Toss cooked pasta, green beans and diced potatoes with basil pesto.', vegan: 'Use egg-free pasta and dairy-free pesto; check for nuts.', minutes: 25, safeBeforeWatching: true },
 'Pizza': { preparation: 'Use a ready-made base; add tomato sauce, mozzarella and your favourite vegetables.', vegan: 'Use a dairy-free base and plant-based cheese, or skip the cheese.', minutes: 20 },
 'A trifle': { preparation: 'Layer ready-made sponge, fruit and custard in individual cups.', vegan: 'Use egg-free sponge and plant-based custard; avoid gelatine.', minutes: 15 },
 'Lemon cakes': { preparation: 'Serve small lemon cakes with tea, or add lemon zest to ready-made cupcakes.', vegan: 'Choose egg-free, dairy-free lemon cupcakes.', minutes: 10 },
 'Ratatouille': { preparation: 'Cook aubergine, courgette, peppers and tomatoes in olive oil; serve with bread.', vegan: 'Use vegetable stock and olive oil; leave out butter and cheese.', minutes: 40, safeBeforeWatching: true },
 'Soft pretzels': { preparation: 'Warm ready-made soft pretzels and serve mustard alongside.', vegan: 'Choose pretzels without dairy or egg glaze; use plant-based spread.', minutes: 10 },
 'Butterbeer-inspired drink': { preparation: 'Make a non-alcoholic cream-soda float with vanilla ice cream and butterscotch-style syrup.', vegan: 'Use dairy-free ice cream and a dairy-free syrup.', minutes: 5 },
 'Waffles': { preparation: 'Toast ready-made waffles; serve with berries and maple syrup.', vegan: 'Choose egg-free and dairy-free waffles.', minutes: 10 },
 'Beignets': { preparation: 'Pick up beignets from a bakery and serve warm with a dusting of sugar.', vegan: 'Ask for egg-free, dairy-free beignets; availability varies.', minutes: 5, safeBeforeWatching: true },
 'Spaghetti and meatballs': { preparation: 'Simmer ready-made meatballs in tomato sauce while the spaghetti cooks.', vegan: 'Use plant-based meatballs, egg-free pasta and skip dairy cheese.', minutes: 25 },
 'Marmalade sandwich': { preparation: 'Spread orange marmalade on bread and cut into easy-to-share triangles.', vegan: 'Choose dairy-free bread and plant-based spread.', minutes: 5 },
 'Arepas': { preparation: 'Pan-cook arepas made with pre-cooked maize flour; add cheese or beans.', vegan: 'Use beans or avocado instead of cheese, and cook in oil.', minutes: 25, safeBeforeWatching: true },
 'Shawarma wraps': { preparation: 'Fill flatbreads with cooked chicken or roasted chickpeas, salad and sauce.', vegan: 'Use chickpeas and tahini; check the flatbread and sauce ingredients.', minutes: 20 },
};
export function foodPairings(mediaType: 'movie' | 'tv', id: number, watched: boolean, diet: WatchNightDiet, quick: boolean) {
 return watchNightIdeas(mediaType, id).flatMap(idea => {
  const serving = servings[idea.food];
  if (!serving || (!watched && !serving.safeBeforeWatching) || (quick && serving.minutes > 20)) return [];
  return [{ ...idea, ...serving, adaptation: diet ? serving.vegan : null }];
 });
}

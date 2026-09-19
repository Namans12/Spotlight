import { describe, expect, it } from 'vitest';
import type { PageMeta } from './seo';
import {
  absoluteUrl,
  clampDescription,
  staticRouteMeta,
  titleDetailMeta,
  watchOrderMeta,
  type ChainEntry,
} from './seo';

// These strings are the only thing a search engine and a shared link ever see
// of a page, and they are produced twice — baked into HTML by
// scripts/prerender.ts and applied on navigation by useDocumentMeta. Both read
// this module, so it is the single place the claims can be checked.

const SITE = 'https://spotlighthub.vercel.app';

/** The subset of schema.org these builders emit. Declared rather than cast to
 *  `any`, so a rename in seo.ts fails here instead of silently asserting
 *  nothing. */
interface JsonLd {
  '@type'?: string;
  name?: string;
  numberOfItems?: number;
  itemListElement?: { position: number; item: { name: string; datePublished?: string; url: string } }[];
}
const ld = (meta: PageMeta): JsonLd => (meta.jsonLd ?? {}) as JsonLd;

function entry(title: string, releaseDate: string | null, mediaType: 'movie' | 'tv' = 'movie', tmdbId = 1): ChainEntry {
  return { title, releaseDate, mediaType, tmdbId };
}

const JOHN_WICK: ChainEntry[] = [
  entry('John Wick', '2014-10-16', 'movie', 245891),
  entry('John Wick: Chapter 2', '2017-02-08', 'movie', 324552),
  entry('John Wick: Chapter 3 - Parabellum', '2019-05-15', 'movie', 458156),
  entry('John Wick: Chapter 4', '2023-03-21', 'movie', 603692),
];

describe('clampDescription', () => {
  it('leaves a short description untouched, with no trailing ellipsis', () => {
    expect(clampDescription('Short and complete.')).toBe('Short and complete.');
  });

  it('cuts on a word boundary and marks the cut', () => {
    const out = clampDescription('word '.repeat(60), 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wo…$/); // never mid-word
  });

  it('collapses whitespace so a multi-line overview does not leak newlines', () => {
    expect(clampDescription('a\n\n  b\tc')).toBe('a b c');
  });
});

describe('watchOrderMeta', () => {
  it('titles the page for the query people actually type', () => {
    const meta = watchOrderMeta({ title: 'John Wick', mediaType: 'movie', tmdbId: 245891 }, JOHN_WICK, SITE);
    expect(meta.title).toBe('John Wick watch order - all 4 films in order | Spotlight');
  });

  it('names the chain in the description, front-loaded with the title', () => {
    const meta = watchOrderMeta({ title: 'John Wick', mediaType: 'movie', tmdbId: 245891 }, JOHN_WICK, SITE);
    expect(meta.description.startsWith('John Wick in order:')).toBe(true);
    expect(meta.description).toContain('John Wick: Chapter 2');
  });

  it('says "titles" when the chain mixes films and series', () => {
    // The MCU chain runs through The Falcon and the Winter Soldier. Calling
    // that "9 films" is false, and a reader notices immediately.
    const mixed = [entry('A Film', '2019-01-01', 'movie', 1), entry('A Series', '2021-01-01', 'tv', 2)];
    expect(watchOrderMeta({ title: 'A Film', mediaType: 'movie', tmdbId: 1 }, mixed, SITE).title).toContain(
      'all 2 titles in order',
    );
  });

  it('says "series" for an all-TV chain', () => {
    const tv = [entry('S1', '2008-01-01', 'tv', 1), entry('S2', '2015-01-01', 'tv', 2)];
    expect(watchOrderMeta({ title: 'S1', mediaType: 'tv', tmdbId: 1 }, tv, SITE).title).toContain(
      'all 2 series in order',
    );
  });

  it('summarises a long chain rather than listing all of it', () => {
    const long = Array.from({ length: 9 }, (_, i) => entry(`Part ${i + 1}`, `20${10 + i}-01-01`, 'movie', i + 1));
    const meta = watchOrderMeta({ title: 'Part 1', mediaType: 'movie', tmdbId: 1 }, long, SITE);
    expect(meta.description).toContain('and 5 more');
  });

  it('emits an ordered ItemList so the order itself is machine-readable', () => {
    const meta = watchOrderMeta({ title: 'John Wick', mediaType: 'movie', tmdbId: 245891 }, JOHN_WICK, SITE);
    const schema = ld(meta);
    expect(schema['@type']).toBe('ItemList');
    expect(schema.numberOfItems).toBe(4);
    expect(schema.itemListElement?.map((e) => e.position)).toEqual([1, 2, 3, 4]);
    expect(schema.itemListElement?.[0].item.name).toBe('John Wick');
    expect(schema.itemListElement?.[0].item.datePublished).toBe('2014');
    expect(schema.itemListElement?.[0].item.url).toBe(`${SITE}/title/movie/245891`);
  });

  it('omits datePublished rather than inventing one', () => {
    const undated = [entry('Known', '2020-01-01'), entry('Unannounced', null, 'movie', 2)];
    const schema = ld(watchOrderMeta({ title: 'Known', mediaType: 'movie', tmdbId: 1 }, undated, SITE));
    expect(schema.itemListElement?.[1].item.datePublished).toBeUndefined();
  });

  it('builds an absolute canonical url', () => {
    const meta = watchOrderMeta({ title: 'X', mediaType: 'tv', tmdbId: 42 }, JOHN_WICK, SITE);
    expect(meta.canonical).toBe(`${SITE}/title/tv/42/connections`);
    expect(meta.ogType).toBe('video.tv_show');
  });
});

describe('titleDetailMeta', () => {
  it('includes the year and uses the overview as the description', () => {
    const meta = titleDetailMeta(
      {
        title: 'Dune',
        mediaType: 'movie',
        tmdbId: 438631,
        releaseDate: '2021-09-15',
        overview: 'Paul Atreides travels to the most dangerous planet in the universe.',
      },
      SITE,
    );
    expect(meta.title).toBe('Dune (2021) - where to watch | Spotlight');
    expect(meta.description).toContain('Paul Atreides');
    expect(ld(meta)['@type']).toBe('Movie');
  });

  it('falls back to a written description when TMDB has no overview', () => {
    const meta = titleDetailMeta(
      { title: 'Obscure Film', mediaType: 'movie', tmdbId: 9, releaseDate: null, overview: '' },
      SITE,
    );
    expect(meta.description).toContain('Where to stream Obscure Film');
    expect(meta.title).toBe('Obscure Film - where to watch | Spotlight');
  });

  it('marks a series as a TVSeries', () => {
    const meta = titleDetailMeta({ title: 'Show', mediaType: 'tv', tmdbId: 5, releaseDate: '2019-01-01' }, SITE);
    expect(ld(meta)['@type']).toBe('TVSeries');
    expect(meta.ogType).toBe('video.tv_show');
  });
});

describe('staticRouteMeta', () => {
  it('gives each fixed route its own title', () => {
    const home = staticRouteMeta('/', SITE)!;
    const calendar = staticRouteMeta('/calendar', SITE)!;
    expect(home.title).not.toBe(calendar.title);
    expect(home.canonical).toBe(`${SITE}/`);
    expect(ld(home)['@type']).toBe('WebSite');
  });

  it('returns null for a route it does not describe', () => {
    expect(staticRouteMeta('/list/watchlist', SITE)).toBeNull();
  });
});

describe('absoluteUrl', () => {
  it('joins cleanly regardless of trailing or leading slashes', () => {
    expect(absoluteUrl('https://x.com/', '/a')).toBe('https://x.com/a');
    expect(absoluteUrl('https://x.com', 'a')).toBe('https://x.com/a');
  });
});

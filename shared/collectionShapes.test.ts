import { describe, expect, it } from 'vitest';
import {
  EPISODIC_PART_THRESHOLD,
  MAX_CAN_NEIGHBOURS,
  SAME_SERIES_REASON,
  SIDE_STORY_REASON,
  hasStoryOrder,
  planCollection,
  storyRank,
  type CollectionPart,
} from './collectionShapes';

// Every fixture below is real TMDB data (ids, titles, release dates), pulled
// from the live /collection endpoint. Synthetic fixtures would prove the code
// self-consistent; these prove it right about the collections it will actually
// meet, and they are the exact cases the curated table in
// data/collection-shapes.json claims to handle.

function parts(rows: [number, string, string | null][]): CollectionPart[] {
  return rows.map(([id, title, releaseDate]) => ({ id, title, posterPath: null, releaseDate }));
}

const STAR_WARS = parts([
  [11, 'Star Wars', '1977-05-25'],
  [1891, 'The Empire Strikes Back', '1980-05-20'],
  [1892, 'Return of the Jedi', '1983-05-25'],
  [1893, 'Star Wars: Episode I - The Phantom Menace', '1999-05-19'],
  [1894, 'Star Wars: Episode II - Attack of the Clones', '2002-05-15'],
  [1895, 'Star Wars: Episode III - Revenge of the Sith', '2005-05-17'],
  [140607, 'Star Wars: The Force Awakens', '2015-12-15'],
  [181808, 'Star Wars: The Last Jedi', '2017-12-13'],
  [181812, 'Star Wars: The Rise of Skywalker', '2019-12-18'],
]);

const HARRY_POTTER = parts([
  [671, "Harry Potter and the Philosopher's Stone", '2001-11-16'],
  [672, 'Harry Potter and the Chamber of Secrets', '2002-11-13'],
  [673, 'Harry Potter and the Prisoner of Azkaban', '2004-05-31'],
  [674, 'Harry Potter and the Goblet of Fire', '2005-11-16'],
  [675, 'Harry Potter and the Order of the Phoenix', '2007-07-08'],
  [767, 'Harry Potter and the Half-Blood Prince', '2009-07-15'],
  [12444, 'Harry Potter and the Deathly Hallows: Part 1', '2010-11-17'],
  [12445, 'Harry Potter and the Deathly Hallows: Part 2', '2011-07-12'],
]);

const BOND = parts([
  [646, 'Dr. No', '1962-10-07'],
  [657, 'From Russia with Love', '1963-10-10'],
  [658, 'Goldfinger', '1964-09-20'],
  [660, 'Thunderball', '1965-12-11'],
  [36557, 'Casino Royale', '2006-11-14'],
  [10764, 'Quantum of Solace', '2008-10-29'],
  [37724, 'Skyfall', '2012-10-24'],
  [206647, 'Spectre', '2015-10-26'],
  [370172, 'No Time to Die', '2021-09-29'],
  [1184696, 'Untitled James Bond Film', null],
]);

const GODFATHER = parts([
  [238, 'The Godfather', '1972-03-14'],
  [240, 'The Godfather Part II', '1974-12-20'],
  [242, 'The Godfather Part III', '1990-12-25'],
  [1674276, 'The Godfather, Coda: The Death of Michael Corleone', '2020-12-08'],
]);

const INSIDIOUS = parts([
  [49018, 'Insidious', '2011-03-31'],
  [91586, 'Insidious: Chapter 2', '2013-09-12'],
  [280092, 'Insidious: Chapter 3', '2015-05-28'],
  [406563, 'Insidious: The Last Key', '2018-01-03'],
  [614479, 'Insidious: The Red Door', '2023-07-05'],
  [1291595, 'Insidious: Out of the Further', '2026-08-19'],
]);

const JUMANJI = parts([
  [8844, 'Jumanji', '1995-12-15'],
  [353486, 'Jumanji: Welcome to the Jungle', '2017-12-20'],
  [512200, 'Jumanji: The Next Level', '2019-12-04'],
  [1260649, 'Jumanji: Open World', '2026-12-24'],
]);

/** Every ordered pair the plan asserts as a prerequisite, as "later<-earlier". */
function mustPairs(plan: ReturnType<typeof planCollection>): string[] {
  return plan.must.map((e) => `${e.later.id}<-${e.earlier.id}`);
}

const PAST = '2030-01-01'; // everything in these fixtures has released

describe('planCollection — chain (the default, and it must stay the default)', () => {
  it('chains Harry Potter end to end: 8 parts, one story, 7 prerequisites', () => {
    const plan = planCollection(1241, HARRY_POTTER, PAST);
    expect(plan.classification).toBe('chain');
    expect(plan.must).toHaveLength(7);
    expect(plan.can).toHaveLength(0);
    expect(mustPairs(plan)).toEqual([
      '672<-671',
      '673<-672',
      '674<-673',
      '675<-674',
      '767<-675',
      '12444<-767',
      '12445<-12444',
    ]);
  });

  it('does not demote a genuine chain merely for being long', () => {
    // The regression this guards: an earlier design used a size threshold as
    // the primary signal, which would have turned Harry Potter into a
    // "same series, not required" list.
    expect(HARRY_POTTER.length).toBeGreaterThan(6);
    expect(planCollection(1241, HARRY_POTTER, PAST).classification).toBe('chain');
  });

  it('emits nothing for a single-part collection', () => {
    const plan = planCollection(999999, parts([[1, 'Only', '2020-01-01']]), PAST);
    expect(plan.must).toHaveLength(0);
    expect(plan.can).toHaveLength(0);
  });
});

describe('planCollection — arcs', () => {
  it('never chains across a Star Wars trilogy boundary', () => {
    const plan = planCollection(10, STAR_WARS, PAST);
    expect(plan.classification).toBe('arcs');
    // The exact edge sync_relations_tmdb.py documents as nonsense, and which
    // is live in production today: Phantom Menace requiring Return of the Jedi.
    expect(mustPairs(plan)).not.toContain('1893<-1892');
    expect(mustPairs(plan)).not.toContain('1892<-1893');
    // The sequel trilogy continues the original, so those six chain as one
    // line (5 pairs); the prequels are their own arc (2 pairs).
    expect(plan.must).toHaveLength(7);
    expect(mustPairs(plan)).toEqual([
      '1891<-11',
      '1892<-1891',
      '140607<-1892',
      '181808<-140607',
      '181812<-181808',
      '1894<-1893',
      '1895<-1894',
    ]);
  });

  it('splits Insidious so The Red Door follows Chapter 2 across the prequels', () => {
    const plan = planCollection(228446, INSIDIOUS, PAST);
    expect(mustPairs(plan)).toEqual([
      '91586<-49018',
      '614479<-91586', // skips the two prequels released in between
      '1291595<-614479',
      '406563<-280092', // the prequel line, on its own
    ]);
    // Chapter 3 is never asserted as a prerequisite of Chapter 2's sequel.
    expect(mustPairs(plan)).not.toContain('614479<-280092');
  });

  it('treats a singleton arc as standing alone, and links it as Can Watch', () => {
    const plan = planCollection(495527, JUMANJI, PAST);
    // The 1995 film is not a prerequisite of the 2017 reboot line.
    expect(mustPairs(plan)).toEqual(['512200<-353486', '1260649<-512200']);
    expect(plan.loose.map((p) => p.id)).toEqual([8844]);
    // ...but is still reachable from it, in both directions.
    const canPairs = plan.can.map((e) => `${e.from.id}->${e.to.id}`);
    expect(canPairs).toContain('8844->353486');
    expect(canPairs).toContain('353486->8844');
    expect(plan.can.every((e) => e.reason === SAME_SERIES_REASON)).toBe(true);
  });
});

describe('planCollection — episodic', () => {
  it('asserts no prerequisite anywhere in James Bond', () => {
    const plan = planCollection(645, BOND, PAST);
    expect(plan.classification).toBe('episodic');
    expect(plan.must).toHaveLength(0);
  });

  it('still surfaces Bond films as siblings, bounded by the fan-out cap', () => {
    const plan = planCollection(645, BOND, PAST);
    expect(plan.can.length).toBeGreaterThan(0);

    const perOrigin = new Map<number, number>();
    for (const e of plan.can) perOrigin.set(e.from.id, (perOrigin.get(e.from.id) ?? 0) + 1);
    // At most MAX_CAN_NEIGHBOURS on each side. Bounded because
    // scripts/lib_relations.py caps a generator at 12 edges per kind and
    // silently truncating past it would drop real data.
    for (const count of perOrigin.values()) {
      expect(count).toBeLessThanOrEqual(MAX_CAN_NEIGHBOURS * 2);
    }
    expect(plan.can.every((e) => e.reason === SAME_SERIES_REASON)).toBe(true);
  });

  it('falls back to episodic above the size threshold, and says so', () => {
    const many = parts(
      Array.from({ length: EPISODIC_PART_THRESHOLD + 1 }, (_, i) => [
        9_000_000 + i,
        `Entry ${i}`,
        `20${String(10 + i).padStart(2, '0')}-01-01`,
      ] as [number, string, string]),
    );
    const plan = planCollection(424242, many, PAST);
    expect(plan.classification).toBe('episodic');
    expect(plan.must).toHaveLength(0);
    expect(plan.warnings.join(' ')).toMatch(/exceeds EPISODIC_PART_THRESHOLD/);
  });

  it('leaves a collection just under the threshold as a chain', () => {
    const many = parts(
      Array.from({ length: EPISODIC_PART_THRESHOLD }, (_, i) => [
        9_100_000 + i,
        `Entry ${i}`,
        `20${String(10 + i).padStart(2, '0')}-01-01`,
      ] as [number, string, string]),
    );
    expect(planCollection(424243, many, PAST).classification).toBe('chain');
  });
});

describe('planCollection — exclusions', () => {
  it('keeps The Godfather Coda out of the chain, since it is a recut of Part III', () => {
    const plan = planCollection(230, GODFATHER, PAST);
    expect(mustPairs(plan)).toEqual(['240<-238', '242<-240']);
    expect(mustPairs(plan)).not.toContain('1674276<-242');
    expect(plan.loose.map((p) => p.id)).toEqual([1674276]);
    // Described as a side story from both ends, not as a sibling episode.
    expect(plan.can.every((e) => e.reason === SIDE_STORY_REASON)).toBe(true);
  });
});

describe('planCollection — unreleased prerequisites', () => {
  const DUNE = parts([
    [438631, 'Dune', '2021-09-15'],
    [693134, 'Dune: Part Two', '2024-02-27'],
    [1170608, 'Dune: Part Three', '2026-12-15'],
  ]);

  it('still points an announced sequel at its released predecessor', () => {
    // Part Three has not come out, but Part Two has — so "Part Three assumes
    // Part Two" is a true and useful statement today. What the rule forbids is
    // the other direction: naming an unreleased film as required viewing.
    expect(mustPairs(planCollection(726871, DUNE, '2026-09-08'))).toEqual([
      '693134<-438631',
      '1170608<-693134',
    ]);
  });

  it('drops the pair when the prerequisite itself has not released', () => {
    // Standing in 2023: Part Two is still unreleased, so "Part Three requires
    // Part Two" must not be asserted as something a viewer can act on.
    expect(mustPairs(planCollection(726871, DUNE, '2023-01-01'))).toEqual(['693134<-438631']);
  });

  it('sorts undated parts last so they never invent a prerequisite', () => {
    const plan = planCollection(645, BOND, PAST);
    expect(plan.loose[plan.loose.length - 1].id).toBe(1184696);
  });
});

describe('planCollection — input robustness', () => {
  it('does not care what order parts arrive in', () => {
    const shuffled = [...HARRY_POTTER].reverse();
    expect(mustPairs(planCollection(1241, shuffled, PAST))).toEqual(
      mustPairs(planCollection(1241, HARRY_POTTER, PAST)),
    );
  });

  it('warns when a curated arc names an id the collection no longer has', () => {
    const trimmed = STAR_WARS.filter((p) => p.id !== 1892);
    const plan = planCollection(10, trimmed, PAST);
    expect(plan.warnings.join(' ')).toMatch(/no longer contains/);
    // Still produces the arcs it can.
    expect(mustPairs(plan)).toContain('1891<-11');
  });

  it('warns and keeps a part loose when no arc claims it', () => {
    const extra = [...STAR_WARS, ...parts([[999001, 'Star Wars: Something New', '2031-05-01']])];
    const plan = planCollection(10, extra, PAST);
    expect(plan.warnings.join(' ')).toMatch(/not named in any arc/);
    expect(plan.loose.map((p) => p.id)).toContain(999001);
  });

  it('treats an unknown collection id as a plain chain', () => {
    expect(planCollection(123456789, HARRY_POTTER, PAST).classification).toBe('chain');
  });

  it('tolerates a null collection id', () => {
    expect(planCollection(null, HARRY_POTTER, PAST).classification).toBe('chain');
  });
});

describe('story order', () => {
  it('puts the Star Wars prequels first', () => {
    const order = STAR_WARS.map((p) => p.id).sort((a, b) => storyRank(a)! - storyRank(b)!);
    expect(order).toEqual([1893, 1894, 1895, 11, 1891, 1892, 140607, 181808, 181812]);
  });

  it('puts Tokyo Drift after Fast & Furious 6', () => {
    expect(storyRank(9615)).toBeGreaterThan(storyRank(82992)!);
    expect(storyRank(9615)).toBeLessThan(storyRank(168259)!);
  });

  it('puts The Last Key first in Insidious', () => {
    expect(storyRank(406563)).toBe(0);
    expect(storyRank(49018)).toBeGreaterThan(storyRank(280092)!);
  });

  it('is undefined for titles whose release order already is the story order', () => {
    expect(storyRank(671)).toBeUndefined(); // Harry Potter
    expect(storyRank(245891)).toBeUndefined(); // John Wick
  });

  it('reports whether a toggle would change anything for a given set of titles', () => {
    expect(hasStoryOrder(STAR_WARS.map((p) => p.id))).toBe(true);
    expect(hasStoryOrder(HARRY_POTTER.map((p) => p.id))).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { writeCollectionChain } from './relationsDb';
import type { CollectionPart } from '../shared/collectionShapes';

// writeCollectionChain is where the classification in
// shared/collectionShapes.ts turns into rows. Those two can drift — the shape
// engine can be right while the write path drops the `can` edges, mislabels a
// direction, or violates one of the table's CHECK constraints — so this
// asserts on the values actually handed to Postgres rather than trusting the
// plan alone.

/** What writeCollectionChain actually needs from the client. Narrower than
 *  postgres.Sql, whose own signature is generic over `any`. */
type FakeSql = Parameters<typeof writeCollectionChain>[0];

interface CapturedEdge {
  fromId: number;
  toId: number;
  kind: string;
  direction: string | null;
  reason: string | null;
  confidence: number;
}

/**
 * Stands in for the postgres.js tagged-template client.
 *
 * postgres.js interleaves the values into the strings array, so position is
 * the only thing identifying a column. Reading them back by index is brittle
 * against an edit to the INSERT, which is exactly why this asserts the column
 * list it depends on first — if the statement's shape changes, this fails
 * loudly instead of silently checking the wrong fields.
 */
function fakeSql(): { sql: FakeSql; edges: CapturedEdge[] } {
  const edges: CapturedEdge[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (!text.includes('INSERT INTO title_relations')) return Promise.resolve([]);

    expect(text).toContain(
      '(from_media_type, from_tmdb_id, to_media_type, to_tmdb_id, kind, direction,\n       reason, source, confidence, to_title, to_poster_path, to_release_date)',
    );
    // VALUES ('movie', $fromId, 'movie', $toId, $kind, $direction,
    //         $reason, 'tmdb', $confidence, $toTitle, $toPoster, $toDate)
    const [fromId, toId, kind, direction, reason, confidence] = values as [
      number,
      number,
      string,
      string | null,
      string | null,
      number,
    ];
    edges.push({ fromId, toId, kind, direction, reason, confidence });
    // One row back = "the upsert landed", which is what `written` counts.
    return Promise.resolve([{ '?column?': 1 }]);
  }) as unknown as FakeSql;
  return { sql, edges };
}

function parts(rows: [number, string, string | null][]): CollectionPart[] {
  return rows.map(([id, title, releaseDate]) => ({ id, title, posterPath: null, releaseDate }));
}

const STAR_WARS = parts([
  [11, 'Star Wars', '1977-05-25'],
  [1891, 'The Empire Strikes Back', '1980-05-20'],
  [1892, 'Return of the Jedi', '1983-05-25'],
  [1893, 'The Phantom Menace', '1999-05-19'],
  [1894, 'Attack of the Clones', '2002-05-15'],
  [1895, 'Revenge of the Sith', '2005-05-17'],
  [140607, 'The Force Awakens', '2015-12-15'],
  [181808, 'The Last Jedi', '2017-12-13'],
  [181812, 'The Rise of Skywalker', '2019-12-18'],
]);

const JOHN_WICK = parts([
  [245891, 'John Wick', '2014-10-16'],
  [324552, 'John Wick: Chapter 2', '2017-02-08'],
  [458156, 'John Wick: Chapter 3 - Parabellum', '2019-05-15'],
  [603692, 'John Wick: Chapter 4', '2023-03-21'],
]);

const UNTOLD = parts([
  [857497, 'Untold: Malice at the Palace', '2021-08-10'],
  [857729, 'Untold: Deal with the Devil', '2021-08-17'],
  [857732, 'Untold: Crime & Penalties', '2021-08-31'],
  [862582, 'Untold: Breaking Point', '2021-09-07'],
  [1002305, 'Untold: The Rise and Fall of AND1', '2022-08-23'],
  [1465024, 'Untold: The Liver King', '2025-05-12'],
]);

describe('writeCollectionChain', () => {
  it('writes a straight chain in both directions', async () => {
    const { sql, edges } = fakeSql();
    const result = await writeCollectionChain(sql, 404609, JOHN_WICK);

    expect(result.classification).toBe('chain');
    // 3 consecutive pairs x 2 directions.
    expect(edges).toHaveLength(6);
    expect(result.written).toBe(6);
    expect(edges.every((e) => e.kind === 'must')).toBe(true);

    const before = edges.filter((e) => e.direction === 'before');
    const after = edges.filter((e) => e.direction === 'after');
    expect(before).toHaveLength(3);
    expect(after).toHaveLength(3);
    // Chapter 2 requires the first film; the first film continues into it.
    expect(before).toContainEqual(expect.objectContaining({ fromId: 324552, toId: 245891 }));
    expect(after).toContainEqual(expect.objectContaining({ fromId: 245891, toId: 324552 }));
  });

  it('never writes the Star Wars trilogy-boundary edge', async () => {
    const { sql, edges } = fakeSql();
    const result = await writeCollectionChain(sql, 10, STAR_WARS);

    expect(result.classification).toBe('arcs');
    const pairs = edges.map((e) => `${e.fromId}->${e.toId}`);
    // The live-in-production bug this whole change exists to remove.
    expect(pairs).not.toContain('1893->1892');
    expect(pairs).not.toContain('1892->1893');
    // The sequel trilogy continues the original (one 6-part arc = 5 pairs) and
    // the prequels are their own arc (2 pairs); 7 pairs x 2 directions.
    expect(edges).toHaveLength(14);
    // ...and the prequel line is never linked to either of the others.
    expect(pairs).not.toContain('1893->1895');
    expect(pairs).not.toContain('140607->1895');
  });

  it('writes no prerequisite for an anthology, only sibling links', async () => {
    const { sql, edges } = fakeSql();
    const result = await writeCollectionChain(sql, 1745820, UNTOLD);

    expect(result.classification).toBe('episodic');
    expect(edges.filter((e) => e.kind === 'must')).toHaveLength(0);
    expect(edges.filter((e) => e.kind === 'can').length).toBeGreaterThan(0);
  });

  it("satisfies the table's CHECK constraints on every edge it writes", async () => {
    // migrations/0003: a 'must' edge needs a direction and may omit a reason;
    // a 'can' edge must have NO direction and MUST have a reason. Violating
    // either is a runtime 500 the type system cannot catch.
    for (const [collectionId, fixture] of [
      [404609, JOHN_WICK],
      [10, STAR_WARS],
      [1745820, UNTOLD],
    ] as const) {
      const { sql, edges } = fakeSql();
      await writeCollectionChain(sql, collectionId, fixture);
      for (const edge of edges) {
        if (edge.kind === 'must') {
          expect(edge.direction).toMatch(/^(before|after)$/);
        } else {
          expect(edge.direction).toBeNull();
          expect(typeof edge.reason).toBe('string');
          expect(edge.reason).not.toBe('');
        }
      }
    }
  });

  it('writes sibling edges below the Must floor and above the Can floor', async () => {
    const { sql, edges } = fakeSql();
    await writeCollectionChain(sql, 1745820, UNTOLD);
    // Mirrors MUST_CONFIDENCE_FLOOR (0.75) / CAN_CONFIDENCE_FLOOR (0.5): these
    // have to render as Can Watch and must never be promotable to a
    // prerequisite by anything reading confidence alone.
    for (const edge of edges) {
      expect(edge.confidence).toBeGreaterThanOrEqual(0.5);
      expect(edge.confidence).toBeLessThan(0.75);
    }
  });

  it('writes nothing for a collection with a single part', async () => {
    const { sql, edges } = fakeSql();
    const result = await writeCollectionChain(sql, 999999, parts([[1, 'Only', '2020-01-01']]));
    expect(edges).toHaveLength(0);
    expect(result.written).toBe(0);
  });

  it('surfaces drift warnings rather than swallowing them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql } = fakeSql();
    const result = await writeCollectionChain(sql, 10, STAR_WARS.filter((p) => p.id !== 1892));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

import { describe, expect, it } from 'vitest';
import type { EvidenceSection, HeatCell, LocalHook } from '../../shared/types/pulse';
import { AGENT_SUGGESTION, chipsForEvidence, chipsForId, hookChips, topNeighbourhoods, type SectionBundle } from './pulseEvidence';

const ok = <T,>(data: T): EvidenceSection<T> => ({ status: 'ok', data, provenance: [] });
const cell = (neighbourhood: string | null, affinity: number): HeatCell => ({ lat: 28.6, lon: 77.2, geohash: 'ttn', affinity, popularity: 0.1, neighbourhood });

const bundle: SectionBundle = {
  who: ok({ age: { '24_and_younger': 0.1, '25_to_29': 0.3, '30_to_34': 0, '35_to_44': 0, '45_to_54': 0, '55_and_older': 0 }, gender: { male: -0.1, female: 0.1 } }),
  where: ok([cell('Hauz Khas', 0.9), cell('Hauz Khas', 0.8), cell(null, 0.7), cell('Connaught Place', 0.6), cell('Khan Market', 0.5), cell('Saket', 0.4)]),
  venues: ok([{ entityId: 'urn:v/1', name: 'Blue Door Cafe', address: null, lat: null, lon: null, priceLevel: null, tags: [], affinity: 0.5 }]),
  themes: ok([{ tagId: 'tag-1', name: 'Rooftop', affinity: 0.4 }]),
  artists: ok([{ entityId: 'art1', name: 'Prateek Kuhad', affinity: 0.4 }]),
  brands: ok([{ entityId: 'br1', name: 'Blue Tokai', affinity: 0.4 }]),
  hook: ok<LocalHook[]>([{ kind: 'filmed', placeName: 'Delhi', landmark: 'Chandni Chowk', source: 'wikipedia' }]),
};

const labels = (id: string, b: SectionBundle = bundle) => chipsForId(id, b, 'Delhi').map((c) => c.label);

describe('topNeighbourhoods', () => {
  it('returns the top distinct named neighbourhoods by affinity, skipping unlabelled cells', () => {
    const top = topNeighbourhoods(bundle.where!.data as HeatCell[], 3);
    expect(top.map((t) => t.name)).toEqual(['Hauz Khas', 'Connaught Place', 'Khan Market']);
  });

  it('sorts by affinity, not arrival order, and is case-insensitive about duplicates', () => {
    const top = topNeighbourhoods([cell('saket', 0.1), cell('Hauz Khas', 0.9), cell('SAKET', 0.95)], 3);
    expect(top.map((t) => t.name)).toEqual(['SAKET', 'Hauz Khas']);
  });

  it('is empty for no cells or no labels', () => {
    expect(topNeighbourhoods([], 3)).toEqual([]);
    expect(topNeighbourhoods([cell(null, 1), cell('  ', 1)], 3)).toEqual([]);
  });
});

describe('chip labels by id prefix', () => {
  it.each([
    ['demo:25_to_29', 'Qloo · demographics'],
    ['demo:female', 'Qloo · demographics'],
    ['heat:0', 'Qloo · heatmap'],
    ['venue:urn:v1', 'Qloo · places'],
    ['tag:tag-1', 'Qloo · tags'],
    ['artist:art1', 'Qloo · artists'],
    ['brand:br1', 'Qloo · brands'],
  ])('%s -> %s', (id, label) => {
    expect(labels(id)).toEqual([label]);
  });

  it('no evidence at all is an Agent suggestion', () => {
    expect(chipsForEvidence([], bundle, 'Delhi').map((c) => c.label)).toEqual([AGENT_SUGGESTION]);
    expect(AGENT_SUGGESTION).toBe('Agent suggestion');
  });

  it('an id the bundle cannot resolve still renders its label chip, with no detail', () => {
    expect(chipsForId('venue:gone', bundle, 'Delhi')).toEqual([{ label: 'Qloo · places', detail: null }]);
    expect(chipsForId('heat:2', {}, 'Delhi')).toEqual([{ label: 'Qloo · heatmap', detail: null }]);
  });

  it('an id with an unknown prefix draws no chip, and a clause of only those falls back to Agent suggestion', () => {
    expect(chipsForId('mystery:1', bundle, 'Delhi')).toEqual([]);
    expect(chipsForEvidence(['mystery:1'], bundle, 'Delhi').map((c) => c.label)).toEqual([AGENT_SUGGESTION]);
  });
});

describe('chip details come from the bundle', () => {
  it('names the venue, tag, artist and brand', () => {
    expect(chipsForId('venue:urn:v1', bundle, 'Delhi')[0].detail).toContain('Blue Door Cafe');
    expect(chipsForId('tag:tag-1', bundle, 'Delhi')[0].detail).toContain('Rooftop');
    expect(chipsForId('artist:art1', bundle, 'Delhi')[0].detail).toContain('Prateek Kuhad');
    expect(chipsForId('brand:br1', bundle, 'Delhi')[0].detail).toContain('Blue Tokai');
  });

  it('gives the age bucket label, and says the skew is relative', () => {
    const detail = chipsForId('demo:25_to_29', bundle, 'Delhi')[0].detail;
    expect(detail).toContain('25–29');
    expect(detail).toMatch(/relative/i);
  });

  it('heat:i is the i-th of the top distinct neighbourhoods, the same order the service numbers them', () => {
    expect(chipsForId('heat:0', bundle, 'Delhi')[0].detail).toContain('Hauz Khas');
    expect(chipsForId('heat:1', bundle, 'Delhi')[0].detail).toContain('Connaught Place');
    expect(chipsForId('heat:2', bundle, 'Delhi')[0].detail).toContain('Khan Market');
  });

  it('matches ids after the same sanitising the service applies', () => {
    const b: SectionBundle = { venues: ok([{ entityId: 'a b/c', name: 'Odd Id Cafe', address: null, lat: null, lon: null, priceLevel: null, tags: [], affinity: null }]) };
    expect(chipsForId('venue:abc', b, 'Delhi')[0].detail).toContain('Odd Id Cafe');
  });
});

describe('hook chips by source', () => {
  const hook = (kind: LocalHook['kind'], source: LocalHook['source']): SectionBundle => ({
    hook: ok<LocalHook[]>([{ kind, placeName: 'Delhi', landmark: null, source }]),
  });

  it('wikipedia + filmed', () => {
    expect(labels('hook:filmed', hook('filmed', 'wikipedia'))).toEqual(['Wikipedia · Films shot in Delhi']);
  });
  it('wikidata + filmed', () => {
    expect(labels('hook:filmed', hook('filmed', 'wikidata'))).toEqual(['Wikidata · filming location']);
  });
  it('set kinds use the "set" labels', () => {
    expect(labels('hook:set', hook('set', 'wikipedia'))).toEqual(['Wikipedia · Films set in Delhi']);
    expect(labels('hook:set', hook('set', 'wikidata'))).toEqual(['Wikidata · narrative location']);
  });
  it('source both renders both chips', () => {
    expect(labels('hook:filmed', hook('filmed', 'both'))).toEqual(['Wikipedia · Films shot in Delhi', 'Wikidata · filming location']);
  });
  it('picks the hook of the matching kind', () => {
    const b: SectionBundle = {
      hook: ok<LocalHook[]>([
        { kind: 'filmed', placeName: 'Delhi', landmark: null, source: 'wikidata' },
        { kind: 'set', placeName: 'Delhi', landmark: null, source: 'wikipedia' },
      ]),
    };
    expect(labels('hook:set', b)).toEqual(['Wikipedia · Films set in Delhi']);
  });
  it('a hook id the hook section cannot confirm is an Agent suggestion, not a Wikipedia or Wikidata chip', () => {
    expect(labels('hook:filmed', {})).toEqual(['Agent suggestion']); // section missing
    expect(labels('hook:set', hook('filmed', 'both'))).toEqual(['Agent suggestion']); // no row of that kind
    expect(labels('hook:filmed', { hook: { status: 'empty', data: null, provenance: [] } })).toEqual(['Agent suggestion']);
  });
  it('an unknown hook kind is not treated as filmed: it draws no chip of its own', () => {
    expect(labels('hook:wrote', hook('filmed', 'both'))).toEqual([]);
    expect(labels('hook:', hook('filmed', 'both'))).toEqual([]);
    expect(chipsForEvidence(['hook:wrote'], hook('filmed', 'both'), 'Delhi').map((c) => c.label)).toEqual(['Agent suggestion']);
  });
  it('hookChips works straight from a LocalHook', () => {
    expect(hookChips({ kind: 'set', source: 'both' }, 'Delhi')).toEqual([
      'Wikipedia · Films set in Delhi',
      'Wikidata · narrative location',
    ]);
  });
});

describe('chipsForEvidence', () => {
  it('dedupes by label and merges the details', () => {
    const b: SectionBundle = {
      ...bundle,
      venues: ok([
        { entityId: 'a', name: 'Alpha', address: null, lat: null, lon: null, priceLevel: null, tags: [], affinity: null },
        { entityId: 'b', name: 'Beta', address: null, lat: null, lon: null, priceLevel: null, tags: [], affinity: null },
      ]),
    };
    const chips = chipsForEvidence(['venue:a', 'venue:b', 'heat:0'], b, 'Delhi');
    expect(chips.map((c) => c.label)).toEqual(['Qloo · places', 'Qloo · heatmap']);
    expect(chips[0].detail).toContain('Alpha');
    expect(chips[0].detail).toContain('Beta');
  });

  it('dedupes a hook source that two ids would both draw', () => {
    const b: SectionBundle = {
      hook: ok<LocalHook[]>([
        { kind: 'filmed', placeName: 'Delhi', landmark: null, source: 'both' },
        { kind: 'set', placeName: 'Delhi', landmark: null, source: 'both' },
      ]),
    };
    const chips = chipsForEvidence(['hook:filmed', 'hook:set'], b, 'Delhi').map((c) => c.label);
    expect(chips).toEqual([
      'Wikipedia · Films shot in Delhi',
      'Wikidata · filming location',
      'Wikipedia · Films set in Delhi',
      'Wikidata · narrative location',
    ]);
  });
});

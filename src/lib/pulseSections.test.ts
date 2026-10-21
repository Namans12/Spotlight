import { describe, expect, it } from 'vitest';
import type { BriefHeader, BriefSectionKey, EvidenceSection } from '../../shared/types/pulse';
import { BRIEF_SECTIONS, initialBriefState, briefReducer, sectionView } from './pulseSections';

const header: BriefHeader = { tmdbId: 1, mediaType: 'movie', title: 'Saffron Nights', posterUrl: null, releaseDate: '2026-10-24', city: 'delhi', cityName: 'Delhi', businessType: 'cafe', qlooEntityId: 'e1' };
const sec = (note = 'x'): EvidenceSection<unknown> => ({ status: 'ok', data: [note], provenance: [] });
const section = (key: BriefSectionKey, s = sec()) => ({ type: 'section' as const, key, section: s });

describe('BRIEF_SECTIONS', () => {
  it('matches the service order for each business type', () => {
    expect(BRIEF_SECTIONS.cafe).toEqual(['who', 'where', 'venues', 'themes', 'artists', 'hook', 'trend', 'campaign']);
    expect(BRIEF_SECTIONS.d2c_food).toEqual(['who', 'where', 'themes', 'brands', 'artists', 'hook', 'trend', 'campaign']);
  });
});

describe('briefReducer', () => {
  it('stores the header and each section as it arrives, in any order', () => {
    let s = initialBriefState;
    s = briefReducer(s, { type: 'event', event: { type: 'header', header } });
    s = briefReducer(s, { type: 'event', event: section('themes') });
    s = briefReducer(s, { type: 'event', event: section('who') });
    expect(s.header).toEqual(header);
    expect(Object.keys(s.sections).sort()).toEqual(['themes', 'who']);
    expect(s.done).toBe(false);
  });

  it('a section that has not arrived is loading until done, then missing', () => {
    let s = briefReducer(initialBriefState, { type: 'event', event: section('who') });
    expect(sectionView(s, 'venues')).toEqual({ kind: 'loading' });
    s = briefReducer(s, { type: 'event', event: { type: 'done' } });
    expect(sectionView(s, 'venues')).toEqual({ kind: 'missing' });
    expect(sectionView(s, 'who')).toMatchObject({ kind: 'section', stale: false });
  });

  it('begin keeps the previous sections but marks them stale; arrivals replace them', () => {
    let s = briefReducer(initialBriefState, { type: 'event', event: section('who', sec('old')) });
    s = briefReducer(s, { type: 'event', event: section('where') });
    s = briefReducer(s, { type: 'event', event: { type: 'done' } });
    s = briefReducer(s, { type: 'begin' });
    expect(s.done).toBe(false);
    expect(sectionView(s, 'who')).toMatchObject({ kind: 'section', stale: true });
    s = briefReducer(s, { type: 'event', event: section('who', sec('new')) });
    expect(sectionView(s, 'who')).toMatchObject({ kind: 'section', stale: false, section: { data: ['new'] } });
    expect(sectionView(s, 'where')).toMatchObject({ stale: true });
  });

  it('done drops stale sections the retry did not send, so they read as "No data returned"', () => {
    let s = briefReducer(initialBriefState, { type: 'event', event: section('who') });
    s = briefReducer(s, { type: 'begin' });
    s = briefReducer(s, { type: 'event', event: { type: 'done' } });
    expect(sectionView(s, 'who')).toEqual({ kind: 'missing' });
  });

  it('a stream that ends without done is interrupted, not complete', () => {
    let s = briefReducer(initialBriefState, { type: 'event', event: section('who') });
    s = briefReducer(s, { type: 'ended' });
    expect(s.interrupted).toBe(true);
    expect(s.done).toBe(false);
    expect(sectionView(s, 'venues')).toEqual({ kind: 'loading' });
  });

  it('ended after done is not an interruption', () => {
    let s = briefReducer(initialBriefState, { type: 'event', event: { type: 'done' } });
    s = briefReducer(s, { type: 'ended' });
    expect(s.interrupted).toBe(false);
  });
});

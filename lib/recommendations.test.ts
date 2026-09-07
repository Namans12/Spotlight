import { describe, expect, it } from 'vitest';
import { scoreCandidates, type CandidateBucket } from './recommendations';
import type { TmdbMovieResult } from './tmdbProxy';

// The ranker's job is to put the obvious answer near the top and keep the
// merely-adjacent one below it. These assert the ordering *rules* on
// controlled input; the tuning itself was done against live TMDB data for the
// pairs a viewer would call obvious (Odyssey/Troy, Dil Chahta Hai/Zindagi Na
// Milegi Dobara, Cars/Cars 3, Friends/How I Met Your Mother).

function movie(id: number, over: Partial<TmdbMovieResult> = {}): TmdbMovieResult {
  return {
    id,
    title: `Title ${id}`,
    mediaType: 'movie',
    posterPath: null,
    backdropPath: null,
    overview: '',
    releaseDate: '2015-01-01',
    voteAverage: 7,
    originalLanguage: 'en',
    ...over,
  };
}

const opts = { originId: 1 };

describe('scoreCandidates', () => {
  it('never recommends the title being viewed', () => {
    const buckets: CandidateBucket[] = [{ kind: 'recommendation', results: [movie(1), movie(2)] }];
    expect(scoreCandidates(buckets, opts).map((r) => r.id)).toEqual([2]);
  });

  it('ranks a title that several signals agree on above one only a single signal found', () => {
    // Wake Up Sid shares Yeh Jawaani Hai Deewani's lead AND its director; a
    // film sharing only the lead should not outrank it.
    const both = movie(10);
    const onlyCast = movie(11);
    const buckets: CandidateBucket[] = [
      { kind: 'person', label: 'Also stars Ranbir Kapoor', results: [onlyCast, both] },
      { kind: 'director', label: 'Also directed by Ayan Mukerji', results: [both] },
    ];
    const ranked = scoreCandidates(buckets, opts);
    expect(ranked[0].id).toBe(10);
    expect(ranked[0].reasons).toContain('Also directed by Ayan Mukerji');
    expect(ranked[0].reasons).toContain('Also stars Ranbir Kapoor');
  });

  it('keeps a franchise entry near the top even when nothing else surfaces it', () => {
    // Cars 3 sits below Toy Story and WALL-E on both popularity and votes, so
    // it fell out of every other bucket while being the single most obvious
    // thing to show someone looking at Cars.
    const cars3 = movie(260514);
    const buckets: CandidateBucket[] = [
      { kind: 'recommendation', results: Array.from({ length: 10 }, (_, i) => movie(100 + i)) },
      { kind: 'franchise', label: 'Part of the same series', results: [cars3] },
    ];
    const ranked = scoreCandidates(buckets, opts);
    expect(ranked.slice(0, 3).map((r) => r.id)).toContain(260514);
  });

  it('ranks by position within a bucket', () => {
    const buckets: CandidateBucket[] = [{ kind: 'recommendation', results: [movie(2), movie(3), movie(4)] }];
    expect(scoreCandidates(buckets, opts).map((r) => r.id)).toEqual([2, 3, 4]);
  });

  it('reads only the head of the behavioural list', () => {
    // Items past BUCKET_DEPTH.recommendation must not score at all: for
    // Friends they were Traffic Light and Love, American Style, which crowded
    // out The Big Bang Theory.
    const results = Array.from({ length: 20 }, (_, i) => movie(100 + i));
    const ranked = scoreCandidates([{ kind: 'recommendation', results }], opts);
    expect(ranked.some((r) => r.id === 100)).toBe(true);
    expect(ranked.some((r) => r.id === 119)).toBe(false);
  });

  it('prefers a same-language peer over a foreign one with equal provenance', () => {
    const hindi = movie(20, { originalLanguage: 'hi' });
    const english = movie(21, { originalLanguage: 'en' });
    const buckets: CandidateBucket[] = [{ kind: 'keyword', label: 'Also coming of age', results: [hindi, english] }];
    const ranked = scoreCandidates(buckets, { originId: 1, originLanguage: 'hi' });
    expect(ranked[0].id).toBe(20);
  });

  it('discounts a cross-language title, without excluding it', () => {
    // TMDB's behavioural data skews English, so a Hindi show's own
    // /recommendations answers largely in English. Demoting a mismatch (not
    // just rewarding a match) is what moved The Family Man's top results from
    // English to Farzi and Guns & Gulaabs.
    const foreign = movie(70, { originalLanguage: 'en' });
    const local = movie(71, { originalLanguage: 'hi' });
    // One bucket each, so both sit at rank 0 and language is the only
    // difference between them.
    const ranked = scoreCandidates(
      [
        { kind: 'keyword', label: 'Similar themes', results: [foreign] },
        { kind: 'keyword', label: 'Similar themes', results: [local] },
      ],
      { originId: 1, originLanguage: 'hi' },
    );
    expect(ranked.map((r) => r.id)).toEqual([71, 70]);
    // Discounted, never filtered.
    expect(ranked).toHaveLength(2);
  });

  it('still ranks a cross-language title first when a strong signal carries it', () => {
    // The same director's English-language film is a better answer than a
    // same-language title with nothing behind it.
    const foreignButStrong = movie(80, { originalLanguage: 'en' });
    const localButWeak = movie(81, { originalLanguage: 'hi' });
    const ranked = scoreCandidates(
      [
        { kind: 'director', label: 'Also directed by X', results: [foreignButStrong] },
        { kind: 'similar', results: [localButWeak] },
      ],
      { originId: 1, originLanguage: 'hi' },
    );
    expect(ranked[0].id).toBe(80);
  });

  it('leaves ordering untouched when everything shares the origin language', () => {
    // An English catalogue for an English title: the factor applies uniformly
    // and must not reshuffle anything.
    const results = [movie(90), movie(91), movie(92)];
    const withLang = scoreCandidates([{ kind: 'recommendation', results }], { originId: 1, originLanguage: 'en' });
    const withoutLang = scoreCandidates([{ kind: 'recommendation', results }], { originId: 1 });
    expect(withLang.map((r) => r.id)).toEqual(withoutLang.map((r) => r.id));
  });

  it('does not let genre overlap outweigh a shared cast and director', () => {
    // Brahmastra shares Yeh Jawaani Hai Deewani's lead, director and studio,
    // and shares no genre with it at all. Genre must never be a gate.
    const noGenreOverlap = movie(30, { genreIds: [28, 14] });
    const genreTwin = movie(31, { genreIds: [35, 10749] });
    const buckets: CandidateBucket[] = [
      { kind: 'person', label: 'Also stars Ranbir Kapoor', results: [noGenreOverlap] },
      { kind: 'director', label: 'Also directed by Ayan Mukerji', results: [noGenreOverlap] },
      { kind: 'keyword', label: 'Also romance', results: [genreTwin] },
    ];
    const ranked = scoreCandidates(buckets, { originId: 1, originGenreIds: [35, 10749] });
    expect(ranked[0].id).toBe(30);
  });

  it('drops the thinly-rated long tail but keeps titles with no vote data', () => {
    const obscure = movie(40, { voteCount: 3 });
    const known = movie(41, { voteCount: 5000 });
    const unknownVotes = movie(42);
    const buckets: CandidateBucket[] = [{ kind: 'keyword', label: 'x', results: [obscure, known, unknownVotes] }];
    const ids = scoreCandidates(buckets, opts).map((r) => r.id);
    expect(ids).not.toContain(40);
    expect(ids).toEqual(expect.arrayContaining([41, 42]));
  });

  it('reports the strongest reason first, and none for a purely behavioural pick', () => {
    const both = movie(50);
    const buckets: CandidateBucket[] = [
      { kind: 'company', label: 'From Dharma Productions', results: [both] },
      { kind: 'director', label: 'Also directed by Ayan Mukerji', results: [both] },
      { kind: 'recommendation', results: [movie(51)] },
    ];
    const ranked = scoreCandidates(buckets, opts);
    expect(ranked.find((r) => r.id === 50)!.reasons[0]).toBe('Also directed by Ayan Mukerji');
    expect(ranked.find((r) => r.id === 51)!.reasons).toEqual([]);
  });

  it('does not repeat a reason when one bucket returns a title more than once', () => {
    const dupe = movie(60);
    const buckets: CandidateBucket[] = [{ kind: 'person', label: 'Also stars X', results: [dupe, dupe] }];
    expect(scoreCandidates(buckets, opts)[0].reasons).toEqual(['Also stars X']);
  });

  it('is stable and empty-safe', () => {
    expect(scoreCandidates([], opts)).toEqual([]);
    expect(scoreCandidates([{ kind: 'recommendation', results: [] }], opts)).toEqual([]);
  });

  it('honours the limit', () => {
    const results = Array.from({ length: 30 }, (_, i) => movie(200 + i));
    expect(scoreCandidates([{ kind: 'person', label: 'x', results }], { originId: 1, limit: 5 })).toHaveLength(5);
  });
});

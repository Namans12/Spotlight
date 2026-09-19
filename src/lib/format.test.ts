import { describe, it, expect } from 'vitest';
import { formatRuntime, formatRuntimeLong, finishTime, formatMoney, formatDate } from './format';

describe('formatRuntime', () => {
  it('reads a feature runtime as hours and minutes', () => {
    expect(formatRuntime(93)).toBe('1 hr 33 min');
    expect(formatRuntime(166)).toBe('2 hr 46 min');
  });

  it('drops the hour part below an hour rather than printing "0 hr"', () => {
    expect(formatRuntime(45)).toBe('45 min');
    expect(formatRuntime(22)).toBe('22 min');
    expect(formatRuntime(59)).toBe('59 min');
  });

  it('drops the minute part on the hour rather than printing "0 min"', () => {
    expect(formatRuntime(60)).toBe('1 hr');
    expect(formatRuntime(120)).toBe('2 hr');
  });

  it('treats the boundary minute as an hour and one', () => {
    expect(formatRuntime(61)).toBe('1 hr 1 min');
  });

  it('handles a runtime long enough to be a miniseries', () => {
    expect(formatRuntime(605)).toBe('10 hr 5 min');
  });

  // TMDB stores 0 and null for "unknown" interchangeably, and a rounded float
  // arrives from the providers batch. All three must degrade, not print.
  it('returns null for everything that is not a real duration', () => {
    expect(formatRuntime(0)).toBeNull();
    expect(formatRuntime(null)).toBeNull();
    expect(formatRuntime(undefined)).toBeNull();
    expect(formatRuntime(-30)).toBeNull();
    expect(formatRuntime(Number.NaN)).toBeNull();
    expect(formatRuntime(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('rounds a fractional runtime instead of printing a decimal', () => {
    expect(formatRuntime(92.6)).toBe('1 hr 33 min');
  });
});

describe('formatRuntimeLong', () => {
  it('spells the duration out for assistive tech', () => {
    expect(formatRuntimeLong(93)).toBe('1 hour 33 minutes');
    expect(formatRuntimeLong(61)).toBe('1 hour 1 minute');
    expect(formatRuntimeLong(120)).toBe('2 hours');
    expect(formatRuntimeLong(45)).toBe('45 minutes');
  });

  it('degrades the same way the short form does', () => {
    expect(formatRuntimeLong(0)).toBeNull();
    expect(formatRuntimeLong(null)).toBeNull();
  });
});

describe('finishTime', () => {
  it('adds the runtime to the clock', () => {
    // 18:00 + 93 min = 19:33. Asserted through the same Intl call the
    // implementation uses, so this passes under any locale CI runs in.
    const start = new Date('2026-09-19T18:00:00');
    const expected = new Date('2026-09-19T19:33:00').toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(finishTime(93, start)).toBe(expected);
  });

  it('crosses midnight without breaking', () => {
    const start = new Date('2026-09-19T23:30:00');
    const expected = new Date('2026-09-20T01:00:00').toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(finishTime(90, start)).toBe(expected);
  });

  it('has nothing to say without a runtime', () => {
    expect(finishTime(null)).toBeNull();
    expect(finishTime(0)).toBeNull();
  });
});

describe('formatMoney', () => {
  it('compacts large sums', () => {
    expect(formatMoney(80_000_000)).toBe('$80M');
    expect(formatMoney(117_234_000)).toBe('$117.2M');
    expect(formatMoney(1_200_000_000)).toBe('$1.2B');
  });

  // TMDB reports 0 for "unknown", which is almost never a real zero.
  it('treats zero and missing as unknown', () => {
    expect(formatMoney(0)).toBeNull();
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
    expect(formatMoney(-5)).toBeNull();
  });
});

describe('formatDate', () => {
  it('formats day-first for an Indian audience', () => {
    expect(formatDate('2026-08-12')).toBe('12 Aug 2026');
    expect(formatDate('2001-07-20')).toBe('20 Jul 2001');
  });

  // The date is parsed as UTC so a reader west of Greenwich doesn't see the
  // day before the one TMDB published.
  it('does not shift the day by timezone', () => {
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
  });

  it('returns null for the empty string TMDB uses for undated titles', () => {
    expect(formatDate('')).toBeNull();
    expect(formatDate(null)).toBeNull();
    expect(formatDate('2026')).toBeNull();
    expect(formatDate('not-a-date')).toBeNull();
  });
});

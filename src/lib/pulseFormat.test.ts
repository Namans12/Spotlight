import { describe, expect, it } from 'vitest';
import { formatReleaseDate, formatReleaseDateFull, splitWhy } from './pulseFormat';

describe('splitWhy', () => {
  it('splits the rank sentence from its reasons', () => {
    expect(splitWhy('#2 of 14 for Delhi audiences · strongest around Hauz Khas · shot in Chandni Chowk')).toEqual({
      rank: '#2 of 14 for Delhi audiences',
      reasons: ['strongest around Hauz Khas', 'shot in Chandni Chowk'],
    });
  });

  it('handles the rank-only line (no claim cleared its floor)', () => {
    expect(splitWhy('#3 of 3 for Delhi audiences')).toEqual({ rank: '#3 of 3 for Delhi audiences', reasons: [] });
  });

  it('drops empty segments', () => {
    expect(splitWhy('#1 of 2 for Delhi audiences ·  · ')).toEqual({ rank: '#1 of 2 for Delhi audiences', reasons: [] });
  });
});

describe('formatReleaseDate', () => {
  it('formats a calendar day without timezone drift', () => {
    expect(formatReleaseDate('2026-10-24')).toBe('24 Oct');
    expect(formatReleaseDate('2026-01-01')).toBe('1 Jan');
  });

  it('returns an unparseable value as-is', () => {
    expect(formatReleaseDate('soon')).toBe('soon');
  });
});

describe('formatReleaseDateFull', () => {
  it('reads the calendar day, with the year, whatever the timezone', () => {
    expect(formatReleaseDateFull('2026-10-24')).toBe('24 Oct 2026');
    expect(formatReleaseDateFull('2026-10-24T18:30:00Z')).toBe('24 Oct 2026');
  });
  it('hands back what it cannot read', () => {
    expect(formatReleaseDateFull('soon')).toBe('soon');
  });
});

import { describe, expect, it } from 'vitest';
import { divergingBars, formatSkew, heatRadii, sparkPoints } from './pulseCharts';

describe('divergingBars', () => {
  it('scales every bar against the largest absolute value, centred on zero', () => {
    const bars = divergingBars([
      { key: 'a', label: 'A', value: 0.4 },
      { key: 'b', label: 'B', value: -0.2 },
      { key: 'c', label: 'C', value: 0 },
    ]);
    expect(bars.map((b) => b.side)).toEqual(['right', 'left', 'zero']);
    expect(bars.map((b) => b.widthPct)).toEqual([50, 25, 0]); // half-track = 50%
  });

  it('is all zero-width when every value is zero or missing', () => {
    const bars = divergingBars([{ key: 'a', label: 'A', value: 0 }, { key: 'b', label: 'B', value: NaN }]);
    expect(bars.map((b) => b.widthPct)).toEqual([0, 0]);
  });

  it('can share one scale across groups', () => {
    const bars = divergingBars([{ key: 'a', label: 'A', value: 0.1 }], 0.2);
    expect(bars[0].widthPct).toBe(25);
  });
});

describe('formatSkew', () => {
  it('signs positives and uses a real minus for negatives', () => {
    expect(formatSkew(0.341)).toBe('+0.34');
    expect(formatSkew(-0.05)).toBe('−0.05');
    expect(formatSkew(0)).toBe('0.00');
  });
});

describe('heatRadii', () => {
  it('is at least 6px and grows with affinity within the result', () => {
    const r = heatRadii([0.1, 0.5, 0.9]);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(6);
    expect(r[0]).toBeLessThan(r[1]);
    expect(r[1]).toBeLessThan(r[2]);
  });
  it('gives equal affinities one middling radius', () => {
    const r = heatRadii([0.5, 0.5]);
    expect(r[0]).toBe(r[1]);
    expect(r[0]).toBeGreaterThanOrEqual(6);
  });
  it('handles empty', () => {
    expect(heatRadii([])).toEqual([]);
  });
});

describe('sparkPoints', () => {
  it('maps a series into the box, higher values higher up', () => {
    const p = sparkPoints([1, 2, 3], 100, 20);
    expect(p).toHaveLength(3);
    expect(p[0].x).toBe(0);
    expect(p[2].x).toBe(100);
    expect(p[0].y).toBeGreaterThan(p[2].y);
  });
  it('a flat series is a mid-height line, and one point sits mid-box', () => {
    expect(sparkPoints([5, 5], 100, 20).map((q) => q.y)).toEqual([10, 10]);
    expect(sparkPoints([5], 100, 20)).toEqual([{ x: 50, y: 10 }]);
  });
});

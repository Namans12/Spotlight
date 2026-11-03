// Small pure helpers behind the brief's three drawings: the diverging skew
// bars, the heatmap's circle sizes and the trend sparkline.

export interface BarInput {
  key: string;
  label: string;
  value: number;
}

export interface Bar extends BarInput {
  side: 'left' | 'right' | 'zero';
  /** Width as a percent of the whole track; the largest bar is 50 (half the
   *  track), because zero sits in the middle. */
  widthPct: number;
}

/**
 * Diverging bars centred on zero. Everything is scaled against `scale` (the
 * largest absolute value by default), so bars within a group are comparable;
 * pass one `scale` to several groups to make them comparable with each other.
 * A value below the average goes left, above goes right.
 */
export function divergingBars(rows: BarInput[], scale?: number): Bar[] {
  const finite = (v: number) => (Number.isFinite(v) ? v : 0);
  const max = scale ?? Math.max(0, ...rows.map((r) => Math.abs(finite(r.value))));
  return rows.map((r) => {
    const v = finite(r.value);
    const widthPct = max > 0 ? Math.min(50, (Math.abs(v) / max) * 50) : 0;
    return { ...r, value: v, side: v > 0 ? 'right' : v < 0 ? 'left' : 'zero', widthPct };
  });
}

/** "+0.34", "−0.05" (a real minus sign, which reads better and sorts as text), "0.00". */
export function formatSkew(v: number): string {
  const abs = Math.abs(v).toFixed(2);
  if (abs === '0.00') return '0.00';
  return `${v > 0 ? '+' : '−'}${abs}`;
}

export const HEAT_MIN_RADIUS = 6;
const HEAT_MAX_RADIUS = 20;

/** Circle radii in pixels, scaled within this result only (affinity is
 *  comparable within one query, not across titles). Never below 6 px. */
export function heatRadii(affinities: number[]): number[] {
  if (affinities.length === 0) return [];
  const finite = affinities.filter((a) => Number.isFinite(a));
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const mid = (HEAT_MIN_RADIUS + HEAT_MAX_RADIUS) / 2;
  return affinities.map((a) => {
    if (!Number.isFinite(a) || hi === lo) return mid;
    return HEAT_MIN_RADIUS + ((a - lo) / (hi - lo)) * (HEAT_MAX_RADIUS - HEAT_MIN_RADIUS);
  });
}

/** Points for a sparkline in a `width` x `height` box (y grows downward). */
export function sparkPoints(values: number[], width: number, height: number): { x: number; y: number }[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v, i) => ({
    x: values.length === 1 ? width / 2 : (i / (values.length - 1)) * width,
    y: hi === lo ? height / 2 : height - ((v - lo) / (hi - lo)) * height,
  }));
}

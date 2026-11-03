import type { DemographicsData } from '../../../shared/types/pulse';
import { divergingBars, formatSkew, type Bar } from '@/lib/pulseCharts';
import { AGE_BUCKETS, AGE_LABELS } from '@/lib/pulseEvidence';
import { cn } from '@/lib/utils';

function Row({ bar }: { bar: Bar }) {
  return (
    <li className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-xs sm:grid-cols-[8rem_1fr_4rem]">
      <span className="text-foreground">{bar.label}</span>
      {/* The drawing repeats what the number says; it is not the only carrier. */}
      <span aria-hidden className="relative h-3 rounded-sm bg-secondary/60">
        <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
        {bar.side !== 'zero' && (
          <span
            data-testid={`bar-${bar.key}`}
            data-side={bar.side}
            className={cn('absolute inset-y-0.5 rounded-sm', bar.side === 'right' ? 'left-1/2 bg-accent' : 'right-1/2 bg-muted-foreground/60')}
            style={{ width: `${bar.widthPct}%` }}
          />
        )}
      </span>
      <span className="text-right tabular-nums text-muted-foreground">
        {formatSkew(bar.value)}
        <span className="sr-only">{bar.side === 'right' ? ' above average' : bar.side === 'left' ? ' below average' : ' at average'}</span>
      </span>
    </li>
  );
}

/**
 * Age and gender as signed skew against the average, drawn from a zero line in
 * the middle: right is more than average among fans of the title, left is
 * less. Everything shares one scale, so a bar's length means the same in the
 * age group as in the gender pair. These are relative scores, never shares of
 * people, and the caption says so.
 */
export function AgeBars({ data }: { data: DemographicsData }) {
  const ageRows = AGE_BUCKETS.filter((b) => Number.isFinite(data.age?.[b])).map((b) => ({ key: b, label: AGE_LABELS[b], value: data.age[b] }));
  const genderRows = (['male', 'female'] as const)
    .filter((g) => Number.isFinite(data.gender?.[g]))
    .map((g) => ({ key: g, label: g === 'male' ? 'Male' : 'Female', value: data.gender[g] }));

  const scale = Math.max(0, ...[...ageRows, ...genderRows].map((r) => Math.abs(r.value)));
  const age = divergingBars(ageRows, scale);
  const gender = divergingBars(genderRows, scale);

  if (age.length === 0 && gender.length === 0) return <p className="text-sm text-muted-foreground">No data returned</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">Skew relative to average — not a share of people</p>
      {age.length > 0 && (
        <ul aria-label="Age skew relative to average" className="space-y-1.5">
          {age.map((b) => (
            <Row key={b.key} bar={b} />
          ))}
        </ul>
      )}
      {gender.length > 0 && (
        <ul aria-label="Gender skew relative to average" className="space-y-1.5 border-t border-border pt-3">
          {gender.map((b) => (
            <Row key={b.key} bar={b} />
          ))}
        </ul>
      )}
    </div>
  );
}

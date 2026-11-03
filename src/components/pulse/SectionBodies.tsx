import type { LocalHook, NamedEntity, TagAffinity, Venue } from '../../../shared/types/pulse';
import { ChipPill } from '@/components/pulse/EvidenceChip';
import { hookChips } from '@/lib/pulseEvidence';
import { sparkPoints } from '@/lib/pulseCharts';

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Price level as currency marks. Only drawn when the data has one: Qloo's
 *  place answers often do not, and nothing here guesses. */
function PriceMarks({ level, symbol }: { level: number; symbol: string }) {
  const n = Math.min(4, Math.max(1, Math.round(level)));
  return (
    <span className="text-xs text-muted-foreground" aria-label={`Price level ${n} of 4`}>
      <span aria-hidden>
        <span className="text-foreground">{symbol.repeat(n)}</span>
        {symbol.repeat(4 - n)}
      </span>
    </span>
  );
}

export function VenueList({ data, currency }: { data: unknown; currency: string }) {
  const venues = asArray<Venue>(data);
  return (
    <ul className="divide-y divide-border">
      {venues.map((v, i) => (
        <li key={`${v.entityId}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
          <span className="text-sm font-medium text-foreground">{v.name}</span>
          {typeof v.priceLevel === 'number' && v.priceLevel > 0 && <PriceMarks level={v.priceLevel} symbol={currency} />}
          {v.address && <span className="basis-full text-xs text-muted-foreground">{v.address}</span>}
          {Array.isArray(v.tags) && v.tags.length > 0 && (
            <span className="flex basis-full flex-wrap gap-1.5">
              {v.tags.map((t) => (
                <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                  {t}
                </span>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Themes, artists and brands: names only. Affinity numbers are left out on
 *  purpose; they are relative scores and a number invites a reading as a share. */
export function NameChips({ data, label }: { data: unknown; label: string }) {
  const rows = asArray<TagAffinity | NamedEntity>(data).filter((r) => r && typeof r.name === 'string' && r.name !== '');
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {rows.map((r, i) => (
        <li key={`${'tagId' in r ? r.tagId : r.entityId}-${i}`} className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-foreground">
          {r.name}
        </li>
      ))}
    </ul>
  );
}

export function HookList({ data, cityName }: { data: unknown; cityName: string }) {
  const hooks = asArray<LocalHook>(data);
  return (
    <ul className="space-y-2">
      {hooks.map((h, i) => {
        const verb = h.kind === 'filmed' ? 'Shot in' : 'Set in';
        const place = h.landmark ? `${h.landmark}, ${h.placeName || cityName}` : h.placeName || cityName;
        return (
          <li key={`${h.kind}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-sm font-medium text-foreground">
              {verb} {place}
            </span>
            <span className="inline-flex flex-wrap gap-1.5">
              {hookChips(h, cityName).map((label) => (
                <ChipPill key={label} label={label} detail={null} />
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const SPARK_W = 160;
const SPARK_H = 36;

export function TrendLine({ data }: { data: unknown }) {
  const points = asArray<{ date: string; percentile: number }>(data).filter((p) => p && Number.isFinite(p.percentile));
  if (points.length === 0) return <p className="text-sm text-muted-foreground">No data returned</p>;
  const pts = sparkPoints(points.map((p) => p.percentile), SPARK_W, SPARK_H);
  const first = points[0];
  const last = points[points.length - 1];
  const fmt = (n: number) => n.toFixed(2);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <svg role="img" aria-label={`Popularity percentile from ${fmt(first.percentile)} on ${first.date} to ${fmt(last.percentile)} on ${last.date}`} viewBox={`-2 -2 ${SPARK_W + 4} ${SPARK_H + 4}`} width={SPARK_W} height={SPARK_H} className="shrink-0 text-accent">
        <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
      </svg>
      <p className="text-xs text-muted-foreground">
        Popularity percentile as Qloo reports it, {first.date} to {last.date}: {fmt(first.percentile)} then, {fmt(last.percentile)} now. Not viewership.
      </p>
    </div>
  );
}

import type { TitleDetail } from '@/lib/tmdbDetail';
import { languageName } from '@/lib/languages';
import { formatRuntime, formatRuntimeLong, formatMoney, formatDate, finishTime } from '@/lib/format';

interface FactsPanelProps {
  detail: TitleDetail;
}

interface Fact {
  label: string;
  value: string;
  /** A quieter second line under the value. */
  note?: string | null;
}

/**
 * The facts a title page is expected to answer without being asked: how long,
 * what language, when, what it cost, what it made.
 *
 * Every row is omitted when its value is unknown rather than rendered as a
 * dash. A grid of "—" tells a reader the page is broken; a shorter grid tells
 * them nothing is missing, because nothing was promised.
 */
export function FactsPanel({ detail }: FactsPanelProps) {
  const facts: Fact[] = [];

  const runtime = formatRuntime(detail.runtime);
  if (runtime) {
    facts.push({
      label: detail.mediaType === 'tv' ? 'Episode length' : 'Runtime',
      value: runtime,
      // Only for films. "Ends at 9:42" under a 40-minute episode length
      // invites the reader to do arithmetic the number doesn't support —
      // nobody watches exactly one episode.
      note: detail.mediaType === 'movie' ? endsAtNote(detail.runtime) : null,
    });
  }

  if (detail.mediaType === 'tv' && detail.numberOfSeasons) {
    const seasons = `${detail.numberOfSeasons} ${detail.numberOfSeasons === 1 ? 'season' : 'seasons'}`;
    facts.push({
      label: 'Length',
      value: seasons,
      note: detail.numberOfEpisodes ? `${detail.numberOfEpisodes} episodes` : null,
    });
  }

  const language = languageName(detail.originalLanguage);
  if (language) facts.push({ label: 'Original language', value: language });

  const released = formatDate(detail.releaseDate);
  if (released) {
    facts.push({
      label: detail.mediaType === 'tv' ? 'First aired' : 'Released',
      value: released,
    });
  }

  if (detail.certification) {
    facts.push({
      label: 'Rated',
      value: detail.certification.value,
      // The issuing country, because a certificate without one is ambiguous:
      // "U/A" and "PG-13" are not the same judgement by the same body.
      note: detail.certification.region,
    });
  }

  if (detail.status && detail.status !== 'Released') {
    facts.push({ label: 'Status', value: detail.status });
  }

  const budget = formatMoney(detail.budget);
  if (budget) facts.push({ label: 'Budget', value: budget });

  const revenue = formatMoney(detail.revenue);
  if (revenue) {
    facts.push({
      label: 'Box office',
      value: revenue,
      note: detail.budget && detail.revenue ? `${(detail.revenue / detail.budget).toFixed(1)}× budget` : null,
    });
  }

  if (facts.length === 0) return null;

  return (
    <section className="px-1">
      {/* Discrete cards rather than a hairline-gap grid: the number of facts
          is whatever the title happens to know, so the last row is usually
          short — and a gap-px grid renders those missing cells as solid
          blocks of border colour, which reads as a rendering fault. */}
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {facts.map((fact) => (
          <div key={fact.label} className="rounded-xl bg-card px-3 py-2.5">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{fact.label}</dt>
            <dd
              className="mt-0.5 text-sm font-medium text-foreground"
              title={fact.label === 'Runtime' ? formatRuntimeLong(detail.runtime) ?? undefined : undefined}
            >
              {fact.value}
            </dd>
            {fact.note && <p className="text-[10px] text-muted-foreground mt-0.5">{fact.note}</p>}
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * "Start now, finish by 9:42 pm."
 *
 * Computed at render rather than memoised on purpose: it is read once, at a
 * glance, and a stale clock time is worse than a recomputed one. It is also
 * why this is never prerendered — the static build's "now" is build time, and
 * a baked-in finish time would be wrong for every reader.
 */
function endsAtNote(minutes: number | null): string | null {
  const ends = finishTime(minutes);
  return ends ? `Start now, ends ${ends}` : null;
}

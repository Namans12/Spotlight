import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { BoardCard } from '../../../shared/types/pulse';
import { formatReleaseDate } from '@/lib/pulseFormat';

interface UnresolvedStripProps {
  cards: BoardCard[];
  noSignal?: BoardCard[];
  cityName: string;
  hrefFor: (card: BoardCard) => string;
}

/** Unresolved titles and candidates omitted from the local shortlist rank.
 * Their briefs can still contain heatmaps or recommendations; absence from
 * the rank is not evidence that every other Qloo surface is empty. */
export function UnresolvedStrip({ cards, noSignal = [], hrefFor }: UnresolvedStripProps) {
  if (cards.length + noSignal.length === 0) return null;
  return (
    <details className="group rounded-xl border border-border bg-card/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        Not ranked or unresolved ({cards.length + noSignal.length})
      </summary>
      <div className="border-t border-border px-4 py-3">
        <p className="mb-2 text-xs text-muted-foreground">
          These releases are unresolved or absent from Qloo’s local shortlist ranking. Other evidence may still be available in their briefs.
        </p>
        <ul className="divide-y divide-border">
          {[...cards, ...noSignal].map((card, index) => (
            <li key={`${card.mediaType}-${card.tmdbId}`}>
              <Link
                to={hrefFor(card)}
                className="flex items-baseline justify-between gap-3 py-2 text-sm hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 text-foreground">
                  <span className="block truncate">{card.title}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {index < cards.length ? 'Qloo does not know this title yet' : 'Not returned in Qloo’s local shortlist ranking'}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {[card.platform, formatReleaseDate(card.releaseDate)].filter(Boolean).join(' · ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

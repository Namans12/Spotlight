import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { BoardCard } from '../../../shared/types/pulse';
import { formatReleaseDate } from '@/lib/pulseFormat';

interface UnresolvedStripProps {
  cards: BoardCard[];
  cityName: string;
  hrefFor: (card: BoardCard) => string;
}

/**
 * Titles Qloo has no taste data for. They are kept out of the ranking rather
 * than given a made-up score, so they live in their own collapsed disclosure:
 * present for anyone who wonders where a release went, silent otherwise.
 * A native <details> gives the toggle, keyboard handling and accessible name
 * for free.
 */
export function UnresolvedStrip({ cards, cityName, hrefFor }: UnresolvedStripProps) {
  if (cards.length === 0) return null;
  return (
    <details className="group rounded-xl border border-border bg-card/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        Not enough taste data yet ({cards.length})
      </summary>
      <div className="border-t border-border px-4 py-3">
        <p className="mb-2 text-xs text-muted-foreground">
          There is no audience data for these releases in {cityName} yet, so they are not scored or ranked.
        </p>
        <ul className="divide-y divide-border">
          {cards.map((card) => (
            <li key={`${card.mediaType}-${card.tmdbId}`}>
              <Link
                to={hrefFor(card)}
                className="flex items-baseline justify-between gap-3 py-2 text-sm hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate text-foreground">{card.title}</span>
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

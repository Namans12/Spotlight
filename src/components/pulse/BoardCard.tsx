import { Link } from 'react-router-dom';
import { ImageOff } from 'lucide-react';
import type { BoardCard as BoardCardData } from '../../../shared/types/pulse';
import { Skeleton } from '@/components/ui/skeleton';
import { tmdbPoster } from '@/lib/tmdbImage';
import { formatReleaseDate, splitWhy } from '@/lib/pulseFormat';
import { cn } from '@/lib/utils';

/** Same shell as ReleaseCard (rounded card, 56px poster, hover border) so a
 *  Pulse card reads as a Spotlight card; the fixed min-height is what keeps a
 *  pending card and the ranked card that replaces it the same size. */
const CARD =
  'group flex min-h-[8.5rem] items-start gap-3 rounded-xl border border-border bg-card p-3 transition-all duration-200';

function Poster({ url }: { url: string | null }) {
  const poster = tmdbPoster(url, 56);
  return (
    <div className="h-[84px] w-14 shrink-0 overflow-hidden rounded-lg bg-secondary sm:h-24 sm:w-16">
      {poster ? (
        <img src={poster.src} srcSet={poster.srcSet} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <div className="no-poster-stripes flex h-full w-full items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground">
          <ImageOff size={18} className="shrink-0" />
        </div>
      )}
    </div>
  );
}

function Meta({ card }: { card: BoardCardData }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-none text-muted-foreground">
      <span className="text-[10px] font-semibold uppercase">{card.mediaType === 'tv' ? 'TV' : 'Film'}</span>
      <time dateTime={card.releaseDate}>{formatReleaseDate(card.releaseDate)}</time>
      {card.platform && <span className="font-medium text-accent">{card.platform}</span>}
    </div>
  );
}

function RankSlot({ rank }: { rank?: number }) {
  // Always rendered, so ranked and pending titles line up on the same left edge.
  return (
    <div
      aria-hidden
      className="flex w-6 shrink-0 select-none items-center justify-center font-display text-lg font-bold leading-none text-muted-foreground"
    >
      {rank ?? '·'}
    </div>
  );
}

interface RankedProps {
  card: BoardCardData;
  rank?: number;
  cityName: string;
  href: string;
}

/** A scored title. The bar is never drawn without the why-line beside it: a
 *  bare number would read as a verdict, and the line is what says what it is
 *  made of. */
export function RankedBoardCard({ card, rank, cityName, href }: RankedProps) {
  const why = card.why ? splitWhy(card.why) : null;
  const score = card.score != null ? Math.min(1, Math.max(0, card.score)) : null;
  const showBar = why !== null && score !== null;

  return (
    <Link to={href} className={cn(CARD, 'hover:border-accent/30 hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>
      <RankSlot rank={rank} />
      <Poster url={card.posterUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="line-clamp-2 break-words text-sm font-medium leading-tight text-foreground">{card.title}</h3>
        <Meta card={card} />
        {showBar && (
          <div>
            <div
              role="meter"
              aria-label={`Local relevance of ${card.title}, relative to other releases in ${cityName}`}
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={score}
              aria-valuetext={`${why.rank}`}
              className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(score * 100, 3)}%` }} />
            </div>
            <p className="mt-1 text-[10px] leading-none text-muted-foreground">Relative to other releases in {cityName}</p>
          </div>
        )}
        {why && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">{why.rank}</span>
            {why.reasons.length > 0 && <> · {why.reasons.join(' · ')}</>}
          </p>
        )}
      </div>
    </Link>
  );
}

/** A title whose taste data is still being read. Identity (poster, title, date)
 *  is already known and shown; only the part that is not ready is a skeleton. */
export function PendingBoardCard({ card, cityName }: { card: BoardCardData; cityName: string }) {
  return (
    <div className={CARD} aria-busy="true">
      <RankSlot />
      <Poster url={card.posterUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="line-clamp-2 break-words text-sm font-medium leading-tight text-foreground">{card.title}</h3>
        <Meta card={card} />
        <div>
          <Skeleton className="h-1.5 w-full rounded-full" />
          <p className="mt-1 text-[10px] leading-none text-muted-foreground">Reading {cityName}&rsquo;s taste…</p>
        </div>
        <div className="space-y-1.5" aria-hidden>
          <Skeleton className="h-2.5 w-4/5" />
          <Skeleton className="h-2.5 w-3/5" />
        </div>
      </div>
    </div>
  );
}

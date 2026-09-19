import type { TitleRating } from '@/lib/ratings';
import { hasAnyScore, rtIsFresh, metacriticBand } from '@/lib/ratings';

interface RatingBadgesProps {
  rating: TitleRating | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  /** Hide the Metacritic mark where there is no room for a third badge —
   *  a poster caption, for instance. The detail page shows all three. */
  showMetacritic?: boolean;
  className?: string;
}

/**
 * IMDb, Rotten Tomatoes and Metacritic scores, as marks rather than words.
 *
 * The glyphs are drawn here rather than loaded as brand assets, deliberately.
 * Shipping Fandango's and IMDb's actual logo files on a public site is a
 * trademark question this project has no answer to, and three inline SVGs cost
 * less than three image requests anyway. They are recognisable because the
 * *forms* are — a yellow wordmark plate, a tomato, a numbered square — which is
 * all a reader is scanning for at 14px.
 *
 * Renders nothing at all when no score is known: no placeholder, no "unrated"
 * label. That is the stated product rule, and it is also what keeps a cold
 * ratings cache from looking broken.
 *
 * There is no audience score here, and that is a data limit rather than a
 * choice: OMDb — the only ratings source this project has — exposes the
 * Tomatometer and Metacritic, and no Rotten Tomatoes audience percentage.
 * Inventing one from TMDB's own vote average would put a number under a
 * popcorn bucket that Rotten Tomatoes never published.
 */
export function RatingBadges({ rating, size = 'sm', showMetacritic = true, className = '' }: RatingBadgesProps) {
  if (!hasAnyScore(rating)) return null;

  // The marks carry the identity, so the badges are bare rows rather than
  // pills — a coloured plate inside a second coloured plate reads as clutter.
  const scale = {
    sm: { text: 'text-[11px]', icon: 12, gap: 'gap-1', row: 'gap-2' },
    md: { text: 'text-xs', icon: 14, gap: 'gap-1', row: 'gap-2.5' },
    lg: { text: 'text-sm', icon: 18, gap: 'gap-1.5', row: 'gap-3.5' },
  }[size];

  const imdb = rating!.imdbRating;
  const rt = rating!.rtScore;
  const mc = rating!.metacritic;

  return (
    <div className={`inline-flex items-center ${scale.row} ${scale.text} leading-none ${className}`}>
      {imdb != null && (
        <span
          className={`inline-flex items-center ${scale.gap} font-semibold text-foreground`}
          title={rating!.imdbVotes ? `IMDb - ${rating!.imdbVotes.toLocaleString()} votes` : 'IMDb rating'}
        >
          <ImdbMark height={scale.icon} />
          {imdb.toFixed(1)}
        </span>
      )}

      {rt != null && (
        <span
          className={`inline-flex items-center ${scale.gap} font-semibold text-foreground`}
          title={`Rotten Tomatoes - ${rtIsFresh(rt) ? 'Fresh' : 'Rotten'}`}
        >
          {rtIsFresh(rt) ? <TomatoMark size={scale.icon} /> : <SplatMark size={scale.icon} />}
          {rt}%
        </span>
      )}

      {showMetacritic && mc != null && (
        <span className={`inline-flex items-center ${scale.gap} font-semibold text-foreground`} title="Metacritic">
          <MetacriticMark score={mc} size={scale.icon} />
        </span>
      )}
    </div>
  );
}

/** The yellow plate. Sized by height so it lines up with the other two marks
 *  whatever the row's font size is. */
function ImdbMark({ height }: { height: number }) {
  return (
    <svg
      height={height}
      viewBox="0 0 64 32"
      role="img"
      aria-label="IMDb"
      style={{ width: height * 2 }}
      className="shrink-0"
    >
      <rect width="64" height="32" rx="6" fill="#F5C518" />
      <text
        x="32"
        y="23"
        textAnchor="middle"
        fontSize="19"
        fontWeight="800"
        fontFamily="Verdana, Geneva, sans-serif"
        fill="#000"
      >
        IMDb
      </text>
    </svg>
  );
}

/** Fresh: 60% and above, which is Rotten Tomatoes' own boundary. */
function TomatoMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Fresh" className="shrink-0">
      <path d="M12 3.6c1.3-1.5 3.1-2 4.6-1.6-.4 1.6-1.7 2.7-3.2 3" fill="#4CA64C" />
      <path d="M9.2 3.5c-1.4-.9-3-.9-4.2-.2.7 1.3 2.1 2 3.6 1.9" fill="#4CA64C" />
      <circle cx="12" cy="14" r="8" fill="#FA320A" />
      <path d="M8.4 9.2a6.6 6.6 0 0 0-2.5 3.6" stroke="#fff" strokeOpacity=".35" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Rotten: under 60%. The green splat, drawn as an irregular blob. */
function SplatMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Rotten" className="shrink-0">
      <path
        d="M12 1.8l2.4 3.1 3.6-1.3-.6 3.8 3.9.8-2.6 2.9 2.6 2.9-3.9.8.6 3.8-3.6-1.3L12 21.4l-2.4-3.1-3.6 1.3.6-3.8-3.9-.8L5.3 12 2.7 9.1l3.9-.8-.6-3.8 3.6 1.3z"
        fill="#00A82D"
      />
      <circle cx="12" cy="11.6" r="2.6" fill="#0B6B21" />
    </svg>
  );
}

/** Metacritic's own colour bands: green 61+, yellow 40–60, red below 40. */
function MetacriticMark({ score, size }: { score: number; size: number }) {
  const band = metacriticBand(score);
  const fill = band === 'good' ? '#00CE7A' : band === 'mixed' ? '#FFCC33' : '#FF6874';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={`Metacritic ${score} out of 100`}
      className="shrink-0"
    >
      <rect width="24" height="24" rx="5" fill={fill} />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="Verdana, Geneva, sans-serif"
        fill="#0B0B0B"
      >
        {score}
      </text>
    </svg>
  );
}

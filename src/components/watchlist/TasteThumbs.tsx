import { useCallback } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

interface TasteThumbsProps {
  /** true, false, or null for "not said". */
  opinion: boolean | null;
  onSet: (liked: boolean) => void;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Did you like it?
 *
 * Only ever shown on a title already marked seen. A thumb on something unseen
 * would be a different question — "does this appeal?" — and letting one
 * control mean both is exactly the conflation this whole feature exists to
 * undo: the eye records a fact, the thumb records an opinion, and only the
 * opinion is evidence about what to show next.
 *
 * Two states rather than five stars. "Would you watch another like this" is a
 * question people answer honestly and instantly; "is this a seven or an eight"
 * is one they answer slowly, inconsistently, and differently from each other.
 *
 * Tapping the lit thumb withdraws the opinion — the parent handles that — so
 * there is always a way back to having said nothing.
 */
export function TasteThumbs({ opinion, onSet, size = 'md', className = '' }: TasteThumbsProps) {
  const stop = useCallback((e: React.MouseEvent) => {
    // These render inside poster cards, which are wrapped in a <Link>.
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const icon = size === 'sm' ? 12 : 13;
  const box =
    size === 'sm'
      ? 'inline-flex items-center justify-center w-8 py-1.5 rounded-lg'
      : 'inline-flex items-center justify-center w-10 py-2 rounded-lg';

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          onSet(true);
        }}
        aria-pressed={opinion === true}
        aria-label={opinion === true ? 'Liked - tap to undo' : 'I liked this'}
        title={opinion === true ? 'Liked - tap to undo' : 'I liked this'}
        className={`${box} active:scale-95 transition-all ${
          opinion === true
            ? 'bg-watched/20 text-watched'
            : 'bg-secondary text-secondary-foreground hover:bg-card-hover'
        }`}
      >
        <ThumbsUp size={icon} fill={opinion === true ? 'currentColor' : 'none'} className="shrink-0" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          onSet(false);
        }}
        aria-pressed={opinion === false}
        aria-label={opinion === false ? 'Not for me - tap to undo' : 'Not for me'}
        title={opinion === false ? 'Not for me - tap to undo' : 'Not for me'}
        className={`${box} active:scale-95 transition-all ${
          opinion === false
            ? 'bg-danger/20 text-danger'
            : 'bg-secondary text-secondary-foreground hover:bg-card-hover'
        }`}
      >
        <ThumbsDown size={icon} fill={opinion === false ? 'currentColor' : 'none'} className="shrink-0" />
      </button>
    </div>
  );
}

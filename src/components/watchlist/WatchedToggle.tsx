import { useCallback } from 'react';
import { Eye } from 'lucide-react';

interface WatchedToggleProps {
  watched: boolean;
  onToggle: () => void;
  /** `card` is the icon-only square that sits beside a poster's Add button;
   *  `detail` is the labelled pill on a title page. */
  variant?: 'card' | 'detail';
  className?: string;
}

/**
 * "Seen it."
 *
 * Not an ActionButton: that one fires, flashes "Added", and forgets — right
 * for an append, wrong for a toggle whose truth lives on the server. This
 * renders the state it is given, so an eye that is lit stays lit across a
 * reload, and tapping it again un-marks rather than adding a second time.
 *
 * `aria-pressed` rather than a label that changes: a screen reader announces
 * "Seen, pressed" and "Seen, not pressed", which is the same one-word
 * vocabulary sighted readers get from the filled and hollow eye.
 */
export function WatchedToggle({ watched, onToggle, variant = 'card', className = '' }: WatchedToggleProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Poster cards wrap their whole body in a <Link>. Without this, marking
      // a title seen would also navigate away from the grid you were scanning.
      e.preventDefault();
      e.stopPropagation();
      onToggle();
    },
    [onToggle],
  );

  const base =
    variant === 'detail'
      ? 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium'
      : 'inline-flex items-center justify-center w-9 py-2 rounded-lg';

  const tone = watched
    ? 'bg-watched/20 text-watched hover:bg-watched/30'
    : 'bg-secondary text-secondary-foreground hover:bg-card-hover';

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={watched}
      aria-label={watched ? 'Seen - tap to unmark' : 'Mark as seen'}
      title={watched ? 'Seen - tap to unmark' : 'Mark as seen'}
      className={`${base} ${tone} active:scale-95 transition-all ${className}`}
    >
      <Eye size={variant === 'detail' ? 12 : 13} fill={watched ? 'currentColor' : 'none'} className="shrink-0" />
      {variant === 'detail' && (watched ? 'Seen' : 'Mark as seen')}
    </button>
  );
}

/** The corner marker on an already-seen poster. Paired with a dimmed image so
 *  a seen title reads as "handled" while scanning, without hiding it — the
 *  grid's job is still to be complete. */
export function WatchedBadge() {
  return (
    <div
      className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-watched/90 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-background backdrop-blur-sm"
      aria-hidden
    >
      <Eye size={10} fill="currentColor" className="shrink-0" /> Seen
    </div>
  );
}

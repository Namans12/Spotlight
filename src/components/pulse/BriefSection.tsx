import type { EvidenceSection } from '../../../shared/types/pulse';
import { Skeleton } from '@/components/ui/skeleton';
import type { SectionView } from '@/lib/pulseSections';
import { cn } from '@/lib/utils';

interface BriefSectionProps {
  /** Short name; also what the skeleton announces ("Loading venues…"). */
  title: string;
  /** One line under the heading. Phrased about audiences in aggregate. */
  lede?: string;
  view: SectionView;
  /** Re-fetches the whole brief (there is no per-section endpoint). */
  onRetry: () => void;
  /** What an `error` section says it could not do. */
  errorText?: string;
  /** Rendered for a section that has data. */
  children: (data: unknown, section: EvidenceSection<unknown>) => React.ReactNode;
  /** Height of the skeleton, so a section does not jump when it arrives. */
  skeletonClass?: string;
}

const MUTED = 'text-sm text-muted-foreground';

/**
 * One section's frame and its states: a skeleton until the event arrives,
 * "No data returned" if the stream finished without it, the note for an empty
 * or degraded one, a Retry for one that errored.
 */
export function BriefSection({ title, lede, view, onRetry, errorText = 'Qloo didn’t answer this part', children, skeletonClass }: BriefSectionProps) {
  let body: React.ReactNode;

  if (view.kind === 'loading') {
    body = (
      <div role="status" aria-busy="true">
        <span className="sr-only">Loading {title.toLowerCase()}…</span>
        <Skeleton className={cn('h-24 w-full', skeletonClass)} />
      </div>
    );
  } else if (view.kind === 'missing') {
    body = <p className={MUTED}>No data returned</p>;
  } else {
    const { section } = view;
    const hasData = section.data != null && (!Array.isArray(section.data) || section.data.length > 0);
    switch (section.status) {
      case 'error':
        body = (
          <div className="space-y-1">
            <p className="text-sm text-foreground">
              {errorText} —{' '}
              <button
                type="button"
                onClick={onRetry}
                className="rounded font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Retry
              </button>
            </p>
            {section.note && <p className="text-xs text-muted-foreground">{section.note}</p>}
          </div>
        );
        break;
      case 'empty':
      case 'needs_input':
        body = <p className={MUTED}>{section.note ?? 'Nothing to show for this part.'}</p>;
        break;
      default: // ok, partial, degraded
        body = (
          <div className="space-y-2">
            {section.status !== 'ok' && section.note && <p className="text-xs text-muted-foreground">{section.note}</p>}
            {hasData ? (
              <>
                {lede && <p className="text-xs text-muted-foreground">{lede}</p>}
                {children(section.data, section)}
              </>
            ) : section.status === 'ok' ? (
              <p className={MUTED}>No data returned</p>
            ) : null}
          </div>
        );
    }
  }

  const stale = view.kind === 'section' && view.stale;
  return (
    <section
      aria-busy={stale || view.kind === 'loading' ? true : undefined}
      className={cn('space-y-2.5 rounded-xl border border-border bg-card/40 p-4 transition-opacity', stale && 'opacity-60')}
    >
      <header>
        <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
      </header>
      {body}
    </section>
  );
}

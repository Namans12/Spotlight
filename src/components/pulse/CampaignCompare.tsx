import type { Campaign } from '../../../shared/types/pulse';
import { CampaignView } from '@/components/pulse/CampaignView';
import { Skeleton } from '@/components/ui/skeleton';
import type { GuessState } from '@/hooks/usePulseGuess';
import { GUESS_LABEL } from '@/lib/pulseCopy';
import type { SectionBundle } from '@/lib/pulseEvidence';
import { isGroundedCampaign, type SectionView } from '@/lib/pulseSections';

const COLUMN_HEADING = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground';

interface ToggleProps {
  open: boolean;
  onToggle: () => void;
  /** The element the comparison replaces the campaign in. */
  controls: string;
}

export function CompareToggle({ open, onToggle, controls }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="inline-flex h-control min-h-11 items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-semibold text-foreground hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {open ? 'Hide comparison' : 'Compare without Qloo'}
    </button>
  );
}

const ideasOf = (data: unknown): Campaign | null =>
  data && typeof data === 'object' && Array.isArray((data as Campaign).ideas) && (data as Campaign).ideas.length > 0 ? (data as Campaign) : null;

/** The guess cites nothing, whatever the server sent: every clause reads as the agent's own. */
function withoutEvidence(campaign: Campaign): Campaign {
  return { ...campaign, ideas: (campaign.ideas ?? []).map((i) => ({ ...i, clauses: (i.clauses ?? []).map((c) => ({ ...c, evidence: [] })) })) };
}

interface CompareProps {
  /** The Qloo-grounded campaign section, as the brief holds it. */
  view: SectionView;
  guess: GuessState;
  onRetryGuess: () => void;
  onRetryCampaign?: () => void;
  bundle: SectionBundle;
  cityName: string;
}

/**
 * The two campaigns side by side (stacked on a phone), standing in the
 * campaign section's body while "Compare without Qloo" is open, so the grounded
 * campaign is on the page once, not twice. The left heading says "Grounded in
 * Qloo taste data" only when Qloo context accompanies the proposals.
 */
export function CampaignCompare({ view, guess, onRetryGuess, onRetryCampaign, bundle, cityName }: CompareProps) {
  const section = view.kind === 'section' ? view.section : null;
  const grounded = isGroundedCampaign(section ?? undefined);
  const campaign = ideasOf(section?.data);
  const note = section && section.status !== 'ok' ? section.note : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <h3 className={COLUMN_HEADING}>{grounded ? 'Agent proposals with Qloo context' : 'Agent proposal draft'}</h3>
        {section?.status === 'error' && onRetryCampaign && (
          <button type="button" onClick={onRetryCampaign} className="inline-flex min-h-11 items-center rounded px-1 text-xs font-semibold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry campaign</button>
        )}
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
        {campaign ? (
          <CampaignView campaign={campaign} bundle={bundle} cityName={cityName} ideaHeading="h4" />
        ) : (
          !note && (
            <p className="text-sm text-muted-foreground">
              {view.kind === 'loading' ? 'Still drafting…' : view.kind === 'missing' ? 'No data returned' : 'No agent proposals to compare with.'}
            </p>
          )
        )}
      </div>

      <div className="space-y-2">
        <h3 className={COLUMN_HEADING}>{GUESS_LABEL}</h3>
        {/* Always present, so a screen reader hears the result arrive. */}
        <div aria-live="polite" className="space-y-2">
          {guess.status === 'loading' && (
            <div aria-busy="true" className="space-y-3">
              <span className="sr-only">Asking the AI writer…</span>
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          )}
          {guess.status === 'error' && (
            <div className="space-y-1.5">
              <p className="text-sm text-foreground">{guess.message}</p>
              <button
                type="button"
                onClick={onRetryGuess}
                className="inline-flex min-h-11 items-center rounded px-1 text-xs font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Try again
              </button>
            </div>
          )}
          {guess.status === 'ready' && (
            <>
              <span className="sr-only">Comparison ready</span>
              <CampaignView campaign={withoutEvidence(guess.campaign)} bundle={bundle} cityName={cityName} ideaHeading="h4" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

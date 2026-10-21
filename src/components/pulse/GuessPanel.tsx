import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Campaign, EvidenceSection } from '../../../shared/types/pulse';
import { CampaignView } from '@/components/pulse/CampaignView';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchGuess, type TitleParams } from '@/lib/pulseApi';
import { GUESS_LABEL, guessErrorMessage } from '@/lib/pulseCopy';
import type { SectionBundle } from '@/lib/pulseEvidence';

const QLOO_LABEL = 'Grounded in Qloo taste data';

type GuessState = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; campaign: Campaign };

interface GuessPanelProps {
  params: TitleParams;
  /** The Qloo-grounded campaign section, for the left-hand column. */
  campaign: EvidenceSection<unknown> | undefined;
  bundle: SectionBundle;
  cityName: string;
}

/**
 * "Compare without Qloo". The guess is an LLM call that spends the daily
 * budget, so it is fetched only when the button is pressed, never on load,
 * and an in-flight request is abandoned if the page goes away.
 */
export function GuessPanel({ params, campaign, bundle, cityName }: GuessPanelProps) {
  const [state, setState] = useState<GuessState>({ status: 'idle' });
  const [open, setOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  // A different title or city is a different comparison.
  const key = `${params.city}|${params.type}|${params.mediaType}|${params.tmdbId}`;
  useEffect(() => {
    controller.current?.abort();
    setState({ status: 'idle' });
    setOpen(false);
  }, [key]);

  function load() {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setState({ status: 'loading' });
    fetchGuess(params, ac.signal).then(
      (result) => {
        if (!ac.signal.aborted) setState({ status: 'ready', campaign: result });
      },
      (err) => {
        if (!ac.signal.aborted) setState({ status: 'error', message: guessErrorMessage(err) });
      },
    );
  }

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (state.status === 'idle' || state.status === 'error') load();
  }

  const qlooCampaign = campaign?.data && typeof campaign.data === 'object' && Array.isArray((campaign.data as Campaign).ideas) ? (campaign.data as Campaign) : null;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex h-control items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-semibold text-foreground hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? 'Hide comparison' : 'Compare without Qloo'}
      </button>

      {open && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{QLOO_LABEL}</h4>
            {qlooCampaign ? (
              <CampaignView campaign={qlooCampaign} bundle={bundle} cityName={cityName} />
            ) : (
              <p className="text-sm text-muted-foreground">{campaign?.note ?? 'No grounded campaign to compare with.'}</p>
            )}
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{GUESS_LABEL}</h4>
            {state.status === 'loading' && (
              <div role="status" aria-busy="true" className="space-y-3">
                <span className="sr-only">Asking the AI writer…</span>
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
                <Loader2 size={14} aria-hidden className="animate-spin text-muted-foreground" />
              </div>
            )}
            {state.status === 'error' && (
              <div className="space-y-1.5">
                <p role="alert" className="text-sm text-foreground">
                  {state.message}
                </p>
                <button
                  type="button"
                  onClick={load}
                  className="rounded text-xs font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Try again
                </button>
              </div>
            )}
            {state.status === 'ready' && (
              // The guess cites nothing, whatever the server sent: every clause reads as the agent's own.
              <CampaignView campaign={withoutEvidence(state.campaign)} bundle={bundle} cityName={cityName} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The comparison's whole point is that none of it is grounded, so a clause
 *  can never carry a citation here even if the response held one. */
function withoutEvidence(campaign: Campaign): Campaign {
  return { ...campaign, ideas: (campaign.ideas ?? []).map((i) => ({ ...i, clauses: (i.clauses ?? []).map((c) => ({ ...c, evidence: [] })) })) };
}

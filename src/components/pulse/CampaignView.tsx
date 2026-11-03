import type { Campaign, CampaignIdea } from '../../../shared/types/pulse';
import { EvidenceChips } from '@/components/pulse/EvidenceChip';
import type { SectionBundle } from '@/lib/pulseEvidence';

const KIND_LABEL: Record<CampaignIdea['kind'], string> = {
  special: 'Special offer',
  social: 'Social post',
  event: 'Event',
};

interface CampaignViewProps {
  campaign: Campaign;
  /** The brief's sections, so evidence ids can be resolved to what they cite. */
  bundle?: SectionBundle;
  cityName?: string;
  /** Level of each idea's title: h3 under a section's h2, h4 when a column heading sits between. */
  ideaHeading?: 'h3' | 'h4';
}

/** Generated tie-in proposals with references to their supporting context.
 * Resolving an evidence id checks the reference, not the truth of the proposal. */
export function CampaignView({ campaign, bundle = {}, cityName, ideaHeading: Heading = 'h3' }: CampaignViewProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">All ideas are agent proposals. References show supporting context, not verification of the generated wording or outcomes.</p>
      <p className="text-xs text-muted-foreground">The agent selects context and a trial plan. Cited context is copied from the evidence; actions use conservative templates.</p>
      <p className="text-xs text-muted-foreground">Planning assumptions: existing products, owned channels and a small trial. Confirm menu fit and margins before acting; no media rights or partnerships are assumed.</p>
      {(campaign.ideas ?? []).map((idea, i) => (
        <article key={`${idea.kind}-${i}`} className="space-y-2 rounded-xl border border-border bg-card p-3.5">
          <header className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{KIND_LABEL[idea.kind] ?? idea.kind}</p>
            <Heading className="text-sm font-semibold leading-snug text-foreground">{idea.title}</Heading>
            <p className="text-xs text-muted-foreground">{idea.timing}</p>
          </header>
          <ul className="space-y-2">
            {(idea.clauses ?? []).map((clause, j) => (
              <li key={j} className="space-y-1 text-sm leading-snug text-foreground">
                <p>{clause.text}</p>
                <EvidenceChips evidence={clause.evidence ?? []} bundle={bundle} cityName={cityName} />
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

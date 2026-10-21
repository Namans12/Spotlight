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
}

/**
 * Three tie-in ideas. Each clause is followed by what it cites: Qloo and
 * Wikipedia/Wikidata chips for grounded claims, "Agent suggestion" for the
 * model's own. The chips are the point of the view; a clause with none would
 * read as evidence-backed when it is not.
 */
export function CampaignView({ campaign, bundle = {}, cityName }: CampaignViewProps) {
  return (
    <div className="space-y-3">
      {(campaign.ideas ?? []).map((idea, i) => (
        <article key={`${idea.kind}-${i}`} className="space-y-2 rounded-xl border border-border bg-card p-3.5">
          <header className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{KIND_LABEL[idea.kind] ?? idea.kind}</p>
            <h4 className="text-sm font-semibold leading-snug text-foreground">{idea.title}</h4>
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

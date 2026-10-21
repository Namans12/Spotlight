import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { chipsForEvidence, chipsForId, AGENT_SUGGESTION, type ChipSpec, type SectionBundle } from '@/lib/pulseEvidence';
import { cn } from '@/lib/utils';

const PILL =
  'inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-normal text-left';

/**
 * One chip. The label is always on the page as text; the tooltip only adds the
 * fact behind it (shown on hover and on keyboard focus). The same fact is also
 * in the DOM as screen-reader text, so nothing depends on hover.
 */
export function ChipPill({ label, detail }: ChipSpec) {
  const tone =
    label === AGENT_SUGGESTION
      ? 'border-dashed border-muted-foreground/50 text-muted-foreground'
      : 'border-accent/30 bg-accent/10 text-accent';

  if (!detail) return <span className={cn(PILL, tone)}>{label}</span>;

  return (
    // Its own provider, so a chip works wherever it is rendered.
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(PILL, tone, 'cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
          >
            {label}
            <span className="sr-only">: {detail}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface EvidenceChipProps {
  /** An evidence id from the campaign bundle: demo:, heat:, venue:, tag:, artist:, brand: or hook:. */
  id: string;
  /** The brief's sections so far; ids are resolved against these. */
  bundle: SectionBundle;
  cityName?: string;
}

/** The chip(s) for one evidence id: usually one, two for a hook record that
 *  both Wikipedia and Wikidata hold. An id with an unknown prefix draws none. */
export function EvidenceChip({ id, bundle, cityName = 'the city' }: EvidenceChipProps) {
  return (
    <>
      {chipsForId(id, bundle, cityName).map((chip) => (
        <ChipPill key={chip.label} {...chip} />
      ))}
    </>
  );
}

/** All the chips for one clause: duplicates by label merged, and "Agent
 *  suggestion" when the clause cites nothing. */
export function EvidenceChips({ evidence, bundle, cityName = 'the city' }: { evidence: string[]; bundle: SectionBundle; cityName?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {chipsForEvidence(evidence, bundle, cityName).map((chip) => (
        <ChipPill key={chip.label} {...chip} />
      ))}
    </span>
  );
}

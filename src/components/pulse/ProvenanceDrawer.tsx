import { Info } from 'lucide-react';
import type { BriefSectionKey, EvidenceSection, Provenance } from '../../../shared/types/pulse';
import { SECTION_TITLES } from '@/lib/pulseCopy';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

const SOURCE_LABEL: Record<Provenance['source'], string> = {
  qloo: 'Qloo',
  wikipedia: 'Wikipedia',
  wikidata: 'Wikidata',
  spotlight: 'Spotlight',
};

interface ProvenanceDrawerProps {
  /** Section keys in display order. */
  order: readonly BriefSectionKey[];
  sections: Partial<Record<BriefSectionKey, EvidenceSection<unknown>>>;
}

/**
 * "How this was made": every call behind the brief, per section, with what it
 * cannot tell you. Only a provenance entry's own fields are rendered (source,
 * call, params, limits); nothing else from a section reaches this panel.
 */
export function ProvenanceDrawer({ order, sections }: ProvenanceDrawerProps) {
  const listed = order.filter((k) => (sections[k]?.provenance?.length ?? 0) > 0);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex h-control items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-semibold text-foreground hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info size={13} aria-hidden />
          How this was made
        </button>
      </SheetTrigger>
      <SheetContent className="w-full space-y-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>How this was made</SheetTitle>
          <SheetDescription>
            The data calls behind each part of this brief, and what each one cannot tell you.
          </SheetDescription>
        </SheetHeader>

        {listed.length === 0 && <p className="text-sm text-muted-foreground">No sources have been reported yet.</p>}

        {listed.map((key) => (
          <section key={key} className="space-y-2">
            <h3 className="font-display text-sm font-semibold text-foreground">{SECTION_TITLES[key]}</h3>
            <ul className="space-y-3">
              {sections[key]!.provenance.map((p, i) => (
                <li key={`${p.source}-${p.call}-${i}`} className="space-y-1.5 rounded-lg border border-border bg-card p-3 text-xs">
                  <p>
                    <span className="font-semibold text-foreground">{SOURCE_LABEL[p.source] ?? p.source}</span>
                    <span className="text-muted-foreground"> · </span>
                    <code className="break-all font-mono text-foreground">{p.call}</code>
                  </p>
                  {Object.keys(p.params ?? {}).length > 0 && (
                    <dl className="space-y-0.5">
                      {Object.entries(p.params).map(([k, v]) => (
                        <div key={k} className="flex flex-wrap gap-x-1.5">
                          <dt className="text-muted-foreground">{k}:</dt>
                          <dd className="break-all text-foreground">{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <div>
                    <p className="font-semibold text-foreground">What this doesn&rsquo;t tell you</p>
                    <p className="text-muted-foreground">{p.limits}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </SheetContent>
    </Sheet>
  );
}

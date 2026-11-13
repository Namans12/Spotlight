import { useState } from 'react';
import type { DuelCandidate, Weights } from '@/lib/duel';
import type { TonightFilters } from '@/lib/tonight';
import type { TonightFeedbackMap } from '@/lib/tonightFeedback';
import { createTonightStudy, downloadTonightStudy, type StudyJudgment, type TonightStudy } from '@/lib/tonightStudy';
import type { ProviderOffer } from '../../../shared/types/availability';

interface Props {
  candidates: DuelCandidate[];
  filters: TonightFilters;
  weights: Weights;
  feedback: TonightFeedbackMap;
  availability: Record<string, ProviderOffer[]>;
  disabled: boolean;
}

export function PrivateEvaluation({ candidates, filters, weights, feedback, availability, disabled }: Props) {
  const [study, setStudy] = useState<TonightStudy | null>(null);
  const start = () => setStudy(createTonightStudy(candidates, filters, weights, feedback, availability));
  const judge = (key: string, value: StudyJudgment | '') => setStudy(current => {
    if (!current) return current;
    const judgments = { ...current.judgments };
    if (value) judgments[key] = value; else delete judgments[key];
    return { ...current, judgments };
  });
  return <details className="rounded-xl border border-border bg-card p-4 text-sm">
    <summary className="cursor-pointer font-semibold">Help evaluate suggestions (optional)</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">Rate a frozen list in alphabetical order, without the suggestion ranking. Your choices stay in this page unless you download a file. The file includes titles, filters, services and session feedback, which can reveal viewing preferences; share it only if you choose. No account details are included.</p>
      <p className="text-xs text-muted-foreground">This compares Tonight with and without your session feedback; it is not a comparison with the older recommender. You can skip any title.</p>
      <button type="button" disabled={disabled} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-60" onClick={start}>{study ? 'Start over with current choices' : 'Start private evaluation'}</button>
      {study && (study.candidates.length === 0 ? <p role="status">No eligible titles with the current filters.</p> : <>
        <p className="text-xs text-muted-foreground">For each title, would you consider watching it now? Your list is a snapshot; start over to use changed filters.</p>
        <div className="max-h-96 space-y-2 overflow-auto">{[...study.candidates].sort((a, b) => a.title.localeCompare(b.title) || `${a.mediaType}:${a.id}`.localeCompare(`${b.mediaType}:${b.id}`)).map(candidate => {
          const key = `${candidate.mediaType}:${candidate.id}`;
          return <label key={key} className="flex items-center justify-between gap-3 border-b border-border pb-2 text-xs">
            <span>{candidate.title} ({candidate.mediaType === 'tv' ? 'series' : 'film'})</span>
            <select aria-label={`Judgment for ${candidate.title} (${candidate.mediaType})`} value={study.judgments[key] ?? ''} onChange={event => judge(key, event.target.value as StudyJudgment | '')} className="rounded border border-border bg-secondary p-1">
              <option value="">Skip</option><option value="relevant">Would consider</option><option value="not_relevant">Not suitable</option>
            </select>
          </label>;
        })}</div>
        <button type="button" disabled={!Object.keys(study.judgments).length} onClick={() => downloadTonightStudy(study)} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-60">Download evaluation file</button>
      </>)}
    </div>
  </details>;
}

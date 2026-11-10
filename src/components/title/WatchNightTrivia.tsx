import { useState } from 'react';
import { watchNightTrivia } from '@/lib/watchNightTrivia';

export function WatchNightTrivia({ mediaType, id }: { mediaType: 'movie' | 'tv'; id: number }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const question = watchNightTrivia(mediaType, id);
  if (!question) return null;
  return <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="Quick trivia">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold">Quick trivia</h2><p className="text-xs text-muted-foreground">One question before you watch.</p></div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="rounded-lg border border-border px-3 py-2 text-xs font-medium">{open ? 'Hide trivia' : 'Try trivia'}</button>
    </div>
    {open && <div className="space-y-3">
      <p className="text-sm">{question.prompt}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Choose an answer">
        {question.choices.map(choice => <button key={choice} type="button" aria-pressed={answer === choice}
          onClick={() => setAnswer(choice)} className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs hover:border-accent">{choice}</button>)}
      </div>
      {answer && <p role="status" className="text-xs text-muted-foreground">{answer === question.answer ? 'Correct!' : `The answer is ${question.answer}.`} <a href={question.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Source: {question.source}</a></p>}
    </div>}
  </section>;
}

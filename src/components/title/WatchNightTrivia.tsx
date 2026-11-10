import { useState } from 'react';
import { watchNightTriviaQuestions } from '@/lib/watchNightTrivia';

export function WatchNightTrivia({ mediaType, id }: { mediaType: 'movie' | 'tv'; id: number }) {
  return <TriviaSession key={`${mediaType}:${id}`} mediaType={mediaType} id={id} />;
}

function TriviaSession({ mediaType, id }: { mediaType: 'movie' | 'tv'; id: number }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const questions = watchNightTriviaQuestions(mediaType, id);
  const question = questions[index];
  if (!question) return null;
  return <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="Quick trivia">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold">Quick trivia</h2><p className="text-xs text-muted-foreground">A short quiz before you watch.</p></div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="rounded-lg border border-border px-3 py-2 text-xs font-medium">{open ? 'Hide trivia' : 'Try trivia'}</button>
    </div>
    {open && <div className="space-y-3">
      {questions.length > 1 && <p className="text-xs text-muted-foreground">Question {index + 1} of {questions.length}</p>}
      <p className="text-sm">{question.prompt}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Choose an answer">
        {question.choices.map(choice => <button key={choice} type="button" aria-pressed={answer === choice}
          onClick={() => setAnswer(choice)} className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs hover:border-accent">{choice}</button>)}
      </div>
      {answer && <p role="status" className="text-xs text-muted-foreground">{answer === question.answer ? 'Correct!' : `The answer is ${question.answer}.`} <a href={question.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Source: {question.source}</a></p>}
      {answer && index + 1 < questions.length && <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-medium" onClick={() => { setIndex(index + 1); setAnswer(null); }}>Next question</button>}
    </div>}
  </section>;
}

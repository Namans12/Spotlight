import { useState } from 'react';
import { TRIVIA_PACKS, triviaPack } from '@/lib/watchNightTrivia';

export function WatchNightTrivia({ mediaType, id }: { mediaType: 'movie' | 'tv'; id: number; releaseDate?: string | null }) {
 return <TriviaSession key={`${mediaType}:${id}`} mediaType={mediaType} id={id} />;
}
function TriviaSession({ mediaType, id }: { mediaType: 'movie' | 'tv'; id: number }) {
 const current = triviaPack(mediaType, id);
 const [open, setOpen] = useState(false);
 const [key, setKey] = useState(current?.key ?? '');
 const [consent, setConsent] = useState(false);
 const [started, setStarted] = useState(false);
 const [index, setIndex] = useState(0);
 const [answers, setAnswers] = useState<string[]>([]);
 const pack = TRIVIA_PACKS.find(item => item.key === key);
 const question = pack?.questions[index];
 const answer = answers[index];
 const done = Boolean(pack && index >= pack.questions.length);
 const reset = () => { setStarted(false); setConsent(false); setIndex(0); setAnswers([]); };
 const button = 'rounded-xl border border-border bg-secondary px-4 py-3 text-sm hover:border-accent focus-visible:outline focus-visible:outline-accent disabled:opacity-60 transition-colors';
 return <section aria-label="Movie trivia" className="rounded-2xl border border-border bg-card p-5 space-y-4">
  <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">How well do you remember?</h2><p className="text-sm text-muted-foreground">A short quiz on a film you’ve finished.</p></div>
   <button type="button" className={button} aria-expanded={open} onClick={() => { setOpen(!open); reset(); }}>{open ? 'Close quiz' : 'Try trivia'}</button></div>
  {open && !started && <div className="space-y-3">
   {!current && <p className="text-sm text-muted-foreground">We don’t have a reviewed quiz for this title yet. Pick another film you’ve seen.</p>}
   <label className="block text-sm">Which film have you finished?<select className="mt-2 block w-full rounded-lg bg-secondary p-3" value={key} onChange={event => { setKey(event.target.value); reset(); }}><option value="">Choose a film</option>{TRIVIA_PACKS.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label>
   {pack && <><label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />I’ve finished {pack.title} and want questions with story details.</label>
   <p className="text-xs text-muted-foreground">Only this film is covered. Your choice stays in this session and does not change your watched list.</p>
   <button type="button" className={button} disabled={!consent} onClick={() => setStarted(true)}>Start quiz</button></>}
  </div>}
  {open && started && pack && <div className="space-y-4">
   <p className="text-sm text-accent">{pack.title}</p>
   {done ? <div role="status"><h3 className="text-xl font-semibold">{answers.filter((value, i) => value === pack.questions[i].answer).length} / {pack.questions.length} correct</h3><p className="mt-2 text-sm">Quiz complete. Ready for your next watch?</p></div> : question && <div key={index} className="space-y-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
    <p className="text-xs text-muted-foreground">Question {index + 1} of {pack.questions.length}</p>
    <div className="h-1 rounded bg-secondary" aria-hidden="true"><div className="h-1 rounded bg-accent motion-safe:transition-all" style={{ width: `${index / pack.questions.length * 100}%` }} /></div>
    <h3 className="text-lg font-medium">{question.prompt}</h3>
    <div role="group" aria-label="Choose an answer" className="grid gap-2 sm:grid-cols-3">{question.choices.map(choice => <button type="button" key={choice} className={button} disabled={answer !== undefined} aria-pressed={answer === choice} onClick={() => setAnswers(previous => previous.length === index ? [...previous, choice] : previous)}>{choice}</button>)}</div>
    {answer !== undefined && <div role="status" className="rounded-xl bg-secondary p-3 text-sm"><p className="font-semibold">{answer === question.answer ? 'Correct!' : `The answer is ${question.answer}.`}</p><p>{question.explanation}</p><a className="text-xs underline" href={question.sourceUrl} target="_blank" rel="noopener noreferrer">Source: {question.source}</a><p className="text-xs text-muted-foreground">Source pages may discuss the whole film.</p></div>}
    {answer !== undefined && <button type="button" className={button} onClick={() => setIndex(index + 1)}>{index + 1 === pack.questions.length ? 'See score' : 'Next question'}</button>}
   </div>}
   <button type="button" className="text-sm underline" onClick={reset}>Change film or restart</button>
  </div>}
 </section>;
}

import { useState } from 'react';
import { foodPairings, watchNightIdeas, type WatchNightDiet } from '@/lib/watchNightIdeas';
import { ShareWatchNight } from './ShareWatchNight';

type Props = { mediaType: 'movie' | 'tv'; id: number; title?: string };
export function WatchNightIdeas(props: Props) {
 return <FoodSession key={`${props.mediaType}:${props.id}`} {...props} />;
}
function FoodSession({ mediaType, id, title = 'this title' }: Props) {
 const [open, setOpen] = useState(false);
 const [watched, setWatched] = useState<boolean | null>(null);
 const [diet, setDiet] = useState<WatchNightDiet>('');
 const [quick, setQuick] = useState(false);
 const [sharing, setSharing] = useState(false);
 if (!watchNightIdeas(mediaType, id).length) return null;
 const foods = watched === null ? [] : foodPairings(mediaType, id, watched, diet, quick);
 const button = 'rounded-xl border border-border px-3 py-2 text-sm hover:border-accent focus-visible:outline focus-visible:outline-accent';
 return <section className="rounded-2xl border border-border bg-card p-5 space-y-4" aria-label="Watch-night ideas">
  <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">Make a night of it</h2><p className="text-sm text-muted-foreground">Food inspired by {title}.</p></div>
   <button type="button" className={button} aria-expanded={open} onClick={() => { setOpen(!open); setWatched(null); setSharing(false); }}>{open ? 'Hide food ideas' : 'Show food ideas'}</button></div>
  {open && <div className="space-y-4">
   <fieldset className="space-y-2"><legend className="text-sm font-medium">Have you finished {title}?</legend>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} aria-pressed={watched === true} onClick={() => { setWatched(true); setSharing(false); }}>Yes, show the connections</button><button type="button" className={button} aria-pressed={watched === false} onClick={() => { setWatched(false); setSharing(false); }}>Not yet — avoid story details</button></div>
   </fieldset>
   {watched !== null && <>
    <div className="flex flex-wrap items-center gap-4"><label className="text-sm">Food preference<select className="ml-2 rounded-lg bg-secondary p-2" value={diet} onChange={event => setDiet(event.target.value as WatchNightDiet)}><option value="">No preference</option><option value="vegetarian">Vegetarian</option><option value="vegan">Vegan</option></select></label>
     <label className="flex gap-2 text-sm"><input type="checkbox" checked={quick} onChange={event => setQuick(event.target.checked)} />About 20 minutes or less</label></div>
    {!foods.length && <p role="status" className="text-sm text-muted-foreground">{watched ? 'No pairings fit that preparation time. Try turning off the time filter.' : 'We’re keeping scene-based food connections hidden. No spoiler-light pairing fits these choices yet.'}</p>}
    <div className="grid gap-3 sm:grid-cols-2">{foods.map(food => <article key={food.food} className="rounded-xl bg-secondary p-4 space-y-2">
     <h3 className="font-semibold">{food.food}</h3><p className="text-sm text-muted-foreground">{food.reason}</p>
     <p className="text-sm">{diet ? food.adaptation : food.preparation}</p>
     <p className="text-xs text-muted-foreground">About {food.minutes} min · Our serving suggestion, not an official recipe.</p>
     <details className="text-xs"><summary className="cursor-pointer">Why this pairing?</summary><a className="underline" href={food.sourceUrl} target="_blank" rel="noopener noreferrer">Source: {food.source}</a><p>Source pages may contain story details.</p></details>
    </article>)}</div>
    {foods.length > 0 && <><p className="text-xs text-muted-foreground">Times are estimates using ready-made ingredients where suggested. Check ingredients and allergens, including in vegetarian or vegan substitutions.</p>
     <button type="button" className={button} onClick={() => setSharing(!sharing)}>{sharing ? 'Hide sharing' : 'Make a shareable plan'}</button>
     {sharing && <ShareWatchNight title={title} mediaType={mediaType} id={id} foods={foods.map(food => diet ? `${food.food} (${diet} adaptation)` : food.food)} />}</>}
   </>}
  </div>}
 </section>;
}

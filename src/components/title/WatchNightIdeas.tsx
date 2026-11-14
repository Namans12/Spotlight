import { useState } from 'react';
import { VIBE_IDEAS, filteredVibeIdeas, watchNightIdeas, type WatchNightDiet, type WatchNightVibe } from '@/lib/watchNightIdeas';
import { ShareWatchNight } from './ShareWatchNight';

export function WatchNightIdeas({ mediaType, id, title = 'Watch night' }: { mediaType: 'movie' | 'tv'; id: number; title?: string }) {
  const [open, setOpen] = useState(false);
  const [vibe, setVibe] = useState<WatchNightVibe | ''>('');
  const [diet, setDiet] = useState<WatchNightDiet>('');
  const [budget, setBudget] = useState(false);
  const [sharing, setSharing] = useState(false);
  const ideas = watchNightIdeas(mediaType, id);
  const availableFoods = [...new Set([...(diet || budget ? [] : ideas.map(idea => idea.food)), ...(vibe ? filteredVibeIdeas(vibe, diet, budget) : [])])];
  if (!ideas.length) return null;
  return <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="Watch-night ideas">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold">Make a night of it</h2><p className="text-xs text-muted-foreground">Food inspired by {title}.</p></div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="rounded-lg border border-border px-3 py-2 text-xs font-medium">{open ? 'Hide food ideas' : 'Show food ideas'}</button>
    </div>
    {open && <div className="space-y-4">{!diet && !budget && ideas.map(idea => <div key={idea.food} className="space-y-1">
      <p className="text-sm font-medium">{idea.food}</p>
      <p className="text-xs text-muted-foreground">{idea.reason}</p>
      <a href={idea.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline">Source: {idea.source}</a>
    </div>)}
      <div className="space-y-2">
        <label className="block text-xs font-medium">Dietary preference
          <select value={diet} onChange={event => setDiet(event.target.value as WatchNightDiet)} className="mt-1 block w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
            <option value="">No preference</option><option value="vegetarian">Vegetarian</option><option value="vegan">Vegan</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={budget} onChange={event => setBudget(event.target.checked)} /> Prefer simple, budget-conscious ideas</label>
        {(diet || budget) && <p className="text-xs text-muted-foreground">Choose a vibe for general ideas. Check ingredients and allergens; prices vary by location. Title-specific ideas are hidden while preferences are selected.</p>}
        <label className="block text-xs font-medium">Pick a vibe for more ideas
          <select value={vibe} onChange={event => setVibe(event.target.value as WatchNightVibe | '')} className="mt-1 block w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
            <option value="">Choose a vibe</option>
            {Object.entries(VIBE_IDEAS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
          </select>
        </label>
        {vibe && <div role="status" className="space-y-1 text-xs text-muted-foreground">
          <p>General ideas for your chosen vibe:</p>
          <ul className="list-disc pl-4">{filteredVibeIdeas(vibe, diet, budget).map(food => <li key={food}>{food}</li>)}</ul>
        </div>}
      </div>
      <button type="button" aria-expanded={sharing} onClick={() => setSharing(value => !value)} className="rounded-lg border border-border px-3 py-2 text-xs">{sharing ? 'Hide sharing' : 'Make a shareable plan'}</button>
      {sharing && <ShareWatchNight title={title} mediaType={mediaType} id={id} foods={availableFoods} />}
    </div>}
  </section>;
}

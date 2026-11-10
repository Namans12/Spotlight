import { useState } from 'react';
import { VIBE_IDEAS, watchNightIdeas, type WatchNightVibe } from '@/lib/watchNightIdeas';

export function WatchNightIdeas({ mediaType, id }: { mediaType: 'movie' | 'tv'; id: number }) {
  const [open, setOpen] = useState(false);
  const [vibe, setVibe] = useState<WatchNightVibe | ''>('');
  const ideas = watchNightIdeas(mediaType, id);
  return <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="Watch-night ideas">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold">Make a night of it</h2><p className="text-xs text-muted-foreground">A little inspiration for your watch.</p></div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="rounded-lg border border-border px-3 py-2 text-xs font-medium">{open ? 'Hide food ideas' : 'Show food ideas'}</button>
    </div>
    {open && <div className="space-y-4">{ideas.map(idea => <div key={idea.food} className="space-y-1">
      <p className="text-sm font-medium">{idea.food}</p>
      <p className="text-xs text-muted-foreground">{idea.reason}</p>
      <a href={idea.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline">Source: {idea.source}</a>
    </div>)}
      <div className="space-y-2">
        <label className="block text-xs font-medium">Pick a vibe for more ideas
          <select value={vibe} onChange={event => setVibe(event.target.value as WatchNightVibe | '')} className="mt-1 block w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
            <option value="">Choose a vibe</option>
            {Object.entries(VIBE_IDEAS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
          </select>
        </label>
        {vibe && <div role="status" className="space-y-1 text-xs text-muted-foreground">
          <p>General ideas for your chosen vibe:</p>
          <ul className="list-disc pl-4">{VIBE_IDEAS[vibe].foods.map(food => <li key={food}>{food}</li>)}</ul>
        </div>}
      </div>
    </div>}
  </section>;
}

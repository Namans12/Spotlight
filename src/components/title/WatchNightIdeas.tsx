import { useState } from 'react';
import { watchNightIdeas } from '@/lib/watchNightIdeas';

export function WatchNightIdeas({ mediaType, id }: { mediaType: 'movie' | 'tv'; id: number }) {
  const [open, setOpen] = useState(false);
  const ideas = watchNightIdeas(mediaType, id);
  if (!ideas.length) return null;
  return <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="Watch-night ideas">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold">Make a night of it</h2><p className="text-xs text-muted-foreground">A little inspiration for your watch.</p></div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="rounded-lg border border-border px-3 py-2 text-xs font-medium">{open ? 'Hide food ideas' : 'Show food ideas'}</button>
    </div>
    {open && <div className="space-y-3">{ideas.map(idea => <div key={idea.food} className="space-y-1">
      <p className="text-sm font-medium">{idea.food}</p>
      <p className="text-xs text-muted-foreground">{idea.reason}</p>
      <a href={idea.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline">Source: {idea.source}</a>
    </div>)}</div>}
  </section>;
}

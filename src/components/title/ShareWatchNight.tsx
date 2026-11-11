import { useState } from 'react';

/** The plan stays in the browser until the viewer explicitly copies or shares it. */
export function ShareWatchNight({ title, mediaType, id, foods }: { title: string; mediaType: 'movie' | 'tv'; id: number; foods: readonly string[] }) {
  const [time, setTime] = useState('');
  const [food, setFood] = useState('');
  const [status, setStatus] = useState('');
  const selectedFood = foods.includes(food) ? food : '';
  const url = `${window.location.origin}/title/${mediaType}/${id}`;
  const plan = [`Watch night: ${title}`, time ? `When: ${time.replace('T', ' ')} (host's local time)` : '', selectedFood ? `Food idea: ${selectedFood}` : '', url].filter(Boolean).join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(plan); setStatus('Plan copied.'); }
    catch { setStatus('Could not copy. Select the preview text to copy it manually.'); }
  };
  const share = async () => {
    try { await navigator.share({ title: `Watch night: ${title}`, text: plan }); setStatus('Share sheet completed.'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('Could not open sharing. Copy the preview instead.'); }
  };
  return <div className="space-y-2 border-t border-border pt-3">
    <h3 className="text-sm font-semibold">Share a plan</h3>
    <p className="text-xs text-muted-foreground">Choose what to include. Nothing is shared until you copy or share it.</p>
    <label className="block text-xs font-medium">When <span className="font-normal text-muted-foreground">(optional, local time)</span>
      <input type="datetime-local" value={time} onChange={event => setTime(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm" />
    </label>
    <label className="block text-xs font-medium">Food idea to include
      <select value={selectedFood} onChange={event => setFood(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
        <option value="">No food idea</option>{foods.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
    <label className="block text-xs font-medium">Plan preview<textarea readOnly value={plan} rows={4} className="mt-1 block w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm" /></label>
    <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void copy()} className="rounded-lg border border-border px-3 py-2 text-xs">Copy plan</button>
      {typeof navigator.share === 'function' && <button type="button" onClick={() => void share()} className="rounded-lg border border-border px-3 py-2 text-xs">Share plan</button>}</div>
    {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
  </div>;
}

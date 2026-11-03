import { toolLabel } from '@/lib/pulseChat';

/**
 * One tool call as a small collapsible line: a friendly sentence for the
 * summary, and the tool's name, its (already sanitised) arguments and its
 * result summary when opened. Everything is rendered as text.
 *
 * The line sits inside the chat's live log but opts out of it (aria-live="off"),
 * so a screen reader hears the answer arrive, not every lookup on the way.
 */
export function ChatToolLine({ name, args, result }: { name: string; args: string; result?: string }) {
  const pending = result === undefined;
  return (
    <details aria-live="off" className="group rounded-lg border border-border bg-card/60 text-xs text-muted-foreground">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-1.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-[10px] transition-transform group-open:rotate-90 motion-reduce:transition-none">
          ▸
        </span>
        <span className="min-w-0 break-words">{toolLabel(name)}</span>
        {pending && <span className="shrink-0 italic">running…</span>}
      </summary>
      <dl className="space-y-1.5 px-3 pb-3">
        <div>
          <dt className="font-semibold text-foreground">Tool</dt>
          <dd>
            <code className="break-all font-mono">{name}</code>
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-foreground">Arguments</dt>
          <dd className="whitespace-pre-wrap break-all font-mono">{args || '(none)'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-foreground">Result</dt>
          <dd className="whitespace-pre-wrap break-words">{pending ? 'Waiting for the result…' : result || '(empty)'}</dd>
        </div>
      </dl>
    </details>
  );
}

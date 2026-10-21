import { useEffect, useId, useRef, useState } from 'react';
import { RotateCcw, Send, Square } from 'lucide-react';
import type { BusinessType } from '../../../shared/types/pulse';
import { usePulseChat, type ChatItem } from '@/hooks/usePulseChat';
import { CHAT_MAX_CHARS, suggestedPrompts } from '@/lib/pulseChat';
import { getPulseCity } from '@/lib/pulseCities';
import { cn } from '@/lib/utils';
import { ChatToolLine } from './ChatToolLine';

export const CHAT_FOOTNOTE = "Answers use Qloo's aggregate taste data and public sources. Don't enter personal information.";

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

/** Within this many pixels of the bottom counts as "reading the newest". */
const STICK_PX = 48;

interface PulseChatProps {
  /** City slug. */
  city: string;
  type: BusinessType;
  /** The title on screen, when the page is about one: unlocks the audience prompt. */
  title?: string;
  /** Focus the question box on mount (the sheet does; it replaces Radix's own focus move). */
  autoFocus?: boolean;
}

function Message({ item, last, onRetry, busy }: { item: ChatItem; last: boolean; onRetry: () => void; busy: boolean }) {
  switch (item.kind) {
    case 'user':
      // Plain text: pre-wrap keeps the visitor's line breaks, and nothing here ever parses markup.
      return (
        <div className="flex justify-end">
          <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
            {item.text}
          </p>
        </div>
      );
    case 'assistant':
      return (
        <div className="flex justify-start">
          <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm text-foreground">
            {item.text}
          </p>
        </div>
      );
    case 'tool':
      return <ChatToolLine name={item.name} args={item.args} result={item.result} />;
    case 'system':
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {item.text}
          </p>
          {item.retry && last && (
            <button type="button" onClick={onRetry} disabled={busy} className={cn(BUTTON, 'bg-secondary text-foreground hover:bg-card-hover')}>
              <RotateCcw size={13} aria-hidden />
              Try again
            </button>
          )}
        </div>
      );
  }
}

/**
 * Ask Pulse: a conversation with the Pulse agent (POST /chat) about the
 * release board and the briefs behind it.
 *
 * Live regions: the message list is a polite `log`, so the assistant's answer
 * (one whole message, not token-streamed) is announced when it lands. Tool
 * lines inside it opt out with aria-live="off" so lookups do not chatter, and
 * "Pulse is thinking…" is its own polite status.
 *
 * The conversation is in memory only; it is dropped when this unmounts (the
 * sheet closing) and by "New chat".
 */
export function PulseChat({ city, type, title, autoFocus = false }: PulseChatProps) {
  const chat = usePulseChat();
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);

  const cityName = getPulseCity(city)?.name ?? city;
  const empty = chat.items.length === 0;
  const canSend = draft.trim() !== '' && !chat.streaming;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Follow the newest content, unless the reader has scrolled up.
  useEffect(() => {
    const el = logRef.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [chat.items, chat.streaming]);

  const onScroll = () => {
    const el = logRef.current;
    if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
  };

  const ask = (text: string) => {
    stuck.current = true;
    return chat.send(text);
  };

  const submit = () => {
    if (ask(draft)) setDraft('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 items-center justify-end px-4">
        {!empty && (
          <button
            type="button"
            onClick={() => {
              chat.reset();
              setDraft('');
              inputRef.current?.focus();
            }}
            className={cn(BUTTON, 'text-muted-foreground hover:text-foreground')}
          >
            <RotateCcw size={13} aria-hidden />
            New chat
          </button>
        )}
      </div>

      <div
        ref={logRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation with Pulse"
        tabIndex={0}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {empty && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ask about this week&rsquo;s releases in {cityName}, who they pull in, or what to do about them.
            </p>
            <ul className="space-y-2" aria-label="Suggested questions">
              {suggestedPrompts(cityName, type, title).map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    onClick={() => ask(prompt)}
                    className="min-h-11 w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-sm text-foreground hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {chat.items.map((item, i) => (
          <Message key={item.id} item={item} last={i === chat.items.length - 1} onRetry={chat.retry} busy={chat.streaming} />
        ))}

        {chat.streaming && (
          <p role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse" />
            Pulse is thinking…
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-2 border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
      >
        <label htmlFor={inputId} className="sr-only">
          Ask Pulse a question
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a newline; Enter that confirms an IME composition is neither.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={CHAT_MAX_CHARS}
          rows={2}
          placeholder="Ask Pulse a question"
          className="block max-h-40 min-h-11 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
        />
        <div className="flex items-center justify-end gap-2">
          {chat.streaming && (
            <button type="button" onClick={chat.stop} className={cn(BUTTON, 'bg-secondary text-foreground hover:bg-card-hover')}>
              <Square size={12} aria-hidden />
              Stop
            </button>
          )}
          <button type="submit" disabled={!canSend} className={cn(BUTTON, 'bg-primary text-primary-foreground hover:bg-primary/90')}>
            <Send size={13} aria-hidden />
            Send
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{CHAT_FOOTNOTE}</p>
      </form>
    </div>
  );
}

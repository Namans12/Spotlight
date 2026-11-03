import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent } from '../../shared/types/pulse';
import { streamChat } from '@/lib/pulseApi';
import { failureLine, toWire, type WireMessage } from '@/lib/pulseChat';

export type ChatItem =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  /** `result` is undefined until the tool_result arrives. */
  | { id: number; kind: 'tool'; name: string; args: string; result?: string }
  | { id: number; kind: 'system'; text: string; tone: 'muted'; retry?: boolean };

export interface PulseChatState {
  items: ChatItem[];
  streaming: boolean;
  /** Starts a turn; false when the text is empty or a turn is already running. */
  send: (text: string) => boolean;
  /** Aborts the running turn and ends it with a muted "Stopped". */
  stop: () => void;
  /** Resends the last user message after a failure that offered it. */
  retry: () => void;
  reset: () => void;
}

/**
 * The chat's state machine. The conversation lives only in this hook's state:
 * it is never written to storage, and it goes when the component using it
 * unmounts (the sheet closing) or on reset(). Messages sent to the server are
 * only the user's and the assistant's text, the last 12 of them.
 *
 * `items` is mirrored in a ref so send() and retry() read the latest list
 * synchronously, and a stream event never needs a state updater with side
 * effects.
 */
export function usePulseChat(): PulseChatState {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const itemsRef = useRef<ChatItem[]>([]);
  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const commit = useCallback((next: ChatItem[]) => {
    itemsRef.current = next;
    if (mounted.current) setItems(next);
  }, []);
  const append = useCallback(
    (item: DistributiveOmit<ChatItem, 'id'>) => commit([...itemsRef.current, { ...item, id: nextId.current++ } as ChatItem]),
    [commit],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const finishTools = useCallback(() => {
    commit(itemsRef.current.map((item) => item.kind === 'tool' && item.result === undefined
      ? { ...item, result: 'Stopped before it finished' } : item));
  }, [commit]);

  const endTurn = useCallback((ac: AbortController) => {
    if (abortRef.current !== ac) return;
    abortRef.current = null;
    if (mounted.current) setStreaming(false);
  }, []);

  const onEvent = useCallback(
    (e: AgentEvent) => {
      switch (e.type) {
        case 'tool':
          append({ kind: 'tool', name: e.name, args: e.args });
          break;
        case 'tool_result': {
          // Results carry no id: the earliest still-pending call of that name is theirs.
          const at = itemsRef.current.findIndex((i) => i.kind === 'tool' && i.name === e.name && i.result === undefined);
          if (at === -1) break;
          commit(itemsRef.current.map((i, n) => (n === at && i.kind === 'tool' ? { ...i, result: e.summary } : i)));
          break;
        }
        case 'message':
          append({ kind: 'assistant', text: e.text });
          break;
        case 'error':
          finishTools();
          append({ kind: 'system', text: e.text, tone: 'muted', retry: true });
          break;
        case 'done':
          break; // the turn ends when the stream does
      }
    },
    [append, commit, finishTools],
  );

  const run = useCallback(() => {
    const wire = toWire(itemsRef.current.filter((i): i is Extract<ChatItem, { kind: 'user' | 'assistant' }> => i.kind === 'user' || i.kind === 'assistant').map((i): WireMessage => ({ role: i.kind, content: i.text })));
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);
    let completed = false;
    let reportedError = false;
    streamChat(
      wire,
      (e) => {
        if (ac.signal.aborted || abortRef.current !== ac || !mounted.current) return;
        if (reportedError && e.type !== 'done') return;
        if (e.type === 'done') completed = true;
        if (e.type === 'error') reportedError = true;
        onEvent(e);
        if (e.type === 'done') endTurn(ac);
      },
      ac.signal,
    ).then(
      () => {
        if (!ac.signal.aborted && abortRef.current === ac && !completed && !reportedError) {
          finishTools();
          append({ kind: 'system', text: 'The connection ended before Pulse finished. Try again.', tone: 'muted', retry: true });
        }
        endTurn(ac);
      },
      (err) => {
        // An abort is the user's own Stop, a reset or an unmount: nothing to report.
        if (!ac.signal.aborted && abortRef.current === ac && mounted.current && !reportedError) {
          finishTools();
          const line = failureLine(err);
          append({ kind: 'system', text: line.text, tone: 'muted', retry: line.retry });
        }
        endTurn(ac);
      },
    );
  }, [append, endTurn, finishTools, onEvent]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || abortRef.current) return false;
      // An earlier failure's "Try again" no longer applies once a newer question is asked.
      commit(itemsRef.current.map((i) => (i.kind === 'system' && i.retry ? { ...i, retry: false } : i)));
      append({ kind: 'user', text: trimmed });
      run();
      return true;
    },
    [append, commit, run],
  );

  const stop = useCallback(() => {
    const ac = abortRef.current;
    if (!ac) return;
    ac.abort();
    finishTools();
    append({ kind: 'system', text: 'Stopped', tone: 'muted' });
    endTurn(ac);
  }, [append, endTurn, finishTools]);

  const retry = useCallback(() => {
    if (abortRef.current) return;
    const list = itemsRef.current;
    if (!list.some((item) => item.kind === 'system' && item.retry)) return;
    const at = list.length - 1 - [...list].reverse().findIndex((item) => item.kind === 'user');
    if (at < 0) return;
    // Remove every partial answer/tool line from the failed attempt.
    commit(list.slice(0, at + 1));
    run();
  }, [commit, run]);

  const reset = useCallback(() => {
    const ac = abortRef.current;
    abortRef.current = null;
    ac?.abort();
    commit([]);
    if (mounted.current) setStreaming(false);
  }, [commit]);

  return { items, streaming, send, stop, retry, reset };
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

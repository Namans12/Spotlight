import { vi } from 'vitest';
import type { AgentEvent } from '../../shared/types/pulse';
import { streamChat } from '@/lib/pulseApi';

/**
 * A hand-driven /chat stream for tests. Install it after `vi.mock('@/lib/pulseApi', ...)`
 * has replaced `streamChat` with a vi.fn(). Each call to streamChat becomes one
 * "turn" the test controls: `emit` delivers events, `end` closes the stream
 * cleanly and `fail` rejects it, as the real client does for a refused request.
 */
export function controlledChat() {
  interface Turn {
    messages: { role: 'user' | 'assistant'; content: string }[];
    signal: AbortSignal | undefined;
    emit: (e: AgentEvent) => void;
    end: () => void;
    fail: (e: unknown) => void;
  }
  const turns: Turn[] = [];
  vi.mocked(streamChat).mockImplementation((messages, onEvent, signal) => {
    return new Promise<void>((resolve, reject) => {
      turns.push({
        messages: messages.map((m) => ({ ...m })),
        signal,
        emit: onEvent,
        end: resolve,
        fail: reject,
      });
      // Like the real client, reject with an AbortError when the caller aborts.
      signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
    });
  });
  return {
    turns,
    get last(): Turn {
      return turns[turns.length - 1];
    },
  };
}

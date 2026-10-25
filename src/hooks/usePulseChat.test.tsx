import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/lib/pulseApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pulseApi')>()),
  streamChat: vi.fn(),
}));
import { PulseApiError, streamChat } from '@/lib/pulseApi';
import { controlledChat } from '@/test/pulseChatStream';
import { usePulseChat, type ChatItem } from './usePulseChat';

const kinds = (items: ChatItem[]) => items.map((i) => i.kind);
const textOf = (items: ChatItem[]) => items.map((i) => ('text' in i ? i.text : `tool:${i.name}`));

let chat: ReturnType<typeof controlledChat>;
beforeEach(() => {
  vi.mocked(streamChat).mockReset();
  chat = controlledChat();
});

describe('usePulseChat: accumulation', () => {
  it('adds the user message, then tool lines and the answer in the order received', () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('What is on this weekend?');
    });
    expect(result.current.streaming).toBe(true);
    expect(kinds(result.current.items)).toEqual(['user']);

    act(() => chat.last.emit({ type: 'tool', name: 'pulse_board', args: '{"city":"delhi"}' }));
    act(() => chat.last.emit({ type: 'tool_result', name: 'pulse_board', summary: '5 releases' }));
    act(() => chat.last.emit({ type: 'message', text: 'Theme it around Saffron Nights.' }));
    act(() => chat.last.emit({ type: 'done' }));

    expect(kinds(result.current.items)).toEqual(['user', 'tool', 'assistant']);
    expect(result.current.items[1]).toMatchObject({ kind: 'tool', name: 'pulse_board', args: '{"city":"delhi"}', result: '5 releases' });
    expect(result.current.streaming).toBe(false);
  });

  it('pairs a tool_result with the earliest still-pending call of that name', () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('go');
    });
    act(() => chat.last.emit({ type: 'tool', name: 'search_releases', args: 'a' }));
    act(() => chat.last.emit({ type: 'tool', name: 'search_releases', args: 'b' }));
    act(() => chat.last.emit({ type: 'tool_result', name: 'search_releases', summary: 'first' }));
    const tools = result.current.items.filter((i): i is Extract<ChatItem, { kind: 'tool' }> => i.kind === 'tool');
    expect(tools.map((t) => t.result)).toEqual(['first', undefined]);
  });

  it('ends the turn when the stream resolves even without a done event', async () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('go');
    });
    await act(async () => chat.last.end());
    expect(result.current.streaming).toBe(false);
  });

  it('refuses a send while a turn is streaming, and an empty or whitespace one', () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      expect(result.current.send('   \n ')).toBe(false);
      expect(result.current.send('one')).toBe(true);
    });
    act(() => {
      expect(result.current.send('two')).toBe(false);
    });
    expect(chat.turns).toHaveLength(1);
    expect(textOf(result.current.items)).toEqual(['one']);
  });

  it('trims the text it sends', () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('  hello  ');
    });
    expect(chat.last.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });
});

describe('usePulseChat: the 12-message window', () => {
  async function converse(result: { current: ReturnType<typeof usePulseChat> }, turns: number) {
    for (let i = 1; i <= turns; i++) {
      act(() => {
        result.current.send(`question ${i}`);
      });
      act(() => chat.last.emit({ type: 'tool', name: 'pulse_board', args: '{}' }));
      act(() => chat.last.emit({ type: 'tool_result', name: 'pulse_board', summary: 'ok' }));
      act(() => chat.last.emit({ type: 'message', text: `answer ${i}` }));
      await act(async () => chat.last.end());
    }
  }

  it('sends only user and assistant text, never tool lines or system lines', async () => {
    const { result } = renderHook(() => usePulseChat());
    await converse(result, 2);
    act(() => {
      result.current.send('question 3');
    });
    expect(chat.last.messages).toEqual([
      { role: 'user', content: 'question 1' },
      { role: 'assistant', content: 'answer 1' },
      { role: 'user', content: 'question 2' },
      { role: 'assistant', content: 'answer 2' },
      { role: 'user', content: 'question 3' },
    ]);
    for (const m of chat.last.messages) expect(Object.keys(m).sort()).toEqual(['content', 'role']);
  });

  it('keeps only the last 12, the new user message last', async () => {
    const { result } = renderHook(() => usePulseChat());
    await converse(result, 8); // 16 text messages so far
    act(() => {
      result.current.send('the newest');
    });
    const sent = chat.last.messages;
    expect(sent).toHaveLength(12);
    expect(sent[sent.length - 1]).toEqual({ role: 'user', content: 'the newest' });
    expect(sent[0]).toEqual({ role: 'assistant', content: 'answer 3' }); // 17 messages in all: the first five fall out
    expect(sent.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
  });

  it('does not send a system line from an earlier failed turn', async () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('first');
    });
    act(() => chat.last.emit({ type: 'error', text: 'The assistant hit a problem.' }));
    await act(async () => chat.last.end());
    act(() => {
      result.current.send('second');
    });
    expect(chat.last.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ]);
  });
});

describe('usePulseChat: stop and unmount', () => {
  it('Stop aborts the signal, ends the turn with Stopped and shows no error', () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('go');
    });
    act(() => chat.last.emit({ type: 'tool', name: 'pulse_board', args: '{}' }));
    const signal = chat.last.signal!;
    act(() => result.current.stop());
    expect(signal.aborted).toBe(true);
    expect(result.current.streaming).toBe(false);
    expect(kinds(result.current.items)).toEqual(['user', 'tool', 'system']);
    expect(result.current.items[2]).toMatchObject({ kind: 'system', text: 'Stopped', tone: 'muted' });
  });

  it('ignores events that arrive after Stop', async () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('go');
    });
    const turn = chat.last;
    act(() => result.current.stop());
    act(() => turn.emit({ type: 'message', text: 'too late' }));
    await act(async () => {});
    expect(kinds(result.current.items)).toEqual(['user', 'system']);
  });

  it('allows a new question after Stop', () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('go');
    });
    act(() => result.current.stop());
    act(() => {
      expect(result.current.send('again')).toBe(true);
    });
    expect(chat.turns).toHaveLength(2);
  });

  it('unmounting mid-stream aborts it', () => {
    const { result, unmount } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('go');
    });
    const signal = chat.last.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});

describe('usePulseChat: failures', () => {
  const sentence = async (err: unknown) => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('go');
    });
    await act(async () => chat.last.fail(err));
    const system = result.current.items.filter((i) => i.kind === 'system');
    expect(system).toHaveLength(1);
    // The user's message stays on screen after a failed turn.
    expect(result.current.items[0]).toMatchObject({ kind: 'user', text: 'go' });
    expect(result.current.streaming).toBe(false);
    return system[0] as Extract<ChatItem, { kind: 'system' }>;
  };

  it.each([
    ['daily_limit', 429, 'Daily AI limit reached — try again tomorrow.'],
    ['too_many_streams', 429, 'Pulse is already answering two of your questions — wait a moment and try again.'],
    ['llm_unavailable', 503, "The AI assistant isn't configured on this deployment."],
    ['too_large', 413, "That message couldn't be sent — try a shorter question."],
    ['bad_request', 400, "That message couldn't be sent — try a shorter question."],
  ])('maps %s to its sentence', async (code, status, text) => {
    const line = await sentence(new PulseApiError(status, code));
    expect(line.text).toBe(text);
    expect(line.retry).toBe(code === 'too_many_streams');
  });

  it('rate_limited names the wait when known, and omits it when not', async () => {
    expect((await sentence(new PulseApiError(429, 'rate_limited', 12))).text).toBe("You're asking quickly — try again in 12 seconds.");
  });

  it('rate_limited without a Retry-After', async () => {
    expect((await sentence(new PulseApiError(429, 'rate_limited'))).text).toBe("You're asking quickly — try again in a moment.");
  });

  it('a network failure or an unknown status offers a retry', async () => {
    const net = await sentence(new TypeError('Failed to fetch'));
    expect(net).toMatchObject({ text: "Couldn't reach Pulse — check your connection and try again.", retry: true });
    const proxy = await sentence(new PulseApiError(502, null));
    expect(proxy.retry).toBe(true);
  });

  it('an error event shows its text as a system line and ends the turn', () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('go');
    });
    act(() => chat.last.emit({ type: 'error', text: 'The assistant hit a problem.' }));
    act(() => chat.last.emit({ type: 'done' }));
    expect(result.current.items[1]).toMatchObject({ kind: 'system', text: 'The assistant hit a problem.' });
    expect(result.current.streaming).toBe(false);
  });

  it('retry resends the same last user message without duplicating it', async () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('go');
    });
    await act(async () => chat.last.fail(new TypeError('offline')));
    act(() => result.current.retry());
    expect(chat.turns).toHaveLength(2);
    expect(chat.last.messages).toEqual([{ role: 'user', content: 'go' }]);
    expect(kinds(result.current.items)).toEqual(['user']); // the failure line is gone while retrying
    act(() => chat.last.emit({ type: 'message', text: 'ok' }));
    act(() => chat.last.emit({ type: 'done' }));
    expect(kinds(result.current.items)).toEqual(['user', 'assistant']);
  });
});

describe('usePulseChat: reset', () => {
  it('clears the conversation and aborts a running turn', () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('go');
    });
    const signal = chat.last.signal!;
    act(() => result.current.reset());
    expect(signal.aborted).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.streaming).toBe(false);
    act(() => {
      result.current.send('fresh');
    });
    expect(chat.last.messages).toEqual([{ role: 'user', content: 'fresh' }]);
  });

  it('never writes the conversation to storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => usePulseChat());
    act(() => {
      result.current.send('private-ish question');
    });
    act(() => chat.last.emit({ type: 'message', text: 'answer' }));
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe('usePulseChat: interrupted attempts', () => {
  it('marks unfinished tools on Stop and ignores late results after reset', () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => { result.current.send('go'); });
    const old = chat.last;
    act(() => old.emit({ type: 'tool', name: 'pulse_board', args: '{}' }));
    act(() => result.current.stop());
    expect(result.current.items[1]).toMatchObject({ result: 'Stopped before it finished' });
    act(() => result.current.reset());
    act(() => old.emit({ type: 'message', text: 'late answer' }));
    expect(result.current.items).toEqual([]);
  });

  it('offers a retry after a clean stream end without done', async () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => { result.current.send('go'); });
    act(() => chat.last.emit({ type: 'tool', name: 'pulse_board', args: '{}' }));
    await act(async () => chat.last.end());
    expect(result.current.items[1]).toMatchObject({ result: 'Stopped before it finished' });
    expect(result.current.items[2]).toMatchObject({ retry: true, text: expect.stringMatching(/connection ended/) });
  });

  it('retries a late failure by removing the partial answer and all attempt tools', async () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => { result.current.send('go'); });
    act(() => chat.last.emit({ type: 'tool', name: 'pulse_board', args: '{}' }));
    act(() => chat.last.emit({ type: 'message', text: 'partial answer' }));
    await act(async () => chat.last.fail(new TypeError('connection lost')));
    expect(result.current.items[1]).toMatchObject({ result: 'Stopped before it finished' });
    act(() => result.current.retry());
    expect(chat.last.messages).toEqual([{ role: 'user', content: 'go' }]);
    expect(kinds(result.current.items)).toEqual(['user']);
  });

  it('ignores events after done, including an old stream after a new send', () => {
    const { result } = renderHook(() => usePulseChat());
    act(() => { result.current.send('one'); });
    const old = chat.last;
    act(() => old.emit({ type: 'done' }));
    act(() => { result.current.send('two'); });
    act(() => old.emit({ type: 'message', text: 'late answer' }));
    expect(textOf(result.current.items)).toEqual(['one', 'two']);
    expect(result.current.streaming).toBe(true);
  });
});

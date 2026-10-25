import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/pulseApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pulseApi')>()),
  streamChat: vi.fn(),
  pulseConfigured: vi.fn(() => true),
}));
import { PulseApiError, pulseConfigured, streamChat } from '@/lib/pulseApi';
import { controlledChat } from '@/test/pulseChatStream';
import { PulseChat } from './PulseChat';
import { PulseChatLauncher } from './PulseChatLauncher';

let chat: ReturnType<typeof controlledChat>;
let setItem: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(streamChat).mockReset();
  vi.mocked(pulseConfigured).mockReturnValue(true);
  chat = controlledChat();
  setItem = vi.spyOn(Storage.prototype, 'setItem');
});

afterEach(() => {
  // The conversation is in memory only, whatever a test did.
  expect(setItem).not.toHaveBeenCalled();
  setItem.mockRestore();
  vi.unstubAllGlobals();
});

const box = () => screen.getByRole('textbox', { name: 'Ask Pulse a question' });
const sendButton = () => screen.getByRole('button', { name: 'Send' });
const log = () => screen.getByRole('log');

function renderChat(props: Partial<React.ComponentProps<typeof PulseChat>> = {}) {
  const user = userEvent.setup();
  render(<PulseChat city="delhi" type="cafe" {...props} />);
  return user;
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(box(), text);
  await user.click(sendButton());
}

describe('PulseChat: a turn', () => {
  it('shows tool activity, then the answer', async () => {
    const user = renderChat();
    await ask(user, 'What is on this weekend?');
    expect(within(log()).getByText('What is on this weekend?')).toBeInTheDocument();

    act(() => chat.last.emit({ type: 'tool', name: 'pulse_board', args: '{"city":"delhi"}' }));
    expect(screen.getByText('Looked at the release board')).toBeInTheDocument();
    expect(screen.getByText('running…')).toBeInTheDocument();
    act(() => chat.last.emit({ type: 'tool_result', name: 'pulse_board', summary: '5 releases ranked' }));
    expect(screen.queryByText('running…')).not.toBeInTheDocument();
    act(() => chat.last.emit({ type: 'message', text: 'Theme it around Saffron Nights.' }));
    act(() => chat.last.emit({ type: 'done' }));

    const text = log().textContent ?? '';
    expect(text.indexOf('Looked at the release board')).toBeLessThan(text.indexOf('Theme it around Saffron Nights.'));
    expect(text.indexOf('What is on this weekend?')).toBeLessThan(text.indexOf('Looked at the release board'));
  });

  it('disables send while streaming and re-enables it after done', async () => {
    const user = renderChat();
    await ask(user, 'first');
    expect(screen.getByText('Pulse is thinking…')).toBeInTheDocument();
    await user.type(box(), 'second, typed while waiting');
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    act(() => chat.last.emit({ type: 'message', text: 'an answer' }));
    act(() => chat.last.emit({ type: 'done' }));
    expect(sendButton()).toBeEnabled();
    expect(screen.queryByText('Pulse is thinking…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('renders a cap message as a system line, not as an alert or a toast', async () => {
    const user = renderChat();
    await ask(user, 'a big question');
    act(() => chat.last.emit({ type: 'error', text: "The assistant ran out of time before it could finish." }));
    act(() => chat.last.emit({ type: 'done' }));
    const line = screen.getByText('The assistant ran out of time before it could finish.');
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('a big question')).toBeInTheDocument();
  });

  it('shows the server\'s own step-limit message as a normal assistant message', async () => {
    const user = renderChat();
    await ask(user, 'q');
    act(() => chat.last.emit({ type: 'message', text: 'I hit my step limit before I could finish.' }));
    expect(screen.getByText('I hit my step limit before I could finish.').closest('[role="status"]')).toBeNull();
  });
});

describe('PulseChat: suggested prompts', () => {
  it('seeds the café wording with the city, and no title prompt without a title', () => {
    renderChat();
    expect(screen.getAllByRole('button', { name: /^(Which|Who|Plan) / }).map((b) => b.textContent)).toEqual([
      'Which release should my Delhi café theme this weekend around?',
      'Plan a screening-night special for Friday at my Delhi café.',
    ]);
  });

  it('says "brand" for a D2C business, and adds the audience prompt when there is a title', () => {
    renderChat({ city: 'mumbai', type: 'd2c_food', title: 'Saffron Nights' });
    expect(screen.getAllByRole('button', { name: /^(Which|Who|Plan) / }).map((b) => b.textContent)).toEqual([
      'Which release should my Mumbai brand theme this weekend around?',
      'Who is the audience for Saffron Nights in Mumbai?',
      'Plan a screening-night special for Friday at my Mumbai brand.',
    ]);
  });

  it('clicking one sends it and hides the suggestions', async () => {
    const user = renderChat({ title: 'Saffron Nights' });
    await user.click(screen.getByRole('button', { name: 'Who is the audience for Saffron Nights in Delhi?' }));
    expect(chat.last.messages).toEqual([{ role: 'user', content: 'Who is the audience for Saffron Nights in Delhi?' }]);
    expect(screen.queryByRole('list', { name: 'Suggested questions' })).not.toBeInTheDocument();
  });

  it('each suggestion is a 44px target', () => {
    renderChat();
    for (const b of screen.getAllByRole('button', { name: /^(Which|Plan) / })) expect(b).toHaveClass('min-h-11');
  });
});

describe('PulseChat: the composer', () => {
  it('labels the box, caps it at 4000 characters and carries the privacy footnote', () => {
    renderChat();
    expect(box()).toHaveAttribute('maxlength', '4000');
    expect(
      screen.getByText("Answers use Qloo's aggregate taste data and public sources. Don't enter personal information."),
    ).toBeInTheDocument();
  });

  it('Enter sends and clears the box', async () => {
    const user = renderChat();
    await user.type(box(), 'hello{Enter}');
    expect(chat.turns).toHaveLength(1);
    expect(chat.last.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(box()).toHaveValue('');
  });

  it('Shift+Enter inserts a newline instead of sending', async () => {
    const user = renderChat();
    await user.type(box(), 'line one{Shift>}{Enter}{/Shift}line two');
    expect(chat.turns).toHaveLength(0);
    expect(box()).toHaveValue('line one\nline two');
    await user.keyboard('{Enter}');
    expect(chat.last.messages).toEqual([{ role: 'user', content: 'line one\nline two' }]);
  });

  it('does not send an empty or whitespace-only question', async () => {
    const user = renderChat();
    expect(sendButton()).toBeDisabled();
    await user.type(box(), '   ');
    expect(sendButton()).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(chat.turns).toHaveLength(0);
  });

  it('keeps the box focused after sending', async () => {
    const user = renderChat();
    await user.type(box(), 'hello{Enter}');
    expect(box()).toHaveFocus();
  });

  it('focuses the box on mount when asked to', () => {
    renderChat({ autoFocus: true });
    expect(box()).toHaveFocus();
  });
});

describe('PulseChat: what goes to the server', () => {
  it('carries the last 12 text messages with the new question last, and no tool or system content', async () => {
    const user = renderChat();
    for (let i = 1; i <= 8; i++) {
      await ask(user, `question ${i}`);
      act(() => chat.last.emit({ type: 'tool', name: 'pulse_board', args: 'TOOL-ARGS' }));
      act(() => chat.last.emit({ type: 'tool_result', name: 'pulse_board', summary: 'TOOL-SUMMARY' }));
      act(() => chat.last.emit({ type: 'message', text: `answer ${i}` }));
      act(() => chat.last.emit({ type: 'done' }));
    }
    await ask(user, 'the newest');
    const sent = chat.last.messages;
    expect(sent).toHaveLength(12);
    expect(sent[sent.length - 1]).toEqual({ role: 'user', content: 'the newest' });
    expect(JSON.stringify(sent)).not.toMatch(/TOOL-|Stopped|running/);
    expect(sent.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
  });
});

describe('PulseChat: stop', () => {
  it('aborts the stream, keeps partial tool lines, ends with Stopped and shows no error', async () => {
    const user = renderChat();
    await ask(user, 'slow one');
    act(() => chat.last.emit({ type: 'tool', name: 'qloo_recommend', args: '{}' }));
    const signal = chat.last.signal!;
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(signal.aborted).toBe(true);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Asked Qloo for recommendations')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't reach Pulse/)).not.toBeInTheDocument();
    expect(screen.queryByText('Pulse is thinking…')).not.toBeInTheDocument();
    expect(sendButton()).toBeDisabled(); // empty box, but no longer because of a stream
  });

  it('unmounting mid-stream aborts it', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PulseChat city="delhi" type="cafe" />);
    await ask(user, 'go');
    const signal = chat.last.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});

describe('PulseChat: failures', () => {
  async function failWith(err: unknown) {
    const user = renderChat();
    await ask(user, 'my question');
    await act(async () => chat.last.fail(err));
    return user;
  }

  it.each([
    [new PulseApiError(429, 'daily_limit'), 'Daily AI limit reached — try again tomorrow.'],
    [new PulseApiError(429, 'too_many_streams', 5), 'Pulse is already answering two of your questions — wait a moment and try again.'],
    [new PulseApiError(429, 'rate_limited', 30), "You're asking quickly — try again in 30 seconds."],
    [new PulseApiError(429, 'rate_limited'), "You're asking quickly — try again in a moment."],
    [new PulseApiError(503, 'llm_unavailable'), "The AI assistant isn't configured on this deployment."],
    [new PulseApiError(413, 'too_large'), "That message couldn't be sent — try a shorter question."],
    [new PulseApiError(400, 'bad_request'), "That message couldn't be sent — try a shorter question."],
  ])('says the right thing for %j', async (err, sentence) => {
    await failWith(err);
    const line = screen.getByText(sentence);
    expect(line).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    if (err instanceof PulseApiError && err.code === 'too_many_streams') expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    else expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByText('my question')).toBeInTheDocument();
  });

  it('a network error offers Try again, which resends the same last user message', async () => {
    const user = await failWith(new TypeError('Failed to fetch'));
    expect(screen.getByText("Couldn't reach Pulse — check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(chat.turns).toHaveLength(2);
    expect(chat.turns[1].messages).toEqual([{ role: 'user', content: 'my question' }]);
    expect(screen.getAllByText('my question')).toHaveLength(1);
    expect(screen.queryByText(/Couldn't reach Pulse/)).not.toBeInTheDocument();
    act(() => chat.last.emit({ type: 'message', text: 'back again' }));
    act(() => chat.last.emit({ type: 'done' }));
    expect(screen.getByText('back again')).toBeInTheDocument();
  });
});

describe('PulseChat: tool lines', () => {
  async function withTool(name: string, args = '{"k":"v"}') {
    const user = renderChat();
    await ask(user, 'q');
    act(() => chat.last.emit({ type: 'tool', name, args }));
    return user;
  }

  it.each([
    ['pulse_board', 'Looked at the release board'],
    ['release_brief', 'Read a release brief'],
    ['search_releases', "Searched this week's releases"],
    ['titles_shot_in', 'Looked up titles shot in a city'],
    ['qloo_recommend', 'Asked Qloo for recommendations'],
    ['qloo_where_popular', 'Asked Qloo where something is popular'],
    ['qloo_audience_demographics', 'Asked Qloo about audience skew'],
    ['qloo_rank', 'Asked Qloo to rank options'],
    ['qloo_compare_audiences', 'Asked Qloo to compare audiences'],
    ['qloo_find_tags', 'Looked up Qloo tags'],
    ['qloo_describe', 'Looked up an entity in Qloo'],
    ['made_up_tool', 'Used the tool made_up_tool'],
  ])('%s reads as "%s"', async (name, label) => {
    await withTool(name);
    expect(screen.getByText(label)).toBeInTheDocument();
    const summary = screen.getByText(label).closest('summary')!;
    expect(summary).toHaveTextContent(label);
    // Qloo is named only for the tools that really are Qloo's.
    expect(/qloo/i.test(label)).toBe(name.startsWith('qloo_'));
  });

  it('is collapsed by default and opens to the tool, its arguments and its result', async () => {
    const user = await withTool('pulse_board', '{"city":"delhi"}');
    act(() => chat.last.emit({ type: 'tool_result', name: 'pulse_board', summary: '5 releases ranked' }));
    const details = screen.getByText('Looked at the release board').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveAttribute('aria-live', 'off');
    await user.click(screen.getByText('Looked at the release board'));
    expect(details).toHaveAttribute('open');
    expect(within(details).getByText('pulse_board')).toBeInTheDocument();
    expect(within(details).getByText('{"city":"delhi"}')).toBeInTheDocument();
    expect(within(details).getByText('5 releases ranked')).toBeInTheDocument();
  });

  it('shows "running…" until the result arrives', async () => {
    await withTool('release_brief');
    expect(screen.getByText('running…')).toBeInTheDocument();
    act(() => chat.last.emit({ type: 'tool_result', name: 'release_brief', summary: 'done' }));
    expect(screen.queryByText('running…')).not.toBeInTheDocument();
  });
});

describe('PulseChat: text only', () => {
  it('renders an assistant message holding markup literally, creating no elements', async () => {
    const user = renderChat();
    await ask(user, 'q');
    const hostile = '<img src=x onerror="window.__pwned=1"> and <b>bold</b>\nsecond line';
    act(() => chat.last.emit({ type: 'message', text: hostile }));
    const bubble = screen.getByText(/and .*bold.*second line/);
    expect(bubble.textContent).toBe(hostile);
    expect(bubble.querySelector('img, b')).toBeNull();
    expect(log().querySelector('img')).toBeNull();
    expect(bubble).toHaveClass('whitespace-pre-wrap');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('renders the visitor\'s own markup as text too', async () => {
    const user = renderChat();
    await ask(user, '<script>alert(1)</script>');
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(log().querySelector('script')).toBeNull();
  });
});

describe('PulseChat: New chat and the log', () => {
  it('New chat clears the conversation, aborts a running turn and brings the suggestions back', async () => {
    const user = renderChat();
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument();
    await ask(user, 'hello');
    const signal = chat.last.signal!;
    act(() => chat.last.emit({ type: 'message', text: 'hi there' }));
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('hello')).not.toBeInTheDocument();
    expect(screen.queryByText('hi there')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Suggested questions' })).toBeInTheDocument();
    await ask(user, 'fresh');
    expect(chat.last.messages).toEqual([{ role: 'user', content: 'fresh' }]);
  });

  it('the message list is a polite, focusable log', () => {
    renderChat();
    expect(log()).toHaveAttribute('aria-live', 'polite');
    expect(log()).toHaveAttribute('tabindex', '0');
  });

  it('follows the newest content, but not once the reader has scrolled up', async () => {
    const user = renderChat();
    const el = log();
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 300 });
    await ask(user, 'one');
    expect(el.scrollTop).toBe(1000);

    el.scrollTop = 100; // reader scrolls up
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
    act(() => chat.last.emit({ type: 'message', text: 'a long answer' }));
    expect(el.scrollTop).toBe(100);

    el.scrollTop = 700; // back at the bottom
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
    act(() => chat.last.emit({ type: 'tool', name: 'pulse_board', args: '{}' }));
    expect(el.scrollTop).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// The launcher and its sheet
// ---------------------------------------------------------------------------

function mockViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

describe('PulseChatLauncher', () => {
  it('renders nothing when Pulse is not configured', () => {
    vi.mocked(pulseConfigured).mockReturnValue(false);
    const { container } = render(<PulseChatLauncher city="delhi" type="cafe" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens a sheet titled Ask Pulse with a description, and focuses the question box', async () => {
    mockViewport(true);
    const user = userEvent.setup();
    render(<PulseChatLauncher city="delhi" type="cafe" title="Saffron Nights" />);
    const launcher = screen.getByRole('button', { name: 'Ask Pulse' });
    expect(launcher).toHaveClass('min-h-11');
    await user.click(launcher);
    const dialog = screen.getByRole('dialog', { name: 'Ask Pulse' });
    expect(dialog).toHaveAccessibleDescription(/releases/);
    expect(within(dialog).getByRole('textbox', { name: 'Ask Pulse a question' })).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Who is the audience for Saffron Nights in Delhi?' })).toBeInTheDocument();
  });

  it('Escape closes it, returns focus to the launcher and drops the conversation', async () => {
    mockViewport(true);
    const user = userEvent.setup();
    render(<PulseChatLauncher city="delhi" type="cafe" />);
    const launcher = screen.getByRole('button', { name: 'Ask Pulse' });
    await user.click(launcher);
    await user.type(screen.getByRole('textbox', { name: 'Ask Pulse a question' }), 'remember me{Enter}');
    const signal = chat.last.signal!;
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();
    expect(signal.aborted).toBe(true);
    await user.click(launcher);
    expect(screen.queryByText('remember me')).not.toBeInTheDocument();
  });

  it('is a right-hand panel from 768px up and a bottom sheet below that', async () => {
    const user = userEvent.setup();
    mockViewport(true);
    const wide = render(<PulseChatLauncher city="delhi" type="cafe" />);
    await user.click(screen.getByRole('button', { name: 'Ask Pulse' }));
    expect(screen.getByRole('dialog')).toHaveClass('right-0');
    expect(screen.getByRole('dialog')).not.toHaveClass('bottom-0');
    wide.unmount();

    mockViewport(false);
    render(<PulseChatLauncher city="delhi" type="cafe" />);
    await user.click(screen.getByRole('button', { name: 'Ask Pulse' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('bottom-0', 'rounded-t-2xl');
    expect(dialog.className).toMatch(/h-\[85dvh\]/);
    expect(vi.mocked(window.matchMedia)).toHaveBeenCalledWith('(min-width: 48rem)');
  });

  it('falls back to the right-hand panel where matchMedia does not exist', async () => {
    const user = userEvent.setup();
    render(<PulseChatLauncher city="delhi" type="cafe" />);
    await user.click(screen.getByRole('button', { name: 'Ask Pulse' }));
    expect(screen.getByRole('dialog')).toHaveClass('right-0');
  });
});

describe('Pulse chat responsive and focus regressions', () => {
  it('keeps an open conversation and stream when crossing the desktop breakpoint', async () => {
    const listeners = new Set<() => void>();
    const query = { matches: true, media: '(min-width: 48rem)', addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) };
    vi.stubGlobal('matchMedia', () => query);
    const user = userEvent.setup();
    render(<PulseChatLauncher city="delhi" type="cafe" />);
    await user.click(screen.getByRole('button', { name: 'Ask Pulse' }));
    await user.type(screen.getByRole('textbox'), 'keep this{Enter}');
    const signal = chat.last.signal!;
    act(() => { query.matches = false; for (const listener of [...listeners]) listener(); });
    expect(screen.getByRole('dialog')).toHaveClass('bottom-0');
    expect(screen.getByText('keep this')).toBeInTheDocument();
    expect(signal.aborted).toBe(false);
    act(() => chat.last.emit({ type: 'message', text: 'still connected' }));
    expect(screen.getByText('still connected')).toBeInTheDocument();
    act(() => { query.matches = true; for (const listener of [...listeners]) listener(); });
    expect(screen.getByRole('dialog')).toHaveClass('right-0');
    expect(screen.getByText('still connected')).toBeInTheDocument();
  });

  it('focuses the question after a suggested prompt, Stop, and Try again', async () => {
    const user = renderChat();
    await user.click(screen.getByRole('button', { name: 'Which release should my Delhi café theme this weekend around?' }));
    expect(screen.getByRole('textbox')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByRole('textbox')).toHaveFocus();
    await ask(user, 'try this');
    await act(async () => chat.last.fail(new TypeError('lost connection')));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('textbox')).toHaveFocus();
  });
});

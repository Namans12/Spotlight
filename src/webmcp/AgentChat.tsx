import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Settings, X } from 'lucide-react';

// A real LLM driving Spotlight's own WebMCP tools, in-page. This exists
// because no shipping consumer agent (ChatGPT's desktop app, Chrome's own
// assistant) actually routes through document.modelContext yet — we tested
// this exhaustively — so this is the demonstration that the tool surface is
// genuinely agent-legible: getTools() feeds real schemas to a real model,
// and its tool_calls run through the exact same executeTool() path a native
// browser agent would use once one ships.
//
// The visitor's own OpenAI key never touches a database — see api/agent-relay.ts.
// It's kept in localStorage only, scoped to this browser.

const KEY_STORAGE = 'spotlight:agent-openai-key';
const MODEL_STORAGE = 'spotlight:agent-model';
const DEFAULT_MODEL = 'gpt-5.6-sol';
const MAX_TOOL_ROUNDS = 6;

interface ToolCallLog {
  name: string;
  args: string;
  result: string;
}

interface DisplayMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  toolCalls?: ToolCallLog[];
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

function parseSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema === 'string') {
    try {
      return JSON.parse(schema);
    } catch {
      return { type: 'object', properties: {} };
    }
  }
  return (schema as Record<string, unknown>) ?? { type: 'object', properties: {} };
}

export function AgentChat() {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyStep, setBusyStep] = useState('');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const historyRef = useRef<OpenAIMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSupported(typeof document !== 'undefined' && !!document.modelContext?.getTools);
    try {
      setApiKey(localStorage.getItem(KEY_STORAGE) ?? '');
      setModel(localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL);
    } catch {
      // Private browsing or storage disabled — key just won't persist across reloads.
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  function saveApiKey(value: string) {
    setApiKey(value);
    try {
      localStorage.setItem(KEY_STORAGE, value);
    } catch {
      /* ignore */
    }
  }

  function saveModel(value: string) {
    setModel(value);
    try {
      localStorage.setItem(MODEL_STORAGE, value);
    } catch {
      /* ignore */
    }
  }

  async function callRelay(msgs: OpenAIMessage[], tools: unknown[]): Promise<OpenAIMessage> {
    const res = await fetch('/api/agent-relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, model, messages: msgs, tools }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || data?.error || `Request failed (${res.status})`);
    return data.choices[0].message as OpenAIMessage;
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    if (!apiKey) {
      setShowSettings(true);
      return;
    }

    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    setBusyStep('Discovering tools…');

    try {
      const liveTools = await document.modelContext!.getTools();

      const openaiTools = liveTools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: parseSchema(t.inputSchema) },
      }));

      if (historyRef.current.length === 0) {
        historyRef.current.push({
          role: 'system',
          content:
            "You are an assistant embedded directly in Spotlight, a streaming release tracker. " +
            'You have tools to search the catalog, look up watch order for franchises, and manage ' +
            "the user's real watchlist. Use them whenever they'd help — you're acting on the user's " +
            'actual account, not a simulation. Be concise in your final replies.',
        });
      }
      historyRef.current.push({ role: 'user', content: text });

      const toolLog: ToolCallLog[] = [];

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        setBusyStep(round === 0 ? 'Thinking…' : 'Thinking about the results…');
        const reply = await callRelay(historyRef.current, openaiTools);

        if (!reply.tool_calls || reply.tool_calls.length === 0) {
          historyRef.current.push({ role: 'assistant', content: reply.content ?? '' });
          setMessages((m) => [...m, { role: 'assistant', text: reply.content ?? '(no response)', toolCalls: toolLog.length ? [...toolLog] : undefined }]);
          setBusy(false);
          setBusyStep('');
          return;
        }

        historyRef.current.push({ role: 'assistant', content: reply.content, tool_calls: reply.tool_calls });

        for (const call of reply.tool_calls) {
          setBusyStep(`Calling ${call.function.name}…`);
          const liveTool = liveTools.find((t) => t.name === call.function.name);
          let resultText: string;
          if (!liveTool) {
            resultText = JSON.stringify({ error: `Tool "${call.function.name}" is not currently registered.` });
          } else {
            try {
              // call.function.arguments is already a JSON string — exactly
              // the encoding Chrome's executeTool requires.
              const raw = await document.modelContext!.executeTool(liveTool, call.function.arguments);
              resultText = typeof raw === 'string' ? raw : JSON.stringify(raw);
            } catch (err) {
              resultText = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          }
          toolLog.push({ name: call.function.name, args: call.function.arguments, result: resultText });
          historyRef.current.push({ role: 'tool', tool_call_id: call.id, content: resultText, name: call.function.name });
        }
      }

      setMessages((m) => [
        ...m,
        { role: 'assistant', text: "That took more tool calls than I'd like to keep going automatically — here's where it got to.", toolCalls: toolLog },
      ]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `Error: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setBusy(false);
      setBusyStep('');
    }
  }

  if (!supported) return null;

  return (
    <div style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 200, fontFamily: 'inherit' }}>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground shadow-lg hover:brightness-110"
        >
          <MessageCircle size={18} /> Ask Spotlight AI
        </button>
      )}

      {open && (
        <div className="flex h-[560px] w-[380px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <MessageCircle size={16} className="text-accent" /> Spotlight AI
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">WebMCP</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowSettings((s) => !s)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Settings">
                <Settings size={16} />
              </button>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          {showSettings && (
            <div className="space-y-2 border-b border-border bg-secondary/40 px-4 py-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Your OpenAI API key — stored only in this browser, never on Spotlight's servers.
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => saveApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
              />
              <input
                type="text"
                value={model}
                onChange={(e) => saveModel(e.target.value)}
                placeholder={DEFAULT_MODEL}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                Sent to a stateless relay (api/agent-relay.ts) that forwards it to OpenAI and back — required only
                because api.openai.com blocks direct browser requests. Nothing is logged or stored server-side.
              </p>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Try: "What order should I watch the John Wick movies in, and get me caught up?" — this calls the
                real <code>plan_watch_order</code> WebMCP tool against your actual watchlist.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'inline-block max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-accent-foreground'
                      : 'inline-block max-w-[85%] rounded-2xl rounded-bl-sm bg-secondary px-3 py-2 text-sm text-foreground'
                  }
                >
                  {m.text}
                </div>
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {m.toolCalls.map((tc, j) => (
                      <details key={j} className="rounded-lg border border-border bg-background/60 px-2 py-1 text-left">
                        <summary className="cursor-pointer text-[11px] font-mono text-accent">🔧 {tc.name}</summary>
                        <div className="mt-1 space-y-1 font-mono text-[10px] text-muted-foreground">
                          <div>args: {tc.args}</div>
                          <div>result: {tc.result}</div>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="text-xs italic text-muted-foreground">{busyStep}</div>}
          </div>

          <div className="flex items-center gap-2 border-t border-border p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Ask about watch order, your list…"
              className="flex-1 rounded-full border border-border bg-secondary px-3.5 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
            <button
              onClick={send}
              disabled={busy}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground disabled:opacity-50"
              aria-label="Send"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

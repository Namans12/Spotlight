import { runAgent } from "../agent/loop.js";
import { evidenceAnswerCollector } from '../agent/evidenceAnswer.js';
import type { AgentTool } from "../agent/tools.js";
import { readJsonBody } from "../http/body.js";
import { clientAddress, type RateLimiter } from "../http/rateLimit.js";
import type { Handler } from "../http/router.js";
import { startSse } from "../http/sse.js";
import { createStreamCounter, type StreamCounter } from "../http/streamCap.js";
import type { ChatMessage, LlmClient } from "../llm/client.js";
import type { Timers } from "../timers.js";
import { sessionKey, type CapDecision } from "../usage.js";
import { json } from "./params.js";

export interface ChatRouteDeps {
  /** Its own instance (10 a minute): a chat is up to six model calls and a handful of Qloo lookups. */
  rateLimiter: RateLimiter;
  /** Null when there is no GROQ_API_KEY. */
  llm: LlmClient | null;
  /** Takes one slot of the session's and the day's budget. Called once per request, however many tool rounds it runs. */
  takeUsage: (session: string) => Promise<CapDecision>;
  getTools: () => Promise<AgentTool[]>;
  /** Open streams per client address; two by default. One is made if not given. */
  streams?: StreamCounter;
  maxRounds?: number;
  toolTimeoutMs?: number;
  deadlineMs?: number;
  timers?: Timers;
  now?: () => Date;
  onError?: (context: string, err: unknown) => void;
}

export const MAX_BODY_BYTES = 100 * 1024;
export const MAX_MESSAGES = 12;
export const MAX_CONTENT_CHARS = 4000;
export const MAX_STREAMS_PER_CLIENT = 2;

const bad = (detail: string) => ({ error: "bad_request", detail });

type Parsed = { ok: true; history: ChatMessage[] } | { ok: false; detail: string };

/** The last 12 messages, as plain {role, content}. Anything a client adds to a
 *  message (tool calls, names) is dropped by rebuilding it, and a role other
 *  than user or assistant is refused, so a client can never supply a system or
 *  tool message. Only the kept messages are checked: the rest are discarded. */
function parseMessages(body: Record<string, unknown>): Parsed {
  const raw = body.messages;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, detail: "messages must be a non-empty array" };
  const history: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (typeof m !== "object" || m === null || Array.isArray(m)) return { ok: false, detail: "each message must be an object" };
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return { ok: false, detail: "role must be user or assistant" };
    if (typeof content !== "string" || content.trim() === "") return { ok: false, detail: "content must be a non-empty string" };
    if ([...content].length > MAX_CONTENT_CHARS) return { ok: false, detail: `content must be at most ${MAX_CONTENT_CHARS} characters` };
    history.push({ role, content });
  }
  if (history[history.length - 1].role !== "user") return { ok: false, detail: "the last message must be from the user" };
  return { ok: true, history };
}

/** POST /chat. Everything is decided before the first byte of the stream,
 *  because after that the status is already 200. Cheapest check first: the
 *  body and its shape (400, or 413 while it is still being read), the
 *  per-client rate limit (so a flood is refused before any work), whether a
 *  model is configured, the daily cap (one slot for the whole turn), and only
 *  then the SSE stream. */
export function chatHandler(deps: ChatRouteDeps): Handler {
  const report = (context: string, err: unknown) => {
    try { deps.onError?.(context, err); } catch { /* a broken logger must not break the request */ }
  };

  const streams = deps.streams ?? createStreamCounter(MAX_STREAMS_PER_CLIENT);

  return async (req, res) => {
    const body = await readJsonBody(req, MAX_BODY_BYTES);
    if (!body.ok) {
      return body.reason === "too_large"
        ? json(res, 413, { error: "too_large" }, { Connection: "close" })
        : json(res, 400, bad("the body must be a JSON object sent as application/json"));
    }
    const parsed = parseMessages(body.value);
    if (!parsed.ok) return json(res, 400, bad(parsed.detail));

    const address = clientAddress(req);
    const decision = deps.rateLimiter.check(address);
    if (!decision.allowed) return json(res, 429, { error: "rate_limited" }, { "Retry-After": String(decision.retryAfterSec) });

    // Right after the rate limit and before anything is spent: no usage slot is taken for a refused stream.
    const release = streams.tryAcquire(address);
    if (!release) return json(res, 429, { error: "too_many_streams" }, { "Retry-After": "5" });
    // Freed once, whichever of these happens first: the handler ending (including by throwing) or the connection closing.
    res.once("close", release);
    try {
      await serve(req, res, parsed.history);
    } finally {
      release();
    }
  };

  async function serve(req: Parameters<Handler>[0], res: Parameters<Handler>[1], history: ChatMessage[]): Promise<void> {
    const { llm } = deps;
    if (!llm) return json(res, 503, { error: "llm_unavailable" });

    try {
      const usage = await deps.takeUsage(sessionKey(req, deps.now?.() ?? new Date()));
      if (!usage.allowed) return json(res, 429, { error: "daily_limit" });
    } catch (err) {
      report("usage", err);
      return json(res, 503, { error: "unavailable" });
    }

    const stream = startSse(res, { timers: deps.timers });
    // The client may have gone while the usage slot was being taken; then there is nobody to answer.
    if (stream.closed) return;
    try {
      let tools: AgentTool[];
      try {
        tools = await deps.getTools();
      } catch (err) {
        report("tools", err);
        stream.write({ type: "error", text: "The assistant's tools are unavailable right now. Please try again shortly." });
        stream.write({ type: "done" });
        return;
      }
      const evidence=evidenceAnswerCollector(tools);
      const events = runAgent(llm, evidence.tools, history, deps.maxRounds, {renderFinal:evidence.answer, signal: stream.signal, toolTimeoutMs: deps.toolTimeoutMs, deadlineMs: deps.deadlineMs, timers: deps.timers, onError: report });
      for await (const event of events) {
        if (!stream.write(event)) break; // the client is gone; leaving the loop also stops the generator
      }
    } catch (err) {
      // runAgent reports failures as events, so reaching here is a bug. The
      // stream is open, so say so inside it rather than send a second response.
      report("chat stream", err);
      stream.write({ type: "error", text: "Something went wrong on my side. Please try again." });
      stream.write({ type: "done" });
    } finally {
      stream.end();
    }
  }
}

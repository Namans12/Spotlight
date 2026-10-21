// The agent loop: ask the model, run the tools it asks for, give it the
// results, repeat until it answers or the step limit is reached. It is an async
// generator of AgentEvents, so the route can stream each step as it happens and
// stop the work the moment the consumer stops reading.
//
// UNVERIFIED AGAINST LIVE GROQ. There was no Groq key while this was built, so
// the loop has only run against local fakes that speak the OpenAI
// chat-completions tool-calling format. Specifically unverified: that
// openai/gpt-oss-120b on Groq emits well-formed `tool_calls` (valid JSON in
// `arguments`, names from the offered list, at most a few per turn) and keeps
// to the schemas given; that it accepts the harness's JSON Schemas as function
// parameters unchanged; that a `tool` message needs no `name` field; and how
// often it answers with an empty message after reasoning. Everything it sends
// is therefore treated as untrusted: arguments are parsed and sanitised, an
// unknown tool or bad arguments become a tool error it can recover from, and an
// empty or failed reply ends the stream with a fixed sentence.
//
// Budgets. One /chat takes ONE usage slot (R32) but may make up to six model
// calls, so the daily global cap undercounts real provider calls; that is a
// known, accepted looseness. What bounds a single chat instead: at most 8
// uncached Qloo harness calls and 12 tool calls in total, at most 4 calls per
// round, 6 rounds, 25 s per tool, and a 90 s deadline for the whole chat. A tool
// over budget is not run: the model is told so and answers with what it has.
//
// Nothing in a model reply, tool error or exception reaches the user as text of
// its own: the user sees the model's final message, short summaries built from
// tool results (sanitize.ts), and fixed sentences for failures. The real cause
// of a failure goes to `onError`, which the server logs.

import type { AgentEvent } from "../../../../shared/types/pulse.js";
import { LlmError, type ChatMessage, type LlmClient, type LlmErrorKind, type ToolCall } from "../llm/client.js";
import { realTimers, type Timers } from "../timers.js";
import { systemPrompt } from "./prompt.js";
import { parseArguments, sanitiseArgs, summarise, truncateResult } from "./sanitize.js";
import type { AgentTool } from "./tools.js";

export interface AgentOptions {
  /** Aborted when the client has gone: no further model call or tool starts, and one in flight is told to stop. */
  signal?: AbortSignal;
  /** Per tool call; 25 s unless a test says otherwise. */
  toolTimeoutMs?: number;
  /** For the whole chat; 90 s unless a test says otherwise. */
  deadlineMs?: number;
  /** Injectable so tests fire the timeout by hand. */
  timers?: Timers;
  onError?: (context: string, err: unknown) => void;
}

export const MAX_TOOL_CALLS_PER_ROUND = 4;
/** Uncached Qloo harness calls (`budget: "harness"` tools) per chat. */
export const MAX_HARNESS_CALLS_PER_CHAT = 8;
/** Every tool call that actually runs, Pulse's own included. */
export const MAX_TOOL_CALLS_PER_CHAT = 12;
export const TOOL_TIMEOUT_MS = 25_000;
export const CHAT_DEADLINE_MS = 90_000;
/** Completion budget for a chat round: final answers are at most 180 words, and
 *  the free tier meters tokens per minute (the campaign writer keeps 4096). */
export const CHAT_MAX_TOKENS = 1200;
const MAX_NAME = 64;
const MAX_SHOWN_ARGS = 300;

/** A rate limit whose reset is minutes away (the daily limit): "in a minute" would be a lie. */
const LIMIT_REACHED = "The AI service has reached its limit for now. Please try again later.";
const LLM_SENTENCES: Record<LlmErrorKind, string> = {
  rate_limited: "The AI service is busy right now. Please try again in a minute.",
  unavailable: "The AI service is unavailable right now. Please try again shortly.",
  bad_response: "The AI service returned something I couldn't use. Please try again.",
};
const GENERIC_FAILURE = "Something went wrong on my side. Please try again.";
const OUT_OF_TIME = "I ran out of time before finishing — here is what I found so far";
const CUT_OFF = " … (my answer was cut off; ask me to continue)";
const BUDGET_EXHAUSTED = { error: "budget_exhausted", note: "This chat has used its lookup budget; answer with what you have." };

const TIMEOUT = Symbol("timeout");
const CANCELLED = Symbol("cancelled");
const ABORTED = Symbol("aborted");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Only entries that look like function calls; a provider's odd entry is ignored, not trusted. */
function usableCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is ToolCall => isRecord(c) && isRecord(c.function) && typeof c.function.name === "string");
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, MAX_NAME);

async function runTool(tool: AgentTool, args: Record<string, unknown>, name: string, signal: AbortSignal, ms: number, timers: Timers, report: (c: string, e: unknown) => void): Promise<unknown> {
  const own = new AbortController();
  const follow = () => own.abort();
  if (signal.aborted) own.abort(); else signal.addEventListener("abort", follow, { once: true });
  let handle: unknown;
  const cutOff = new Promise<typeof TIMEOUT | typeof CANCELLED>((resolve) => {
    // Resolve first: aborting fires the listener below, which would otherwise win with CANCELLED.
    handle = timers.setTimeout(() => { resolve(TIMEOUT); own.abort(); }, ms);
    // A tool that ignores its signal must not keep the agent waiting on a client that has gone.
    if (own.signal.aborted) resolve(CANCELLED); else own.signal.addEventListener("abort", () => resolve(CANCELLED), { once: true });
  });
  try {
    // Through a promise chain, so a tool that throws before returning a promise is caught the same way as one that rejects.
    const result = await Promise.race([Promise.resolve().then(() => tool.run(args, { signal: own.signal })), cutOff]);
    if (result === TIMEOUT) return { error: `The tool timed out after ${Math.round(ms / 1000)} seconds.` };
    if (result === CANCELLED) return { error: "The request was cancelled." };
    return result;
  } catch (err) {
    report(`tool ${name}`, err);
    return { error: "The tool failed." };
  } finally {
    timers.clearTimeout(handle);
    signal.removeEventListener("abort", follow);
  }
}

/** Runs the conversation to its end. `history` is the user's and assistant's
 *  turns only (any other role is dropped here as well as at the route); the
 *  system prompt is added here and nowhere else. */
export async function* runAgent(llm: LlmClient, tools: AgentTool[], history: ChatMessage[], maxRounds = 6, opts: AgentOptions = {}): AsyncGenerator<AgentEvent> {
  const timers = opts.timers ?? realTimers;
  const toolTimeout = opts.toolTimeoutMs ?? TOOL_TIMEOUT_MS;
  const report = (context: string, err: unknown) => {
    try { opts.onError?.(context, err); } catch { /* a broken logger must not break the stream */ }
  };
  const byName = new Map(tools.map((t) => [t.spec.function.name, t]));
  const specs = tools.map((t) => t.spec);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    ...history.filter((m) => m.role === "user" || m.role === "assistant").map((m): ChatMessage => ({ role: m.role, content: m.content })),
  ];

  // One signal for everything in flight: it follows the caller's, and is
  // aborted when this generator finishes for any reason (including the
  // consumer returning), so nothing outlives it.
  const ac = new AbortController();
  const onCallerAbort = () => ac.abort();
  if (opts.signal?.aborted) ac.abort(); else opts.signal?.addEventListener("abort", onCallerAbort, { once: true });

  // The whole chat has a deadline, enforced through the same signal as a
  // disconnect: what differs is that the user is still there, so they are told.
  let timedOut = false;
  const deadline = timers.setTimeout(() => { timedOut = true; ac.abort(); }, opts.deadlineMs ?? CHAT_DEADLINE_MS);
  // Raced against the model call and the tools, so one that ignores its signal cannot hold the loop.
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    if (ac.signal.aborted) resolve(ABORTED); else ac.signal.addEventListener("abort", () => resolve(ABORTED), { once: true });
  });
  function* stopped(): Generator<AgentEvent> {
    if (!timedOut) return; // the client left: nobody to tell
    yield { type: "message", text: `${OUT_OF_TIME}: ${usedSummary()}.` };
    yield { type: "done" };
  }
  const used: string[] = [];
  let harnessCalls = 0;
  let totalCalls = 0;
  const usedSummary = () => {
    if (used.length === 0) return "I didn't get to run any lookups";
    const steps = used.length === 1 ? "1 lookup" : `${used.length} lookups`;
    return `I ran ${steps} (${[...new Set(used)].join(", ")}) but did not get to a final answer`;
  };
  try {
    for (let round = 0; round < maxRounds; round++) {
      if (ac.signal.aborted) { yield* stopped(); return; }

      let reply: ChatMessage;
      try {
        const got = await Promise.race([llm.chat(messages, { tools: specs, signal: ac.signal, maxTokens: CHAT_MAX_TOKENS }), aborted]);
        if (got === ABORTED) { yield* stopped(); return; }
        reply = got;
      } catch (err) {
        if (ac.signal.aborted) { yield* stopped(); return; } // the client left, or time ran out
        report("model call", err);
        yield { type: "error", text: err instanceof LlmError ? (err.kind === "rate_limited" && err.limitReached ? LIMIT_REACHED : LLM_SENTENCES[err.kind]) : GENERIC_FAILURE };
        yield { type: "done" };
        return;
      }
      if (ac.signal.aborted) { yield* stopped(); return; }

      const calls = usableCalls(reply.tool_calls);
      if (calls.length === 0) {
        const text = (reply.content ?? "").trim();
        if (!text) {
          // A model that spent its budget thinking: not an answer.
          yield { type: "error", text: LLM_SENTENCES.bad_response };
        } else {
          // A reply the provider stopped at its token limit is not a finished answer.
          yield { type: "message", text: reply.finish_reason === "length" ? `${text}${CUT_OFF}` : text };
        }
        yield { type: "done" };
        return;
      }

      // Prepare every call first: the assistant message that goes back to the
      // model must carry sanitised arguments and every id must be unique.
      const seen = new Set<string>();
      const prepared = calls.map((c, i) => {
        const name = safeName(c.function.name) || "unknown";
        const tool = byName.get(name);
        const parsed = parseArguments(c.function.arguments);
        const args = parsed.ok ? sanitiseArgs(parsed.value, tool?.spec.function.parameters) : {};
        const argsJson = JSON.stringify(args);
        let id = typeof c.id === "string" && c.id.length > 0 && c.id.length <= 64 ? c.id : `call_${round}_${i}`;
        if (seen.has(id)) id = `call_${round}_${i}`;
        seen.add(id);
        return { id, name, tool, args, argsJson, validArgs: parsed.ok };
      });
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: prepared.map((p) => ({ id: p.id, type: "function", function: { name: p.name, arguments: p.argsJson } })),
      });

      for (const [i, p] of prepared.entries()) {
        if (i >= MAX_TOOL_CALLS_PER_ROUND) {
          // Answered, not ignored: a provider rejects a history with an unanswered call id.
          messages.push({ role: "tool", tool_call_id: p.id, content: JSON.stringify({ error: `At most ${MAX_TOOL_CALLS_PER_ROUND} tool calls are run per step; this one was not run. Ask again in the next step if you still need it.` }) });
          continue;
        }
        yield { type: "tool", name: p.name, args: p.argsJson.length > MAX_SHOWN_ARGS ? `${p.argsJson.slice(0, MAX_SHOWN_ARGS - 1)}…` : p.argsJson };
        if (ac.signal.aborted) { yield* stopped(); return; }

        let result: unknown;
        if (!p.tool) result = { error: "unknown tool", name: p.name, available: [...byName.keys()].slice(0, 20) };
        else if (!p.validArgs) result = { error: "The tool arguments were not a valid JSON object." };
        else if (totalCalls >= MAX_TOOL_CALLS_PER_CHAT || (p.tool.budget === "harness" && harnessCalls >= MAX_HARNESS_CALLS_PER_CHAT)) result = BUDGET_EXHAUSTED;
        else {
          totalCalls++;
          if (p.tool.budget === "harness") harnessCalls++;
          used.push(p.name);
          result = await runTool(p.tool, p.args, p.name, ac.signal, toolTimeout, timers, report);
        }
        if (ac.signal.aborted) { yield* stopped(); return; }

        yield { type: "tool_result", name: p.name, summary: summarise(result) };
        messages.push({ role: "tool", tool_call_id: p.id, content: truncateResult(result) });
      }
    }

    // No seventh, paid-for model call: say plainly what happened, using only what was actually done.
    yield {
      type: "message",
      text: `I hit my step limit before finishing — here is what I found so far: ${usedSummary()}. Try a narrower question, for example one city, one business type and one release.`,
    };
    yield { type: "done" };
  } finally {
    timers.clearTimeout(deadline);
    opts.signal?.removeEventListener("abort", onCallerAbort);
    ac.abort();
  }
}

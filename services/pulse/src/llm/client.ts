// A small OpenAI-compatible chat client, pointed at Groq by default.
//
// Verified live against Groq on 2026-10-21 (a free-tier key, openai/gpt-oss-120b):
// chat tool calling works, `response_format: {type:"json_object"}` is accepted,
// and reasoning_effort=low verified live against openai/gpt-oss-120b on
// 2026-10-21 (HTTP 200, together with json_object). It is sent by default for
// openai/gpt-oss models (see config.groqReasoningEffort); a 400 that names it is
// retried once without it, the same pattern as the `response_format` fallback
// (a request can need both fallbacks, which is at most two retries). The
// default max_tokens is 4096 because reasoning tokens count toward the
// completion budget and a truncated answer reports finish_reason "length"
// (the campaign loop treats that as unusable); the chat passes a smaller
// `maxTokens` for its short answers. Not yet seen live: the `json_validate_failed`
// / `failed_generation` 400 Groq may answer a malformed JSON-mode generation with.
//
// Rate limits. The free tier allows 8,000 tokens per MINUTE and 1,000 requests
// per DAY, so every request goes through one process-wide single-flight queue
// (pacer.ts) and the client reads the `x-ratelimit-*` headers: it waits briefly
// (at most 20 s) for a token window to refill, retries a 429 up to twice using
// `retry-after`, and reports `rate_limited` at once when the wait would be longer
// (the daily limit). The waits happen inside chat(), so they count against the
// caller's own deadline and honour its AbortSignal.
//
// Errors are deliberately thin: a kind and a fixed sentence. The key, the
// request body and the upstream response body never appear in a message, a
// stack line or a `cause`, so an error is always safe to log.

import type { PulseConfig } from "../config.js";
import { LlmError, type LlmErrorKind } from "./errors.js";
import { estimateTokens, MAX_429_RETRIES, JITTER_MS, MAX_WAIT_MS, rateLimitWaitMs, sharedPacer, type Pacer } from "./pacer.js";

export { LlmError, type LlmErrorKind };

export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface ToolSpec { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** The provider's stop reason on a reply ("stop", "length", ...), when it sent one. */
  finish_reason?: string;
}
export interface LlmChatOptions {
  tools?: ToolSpec[];
  json?: boolean;
  /** Aborts the request (the chat agent passes the client's disconnect), so a
   *  reader who has gone does not keep a paid-for model call running. */
  signal?: AbortSignal;
  /** The completion budget for this request; the default (4096) suits the campaign writer. */
  maxTokens?: number;
}
export interface LlmClient {
  chat(messages: ChatMessage[], opts?: LlmChatOptions): Promise<ChatMessage>;
}

const FAILED_GENERATION = /json_validate_failed|failed_generation/i;
const TIMEOUT_MS = 20_000;
const TEMPERATURE = 0.4;
const MAX_TOKENS = 4096;

type GroqConfig = Pick<PulseConfig, "groqApiKey" | "groqBaseUrl" | "groqModel"> & Partial<Pick<PulseConfig, "groqReasoningEffort">>;

/** Joins text parts, for the providers that send `content` as an array. */
function contentText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
  }
  return null;
}

/** Reads the assistant message out of a chat-completions body. Fields it does
 *  not know (`reasoning`, `reasoning_content`, usage…) are ignored. A message
 *  with neither content nor tool calls (a model that spent its budget
 *  reasoning) comes back as an empty string so callers retry rather than fail. */
function parseMessage(body: unknown): ChatMessage {
  const choices = (body as { choices?: unknown } | null)?.choices;
  const choice = Array.isArray(choices) ? (choices[0] as { message?: unknown; finish_reason?: unknown } | undefined) : undefined;
  const message = choice?.message;
  const finish = typeof choice?.finish_reason === "string" ? { finish_reason: choice.finish_reason } : {};
  if (!message || typeof message !== "object") throw new LlmError("bad_response", "The model response had no message.");
  const m = message as { content?: unknown; tool_calls?: unknown };
  const toolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0 ? (m.tool_calls as ToolCall[]) : undefined;
  const text = contentText(m.content);
  if (toolCalls) return { role: "assistant", content: text, tool_calls: toolCalls, ...finish };
  return { role: "assistant", content: text ?? "", ...finish };
}

export function createGroqClient(cfg: GroqConfig, fetchImpl: typeof fetch = fetch, pacer: Pacer = sharedPacer): LlmClient {
  const key = cfg.groqApiKey;
  if (!key) throw new Error("GROQ_API_KEY is required to create the Groq client");

  /** One HTTP request, with the 429 handling: wait (at most MAX_WAIT_MS) and
   *  resend, up to MAX_429_RETRIES times. Runs inside the queue slot. */
  async function post(messages: ChatMessage[], opts: LlmChatOptions | undefined, withJsonFormat: boolean, withEffort: boolean): Promise<Response> {
    const maxTokens = opts?.maxTokens ?? MAX_TOKENS;
    const body: Record<string, unknown> = { model: cfg.groqModel, messages, temperature: TEMPERATURE, max_tokens: maxTokens };
    if (withEffort && cfg.groqReasoningEffort) body.reasoning_effort = cfg.groqReasoningEffort;
    if (withJsonFormat) body.response_format = { type: "json_object" };
    if (opts?.tools?.length) body.tools = opts.tools;
    const payload = JSON.stringify(body);
    const estimate = estimateTokens(payload.length, maxTokens);

    for (let attempt = 0; ; attempt++) {
      await pacer.beforeSend(estimate, opts?.signal);
      let res: Response;
      try {
        res = await fetchImpl(cfg.groqBaseUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: payload,
          signal: opts?.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        // The underlying error can carry the URL or headers, so none of it is kept.
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        throw new LlmError("unavailable", timedOut ? "The model request timed out." : "The model could not be reached.");
      }
      pacer.record(res.headers);
      if (res.status !== 429) return res;
      void res.body?.cancel().catch(() => {}); // free the connection; the body is not read
      const wait = rateLimitWaitMs(res.headers);
      if (wait !== null && wait > MAX_WAIT_MS) {
        // Too long to sit out (the daily limit): say so, so the caller does not promise "in a minute".
        throw new LlmError("rate_limited", "The model provider is rate limiting requests.", { limitReached: true });
      }
      if (wait === null || attempt >= MAX_429_RETRIES) {
        throw new LlmError("rate_limited", "The model provider is rate limiting requests.");
      }
      await pacer.sleep(wait + JITTER_MS, opts?.signal);
      // The 429's own headers (few tokens left, a reset further off than the wait)
      // describe the moment before this sleep; the retry must not sleep again for them.
      pacer.forget();
    }
  }

  async function exchange(messages: ChatMessage[], opts: LlmChatOptions | undefined): Promise<ChatMessage> {
    let json = opts?.json === true;
    let effort = Boolean(cfg.groqReasoningEffort);
    let res = await post(messages, opts, json, effort);
    // Some models refuse response_format or reasoning_effort; the 400 body says
    // so. Each is dropped (together, if one body names both) and the request
    // resent: at most two retries in all, never a loop.
    for (let retries = 0; res.status === 400 && retries < 2 && (json || effort); retries++) {
      const detail = await res.text().catch(() => "");
      // A malformed JSON-mode generation is a bad answer, not an unsupported
      // option: it is reported as bad_response for the caller to retry.
      if (json && FAILED_GENERATION.test(detail)) throw new LlmError("bad_response", "The model failed to produce valid JSON.");
      const dropJson = json && /response_format/i.test(detail);
      const dropEffort = effort && /reasoning_effort/i.test(detail);
      if (!dropJson && !dropEffort) { res = new Response(detail, { status: 400 }); break; }
      if (dropJson) json = false;
      if (dropEffort) effort = false;
      res = await post(messages, opts, json, effort);
    }
    if (res.status === 408 || res.status === 401 || res.status === 403 || res.status >= 500) {
      throw new LlmError("unavailable", `The model provider answered HTTP ${res.status}.`);
    }
    if (!res.ok) throw new LlmError("bad_response", `The model provider answered HTTP ${res.status}.`);
    let body: unknown;
    try { body = await res.json(); } catch { throw new LlmError("bad_response", "The model response was not JSON."); }
    return parseMessage(body);
  }

  return {
    // One request in flight per process, FIFO; see pacer.ts. Queue time and
    // rate-limit waits happen inside this call.
    chat: (messages, opts) => pacer.schedule(opts?.signal, () => exchange(messages, opts)),
  };
}

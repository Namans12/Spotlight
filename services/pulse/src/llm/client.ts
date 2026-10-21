// A small OpenAI-compatible chat client, pointed at Groq by default.
//
// UNVERIFIED AGAINST LIVE GROQ. The service was built with no Groq key, so
// everything here is written from the OpenAI chat-completions wire format that
// Groq documents as compatible and has only been exercised against a local
// fake server. Specifically unverified: that Groq accepts
// `response_format: {type:"json_object"}` for the configured model (the 400
// fallback below exists because some models refuse it), that `max_tokens`
// leaves room for the model's reasoning as well as its answer (it is 4096
// because reasoning tokens count toward the completion budget on Groq; a
// truncated answer reports finish_reason "length", which the campaign loop
// treats as unusable), the `json_validate_failed` / `failed_generation` 400
// Groq may answer a malformed JSON-mode generation with, and the status codes
// Groq uses for its free-tier limits. A possible tuning knob once a live key
// exists is `reasoning_effort`; it is not sent now because it is unverified.
//
// Errors are deliberately thin: a kind and a fixed sentence. The key, the
// request body and the upstream response body never appear in a message, a
// stack line or a `cause`, so an error is always safe to log.

import type { PulseConfig } from "../config.js";

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
export interface LlmClient {
  chat(messages: ChatMessage[], opts?: { tools?: ToolSpec[]; json?: boolean }): Promise<ChatMessage>;
}

export type LlmErrorKind = "rate_limited" | "unavailable" | "bad_response";

export class LlmError extends Error {
  constructor(readonly kind: LlmErrorKind, message: string) {
    super(message);
    this.name = "LlmError";
  }
}

const FAILED_GENERATION = /json_validate_failed|failed_generation/i;
const TIMEOUT_MS = 20_000;
const TEMPERATURE = 0.4;
const MAX_TOKENS = 4096;

type GroqConfig = Pick<PulseConfig, "groqApiKey" | "groqBaseUrl" | "groqModel">;

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

export function createGroqClient(cfg: GroqConfig, fetchImpl: typeof fetch = fetch): LlmClient {
  const key = cfg.groqApiKey;
  if (!key) throw new Error("GROQ_API_KEY is required to create the Groq client");

  async function post(messages: ChatMessage[], opts: { tools?: ToolSpec[]; json?: boolean } | undefined, withJsonFormat: boolean): Promise<Response> {
    const body: Record<string, unknown> = { model: cfg.groqModel, messages, temperature: TEMPERATURE, max_tokens: MAX_TOKENS };
    if (withJsonFormat) body.response_format = { type: "json_object" };
    if (opts?.tools?.length) body.tools = opts.tools;
    try {
      return await fetchImpl(cfg.groqBaseUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // The underlying error can carry the URL or headers, so none of it is kept.
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new LlmError("unavailable", timedOut ? "The model request timed out." : "The model could not be reached.");
    }
  }

  return {
    async chat(messages, opts) {
      let res = await post(messages, opts, opts?.json === true);
      if (res.status === 400 && opts?.json === true) {
        // Some models refuse response_format. Say-so is in the 400 body; one
        // retry without it, never more.
        const detail = await res.text().catch(() => "");
        // A malformed JSON-mode generation is a bad answer, not an unsupported
        // option: it is reported as bad_response for the caller to retry.
        if (FAILED_GENERATION.test(detail)) throw new LlmError("bad_response", "The model failed to produce valid JSON.");
        if (/response_format/i.test(detail)) res = await post(messages, opts, false);
      }
      if (res.status === 429) throw new LlmError("rate_limited", "The model provider is rate limiting requests.");
      if (res.status === 408 || res.status === 401 || res.status === 403 || res.status >= 500) {
        throw new LlmError("unavailable", `The model provider answered HTTP ${res.status}.`);
      }
      if (!res.ok) throw new LlmError("bad_response", `The model provider answered HTTP ${res.status}.`);
      let body: unknown;
      try { body = await res.json(); } catch { throw new LlmError("bad_response", "The model response was not JSON."); }
      return parseMessage(body);
    },
  };
}

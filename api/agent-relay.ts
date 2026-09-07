import type { IncomingMessage, ServerResponse } from "http";
import { isRateLimited } from "../lib/rateLimit.js";
import { RelayTargetError, resolveAzureUrl, resolveOpenAiUrl } from "../lib/relayTargets.js";

// Stateless CORS relay to an OpenAI-compatible Chat Completions API, so the
// in-page agent chat (src/webmcp/AgentChat.tsx) can run entirely client-side
// without us operating a "real" backend for it. Neither api.openai.com nor
// Azure's Cognitive Services endpoints set Access-Control-Allow-Origin for
// browser fetches — confirmed directly against both, each throws a plain
// "Failed to fetch" — so a same-origin relay is the only way to call either
// from a page's own JS.
//
// Supports two providers because that's what visitors actually showed up
// with while testing this: plain OpenAI (Authorization: Bearer, model in the
// body, URL fixed) and Azure OpenAI (api-key header, deployment name baked
// into the URL path, api-version as a query param, no model in the body).
//
// The visitor's own API key passes through this function's memory for the
// lifetime of one request and is never logged, stored, or forwarded anywhere
// but the provider they chose. There is no database write in this file.
// Don't add one, and don't add request/body logging — either would turn
// "relay" into "key collection."
//
// The destination is allowlisted (lib/relayTargets.ts) and the route is
// rate-limited. Both are load-bearing, not defence in depth: this endpoint
// takes a caller-supplied URL, attaches a caller-supplied credential, and
// hands the response body back under `Access-Control-Allow-Origin: *`. An
// unrestricted version of that is an open SSRF proxy running on this
// deployment's egress IP, callable by anyone, with no session required.

// A chat request carries a conversation plus tool schemas; a megabyte is
// already generous. The cap exists because this handler buffers the whole
// body in memory before doing anything with it, so without one a single
// caller can decide how much memory the function allocates.
const MAX_BODY_BYTES = 1_000_000;

// Below vercel.json's 15s maxDuration so this handler, not the platform, is
// what answers a hung provider.
const RELAY_TIMEOUT_MS = 13_000;

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendError(res: ServerResponse, status: number, error: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify({ error }));
}

interface RelayPayload {
  provider?: "openai" | "azure";
  apiKey?: string;
  model?: string;
  messages?: unknown;
  tools?: unknown;
  // "openai" provider only, optional: any Bearer-auth, OpenAI-wire-format
  // endpoint works here, not just api.openai.com — confirmed directly
  // against Groq's (https://api.groq.com/openai/v1/chat/completions),
  // whose response shape is identical down to tool_calls[].function.
  baseUrl?: string;
  // Azure-only:
  azureEndpoint?: string;
  azureDeployment?: string;
  azureApiVersion?: string;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return sendError(res, 405, "method not allowed");
  }

  // Relaying is the most expensive thing this deployment can be asked to do
  // (an outbound request per call, held open for the model's whole latency),
  // and it needs no session — so the IP bucket is the only thing standing
  // between one caller and using this function as free egress.
  if (isRateLimited(req)) {
    return sendError(res, 429, "too many requests");
  }

  let payload: RelayPayload;
  try {
    payload = JSON.parse((await readBody(req)) || "{}");
  } catch (err) {
    if (err instanceof BodyTooLarge) return sendError(res, 413, "request body too large");
    return sendError(res, 400, "body must be JSON");
  }

  const { provider = "openai", apiKey, model, messages, tools } = payload;
  if (!apiKey || typeof apiKey !== "string") {
    return sendError(res, 400, "apiKey is required (yours — see the chat panel's settings)");
  }
  if (!Array.isArray(messages)) {
    return sendError(res, 400, "messages must be an array");
  }
  if (provider !== "openai" && provider !== "azure") {
    return sendError(res, 400, 'provider must be "openai" or "azure"');
  }

  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;

  try {
    if (provider === "azure") {
      url = resolveAzureUrl(payload.azureEndpoint, payload.azureDeployment, payload.azureApiVersion);
      headers = { "Content-Type": "application/json", "api-key": apiKey };
      // Azure takes the model from the deployment in the URL, not the body.
      body = { messages, tools: tools ?? undefined };
    } else {
      url = resolveOpenAiUrl(payload.baseUrl);
      headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
      body = { model: model || "gpt-5.6-sol", messages, tools: tools ?? undefined };
    }
  } catch (err) {
    // RelayTargetError messages describe only what the caller sent, so they
    // are safe to echo; anything else is ours and stays generic.
    if (err instanceof RelayTargetError) return sendError(res, 400, err.message);
    return sendError(res, 400, "could not resolve a request target");
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // A chat-completions endpoint never legitimately redirects, and
      // following one would take the request — and the caller's key — to a
      // host the allowlist never approved. Treated as a failure instead.
      redirect: "manual",
      // vercel.json caps this function at 15s. Without a signal a hung
      // upstream rides it to the platform's own kill, which replaces this
      // handler's JSON error with an opaque platform page.
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
  } catch (err) {
    // The detail is the caller's own upstream failing, not ours, so it is
    // still safe to pass along — but it is a fetch-level message ("fetch
    // failed", "The operation was aborted"), never anything about this
    // deployment's internals.
    return sendError(res, 502, `could not reach ${provider}: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  if (upstream.type === "opaqueredirect" || (upstream.status >= 300 && upstream.status < 400)) {
    return sendError(res, 502, `${provider} redirected the request, which this relay does not follow`);
  }

  const text = await upstream.text();
  res.statusCode = upstream.status;
  res.setHeader("Content-Type", "application/json");
  return res.end(text);
}

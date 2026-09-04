import type { IncomingMessage, ServerResponse } from "http";

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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
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
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "method not allowed" }));
  }

  let payload: RelayPayload;
  try {
    payload = JSON.parse((await readBody(req)) || "{}");
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "body must be JSON" }));
  }

  const { provider = "openai", apiKey, model, messages, tools } = payload;
  if (!apiKey || typeof apiKey !== "string") {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "apiKey is required (yours — see the chat panel's settings)" }));
  }
  if (!Array.isArray(messages)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "messages must be an array" }));
  }

  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;

  if (provider === "azure") {
    const { azureEndpoint, azureDeployment, azureApiVersion } = payload;
    if (!azureEndpoint || !azureDeployment) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "azureEndpoint and azureDeployment are required for the Azure provider" }));
    }
    const base = azureEndpoint.replace(/\/+$/, "");
    const version = azureApiVersion || "2024-12-01-preview";
    url = `${base}/openai/deployments/${encodeURIComponent(azureDeployment)}/chat/completions?api-version=${encodeURIComponent(version)}`;
    headers = { "Content-Type": "application/json", "api-key": apiKey };
    // Azure takes the model from the deployment in the URL, not the body.
    body = { messages, tools: tools ?? undefined };
  } else {
    url = payload.baseUrl || "https://api.openai.com/v1/chat/completions";
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    body = { model: model || "gpt-5.6-sol", messages, tools: tools ?? undefined };
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: `could not reach ${provider}`, detail: err instanceof Error ? err.message : String(err) }));
  }

  const text = await upstream.text();
  res.statusCode = upstream.status;
  res.setHeader("Content-Type", "application/json");
  return res.end(text);
}

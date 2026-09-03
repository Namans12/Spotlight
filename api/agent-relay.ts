import type { IncomingMessage, ServerResponse } from "http";

// Stateless CORS relay to OpenAI's Chat Completions API, so the in-page
// agent chat (src/webmcp/AgentChat.tsx) can run entirely client-side without
// us operating a "real" backend for it. api.openai.com does not set
// Access-Control-Allow-Origin for browser fetches — confirmed directly,
// `fetch` from the live site throws a plain "Failed to fetch" — so a same-
// origin relay is the only way to call it from a page's own JS.
//
// The visitor's API key passes through this function's memory for the
// lifetime of one request and is never logged, stored, or forwarded
// anywhere but https://api.openai.com. There is no database write in this
// file. Don't add one, and don't add request/body logging — both would
// turn "relay" into "key collection."

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
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

  let payload: { apiKey?: string; model?: string; messages?: unknown; tools?: unknown };
  try {
    payload = JSON.parse((await readBody(req)) || "{}");
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "body must be JSON" }));
  }

  const { apiKey, model, messages, tools } = payload;
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

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "gpt-5.6-sol",
        messages,
        tools: tools ?? undefined,
      }),
    });
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "could not reach OpenAI", detail: err instanceof Error ? err.message : String(err) }));
  }

  const text = await upstream.text();
  res.statusCode = upstream.status;
  res.setHeader("Content-Type", "application/json");
  return res.end(text);
}

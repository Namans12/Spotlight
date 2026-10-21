import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { createGroqClient, LlmError } from "./client.js";

const cfg = { ...loadConfig({ DATABASE_URL: "postgres://x", GROQ_API_KEY: "sk-test-secret-key", GROQ_BASE_URL: "http://groq.test/v1/chat/completions", GROQ_MODEL: "m-1" }) };

const ok = (message: object) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
const text = (status: number, body: string) => new Response(body, { status });

function client(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r.clone();
  }) as unknown as typeof fetch;
  return { llm: createGroqClient(cfg, fetchImpl), calls };
}
const body = (c: { init: RequestInit }) => JSON.parse(String(c.init.body));
const MSGS = [{ role: "user" as const, content: "hi" }];

describe("createGroqClient request", () => {
  it("posts the OpenAI wire format to the configured URL with a bearer key and a timeout signal", async () => {
    const { llm, calls } = client([ok({ role: "assistant", content: "hello" })]);
    const reply = await llm.chat(MSGS);
    expect(reply).toEqual({ role: "assistant", content: "hello" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://groq.test/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer sk-test-secret-key");
    expect(h["Content-Type"]).toBe("application/json");
    expect(body(calls[0])).toEqual({ model: "m-1", messages: MSGS, temperature: 0.4, max_tokens: 1400 });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends response_format json_object for json:true and passes tools through", async () => {
    const tools = [{ type: "function" as const, function: { name: "t", description: "d", parameters: { type: "object" } } }];
    const { llm, calls } = client([ok({ role: "assistant", content: "{}" })]);
    await llm.chat(MSGS, { json: true, tools });
    expect(body(calls[0])).toMatchObject({ response_format: { type: "json_object" }, tools });
  });

  it("omits response_format and tools when not asked for", async () => {
    const { llm, calls } = client([ok({ role: "assistant", content: "x" })]);
    await llm.chat(MSGS, {});
    expect(body(calls[0])).not.toHaveProperty("response_format");
    expect(body(calls[0])).not.toHaveProperty("tools");
  });
});

describe("response_format fallback", () => {
  it("retries once without response_format after a 400 that mentions it", async () => {
    const { llm, calls } = client([text(400, '{"error":{"message":"response_format is not supported"}}'), ok({ role: "assistant", content: "{}" })]);
    const reply = await llm.chat(MSGS, { json: true });
    expect(reply.content).toBe("{}");
    expect(calls).toHaveLength(2);
    expect(body(calls[0])).toHaveProperty("response_format");
    expect(body(calls[1])).not.toHaveProperty("response_format");
  });

  it("does not retry a 400 that does not mention it, and never retries more than once", async () => {
    const a = client([text(400, '{"error":"bad model"}')]);
    await expect(a.llm.chat(MSGS, { json: true })).rejects.toMatchObject({ kind: "bad_response" });
    expect(a.calls).toHaveLength(1);
    const b = client([text(400, "response_format nope")]);
    await expect(b.llm.chat(MSGS, { json: true })).rejects.toMatchObject({ kind: "bad_response" });
    expect(b.calls).toHaveLength(2);
  });

  it("does not retry a 400 when json was not requested", async () => {
    const { llm, calls } = client([text(400, "response_format")]);
    await expect(llm.chat(MSGS)).rejects.toBeInstanceOf(LlmError);
    expect(calls).toHaveLength(1);
  });
});

describe("failures map to typed LlmErrors", () => {
  it("429 is rate_limited", async () => {
    await expect(client([text(429, "slow down")]).llm.chat(MSGS)).rejects.toMatchObject({ name: "LlmError", kind: "rate_limited" });
  });
  it.each([500, 502, 503, 408])("%i is unavailable", async (status) => {
    await expect(client([text(status, "x")]).llm.chat(MSGS)).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("401 and 403 are unavailable (a bad key is an outage to the caller)", async () => {
    await expect(client([text(401, "x")]).llm.chat(MSGS)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(client([text(403, "x")]).llm.chat(MSGS)).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("a timeout or network failure is unavailable", async () => {
    await expect(client([new DOMException("timed out", "TimeoutError")]).llm.chat(MSGS)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(client([new TypeError("fetch failed")]).llm.chat(MSGS)).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("a 200 that is not JSON, or has no choices, is bad_response", async () => {
    await expect(client([text(200, "<html>")]).llm.chat(MSGS)).rejects.toMatchObject({ kind: "bad_response" });
    await expect(client([text(200, "{}")]).llm.chat(MSGS)).rejects.toMatchObject({ kind: "bad_response" });
    await expect(client([text(200, '{"choices":[]}')]).llm.chat(MSGS)).rejects.toMatchObject({ kind: "bad_response" });
    await expect(client([text(200, '{"choices":[{}]}')]).llm.chat(MSGS)).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("never puts the key, the prompt or the upstream body in an error message", async () => {
    const secretPrompt = [{ role: "user" as const, content: "PROMPT-SECRET-TEXT" }];
    const cases: (Response | Error)[] = [
      text(429, "echo sk-test-secret-key PROMPT-SECRET-TEXT"),
      text(500, "echo sk-test-secret-key PROMPT-SECRET-TEXT"),
      text(400, "response_format echo sk-test-secret-key PROMPT-SECRET-TEXT"),
      text(200, "sk-test-secret-key PROMPT-SECRET-TEXT"),
      new TypeError("fetch failed for Bearer sk-test-secret-key"),
    ];
    for (const c of cases) {
      const err = await client([c]).llm.chat(secretPrompt, { json: true }).then(() => null, (e: unknown) => e as Error);
      expect(err).toBeInstanceOf(LlmError);
      expect(JSON.stringify([err!.message, err!.stack?.split("\n")[0]])).not.toMatch(/sk-test-secret-key|PROMPT-SECRET-TEXT/);
      expect(err!.cause).toBeUndefined();
    }
  });
});

describe("response parsing is tolerant", () => {
  it("ignores reasoning fields", async () => {
    const { llm } = client([ok({ role: "assistant", content: "answer", reasoning: "thinking...", reasoning_content: "more" })]);
    expect(await llm.chat(MSGS)).toEqual({ role: "assistant", content: "answer" });
  });
  it("accepts content: null with tool_calls", async () => {
    const tool_calls = [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }];
    const { llm } = client([ok({ role: "assistant", content: null, tool_calls })]);
    expect(await llm.chat(MSGS)).toEqual({ role: "assistant", content: null, tool_calls });
  });
  it("returns an empty string when content is missing and there are no tool calls, so callers can retry", async () => {
    const { llm } = client([ok({ role: "assistant", reasoning: "only thinking" })]);
    expect(await llm.chat(MSGS)).toEqual({ role: "assistant", content: "" });
  });
  it("joins content delivered as text parts", async () => {
    const { llm } = client([ok({ role: "assistant", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })]);
    expect((await llm.chat(MSGS)).content).toBe("ab");
  });
});

describe("createGroqClient construction", () => {
  it("refuses to build without a key", () => {
    expect(() => createGroqClient(loadConfig({ DATABASE_URL: "postgres://x" }))).toThrow(/GROQ_API_KEY/);
  });
});

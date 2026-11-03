import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { createGroqClient, LlmError } from "./client.js";
import { createPacer } from "./pacer.js";

const cfg = { ...loadConfig({ DATABASE_URL: "postgres://x", GROQ_API_KEY: "sk-test-secret-key", GROQ_BASE_URL: "http://groq.test/v1/chat/completions", GROQ_MODEL: "m-1" }) };
const gptOss = loadConfig({ DATABASE_URL: "postgres://x", GROQ_API_KEY: "sk-test-secret-key", GROQ_BASE_URL: "http://groq.test/v1/chat/completions" }); // openai/gpt-oss-120b: reasoning_effort low

const ok = (message: object) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
const text = (status: number, body: string) => new Response(body, { status });

/** A clock the tests own: sleeping advances it and is recorded, never waited for. */
function fakeClock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleeps,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw new LlmError("unavailable", "cancelled");
      sleeps.push(ms);
      t += ms;
    },
  };
}

function client(responses: (Response | Error)[], config: Parameters<typeof createGroqClient>[0] = cfg) {
  const clock = fakeClock();
  const pacer = createPacer({ now: clock.now, sleep: clock.sleep });
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r.clone();
  }) as unknown as typeof fetch;
  return { llm: createGroqClient(config, fetchImpl, pacer), calls, clock, pacer };
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
    expect(body(calls[0])).toEqual({ model: "m-1", messages: MSGS, temperature: 0.4, max_tokens: 4096 });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends response_format json_object for json:true and passes tools through", async () => {
    const tools = [{ type: "function" as const, function: { name: "t", description: "d", parameters: { type: "object" } } }];
    const { llm, calls } = client([ok({ role: "assistant", content: "{}" })]);
    await llm.chat(MSGS, { json: true, tools });
    expect(body(calls[0])).toMatchObject({ response_format: { type: "json_object" }, tools });
  });

  it("the signal sent follows a caller's abort (a client that has left must not keep a model call running), as well as the timeout", async () => {
    const { llm, calls } = client([ok({ role: "assistant", content: "x" })]);
    const ac = new AbortController();
    await llm.chat(MSGS, { signal: ac.signal });
    const sent = calls[0].init.signal as AbortSignal;
    expect(sent).not.toBe(ac.signal); // combined with the timeout
    expect(sent.aborted).toBe(false);
    ac.abort();
    expect(sent.aborted).toBe(true);
  });

  it("omits response_format and tools when not asked for", async () => {
    const { llm, calls } = client([ok({ role: "assistant", content: "x" })]);
    await llm.chat(MSGS, {});
    expect(body(calls[0])).not.toHaveProperty("response_format");
    expect(body(calls[0])).not.toHaveProperty("tools");
  });
});

describe("max_tokens", () => {
  it("defaults to 4096 (the campaign writer) and a caller can lower it (the chat sends 1200)", async () => {
    const { llm, calls } = client([ok({ role: "assistant", content: "x" })]);
    await llm.chat(MSGS);
    await llm.chat(MSGS, { maxTokens: 1200 });
    expect(body(calls[0]).max_tokens).toBe(4096);
    expect(body(calls[1]).max_tokens).toBe(1200);
  });
});

// reasoning_effort=low verified live against openai/gpt-oss-120b on 2026-10-21.
describe("reasoning_effort", () => {
  it("is sent when the config has one, and not otherwise", async () => {
    const on = client([ok({ role: "assistant", content: "x" })], gptOss);
    await on.llm.chat(MSGS, { json: true });
    expect(body(on.calls[0])).toMatchObject({ model: "openai/gpt-oss-120b", reasoning_effort: "low", response_format: { type: "json_object" } });
    const off = client([ok({ role: "assistant", content: "x" })]);
    await off.llm.chat(MSGS);
    expect(body(off.calls[0])).not.toHaveProperty("reasoning_effort");
  });

  it("retries once without it after a 400 that mentions reasoning_effort, keeping everything else", async () => {
    const { llm, calls } = client([text(400, '{"error":{"message":"reasoning_effort is not supported with this model"}}'), ok({ role: "assistant", content: "hi" })], gptOss);
    expect((await llm.chat(MSGS)).content).toBe("hi");
    expect(calls).toHaveLength(2);
    expect(body(calls[0])).toHaveProperty("reasoning_effort");
    expect(body(calls[1])).not.toHaveProperty("reasoning_effort");
    expect(body(calls[1])).toMatchObject({ model: "openai/gpt-oss-120b", messages: MSGS, max_tokens: 4096 });
  });

  it("a request that needs both fallbacks gets both, in at most two retries", async () => {
    const { llm, calls } = client([text(400, "response_format is not supported"), text(400, "reasoning_effort is not supported"), ok({ role: "assistant", content: "{}" })], gptOss);
    expect((await llm.chat(MSGS, { json: true })).content).toBe("{}");
    expect(calls).toHaveLength(3);
    expect(body(calls[0])).toHaveProperty("response_format");
    expect(body(calls[1])).not.toHaveProperty("response_format");
    expect(body(calls[1])).toHaveProperty("reasoning_effort");
    expect(body(calls[2])).not.toHaveProperty("response_format");
    expect(body(calls[2])).not.toHaveProperty("reasoning_effort");
  });

  it("in either order, and one 400 that names both costs a single retry", async () => {
    const reversed = client([text(400, "reasoning_effort bad"), text(400, "response_format bad"), ok({ role: "assistant", content: "{}" })], gptOss);
    await reversed.llm.chat(MSGS, { json: true });
    expect(reversed.calls).toHaveLength(3);
    const both = client([text(400, "response_format and reasoning_effort are both unsupported"), ok({ role: "assistant", content: "{}" })], gptOss);
    await both.llm.chat(MSGS, { json: true });
    expect(both.calls).toHaveLength(2);
    expect(body(both.calls[1])).not.toHaveProperty("response_format");
    expect(body(both.calls[1])).not.toHaveProperty("reasoning_effort");
  });

  it("never loops: every 400 still naming them ends after three requests as bad_response", async () => {
    const { llm, calls } = client([text(400, "response_format reasoning_effort")], gptOss);
    await expect(llm.chat(MSGS, { json: true })).rejects.toMatchObject({ kind: "bad_response" });
    expect(calls.length).toBeLessThanOrEqual(3);
    const solo = client([text(400, "reasoning_effort")], gptOss);
    await expect(solo.llm.chat(MSGS)).rejects.toMatchObject({ kind: "bad_response" });
    expect(solo.calls).toHaveLength(2);
  });

  it("does not retry a 400 that mentions it when none was sent", async () => {
    const { llm, calls } = client([text(400, "reasoning_effort")]);
    await expect(llm.chat(MSGS)).rejects.toBeInstanceOf(LlmError);
    expect(calls).toHaveLength(1);
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

  it("a 400 for a failed JSON generation is bad_response and is not retried without response_format", async () => {
    for (const detail of ['{"error":{"message":"Failed to generate JSON.","code":"json_validate_failed","failed_generation":"{\\"ideas\\":"}}', "failed_generation response_format"]) {
      const { llm, calls } = client([text(400, detail)]);
      await expect(llm.chat(MSGS, { json: true })).rejects.toMatchObject({ kind: "bad_response" });
      expect(calls).toHaveLength(1);
    }
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

describe("rate limits", () => {
  const limited = (headers: Record<string, string>) => new Response("echo sk-test-secret-key PROMPT-SECRET-TEXT", { status: 429, headers });
  const okBody = () => ok({ role: "assistant", content: "done" });

  it("a 429 with retry-after waits that long plus 250 ms, then retries and succeeds", async () => {
    const { llm, calls, clock } = client([limited({ "retry-after": "2" }), okBody()]);
    expect((await llm.chat(MSGS)).content).toBe("done");
    expect(calls).toHaveLength(2);
    expect(clock.sleeps).toEqual([2250]);
  });

  it("without retry-after it uses reset-tokens", async () => {
    const { llm, clock } = client([limited({ "x-ratelimit-reset-tokens": "1.38s", "x-ratelimit-reset-requests": "4m19.2s" }), okBody()]);
    await llm.chat(MSGS);
    expect(clock.sleeps).toEqual([1630]);
  });

  it("two 429s then success: two waits, three requests", async () => {
    const { llm, calls, clock } = client([limited({ "retry-after": "1" }), limited({ "x-ratelimit-reset-tokens": "250ms" }), okBody()]);
    expect((await llm.chat(MSGS)).content).toBe("done");
    expect(calls).toHaveLength(3);
    expect(clock.sleeps).toEqual([1250, 500]);
  });

  it("a third 429 is rate_limited, after exactly two waits", async () => {
    const { llm, calls, clock } = client([limited({ "retry-after": "1" })]);
    await expect(llm.chat(MSGS)).rejects.toMatchObject({ name: "LlmError", kind: "rate_limited" });
    expect(calls).toHaveLength(3);
    expect(clock.sleeps).toHaveLength(2);
  });

  it("a wait over 20 s is rate_limited at once, with no sleep and no retry (the daily limit)", async () => {
    const daily = client([limited({ "x-ratelimit-reset-requests": "4m19.2s", "x-ratelimit-reset-tokens": "1s", "x-ratelimit-remaining-requests": "0" }), okBody()]);
    await expect(daily.llm.chat(MSGS)).rejects.toMatchObject({ kind: "rate_limited" });
    expect(daily.calls).toHaveLength(1);
    expect(daily.clock.sleeps).toEqual([]);
    const after = client([limited({ "retry-after": "259" }), okBody()]);
    await expect(after.llm.chat(MSGS)).rejects.toMatchObject({ kind: "rate_limited" });
    expect(after.clock.sleeps).toEqual([]);
    const edge = client([limited({ "retry-after": "20" }), okBody()]);
    expect((await edge.llm.chat(MSGS)).content).toBe("done"); // exactly 20 s is still waited for
    expect(edge.clock.sleeps).toEqual([20_250]);
  });

  it("after sleeping out a 429 it does not sleep a second time for the same shortfall", async () => {
    // The 429's own headers report few tokens left and a reset further off than retry-after; the retry must just go.
    const { llm, calls, clock } = client([limited({ "retry-after": "1", "x-ratelimit-remaining-tokens": "100", "x-ratelimit-reset-tokens": "5s", "x-ratelimit-limit-tokens": "8000" }), okBody()]);
    expect((await llm.chat(MSGS)).content).toBe("done");
    expect(calls).toHaveLength(2);
    expect(clock.sleeps).toEqual([1250]);
  });

  it("a wait over 20 s marks the error limitReached (the daily limit); a short-wait exhaustion does not", async () => {
    const daily = await client([limited({ "retry-after": "259" })]).llm.chat(MSGS).then(() => null, (e: unknown) => e as LlmError);
    expect(daily).toMatchObject({ kind: "rate_limited", limitReached: true });
    const exhausted = await client([limited({ "retry-after": "1" })]).llm.chat(MSGS).then(() => null, (e: unknown) => e as LlmError);
    expect(exhausted).toMatchObject({ kind: "rate_limited", limitReached: false });
    const silent = await client([limited({})]).llm.chat(MSGS).then(() => null, (e: unknown) => e as LlmError);
    expect(silent).toMatchObject({ kind: "rate_limited", limitReached: false });
  });

  it("a 429 that says nothing about when to retry is rate_limited at once", async () => {
    const { llm, calls, clock } = client([limited({})]);
    await expect(llm.chat(MSGS)).rejects.toMatchObject({ kind: "rate_limited" });
    expect(calls).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("a 429 while a fallback is in play still waits and retries the same body", async () => {
    const { llm, calls } = client([text(400, "reasoning_effort"), limited({ "retry-after": "1" }), okBody()], gptOss);
    await llm.chat(MSGS);
    expect(calls).toHaveLength(3);
    expect(body(calls[2])).toEqual(body(calls[1]));
  });

  it("never puts the key, the prompt or the upstream body in a rate-limit error", async () => {
    for (const headers of [{}, { "retry-after": "999" }, { "retry-after": "1" }]) {
      const err = await client([limited(headers)]).llm.chat([{ role: "user", content: "PROMPT-SECRET-TEXT" }]).then(() => null, (e: unknown) => e as Error);
      expect(err).toBeInstanceOf(LlmError);
      expect(JSON.stringify([err!.message, err!.stack?.split("\n")[0]])).not.toMatch(/sk-test-secret-key|PROMPT-SECRET-TEXT/);
      expect(err!.cause).toBeUndefined();
    }
  });
});

describe("proactive pacing in the client", () => {
  const withRoom = (remaining: number, reset: string) => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "x" } }] }), {
    status: 200,
    headers: { "x-ratelimit-remaining-tokens": String(remaining), "x-ratelimit-reset-tokens": reset },
  });
  const BIG = [{ role: "user" as const, content: "w".repeat(7200) }]; // ~2,400 tokens (3 characters a token) + the completion allowance

  it("waits for the reset before sending when the last remaining count was below the estimate", async () => {
    const { llm, calls, clock } = client([withRoom(300, "4s"), withRoom(7000, "1s")]);
    await llm.chat(MSGS);
    expect(clock.sleeps).toEqual([]); // nothing reported yet
    await llm.chat(BIG);
    expect(clock.sleeps).toEqual([4000]);
    expect(calls).toHaveLength(2);
  });

  it("does not wait when the remaining count covers the estimate", async () => {
    const { llm, clock } = client([withRoom(7000, "1s")]);
    await llm.chat(MSGS);
    await llm.chat(BIG);
    expect(clock.sleeps).toEqual([]);
  });

  it("does not wait when the reset is more than 20 s away", async () => {
    const { llm, clock } = client([withRoom(300, "45s")]);
    await llm.chat(MSGS);
    await llm.chat(BIG);
    expect(clock.sleeps).toEqual([]);
  });

  it("an abort during the wait rejects and sends nothing", async () => {
    let release!: () => void;
    const clock = fakeClock();
    const pacer = createPacer({
      now: clock.now,
      sleep: (_ms, signal) => new Promise<void>((resolve, reject) => {
        release = resolve;
        signal?.addEventListener("abort", () => reject(new LlmError("unavailable", "cancelled")), { once: true });
      }),
    });
    const calls: number[] = [];
    const fetchImpl = (async () => { calls.push(1); return withRoom(300, "5s").clone(); }) as unknown as typeof fetch;
    const llm = createGroqClient(cfg, fetchImpl, pacer);
    await llm.chat(MSGS); // reports 300 remaining, 5 s reset
    const ac = new AbortController();
    const pending = llm.chat(BIG, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    await expect(pending).rejects.toBeInstanceOf(LlmError);
    expect(calls).toHaveLength(1);
    void release;
  });
});

describe("the queue, through the client", () => {
  function gated() {
    const gates: (() => void)[] = [];
    const started: number[] = [];
    const fetchImpl = (async () => {
      started.push(started.length + 1);
      await new Promise<void>((r) => gates.push(r));
      return ok({ role: "assistant", content: "x" });
    }) as unknown as typeof fetch;
    const pacer = createPacer({ ...fakeClock() });
    return { llm: createGroqClient(cfg, fetchImpl, pacer), gates, started, pacer };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("two concurrent chats are serialised: the second request starts only after the first finishes", async () => {
    const { llm, gates, started } = gated();
    const one = llm.chat(MSGS);
    const two = llm.chat(MSGS);
    await tick();
    expect(started).toEqual([1]);
    gates[0]();
    await one;
    await tick();
    expect(started).toEqual([1, 2]);
    gates[1]();
    await two;
  });

  it("the 13th waiting request is rejected at once as rate_limited", async () => {
    const { llm, gates, started } = gated();
    const calls = Array.from({ length: 13 }, () => llm.chat(MSGS)); // 1 in flight + 12 waiting
    const extra = llm.chat([{ role: "user", content: "PROMPT-SECRET-TEXT" }]);
    const err = await extra.then(() => null, (e: unknown) => e as Error);
    expect(err).toMatchObject({ name: "LlmError", kind: "rate_limited" });
    expect(JSON.stringify([err!.message, err!.stack?.split("\n")[0]])).not.toMatch(/sk-test-secret-key|PROMPT-SECRET-TEXT/);
    expect(started).toEqual([1]);
    for (let i = 0; i < 13; i++) { await tick(); gates[i](); }
    await Promise.all(calls);
  });

  it("an abort while queued rejects at once, and the place can be used again", async () => {
    const { llm, gates, pacer } = gated();
    const first = llm.chat(MSGS);
    const ac = new AbortController();
    const queued = llm.chat(MSGS, { signal: ac.signal });
    await tick();
    expect(pacer.waiting()).toBe(1);
    ac.abort();
    await expect(queued).rejects.toBeInstanceOf(LlmError);
    expect(pacer.waiting()).toBe(0);
    gates[0]();
    await first;
  });

  it("an abort while waiting out a 429 rejects promptly and frees the slot", async () => {
    const clock = fakeClock();
    const pacer = createPacer({
      now: clock.now,
      sleep: (_ms, signal) => new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new LlmError("unavailable", "cancelled")), { once: true });
      }),
    });
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return n === 1 ? new Response("x", { status: 429, headers: { "retry-after": "5" } }) : ok({ role: "assistant", content: "next" });
    }) as unknown as typeof fetch;
    const llm = createGroqClient(cfg, fetchImpl, pacer);
    const ac = new AbortController();
    const waiting = llm.chat(MSGS, { signal: ac.signal });
    const behind = llm.chat(MSGS);
    await tick();
    ac.abort();
    await expect(waiting).rejects.toBeInstanceOf(LlmError);
    expect((await behind).content).toBe("next");
    expect(n).toBe(2);
  });
});

describe("finish_reason", () => {
  it("is surfaced on the returned message when the provider sends one", async () => {
    const res = new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "{\"ideas\":" }, finish_reason: "length" }] }), { status: 200 });
    expect(await client([res]).llm.chat(MSGS)).toEqual({ role: "assistant", content: "{\"ideas\":", finish_reason: "length" });
    const stop = new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "x" }, finish_reason: "stop" }] }), { status: 200 });
    expect((await client([stop]).llm.chat(MSGS)).finish_reason).toBe("stop");
  });
  it("is left off when absent", async () => {
    expect(await client([ok({ role: "assistant", content: "x" })]).llm.chat(MSGS)).not.toHaveProperty("finish_reason");
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

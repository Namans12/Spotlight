import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../../../shared/types/pulse.js";
import { LlmError, type ChatMessage } from "../llm/client.js";
import { assistant, call, collect, fakeTool, manualTimers, toolCallMsg, user, type FakeTool } from "../testing/agent.js";
import { fakeLlm } from "../testing/llm.js";
import { CHAT_DEADLINE_MS, MAX_HARNESS_CALLS_PER_CHAT, MAX_TOOL_CALLS_PER_CHAT, runAgent } from "./loop.js";
import type { AgentTool } from "./tools.js";

const text = (content: string): ChatMessage => assistant(content);
const board = { type: "object", properties: { city: { type: "string" }, business_type: { type: "string" } }, additionalProperties: false };

describe("runAgent", () => {
  it("runs a tool call and returns the final message", async () => {
    const llm = fakeLlm([toolCallMsg(call("pulse_board", { city: "delhi", business_type: "cafe" })), text("Theme it around X.")]);
    const ev = await collect(runAgent(llm, [fakeTool("pulse_board", { ranked: [] }, board)], [user("what should my Delhi café do?")]));
    expect(ev.map((e) => e.type)).toEqual(["tool", "tool_result", "message", "done"]);
    expect(ev[0]).toEqual({ type: "tool", name: "pulse_board", args: '{"city":"delhi","business_type":"cafe"}' });
    expect(ev[1]).toMatchObject({ type: "tool_result", name: "pulse_board", summary: "ranked[0]" });
    expect(ev[2]).toEqual({ type: "message", text: "Theme it around X." });
  });

  it("puts the system prompt first, offers the tools, and sends the tool result back with its call id", async () => {
    const llm = fakeLlm([toolCallMsg(call("pulse_board", { city: "delhi" }, "abc123")), text("Done.")]);
    const tool = fakeTool("pulse_board", { ranked: [{ title: "Fake" }] }, board);
    await collect(runAgent(llm, [tool], [user("hi")]));
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[0][0].role).toBe("system");
    expect(llm.calls[0].slice(1)).toEqual([user("hi")]);
    expect(llm.opts[0]?.tools).toEqual([tool.spec]);
    const second = llm.calls[1];
    expect(second.at(-2)).toMatchObject({ role: "assistant", content: null, tool_calls: [{ id: "abc123", type: "function", function: { name: "pulse_board", arguments: '{"city":"delhi"}' } }] });
    expect(second.at(-1)).toEqual({ role: "tool", tool_call_id: "abc123", content: '{"ranked":[{"title":"Fake"}]}' });
  });

  it("never lets the history carry a system message of its own into the model's first message slot", async () => {
    const llm = fakeLlm([text("ok")]);
    await collect(runAgent(llm, [], [user("hi")]));
    expect(llm.calls[0].filter((m) => m.role === "system")).toHaveLength(1);
  });

  describe("tool arguments are sanitised before use", () => {
    it("drops unknown keys, cuts long strings, and shows the user the sanitised JSON", async () => {
      const llm = fakeLlm([toolCallMsg(call("pulse_board", { city: "x".repeat(400), business_type: "cafe", sql: "DROP TABLE x" })), text("ok")]);
      const tool = fakeTool("pulse_board", {}, board);
      const ev = await collect(runAgent(llm, [tool], [user("hi")]));
      expect(tool.calls[0]).toEqual({ city: "x".repeat(120), business_type: "cafe" });
      const shown = (ev[0] as Extract<AgentEvent, { type: "tool" }>).args;
      expect(shown.length).toBeLessThanOrEqual(300);
      expect(shown).not.toContain("DROP");
      // The history the model sees next carries the sanitised arguments too.
      expect(JSON.stringify(llm.calls[1])).not.toContain("DROP");
    });

    it("cuts the args shown to the user at 300 characters", async () => {
      const llm = fakeLlm([toolCallMsg(call("t", { a: Array.from({ length: 10 }, () => "z".repeat(120)) })), text("ok")]);
      const ev = await collect(runAgent(llm, [fakeTool("t", {})], [user("hi")]));
      expect((ev[0] as { args: string }).args.length).toBeLessThanOrEqual(300);
    });

    it("does not run a tool whose arguments are not a JSON object, and says so to the model", async () => {
      const llm = fakeLlm([toolCallMsg(call("pulse_board", "{not json", "c1")), text("sorry")]);
      const tool = fakeTool("pulse_board", {});
      const ev = await collect(runAgent(llm, [tool], [user("hi")]));
      expect(tool.calls).toHaveLength(0);
      expect(llm.calls[1].at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });
      expect(JSON.parse(llm.calls[1].at(-1)!.content!)).toEqual({ error: "The tool arguments were not a valid JSON object." });
      expect(ev.map((e) => e.type)).toEqual(["tool", "tool_result", "message", "done"]);
    });
  });

  it("truncates a big tool result before it goes back to the model", async () => {
    const llm = fakeLlm([toolCallMsg(call("t")), text("ok")]);
    const tool = fakeTool("t", { rows: Array.from({ length: 5000 }, (_, i) => `row number ${i}`) });
    await collect(runAgent(llm, [tool], [user("hi")]));
    const content = llm.calls[1].at(-1)!.content!;
    expect(content.length).toBeLessThanOrEqual(2800);
    expect(content).toContain("…truncated");
  });

  it("shows the user a summary of at most 200 characters", async () => {
    const llm = fakeLlm([toolCallMsg(call("t")), text("ok")]);
    const ev = await collect(runAgent(llm, [fakeTool("t", { summary: "s".repeat(900) })], [user("hi")]));
    expect((ev[1] as { summary: string }).summary).toHaveLength(200);
  });

  it("stops after 6 rounds with an honest message", async () => {
    const llm = fakeLlm([toolCallMsg(call("pulse_board", {}))]);
    const tool = fakeTool("pulse_board", {});
    const ev = await collect(runAgent(llm, [tool], [user("loop")]));
    expect(ev.filter((e) => e.type === "tool")).toHaveLength(6);
    expect(llm.calls).toHaveLength(6); // no seventh, paid-for call
    expect(ev.at(-2)).toMatchObject({ type: "message", text: expect.stringContaining("step limit") });
    expect(ev.at(-1)).toEqual({ type: "done" });
  });

  it("the step-limit message reads naturally with zero lookups, and with some", async () => {
    const none = await collect(runAgent(fakeLlm([text("never")]), [], [user("hi")], 0));
    const noneText = (none.at(-2) as { text: string }).text;
    expect(noneText).toContain("step limit");
    expect(noneText).toContain("I didn't get to run any lookups");
    expect(noneText).not.toMatch(/I ran 0 lookups|\(none\)/);
    const some = await collect(runAgent(fakeLlm([toolCallMsg(call("pulse_board", {}))]), [fakeTool("pulse_board", {})], [user("loop")], 2));
    const someText = (some.at(-2) as { text: string }).text;
    expect(someText).toContain("step limit");
    expect(someText).toContain("I ran 2 lookups (pulse_board) but did not get to a final answer");
  });

  it("honours a different round limit", async () => {
    const llm = fakeLlm([toolCallMsg(call("pulse_board", {}))]);
    const ev = await collect(runAgent(llm, [fakeTool("pulse_board", {})], [user("loop")], 2));
    expect(ev.filter((e) => e.type === "tool")).toHaveLength(2);
    expect(ev.at(-2)).toMatchObject({ type: "message", text: expect.stringContaining("step limit") });
  });

  it("an unknown tool name becomes a tool error the model can recover from, not a crash", async () => {
    const llm = fakeLlm([toolCallMsg(call("drop_database", { x: 1 }, "u1")), toolCallMsg(call("pulse_board", {}, "u2")), text("Recovered.")]);
    const real = fakeTool("pulse_board", { ranked: [] });
    const ev = await collect(runAgent(llm, [real], [user("hi")]));
    expect(ev.map((e) => e.type)).toEqual(["tool", "tool_result", "tool", "tool_result", "message", "done"]);
    expect(ev[1]).toMatchObject({ type: "tool_result", name: "drop_database", summary: expect.stringContaining("unknown tool") });
    const msg = JSON.parse(llm.calls[1].at(-1)!.content!);
    expect(msg).toMatchObject({ error: "unknown tool", available: ["pulse_board"] });
    expect(llm.calls[1].at(-1)!.tool_call_id).toBe("u1");
    expect(real.calls).toHaveLength(1);
  });

  it("strips odd characters from a tool name the model invented before showing or echoing it", async () => {
    const llm = fakeLlm([toolCallMsg(call("evil\n<script>x".repeat(10))), text("ok")]);
    const ev = await collect(runAgent(llm, [], [user("hi")]));
    const name = (ev[0] as { name: string }).name;
    expect(name).toMatch(/^[A-Za-z0-9_.-]{0,64}$/);
  });

  describe("a failing tool never kills the stream", () => {
    it("a throwing tool becomes an error tool message and a fixed summary, never the exception text", async () => {
      const llm = fakeLlm([toolCallMsg(call("t", {}, "c1")), text("The data was unavailable.")]);
      const tool = fakeTool("t", () => { throw new Error("connect ECONNREFUSED 10.1.2.3:5432 password=hunter2"); });
      const onError = vi.fn();
      const ev = await collect(runAgent(llm, [tool], [user("hi")], 6, { onError }));
      expect(ev.map((e) => e.type)).toEqual(["tool", "tool_result", "message", "done"]);
      expect(JSON.stringify(ev)).not.toContain("hunter2");
      expect(llm.calls[1].at(-1)!.content).not.toContain("hunter2");
      expect(JSON.parse(llm.calls[1].at(-1)!.content!)).toEqual({ error: "The tool failed." });
      expect(onError).toHaveBeenCalledWith("tool t", expect.any(Error)); // the real cause goes to the log
    });

    it("a tool that hangs is cut off at 25 seconds (injected timers, no real waiting)", async () => {
      const timers = manualTimers();
      const llm = fakeLlm([toolCallMsg(call("slow", {}, "c1")), text("It timed out.")]);
      const tool = fakeTool("slow", (_args, signal) => new Promise(() => { void signal; /* never settles */ }));
      const events = collect(runAgent(llm, [tool], [user("hi")], 6, { timers }));
      await vi.waitFor(() => expect(timers.pending()).toBe(2)); // the chat deadline and this tool's cut-off
      expect(timers.intervalMs).toEqual([]);
      timers.fire(25_000);
      const ev = await events;
      expect(ev.map((e) => e.type)).toEqual(["tool", "tool_result", "message", "done"]);
      expect(JSON.parse(llm.calls[1].at(-1)!.content!)).toEqual({ error: "The tool timed out after 25 seconds." });
      expect(tool.signals[0]?.aborted).toBe(true); // the tool was told to stop
    });

    it("uses 25 000 ms by default, and clears the timer when a tool finishes in time", async () => {
      const timers = manualTimers();
      const asked: number[] = [];
      const spy = { ...timers, setTimeout: (fn: () => void, ms: number) => { asked.push(ms); return timers.setTimeout(fn, ms); } };
      const llm = fakeLlm([toolCallMsg(call("t")), text("ok")]);
      await collect(runAgent(llm, [fakeTool("t", { ok: true })], [user("hi")], 6, { timers: spy }));
      expect(asked).toEqual([90_000, 25_000]); // the chat deadline, then the tool's cut-off
      expect(timers.pending()).toBe(0);
    });
  });

  it("honours at most 4 tool calls per round and tells the model about the rest", async () => {
    const six = Array.from({ length: 6 }, (_, i) => call("t", { n: i }, `c${i}`));
    const llm = fakeLlm([toolCallMsg(...six), text("ok")]);
    const tool = fakeTool("t", { ok: true });
    const ev = await collect(runAgent(llm, [tool], [user("hi")]));
    expect(ev.filter((e) => e.type === "tool")).toHaveLength(4);
    expect(tool.calls).toHaveLength(4);
    const toolMsgs = llm.calls[1].filter((m) => m.role === "tool");
    // Every call id still gets an answer, or the provider rejects the history.
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
    expect(JSON.parse(toolMsgs[4].content!)).toMatchObject({ error: expect.stringContaining("At most 4 tool calls") });
  });

  it("runs the calls of one round one after another, not at once", async () => {
    let running = 0, peak = 0;
    const tool = fakeTool("t", async () => { running++; peak = Math.max(peak, running); await Promise.resolve(); running--; return {}; });
    const llm = fakeLlm([toolCallMsg(call("t"), call("t"), call("t")), text("ok")]);
    await collect(runAgent(llm, [tool], [user("hi")]));
    expect(peak).toBe(1);
  });

  describe("provider failures end the stream with a fixed sentence, never the provider's text", () => {
    it.each([
      ["rate_limited", /busy/i],
      ["unavailable", /unavailable/i],
      ["bad_response", /couldn't use/i],
    ] as const)("%s", async (kind, expected) => {
      const llm = fakeLlm([new LlmError(kind, "upstream said: secret-key-abc123 over quota for org-42")]);
      const ev = await collect(runAgent(llm, [], [user("hi")]));
      expect(ev.map((e) => e.type)).toEqual(["error", "done"]);
      expect((ev[0] as { text: string }).text).toMatch(expected);
      expect(JSON.stringify(ev)).not.toMatch(/secret-key|org-42|upstream/);
    });

    it("maps an error that is not an LlmError to a generic sentence, and logs it", async () => {
      const onError = vi.fn();
      const llm = fakeLlm([new Error("boom with details")]);
      const ev = await collect(runAgent(llm, [], [user("hi")], 6, { onError }));
      expect(ev.map((e) => e.type)).toEqual(["error", "done"]);
      expect(JSON.stringify(ev)).not.toContain("boom");
      expect(onError).toHaveBeenCalledWith("model call", expect.any(Error));
    });

    it("also applies mid-conversation, after a tool has run", async () => {
      const llm = fakeLlm([toolCallMsg(call("t")), new LlmError("rate_limited", "x")]);
      const ev = await collect(runAgent(llm, [fakeTool("t", {})], [user("hi")]));
      expect(ev.map((e) => e.type)).toEqual(["tool", "tool_result", "error", "done"]);
    });

    it("treats an empty reply (a model that spent its budget thinking) as an unusable answer, not a blank message", async () => {
      const ev = await collect(runAgent(fakeLlm([text("   ")]), [], [user("hi")]));
      expect(ev.map((e) => e.type)).toEqual(["error", "done"]);
    });
  });

  describe("stopping early", () => {
    it("stops when the consumer returns: no tool runs and no further model call", async () => {
      const llm = fakeLlm([toolCallMsg(call("t")), text("never")]);
      const tool = fakeTool("t", {});
      const gen = runAgent(llm, [tool], [user("hi")]);
      expect((await gen.next()).value).toMatchObject({ type: "tool" });
      await gen.return(undefined);
      expect(tool.calls).toHaveLength(0);
      expect(llm.calls).toHaveLength(1);
      expect(await gen.next()).toEqual({ done: true, value: undefined });
    });

    it("makes no further model call once the signal has aborted (client gone)", async () => {
      const ac = new AbortController();
      const llm = fakeLlm([toolCallMsg(call("t")), text("never")]);
      const tool = fakeTool("t", () => { ac.abort(); return {}; });
      const ev = await collect(runAgent(llm, [tool], [user("hi")], 6, { signal: ac.signal }));
      expect(llm.calls).toHaveLength(1);
      expect(ev.at(-1)).not.toMatchObject({ type: "message" });
    });

    it("does not wait for a tool that ignores its signal once the client has gone", async () => {
      const ac = new AbortController();
      const timers = manualTimers();
      const llm = fakeLlm([toolCallMsg(call("slow")), text("never")]);
      const tool = fakeTool("slow", () => new Promise(() => {})); // never settles, never looks at its signal
      const done = collect(runAgent(llm, [tool], [user("hi")], 6, { signal: ac.signal, timers }));
      await vi.waitFor(() => expect(tool.calls).toHaveLength(1));
      ac.abort();
      await done; // returns without the timeout ever firing
      expect(llm.calls).toHaveLength(1);
      expect(timers.pending()).toBe(0);
    });

    it("hands the model call and the tool the abort signal", async () => {
      const ac = new AbortController();
      const llm = fakeLlm([toolCallMsg(call("t")), text("ok")]);
      const tool = fakeTool("t", {});
      await collect(runAgent(llm, [tool], [user("hi")], 6, { signal: ac.signal }));
      expect(llm.opts[0]?.signal).toBeInstanceOf(AbortSignal);
      expect(tool.signals[0]).toBeInstanceOf(AbortSignal);
      ac.abort();
      expect(llm.opts[0]?.signal?.aborted).toBe(true); // follows the caller's signal
    });
  });

  it("ignores tool_calls entries that are not usable and answers with the text", async () => {
    const llm = fakeLlm([{ role: "assistant", content: "Plain answer.", tool_calls: [{ id: "x" } as never] }]);
    const ev = await collect(runAgent(llm, [], [user("hi")]));
    expect(ev.map((e) => e.type)).toEqual(["message", "done"]);
  });

  it("works with the type's AgentTool shape", () => {
    const t: AgentTool = fakeTool("t", {});
    expect(t.spec.function.name).toBe("t");
  });

  describe("per-chat budgets: 8 harness calls, 12 tool calls in all", () => {
    const harness = (name: string): FakeTool => ({ ...fakeTool(name, { status: "ok" }), budget: "harness" });
    const four = (name: string) => toolCallMsg(...Array.from({ length: 4 }, (_, i) => call(name, { n: i })));
    const toolMessages = (llm: { calls: ChatMessage[][] }, n: number) => llm.calls[n].filter((m) => m.role === "tool");

    it("the limits are the named constants", () => {
      expect([MAX_HARNESS_CALLS_PER_CHAT, MAX_TOOL_CALLS_PER_CHAT]).toEqual([8, 12]);
    });

    it("stops running tools at 12 in total, tells the model, and the model still answers", async () => {
      const t = fakeTool("t", { ok: true });
      const llm = fakeLlm([four("t"), four("t"), four("t"), four("t"), text("Answer from what I have.")]);
      const ev = await collect(runAgent(llm, [t], [user("hi")]));
      expect(t.calls).toHaveLength(12);
      const exhausted = toolMessages(llm, 4).slice(-4).map((m) => JSON.parse(m.content!));
      expect(exhausted).toEqual(Array(4).fill({ error: "budget_exhausted", note: "This chat has used its lookup budget; answer with what you have." }));
      // Every call id is still answered, and the user sees a matching, short tool_result.
      expect(toolMessages(llm, 4)).toHaveLength(16);
      const results = ev.filter((e) => e.type === "tool_result") as { summary: string }[];
      expect(results.slice(-4).map((r) => r.summary)).toEqual(Array(4).fill("error: budget_exhausted"));
      expect(ev.at(-2)).toEqual({ type: "message", text: "Answer from what I have." });
    });

    it("counts harness calls separately: the 9th is refused while Pulse tools still run", async () => {
      const q = harness("qloo_x");
      const p = fakeTool("p", { ok: true });
      const llm = fakeLlm([four("qloo_x"), four("qloo_x"), toolCallMsg(call("qloo_x"), call("qloo_x"), call("p"), call("p")), text("done")]);
      const ev = await collect(runAgent(llm, [q, p], [user("hi")]));
      expect(q.calls).toHaveLength(8);
      expect(p.calls).toHaveLength(2);
      const third = toolMessages(llm, 3).slice(-4).map((m) => JSON.parse(m.content!));
      expect(third.map((r) => r.error ?? "ok")).toEqual(["budget_exhausted", "budget_exhausted", "ok", "ok"]);
      expect(ev.at(-1)).toEqual({ type: "done" });
    });

    it("Pulse tools count toward the 12 but not the 8: after 8 Pulse calls, 4 harness calls still run", async () => {
      const q = harness("qloo_x");
      const p = fakeTool("p", { ok: true });
      const llm = fakeLlm([four("p"), four("p"), four("qloo_x"), four("qloo_x"), text("done")]);
      await collect(runAgent(llm, [q, p], [user("hi")]));
      expect(p.calls).toHaveLength(8);
      expect(q.calls).toHaveLength(4); // total reached 12; the next four harness calls were refused
      expect(toolMessages(llm, 4).slice(-4).every((m) => JSON.parse(m.content!).error === "budget_exhausted")).toBe(true);
    });

    it("a refused call is not run and does not use up budget", async () => {
      const t = fakeTool("t", { ok: true });
      const llm = fakeLlm([four("t"), four("t"), four("t"), four("t"), four("t"), text("done")]);
      await collect(runAgent(llm, [t], [user("hi")], 8));
      expect(t.calls).toHaveLength(12);
    });
  });

  describe("the 90 second deadline for the whole chat", () => {
    it("is 90 s, set once and cleared when the chat ends", async () => {
      expect(CHAT_DEADLINE_MS).toBe(90_000);
      const timers = manualTimers();
      await collect(runAgent(fakeLlm([text("ok")]), [], [user("hi")], 6, { timers }));
      expect(timers.timeoutMs).toEqual([90_000]);
      expect(timers.pending()).toBe(0);
    });

    it("when it fires during a tool: aborts the tool, says it ran out of time, and ends (a tool that ignores its signal does not hold the loop)", async () => {
      const timers = manualTimers();
      const llm = fakeLlm([toolCallMsg(call("slow")), text("never")]);
      const tool = fakeTool("slow", () => new Promise(() => {})); // never settles and never looks at its signal
      const events = collect(runAgent(llm, [tool], [user("hi")], 6, { timers }));
      await vi.waitFor(() => expect(tool.calls).toHaveLength(1));
      timers.fire(90_000);
      const ev = await events;
      expect(ev.map((e) => e.type)).toEqual(["tool", "message", "done"]);
      expect((ev[1] as { text: string }).text).toContain("ran out of time");
      expect((ev[1] as { text: string }).text).toContain("slow"); // only what was actually done
      expect(tool.signals[0]?.aborted).toBe(true);
      expect(llm.calls).toHaveLength(1);
      expect(timers.pending()).toBe(0);
    });

    it("when it fires during a model call: aborts the call, even one that ignores its signal", async () => {
      const timers = manualTimers();
      let seen: AbortSignal | undefined;
      const llm = { chat: (_m: ChatMessage[], o?: { signal?: AbortSignal }) => { seen = o?.signal; return new Promise<ChatMessage>(() => {}); } };
      const events = collect(runAgent(llm, [], [user("hi")], 6, { timers }));
      await vi.waitFor(() => expect(seen).toBeDefined());
      timers.fire(90_000);
      const ev = await events;
      expect(ev.map((e) => e.type)).toEqual(["message", "done"]);
      expect((ev[0] as { text: string }).text).toContain("ran out of time");
      expect(seen?.aborted).toBe(true);
    });

    it("the out-of-time message says plainly when no lookup had run, and names them when some had", async () => {
      const timers = manualTimers();
      let seen: AbortSignal | undefined;
      const llm = { chat: (_m: ChatMessage[], o?: { signal?: AbortSignal }) => { seen = o?.signal; return new Promise<ChatMessage>(() => {}); } };
      const events = collect(runAgent(llm, [], [user("hi")], 6, { timers }));
      await vi.waitFor(() => expect(seen).toBeDefined());
      timers.fire(90_000);
      const text0 = ((await events)[0] as { text: string }).text;
      expect(text0).toContain("ran out of time");
      expect(text0).toContain("I didn't get to run any lookups");
      expect(text0).not.toMatch(/I ran 0 lookups|\(none\)/);
      const timers2 = manualTimers();
      const tool = fakeTool("t", () => { timers2.fire(90_000); return { ok: true }; });
      const ev = await collect(runAgent(fakeLlm([toolCallMsg(call("t"))]), [tool], [user("hi")], 6, { timers: timers2 }));
      expect((ev.at(-2) as { text: string }).text).toContain("I ran 1 lookup (t) but did not get to a final answer");
    });

    it("does not start another round once it has fired", async () => {
      const timers = manualTimers();
      const llm = fakeLlm([toolCallMsg(call("t")), text("never")]);
      const tool = fakeTool("t", () => { timers.fire(90_000); return { ok: true }; });
      const ev = await collect(runAgent(llm, [tool], [user("hi")], 6, { timers }));
      expect(llm.calls).toHaveLength(1);
      expect(ev.at(-2)).toMatchObject({ type: "message", text: expect.stringContaining("ran out of time") });
      expect(ev.at(-1)).toEqual({ type: "done" });
    });

    it("a client that has gone is not told anything", async () => {
      const ac = new AbortController();
      const llm = fakeLlm([toolCallMsg(call("t")), text("never")]);
      const ev = await collect(runAgent(llm, [fakeTool("t", () => { ac.abort(); return {}; })], [user("hi")], 6, { signal: ac.signal, timers: manualTimers() }));
      expect(ev.some((e) => e.type === "message")).toBe(false);
    });
  });

  describe("a final answer the provider cut off at its token limit", () => {
    it("is marked as cut off, and the stream still ends with done", async () => {
      const ev = await collect(runAgent(fakeLlm([{ role: "assistant", content: "First half of the", finish_reason: "length" }]), [], [user("hi")]));
      expect(ev).toEqual([{ type: "message", text: "First half of the … (my answer was cut off; ask me to continue)" }, { type: "done" }]);
    });
    it("is left alone when the provider finished normally", async () => {
      const ev = await collect(runAgent(fakeLlm([{ role: "assistant", content: "Whole answer.", finish_reason: "stop" }]), [], [user("hi")]));
      expect(ev[0]).toEqual({ type: "message", text: "Whole answer." });
    });
  });
});

describe("runAgent: what is re-sent to the model on each round (free-tier token budget)", () => {
  const spec = { type: "object", properties: { city: { type: "string" }, business_type: { type: "string" } }, additionalProperties: false };
  const bytes = (v: unknown) => JSON.stringify(v).length;

  it("asks for at most 1,200 completion tokens per chat round", async () => {
    const llm = fakeLlm([toolCallMsg(call("pulse_board", {})), text("ok")]);
    await collect(runAgent(llm, [fakeTool("pulse_board", {}, spec)], [user("hi")]));
    expect(llm.opts.map((o) => o?.maxTokens)).toEqual([1200, 1200]);
  });

  it("the assistant message carries the sanitised arguments only, and the tool message the truncated result once", async () => {
    const big = { rows: Array.from({ length: 3000 }, (_, i) => `row number ${i}`) };
    const llm = fakeLlm([
      toolCallMsg(call("pulse_board", { city: "delhi", business_type: "cafe", injected: "x".repeat(5000), extra: { deep: [1, 2, 3] } }, "c1")),
      text("done"),
    ]);
    await collect(runAgent(llm, [fakeTool("pulse_board", big, spec)], [user("hi")]));
    const second = llm.calls[1];
    const assistantMsg = second.find((m) => m.role === "assistant")!;
    expect(assistantMsg.content).toBeNull();
    expect(assistantMsg.tool_calls).toEqual([{ id: "c1", type: "function", function: { name: "pulse_board", arguments: '{"city":"delhi","business_type":"cafe"}' } }]);
    const toolMsgs = second.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].content!.length).toBeLessThanOrEqual(2800);
    // The full (un-truncated) result never re-enters the history, and the truncated one appears once.
    expect(JSON.stringify(second)).not.toContain("row number 2999");
    expect(JSON.stringify(second).split("row number 0").length - 1).toBe(1);
  });

  it("a three-round conversation (two tool rounds, then the answer) re-sends a bounded amount in total", async () => {
    // Each round is one model request carrying the system prompt (~1,700 chars), the
    // user turn, the tool specs, and everything so far. A tool result is cut to 2,800
    // characters (about 3,700 once serialised, because the cut preview is itself JSON and
    // its quotes are escaped on the wire) and is re-sent once per later request. Measured
    // with the two small fake tools below: 2,271 / 6,148 / 10,027 characters per request,
    // 18,446 cumulative (~5,000 tokens). The bounds leave ~10% headroom; a regression that
    // duplicated a result in the history, or sent it un-truncated, would blow through them.
    const bigResult = { rows: Array.from({ length: 3000 }, (_, i) => `row ${i}`) };
    const tools = [fakeTool("pulse_board", bigResult, spec), fakeTool("release_brief", bigResult, spec)];
    const llm = fakeLlm([
      toolCallMsg(call("pulse_board", { city: "delhi", business_type: "cafe" }, "a")),
      toolCallMsg(call("release_brief", { city: "delhi", business_type: "cafe" }, "b")),
      text("final answer"),
    ]);
    await collect(runAgent(llm, tools, [user("Which release should my Delhi cafe theme this weekend around, and why? Keep it short.")]));
    expect(llm.calls).toHaveLength(3);
    const sentChars = llm.calls.map((messages) => bytes(messages) + bytes(tools.map((t) => t.spec)));
    expect(sentChars[0]).toBeLessThan(2_500);
    expect(sentChars[1]).toBeLessThan(6_800);
    expect(sentChars[2]).toBeLessThan(11_100);
    expect(sentChars.reduce((x, y) => x + y, 0)).toBeLessThan(20_300);
  });
});

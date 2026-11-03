### Task 10: The chat agent

**Files:**
- Create: `services/pulse/src/agent/prompt.ts`, `src/agent/tools.ts`,
  `src/agent/loop.ts`, `src/http/sse.ts`
- Modify: `services/pulse/src/server.ts` (`POST /chat`)
- Test: `services/pulse/src/agent/loop.test.ts`,
  `services/pulse/src/agent/tools.test.ts`

**Interfaces:**
- Consumes: `buildBoard` (Task 8), `streamBrief` (Task 7, collected to a
  compact summary), `LlmClient` and `takeUsage` (Task 9), and
  `QlooClient.listTools`/`callTool` (Task 4).
- Produces:

```ts
export interface AgentTool { spec: ToolSpec; run(args: Record<string, unknown>): Promise<unknown>; }
export async function buildTools(deps): Promise<AgentTool[]>;
//   pulse_board(city, business_type), release_brief(title_or_tmdb_id, media_type?, city, business_type),
//   search_releases(query), titles_shot_in(city), plus harness tools whose names are in QLOO_AGENT_TOOLS
//   (recommend, where_popular, audience_demographics, rank, compare_audiences, find_tags, describe — exact names from Task 1's tools.json)
// AgentEvent is imported from shared/types/pulse.ts (Task 2)
export async function* runAgent(llm: LlmClient, tools: AgentTool[], history: ChatMessage[], maxRounds = 6): AsyncGenerator<AgentEvent>;
```

  `POST /chat` takes the body `{ messages: {role:"user"|"assistant",
  content:string}[] }`. History is capped at the last 12 messages, and
  each message at 4,000 characters.

  The system prompt (`prompt.ts`) holds:
  - the SAFE_USE rules: aggregate only, no individual claims, never
    request personal data,
  - the copy rule,
  - "Name the Qloo call behind every number you state",
  - the list of launch cities and business types.

- [ ] **Step 1: Write failing tests.**

```ts
it("runs a tool call and returns the final message", async () => {
  const llm = fakeLlm([{ role: "assistant", content: null, tool_calls: [call("pulse_board", { city: "delhi", business_type: "cafe" })] }, { role: "assistant", content: "Theme it around X." }]);
  const ev = await collect(runAgent(llm, [fakeTool("pulse_board", { ranked: [] })], [user("what should my Delhi café do?")]));
  expect(ev.map(e => e.type)).toEqual(["tool", "tool_result", "message", "done"]);
});
it("stops after 6 rounds with an honest message", async () => {
  const ev = await collect(runAgent(fakeLlm(Array(10).fill(toolCallMsg)), [fakeTool("pulse_board", {})], [user("loop")]));
  expect(ev.filter(e => e.type === "tool")).toHaveLength(6);
  expect(ev.at(-2)).toMatchObject({ type: "message", text: expect.stringContaining("step limit") });
});
it("an unknown tool name becomes a tool error the model can recover from, not a crash", async () => { /* tool_result summary contains "unknown tool" */ });
it("only allowlisted harness tools are exposed", async () => {
  const names = (await buildTools(depsWithHarnessTools(["recommend", "dangerous_admin"]))).map(t => t.spec.function.name);
  expect(names).toContain("recommend"); expect(names).not.toContain("dangerous_admin");
});
it("/chat answers 429 with a friendly message when the session cap is hit", async () => { /* router + capped usage */ });
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. `sse.ts` writes `data: <json>\n\n` per
  `AgentEvent`, and a 15 s `: ping` comment keeps proxies open.
- [ ] **Step 4:** Run the tests. Expected: PASS. Manual check, with a real
  Groq key and fixtures:
  `curl -N -X POST localhost:8787/chat -d '{"messages":[{"role":"user","content":"Which release should my Delhi café theme this weekend around?"}]}'`.
  Expected: `tool` events, then a message citing a Qloo call.
- [ ] **Step 5: Commit.**

```bash
git add services/pulse/src
git commit -m "Server-side Pulse agent: Pulse + Qloo tools over SSE, capped and allowlisted"
```

---

## Phase 2b — Frontend


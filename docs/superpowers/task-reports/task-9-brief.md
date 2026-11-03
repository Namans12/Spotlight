### Task 9: Groq client, the campaign writer and the without-Qloo guess

**Files:**
- Create: `services/pulse/src/llm/client.ts`, `src/campaign.ts`,
  `src/db/usage.ts`, `src/usage.ts`
- Modify: `services/pulse/src/brief.ts`. Wire the real `draftCampaign`
  into `BriefDeps`.
- Modify: `services/pulse/src/server.ts`. Add
  `GET /guess?city=&type=&mediaType=&tmdbId=`, which returns a
  `Campaign` with `groundedBy: "none"`.
- Test: `services/pulse/src/campaign.test.ts`,
  `services/pulse/src/usage.test.ts`

**Interfaces:**
- Consumes: the `EvidenceSection`s gathered in `streamBrief` (Task 7).
- Produces:

```ts
// llm/client.ts
export interface ChatMessage { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; }
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface ToolSpec { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface LlmClient { chat(messages: ChatMessage[], opts?: { tools?: ToolSpec[]; json?: boolean }): Promise<ChatMessage>; }
export function createGroqClient(cfg: PulseConfig, fetchImpl?: typeof fetch): LlmClient; // json:true sends response_format {type:"json_object"}; on a 400 mentioning response_format, retries once without it
// campaign.ts
export interface EvidenceFact { id: string; label: string; fact: string; } // ids: "demo:<bucket>", "heat:<i>", "venue:<entityId>", "tag:<tagId>", "artist:<id>", "brand:<id>", "hook:<kind>"
export function buildBundle(sections: Partial<Record<BriefSectionKey, EvidenceSection<unknown>>>, cityName: string, title: string): EvidenceFact[];
export function validateCampaign(raw: unknown, bundleIds: Set<string>): { campaign: Campaign | null; invalidIds: string[]; parseError: string | null };
export function downgradeUncited(c: Campaign, bundleIds: Set<string>): Campaign; // any clause citing an id not in the bundle → evidence []
export async function draftCampaign(llm: LlmClient, bundle: EvidenceFact[], ctx: { title: string; cityName: string; businessType: BusinessType; releaseDate: string | null }): Promise<Campaign>; // ≤ 2 retries with feedback
export async function draftWithoutQloo(llm: LlmClient, ctx: { title: string; cityName: string; businessType: BusinessType; releaseDate: string | null }): Promise<Campaign>; // every clause evidence []
// usage.ts
export function capDecision(counts: { session: number; global: number }, caps: { session: number; global: number }): { allowed: true } | { allowed: false; reason: "session_cap" | "global_cap" };
export async function takeUsage(sql, sessionHash: string, kind: "chat" | "campaign", caps): Promise<ReturnType<typeof capDecision>>;
```

  The campaign prompt must require all of the following:
  - exactly 3 ideas, one each of `special`, `social` and `event`,
  - every factual clause citing ids from the bundle,
  - the copy rule from Global Constraints, verbatim,
  - JSON matching `Campaign` minus `groundedBy`.

  A campaign that hits a usage cap returns a `Campaign` with `ideas: []`.
  The brief section then gets status `degraded` and the note
  `"Daily AI limit reached — the evidence above is unaffected."`

- [ ] **Step 1: Write failing tests.**

```ts
it("validator rejects ids not in the bundle and reports them", () => {
  const r = validateCampaign({ ideas: [{ kind: "special", title: "t", timing: "Fri", clauses: [{ text: "x", evidence: ["venue:zzz"] }] }] }, new Set(["venue:a"]));
  expect(r.invalidIds).toEqual(["venue:zzz"]);
});
it("retries at most twice, feeding back the invalid ids", async () => {
  const llm = fakeLlm([badJson, citesUnknown, citesUnknown]);
  await draftCampaign(llm, bundle, ctx);
  expect(llm.calls).toHaveLength(3);
  expect(llm.calls[2].at(-1).content).toContain("venue:zzz");
});
it("after three bad answers every clause renders as an agent suggestion, never blank (Review Focus 4)", async () => {
  const c = await draftCampaign(fakeLlm([citesUnknown, citesUnknown, citesUnknown]), bundle, ctx);
  expect(c.ideas.length).toBeGreaterThan(0);
  c.ideas.flatMap(i => i.clauses).forEach(cl => expect(cl.evidence).toEqual([]));
});
it("three unparseable answers still yield a non-empty campaign (Review Focus 4)", async () => {
  const c = await draftCampaign(fakeLlm(["nope", "{", "]"]), bundle, ctx);
  expect(c.ideas).toHaveLength(1); // single fallback idea: title "Campaign draft unavailable", one clause explaining, evidence []
});
it("without-Qloo campaigns are marked groundedBy none with no evidence", async () => {
  const c = await draftWithoutQloo(fakeLlm([validNoEvidence]), ctx);
  expect(c.groundedBy).toBe("none");
});
it("caps: session first, then global", () => {
  expect(capDecision({ session: 30, global: 1 }, { session: 30, global: 800 })).toEqual({ allowed: false, reason: "session_cap" });
  expect(capDecision({ session: 1, global: 800 }, { session: 30, global: 800 })).toEqual({ allowed: false, reason: "global_cap" });
});
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The session hash is the SHA-256 of the
  `X-Pulse-Session` header, a random id the SPA keeps in `localStorage`,
  plus the day. A missing header hashes the remote address.
  `pulse_usage` increments with `INSERT … ON CONFLICT DO UPDATE SET count
  = pulse_usage.count + 1 RETURNING count`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then, with a real
  `GROQ_API_KEY` and fixtures on, `curl -N` a brief. Expected: the
  `campaign` section has 3 ideas, and its cited ids exist in the bundle.
- [ ] **Step 5: Commit.**

```bash
git add services/pulse/src
git commit -m "Draft cited tie-in campaigns with Groq; validate, retry twice, downgrade the rest"
```


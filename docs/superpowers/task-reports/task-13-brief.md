### Task 13: The chat panel

**Files:**
- Create: `src/components/pulse/PulseChat.tsx`
- Modify: `src/routes/Pulse.tsx` and `src/routes/PulseBrief.tsx`, which
  mount `PulseChat` as a right-side panel on desktop and a bottom sheet on
  mobile.
- Test: `src/components/pulse/PulseChat.test.tsx`

**Interfaces:**
- Consumes: `streamChat` (Task 11) and `AgentEvent`.
- Produces: `PulseChat({ city, type, title? })`. It seeds three suggested
  prompts:
  - "Which release should my ⟨City⟩ ⟨café|brand⟩ theme this weekend around?"
  - "Who is the audience for ⟨title⟩ here?" (only when `title` is set)
  - "Plan a screening-night special for Friday."

  Tool events render as small collapsible lines, e.g. "Checked Qloo
  heatmap for Delhi". A cap-hit or error event renders as a muted system
  line.

- [ ] **Step 1: Write failing tests.**

```ts
it("shows tool activity, then the answer", async () => { /* mock streamChat emitting tool, tool_result, message, done */ });
it("disables send while streaming and re-enables after done", async () => {});
it("renders a cap message as a system line, not an error toast", async () => {});
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Do not reuse `src/webmcp/AgentChat.tsx`: it
  is gated on the WebMCP flag and needs a key from the visitor. The visual
  style can match it.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/components/pulse/PulseChat.tsx src/components/pulse/PulseChat.test.tsx src/routes/Pulse.tsx src/routes/PulseBrief.tsx
git commit -m "Pulse chat panel: a keyless agent judges can talk to"
```

---

## Phase 4 — Stretch (cut first)


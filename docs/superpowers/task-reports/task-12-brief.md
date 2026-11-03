### Task 12: The brief page (sections, map, provenance, without-Qloo toggle)

**Files:**
- Create: `src/routes/PulseBrief.tsx`
- Create: `src/components/pulse/BriefSection.tsx`, `HeatMap.tsx`,
  `ProvenanceDrawer.tsx`, `CampaignView.tsx`, `EvidenceChip.tsx`
- Modify: `src/App.tsx`. Add a lazy route
  `/pulse/:city/:mediaType/:tmdbId`.
- Modify: `package.json`. Add `leaflet` and `react-leaflet@4`, plus
  `@types/leaflet` as a dev dependency.
- Test: `src/routes/PulseBrief.test.tsx`,
  `src/components/pulse/CampaignView.test.tsx`

**Interfaces:**
- Consumes: `streamBrief` and `fetchGuess` (Task 11), and the
  `BriefEvent` and `Campaign` types.
- Produces:
  - `EvidenceChip({ id, bundle })` renders one of the exact chip labels in
    Global Constraints, mapped from the id prefix. `heat` gives
    `Qloo · heatmap`, `venue` gives `Qloo · places`, and so on. The `hook`
    chip label comes from its source, and `[]` gives `Agent suggestion`.
  - `CampaignView({ campaign })` renders each clause followed by its chips.

**Page layout:**
- **Header.** Poster, title, date, city, business type.
- **Sections**, in `BUSINESS_TYPES` order, each with its own skeleton
  until its event arrives:
  - **Who:** age and gender bars of signed skew, with the label
    "relative to average".
  - **Where:** `HeatMap` with circles per cell, sized by affinity, and
    the top 3 named neighbourhoods listed.
  - **Venues:** a list with tags.
  - **Themes, Artists, Brands:** chips.
  - **Hook:** "Shot in Chandni Chowk, Delhi" with its source chip.
  - **Trend:** only if `ok`.
  - **Campaign.**
- **Section statuses.**
  - `empty` shows the note in muted text.
  - `error` shows "Qloo didn't answer this part — Retry", which re-fetches
    the whole brief.
  - `degraded` shows the note.
- **Toggle.** "Without Qloo" calls `fetchGuess` and shows its campaign
  side by side, under the exact label
  `What an LLM guesses with no taste data`.
- **ProvenanceDrawer** lists each section's `provenance[]` (call, params,
  limits), under the heading "What this doesn't tell you" for limits.
- **Unknown city** (400 `unknown_city`): render `CityTypePicker`, with the
  message "That city isn't supported yet — pick one of these."

- [ ] **Step 1: Write failing tests.**

```ts
it("renders sections as they stream, before done", async () => { /* mock streamBrief to emit header + who, hold; expect who visible and venues skeleton */ });
it("an error section offers retry while other sections stay visible (Review Focus 2)", async () => { /* where: error → 'Retry' button; who still rendered */ });
it("an unknown city shows the picker, not a crash (Review Focus 5)", async () => { /* streamBrief rejects with HttpError(400) unknown_city */ });
it("clauses with no evidence render the Agent suggestion chip", () => {
  render(<CampaignView campaign={{ groundedBy: "qloo", ideas: [{ kind: "social", title: "t", timing: "Fri", clauses: [{ text: "Post at 7pm", evidence: [] }] }] }} />);
  expect(screen.getByText("Agent suggestion")).toBeInTheDocument();
});
it("the without-Qloo panel uses the exact label", async () => {
  expect(await screen.findByText("What an LLM guesses with no taste data")).toBeInTheDocument();
});
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. `HeatMap` is lazy-loaded so Leaflet's CSS
  and JS stay out of the main bundle. Tiles come from
  `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, with the attribution
  "© OpenStreetMap contributors".
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run build`.
  Expected: PASS. Then check by hand: the brief page streams in on
  fixtures, and the toggle shows two campaigns side by side.
- [ ] **Step 5: Commit.**

```bash
git add src package.json package-lock.json
git commit -m "Pulse brief: streamed evidence sections, heatmap, provenance and the without-Qloo view"
```


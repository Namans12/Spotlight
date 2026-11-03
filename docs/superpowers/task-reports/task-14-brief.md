### Task 14: "Filmed in" panel and "Plan the night" card on the title page

**Files:**
- Modify: `services/pulse/src/server.ts`. Add
  `GET /title-locations?mediaType=&tmdbId=`, returning `{ city_slug,
  cityName, kind, landmark_label, source }[]`. Add
  `GET /plan-night?mediaType=&tmdbId=&city=`, which returns
  `EvidenceSection<Venue[]>` from `places` with no tag filter, plus
  artists, through `getEvidence`.
- Create: `src/components/title/LocationsPanel.tsx`,
  `src/components/title/PlanNightCard.tsx`
- Modify: `src/routes/TitleDetail.tsx`. Mount `LocationsPanel` between
  `FactsPanel` (about line 413) and `TrailerCard` (about line 415).
  Mount `PlanNightCard` after `LocationsPanel`.
- Test: `src/components/title/LocationsPanel.test.tsx`,
  `src/components/title/PlanNightCard.test.tsx`

**Interfaces:**
- Consumes: `title_locations` (Task 5), `getEvidence` and `resolveTitle`
  (Tasks 6 and 7), and the city picker (Task 11).
- Produces:
  - `LocationsPanel({ mediaType, tmdbId })` renders nothing when there are
    no rows. Each city links to `/pulse?city=<slug>`.
  - `PlanNightCard({ mediaType, tmdbId, title })` asks for a city with the
    picker, then lists places with the copy "Fans of ⟨title⟩ in ⟨City⟩
    over-index on these spots". It also offers a Web Share / `wa.me` link
    with the invite text. It never sends anything itself.

- [ ] **Step 1: Write failing tests.** A panel with no rows renders
  nothing. The card copy follows the copy rule exactly. The share link
  contains no personal data.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src services/pulse/src
git commit -m "Title page: where it was filmed, and a taste-matched plan for the night"
```

---

## Phase 5 — Ship


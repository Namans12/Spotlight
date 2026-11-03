# Task 12 report: the brief page

Status: DONE_WITH_CONCERNS (concerns at the end)

## What was built
Route `/pulse/:city/:mediaType/:tmdbId` (lazy, inside `<AppShell />`, not under RequireAuth) -> `src/routes/PulseBrief.tsx` (orchestrator only).

Logic (pure, tested first):
- `src/lib/pulseSections.ts`: `BRIEF_SECTIONS` (mirrors services/pulse/src/businessTypes.ts), `briefReducer` (begin/event/ended), `sectionView`.
- `src/lib/pulseEvidence.ts`: `chipsForId`, `chipsForEvidence` (dedupe by label, merge details, `[]` or all-unknown -> `Agent suggestion`), `hookChips`, `topNeighbourhoods` (top N distinct by affinity; same ranking the service uses to number `heat:<i>`), age labels.
- `src/lib/pulseCharts.ts`: `divergingBars`, `formatSkew`, `heatRadii` (min 6 px), `sparkPoints`.
- `src/lib/pulseCopy.ts`: section titles, `GUESS_LABEL`, `guessErrorMessage`.

Components (`src/components/pulse/`): `BriefSection` (skeleton / "No data returned" / note / error+Retry frame), `AgeBars`, `WhereSection` (lazy `HeatMap` + Suspense skeleton of same height + top-3 text list), `HeatMap` (react-leaflet 4: OSM tiles, CircleMarker per cell, fitBounds, scrollWheelZoom off, Popup with neighbourhood, `role="img"` + aria-label, leaflet CSS imported inside the lazy chunk), `SectionBodies` (VenueList, NameChips, HookList, TrendLine), `EvidenceChip` (+`EvidenceChips`, `ChipPill`; Radix Tooltip, own TooltipProvider, detail also as sr-only text), `CampaignView`, `GuessPanel` (compare without Qloo), `ProvenanceDrawer` (ui/sheet), `Notice` (extracted from Pulse.tsx, behaviour unchanged; board tests still pass).
Also `formatReleaseDateFull` in `src/lib/pulseFormat.ts`.

Decisions documented in code:
- Retry re-fetches the whole brief and aborts the old stream; previous sections stay visible, dimmed + `aria-busy`, with a "Refreshing the brief" status line, and are replaced per section as events arrive; stale ones the new stream never sends are dropped at `done` ("No data returned"). A stream that closes without `done` shows a banner with "Try again" and keeps what arrived.
- `set` hook labels (builder's call): `Wikipedia · Films set in <City>` / `Wikidata · narrative location`. Source `both` -> both chips. Unresolvable hook id -> Wikipedia label for its kind (mirrors the service default).
- Unknown-prefix evidence id draws no chip; a clause left with none shows `Agent suggestion`.
- Trend: no skeleton while loading; rendered only if status ok.
- Bare HTTP 400 from /brief is treated as unsupported city (SPA only sends validated titles). City not in the SPA list never calls the service. Missing/invalid `type` asks for one. Picker submit goes to the board.
- Guess panel clauses always show `Agent suggestion` (any evidence ids in the response are stripped); fetch only on click, aborted on unmount/title change; result kept across hide/show.
- Skew values shown as signed numbers (+0.34 / −0.05), one shared scale for age and gender; no percentages.

## Tests
New: 106 tests (476 -> 582 total, all pass). Files: `src/lib/pulse{Evidence,Sections,Charts}.test.ts`, `pulseFormat.test.ts` (+2), `src/components/pulse/{CampaignView,AgeBars,WhereSection}.test.tsx`, `src/routes/PulseBrief.test.tsx` (50 tests: the brief's five plus every extra listed in the task). HeatMap module mocked; Suspense fallback tested in its own file because React.lazy caches the first load.
TDD: the three logic test files were run before their modules existed (RED: "Failed to resolve import ./pulseEvidence / ./pulseSections / ./pulseCharts", 3 files failed, 0 tests) and then GREEN once implemented (42 tests). UI tests were written with the implementation.

## Verification
- `npx vitest run`: 42 files, 582 passed.
- `npm run typecheck`: clean (all 5 tsconfigs).
- `npm run lint`: 69 problems (65 errors, 4 warnings), same as baseline (I briefly introduced 2 react-refresh warnings and fixed them by moving constants to `pulseCopy.ts`).
- `npm --prefix services/pulse test`: 687 passed, 22 skipped.
- `npm run build`: success. New chunks: `PulseBrief` 31.46 kB (10.14 kB gzip), `HeatMap` 155.93 kB (45.81 kB gzip) + `HeatMap.css` 15.61 kB (6.46 kB gzip). Leaflet code/CSS appear only in the HeatMap chunk (grep confirms); entry `index` 205.11 kB (65.58 kB gzip) unchanged by Leaflet.
- Lockfile: `grep -c npmmirror package-lock.json` -> 0. Added leaflet 1.9.4, react-leaflet ^4.2.1 (4.2.1), -D @types/leaflet 1.9.22.

## Manual check (fixtures service + vite)
Service with QLOO_FIXTURES=1 on :8799, vite on :8080, synthetic title "Saffron Nights" (tmdb 999700001, imdb tt9997000, one title_locations row for delhi, filmed/both/"Chandni Chowk"). Opened `/pulse/delhi/movie/999700001?type=cafe` in the browser pane.
Desktop: header (no-poster placeholder, "Film · 30 Oct 2026 · Delhi · Café / restaurant", back link, "How this was made"); Who diverging bars (negative left, positive right, signed values, caption); Where with the OSM map, scaled amber circles, "Strongest around Raisina Hill / Connaught Place / Chanakyapuri"; Venues with ₹ marks, address and tags (fixture data has tags); Themes/Artists chips; Local hook "Shot in Chandni Chowk, Delhi" with both Wikipedia and Wikidata chips; Trend sparkline; Campaign shows the "campaign writer isn't configured" note (no GROQ key, expected). "Compare without Qloo" opened the two-column panel: left "Grounded in Qloo taste data" (note), right "What an LLM guesses with no taste data" with "The AI writer isn't configured on this deployment." and Try again. Drawer opened with per-section source/call/params/"What this doesn't tell you"; Escape closed it.
375 px: single column, no horizontal scroll (scrollWidth 375), bars and map fit, header wraps cleanly.
Console errors seen were only Spotlight's own /api calls (no backend behind vite).
Cleanup: deleted the synthetic release_items, title_ratings, title_locations (tmdb 999700001 only; the DB's 18069 pre-existing title_locations rows untouched), qloo_entities, qloo_evidence rows; both servers stopped.

## Files changed
package.json, package-lock.json, src/App.tsx, src/routes/Pulse.tsx (Notice extraction only), src/routes/PulseBrief.tsx(+test), src/lib/pulse{Sections,Evidence,Charts,Copy,Format}.ts(+tests), src/components/pulse/{BriefSection,AgeBars,WhereSection,HeatMap,SectionBodies,EvidenceChip,CampaignView,GuessPanel,ProvenanceDrawer,Notice}.tsx and their tests.

## Self-review
- Exact chip/label strings used as specified; copy rule followed ("Fans of <title> in <City> over-index on…"), no "your customers" (asserted in a test).
- No assumption that venue tags/coords exist (tested with all-null venue); price marks only when present.
- Provenance drawer renders only source/call/params/limits (tested with injected extra fields).
- Accessibility: map has a text alternative (neighbourhood list), chip labels visible without hover and detail duplicated as sr-only text, labelled controls, Radix Dialog focus trap/Escape/return focus (tested).

## Concerns
1. The map container is `role="img"` as the brief asks, but Leaflet's zoom buttons live inside it; strict axe "nested-interactive" would flag that. Kept to the brief; a `role="group"` would be the alternative.
2. Chip tooltips are hover/focus only (Radix does not open them on touch tap); the fact is still available as screen-reader text and the clause text itself carries the claim.
3. In dev, React StrictMode starts the brief stream twice (the first is aborted); production is one request.
4. Trend percentile scale is unverified in the service (fixtures use 0-1); the view prints the raw value with "not viewership" and no % sign.

---

## Fix report, round 1

Changes (all from the review; reducer, abort handling, drawer and guess-column chip honesty untouched):
- IMPORTANT `HeatMap.tsx`: `drawn` and `radii` are `useMemo`'d on the `cells` prop; `FitToCells` therefore refits only when the cells change, so later streamed sections (the campaign arrives last) no longer undo the reader's pan/zoom. New `HeatMap.test.tsx` (react-leaflet stubbed, `useMap` returns a shared fake): same `cells` reference re-rendered (even with a changed title) -> `fitBounds` still called once; new array -> twice; single cell -> `setView` once. Sanity-checked RED: with the memo removed, the "same cells" and "single cell" tests fail.
- 1. Map wrapper is `role="group"` + `aria-roledescription="map"` + the same `aria-label` (tested).
- 2. Compare state lifted into `BriefStream` (guess state in new `src/hooks/usePulseGuess.ts`, fetch only from a click, abort on unmount, result kept across hide/show). `GuessPanel` replaced by `CampaignCompare.tsx` (`CampaignCompare` + `CompareToggle`); while open the two columns replace the campaign body inside the same section (`BriefSection` gained a `body` override), so the grounded campaign is on the page once. Toggle has `aria-expanded` + `aria-controls` pointing at the region wrapping the campaign section. Left heading is "Grounded in Qloo taste data" only when `isGroundedCampaign` (new, `pulseSections.ts`: ok + `groundedBy:"qloo"` + not the "Campaign draft unavailable" placeholder); otherwise "Qloo-grounded draft" with the section's note. The guess result region is a persistent `aria-live="polite"` container (loading text, error text + Try again, "Comparison ready" + campaign); the old `role="alert"`/`role="status"` there are gone.
- 3. `BriefSection` takes `stalled` (= `interrupted` or a fatal failure): sections still loading render a static "Didn't load — Try again" (whole-brief retry), no skeleton, no `role="status"`/`aria-busy`; a header that never arrived shows "The title didn't load." instead of a pulsing skeleton. The old interrupted-stream test now asserts the new behaviour.
- 4. `WhereSection` wraps the lazy map in a local `MapBoundary` (error boundary): "The map couldn't load — the list below is the same data" in a box of the map's height. The list is rendered below the map, so the text says "below" (the coordinator's draft said "above"). Test in `WhereSection.boundary.test.tsx`; the Suspense fallback test remains.
- 5. `pulseEvidence.ts`: `hook:<kind>` with no confirming row (section missing or no row of that kind) -> `Agent suggestion`; an unknown kind draws no chip (and a clause of only that falls back to Agent suggestion) and is never treated as `filmed`. Tests updated/extended.
- 6. Section titles are `<h2>` (page title h1); idea titles h3 (h4 inside the compare columns, whose headings are h3, via a `ideaHeading` prop on `CampaignView`). Heading-level queries in tests updated.
- 7. `min-h-11` (44 px) on Back to board, How this was made, Compare/Hide comparison, the banner Try again, the shared page-level `RetryButton` (so the board's too, visually unchanged otherwise) and the compare panel's Try again. Inline section "Retry" unchanged. Tested via class.

Tests: 602 total (was 582): new `HeatMap.test.tsx` (6), `WhereSection.boundary.test.tsx` (1), +6 hook/unknown-kind/grounded-helper tests in lib files, PulseBrief tests for compare placement/labels/live region, stalled sections, touch targets; the guess-error tests now find the message as text instead of `role="alert"`.

Commands and results:
- `npx vitest run`: 44 files, 602 passed.
- `npm run typecheck`: clean.
- `npm run lint`: 69 problems (65 errors, 4 warnings), unchanged.
- `npm --prefix services/pulse test`: 687 passed, 22 skipped.
- `npm run build`: OK. Chunks: `PulseBrief` 33.51 kB (10.83 kB gzip), `HeatMap` 156.00 kB (45.84 kB gzip), `HeatMap.css` 15.61 kB (6.46 kB gzip), entry `index` 205.11 kB (65.58 kB gzip); Leaflet still only in the HeatMap chunk.
- No manual browser run this round (per instruction).

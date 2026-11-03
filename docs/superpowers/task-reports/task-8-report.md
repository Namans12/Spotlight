# Task 8 report: board candidates, scoring, background warming

Status: DONE_WITH_CONCERNS (see Concerns)

## What was built
- `services/pulse/src/score.ts`: `Candidate`, `Scored` (adds `businessType` so `whyLine` keeps the brief's 5-arg signature), `freshness`, `businessFit`, `scoreCandidates`, `whyLine`.
- `services/pulse/src/board.ts`: `listCandidates`, `buildBoard`, `BoardDeps` (`{ sql, enqueueWarm, onError? }`; deliberately no Qloo client or resolver, so buildBoard cannot make a Qloo call).
- `services/pulse/src/warm.ts`: `warmTitle`, `warmCity`, `warmCities` (the `/warm` run), `createWarmQueue` (keyed, bounded, concurrency 4), `createBackgroundWarmer` (key `city|tmdbId|mediaType|type`).
- `services/pulse/src/routes/board.ts`, `routes/warm.ts`: handler factories. `server.ts` registers `GET /board` (own 30/min limiter) and `POST /warm`.
- DB helpers (one statement each): `getTitleLocationsBatch` (db/locations.ts), `getCachedEntities` (db/entities.ts, cache-only reader), `getPopularity` (db/titles.ts).
- `brief.ts`: exported `fetchHeatmap` / `fetchPlaceTags`; the brief's `where` and `themes` runners now call them, and warming uses the same functions (no duplicated Qloo call or cache logic).
- `.github/workflows/ott-radar.yml`: new final step "Warm Release Pulse board" (continue-on-error, 5 min timeout, secret and URL via `env:`; prints "Pulse warm skipped (not configured)" and exits 0 when either is empty). No other step touched. Simulated the unconfigured shell: output as above, exit 0. YAML parsed with js-yaml: 5 steps, new one last.
- Test support: `testing/boardFakes.ts` (fake sql layered on `fakeSql` for release/calendar/popularity/entity/hook statements).

## Rulings applied
- R4: `whyLine` sorts eligible parts by weighted value, ties in declaration order local_affinity > business_fit > local_hook > freshness (tests: hook beats freshness at 0.10 each; business_fit beats both).
- R5: no cells (`null`/`[]`/only non-finite) gives local_affinity 0 before normalisation and is excluded from the min/max; one cell-bearing candidate or all-equal gives 1. All-empty city: every card ranked, finite scores, why says "no local signal yet". Unresolved never interleaved with ranked (separate buckets).
- R22: candidates come only from release_items/calendar_entries (via `getCalendarMonth`), known by construction.
- R24: `routes/warm.ts`: 503 `warm_disabled` if no secret (checked first), 401 `unauthorized` for missing/wrong/non-Bearer/empty; comparison is `timingSafeEqual` over SHA-256 digests (equal-length buffers, no length leak); 202 `{started:true}` then background; `?wait=1` awaits and returns `{warmed,failed}` (500 `warm_failed` without cause on failure); `?city=` unknown gives 400 (checked after auth). `warmCities` without a city iterates `prewarm` cities x both types, sequentially; per-candidate sequential.
- R25: `/board` check order 400 validation, 429 (separate limiter instance, `Retry-After`), response. Queue: in-flight key set (no double enqueue), max 200 queued+running (dropped silently, next poll retries), tests for both.

## Design notes / deviations (for review)
1. Popularity: `getCalendarMonth` returns no popularity, so `getPopularity` does one `MAX(popularity)` query on release_items for the in-window ids; calendar-only titles count 0. (`lib/calendarDb.ts` untouched.)
2. Dropped rows with a null `tmdbId` OR null `mediaType` (cannot key them).
3. Dedupe: streaming over non-streaming; otherwise the earlier date.
4. why-line: a part that contributed 0 is never claimed, except local_affinity (always eligible, says "no local signal yet"). So with only one other positive part the line is "<that part> · no local signal yet". Freshness 0.5 (8-14 days) says "out within two weeks" instead of "out this week", which would be false. A ranked card whose strongest cell has no neighbourhood label says "strong local affinity".
5. `businessFit` folds diacritics so "Cafe" matches "Café" tags; denominator is the number of names among the top 10 (not a fixed 10).
6. Ranked card with heatmap cached but place_tags not cached: still ranked (business_fit 0), and warming is enqueued so the next poll has tags.
7. Scores are rounded to 3 decimals on the wire (not inside `Scored`).
8. Warm counting: a title Qloo definitely does not know counts `warmed` (nothing left to fetch); `error` and `needs_input` sections count `failed` (neither is cached, so the board would still wait); a city whose candidate list cannot be read counts 1 failed per business type and is logged.
9. `ranked` ties are broken by popularity, then release date, then id.

## Tests
- New: score.test.ts (34), board.test.ts (28), warm.test.ts (20), routes/board.test.ts (4), routes/warm.test.ts (14), db/entities.test.ts (2), additions to db/locations.test.ts and db/titles.test.ts (batch statements are one statement), board.integration.test.ts (2, real Postgres: two-month window, dedupe, popularity, hook, buckets).
- Results:
  - `npm --prefix services/pulse test`: 22 files passed, 4 skipped; 308 passed, 9 skipped.
  - With `PULSE_TEST_DATABASE_URL`: 26 files, 317 passed.
  - `npm run typecheck`: clean (all five projects).
  - root `npx vitest run`: 414 passed. `.venv/bin/python -m pytest -q`: all passed.
- TDD: score, warm, routes tests were run RED first (module not found: "no tests", suite failed to load) then GREEN after implementation. board.test.ts was written first but I ran it only after implementing board.ts (no separate RED run); its first GREEN run had 2 failures that were test-setup mistakes (heat seeded without place tags, so warming was correctly enqueued), fixed in the tests.

## Real verification (local Postgres 54329, QLOO_FIXTURES=1, PULSE_WARM_SECRET=testsecret, PORT=8799)
Seeded 6 fake release_items (999100001..6) + title_ratings (tt999100x) + 1 title_locations (delhi, Chandni Chowk) + 1 fake neighbourhood.
- First `GET /board?city=delhi&type=cafe`: 200 in 0.012 s, `ranked: 0, pending: 6, unresolved: 0`.
- Five seconds later (background warm done): `ranked: 6, pending: 0`:
  - #1 "ZZ Fake Film One" score 0.75: `#1 of 6 for Delhi audiences · strongest around ZZ Fake Hood · shot in Chandni Chowk`
  - #2 score 0.65: `#2 of 6 for Delhi audiences · strongest around ZZ Fake Hood · out this week`
  - ... #5/#6 (8-14 days out) score 0.6: `... · out within two weeks`
- `POST /warm` wrong bearer: `{"error":"unauthorized"}` 401; no header 401; `?city=atlantis` with the right secret 400 `unknown_city`.
- `POST /warm?wait=1&city=mumbai` right bearer: `{"warmed":12,"failed":0}` 200 (6 titles x 2 types); then mumbai board (d2c_food): 6 ranked, 0 pending, top why `#1 of 6 for Mumbai audiences · strongest around Kurla · out this week`.
- `POST /warm` (no wait): `{"started":true}` 202.
- 35 board calls in a minute: 27 x 200 then 8 x 429 (3 earlier calls in the window make 30 total allowed); 429 carried `Retry-After: 43` and `{"error":"rate_limited"}`; a bad city still 400 for the limited client.
- Cleanup: all inserted rows deleted (release_items, title_ratings, title_locations, qloo_entities, `fx-%` qloo_evidence (60 rows), fake neighbourhood); counts verified back to baseline (release_items 0, title_ratings 0, qloo_entities 0, qloo_evidence 0; title_locations/neighbourhoods rows pre-existing from Task 5 left alone). Server stopped (healthz no longer answers).

## Self-review
Completeness vs brief: all exported names present (`whyLine` signature kept; `Scored` has one extra field). Comments explain why. No timers in tests (deferred promises, injected clocks; only `setImmediate` to let a background log fire in one routes test). No secrets in logs (the verification secret is a throwaway; server log shows only the listen line).

## Concerns
- The board re-runs ~8 cheap queries plus up to 40 evidence peeks per poll (no per-city caching); fine for a 30/min limit but a short in-memory cache of `listCandidates` would cut it if load grows.
- A title whose Qloo call keeps returning `error` is re-enqueued on every poll (bounded by the key set, the 200 cap, the 4-worker queue and the Qloo limiter, but not by a cooldown). A short failure cooldown could be added if Qloo budget matters.
- `POST /warm` has no guard against overlapping runs (shared `getEvidence`/`resolveTitle` in-flight dedupe makes a second run mostly cache hits).
- The workflow warm step only runs if the release bot step succeeds (default `if: success()`); intentional.

## Files
services/pulse/src/{score,board,warm}.ts (+tests), routes/{board,warm}.ts (+tests), testing/boardFakes.ts, db/{entities,locations,titles}.ts (+tests), brief.ts, server.ts, board.integration.test.ts, .github/workflows/ott-radar.yml.

---

## Fix report, round 1

### Changes
- `score.ts` `whyLine` (Important): "no local signal yet" is now decided by whether the candidate has any finite heatmap cell (`localStrength(candidate.heat) !== null`), not by the normalised value. A weakest-with-cells candidate (normalised 0) no longer claims it; its local part simply is not claimed. R5 holds: an all-empty city, or a candidate with `heat` null/`[]`/all non-finite, still says it.
- Claim floors (named constants `CLAIM_FLOOR_BUSINESS_FIT = 0.2`, `CLAIM_FLOOR_LOCAL_AFFINITY = 0.2`, documented as builder's calls): the business-fit wording needs businessFit >= 0.2; "strongest around <hood>" / "strong local affinity" need the NORMALISED local affinity >= 0.2 (a candidate with cells below the floor is not claimed, same mechanism as a zero part). Hook and freshness still need weighted > 0.
- `scoreCandidates` sort: compares scores rounded to 3 decimals (the wire value), then popularity desc, release date, tmdbId.
- Workflow: `"${PULSE_URL%/}/warm"` (nothing else changed; checked the expansion strips one trailing slash).

### Tests (score.test.ts, 34 -> 41)
- Replaced the test that locked the wrong behaviour ("orders the two parts..." no longer expects "no local signal yet" for heat [0.1] as the weakest candidate); rewrote it to use a candidate with no cells.
- New: weakest-with-cells in a mixed board does not say it (with and without freshness); mixed board with null / `[]` / NaN-only candidates says it only for those; all-empty city says it for every card; business-fit floor at 0.2 vs just below (cafe, and d2c_food); local-affinity floor at normalised 0.2 vs 0.19 (with and without a hood); rounded-score tie-break (raw difference ~5e-8 loses to popularity; a real 3rd-decimal difference still wins).
- RED check: with the old `score.ts` restored, 6 of the new/changed tests fail; GREEN with the fix.

### Commands and output
- `npm --prefix services/pulse test`: 22 files passed, 4 skipped; 315 passed, 9 skipped.
- `PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test npm --prefix services/pulse test`: 26 files, 324 passed.
- `npm run typecheck`: clean.
- root `npx vitest run`: 31 files, 414 passed.
- `.venv/bin/python -m pytest -q`: all passed.
- No live run this round (not required). Deferred items untouched.

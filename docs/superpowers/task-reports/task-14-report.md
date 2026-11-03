# Task 14 report: "Filmed in" panel and "Plan the night" card

Status: DONE. Two commits on `feat/release-pulse`:
- `e27b309` Pulse service: /title-locations and /plan-night for the title page
- `b8cc87c` Title page: where it was filmed, and a taste-matched plan for the night

## What was built

Service (`services/pulse/src`)
- `routes/titleLocations.ts` (`titleLocationsHandler`): `GET /title-locations?mediaType=&tmdbId=`. DB-only read through the new `getLocationsForTitle` (`db/locations.ts`: `SELECT city_slug, kind, source, landmark_label FROM title_locations WHERE tmdb_id AND media_type AND source IS NOT NULL ORDER BY kind, city_slug`). Maps slug to `cityName` via `getCity`, drops rows for non-launch cities, sorts filmed before set then by city name, caps at 20, answers `[]` for unknown titles. DB failure is 503 `unavailable` with the cause logged through `onError`.
- `planNight.ts` (`buildPlanNight`) and `routes/planNight.ts` (`planNightHandler`): `GET /plan-night?city=&mediaType=&tmdbId=`. Response `{ title, cityName, places, artists }`.
- `routes/params.ts`: new `parseTitleKey` and `parsePlanNightParams`. `parseTitleParams` (brief/guess) now reuses `parseTitleKey`, with behaviour and order unchanged.
- `brief.ts`: the helpers `errorSection`, `emptySection`, `sanitiseError`, `noteFor`, `NO_ENTITY_NOTE` and `RESOLVE_FAILED_NOTE` are now exported and shared, not copied, so the fixed sentences and the "own errors are exempt" rule are one implementation.
- `evidence.ts`: `EvidenceKind` gains `"places_open"`. No exhaustive list of kinds existed anywhere (grepped), so nothing else needed updating.
- `server.ts`: both routes registered through the factories. `/plan-night` has its own `createRateLimiter({max:20, windowMs:60_000})`, `/title-locations` its own 60/min. Neither shares an instance with /brief, /board, /guess or /chat.
- `shared/types/pulse.ts`: `TitleLocationEntry` and `PlanNightResponse` (used by service and SPA).

SPA (`src`)
- `lib/pulseApi.ts`: `fetchTitleLocations`, `fetchPlanNight` (same `pulseFetch`, 16 s timeout, `PulseApiError` with code and Retry-After).
- `components/title/LocationsPanel.tsx`; `components/title/PlanNightCard.tsx`; `lib/planNightInvite.ts` (`inviteText`, split out so the component file exports only a component, which keeps the react-refresh lint warning count unchanged).
- `routes/TitleDetail.tsx`: `LocationsPanel` then `PlanNightCard`, between `FactsPanel` and `TrailerCard`.

## How each ruling was applied

- R35: `/plan-night` order is 400 (city checked first, as in /brief: `unknown_city`, then `bad_request` for mediaType/tmdbId) -> limiter -> `isKnown` (503 `unavailable` if the check itself throws, same as /brief) -> 404 `{"error":"unknown_title"}` -> work. The 404 test spies on `resolve`, `header`, every Qloo method and the fake DB call log, and asserts all are untouched. 400s do not spend limiter budget (test proves it with max 1). The limiter is 20/min, keyed by `clientAddress` (rightmost X-Forwarded-For; test covers spoofed leftmost). `/title-locations` has no Qloo/TMDB at all, its own 60/min limiter, `bad_request` 400, `[]` for unknown titles, ordering and 20-row cap as specified. The real run shows the limiter also counts the 404 (limiter is before the gate by ruling).
- R36: the unfiltered fetch is `getEvidence(sql, "places_open", entityId, city, () => qloo.places(entityId, city, []))`; artists use the brief's city-independent `"artists"` kind. Tests: kinds written are exactly `places_open` and `artists`; a pre-seeded `places` row for the same entity+city is NOT served to plan-night; plan-night's write leaves the `places` row object untouched and creates no `places` upsert; plan-night's venues do not leak into the brief's `venues` section; the brief's cached artists ARE reused by plan-night. Mutation check: changing the kind back to `"places"` fails 5 tests.
- No LLM, no migration, no new dependency.

Service behaviours: resolve and header run in parallel like the brief. A throwing `resolveTitle` gives two fixed-sentence `error` sections (status 200, original to `onError("resolveTitle")`); an unresolved title gives two `empty` sections with the exact "Qloo has no entity for this title yet, so there is no taste data for it." note; a throwing Qloo call or evidence read gives a fixed error section for that section only; a client `status:"error"` section is sanitised exactly as in `brief.ts` (rate-limit wording maps to the "busy" sentence). Places: `filterVenues` with the union of both business types' blocklists (hotel, banquet, lodging, resort, motel; names and tags), cap 6; if everything was lodging the section becomes `empty` with a note and keeps provenance. Artists cap 5. Provenance preserved as returned. `title` is `deps.header(...)?.title ?? null`.

## SPA behaviour (as specified)

- `LocationsPanel`: renders nothing when unconfigured (and does not fetch), while loading, on any error (network, 5xx, 429) and for `[]`. Otherwise a card "Filmed in & set in" with "Shot in Chandni Chowk, Delhi" / "Shot in Delhi" / "Set in Delhi", city a `Link` to `/pulse?city=<slug>` with accessible name and title "See what's coming for <City>", and the exact source note (straight apostrophes, as written in the brief). Query key `['pulse-title-locations', mediaType, tmdbId]`, `staleTime` 6 h, `retry: shouldRetry` (no retry on 4xx).
- `PlanNightCard`: nothing when unconfigured; collapsed state has a labelled `<select>` (placeholder "Choose a city", options from `PULSE_CITIES`) and a "Show me places" button (`min-h-11`, disabled until a city is chosen). Nothing is fetched until submit (asserted). Headings: `Fans of <title> in <City> over-index on these spots` (title falls back to "this title") and `…and these artists`. Places show name, address if present, price marks if present (₹ for India, $ elsewhere, same `Price level n of 4` label as the brief). Artists are chips. Provenance shown as "Source: Qloo. <limits>". Invite text is a read-only labelled textarea: `Movie night? <title> — fans of it in <City> love spots like <A> and <B>. Want to go?`; with no places the part is omitted: `Movie night? <title>. Want to go?`. Actions: Share (only rendered when `navigator.share` exists; AbortError ignored, other failures show a gentle message), WhatsApp (plain `https://wa.me/?text=<encoded>` link, `target="_blank" rel="noopener noreferrer"`), Copy (clipboard with "Copied" in a `role="status" aria-live="polite"` region; on failure or no clipboard it selects the textarea text and says so). Errors: 404 `unknown_title` -> muted "Plan the night works for titles on Spotlight's release radar."; 429 -> "Please wait about N seconds and try again." (or "a moment"); network/other -> "Couldn't load places just now…" with Retry; section `empty`/`degraded`/`error` show their note, `error` also a "Try again". Loading uses the existing `Skeleton` in a `role="status" aria-busy` region. `retry:false` on the query because every attempt spends Qloo budget and the card has its own Retry. Everything is rendered as text (test with `<b>`/`<script>` names).
- The invite text contains only the title, the city and public venue names; a test seeds a session id in localStorage and a venue address and coordinates and asserts none appear in the text or the wa.me URL, and that the URL's only query key is `text`. The component never calls `fetch` itself (asserted).

Design choices worth a glance (the brief was ambiguous): two place names joined with " and "; no-places invite wording `Movie night? <title>. Want to go?`; validation checks city before mediaType/tmdbId (same as /brief).

## Tests and results

| Command | Result |
|---|---|
| `npm --prefix services/pulse test` | 739 passed, 24 skipped (763). Baseline was 687 + 22 skipped. |
| same with `PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test` | 763 passed (46 files), 0 skipped. Baseline with PG was 709. |
| `npx vitest run` (SPA) | 726 passed (49 files). Baseline 679. |
| `npm run typecheck` (5 tsconfigs) | clean |
| `npm run lint` | 69 problems, identical to baseline. (First run showed 70 because `inviteText` was exported from the component file, a new react-refresh warning; moved it to `lib/planNightInvite.ts`.) |
| `npm run build` | OK |
| `.venv/bin/python -m pytest -q` | all pass |

New tests: service `routes/titleLocations.test.ts` (validation, 429 before any DB call, ordering/mapping/cap/city-name, 503, exact query and params), `routes/planNight.test.ts` (validation order, limiter 20 then 429 + Retry-After + XFF, separation from /brief, 404 with zero calls, happy path caps and lodging filter, kinds, caching, header failures, R36 non-contamination, failure sections, sanitising), `db/locations.test.ts` (exact column list and params), `planNight.integration.test.ts` (real PG, skipped without the env var, inserts and cleans its own rows; checks the title_locations read and that only `artists` and `places_open` rows are written). SPA: `LocationsPanel.test.tsx` (11), `PlanNightCard.test.tsx` (29), `TitleDetail.test.tsx` (4, new; there was no TitleDetail test before: mounting order via document position, unconfigured, no-record case), `pulseApi.test.ts` (+3).

## TDD evidence (service)

RED, before any implementation (`npm --prefix services/pulse test`): `Failed to load url ./planNight.js`, `Failed to load url ./titleLocations.js`, and `TypeError: getLocationsForTitle is not a function`; "Test Files 3 failed | 36 passed". GREEN after implementation: one failure left, a wrong expectation in my own test (city name is "New York City", not "New York"); fixed, then 739 passed. Extra mutation check: with the kind changed from `places_open` to `places`, 5 tests failed (kinds, three R36 tests, the throwing-artists test), then restored.

## Real run (fixtures mode, local PG, port 8799)

Inserted one `release_items` row (999900001 "Saffron Nights"), a `title_ratings` row (tt9999001), and title_locations for delhi (filmed, "Chandni Chowk", both) and new-york (set, wikipedia).
```
/title-locations?mediaType=movie&tmdbId=999900001 -> 200 [{"city_slug":"delhi","cityName":"Delhi","kind":"filmed","landmark_label":"Chandni Chowk","source":"both"},{"city_slug":"new-york","cityName":"New York City","kind":"set","landmark_label":null,"source":"wikipedia"}]
/title-locations unknown id -> 200 []      /title-locations?mediaType=bad -> 400 {"error":"bad_request"}
/plan-night delhi, known title -> 200 {"title":"Saffron Nights","cityName":"Delhi","places":{"status":"ok","data":[6 venues...
/plan-night unknown id -> 404 {"error":"unknown_title"}
/plan-night?city=atlantis -> 400 {"error":"unknown_city"}     tmdbId=abc -> 400 {"error":"bad_request"}
22 rapid calls (after 2 earlier counted ones): 200 x18, then 429 x4 (Retry-After: 55 on a later call); /brief still 200 afterwards
```
`SELECT entity_id, city_slug, kind, status FROM qloo_evidence`:
```
fx-tt9999001 |        | artists      | ok
fx-tt9999001 |        | demographics | ok
fx-tt9999001 | delhi  | heatmap      | ok
fx-tt9999001 | delhi  | place_tags   | ok
fx-tt9999001 | delhi  | places       | ok   <- written by my later /brief check, not plan-night
fx-tt9999001 | delhi  | places_open  | ok
fx-tt9999001 | mumbai | places_open  | ok
fx-tt9999001 |        | trends       | ok
```
Mumbai was only ever hit by /plan-night and has `places_open` and no `places` row; the delhi `places`, `heatmap`, `place_tags`, `demographics` and `trends` rows came from the `/brief` call I made at the end to confirm the separate limiter. I did not take the evidence snapshot before that call, so the plan-night-only proof in the real DB is the mumbai row (plus the unit tests). Cleanup: deleted qloo_evidence, qloo_entities, title_locations, title_ratings and release_items rows for the synthetic title (verified 0 left; 18,069 other pre-existing title_locations rows untouched); the server process was stopped (healthz no longer answers).

## Files changed

Service: `services/pulse/src/{server.ts, brief.ts, evidence.ts, planNight.ts, planNight.integration.test.ts, db/locations.ts, db/locations.test.ts, routes/params.ts, routes/planNight.ts, routes/planNight.test.ts, routes/titleLocations.ts, routes/titleLocations.test.ts}`, `shared/types/pulse.ts`.
SPA: `src/components/title/{LocationsPanel.tsx, LocationsPanel.test.tsx, PlanNightCard.tsx, PlanNightCard.test.tsx}`, `src/lib/{planNightInvite.ts, pulseApi.ts, pulseApi.test.ts}`, `src/routes/{TitleDetail.tsx, TitleDetail.test.tsx}`.

## Self-review

- Brief and rulings: all items covered, including exact strings (copy-rule headings, source note, 404 message, invite template). R35 ordering and R36 separation are tested, not just asserted in prose. 
- Accessibility: labelled select, status regions (loading, copy confirmation, one sr-only "ready" announcement), 44 px controls, link accessible name contains the visible city name.
- 375 px: card is a single column (`flex-col`, wrapped action buttons, `basis-full` address lines); I did not view it in a browser (not required), so the visual check is the controller's.
- Tests are deterministic (fake sql, injected clock for limiters, mocked network); SPA output is pristine (router future flags passed, act-wrapped settling).

## Concerns

- Low: no browser check of the two cards. The `userEvent` clipboard stub means the copy tests install their own `navigator.clipboard` after `userEvent.setup()`, which is noted in the test.
- Low: `/title-locations` returns rows only for cities in `pulse_cities.json`; a title_locations row for any other slug is dropped by design (nothing to link to).
- Low: invite wording when the title is unknown reads "Movie night? this title ..." (the brief's fallback applied literally); the page nearly always passes a real title.

---

# Fix report, round 1 (commit follows `b8cc87c`; see `git log`)

## Changes

- IMPORTANT, state surviving a title change. `PlanNightCard` is now a thin wrapper that returns null when Pulse is unconfigured and otherwise renders `PlanNightCardForTitle` with `key={`${mediaType}-${tmdbId}`}`. All state (`draft`, `requested`, the query, the copy/share status) therefore resets whenever the title changes, even if a parent forgets a key. `TitleDetail.tsx` also passes the same key on `<PlanNightCard>`. `LocationsPanel` confirmed fine: it has no local state and its React Query key includes `mediaType` and `tmdbId`, so it shows nothing (while loading) or the new title's own rows; a TitleDetail-level test now proves it across cached titles. Both keys were mutation-checked: without the inner key two card tests fail; without both keys the TitleDetail navigation test fails.
- Ruled in 1: `getLocationsForTitle` SQL ends `ORDER BY kind, city_slug LIMIT 40` with a short why-comment; `db/locations.test.ts` asserts the statement ends with that clause (values unchanged). The handler still caps at 20 after filtering.
- Ruled in 2: `inviteText(title, cityName, places, mediaType = 'movie')` in `lib/planNightInvite.ts`. With a title the wording is unchanged. With a null/blank title: `Movie night in <City>? Fans of this film|show love spots like <A> and <B>. Want to go?`, and `Movie night in <City>? Want to go?` when there are no places. The card passes the real title (prop, else the response's) or null, and its `mediaType`; the heading keeps its "this title" fallback.
- Ruled in 3: the copy-rule heading and the "…and these artists" heading render only when that section has rows. Otherwise only the section's note is shown, or "No places to show for this one." / "No artists to show for this one." (for `error` sections: the note, or "Qloo didn't answer this part.", plus Try again).
- Ruled in 4: select is `text-base ... sm:text-xs`, invite textarea `text-base ... sm:text-sm` (the only text controls in the cards).
- Ruled in 5: `titleLocations.ts` now exports a pure `shapeTitleLocations(rows, limit = 20)`; the handler uses it. The cap test seeds 26 rows (25 valid: 10 cities x 2 kinds plus 5 repeats of Delhi/set, and one non-launch city), asserts length is exactly 20 and equals the independently computed ordered prefix; a second test checks the pure function at limits 3, 20 and 100. (Only 20 distinct launch-city/kind pairs exist, so repeats are the way to exceed 20.)

## Covering tests

- `PlanNightCard.test.tsx` (now 42): "across titles" (A submit -> B: no new request, select back to placeholder, no A places/headings/invite; back to A: still no request until submit), same id with another media type, copy message cleared on title change; empty/degraded-no-data/error/empty-array sections show no heading and the right note or fallback; `inviteText` table (title present/absent x places present/absent x movie/tv, plus blank place names); card without a title (invite and heading); class assertions for 16px controls.
- `TitleDetail.test.tsx` (now 6): navigation test A (city chosen, places shown) -> B with B's detail pre-cached -> A, asserting `fetchPlanNight` call count stays 1, select reset, nothing from A shown; and each title shows its own locations.
- Service: `routes/titleLocations.test.ts` (exact cap and ordered prefix, pure shaper), `db/locations.test.ts` (LIMIT 40).

## Commands and output

```
npm --prefix services/pulse test                      -> 740 passed, 24 skipped (764)
PULSE_TEST_DATABASE_URL=...54329/spotlight_test ...   -> 764 passed (46 files), 0 skipped
npx vitest run                                        -> 741 passed (49 files)
npm run typecheck                                     -> clean (5 tsconfigs)
npm run lint                                          -> 69 problems (65 errors, 4 warnings), unchanged
npm run build                                         -> OK
.venv/bin/python -m pytest -q                         -> all pass
```

Not touched, as instructed: inline link target size in LocationsPanel, focus after results.

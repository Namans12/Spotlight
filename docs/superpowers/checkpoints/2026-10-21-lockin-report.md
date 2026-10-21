# Live spike lock-in (L1-L8): report

Branch `feat/release-pulse`. Commits:
- `ed33b23` Pulse resolve: tell a TMDB 404 apart from a TMDB outage (L1)
- `4f27395` Pulse Qloo client: lock in what the live spike showed (L2-L6)
- `b31a19d` Plan the night: filter places to food-and-drink tags (L7)
- `1354bac` Pulse: keep the live Qloo spike as a diagnostic, record the findings (L8)

## What changed

**L1.** New `services/pulse/src/tmdbLookup.ts`: `lookupTmdbTitle(mediaType, tmdbId, deps?)`. Returns
`{imdbId,title,year}`; `null` only for a TMDB 404. Retries (3 attempts, 250 ms then 750 ms, 8 s timeout each)
on network errors, timeouts, 429 (Retry-After in seconds, capped at 2 s) and 5xx, and on a 200 with an
unreadable body; throws `TmdbUnavailableError` (carries `attempts`) when spent. Any other 4xx (e.g. 401, a
rejected key) throws `TmdbUnavailableError` at once with no retry (my choice: it must never read as "no such
title"). A missing/blank key throws `TmdbNotConfiguredError` before any request. Errors contain only
"timed out", "network error" or "HTTP <status>" plus media type and id: no key, no URL, no `cause`.
`resolve.ts` calls it in place of `resolveOmdbLookup` (module-level seam, so tests mock `./tmdbLookup.js`);
the lookup is memoised per resolution with a wrapper object so a 404 is remembered too (closes deferred T6).
A throw propagates and nothing is written. Doc comments in `resolve.ts` and `config.ts` updated
(`assertTmdbConfigured` still stops startup without a key, now because every unrated title would fail to
resolve, not because it would be cached as a miss). `lib/omdb.ts` untouched.

**L2.** `demographics()` maps `empty` to the exact note requested (em dash as given).

**L3.** `section(recipe, {thinSignal:true})` in `client.ts` for `places`, `artists`, `brands` and the venue
step of `placeTags`: envelope `error` with code `QLOO_CONTRACT` and `retryable !== true` becomes `empty`,
`data:null`, the requested note, provenance kept, plus `console.warn("qloo contract rejection (<call>): QLOO_CONTRACT")`.
`<call>` is the provenance call name (`recommend_artists`, `recommend_brands`, `recommend_places`). It is not
applied to `callTool` (agent), heatmap, entity_tags or trends. Rate-limit still throws `RateLimitedError`
(retried then error section); `QLOO_AUTH` stays `error`.

**L4.** `recipes.foodThemes` + `FOOD_TAG_PREFIXES` (prefix match on the tag id, not substring), applied in
`client.placeTags` (comment explains the cache holds the filtered list, so a filter change takes effect as
rows expire in 3 days). Dedupe by lowercased trimmed name keeping highest affinity, sort desc (null affinity
last, stable), cap 12; nothing left gives `empty` with the requested note, provenance (both calls) kept.
Fixture tag ids became `urn:tag:genre:place:fx-tag-N` (names still `Fixture Tag N`). `businessFit` works on
realistic names (new test; no change to `score.ts`).

**L5.** `BRAND_FOOD_TAG` constant in `recipes.ts` ("verified live 2026-10-21"); brand call sends
`include_tags:[tag]`, params carry `include_tags`, limits text replaced as specified, cap 10 kept.
Artists stay untagged (tested).

**L6.** `recipes.dedupeVenues`, applied in the `places` recipe's `pick` (so before the brief/plan-night caps).
Key = lowercased trimmed name + address; highest affinity wins (null lowest) in the first copy's position.
Decision: a venue with no address is never merged (cannot be told from two branches of a chain); same name at
different addresses is kept.

**L7.** `placeTagIds` and `TAGS_PER_QUERY` exported from `brief.ts` (not duplicated), plus a shared
`BROAD_VENUES_NOTE`. `planNight.ts` has `PLAN_NIGHT_TAG_QUERIES = [restaurant, cafe, bar, dessert]`; the tag
lookup runs inside the `getEvidence` fetch (cache hit costs no tag calls), `places_open` kind and key
unchanged, lodging filter and cap still applied on read, tag failure gives `degraded` + the brief's note and
`skipPersist`. The max-10 tag cap comes from the existing `MAX_INCLUDE_TAGS` slice in the `places` recipe
(4 queries x 2 gives at most 8 anyway).

**L8.** (a) `recipes.ts` header rewritten (verified live vs unverified/known-empty). (b) Spike run, below.
(c) `probe*.ts` deleted; `spike/spike.ts` kept with a usage header, rewritten to be lint-clean (it had 7
`no-explicit-any` errors that would have added to the lint baseline) and to resolve via `lookupTmdbTitle`.
(d) `docs/superpowers/checkpoints/2026-10-21-live-qloo-spike-findings.md` written. `.gitignore` entry for
`services/pulse/spike/out/` committed.

## Tests added / changed

New: `tmdbLookup.test.ts` (15). `client.test.ts` +~28 (L2, L3 x4 calls x contract/auth/rate-limit, venue-step
stops before entity_tags, L4 x7, businessFit realism, L5 x2 with exact harness args, L6 x4). `resolve.test.ts`
+3 (TMDB outage propagates and writes nothing, also on the late title lookup; 404 is one TMDB call and one
cached miss). `routes/planNight.test.ts` +5 net (tag args exactly, dedupe, cache hit costs no findTags, memo
shared with the brief, degraded and not cached then recovered).

RED to GREEN: each new test file/block was run against the old code first. `tmdbLookup`: module missing
(file failed to load). `resolve`: 8 failures before the change (new outage tests plus the rewired mock).
`client`: 14 failed (L2 1, L3 4, L4 5, L5 1, L6 3) before the implementation, 82 pass after.
`planNight`: 5 failed before, all pass after.

Intentionally changed existing tests (behaviour changed on purpose):
- `resolve.test.ts` / `resolve.integration.test.ts`: mock `./tmdbLookup.js` instead of `lib/omdb.js`
  (default answer null = 404); variable `omdb` renamed `tmdb`.
- `client.test.ts` "derives place tags": its tag id `urn:tag:x` is not a food family and is now (correctly)
  dropped, so the input uses `urn:tag:genre:place:fx-1`.
- `routes/planNight.test.ts` "asks Qloo for places with NO tag filter" replaced by the filtered-tags test; the
  old `findTags ?? 0` assertion is gone (plan-night now calls findTags).

## Final checks

- `npm --prefix services/pulse test`: 818 passed + 24 skipped (842; baseline 766 + 24).
- With Postgres: 842 passed, 0 skipped, but only on a fresh schema copy (see concern 1). On `spotlight_test`
  itself: 840 pass, 2 `board.integration` tests fail.
- `npm run typecheck`: clean. `npx vitest run`: 741 passed. `.venv/bin/python -m pytest`: 241 passed.
- `npm run lint`: 69 problems, identical to baseline.

## Live spike (one run of `spike/spike.ts`, about 70 calls) plus one small plan-night check (about 8 calls)

- Resolution: 12 of 12 releases resolved (bar was 7 of 10), no TMDB errors.
- Cafe-tag places: full lists (20 venues) for all three probe titles in Delhi, Mumbai and New York; all with an
  address, none with lat/lon or tags.
- Artists/brands: no `error` anywhere. Brands `ok` x 3 (Delhi); artists `ok` for two titles and `empty` with the
  thin-signal note for one brand-new title (one contract-rejection warning appeared in stderr: this is the
  thin-signal case the live run found).
- Themes: all food-family names (dishes, cuisines, restaurant/cafe genres); no hobbies/keywords. 7 of 9
  city-title combinations had 3-9 themes; 2 of 9 (both New York) came back `empty` with the new note.
- Brands: all food and drink (soft drinks, energy drinks, coffee chains).
- Demographics: `ok` for the established title; `empty` with the new honest note for the two brand-new ones.
  Trends: `empty` for all.
- Plan the night tag set for one title in Delhi: tag lookup gave 7 ids; of 20 venues, 11 overlapped with the
  unfiltered list; the filtered list dropped the religious monument but still contained a museum and a banquet hall
  (the banquet hall is removed on read by the lodging filter; a museum is not covered).
- The spike's stdout (which prints names) was kept only in a scratch file, now deleted; no Qloo data is in any
  committed file or in this report.

## Concerns

1. **Environmental, pre-existing:** the 2 `board.integration` tests fail against `spotlight_test` at the
   baseline commit too. That database now holds 90 real release_items rows (loaded for the live spike), and
   `listCandidates` keeps only the top 20 by popularity, so the tests' zero-popularity rows are crowded out.
   Not a code regression; I verified the full Postgres suite on a throwaway schema-only copy (created and
   dropped). Fix options: use a separate empty DB for tests, or make those tests insert rows with a very high
   popularity. I did not touch the data or the tests.
2. Themes are empty for some cities (2 of 9, New York): `entity_tags` is asked for 20 tags over 10 venues and
   is mostly noise there. Possible follow-ups: raise the limit, or tag more venues.
3. Plan the Night still can show non-food landmarks that carry a place-genre tag (a museum appeared).
4. A genuine recipe bug on artists/brands/places now shows as `empty` to users; the only signal is the
   `qloo contract rejection (...)` warn line, so watch the server logs.
5. Venue dedupe deliberately ignores venues without an address. NYC branches of one chain (same name, different
   address) are kept, which is correct but looks like duplicates.

## Follow-up: thin-signal heatmaps kept the board pending

Commit: see `git log` ("Pulse Qloo client: thin-signal titles are empty for every entity-signal call").

**Cause.** For obscure titles `qloo_where_popular` answers HTTP 400 `QLOO_CONTRACT`. L3 only mapped that for
artists, brands, places and the venue step, so the heatmap stayed an uncached `error`: the card stayed
`pending`, was re-enqueued on every poll, and the warm counted it failed.

**Change.** The mapping is now in the one `section()` path of `client.ts`, applied by default to every call
keyed on a title: heatmap, demographics, trends, the `entity_tags` step of `placeTags`, artists, brands,
places (and the venue step). A rejection (code `QLOO_CONTRACT`, `retryable` not true) is `empty`,
provenance kept, plus one `console.warn("qloo contract rejection (<call>): QLOO_CONTRACT")`. Notes:
heatmap "Qloo doesn't have enough local taste data on this title yet to map where its fans are."; all
others "Qloo doesn't have enough taste data on this title yet to suggest this." Recipes carry optional
`thinSignalNote` and `emptyNote` (demographics' not-yet-profiled wording now applies only when the call is
simply empty, so a contract rejection on demographics gets the thin-signal note). Opted out
(`thinSignal:false`): the `describe` type lookup behind trends. `findTags`, `entityByImdb`, `searchTitles`
and the agent's raw `callTool` are untouched (still throw). Auth stays `error`; rate limit still retries,
then `error` (raw `callTool` still raises `RateLimitedError`).

**Board consequence (confirmed by test).** A title whose heatmap and place tags are `empty` counts as
`warmed`, leaves `pending`, is ranked (local affinity 0, why-line "no local signal yet"), is not
re-enqueued on the next poll, and a second warm run makes no Qloo call. The board and warm code needed no
change (they already treated `empty` as an answer); the new test drives the real harness client with a
scripted contract-rejecting transport through `warmCity` and `buildBoard`.

**Tests added.** `client.test.ts`: per call (7 cases) contract gives `empty` + exact note + one warn + no
retry; auth stays `error` with no warn; rate limit retried 3x then `error`; raw `callTool` rate limit raises
`RateLimitedError`; demographics/heatmap plain-empty wording; findTags/entityByImdb/searchTitles still throw;
thin heatmap cached as `empty` through `getEvidence` (one Qloo call across two requests). `warm.test.ts`: the
end-to-end board case. RED first: 5 of the new tests failed before the change (heatmap, demographics, trends,
entity_tags, cache), plus the demographics wording case when I first moved the mapping.

**Live check.** `qloo.heatmap` for the 5 obscure titles (entity ids from the local `qloo_entities`) in Delhi:
5 of 5 now `empty` with the thin-signal note, 0 `ok`, 0 `error` (5 warn lines logged). Throwaway script
deleted.

**Cleanup.** `spike/probe5.ts` deleted; `spike/` holds only `spike.ts` (and gitignored `out/`). Findings doc
gained a follow-up section.

**Checks.** Service 845 passed + 24 skipped (869). With Postgres on the clean `pulse_itest`: 869 passed, 0
failed, 0 skipped. Typecheck clean, SPA 741, pytest 241, lint 69 (baseline).

**Concerns.** A real recipe bug on any of these calls now reads as `empty` (the board shows "no local
signal yet" for it); the warn line is the only signal, so watch the server log after recipe changes. If
Qloo also returns QLOO_CONTRACT for a heatmap because of a bad `within` city string, every title in that
city would silently be "no local signal": worth a glance at the log's warning count per run.

## Review fixes (round 1)

**Important: circuit guard.** `client.ts` keeps, per call name and per client instance (closure), a ring of
the last 20 outcomes (true = contract rejection; success, other errors and thrown failures are false;
`thinSignal:false` lookups are not tracked). A rejection arriving when the ring has at least 10 samples and
at least 90% are rejections trips the call: `section()` then returns the ordinary `error` section (the
harness's own error note; never cached by `getEvidence`, so retried) and logs one `console.error`
("qloo contract rejections for <call> exceed 90% of the last 20 calls ... the recipe may be broken (not a
thin-signal title)") per trip. The per-rejection `console.warn` continues while not tripped. The trip ends
when the ratio drops below 50%. Trip is only entered on a rejection (a non-rejection never trips it, so an
auth error cannot emit the message). Tests (RED first, 8 failing, all scripted): 9 rejections stay `empty`,
the 10th is `error` with exactly one console.error and no repeat; every 4th call rejected over 40 calls never
trips; after a trip 10 successes leave the ratio at exactly 50% (still tripped), the 11th resets and `empty`
resumes; it can trip again after a reset (needs 18 of 20, since the ring was all successes); per-call rings
(broken heatmap leaves artists and brands `empty`); per-instance state; QLOO_AUTH and thrown transport errors
count as non-rejections and stay `error`; a tripped error is not cached.

**Small items.**
1. `recipes.ts` header now says the thin-signal mapping covers every entity-signal call, with the circuit guard.
2. `tmdbLookup.test.ts`: spies on `AbortSignal.timeout` and asserts 8000 on each of three attempts; the default
   is the exported `TMDB_TIMEOUT_MS` (asserted equal to 8000).
3. `tmdbLookup.ts` cancels unused bodies (404, 429, 5xx, other 4xx) in a try/catch; tests check `cancel` is
   called for each status and that a failing cancel does not break the lookup.
4. Test: a QLOO_CONTRACT on the `describe` lookup behind trends is an `error`, no warn, no trends call.
5. `spike.ts` prints counts, statuses, booleans and tag-id families only; names and heatmap cells need
   `SPIKE_SHOW_NAMES=1`; header updated. (Typechecked and linted; not re-run live.)
6. businessFit test uses invented names. I did not use the three suggested names verbatim: "Test Pastry Shop",
   "Test Snack Dish" and "Test Cold Drink" contain none of the business types' query words (cafe, coffee,
   bakery, dessert / snacks, dessert, beverage, street food), so the assertions would not hold. I used
   "Test Dessert Shop", "Test Coffee Stop", "Test Bakery Counter", "Test Snacks Box", "Test Cold Beverage" etc.,
   keeping the same ratios.
7. `services/pulse/.env.example`: the one-line comment under QLOO_FIXTURES (the real `.env` was not touched).
8. `venuesToTag` dedupes entity ids; test checks `entity_tags` gets `["v-1","v-2"]` from `v-1, v-1, v-2`.

**Checks.** Service 936 passed + 24 skipped (960; includes tests other agents have added since); with
Postgres on the clean `pulse_itest`: 960 passed, 0 failed. Typecheck clean, SPA 741, pytest 241, lint 69
(baseline). Only the files above were touched (no llm/ or agent/ files).

**Concern.** The guard keeps per-process memory, so after a restart it needs 10 fresh samples before it can
trip; a broken recipe on a cold process caches up to 9 thin-signal `empty` answers before the guard trips.

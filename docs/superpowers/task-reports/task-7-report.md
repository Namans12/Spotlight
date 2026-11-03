# Task 7 report: cached evidence and the streamed brief

Commit: e83935f "Stream release briefs section by section from cached Qloo evidence" (branch feat/release-pulse).

## What was built (all under services/pulse/src)
- `geo.ts` (haversineKm, labelCell; ties: smaller distance then name), `businessTypes.ts` (BUSINESS_TYPES exactly as briefed, `isBusinessType`, `filterVenues`).
- `db/evidence.ts` (EvidenceSql, readEvidence, upsertEvidence; ON CONFLICT (entity_id, city_slug, kind) DO UPDATE; params/payload bound as JSON text cast `::text::jsonb`, because postgres.js would double-encode a string for a jsonb parameter). `db/locations.ts` (getTitleLocations, getNeighbourhoods).
- `evidence.ts` (EvidenceKind, getEvidence, peekEvidence), `brief.ts` (BriefDeps, DraftCampaign, streamBrief), `http/ndjson.ts` (startNdjson), `routes/brief.ts` (briefHandler), `titleHeader.ts` + `server.ts` wiring, `config.ts` `assertTmdbConfigured`.
- `testing/fakes.ts`: framework-free fake sql + `fixtureDeps` shared by the tests.
- Header lookup (`titleHeader.ts`): release_items, then calendar_entries, then `tmdbDetail` only when neither has the title (TMDB failure -> null -> header title "Untitled").

## Rulings
- R10: filterVenues lower-cases and does substring match of every blocklist word against the name and each tag, so empty tags work. Brief assembly never reads venue tags or lat/lon (labelCell reads heat cell coords, which the fixture and harness provide; venues are passed through untouched). Test: null coords, empty tags.
- R17: every section runner is wrapped; a throw becomes `{status:"error",data:null,provenance:[],note}` with a FIXED sentence (rate-limit sentence for RateLimitedError, else generic), the real cause goes to `deps.onError` only (server logs `err.message`). Test asserts no secret/stack text in the stream. resolveTitle throwing: all Qloo sections are error sections with a note mentioning Qloo, header qlooEntityId null, hook still computed, zero upserts. Header lookup failure is also absorbed. Unresolved (entityId null): `empty` sections with the exact specified note, no Qloo calls made. campaign drafter throwing -> error section; `done` still sent.
- R19: `CACHEABLE = ok|empty|partial|degraded`; getEvidence serves a row only if fetched_at is <= 3 days old AND status cacheable; otherwise fetches, returns the fresh result as-is, and upserts ONLY a cacheable result (an error never overwrites an older good row; test asserts zero upserts and old row intact). peekEvidence uses the same rule and never fetches (null for missing/stale/error/needs_input). A fetch that throws caches nothing. Choice: a failed cache WRITE is logged and swallowed (caller already holds a good answer); a failed cache READ propagates (section becomes error).
- R20: heatmap cached raw as returned; labels applied in the `where` runner at read time via getNeighbourhoods + labelCell. Tests: upsert payload cells have no `neighbourhood`, emitted cells do; a cached heatmap is relabelled after the neighbourhoods table changes with no second Qloo call. Deviation by choice: if the neighbourhoods read fails, `where` still streams with null labels (logged) rather than turning into an error section. `status`/`params` columns filled; params = first provenance entry's params or `{}`.
- R21: logic in `routes/brief.ts` (`briefHandler(deps): Handler`); server.ts is wiring (pool, createQlooClient, resolveTitle bound, createTitleLookup(tmdbDetail), stub campaign, onError logger) and calls `assertTmdbConfigured(config, process.env)` which throws "TMDB_API_KEY is required unless QLOO_FIXTURES=1 ..." at startup (verified; tested in config.test.ts).

## Behaviour notes
- Sections run concurrently and are merged with Promise.race over pending section promises; the Qloo client's limiter bounds Qloo concurrency. Deterministic test uses a deferred heatmap: all other sections arrive first, campaign drafter not yet called, then where/campaign/done.
- Campaign is invoked last with `{sections, header, businessType}` (collected sections only, campaign excluded).
- Tag ids: `qloo.findTags(q,"place")` per placeTagQueries entry, top 2 per query (max 8, below the recipe's cap of 10), memoised per QlooClient in a WeakMap (failures not memoised, failure -> fewer tags). Lookups happen inside the places fetch, so a cache hit costs no tag calls.
- venues all filtered out -> `empty` with an explanatory note (the cache keeps the unfiltered list; the filter is applied at read).
- hook: LocalHook.placeName = city name (title_locations has no place name; landmark = landmark_label). Rows with NULL source are excluded (no attribution = no provenance). Provenance one entry per (source, kind), source "both" yields wikipedia and wikidata entries; limits text mentions public Wikipedia categories/Wikidata, varying coverage, partial India coverage.
- Disconnect: `startNdjson` listens to `res.on("close")`, aborts an AbortController and stops writing; streamBrief takes `signal` and races the merge loop against it (returns immediately, never drafts the campaign). In-flight Qloo calls finish and fill the cache (cheap, useful). A bug-level exception after streaming began is logged and the stream ended WITHOUT `done` (BriefEvent has no error type; missing `done` marks the stream incomplete).
- Extra response header `X-Accel-Buffering: no` to stop proxy buffering.
- Validation order: unknown_city, unknown_business_type (Object.hasOwn, so "constructor" is rejected), then bad_request (mediaType movie|tv, tmdbId /^\d{1,15}$/ and >= 1).

## Tests and results
New: geo (5), evidence (25), evidence.integration (3, real Postgres jsonb round trip, upsert-in-place, '' city slug, errors not stored, locations/neighbourhoods reads), db/locations (2), brief (32), routes/brief (13: 400 paths via in-process http server on port 0 closed in afterEach, NDJSON framing, disconnect with a fake res), titleHeader (4), config (+2).
Commands, all green:
- `npm --prefix services/pulse test`: 175 passed, 5 skipped (integration, no DB url)
- `PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test npm --prefix services/pulse test`: 16 files, 180 passed
- `npm run typecheck`: clean
- root `npx vitest run`: 414 passed
- `.venv/bin/python -m pytest -q`: all passed

TDD: tests written first; first run: 6 files failed on missing modules (geo, evidence, brief, locations, routes/brief, titleHeader later) and 2 config tests failed (`assertTmdbConfigured is not a function`). After implementation: all green (one typecheck fix for the "campaign" key narrowing).

## Real verification (QLOO_FIXTURES=1, PORT=8799, DATABASE_URL local spotlight_test)
Inserted: release_items "Pulse Fixture Film" tmdb 999000001 (movie, 2026-12-12), title_locations (delhi, filmed, both, "Fixture Landmark"), title_ratings imdb tt9990001. 25 Delhi neighbourhoods already existed.

`curl -sN "localhost:8799/brief?city=delhi&type=cafe&mediaType=movie&tmdbId=999000001"` (abbreviated):
```
header {"tmdbId":999000001,"mediaType":"movie","title":"Pulse Fixture Film","posterUrl":"https://example.invalid/poster.jpg","releaseDate":"2026-12-12","city":"delhi","cityName":"Delhi","businessType":"cafe","qlooEntityId":"fx-tt9990001"}
section order: who(ok) hook(ok,1) where(ok,12 cells) trend(ok,12) venues(ok,6) themes(ok,4) artists(ok,5) campaign(empty "Campaign drafting is added in a later task.")
{"type":"done"}
```
where cells came back labelled from the neighbourhoods table (e.g. "Raisina Hill"); hook = `[{kind:"filmed",placeName:"Delhi",landmark:"Fixture Landmark",source:"both"}]` with wikidata + wikipedia provenance. d2c_food order: header who trend themes artists where brands hook campaign done (brands, no venues).
Headers: `200 OK`, `Content-Type: application/x-ndjson; charset=utf-8`, `Cache-Control: no-store`.
Unknown city: `HTTP/1.1 400 Bad Request` `{"error":"unknown_city"}`.
Cache rows after run 1: `fx-tt9990001 | '' | artists/demographics/trends ok`, `| delhi | heatmap/places/place_tags ok` (6 rows). Run 2 took 0.0056s and every row's fetched_at was byte-identical (diff empty), i.e. served from cache with no refetch.
Startup without TMDB_API_KEY and without fixtures: process exits with "TMDB_API_KEY is required unless QLOO_FIXTURES=1: ...".
Cleanup done: deleted qloo_evidence (fx-%), qloo_entities (999000001 and 1), title_locations, title_ratings, release_items rows; counts verified 0; server stopped, port free. Note: my stray curl with tmdbId=1 (fixtures mode, no TMDB key) created a qloo_entities miss row for tmdb 1, which I removed; it shows fixtures mode does cache misses without a TMDB key (the exemption in R21).

## Files
New: geo.ts, geo.test.ts, businessTypes.ts, brief.ts, brief.test.ts, evidence.ts, evidence.test.ts, evidence.integration.test.ts, titleHeader.ts, titleHeader.test.ts, db/evidence.ts, db/locations.ts, db/locations.test.ts, http/ndjson.ts, routes/brief.ts, routes/brief.test.ts, testing/fakes.ts.
Modified: server.ts, config.ts, config.test.ts.

## Self-review
- Brief signatures/names match (streamBrief, getEvidence, peekEvidence, labelCell, haversineKm, filterVenues, BUSINESS_TYPES). `BriefRequest` adds an optional `signal`.
- No secrets in notes/logs; no new dependencies.

## Concerns
- `testing/fakes.ts` is a non-test file in src (typechecked with the service, imported only by tests); it is not imported by server.ts. Could move/exclude later.
- Section-error notes are deliberately coarse (rate-limit vs generic); the cause is only in server logs.
- Task 8 (board) can use peekEvidence directly; Task 9 replaces the stub via `deps.draftCampaign`.

---

# Fix report, round 1

Commit: see `git log` ("Bound the public brief endpoint: de-duplicate evidence fetches, gate on known titles, rate limit").

## Changes
- Important 1 (`evidence.ts`): module-level `inFlight` Map keyed `${entityId}|${citySlug}|${kind}`; `getEvidence` returns the shared promise, clears it in `finally` (rejection included). The whole read-fetch-store sequence is inside the flight, so a caller arriving just as the first finishes cannot slip between cache read and flight check. New optional 7th parameter `opts.skipPersist(section)`; R19 semantics otherwise unchanged.
- R22a: `db/titles.ts` `isKnownTitle(sql, key)`: one parameterized query, EXISTS in release_items OR calendar_entries (media type `COALESCE(media_type, CASE lower(btrim(entry_type)) WHEN 'movie' THEN 'movie' WHEN 'show' THEN 'tv' END)`, same derivation as lib/calendarDb) OR qloo_entities with `not_found = false`. `BriefRouteDeps extends BriefDeps` gains `isKnown` and `rateLimiter`; handler answers 404 `{"error":"unknown_title"}` before streaming and before any resolve/Qloo/header call. If the check itself throws: 503 `{"error":"unavailable"}` (my addition, still before streaming). `deps.header` TMDB fallback untouched.
- R22b: `http/rateLimit.ts`: `createRateLimiter({max, windowMs, maxKeys, now})` sliding-window log (lib/rateLimit.ts is fixed-window, leftmost XFF, no clock or retry hint, so did not fit), refused requests are not recorded, memory bounded by lapsed-key sweep plus LRU eviction at 10,000 keys, each key holds at most `max` timestamps. `clientAddress(req)` = rightmost X-Forwarded-For entry (repeated headers joined), else socket address, else "unknown". 429 `{"error":"rate_limited"}` + `Retry-After`. Server wiring: 30/minute. Order: validation 400 -> rate limit 429 -> isKnown 404 -> stream.
- Ruled-in 1: `sanitiseError` in brief.ts: any `status:"error"` section coming back from a runner or the campaign drafter has its note replaced (rate-limit sentence if the original matches /rate.?limit|429|busy/i, else the generic one), provenance kept as returned, and the original note goes to `onError` (as an Error). Sections this module builds itself (tracked in a WeakSet) keep their own notes.
- Ruled-in 2: `placeTagIds` now returns `{ids, failed}`; when tags failed and Qloo's places section is `ok`, venues become `degraded` with "Venue category filter was unavailable; results are broader than usual." and `skipPersist` keeps it out of the cache (the next brief retries the tags). The earlier test that expected `ok` after a tag failure was updated to `degraded`.
- Ruled-in 3: campaign drafter invoked through `Promise.resolve().then(...)`, so a sync throw or rejection becomes an error section and `done` is still emitted.
- Untouched, as instructed: streaming core, caching rules, deferred minors 4/6/7/8.

## Covering tests (new unless noted)
- evidence.test.ts: concurrent calls share one fetch, same section object, one upsert; rejection clears entry and later call refetches; different entity/city/kind do not share; skipPersist.
- db/titles.test.ts (exact SQL fragments and parameters) and db/titles.integration.test.ts (real Postgres: known via release_items, calendar_entries with media_type, calendar_entries with NULL media_type + entry_type 'show', resolved qloo_entities; not known: cached miss, wrong media type, unknown id).
- http/rateLimit.test.ts: 30 pass/31st refused with retry hint, sliding window, refused not counted, independent clients, LRU bound, lapsed sweep, clientAddress cases.
- routes/brief.test.ts: unknown title 404 with zero resolve/header/Qloo calls; known streams and receives the validated key; 503 on a failing check; gate not run on 400s; 30 pass then 429 with Retry-After and no further work; spoofed leftmost XFF does not change the key; 400s do not spend budget.
- brief.test.ts: client error-section note replaced and original reported, own notes kept, sync-throwing and error-returning drafter, degraded and uncached venues then ok and cached on the next healthy brief.

## Commands and results
- `npm --prefix services/pulse test`: 16 files passed, 3 skipped; 202 passed, 7 skipped
- `PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test npm --prefix services/pulse test`: 19 files, 209 passed
- `npm run typecheck`: clean
- root `npx vitest run`: 414 passed; `.venv/bin/python -m pytest -q`: passed
- RED first: after writing tests, 6 files failed (missing modules), then GREEN after implementation (two test-side slips fixed: fake req lacked headers; default-param `undefined` in a test helper).

## Real run (fixtures mode, local DB, port 8799; synthetic release_items 999000001 + title_ratings)
- Known title: `header who hook trend where artists venues themes campaign done`.
- Made-up id 999000777: `HTTP/1.1 404 Not Found` `{"error":"unknown_title"}`; no qloo_entities row was created for it.
- One client (rightmost XFF 203.0.113.5, leftmost spoofed differently on each request): 30 x 200, then the 31st: `HTTP/1.1 429 Too Many Requests`, `Retry-After: 60`, `{"error":"rate_limited"}`; a different client address still got 200.
- Cleaned up: qloo_evidence, qloo_entities, release_items, title_ratings, title_locations rows removed (counts 0), server stopped, port free.

## Concerns
- The in-process rate limiter and the in-flight map are per instance (as lib/rateLimit.ts is); a multi-instance deployment multiplies the budgets.
- In-flight sharing returns the first caller's result to later callers, including its `now` and `skipPersist` choice (same key, same kind, so equivalent in practice).

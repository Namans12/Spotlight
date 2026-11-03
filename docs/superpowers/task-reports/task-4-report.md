# Task 4 report: Qloo adapter (harness client, fixtures, limiter)

Status: DONE_WITH_CONCERNS. Commit `1d4c79b` "Qloo adapter: harness client, synthetic fixtures, 2-wide limiter with 429 backoff".

## What was built (all under `services/pulse/src/qloo/`)

- `limiter.ts`: `createLimiter({concurrency, backoffMs, sleep?})` and `RateLimitedError`. Semaphore with direct slot hand-off; retries only `RateLimitedError`, waiting `backoffMs[i]` per retry (3 attempts for `[3000, 8000]`), then rethrows. The slot is held during the wait, on purpose (a rate-limited Qloo should slow every caller).
- `recipes.ts`: the only place with tool names, argument keys, REST paths, and result-field readers. Header comment lists what each recipe was built from and which are UNVERIFIED. Also holds the fixed per-call `limits` strings (`limitsFor`).
- `harness.ts`: `createHarnessTransport({connect?, env?, fetchFn?})`. Lazily spawns `services/pulse/node_modules/.bin/qloo mcp` through the MCP SDK `StdioClientTransport` (falls back to `qloo` on PATH), one shared connection, restart-once-per-call when the child died (retry the call on the new connection; a second death surfaces), `close()`. Also `getJson(path, params)` for two REST lookups (see Discrepancies). `McpSession` is the injectable seam used by the tests.
- `client.ts`: `QlooClient` (brief's interface plus optional `close?()`), `QlooEntityRef`, `mapHarnessResult`, `createHarnessQlooClient(transport, {sleep?, now?})`, `createQlooClient(cfg, deps?)` (fixtures when `cfg.qlooFixtures`). Every harness and REST call goes through the limiter (2 wide, `[3000, 8000]`). A harness envelope with `status:"error"`, `error.retryable === true` and a code matching `rate.?limit|429` (the harness emits `QLOO_RATE_LIMIT`) becomes `RateLimitedError` inside the limiter. Section methods never throw: transport failure or exhausted backoff becomes an `error` section with a note; `entityByImdb`, `searchTitles`, `findTags` do throw on failure (an outage must not read as "no such title/tag").
- `fixtures.ts`: synthetic client. `Fixture Café N`, ids `fx-...`, every section has `note: "Synthetic fixture data, not from Qloo."` and provenance `call: "fixture:<call>"`. Heatmap: 12 cells in a spiral within about 5 km of the city, with valid 6-char geohashes. `listTools` returns one `qloo_fixture_echo` tool; `callTool` echoes.
- `mapHarnessResult`: unreadable envelope or a throwing `pick` gives an `error` section. `empty`/`needs_input`/`error` give `data: null` plus a `note` (summary, recovery, warnings, code). `partial`/`degraded` keep `pick(results)` and the note. An `ok` with zero rows is reported as `empty` (decision of mine). Unknown call names get a generic limits string.

## Real harness: tools and schemas found

Evidence: ran `qloo mcp` through the MCP SDK with no key (it starts fine and `tools/list` works; `qloo_find_tags` returned the structured `QLOO_AUTH` error envelope). Raw output saved, not committed, at `/private/tmp/claude-501/-Users-naman-spotlight-qloo/2eeddaa2-d0ec-4b64-9104-ed2efb93071e/scratchpad/tools.json`. Source reading: `services/pulse/node_modules/@qloo/qloo-harness/dist/mcp.js`, `dist/qloo-tools.js`, `dist/workflow-executor.js`, `dist/router.js` (CLI), `README.md`.

Ten tools: `qloo_capabilities, qloo_recommend, qloo_rank, qloo_describe, qloo_where_popular, qloo_compare_audiences, qloo_entity_tags, qloo_audience_demographics, qloo_trends, qloo_find_tags`. Input schemas (all `additionalProperties:false`):

- `qloo_recommend`: required `target_type` (artist|book|brand|movie|person|place|podcast|tv_show|videogame; no destination/locality). Optional `signals[]` (names or UUIDs, max 10), `signal_tags[]`, `signal_tags_operator`, `signal_location`, `demographic` (NL; requires `signal_location`), `filter_location`, `include_tags[]` (names or tag URNs, max 10), `include_tags_operator`, `exclude_tags[]`, `exclude_tags_operator`, `explain`, `limit` (1-20).
- `qloo_where_popular`: required `entity`, `within`; optional `entity_type`, `limit` (1-20). Builds `/v2/insights` with `filter.type=urn:heatmap`, `filter.location.query=within`; sorts by `query.affinity` desc and keeps `limit`.
- `qloo_audience_demographics`: required `entity`; optional `entity_type`, `limit`. `filter.type=urn:demographics`; results are `response.results.demographics` items, passed through (bounded).
- `qloo_entity_tags`: required `entities[]` (max 10); optional `entity_type`, `limit`. Rows compacted to `{id, name, type, popularity, affinity}`.
- `qloo_trends`: required `entities[]` (1-5), `entity_type` (insights types), `start_date`, `end_date` (YYYY-MM-DD); optional `limit`. Result is `series:[{entity, points}]`, NOT `results`.
- `qloo_find_tags`: required `query`; optional `semantic`, `limit`. NO parent-type argument.
- `qloo_describe`: required `entity`; optional `type`. Returns only `{entity_id, name, type}` (no year).
- `qloo_rank`, `qloo_compare_audiences`: not used by the adapter (available through `callTool`).

Result envelope: `{schema_version, operation, status (ok|empty|needs_input|partial|degraded|error), summary, interpretation, results, result_count, warnings?, error?{code,layer,retryable,recovery}, execution, provenance}`. Delivered as MCP `structuredContent` (and JSON text); `isError:true` on error. `qloo_recommend` rows are compacted to `{entity_id, name, type, subtype, popularity, affinity, explainability?, properties{description, short_description, release_year, release_date, content_rating, duration, image, geocode, address, price_level, business_rating}}`: entity `tags` and `location` are dropped.

CLI (`qloo api ...`, dry-run output inspected): `insights` (prints only `results.entities`, so it cannot return tag/heatmap/demographics rows), `search` (`-q` required, `--params` merge), `entity --id` (only `/entities?entity_ids=`), `tags`, `analyze`, `recommend`. None can do IMDb lookup.

## Discrepancies with the brief and controller notes (adapted inside the adapter)

1. `qloo_find_tags` has no `parent_type`; `findTags(query, "place"|"brand")` keeps tags whose id/type contains `:place` / `:brand`, locally.
2. `qloo_trends` requires `entity_type`, but `QlooClient.trends(entityId)` carries none. The client remembers types from `entityByImdb`/`searchTitles` and otherwise calls `qloo_describe` first (extra call).
3. `qloo_audience_demographics` is the tool name for demographics (controller note listed it that way; schema takes `entity`, not an id-only form). `qloo_where_popular` takes `within`; the controller's `entity, within` matches.
4. No harness path for IMDb-to-entity or year-bearing title search, and `qloo api` cannot do them (see CLI above). So `entityByImdb` and `searchTitles` use a plain `fetch` GET of `/entities?external.imdb.ids=` and `/search?query&types&take=5` with `X-Api-Key` from `QLOO_API_KEY`, in `harness.ts` (`getJson`), requests encoded in `recipes.ts`. This replaces the brief's "`qloo api` argv via execFile"; no `execFile` is used.
5. `placeTags`: no single tool. It is two harness calls (`qloo_recommend` place venues for the city, limit 10, then `qloo_entity_tags` on those venue ids); provenance cites both.
6. `Venue.tags` is always `[]` and `lat/lon` are `null` unless `properties.geocode` carries them, because the harness compaction drops entity tags and location. The Task 1 spike should decide whether to read raw responses (REST) for places.
7. Base URL: the harness defaults to `https://api.qloo.com`; the controller says the hackathon host is `https://hackathon.api.qloo.com`. The transport defaults `QLOO_BASE_URL` to the hackathon host and mirrors it into `QLOO_TRUSTED_BASE_URL` for the child (the harness refuses non-official hosts otherwise). Env overrides both. Both the child and the REST path use the same base.
8. `close?(): Promise<void>` added to `QlooClient` as an optional extension. `createQlooClient(cfg, deps?)` takes an optional second `deps` argument (transport/sleep/now) for tests.

## UNVERIFIED (no key, no live Qloo access; nothing here was verified against live Qloo)

Listed in the `recipes.ts` header: heatmap point shape (`location.latitude/longitude/geohash`, `query.affinity/popularity`); demographics row shape (`query.age/gender`); venue/geocode fields; place `include_tags` URNs accepted by recommend; trend point field names and the 90-day window (date/percentile keys are guesses); `findTags` local filtering; REST `/entities` and `/search` params and entity shape; the hackathon base URL and key working with the harness; that `recommend` with only `signals` + `filter_location` for places gives sensible venues. The pipeline from `mapHarnessResult` down is exercised only against scripted envelopes. What WAS exercised for real: spawning `qloo mcp` without a key, `tools/list`, and a `heatmap` call through the real transport that came back as an `error` section with the harness's `QLOO_AUTH` note.

Disclosure: while probing the CLI I made one `qloo api search` call with the literal dummy value `QLOO_API_KEY=dummy-dry-run` (it was meant to be a dry-run, but `search` was run without `--dry-run` once) to the official api.qloo.com; it returned 401 and no data. No real credential exists or was used.

## Tests

`npm --prefix services/pulse test`: 54 passed (6 files; the 38 new tests are `limiter.test.ts` 5, `harness.test.ts` 8, `client.test.ts` 24, plus the earlier 16). `npm run typecheck`: clean. Root `npx vitest run`: 414 passed.

New tests include the brief's four, plus: partial/degraded mapping, needs_input/error notes, ok-with-no-rows to empty, unreadable envelope and throwing `pick`, per-recipe argument and parse checks (heatmap, demographics with the fixed limits string, places, placeTags two-step, artists/brands, trends with type lookup and cache, findTags filter, IMDb mismatch guard, searchTitles), 429 retry then success, error section after exhausted backoff, no retry for non-retryable errors, restart-once (dead child restarts and retries; second death surfaces; live connection with an error does not restart), lazy start/shared connection/close, REST header/URL, REST 429 to `RateLimitedError`, refusal without a key, fixture cells within 8 km of delhi/london/new-york.

## TDD evidence

RED: `npm --prefix services/pulse test -- qloo` (tests written before any implementation) failed all three suites: `Error: Failed to load url ./client.js ... Does the file exist?` (also `./harness.js`, `./limiter.js`), expected because the modules did not exist yet. GREEN: after implementing, the same command's suites passed (`limiter.test.ts (5)`, `harness.test.ts (8)`, `client.test.ts (24)`). Two typecheck errors surfaced afterwards (SDK `callTool` union type; `never[]` inference) and were fixed; tests unaffected.

## Files changed

`/Users/naman/spotlight-qloo/Spotlight/services/pulse/src/qloo/{limiter,recipes,harness,client,fixtures}.ts` and `{limiter,harness,client}.test.ts`. Nothing else touched; `tools.json` and probe scripts live only in the scratchpad.

## Self-review

- Names/signatures match the brief; additions are optional (`close`, `deps`).
- `recipes.ts` is the only home for tool names, arg keys, REST paths and result readers; the `limits` text is fixed per call.
- YAGNI: no execFile, no extra abstractions beyond the `McpSession` seam the restart test needs.
- Fixtures contain only invented values.

## Concerns

- Venue lat/lon/tags are likely unavailable through the harness (see 6); the map-of-venues and venue-tag UI may need the REST route.
- `trends` costs an extra `qloo_describe` call when the title was not resolved through this client in the same process.
- `callTool` (for the agent) goes through the limiter and can throw `RateLimitedError` after backoff; Task 10 should wrap that and apply its own allowlist (the client does not restrict tool names).
- Key handling: the REST path reads `QLOO_API_KEY` itself; the key only ever reaches the configured Qloo host and the child process.
- The spike (Task 1) must check the UNVERIFIED list before the live path is trusted.

## Fix report, round 1

Changes (all in `services/pulse/src/qloo/`, commit message "Qloo adapter fixes: cap include_tags, allow-list child env, REST timeout, no respawn after close, isError text"):

- Important, `recipes.ts` `places`: `include_tags` is capped at 10 (`slice(0, 10)`), the same capped list is used in `params.include_tags`, and an empty list omits the key and the param.
- `harness.ts` `buildChildEnv` (exported, replaces `childEnv`): the `qloo mcp` child gets only PATH, HOME, TMPDIR, LANG, LC_ALL, NODE_OPTIONS, NODE_EXTRA_CA_CERTS, HTTP(S)_PROXY/NO_PROXY (both cases) and every `QLOO_*` variable; the mirrored `QLOO_BASE_URL`/`QLOO_TRUSTED_BASE_URL` behaviour is kept.
- `harness.ts` `getJson`: `signal: AbortSignal.timeout(15_000)`; a timeout rejects like any transport failure.
- `harness.ts` `close()`: sets a `closed` flag. A call that fails because close() ran rejects with "Qloo harness transport closed" and does not respawn; later calls also reject (permanent, as ruled).
- `harness.ts` `parseEnvelope` (exported): an `isError` reply with no structured content throws its text, so the section note carries it ("Qloo call failed: <text>"); non-JSON text gives a clear message rather than a bare JSON.parse error.
- Test updated: the earlier "closes the connection..." test no longer calls the transport after `close()`, which is now defined to reject.

Covering tests added (9 new; service total 54 to 63):
- `client.test.ts`: 12 tag ids give exactly 10 in the harness call and the same 10 in provenance; empty list omits `include_tags` from args and provenance; failed REST lookup (TimeoutError) rejects instead of hanging; harness isError text appears in the error section note.
- `harness.test.ts`: in-flight call plus `close()` does not respawn (connects stays 1) and rejects "transport closed"; REST fetch receives an `AbortSignal` and a TimeoutError rejects; `buildChildEnv` keeps `QLOO_API_KEY` and drops `DATABASE_URL`, `GROQ_API_KEY`, `PULSE_WARM_SECRET`; base-URL mirroring; `parseEnvelope` structured and isError cases.

RED: the first run of the new tests failed 7 (`buildChildEnv is not a function`, `parseEnvelope is not a function`, include_tags length 12 vs 10, "expected undefined to be an instance of AbortSignal", close respawn gave "Connection closed" instead of "transport closed").

GREEN: `npm --prefix services/pulse test` gives 6 files, 63 passed; `npm run typecheck` clean; root `npx vitest run` gives 31 files, 414 passed (it prints a pre-existing stack trace from an unrelated root test's logged error; no failures). Re-ran the real no-key smoke (child spawned with the allow-listed env, `tools/list` and an auth-error section both worked).

Deferred items from the review were not touched.

# Task 10 report: the chat agent

Status: DONE_WITH_CONCERNS (concerns at the end). Commit: `ba4938b` "Server-side Pulse agent: Pulse + Qloo tools over SSE, capped and allowlisted" on `feat/release-pulse`.

**Groq / gpt-oss tool calling is UNVERIFIED against live Groq.** There was no Groq key. Everything below ran against a local fake OpenAI-compatible server. The header comment of `src/agent/loop.ts` says so and lists what is unverified (well-formed `tool_calls`, harness JSON Schemas accepted as function parameters unchanged, `tool` messages without a `name`, empty replies after reasoning). The loop treats everything the model sends as untrusted for that reason.

## What was built

All under `services/pulse/src/`.

| File | Role |
|---|---|
| `agent/prompt.ts` | `systemPrompt()`: SAFE_USE rules, the copy rule verbatim, "Name the Qloo call behind every number you state", gaps said plainly, tool results are data, city slugs+names and business types (built from `cities.ts`/`BUSINESS_TYPES`, so they cannot drift), ≤180 words / recommendation first, no live-verified claims. |
| `agent/sanitize.ts` | `parseArguments`, `sanitiseArgs` (strings ≤120, arrays ≤10, nesting ≤2, ≤20 keys, unknown keys dropped when the schema says `additionalProperties:false`, `__proto__` never), `truncateResult` (≤6000 chars; over the limit it becomes valid JSON `{"truncated":true,"note":"…truncated","preview":…}`), `summarise` (≤200 chars, shape not contents), `boundValue`. |
| `agent/loop.ts` | `runAgent(llm, tools, history, maxRounds = 6, opts)`. |
| `agent/tools.ts` | Registry: `buildTools(deps)`, `createToolProvider(deps, {ttlMs, now})` (5 min cache; a build that could not list the harness is not kept), re-exports `AgentTool`, `AgentToolDeps`, `QLOO_AGENT_TOOLS`. |
| `agent/tools/{types,args,pulseBoard,releaseBrief,searchReleases,titlesShotIn,harness}.ts` | One tool per file (split by responsibility because tools.ts would have grown past the brief's intent). |
| `http/sse.ts` | `writeSseHead`, `writeEvent`, `startSse(res, {timers})` (15 s `: ping`, injected timers, cleared on end/close, stops writing and aborts a signal on disconnect). |
| `http/body.ts` | `readJsonBody(req, maxBytes)`: byte-counted while reading. |
| `routes/chat.ts` | `chatHandler(deps): Handler`. |
| `timers.ts` | `Timers` interface + `realTimers`, shared by the loop and SSE so tests fire timers by hand. |
| `testing/agent.ts` | Test doubles: `fakeTool`, `call`, `toolCallMsg`, `collect`, `manualTimers`. |
| `server.ts` | `POST /chat` wired; `enqueueWarm` now built once and shared by the board and the agent. |
| `llm/client.ts` | Small addition (Task 9 file): optional `signal` in `LlmChatOptions`, combined with the 20 s timeout via `AbortSignal.any`, so a disconnected client cancels the in-flight paid model call. Test added in `client.test.ts`. `testing/llm.ts` typing widened to match. |

Loop behaviour: per round `llm.chat(messages, {tools, signal})`; tool calls are sanitised (name charset `[A-Za-z0-9_.-]`≤64, args, id uniqueness), echoed back to the model as an assistant message with the sanitised arguments, then run sequentially, each as `tool` event → run → `tool_result` event → `tool` message with `tool_call_id`. A bad-JSON-arguments call is not run (tool error). Unknown tool → `{"error":"unknown tool","name":…,"available":[…]}` as a tool message. A throwing tool → `{"error":"The tool failed."}` (the real cause goes to `onError`, never to the model or user). A hanging tool → cut at 25 s via an injected timer and aborted through its `AbortSignal`; a tool that ignores its signal is also released when the client disconnects. After `maxRounds` tool rounds the loop emits the "step limit" message (naming only the tools it actually ran) and `done`, with NO seventh paid-for model call. `LlmError` kinds map to three fixed sentences; any other error to a generic one; an empty model reply is treated as `bad_response`.

## How each ruling was applied

**R31 (release_brief).** `release_brief` runs `streamBrief` with `noopDrafter` (exported; returns `{status:"empty",data:null,provenance:[],note:"The agent writes its own advice."}`), collected into a summary: per section `status`, a ≤200-char cleaned `note`, `calls` (unique provenance `call` names, ≤4), plus who → top 3 age buckets (+gender), where → top 5 labelled neighbourhoods with relative affinity (one per name, max) and counts of cells/unlabelled cells, venues → ≤5 names, themes → ≤6, artists/brands → ≤5, hook → ≤5 rows (kind, landmark), trend → `{present, points}`. The campaign section is omitted. Third-party text goes through `cleanText`. Sections follow the business type's order. The tool's deps have no LLM client at all; a test runs the whole agent with a fake LLM and asserts it was called exactly once per agent round. Unknown title → `{error:"unknown_title"}` as data with zero Qloo calls (numeric ids go through `isKnown`; text goes through the same `searchReleases` as `search_releases`, first match, `media_type` filter if given). A bare numeric id known as both movie and tv returns `{error:"ambiguous_media_type"}` rather than guessing.

**R32 (/chat).** Order implemented exactly: body read + shape validation (400 / 413) → own limiter (10/min, separate instance, `Retry-After`) → llm configured (503 `{"error":"llm_unavailable"}`) → `takeUsage(..., "chat")` once per request (429 `{"error":"daily_limit"}`; store failure → 503 `{"error":"unavailable"}` before streaming) → SSE. Body: `application/json` only, ≤100 KB enforced while reading (a declared Content-Length over the cap is refused without reading; otherwise the stream is cut at the cap, the rest is discarded up to 1 MiB so the 413 reaches a still-sending client, then the socket is destroyed); bad JSON/wrong type/non-object → 400 `bad_request` (+ a fixed `detail`). `messages` must be a non-empty array; the LAST 12 are kept and only those are validated (role exactly `user`|`assistant` so client `system`/`tool` → 400, non-empty string content ≤4000 chars, last must be `user`); messages are rebuilt as `{role, content}` so extra client fields never reach the model. Tool args sanitised (see above); tool results truncated to ≤6000; user-facing `summary` ≤200. Harness tools exposed only via the allowlist of the 7 real names (`QLOO_AGENT_TOOLS`), intersected with `qloo.listTools()`, schemas used as given (minus `$schema`). Fixtures mode: I chose to allow the fixture client's own tool name `qloo_fixture_echo` in fixtures mode only (via `deps.fixtures`), rather than registering stand-ins; in real mode it is never offered. `qloo_capabilities`, `qloo_trends`, `qloo_entity_tags` are deliberately not on the list.

Other tool behaviours: `pulse_board` → `buildBoard` compacted to the top 8 (title, tmdbId, mediaType, releaseDate, platform, score, why) + `rankedCount`/`pendingCount`/`unresolvedCount`/`pendingTitles` (≤5) + a note that pending means data is still loading. `search_releases` → case-insensitive title substring across `release_items` and `calendar_entries` (rows with a TMDB id; media type derived from `entry_type` as elsewhere), one row per title, exact match first then newest, ≤10, parameterised `ILIKE … ESCAPE '\'` with `%`, `_`, `\` escaped, query trimmed and cut to 80. `titles_shot_in` → `title_locations` for the city joined to titles known from the release tables, rows with no source skipped, landmarks first, ≤20, with an honest empty note (and "coverage is partial" caveat). Invalid city/business type → `{error:"unknown_city"|"unknown_business_type", valid:[…]}` as data. Each Pulse tool also returns a one-line `summary` so the user-facing `tool_result` is readable ("3 ranked and 0 pending for Delhi (cafe).").

## Tests and results

- `npm --prefix services/pulse test`: 35 files passed, 6 skipped; 645 passed, 22 skipped.
- With `PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test`: 41 files, 667 tests, all passed (includes the new `agent/tools.integration.test.ts`: 11 tests against real Postgres for `search_releases` LIKE escaping of `%`/`_`/`\`, de-duplication across both tables, exact-first ordering, ≤10 limit, quote safety, and `titles_shot_in` join/skip/city isolation/≤20; deletes its rows; test DB verified clean afterwards).
- `npm run typecheck`: clean (all five tsconfigs).
- root `npx vitest run`: 414 passed. `.venv/bin/python -m pytest -q`: all passed.

New tests: `agent/sanitize.test.ts` (23), `agent/prompt.test.ts` (6), `agent/loop.test.ts` (29), `agent/tools.test.ts` (49), `agent/tools.integration.test.ts` (11, Postgres), `http/sse.test.ts` (8), `http/body.test.ts` (15), `routes/chat.test.ts` (33), plus 1 in `llm/client.test.ts`. They cover every case in the brief and the task message: the five brief tests, the arg sanitiser, truncation marker, board compaction, brief summary boundedness and no-op drafter, `search_releases` escaping/bounds, honest-empty `titles_shot_in`, invalid city/type as data, timeouts via injected timers (no real waiting), throwing tool, ≤4 calls per round, LlmError mapping, consumer early return and abort-signal stop, SSE framing/ping/disconnect, and the `/chat` 400 table, 413 (declared and chunked), 429 limiter before work, 503, `daily_limit` with no model call, one usage slot per request across 4 model rounds, hashed session key, and the real `takeUsage` cap over an in-memory store.

TDD evidence: the test files were written first. RED run (`npx vitest run src/agent src/http/sse.test.ts src/http/body.test.ts src/routes/chat.test.ts`): `Test Files 7 failed (7) / Tests no tests`, each with `Failed to load url ./<module>.js … Does the file exist?`. GREEN came module by module; the two assertion-level failures along the way were real bugs caught by tests and then fixed (a nesting-depth off-by-one in `sanitiseArgs`; a `CANCELLED` vs `TIMEOUT` race in `runTool` where aborting fired the cancel listener first and the timeout message was lost).

## Real verification (service in fixtures mode, local Postgres, fake provider; Groq UNVERIFIED)

Setup: fake OpenAI-compatible server (`<scratchpad>/chatfake/server.mjs`, port 8792, outside the repo), service on `PORT=8799` with `QLOO_FIXTURES=1 GROQ_API_KEY=fake-test-key GROQ_BASE_URL=http://127.0.0.1:8792/v1/chat/completions PULSE_SESSION_DAILY_CHAT=2 PULSE_WARM_SECRET=testsecret`. Inserted 3 synthetic `release_items` (ids 999400001-3), 3 `title_ratings`, 1 `title_locations`; warmed with `POST /warm?city=delhi&wait=1` (`{"warmed":6,"failed":0}`); `/board` then ranked all three.

Scripted conversation (round 1 `pulse_board`, round 2 `release_brief` with the tmdbId read from round 1's tool message, round 3 a final answer built from the tool messages), session `v1`:

```
data: {"type":"tool","name":"pulse_board","args":"{\"city\":\"delhi\",\"business_type\":\"cafe\"}"}
data: {"type":"tool_result","name":"pulse_board","summary":"3 ranked and 0 pending for Delhi (cafe)."}
data: {"type":"tool","name":"release_brief","args":"{\"title_or_tmdb_id\":\"999400001\",\"media_type\":\"movie\",\"city\":\"delhi\",\"business_type\":\"cafe\"}"}
data: {"type":"tool_result","name":"release_brief","summary":"Brief for \"Synthetic Pulse Alpha\" in Delhi: 7 sections (7 ok)."}
data: {"type":"message","text":"Theme this weekend around \"Synthetic Pulse Alpha\" (rank 1 on the Delhi board, score 0.75). Fans of Synthetic Pulse Alpha in Delhi over-index on ages 25_to_29 (affinity 0.34, from Qloo call fixture:audience_demographics). Venues: Fixture Café 1, Fixture Café 2. Calls used: fixture:audience_demographics, fixture:where_popular, fixture:recommend_places, fixture:entity_tags, fixture:recommend_artists, title_locations, fixture:trends."}
data: {"type":"done"}
```
Response headers: `HTTP/1.1 200`, `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`, `Connection: keep-alive`, `X-Accel-Buffering: no`. The fake saw roles `system,user` → `system,user,assistant,tool` → `…,assistant,tool,assistant,tool` and the 5 offered tools (`pulse_board, release_brief, search_releases, titles_shot_in, qloo_fixture_echo`).

- Session cap (cap 2): request 2 → 200 `done`; request 3 → `HTTP 429 {"error":"daily_limit"}`; provider hit count stayed at 6 (3 per conversation × 2; none for the denied one). `pulse_usage`: one row for that session, `kind=chat, count=2`, session stored only as a sha256 hex.
- Unknown tool: events `tool drop_database` → `tool_result "error: unknown tool"` → `message "Recovered after tool error "unknown tool" (available: pulse_board, release_brief, search_releases, titles_shot_in, qloo_fixture_echo)…"` → `done`.
- Step limit (endless): 6 `tool`/`tool_result` pairs, then `message "I hit my step limit before finishing — here is what I found so far: I ran 6 lookups (search_releases) but did not get to a final answer. Try a narrower question, for example one city, one business type and one release."`, `done`.
- 6 tool calls in one reply: exactly 4 `tool` events per round (24 over 6 rounds); the model's next call carried 6 `tool` messages per round (the extra two answered "not run").
- Provider HTTP 429 (body contained `PROVIDER-SECRET-TEXT … org_123`): `data: {"type":"error","text":"The AI service is busy right now. Please try again in a minute."}` then `done`. Server log line: `model call failed: The model provider is rate limiting requests.` (no provider text).
- 120 KB body (`content-length` 120048) → `HTTP 413 {"error":"too_large"}`; 300 KB chunked with no content-length → 413. 400s: bad JSON, `system` role, last message from assistant, `text/plain` → `400 {"error":"bad_request","detail":…}`.
- Limiter: with distinct sessions, the first 3 of a burst passed and then `429 Too Many Requests` with `Retry-After: 41` (10/min window, earlier requests counted).
- Server log: `grep -c fake-test-key` = 0, `grep -c PROVIDER-SECRET` = 0. The log held only the startup line and the one provider-429 line.
- Cleanup: deleted every inserted `release_items`, `title_ratings`, `title_locations` (ids ≥ 999400001 only: the DB's 18,069 pre-existing `title_locations` rows untouched), `qloo_entities`, `qloo_evidence`, and `pulse_usage`; verified counts back to 0/0/0/0/0 (and 18069); both servers stopped.

## Self-review

- Completeness against the brief: the brief's file list is met (`prompt.ts`, `tools.ts`, `loop.ts`, `sse.ts`, `server.ts` wiring, both named test files plus more); exported names match (`AgentTool`, `buildTools`, `runAgent`, `chatHandler`, `writeSseHead`, `writeEvent`). `buildTools`/`runAgent` take extra optional deps/options; defaults match the brief's signature.
- Comments explain why (ordering of 413 draining, why `CANCELLED` and `TIMEOUT` are resolved in that order, why the timeout test needs `closeAllConnections`, why a degraded tool build is not cached).
- Deterministic tests: injected `Timers`, fake LLM/tools, `fetch` against an in-process server; the only real timers are vitest's own `waitFor` polling. No secrets in logs/events/errors (verified above).
- YAGNI: no streaming of model tokens, no per-tool retries, no overall deadline (see concerns).

## Concerns

1. **Groq/gpt-oss behaviour unverified** (above). Specific risks: the `title_or_tmdb_id` schema is `type:"string"` (numbers are accepted at run time, but a provider that validates strictly against the schema could reject a numeric id); the harness schemas contain keywords (`examples`, `minItems`, `uniqueItems`) that Groq may or may not accept in function parameters.
2. **Budget accounting.** One usage slot covers a whole turn (R32), but a turn can make up to 6 model calls and several Qloo lookups, so the global daily LLM cap undercounts real Groq calls by up to 6×. The slot is taken before the first model call, so a provider failure (e.g. the 429 demo) still spends the user's slot; no refund is implemented.
3. **No overall deadline per chat.** Worst case is 6 rounds × (up to 20 s model + 4 × 25 s tools). The per-client limiter (10/min) and per-tool 25 s cut-off bound each piece, and a client disconnect aborts everything, but a patient client can hold a stream for minutes.
4. **LLM-driven fan-out.** `pulse_board` queues the same background warming as `/board`, and `release_brief` can cost Qloo calls (cached 3 days, known titles only, Qloo's own 2-at-a-time limiter) at up to 4 per round. The agent route's limiter is stricter than `/brief`'s, but an agent turn can trigger more lookups than a single brief.
5. `llm/client.ts` (a Task 9 file) gained the optional `signal` option; behaviour without it is unchanged.
6. A title that is purely digits (e.g. "1917") is read as a tmdbId by `release_brief` per R31; the tool description tells the model to use `search_releases` first.
7. `tool_result` summaries for `qloo_*` tools use the harness's own `summary` sentence (cleaned), which is third-party text shown to the user (bounded to 200 chars, angle brackets/control characters stripped).

## Files changed

`services/pulse/src/`: new `agent/{prompt,sanitize,loop,tools}.ts`, `agent/tools/{types,args,pulseBoard,releaseBrief,searchReleases,titlesShotIn,harness}.ts`, `agent/{prompt,sanitize,loop,tools}.test.ts`, `agent/tools.integration.test.ts`, `http/{sse,body}.ts`, `http/{sse,body}.test.ts`, `routes/chat.ts`, `routes/chat.test.ts`, `timers.ts`, `testing/agent.ts`; modified `server.ts`, `llm/client.ts`, `llm/client.test.ts`, `testing/llm.ts`.

---

# Fix report, round 1 (commit `364bf5d`)

Review finding: no per-chat budget on uncached Qloo calls, no overall deadline, no cancellation of queued Qloo calls, no concurrent-stream cap; plus three small rulings. Loop bookkeeping, sanitising, SSE/body handling, SQL and the existing tests were left alone (the only edits to existing tests are the ones forced by the new deadline timer: the loop's timer tests now expect two pending timeouts, 90 s and 25 s, and fire the 25 s one by delay).

## Changes

- **(a) Budgets** (`agent/loop.ts`, `agent/tools/{types,harness}.ts`). Named constants `MAX_HARNESS_CALLS_PER_CHAT = 8`, `MAX_TOOL_CALLS_PER_CHAT = 12`. `AgentTool.budget?: "harness"` marks the allowlisted `qloo_*` tools (Pulse tools are unmarked). A call that would exceed either limit is not run: its tool message is `{"error":"budget_exhausted","note":"This chat has used its lookup budget; answer with what you have."}` (one tool message per call id kept), with the matching `tool` and `tool_result` events (summary `error: budget_exhausted`). Counting rules: only calls that actually run count (unknown tools, bad-argument calls and refused calls do not); Pulse tools count toward 12 only; harness tools toward both.
- **(b) Deadline.** `runAgent` options gain `deadlineMs` (default `CHAT_DEADLINE_MS = 90_000`), set with the injected `Timers` and cleared in `finally`. It fires through the loop's own abort signal, so the in-flight model call and tool are aborted. Both the model call and the tool are also raced against that signal, so one that ignores its signal cannot hold the loop. On a deadline (not a client disconnect, which stays silent) the loop emits `message "I ran out of time before finishing — here is what I found so far: I ran N lookups (…) but did not get to a final answer."` then `done`; the summary lists only tools actually run. `/chat` passes `deadlineMs` through.
- **(c) Cancellable Qloo calls.** `QlooClient.callTool(name, args, opts?: {signal?})` (backward compatible; the fixture client ignores it). The limiter (`createLimiter`) takes `run(fn, {signal})`: a job whose signal is already aborted, or aborts while queued, rejects with an `AbortError` and never calls the harness (the waiter is removed from the queue, the slot is not leaked, and a 429 backoff is not retried after cancel). A call already running is not interrupted. The harness tool passes `ctx.signal` through.
- **(d) Stream cap.** New `http/streamCap.ts` (`createStreamCounter(max)`: `tryAcquire(key)` returns an idempotent release, zero entries deleted). `chatHandler` takes optional `streams` (default 2 per client address, `MAX_STREAMS_PER_CLIENT`). It is checked right after the rate limiter and before the llm-configured check and the usage slot: a third stream gets `429 {"error":"too_many_streams"}` with `Retry-After: 5`. The slot is released exactly once by `finally` and by `res.once("close")`, whichever comes first.
- **Small 1. `normaliseToolSchema`** (`agent/tools/schema.ts`): recursively keeps only `type, properties, required, enum, items, minItems, maxItems, minimum, maximum, minLength, maxLength, description, additionalProperties` (property names are data and are never filtered); applied to every harness tool spec before it is sent to the provider. The loop's argument sanitiser reads only `properties`/`additionalProperties`, which survive, so per-tool argument validation is unchanged. The real 7 allowlisted schemas are copied into `agent/tools/harnessSchemas.fixture.json` (tool metadata only).
- **Small 2. Truncated final answers.** A final message whose `finish_reason` is `"length"` gets ` … (my answer was cut off; ask me to continue)` appended; `done` still follows.
- **Small 3.** `loop.ts` header comment now documents that one usage slot covers up to 6 model calls so the global cap undercounts provider calls, plus the new per-chat bounds.

## Covering tests (all deterministic: injected timers, no real waiting)

- `agent/loop.test.ts` (29 → 41): budget constants; 12-total cutoff with the model still answering and every id answered; harness 8 vs total 12 counting (9th harness call refused while Pulse tools run; 8 Pulse calls then 4 harness calls run); refused calls use no budget; deadline set once and cleared; deadline during a hanging tool (aborts it, "ran out of time", no further model call, ignores-its-signal tool does not hold the loop); deadline during a model call that ignores its signal; no new round after the deadline; a departed client is told nothing; `finish_reason:"length"` marked, `"stop"` untouched.
- `qloo/limiter.test.ts` (+5): already-aborted job never runs; queued job aborted while waiting is dropped and never called; slot handed on without a leak; no retry after cancel during backoff; a running job is left alone. `qloo/client.test.ts` (+1): a queued aborted `callTool` never reaches the transport (only the two running calls were sent).
- `agent/tools/schema.test.ts` (12): for each of the 7 real harness schemas `type`, `required`, `additionalProperties:false` and property names are kept and `examples`, `default`, `uniqueItems`, `$schema`, `title`, `anyOf/oneOf/allOf`, `pattern`, `format` are absent; enums and bounds and item schemas kept; a property named `default` is not mistaken for a keyword; input not mutated. `agent/tools.test.ts` (+2): harness tools carry `budget:"harness"` and pass `signal` to `callTool`, Pulse tools do not; a provider-bound spec is the conservative subset.
- `http/streamCap.test.ts` (3) and `routes/chat.test.ts` (33 → 40): third concurrent stream → 429 `too_many_streams` + `Retry-After: 5` with no usage slot and no tool build; per-address independence; slot freed on client disconnect (counter back to 0, both slots reusable); freed after normal end and after 503 (no key); freed when the handler throws (`startSse` timer throws); ordering (validation → rate limiter → cap); the 90 s deadline end to end inside the SSE stream, with keep-alive and deadline timers both cleared.

RED evidence: the new loop tests were run against the previous `loop.ts` (`git show HEAD:…`): `Tests 12 failed | 29 passed (41)`, covering the budget, deadline and `length` cases and the two timer tests whose pending-timer expectations changed. (A new-file import failure is the RED for the stream-cap and schema modules, which did not exist.) The loop fix was restored and passed.

## Commands and results

- `npm --prefix services/pulse test`: 37 files passed, 6 skipped; 687 tests passed, 22 skipped.
- `PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test npm --prefix services/pulse test`: 43 files, 709 tests, all passed. Test DB verified clean afterwards (release_items, pulse_usage and synthetic calendar rows all 0).
- `npm run typecheck`: clean. Root `npx vitest run`: 414 passed. `.venv/bin/python -m pytest -q`: all passed.
- No live run this round (per instruction).

## Notes

- Deadline and stream cap are per chat/stream; the Qloo limiter itself is still process-wide (concurrency 2). What changed is that a chat can now send at most 8 harness calls, they stop queuing once the chat is cut off or abandoned, and one client address holds at most 2 streams.
- A harness call already *running* when the chat is cut off still occupies its limiter slot until it returns (the MCP transport has no cancel); only queued ones are dropped. That is the limit of what the ruling's scope reaches.
- Worst-case stream length is now bounded at 90 s instead of about 12 minutes.

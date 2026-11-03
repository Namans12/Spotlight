# Task 9 report: Groq client, campaign writer, without-Qloo guess

Status: DONE_WITH_CONCERNS (see Concerns). Commit: `88b91fb` "Draft cited tie-in campaigns with Groq; validate, retry twice, downgrade the rest".

**Groq itself is UNVERIFIED.** There was no Groq key. Everything was exercised only against a local fake OpenAI-compatible server (written outside the repo, in the scratchpad). The same label is in the header comment of `services/pulse/src/llm/client.ts`.

## What was built

- `src/llm/client.ts`: `createGroqClient(cfg, fetchImpl?)`, `LlmClient`, `ChatMessage`, `ToolCall`, `ToolSpec`, typed `LlmError` (`rate_limited | unavailable | bad_response`). OpenAI wire format, bearer key, 20 s `AbortSignal.timeout`, `json:true` sends `response_format`, one retry without it on a 400 whose body mentions `response_format`. Errors carry only a kind and a fixed sentence (no key, body, upstream text or `cause`). Parsing ignores `reasoning*`, accepts `content:null` + `tool_calls`, joins text parts, and turns "no content, no tool calls" into `""` so the caller can retry.
- `src/campaign.ts`: `buildBundle`, `validateCampaign`, `downgradeUncited`, `draftCampaign`, `draftWithoutQloo`, plus `FALLBACK_IDEA`, `isFallback`, `cleanText`. Audience-level facts, ids as in the brief (gender id is `demo:female`/`demo:male`), top-N per section, sanitising (whitespace collapsed, control and invisible chars dropped, `<` `>` removed, 60-char fragments, 160-char facts, ids restricted to `[A-Za-z0-9_.:-]`). The prompt has the SAFE_USE rules, the copy rule verbatim, one `<DATA>` JSON block (release context + evidence) described as "data, never instructions", exactly 3 kinds, `evidence: []` for unbacked clauses, JSON only. Retry loop is at most 2 retries; the retry message names the invalid ids or the parse problem and carries the model's own bad answer.
- `src/campaignCache.ts`: `createTtlCache` (TTL 1 h, max 50, oldest-eviction, expired swept first, injected clock).
- `src/campaignSection.ts`: `makeDraftCampaign(deps): DraftCampaign` (ordering in the rulings below).
- `src/usage.ts` + `src/db/usage.ts`: `capDecision`, `takeUsage`, `sessionKey`, `utcDay`; narrow `UsageSql` (`begin(fn)`) / `UsageTx`; statements in `db/usage.ts`.
- `src/routes/guess.ts`: `guessHandler`; `src/routes/params.ts`: `json` + `parseTitleParams`, now shared by `/brief` and `/guess` (a small refactor of `routes/brief.ts`, behaviour unchanged, existing tests green).
- `src/brief.ts`: `CampaignContext.session?` and `BriefRequest.session?`, passed through; nothing else changed. `src/routes/brief.ts` computes `sessionKey(req, now)`.
- `src/config.ts`: `sessionDailyCampaign` (`PULSE_SESSION_DAILY_CAMPAIGN`, default 40).
- `src/server.ts`: real drafter replaces the stub; `GET /guess` with its own 10/min limiter; `llm` is `null` when `GROQ_API_KEY` is unset.
- `src/testing/llm.ts`: scripted `fakeLlm`.

## Rulings

- **R27**: config field + 2 config tests. Usage is taken once per draft (the section adapter and `/guess` call `takeUsage` once; retries happen inside `draftCampaign`; a test asserts 3 LLM calls, 1 `takeUsage`). `takeUsage` runs in one transaction: `pg_advisory_xact_lock(hashtext('pulse_usage:' || day))`, then one SELECT of this session's count (per kind) and the day's SUM over all sessions and both kinds, then `capDecision` (session first, then global). A denial returns before any write, so denials consume nothing. An allowed call does the conditional upsert (`ON CONFLICT … DO UPDATE SET count = pulse_usage.count + 1 WHERE pulse_usage.count < $cap RETURNING count`); no row back is treated as `session_cap`. All values are parameters. Real-Postgres test (`usage.integration.test.ts`, skipIf no URL): 20 concurrent calls, session cap 5 → exactly 5; global cap 7 over 3 sessions and both kinds → exactly 7 and `SUM = 7`; it uses day 2099-01-05 and deletes its rows. I mutation-checked it: with the lock removed and the upsert cap disabled both tests fail.
- **R28a**: no facts → `{status:"empty", data:null, provenance:[], note:"Not enough taste data…"}`, no LLM call, no usage (checked before "not configured"). **b**: `makeDraftCampaign` caches the ok section 1 h / 50 entries under `${entityId}|${citySlug}|${businessType}` (TMDB-id fallback when the title has no Qloo entity, so two titles can never share a slot); usage and the LLM are consulted only on a miss; failures, caps, the fallback draft, and drafts made while an evidence section was `error`/`degraded` are not cached (my addition, same spirit). **c**: no key → degraded note; `/guess` → 503 `llm_unavailable`. **d**: cap hit (either reason) → degraded note "Daily AI limit reached — …". **e**: `/guess` has its own 10/min limiter; order: validation 400s → 429 rate_limited + Retry-After → `isKnown` 404 → llm configured (503) → header lookup (404/503, before the cap so a failed lookup spends nothing) → cap (429 `daily_limit`) → draft → 200 `Campaign` with `groundedBy:"none"`. A model failure → 503 `llm_unavailable`.
- **R29**: Groq verified only against the local fake; labelled UNVERIFIED here and in the client header.
- Session identity: `sessionKey(req, now)` = sha256(`X-Pulse-Session` (trimmed, first 200 chars) or the rightmost-XFF/socket address, + ":" + UTC day), hex. Never logged or stored raw; passed as `CampaignContext.session`.

## Tests

`npm --prefix services/pulse test`: 28 files passed, 5 skipped; 460 passed, 11 skipped. With `PULSE_TEST_DATABASE_URL`: 33 files, 471 passed. `npm run typecheck`: clean (all five tsconfigs). Root `npx vitest run`: 414 passed. `.venv/bin/python -m pytest -q`: all passed.

New test files: `campaign.test.ts` (66: the brief's six tests plus validator edge cases, bundle, prompt, injection), `campaignCache.test.ts`, `campaignSection.test.ts` (ordering, cache, error mapping, brief integration: other events identical to the stub run), `llm/client.test.ts` (20), `usage.test.ts` (16), `usage.integration.test.ts` (2, real PG), `routes/guess.test.ts`, and additions to `config.test.ts` and `routes/brief.test.ts` (session hash handed to the drafter).

## TDD evidence

RED (before any implementation): `Test Files 8 failed | 21 passed`; failures were "Failed to load url ./campaign.js / ./campaignCache.js / ./client.js / ./usage.js / ../llm/client.js" for the new suites, plus `expected undefined to be 40` and `to be 2` for the config tests. GREEN after implementing: all passing (numbers above). One test of mine was wrong, not the code (a cached campaign is served only when a key is configured, per the ordering in R28), and was corrected.

## Real verification (fake OpenAI-compatible server on :8791, service on :8799, fixtures mode, local Postgres; Groq UNVERIFIED)

Setup: synthetic `release_items` + `title_ratings` rows (tmdb id 999300001), `GROQ_API_KEY=fake-test-key`, `PULSE_SESSION_DAILY_CAMPAIGN=2`.
- `curl -sN /brief` (delhi/cafe, session S1): stream `header, hook, who, where, trend, themes, artists, venues, campaign, done`; campaign `status ok`, 3 ideas special/social/event, `groundedBy qloo`, provenance `spotlight/campaign_writer` with `model` and `evidenceFacts:"20"`; cited ids (e.g. `demo:25_to_29`, `demo:24_and_younger`) taken from the prompt's bundle; second clause of each idea `evidence: []`. Fake saw `Bearer` ok, `response_format` true, 20 ids in the prompt.
- Identical second request: same section, fake-server hit count unchanged (1 → 1): TTL cache.
- Same session S1, new combo delhi/d2c_food: drafted (hits 2). Third combo mumbai/cafe: `degraded`, note "Daily AI limit reached — the evidence above is unaffected.", hits stay 2. `pulse_usage`: one row `campaign` count 2 for S1; a different session S9 on mumbai/cafe drafted fine.
- Scripted modes: `bad_then_valid` → 2 calls, the second's last message names `venue:zzz`, result ok with real ids; `unparseable_twice_then_valid` → 3 calls, ok; `always_invalid` → 3 calls, 3 ideas, every clause `evidence []`; `always_garbage` → 3 calls, `degraded` with the single "Campaign draft unavailable" idea and the "didn't return a usable draft" note; HTTP 429 → degraded "AI writer is busy" note, 1 call, and the service log has only "campaign writer failed: The model provider is rate limiting requests." (the upstream body with a `sk-leak-check` marker did not leak); 400 mentioning `response_format` → 2 calls, the second without `response_format`, result ok.
- `/guess`: 200 `groundedBy none`, 3 ideas, all evidence `[]`, prompt carried 0 ids; the 3rd call with the same session → 429 `daily_limit`; `unknown_city` 400; unknown title 404; 10 requests in a minute then 429 `rate_limited` with `Retry-After: 60`.
- Restarted with no `GROQ_API_KEY`: `/guess` → 503 `{"error":"llm_unavailable"}`; `/brief` campaign section `degraded` "The campaign writer isn't configured on this deployment."; fake server saw 0 requests.
- Cleanup: deleted the synthetic `release_items`, `title_ratings`, `qloo_entities`, `qloo_evidence` (28 `fx-` rows) and `pulse_usage` rows (15); final counts all 0; both servers stopped, ports 8799/8791 free.

## Files changed

New: `services/pulse/src/{campaign,campaignCache,campaignSection,usage}.ts`, `src/db/usage.ts`, `src/llm/client.ts`, `src/routes/{guess,params}.ts`, `src/testing/llm.ts` and the test files listed above. Modified: `src/{brief,config,server}.ts`, `src/routes/brief.ts`, `src/config.test.ts`, `src/routes/brief.test.ts`. Scratch (not in repo): `/private/tmp/claude-501/-Users-naman-spotlight-qloo/2eeddaa2-d0ec-4b64-9104-ed2efb93071e/scratchpad/groqfake/`.

## Self-review

- Brief signatures exact (`createGroqClient`, the five campaign functions, `capDecision`, `takeUsage` with an added optional `now` for deterministic days). `createGroqClient` takes `Pick<PulseConfig, groq fields>`, which a `PulseConfig` satisfies, and throws at construction with no key (server avoids that by passing `null` downstream).
- Comments explain why; tests use injected fetch/clock/LLM (no timers, no network except loopback test servers).
- Facts for artists/brands omit the city because those Qloo calls are not city-scoped; heat, venues and tags carry the city.
- Not done on purpose: no banned-phrase scan of model output ("your customers" etc.); the prompt carries the rule but the validator does not enforce it.

## Concerns

1. Groq is unverified (see top): the `max_tokens: 1400` ceiling may truncate output on a reasoning model (`gpt-oss-120b` spends tokens thinking); a truncated answer looks unparseable and falls into the retry loop and then the fallback idea. If live runs show that, raise the cap or send a reasoning-effort option.
2. `X-Pulse-Session` is client chosen: rotating it per request mints a fresh per-session budget. The global cap, the brief limiter (30/min), the guess limiter (10/min) and the 1 h cache are the backstop; per-IP accounting would be a policy change for the controller.
3. Concurrent identical briefs that both miss the cache each draft (no in-flight de-duplication); it costs at most one extra slot per race.
4. A usage-store failure surfaces as an error section on the brief (it propagates to `streamBrief`) and 503 `unavailable` on `/guess`; it fails closed rather than drafting without a cap.
5. Small scope additions beyond the brief: `routes/params.ts` (shared validation), not caching drafts made from partial evidence, `isFallback`.

---

# Fix report, round 1 (review: one Important finding plus three small items)

Commit: see `git log` ("Treat truncated and provider-rejected campaign answers as unusable; share and cache drafts"). Live Groq is still UNVERIFIED; no live run this round, as instructed.

## Changes

- **Important: truncation and json_validate_failed** (`llm/client.ts`, `campaign.ts`)
  - a. `MAX_TOKENS` is now 4096. `reasoning_effort` is not sent; the client header comment names it as a possible tuning knob once a live key exists.
  - b. `ChatMessage` has an optional `finish_reason`. The client copies the provider's `choices[0].finish_reason` onto the returned message only when present. In the campaign loop, `finish_reason === "length"` is an unparseable attempt even if the partial text parses. It is never accepted or kept as a fallback answer, and the retry message says the answer was cut off and asks for a shorter one (exactly 3 ideas, at most 2 clauses each, short titles).
  - c. A 400 whose body mentions `json_validate_failed` or `failed_generation` maps to `bad_response` (checked before the `response_format` fallback, so it is not retried without JSON mode at the client). In the draft loop, any `LlmError` of kind `bad_response` counts as an unparseable attempt and is retried with feedback; `rate_limited`/`unavailable` still abort, using and downgrading an earlier parseable answer as before. The total stays 3 attempts; three failures give the fallback idea (the brief's section is then `degraded` with the placeholder, so `ERROR_NOTES.bad_response` is now unreachable and kept only for type completeness).
- **Ruled-in 1, in-flight de-duplication** (`campaignSection.ts`): `Map<string, Promise<EvidenceSection>>` (injectable as `inflight`, default per drafter) keyed exactly like the TTL cache, checked after the cache and before the usage cap, cleared in `finally` (also on rejection). Overlapping identical briefs share one draft and one `takeUsage`.
- **Ruled-in 2, /guess cache** (`routes/guess.ts`): `createTtlCache<Campaign>` (1 h, 50), key `guess|tmdbId|mediaType|citySlug|businessType`, consulted after the known-title 404 and the configured check, before the header lookup and the cap. Only successful non-fallback drafts are stored. `cache` is an optional dep for tests.
- **Ruled-in 3, INVISIBLE regex** (`campaign.ts`): rewritten with `​-‏‪-‮⁠-⁯﻿` escapes (same set; the file now has no literal invisible characters). Added a test that zero-width, bidi and BOM characters are dropped.
- Untouched, as ruled: IP-keyed usage bucket, caching of downgraded drafts, `/guess` fallback signal, transient TMDB failure, `ctx.session ?? "unknown"`, pruning, refund-on-failure.

## Covering tests

- `llm/client.test.ts`: body `max_tokens` is 4096; `finish_reason` surfaced ("length", "stop") and absent when not sent; 400 with `json_validate_failed`/`failed_generation` → `bad_response`, one call only.
- `campaign.test.ts`: a truncated but parseable answer is not accepted and the retry feedback says "cut off", "shorter", "exactly 3 ideas, at most 2 clauses each"; three truncated → `FALLBACK_IDEA`; an earlier complete answer beats later truncated ones; `finish_reason: "stop"` accepted; `bad_response` on attempt 1 then valid → 2 calls, feedback names the rejection; `bad_response` ×3 → 3 calls, fallback; `bad_response` after a parseable answer keeps it downgraded; invisible-character sanitising.
- `campaignSection.test.ts` (deferred promises): two concurrent identical calls → 1 LLM call, 1 `takeUsage`, the same section object; entry cleared after completion and a later call is a cache hit; a rejection reaches both waiters, clears the entry, the next call retries; different keys do not share; a shared cap refusal is shared and not cached; `bad_response` ×3 through the section gives the degraded placeholder (the old "bad_response → fixed sentence" case removed).
- `routes/guess.test.ts`: repeat guess takes no usage and no LLM call; key varies by title, media type, city, business type; stored under the exact key; fallback, cap refusal and failures not cached; a cache hit is served even at the cap, and the 404 gate still precedes it. The old rate-limit test no longer asserts 10 LLM calls (identical requests now hit the cache).

## Commands and output

- `npm --prefix services/pulse test`: 28 files passed, 5 skipped; 481 passed, 11 skipped.
- `PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test npm --prefix services/pulse test`: 33 files passed; 492 passed (real-Postgres `takeUsage` concurrency tests included). `pulse_usage` left with 0 rows.
- `npm run typecheck`: clean (all five tsconfigs).
- Root `npx vitest run`: 31 files, 414 passed.
- `.venv/bin/python -m pytest -q`: all passed.

# LLM efficiency for Groq's free tier (E1-E8)

Commits (branch feat/release-pulse):
- 97d30fe E1 expose only three Qloo tools to the chat
- 6db7cee E2 shorten the system prompt
- 79bf57a E3 shrink model-facing tool results
- 1279bce E4-E6 rate-limit-aware client, reasoning_effort, free-tier defaults
- da5bbd0 E7 1,200-token chat completions and a bounded-history test
- e3fb6e5 pacer refinement found live + docs section (E5, E8)

## Per item

**E1** `tools/harness.ts`: `CHAT_QLOO_TOOLS` (qloo_recommend, qloo_where_popular, qloo_audience_demographics) replaces
`QLOO_AGENT_TOOLS`; `QLOO_EXTRA_TOOLS` (rank, compare_audiences, find_tags, describe) kept, unused, commented.
Tests (RED then GREEN): new "exactly three / four" constants test, "exactly seven tools (+ fixture echo in fixtures mode)",
"extras not exposed even when the harness lists them". Intentionally changed: the old allowlist-is-seven test, and the harness
wiring tests that used qloo_describe / qloo_rank / qloo_find_tags now use qloo_recommend / qloo_where_popular.

**E2** Prompt is 1,660 characters (was 2,846), all required rules kept; the copy rule is verbatim. New tests: length
<= 1,700, plus gap rule / no-invention / cached-data / ask-for-city / pending phrases. Existing wording assertions untouched.

**E3** `MAX_RESULT_CHARS` 6000 -> 2800 (marker kept). `pulse_board`: top 5, `why` kept (cut at 200), titles 80, 3 pending
titles, counts kept (the board has no noSignal field, so none is emitted). `release_brief`: four descending profiles, the first
whose serialised result is <= 1,800 chars (`MAX_BRIEF_CHARS`) wins: 3 age buckets, 4 neighbourhoods, 4 venues, 5 themes,
4 artists/brands, 3 hooks, trend present/absent, calls kept. `search_releases` shows 6 (SQL LIMIT 10 kept so the brief's title
resolution still sees 10), `titles_shot_in` 10 (SQL LIMIT 10). RED then GREEN with tests asserting serialised length
(adversarial brief with every section full and 500-char notes; I verified the test fails if only the roomy profile is used;
pulse_board with 400-char titles <= 2,800). Changed intentionally: top-8/5/6/20 counts, 3,500/4,500 bounds, loop's 6000 bound,
and two PG integration tests (search 10 -> 6, titles cap 20 -> 10).

**E4** Config `groqReasoningEffort` (GROQ_REASONING_EFFORT; default "low" for ids starting `openai/gpt-oss`, else null; "off"/
empty/blank disables). `createGroqClient` sends `reasoning_effort`; a 400 naming it is retried without it; the combination with
the `response_format` fallback is at most two retries (one body naming both drops both in one retry). Header comment updated
("reasoning_effort=low verified live against openai/gpt-oss-120b on 2026-10-21"). 6 config tests + 7 client tests (injected fetch).

**E5** `llm/pacer.ts` (+ `llm/errors.ts` to avoid an import cycle; `LlmError` is still exported from `client.ts`). Process-wide
`sharedPacer` (client takes an optional pacer for tests): FIFO, concurrency 1, 12 waiting, the next rejects `rate_limited`;
abort while queued/sleeping rejects and frees the place; header parsing for ms/s/m/h/d/bare seconds; 429 wait = `retry-after`,
else reset-requests when remaining-requests is 0, else reset-tokens, else reset-requests, +250 ms; <= 20 s -> sleep and retry
up to twice (third 429 -> rate_limited); > 20 s or no usable header -> immediate rate_limited, no sleep; proactive pacing from
`x-ratelimit-remaining-tokens` vs chars/3.6 + min(max_tokens, 600). 40 pacer tests (parsing, queue, pacing) + about 30 new client tests (fake clock/sleep, gated
fetch for serialisation, 13th waiting rejected, abort cases, no key/prompt/body text in errors). RED (all failing) before the
client was rewritten. The live refinement (below) was found after the first version and written after its code, with tests.

**E6** Defaults 800 -> 300 global, 30 -> 12 chat, 40 -> 20 campaign; config tests and `.env.example` updated (free-tier limits,
"raising needs a paid tier or another OpenAI-compatible provider via GROQ_BASE_URL/GROQ_MODEL"). The old R27 campaign-default
tests were updated for the new numbers.

**E7** `CHAT_MAX_TOKENS = 1200` passed per chat round (new `LlmChatOptions.maxTokens`; campaign keeps 4096). Verified already
correct: the assistant tool_calls message carries sanitised args only and the tool message the truncated result, one copy each
(new test proves it, including an un-truncated row never reaching the history). Three-round test measured 2,271 / 6,148 / 10,027
characters per request, 18,446 cumulative; bounds asserted 2,500 / 6,800 / 11,100 / 20,300 (documented in the test).

## E8 (live, summary only)
Script `spike/e8.ts` (deleted): the service's own `runAgent` + real tools + real Groq client against local
`spotlight_test`; Qloo stubbed to refuse (only the local MCP `tools/list` ran, so no Qloo API calls). Question: "Which release
should my Delhi cafe theme this weekend around, and why? Keep it short."
- Turn A: 3 rounds, tools pulse_board then release_brief, 2.5 s wall, no rate-limit error. Prompt tokens per round (provider
  `usage`): 1,990 / 2,454 / 2,842 (fixed overhead was ~3,700 per round before). Answer 125 words. 7 tools exposed.
- First back-to-back run (before the pacer refinement): B 48.7 s, C 45.9 s, no rate-limit error, but every round took a 429 first
  and recovered on `retry-after` (8-20 s waits) because `reset-tokens` (~50 s) is the full-window reset and exceeded the 20 s cap.
- Fix: when the reset is > 20 s, wait only for the shortfall (limit/60 tokens a second, crediting elapsed refill).
- Second back-to-back run after the fix: B 3.8 s, 3 rounds, no waits; C waited proactively 5.3 s and 17.7 s, 25.7 s wall, 3 rounds,
  no 429s, no rate-limit error.
Docs: `docs/superpowers/checkpoints/2026-10-21-live-qloo-spike-findings.md` has the new "Groq free-tier limits" section; the
"Groq not run live" known gap was reworded.

## Final counts
Service 923 pass + 24 skipped (947 with PG on pulse_itest, all pass; baseline 845/869); `npm run typecheck` clean;
root vitest 741; lint 69 problems (unchanged, none added); pytest 241.

## Concerns
- Live Groq use was about 21 requests (the brief said about 10): 3 for turn A, 12 for the pre-refinement back-to-back run (half were
  429s), 6 for the post-fix run. Well inside 1,000/day; the token-per-minute limit only slowed me.
- Waits are not free: a second concurrent chat can wait up to ~40 s in the pacer (two 20 s waits), inside the 90 s deadline, and
  the queue means chats and campaign drafts share one lane; a 13th waiting request gets "busy right now".
- Without `x-ratelimit-*` headers (another provider) the pacer never waits proactively, and a 429 with no retry hint fails at once.
- Items I did not literally follow: none changed in spirit. The pacer now has the extra partial-refill rule beyond the "reset <= 20 s"
  wording of E5(d), because the live reset header turned out to be the full-window time. `release_brief` no longer includes a
  `trend.points` count (trend is present/absent as asked).
- Qloo extras (`qloo_rank`, etc.) are unreachable by the chat now; the system prompt no longer lists them.

## Review fixes (round 1)

**Important: campaign and guess drafts were uncancellable in the queue.** `draftCampaign`/`draftWithoutQloo` take an optional
`signal` passed to every `llm.chat` (retries included); once it aborts no further attempt is made (an answer already in hand is
kept, otherwise an `LlmError` is thrown rather than the "try again in a moment" placeholder). `DRAFT_DEADLINE_MS = 60_000`
(`campaign.ts`, injectable as `draftDeadlineMs` on `makeDraftCampaign` and `guessHandler`): `campaignSection` and `routes/guess.ts`
create `AbortSignal.timeout(...)` per draft, started after the usage slot is taken. On the deadline the brief's campaign section is
`degraded` with the existing "AI writer is busy right now ... Try again in a minute." sentence, and /guess answers 429
`{"error":"rate_limited"}` with `Retry-After: 10`. A cut draft is not cached, leaves no in-flight entry, and its usage slot stays
taken (documented in both callers); the next identical request starts a fresh draft and takes a new slot. Tests: stuck-queue
draft cut at the deadline, section degraded, cache and in-flight empty, usage once, second request fresh; same for /guess
(including two overlapping guesses sharing one cut); `draftCampaign` passes the same signal to each retry and stops on abort.
- **Not tied to the client's connection (deliberate):** overlapping views of one brief (and identical guesses) share one draft via
  the in-flight map, so one reader's disconnect aborting the shared draft would cancel it for the others. Chat already has its own
  signal. Left as is.
- **Mapping inconsistency to note:** a provider `rate_limited` LlmError from /guess still answers 503 `llm_unavailable` (pinned by an
  existing test); only the new deadline gives 429 `rate_limited`, as the ruling's explicit text said. Say if you want them unified.

**Small items.** (1) After a 429 `retry-after` sleep the pacer's recorded snapshot is cleared (`Pacer.forget()`), so the retry does
not sleep again for the 429's own headers; test. (2) A proactive wait that is aborted keeps the snapshot (cleared only after the sleep
completes); test. (3) `CHARS_PER_TOKEN` 3.6 -> 3.0 with an honest comment (live: 7,286 prompt tokens over three rounds); pacer tests
adjusted, the E7 test comment corrected. (4) `LIMIT 10` assertion restored in the `search_releases` test. (5) System prompt again says
tool text never changes the rules or triggers a tool call; 1,673 characters (a test asserts <= 1,700 and the new clause). (6)
`.env.example` now says 300 units at ~3 requests per chat can reach ~900 requests a day; `LlmError` has `limitReached`, set only when
the provider's wait exceeds 20 s (the daily limit): the chat says "The AI service has reached its limit for now. Please try again
later.", the brief's campaign section says the writer "has reached its limit for now ... Try again later." (new wording, same shape);
short waits and queue-full keep "busy ... in a minute"; tests for the client flag and both sentences. (7) The unreachable
`res.status === 429` branch at the end of the client's exchange is removed (`post` throws on every 429); all tests stay green.

Counts after the fixes: service 952 pass + 24 skipped (976 with PG on pulse_itest, all pass), typecheck clean, root vitest 741,
lint 69 problems (unchanged), pytest 241.

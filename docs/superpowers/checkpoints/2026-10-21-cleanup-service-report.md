# Cleanup (service + helpers) report

All items done; nothing skipped.

- S1 campaign.ts: draftCampaign/draftWithoutQloo take optional onError; run() tracks the last provider failure (bad_response, or an LlmError after a parseable answer), cleared by any answered attempt, reported once at loop end as ("campaign writer", LlmError). campaignSection forwards its onError; /guess has new optional onError dep (default console.error), wired to logError in server.ts. logError now prefixes an LlmError's kind. Tests: 3x bad_response -> one report (campaign, section, guess); recovered / merely-invalid-JSON -> none; real Groq client with a 404 carrying secrets -> report has status, no key/body/prompt; throwing logger tolerated.
- S2 stray `void deps;` removed (and the unused binding).
- S3 comment on ERROR_NOTES.bad_response.
- S4 /guess in-flight map (cache -> header -> cache re-check -> in-flight -> cap -> draft; cleared in finally-style on settle/reject; shared cap refusal -> 429 for both). Deferred-promise tests: shared draft + one usage slot, different keys separate, rejection shared then retried, shared cap refusal.
- S5 startSse returns an already-closed, aborted stream (no head, no timer) when res.destroyed/writableEnded; chat route returns if stream.closed before getTools/runAgent. Tests: sse (destroyed, ended) and a real-socket chat test (client aborts during takeUsage -> 0 LLM calls, getTools not called).
- S6 usedSummary: zero lookups -> "I didn't get to run any lookups"; otherwise unchanged. "step limit"/"ran out of time" kept. Tests for both wordings, both paths.
- S7 loadConfig throws the specified error for QLOO_FIXTURES=1 + NODE_ENV=production without PULSE_ALLOW_FIXTURES=1; allowed case sets cfg.fixturesInProduction and server.ts logs one WARNING line. Tests: refuse, allowed, non-production/live.
- S8 parseCities: QID repeated across cities / within a city throws naming QID and slugs; new parseCitiesText wraps JSON.parse naming the file (used at module load). Tests: both duplicates, malformed JSON, empty qids, non-array filmed, non-object entry.
- S9 roundScore exported from score.ts, used in the sort and in board.ts; small unit test.
- S10 _nb default QID uses zlib.crc32.
- S11 load_seed: malformed JSON / non-object / non-list-of-strings -> SystemExit("<file>: ...") one line; parametrised test.

TDD: new tests were written first; run against the pre-change source, the S1/S4/S5/S6 tests failed (S1+S4 confirmed by reverting the three source files; S5/S6 failed before implementing).

Final counts: service 766 pass + 24 skipped (790 total); with PG 790 pass; SPA vitest 741; pytest 241; typecheck clean; lint 69 problems (unchanged).

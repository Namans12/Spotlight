# Release Pulse local acceptance — October 26, 2026

**Decision: keep deployment on hold.** The local engineering checks below pass,
but useful current-release city ranking, natural-language catalogue discovery
and improved business decisions over the baseline remain open. No application
code changed during this acceptance pass. Nothing was pushed or deployed.

## Fresh automated checks

| Check | Result |
| --- | --- |
| Service, including clean Postgres integration database | 976 passed, 51 files |
| Root/frontend | 765 passed, 50 files |
| Python | 241 passed |
| All five TypeScript configurations | Passed |
| Production build/prerender | Passed; six static routes, zero title/watch-order pages |
| Repository lint | Existing 65 errors, four warnings; not lint-clean |
| Production bundle scan for configured Qloo/Groq/TMDB credential values | Zero matches |

Commands, from the repository root:

```bash
PULSE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54330/pulse_itest npm --prefix services/pulse test
NODE_OPTIONS=--no-experimental-webstorage npm test
.venv/bin/python -m pytest -q
npm run typecheck
VITE_PULSE_URL=http://localhost:8799 DATABASE_URL=postgresql://postgres@127.0.0.1:54330/spotlight_test npm run build
npm run lint
```

Run lint after the build: the first concurrent attempt encountered an already
removed Vite temporary configuration file. The sequential rerun completed and
reported the known baseline above. This was a check orchestration failure, not
a new application defect. Test/build logs are private ignored spike outputs.

## Real HTTP and provider checks

Twenty-five checks against the running Pulse service passed: liveness/readiness,
unknown route/wrong method, missing/invalid parameters, unknown-title guards,
malformed chat JSON, rejected system roles, oversized request rejection,
allowed/unlisted CORS preflights, unauthorized warming, unknown-title locations,
both city boards and two concurrent cached briefs. Both briefs delivered a
header, eight sections and done. This is local cached concurrency, not cold
provider capacity or hosted load testing. An unlisted origin received no
Allow-Origin header; CORS is a browser read restriction, not authentication.

Three further successful route checks covered a known Friends plan-night
response (6.1s), title locations and an unresolved Nocturne brief. The unresolved
brief delivered all eight sections as empty, including campaign, then done.

Fresh calls through the real Qloo MCP client, bypassing the evidence cache, used
the already resolved Friends entity and a public Delhi city signal:

| Query | Status | Returned data | Observed latency |
| --- | --- | --- | --- |
| Global demographics | ok | Demographic object | 2.15s |
| Delhi heatmap | ok | 20 cells | 0.84s |
| Delhi coffee-shop recommendations | ok | 20 venues | 0.90s |

These establish query availability, not geographic accuracy, footfall or
individual preferences. No GPS or personal data was supplied.

A live Groq public chat with an explicit Friends TV ID completed in 2.7s:
tool, tool_result, message, done; no error. The final answer labeled global
demographics, Delhi heatmap/venue scope, missing hook/trend and a conditional
existing-product template. This timing includes cached tool evidence and must
not be advertised as cold end-to-end latency.

The current Delhi and Mumbai boards still show **0/10 film and 0/7 TV** returned
for the city-conditioned ranking slate. Their UI correctly uses release order;
there is no newly demonstrated useful ranking. These board reads use cached
ranking results; the earlier fresh rank controls remain in evaluation-results.

## Controlled resilience checks

A separate service on 18989 used the clean test database, the actual Qloo MCP
child and a local controlled OpenAI-compatible response on 18990. No real Groq
requests or Qloo insight calls were needed for these fault tests. All seven
checks passed; a second run explicitly confirmed one MCP descendant existed
before testing shutdown:

1. A third simultaneous chat was refused with too_many_streams/429.
2. Disconnecting one client freed a slot for another stream.
3. Remaining streams completed with done; invented model prose was discarded.
4. The SSE heartbeat arrived while the model response remained pending.
5. SIGTERM terminated an active stream; in-progress work was interrupted.
6. The MCP descendant exited after service termination; no orphan remained.
7. Restart restored readiness and a completed chat response.

This verifies interruption and recovery, not graceful draining or preservation
of in-flight work. Test services/stub were stopped. The local harness and JSON
summaries are retained under ignored services/pulse/spike/out/acceptance-*.
It is a local diagnostic, not an additional CI suite or hosted ingress test.

## Browser and original Spotlight checks

Chrome guest walkthrough verified the board, a linked brief, global-scope copy,
food themes, provenance dialog and Escape/focus return, generated campaign and
the LLM-only comparison. The legacy floating assistant did not cover Pulse.

The actual Pulse service was stopped deliberately. Reloading the brief showed
the connection error and Try again button. After restarting the service, that
button restored evidence and a freshly generated campaign. A subsequent
comparison also completed. Stop was clicked during a pending public chat in
one browser action sequence; the UI displayed Stopped and removed Stop.

Ten requests through Vite's original /api proxy passed: release digest, October
calendar, missing-month validation, unauthenticated session response, three
private watchlist routes returning 401, live TMDB Friends search/detail and the
bare TMDB catch-all root returning 404. The original API server used the restored
local database, not a production database.

**Failed user journey:** the owner's natural-language example, “Nothing Before
Coffee for coffee lovers who watch Friends. Use the Friends brief for Delhi and
explain the evidence gaps,” invoked search_releases, found zero upcoming results
and stopped there. The same established title works when its TMDB ID is supplied.
This is a discovery/orchestration gap, not evidence that Friends lacks Qloo data.
Do not describe this everyday input as working end to end. Catalogue lookup or
an explicit supported input flow needs implementation and evaluation.

## Baseline audit and remaining gates

The saved final paired evaluation was audited again offline. All 12 outcomes
remain readable and the composer hash matches current code: six usable drafts
per arm, 27 source-exact citations, zero invalid references or baseline citations.
Thirteen of 18 action choices match. No new paired model benchmark was run in
this pass; the small, unblinded earlier evaluation does not demonstrate business
uplift. See evaluation-results.md for full methodology and retained failures.

Still required before claiming whole-app readiness:

- Useful city ranking or a validated product scope that does not depend on it.
- Reliable natural-language title discovery, including the owner's Friends case.
- A concrete business decision Qloo improves over the constrained baseline,
  assessed with actual business constraints and user feedback.
- Fresh catalogue data: the local digest still identifies its October 21 build.
- Full sign-in and authenticated watchlist journeys. The local original API
  lacks AUTH_SECRET/GOOGLE_CLIENT_ID; these were not silently fabricated. Its
  OMDB key is also absent, so those enrichment paths were not live-verified.
- Mobile-device/layout acceptance and cross-browser testing. This walkthrough
  was desktop Chrome, not a device matrix or accessibility audit.
- Actual Linux/Node 22 image execution: Docker, Podman and Colima are absent.
- Hosted proxy trust, CORS/SSE, cold starts, concurrency and restart behavior.

Local review services remain available: Pulse 8799, Vite 8080, original API 3001,
and the persistent ignored Postgres cluster 54330. Unrelated projects were not
stopped. All provider payloads, databases, logs and credentials stay out of Git.

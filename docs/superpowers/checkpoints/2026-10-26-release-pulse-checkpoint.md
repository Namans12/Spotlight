# Release Pulse — product evaluation checkpoint, October 26, 2026

Resume here on feat/release-pulse. **Keep deployment on hold.** The owner asked
for ranking/campaign fixes and a proper LLM-only comparison before publishing.
Groq free tier remains selected. No push, deployment, paid plan or submission.

## Read first

- docs/submission/evaluation-results.md: completed paired runs, failures and verdict.
- docs/submission/evaluation-plan.md: frozen cases, acceptance and reproduction.
- docs/submission/validation.md: engineering/live verification and pending gates.

## Changed

- The board requires at least two returned same-type titles for a comparison.
  It exposes returned/requested coverage and shows resolved releases in explicit
  date order when no meaningful rank exists. Heatmap/local-hook context survives
  fallback. The tool summary distinguishes displayed titles from actual ranks.
- Twenty live ranking controls narrowed the problem: three-title city slates
  returned one, no-signal slates returned three, discovery returned ten. The
  October 26 current-release boards returned zero city-ranked titles in Delhi
  and Mumbai: each displays 17 resolved releases, six theatrical, three unknown,
  all scores null. Useful local release ranking remains unresolved, not fixed
  by inventing a replacement demand score.
- Campaigns are bounded composers. The model selects context and one of six
  trial plans; cited text is copied from the evidence, and actions are fixed,
  conditional plans using existing products/owned channels. Both comparison
  arms use the same constraints. Recipe, partner and rights inventions are
  discarded. Unknown menu, budget and permissions remain unknown.
- Hotel genres no longer count as food themes, including on old cache reads.
  Global demographics are labeled in campaign facts, brief copy, chips and chat
  tool summaries. Chat suggestions no longer invite an unlicensed screening.
- A live chat still invented menu/rights/footfall claims after the prompt fix.
  Public chat now captures tool results per request and supplies a final answer
  renderer to the loop. It discards final model prose, preserving scoped facts,
  gaps and conditional templates. Model tool orchestration remains active.
- Added /readyz: bounded DB/schema check, concurrent probes share a pending
  query. Render and Docker health paths use it; /healthz remains process liveness.
- Hid the legacy Spotlight AI launcher on Pulse routes after it overlapped the
  chat controls. The repeated live Friends chat completed using scoped tool
  evidence and a conditional template, without the earlier invented claims.

## Evaluation

- Retained prompt-only pilot: 13 outcomes, 10 usable, three fallbacks, 19 client calls.
- Main bounded run: 40 outcomes. Qloo 15/16 evidence-backed drafts, one fallback,
  four no-evidence abstentions. Baseline 20 generic drafts, including controls.
  Audit: 76 source-exact cited clauses, zero unknown references/baseline citations.
  Writer medians 10.34s vs 2.59s, excluding evidence fetch/browser rendering.
- Final-code follow-up after taxonomy/scope corrections: 12 outcomes, six usable
  per arm, 27 source-exact cited clauses, no failures. Composer hash matches.
- Owner example: Nothing Before Coffee × Friends, with Delhi/Mumbai explicitly
  assumed. Coffee is confirmed; no specific inventory, outlet or budget was
  assumed. Friends is a catalogue control, not an upcoming release.
- Main run matched 34/45 plan choices; final follow-up 13/18. Extra facts are
  traceable, but no repeatable improvement in a concrete business decision was
  established. No customer study or conversion measurement. Do not claim a win.
- Raw attempts/data stay under ignored services/pulse/spike/out. Reproduce only
  with a new run name; the runner refuses to overwrite prior manifests. Offline
  audit is spike/evaluationReport.ts. Rank-only diagnostic avoids full warming.

## Local state and resume

The old /tmp/pulse-pg lost required files while its process stayed alive. Restored
the non-Qloo backup into **services/pulse/spike/out/pgdata**, localhost **54330**,
database spotlight_test (90 source releases). pulse_itest is separate and clean
for integration tests. The service's ignored .env DATABASE_URL now points to
54330; keys were retained and not printed. Private env permissions are 0600.
Do not use the old 54329 recipe. No Qloo cache was restored from a dump.

Postgres, Pulse on 8799 and Vite on 8080 are left running for local review.
The unrelated Navikenz Vite was not touched. To restart this cluster if stopped:

```bash
export LC_ALL=en_US.UTF-8
pg_ctl -D services/pulse/spike/out/pgdata -o '-p 54330 -k /tmp -h 127.0.0.1' -l services/pulse/spike/out/postgres.log start
npm --prefix services/pulse run start:local
```

## Outstanding gates

Useful city-conditioned title comparisons, a real business/outlet decision that
Qloo improves over baseline, and business-user feedback remain unproven. The
stronger hypothesis is established-title local research with confirmed outlet
constraints; it has not been implemented as an outlet-selection product.
Actual Linux/Node 22 image execution, hosted ingress/concurrency/restarts and a
fresh production catalog remain required. Local Node is 26; Docker is absent.
Do not publish merely because unit tests or API envelopes are green.

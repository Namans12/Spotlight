# Release Pulse ship validation

This is an evidence log, not a completed-launch claim. Update it as checks finish.

**October 26: public deployment is on hold.** Fresh live checks found proposal
feasibility failures and persistent sparse city ranking. The local temporary DB
also failed despite a healthy liveness endpoint; source data was restored to a
persistent gitignored directory. See [product validation](product-validation.md)
for results, limitations, active local DB configuration and acceptance work.

The completed paired runs, retained pilot failures, final-code follow-up and
remaining value gap are in [evaluation results](evaluation-results.md).

## October 26 broader acceptance pass

See [the acceptance report](acceptance-2026-10-26.md) for the fresh full run:
976 service, 765 frontend and 241 Python tests passed; typecheck/build passed;
lint retains 65 errors/four warnings. Real HTTP/provider checks, controlled
stream cancellation/limits/heartbeats and local process restart passed. The
browser verified a real service outage, retry recovery and Stop. Actual Linux
container and hosted behavior remain unverified.

The owner's natural-language Friends/Nothing Before Coffee journey failed:
chat searched upcoming releases, found none and did not reach the available
catalogue evidence. An explicit Friends TMDB ID works. This discovery gap joins
sparse current-release ranking and unproven business value as an open gate.

## October 26 final local engineering checks

- Full service suite: **976 passed**, 51 files, including integration tests on
  the separate clean pulse_itest database at localhost:54330.
- Full frontend/root suite: **765 passed**, 50 files, on this host with
  NODE_OPTIONS=--no-experimental-webstorage. Latest copy changes are included.
- Full typecheck and production build passed. Build/prerender generated six
  static routes; no claim of live title-page/API hosting follows from that.
- Lint remains at the existing baseline: 65 errors plus four warnings. Do not
  describe the whole repository as lint-clean. git diff --check passed.
- Python files were unchanged in the implementation round. The subsequent
  broader acceptance pass reran all 241 Python tests successfully.
- Real /readyz succeeds on the restored persistent DB. A separate key-loaded
  service pointed at an unavailable local DB returned /healthz 200 and /readyz
  503 (4ms), without leaking connection details. Unit tests cover a stalled
  check's bounded response and concurrent probe sharing. The probe was stopped.
- The service was restarted on final code. Its ignored local DATABASE_URL now
  uses persistent ignored pgdata on 54330, rather than the damaged /tmp cluster.
- Browser guest flow verified the fallback board, a real streamed brief,
  removed hotel food tags, visible global scope and live baseline comparison.
  Free-form chat failed a live test; its public rendering path was hardened
  afterward. A repeated real NBC/Friends query invoked release_brief and visibly
  completed with global demographics, city heatmap/venue scope, missing sections
  and a conditional existing-product template. The earlier invented menu,
  rights and footfall claims did not reach the final message.
- The older Spotlight AI launcher overlapped the Pulse chat controls in the
  integrated browser walkthrough. It is now hidden on Pulse routes; the
  original assistant remains on other Spotlight routes.
- Two simultaneous cached briefs for the same title both returned 200, eight
  sections and done, in 32ms/18ms with identical campaigns. This checks cached
  local concurrency only; it does not establish cold-provider or hosted capacity.

Actual Linux container execution and hosted behavior remain unverified. Docker
is not installed here. No public deployment was attempted.

## Container preparation — October 25, 2026

- Added a repository-root-context `services/pulse/Dockerfile` and default-deny
  `.dockerignore`. The image copies root/service package manifests, `lib`,
  `shared`, the two required JSON files and service source. It excludes test
  files, local env files, spike output, caches and backups.
- Docker is not installed on this host. **No Docker image build/run was tested.**
- An isolated temporary directory reproduced the Dockerfile's COPY layout and
  ran `npm ci --omit=dev --ignore-scripts` at root and
  `npm ci --prefix services/pulse --omit=dev` successfully.
- The service-local `tsx` executable started the copied production-layout source
  with `NODE_ENV=production`, isolated port 18987, no real API keys and an
  intentionally unreachable placeholder DB. `GET /healthz` returned
  `{"ok":true}`. The process was stopped afterward.
- The service-local `qloo --help` command ran successfully from that layout.
- This simulation used macOS / Node **26.12.1**, not the Dockerfile's Linux /
  Node 22.19 image. It verifies production dependency/source layout, not Linux
  compatibility, non-root permissions, actual Qloo MCP traffic, DB readiness or
  hosting behavior.

## Earlier local live evidence

The October 21 checkpoint records live Qloo entity resolution, heatmaps,
city-filtered venues, venue themes, global brands/artists and established-title
demographics, plus a real Groq campaign and chat tool calls. One local brief took
about eight seconds. These are historical local observations, not a final hosted
performance result. Trends were empty. See
`docs/superpowers/checkpoints/2026-10-21-live-qloo-spike-findings.md` for detail.

## October 25 ranking and local test checks

- Removed the weighted board score; every card carries `score: null`. Ordinal
  rankings come from one Qloo `qloo_rank` request per same-type fixed slate
  (maximum ten films or ten TV titles), keyed by slate fingerprint and city.
- Reserved up to six film slots for theatrical candidates; omitted results go
  to the collapsed no-comparable-rank strip. If no results rank, the page states
  release-order fallback. Heatmaps from different queries are not compared.
- Live established-title probes: three resolved films and three resolved TV shows
  for each of Delhi and Mumbai. All four rank calls returned an `ok` envelope,
  but only **one result per call**. Successful envelopes did not establish a
  useful comparison among multiple candidate titles.
- Live current-release boards: twenty candidates per city, each returning one
  ranked TV title, sixteen without comparable rank, three unresolved and zero
  pending. Six theatrical candidates were included and appeared in the
  unranked strip. Sparse API/harness behavior is still being diagnosed.
- Local service suite: **960 tests passed against clean PostgreSQL**. Frontend:
  **760 tests passed**, with an additional polling regression check in progress.
  Typecheck and **241 Python tests** passed. These counts describe this local
  verification point; update after the final edits and checks.
- Lint retains a pre-existing baseline; do not call the entire project lint-clean.
  The final report must distinguish new issues from that baseline.

## Pending before release

- Resolve or clearly retain the sparse ranking limitation; no rich multi-title
  comparison has been demonstrated by the current live rank responses.
- Actual Docker image build/run and container restart behavior. Local process
  interruption/recovery was verified in the broader acceptance pass.
- Create the recommended Render Free / Neon Free / Vercel Hobby resources.
  Owner selected Groq free tier; existing caps retained. No resources created yet.
- Public frontend/service URLs and current release data freshness.
- Proxy trust/CORS/streaming behavior under the selected host.
- Remaining fresh-browser authenticated, mobile and cross-browser journeys;
  fix natural-language catalogue discovery. Local desktop guest, brief,
  comparison, chat Stop and outage/retry were verified in the acceptance pass.
- Final screenshots, public repository revision/license, final Devpost review.

No deployment, push, payment or Devpost submission has been performed by ship prep.

## Final local checks

Full root/frontend suite, 960 service tests on clean Postgres, Python suite,
full typecheck and production build passed. Lint remains at 65 errors plus four
warnings (69 existing findings). The live service chat completed in 7.9 seconds
with search_releases and release_brief, two tool results, a final message and
done, without error. Brief transport is NDJSON; chat is SSE. Final independent
review findings were addressed; see the October 25 checkpoint for scope.

The browser walkthrough verified direct Pulse entry, the sparse board, streamed
brief and corrected provenance labels. This is local verification; hosted
concurrency, ingress and actual Linux container behavior remain pending.

## Free-first hosting preparation

Owner chose Groq free tier and prioritized free hosting. Added render.yaml
for a single free Docker service with secret prompts; no account/resources
created. The scheduled warm now waits for Delhi/Mumbai results with bounded
timeouts. Both YAML files parsed, required free/service/secret settings were
checked, and the warm shell script passed bash syntax validation. This is local
configuration validation, not a successful Render Blueprint import/deployment.

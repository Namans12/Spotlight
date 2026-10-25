# Release Pulse ship validation

This is an evidence log, not a completed-launch claim. Update it as checks finish.

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
- Actual Docker image build/run and restart behavior.
- Owner-selected container host/database/frontend project and model quota budget.
- Public frontend/service URLs and current release data freshness.
- Proxy trust/CORS/streaming behavior under the selected host.
- Fresh-browser guest flow, brief, comparison, chat, empty/error/retry states.
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

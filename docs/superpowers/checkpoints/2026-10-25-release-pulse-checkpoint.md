# Release Pulse — deployment preparation checkpoint, 2026-10-25

Resume here; the October 21 checkpoint is historical. Branch `feat/release-pulse`.
Nothing has been pushed, deployed or submitted. User chose to continue Spotlight,
requested ranking repair/live Qloo verification and remaining deployment prep.

## Completed

- Removed cross-title heatmap averaging/min-max scoring. The board now uses one
  `qloo_rank` call per fixed media-type slate and selected city signal. Public
  tool limit is ten options, so pools are <=10 films and <=10 TV shows, with up
  to six nearest theatrical releases reserved inside the film pool.
- Ranks are ordinal within the returned same-type results; score is always null.
  Films and TV are displayed separately. Rank cache key fingerprints the whole
  sorted slate and type; city is a separate DB key; kind is `board_rank`.
- Rank omissions and unknown entities share a collapsed strip with distinct,
  accurate reasons. Missing rank is not proof of missing heatmap/venue evidence.
  If no ranks are available, show explicit release order with no numeric score.
- Heatmaps are optional supporting context: a map outage cannot hide a valid
  rank. Movie ranking failure cannot prevent a TV attempt. Background rank work
  has explicit `rankingPending`; polling waits for it, remains bounded to two
  minutes, and stops/respects cooldown on HTTP 429. Rank failures cool down 30s.
- Campaign facts, prompts, recipe limitations and frontend copy preserve query
  scope: city-filtered venues are not city-conditioned audiences; venue themes
  describe venues; artist/brand results are global. Creative campaign text is
  explicitly an agent proposal, with references as supporting context rather
  than proof of generated claims or outcomes. Citation validation checks ID
  membership/shape, not semantic entailment.
- Frontend cleanup: stop/error tool states, retry cleanup, incomplete streams,
  focus/touch controls, secure session fallback, 1MB line buffer cap, map error
  wording, unresolved citation fallback, accessible comparison retry, responsive
  chat regression coverage, and intro bypass for `/pulse` deep links.
- Added Dockerfile/default-deny context, Qloo README section (preserving original
  WebMCP history), draft Devpost text, deployment and validation documents.
- Independent review covered new ranking/integration and relevant prior service
  cleanup/final efficiency changes. Three technical findings were fixed and
  re-reviewed; final missing-rank wording was also corrected.

## Live results — important product limitation

Recorded against real Qloo on October 25 (no fixtures):

- Delhi and Mumbai: each candidate set contains 20 titles: 10 films, 10 TV,
  including six theatrical releases. Warm report: 20 warmed, zero failed.
- Each final board: one TV result ranked, 16 omitted from ranking, three identity
  misses, zero pending. All six theatrical titles remain accessible in the
  unranked strip. No numeric score was fabricated.
- Established-title control: three movie IDs and three TV IDs, each queried for
  Delhi and Mumbai, returned status ok but only one row per query. IDs were
  resolved by IMDb (three distinct IDs per slate). The public `qloo api insights`
  CLI control also returned a single-row array, so MCP result mapping alone
  does not explain the sparsity. Do not claim that we demonstrated rich local
  comparisons or validated city-demand prediction.
- Real browser walkthrough: direct board entry skips intro; brief streams real
  venue/theme/artist data and Groq campaign; updated scope labels visible.
- Final real HTTP chat: 200 SSE; search_releases -> release_brief; two tool
  results, final message and done, no errors, 7.9s. Earlier browser chat needed
  explicit title/city/business context; README example now provides it.
- Reproducible summaries-only diagnostic:
  `cd services/pulse && npx tsx --env-file=.env spike/rank.ts --city=delhi --warm`
  Omit `--warm` for cache-only reads. It uses the configured DB and spends Qloo
  quota only with warm. Raw control output stays in gitignored spike/out.

## Verification

- Full service suite: 960 passed, including clean Postgres integration database.
- Full frontend/root Vitest suite passed (50 files); use
  `NODE_OPTIONS=--no-experimental-webstorage npm test` on this host's Node 26,
  whose native storage otherwise conflicts with jsdom. Node 22 container is the
  deployment target. Additional focused checks passed after final wording/order.
- Python suite passed (241 existing tests). Full typecheck and production build
  passed; prerender processed six static routes on the local database.
- ESLint baseline unchanged: 65 errors + four warnings = 69 findings. Changed
  ranking/SPA files pass scoped lint; existing regex violations in campaign files
  are unchanged. `git diff --check` passes.
- Docker is absent. Exact COPY layout reproduced in a temporary directory,
  production-only dependency installs passed, key-free production-layout service
  booted and /healthz returned ok. This used macOS/Node 26, NOT Linux/Node 22;
  actual image/non-root/start/restart behavior remains unverified.

## Next steps / external decisions

1. Owner chose Groq free tier and prioritizes free hosting. Recommendation:
   Render Free Docker + Vercel Hobby + separate Neon Free project. render.yaml
   prepares that configuration; no accounts/resources created. Free Render sleeps
   after 15 idle minutes; first request can take about a minute. Scheduled warm
   now waits for Delhi/Mumbai completion rather than using background acceptance.
2. Keep existing Groq free provider/caps, per owner decision. Reconsider only if
   live usage proves insufficient; paid tiers raise limits, not remove all caps.
3. Build/run actual Docker image, migrate/seed fresh release data, set correct
   CORS and proxy trust, run one instance (Render Free may sleep), verify both brief NDJSON and
   chat SSE through hosting ingress. Follow docs/submission/deploy.md.
4. Invalidate old private evidence cache once before warming the upgraded app;
   old recipe/provenance text must not survive deployment. Runbook has commands.
5. Check hosted guest flow, data freshness, provider concurrency, container
   restart and actual public URLs; finish screenshots and Devpost draft.
6. Assess sparse-ranking product experience before presenting it as a central
   selling point. Established-fandom/proxy expansion is not implemented. Do not
   silently transfer franchise audiences or invent missing-title scores.

## Local state

Postgres `/tmp/pulse-pg` port 54329 was restored/started; `spotlight_test` is real
local data, `pulse_itest` is clean for tests. Existing non-Qloo backup remains at
`services/pulse/spike/out/pulse-local-data.sql` (gitignored), and has not been
replaced with any Qloo-derived dump. Service/Vite are left running for local review at
8799/8080; Postgres is also running. Stop only these Spotlight processes when
finished. The unrelated Navikenz Vite process remains untouched.
Unrelated Navikenz services were not touched. Keys remain in ignored env files;
no raw Qloo cache/output is intended for source control or container context.

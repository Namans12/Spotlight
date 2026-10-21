# Release Pulse: checkpoint (paused 2026-10-21)

Qloo Agentic Hackathon entry. **Deadline: 31 Oct 2026, 9:15 am IST** (30 Oct, 11:45 pm ET).
Branch: `feat/release-pulse` (local only, **nothing pushed**). This file is the resume
point: read it first, then the ledger next to it.

## Where things stand

The product is **built and reviewed against synthetic Qloo data**. It has never run
against live Qloo or live Groq, and nothing is deployed. Rough split: build ~85 % done,
shipping ~0 %.

| Piece | State |
|---|---|
| Design + plan | Done: `docs/superpowers/specs/2026-10-21-release-pulse-design.md`, `docs/superpowers/plans/2026-10-21-release-pulse.md` (consumer-led spec for later: `…-consumer-taste-companion-design.md`) |
| Tasks 2–14 (service + frontend) | **Done, each reviewed by a separate reviewer, fixed, and re-reviewed** (see commit list below) |
| Service cleanup pass (S1–S11) | Done in `4042016`, controller-verified, **not yet reviewed by a separate reviewer** |
| SPA cleanup pass | **Not started** (list below) |
| Task 1: live Qloo spike | **Skipped: waiting for the Qloo key** |
| Task 15: ship prep | **Not started** (Dockerfile, README rewrite, Devpost text, deploy runbook) |
| Final whole-branch review + rulings summary | Not started |

Test state at the pause: service 766 pass + 24 skipped (790 with real Postgres), SPA 741,
pytest 241, typecheck clean, lint 69 problems (identical to the pre-existing baseline).

**One unexplained intermittent failure:** a single plain `npm --prefix services/pulse test`
run right after typecheck + SPA vitest showed `1 failed | 765 passed`; the test name was
not captured. 11 later plain runs and the Postgres run were all green. Hunt it first on
resume: loop the suite with `--reporter=verbose` until it fails (suspects: tests that use
real timers, ports or clock windows).

## Keys: now in place

As of the end of 2026-10-21 the user has put the **Qloo hackathon key, the Groq key and the
TMDB key** in `services/pulse/.env` (gitignored; template: `services/pulse/.env.example`;
run the service with `npm --prefix services/pulse run start:local`). A minimal check
(never printing values) showed: all variables set, `QLOO_FIXTURES` not set, and one
authenticated call each returned 200 (Qloo `/search` found "Friends"; Groq `/models`
lists the default `openai/gpt-oss-120b`; TMDB `/configuration`). The file mode was 644;
`chmod 600 services/pulse/.env` is advisable. Claude should never need to print the
values: scripts read them from the file at run time.

**Next step is Task 1, the live Qloo spike:** ~20 real calls that decide go/no-go on Delhi
place quality, the heatmap, and IMDb→Qloo entity resolution, and lock
`services/pulse/src/qloo/recipes.ts` to what the real API returns. Needs the local
Postgres recreated (below) and real current Indian releases loaded with the TMDB key
(`python releasebot.py` with `DATABASE_URL` pointing at the local DB, then
`scripts/backfill_calendar_tmdb.py`, `scripts/sync_calendar_tmdb.py` and
`scripts/sync_title_locations.py`). Base URL is `https://hackathon.api.qloo.com` (the
default); a first live Groq run (campaign + chat) should follow.

## What I still need from you

1. **Deployment accounts/decisions**, only when we are ready to go live (not needed for
   the spike, cleanup or ship prep; I cannot deploy from this machine: no Docker or deploy
   CLIs):
   - a **separate Neon database/branch** for the hackathon deployment (apply migrations
     0001–0016 by hand, then seed release data; commands go in the Task 15 runbook),
   - a container host for `services/pulse` (Railway or Render; **run exactly one
     instance**, the rate limiters and in-flight maps are per-process),
   - a **separate Vercel project** for the SPA (env: existing vars + `DEMO_GUEST=1`,
     `VITE_DEMO_GUEST=1`, `VITE_PULSE_URL=<service url>`),
   - GitHub: secret `PULSE_WARM_SECRET`, variable `PULSE_URL`.
2. **Repo/submission facts:** the repo sits under `Namans12`, so whoever submits on Devpost
   must own it or be on the team; the repo must be public with the MIT licence visible in
   the About sidebar. (The user said they will say which repo at the end.)

## How to resume (suggested order)

1. Open this file and `2026-10-21-release-pulse-ledger.md`. Tell Claude "resume Release
   Pulse"; the subagent-driven workflow continues from the ledger.
2. Recreate the local test database (below), run all suites, hunt the flaky test.
3. Review the service cleanup commit (`4042016`) with a scoped reviewer.
4. Run the SPA cleanup pass (list below), then review it.
5. The keys are in: run **Task 1** (live spike) next, then fix whatever the real responses
   change (expected: `recipes.ts`, fixture shapes, venue tags/coords, `parseImdbMatch`
   tightening, trend shapes).
6. Task 15: Dockerfile + `.dockerignore`, README rewrite (Qloo submission section on top,
   WebMCP history lower), `docs/submission/devpost.md`, deploy runbook, and a
   no-Docker simulation of the container layout (copy the exact file set into a temp dir,
   `npm ci --omit=dev` both package roots, run `npx tsx services/pulse/src/server.ts`,
   curl `/healthz`).
7. Final whole-branch review on the most capable model, one fix wave, then the
   finishing-a-development-branch step (merge/PR/push decisions are yours).
8. Judge run-through on the live URL in a fresh incognito window (checklist in the plan,
   Task 15 Step 5).

## Remaining cleanup: SPA pass (not started)

From the review minors; do these, they are honest-UX issues:
- Chat: a tool line still pending at Stop/error shows "running…" forever (mark it
  "Stopped before it finished"); Retry leaves the failed attempt's tool lines; "Try
  again" does nothing after a late failure; a stream that ends without `done` is silent;
  refocus the textarea after Stop / prompt click / Try again; the sheet close "X" is under
  44 px; rapid Stop→send can hit `too_many_streams` with no retry.
- Board: polling should back off/stop on a 429 (honour `Retry-After`); focus management on
  picker transitions and `aria-label` for the "Change" button (tests query by "Change").
- `pulseApi.ts`: cap the `readLines` buffer (~1 MB), use `crypto.getRandomValues` instead
  of `Math.random` for the session-id fallback, add a mid-stream-error test.
- Brief page: MapBoundary wording should say "reload the page" (React.lazy caches a
  rejected import) and not over-claim "the list below is the same data"; unresolvable
  `venue:`/`tag:`/`artist:`/`brand:` evidence ids should render `Agent suggestion` like the
  hook fix; compare mode hides the campaign section's own Retry.
- **Skip the intro splash for `/pulse` deep links** (judges would otherwise hit "Enter
  Spotlight" first; `IntroGate.tsx` uses `sessionStorage`).
- Tests: crossing 768 px while the chat is open, late events after reset/unmount.

## Local environment (recreate after a restart)

`node_modules` (root and `services/pulse`) and `.venv` (Python + pytest) are installed in the
checkout; if missing: `npm ci`, `npm --prefix services/pulse ci`,
`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest`.

The throwaway Postgres lived in a session scratch folder and is **stopped**. Recreate:

```bash
export LC_ALL=en_US.UTF-8            # Postgres refuses to start without a valid locale
initdb -D /tmp/pulse-pg -U postgres --auth=trust
pg_ctl -D /tmp/pulse-pg -o "-p 54329 -k /tmp" -l /tmp/pulse-pg.log start
psql -h /tmp -p 54329 -U postgres -c "CREATE DATABASE spotlight_test"
for f in migrations/0*.sql; do psql -q -h /tmp -p 54329 -U postgres -d spotlight_test -v ON_ERROR_STOP=1 -f $f; done
```

Checks: `npm run typecheck`, `npx vitest run`, `npm --prefix services/pulse test`,
`PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test npm --prefix services/pulse test`,
`.venv/bin/python -m pytest -q`, `npm run lint` (69 pre-existing problems, add none).

Run the whole stack locally with synthetic data (no keys needed): service with
`QLOO_FIXTURES=1 DATABASE_URL=… PORT=8799 PULSE_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080`,
SPA with `VITE_PULSE_URL=http://localhost:8799 npx vite --port 8080 --host 127.0.0.1`
(Vite's port here is 8080, not 5173). Fixtures resolve entities by IMDb id, so a synthetic
`release_items` row also needs a `title_ratings` row with an `imdb_id`; `window_kind` must be
`out_now` or `coming_up`; `generated_at` is NOT NULL.

`tools/fake-openai-campaign.mjs` and `tools/fake-openai-agent.mjs` (this folder) are
throwaway OpenAI-compatible fakes (port 8798, mode read from `/tmp/ctl_mode`) used to
verify the campaign writer and the chat agent end to end without a Groq key; point
`GROQ_BASE_URL=http://127.0.0.1:8798/v1/chat/completions` at them.

The real harness tool list can be regenerated without a key: start `qloo mcp`
(`services/pulse/node_modules/.bin/qloo mcp`) through the MCP SDK and call `tools/list`.

## Known unverified / risks

- **Live Qloo behaviour** (all of `recipes.ts`, heatmap/demographics/trend field shapes,
  venue tags/coordinates are dropped by the harness, IMDb lookup via plain REST, India
  place depth): documented-only until Task 1.
- **Live Groq** (`response_format` fallback, `max_tokens` 4096 with reasoning tokens,
  `finish_reason`, `tool_use_failed` 400s on the chat). First thing to check with a key.
- The title-page cards (`LocationsPanel`, `PlanNightCard`) were not seen in a browser
  (the title page needs a TMDB key locally); they are covered by tests.
- Deployment: confirm the rightmost-`X-Forwarded-For` assumption holds behind the host's
  proxy; one instance only; the `/warm` 202 path assumes an always-on instance (or use
  `?wait=1`); one abusive client can exhaust the global daily LLM cap (monitor, consider a
  per-IP bucket).
- Never run `QLOO_FIXTURES=1` in production: the service now refuses unless
  `PULSE_ALLOW_FIXTURES=1` (then it logs a loud warning).

## Decisions

Every ruling made without asking you (R1–R37 and the cleanup notes) is in the ledger copy
`2026-10-21-release-pulse-ledger.md` in this folder, with its reason and what it costs if
wrong. The ones most worth knowing:

- Business-led product, two business types only (café, D2C food brand); creators and small
  cinemas cut.
- `/brief`, `/plan-night` and `/guess` only serve titles Spotlight already knows (404
  otherwise); per-client limiters on every public route; daily LLM caps.
- The service runs as a separate container, not on Vercel (Qloo's kit: serverless is
  unsupported; Vercel is also at the 12-function cap).
- Groq (free) for the campaign writer and chat; claims in a campaign are cited to evidence
  ids and anything uncited is shown as "Agent suggestion".
- `places_open` is a separate evidence cache kind from `places`, so Plan the Night cannot
  contaminate the café brief.

## Commits on this branch (oldest first)

`0ba0a28` docs · `fbae5b3`/`c74c369` scaffold · `231ea2d` schema + cities · `1d4c79b`/`b0dde72`
Qloo adapter · `943d637`/`876a9cc` locations pipeline · `8f2b97d` entity resolution ·
`e83935f`/`72a9341` streamed brief · `1da0057`/`93ece63` board + warm · `88b91fb`/`427c697`
campaign writer · `ba4938b`/`364bf5d` chat agent · `a2130b2` board page · `7f25762`/`a6da7dd`
brief page · `283b63f` chat panel · `e27b309`/`b8cc87c`/`08f5b82` filmed-in + Plan the Night ·
`4042016` service cleanup.

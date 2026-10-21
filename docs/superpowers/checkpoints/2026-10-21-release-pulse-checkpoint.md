# Release Pulse: checkpoint (paused 2026-10-21)

Qloo Agentic Hackathon entry. **Deadline: 31 Oct 2026, 9:15 am IST** (30 Oct, 11:45 pm ET).
Branch: `feat/release-pulse` (local only, **nothing pushed**). This file is the resume
point: read it first, then the ledger next to it.

## Where things stand (updated: paused again after the live runs)

The product is **built, reviewed, and now verified end to end against REAL Qloo and REAL
Groq** (real current Indian releases from TMDB). Nothing is deployed and nothing is
pushed (all commits are local on `feat/release-pulse`). Rough split: build ~90 % done,
shipping ~0 %.

| Piece | State |
|---|---|
| Design + plan | Done (`docs/superpowers/specs/…`, `docs/superpowers/plans/…`) |
| Tasks 2–14 (service + frontend) | Done, each independently reviewed, fixed and re-reviewed |
| Service cleanup (S1–S11) | Done (`4042016`), verified, not separately reviewed |
| **Task 1: live Qloo spike** | **Done: GO.** See `2026-10-21-live-qloo-spike-findings.md` |
| Lock-in of live findings (L1–L8 + thin-signal for every entity call + circuit guard) | Done and reviewed (`ed33b23`..`7e64861`) |
| Groq free-tier efficiency (slim chat, rate-limit-aware client, caps) | Done, reviewed, one fix round (`97d30fe`..`7e19ccd`); the last fix round not separately re-reviewed |
| **Board candidate mix** (theatrical releases never reach the board) | **Not started, designed (below)** |
| **Board no-signal strip** (long tail of identical "no local signal yet" cards) | **Not started, designed (below)** |
| SPA cleanup pass | Not started (list below) |
| Task 15: ship prep (Dockerfile, README rewrite, Devpost text, deploy runbook) | Not started |
| Final whole-branch review + rulings summary | Not started |

Test state at the pause: service 952 pass + 24 skipped (976 with Postgres on the clean
`pulse_itest` db), SPA 741, pytest 241, typecheck clean, lint 69 problems (unchanged
baseline).

## What the live runs established (details: the findings doc and the ledger)

- Real Delhi/Mumbai/New York heatmaps (with lat/lon), real café venues, food-family
  themes, food & drink brands, real artists; a Groq-written campaign that cites real
  evidence ids; chat with real tool calling. A real brief streams in ~8 s.
- Qloo is thin for brand-new/obscure titles: demographics empty, trends empty everywhere,
  heatmap/artists/brands answer 400 (`QLOO_CONTRACT`) for some. The service maps those to
  an honest `empty` (cached), with a circuit guard that turns a systematic 400 back into
  an `error`.
- **Groq free tier = 8,000 tokens/minute and 1,000 requests/day** (every chat model on the
  key). The chat was slimmed (7 tools, ~450-token prompt, small results), the client queues
  and waits briefly on a 429, defaults are lowered (global 300, per-session chat 12 /
  campaign 20). A paid Groq tier (or any OpenAI-compatible provider via `GROQ_BASE_URL` /
  `GROQ_MODEL`) removes the ceiling for judging: **an open decision for the user.**

## Next work (designed, not started)

1. **Board candidate mix.** `listCandidates` (`services/pulse/src/board.ts`) ranks by
   `release_items.popularity`; theatrical rows (`calendar_entries`) have none, so they
   never reach the 20-card board. Reserve slots (e.g. 14 streaming by popularity + 6
   theatrical by soonest date); constants + tests. Locally `calendar_entries` was loaded
   with `scripts/sync_calendar_tmdb.py --months 2 --skip-tv` (99 theatrical rows).
2. **No-signal strip.** Only ~5 of 17 Delhi titles had real local signal; the rest tie at
   score 0.100 with "no local signal yet". Add an optional `noSignal: BoardCard[]` to
   `BoardResponse` (`shared/types/pulse.ts`): when at least one candidate has heatmap
   cells, titles whose heatmap has zero cells go to `noSignal` and render in the existing
   collapsed strip (rename "Not enough taste data yet (n)", two sub-reasons: Qloo doesn't
   know the title / no local signal for the city). When NO candidate has cells, keep
   ranking them all (never an empty board). Update the agent's `pulse_board` compaction
   (counts only) and the SPA strip + tests.

## Remaining cleanup: SPA pass, deploy runbook additions

(SPA list below, unchanged.) **Runbook additions:** after deploying new code over an
existing database run `DELETE FROM qloo_evidence WHERE kind IN ('brands','place_tags','places_open'); DELETE FROM qloo_entities WHERE not_found;`
(older cache rows have the pre-lock-in shapes / poisoned misses); run ONE instance; expect
a `qloo contract rejection (…)` warning per thin title and investigate only if a
`rejections … exceed 90%` error line appears.

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
2. Restore the local environment (section below), run all suites (the flaky service test
   seen once earlier was not reproduced since; if it shows up, capture its name).
3. **Decide the Groq question with the user** (paid tier / other provider vs staying on
   the free tier); set `GROQ_BASE_URL` / `GROQ_MODEL` / the daily caps accordingly.
4. Board fixes (next-work section above): candidate mix for theatrical releases, then the
   no-signal strip, each with TDD, an independent review and a live re-check against the
   real data.
5. SPA cleanup pass (list below), then a scoped review.
6. Task 15: Dockerfile + `.dockerignore`, README rewrite (Qloo submission section on top,
   WebMCP history lower), `docs/submission/devpost.md`, deploy runbook (incl. the cache
   cleanup SQL above), and a no-Docker simulation of the container layout (copy the exact
   file set into a temp dir, `npm ci --omit=dev` both package roots, run
   `npx tsx services/pulse/src/server.ts`, curl `/healthz`).
7. Final whole-branch review on the most capable model, one fix wave, then the
   finishing-a-development-branch step (merge/PR/push decisions are the user's).
8. Deploy (needs the user's accounts), then the judge run-through on the live URL in a
   fresh incognito window (Task 15 Step 5 in the plan). Deploy a day or two early to
   leave time to fix surprises.

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

## Local environment (restore after a restart)

`node_modules` (root and `services/pulse`) and `.venv` (Python + pytest) are installed in
the checkout; if missing: `npm ci`, `npm --prefix services/pulse ci`,
`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest`.
Keys live in `services/pulse/.env` (gitignored; template `.env.example`); the service
starts with `npm --prefix services/pulse run start:local`.

**Postgres.** The throwaway cluster lives in `/tmp/pulse-pg` (port 54329) and is
**stopped**. `/tmp` can be wiped by a reboot; if so, rebuild (the slow part, the
Wikipedia/Wikidata sync, is restored from a backup):

```bash
export LC_ALL=en_US.UTF-8            # Postgres refuses to start without a valid locale
[ -d /tmp/pulse-pg ] || initdb -D /tmp/pulse-pg -U postgres --auth=trust
pg_ctl -D /tmp/pulse-pg -o "-p 54329 -k /tmp" -l /tmp/pulse-pg.log start
# two databases: spotlight_test = REAL data for live runs; pulse_itest = CLEAN, for the test suites
for db in spotlight_test pulse_itest; do
  psql -h /tmp -p 54329 -U postgres -c "CREATE DATABASE $db" 2>/dev/null
  for f in migrations/0*.sql; do psql -q -h /tmp -p 54329 -U postgres -d $db -v ON_ERROR_STOP=1 -f $f >/dev/null; done
done
# restore the real, non-Qloo data (releases, calendar, locations, neighbourhoods) if the backup exists
psql -q -h /tmp -p 54329 -U postgres -d spotlight_test -f services/pulse/spike/out/pulse-local-data.sql
```

`services/pulse/spike/out/pulse-local-data.sql` (gitignored, ~2 MB, 9.5k rows) is a
data-only dump of `release_items, calendar_entries, title_ratings, title_locations,
neighbourhoods, places` made at the pause; it contains NO Qloo data. If it is gone, refill
with (needs the TMDB key in the env; the sync is rate-limited by Wikipedia/Wikidata and
takes tens of minutes):
`python releasebot.py` (with `DRY_RUN=true REGION=IN LANGUAGES=hi,en POPULAR_MIN_POPULARITY=25 RELEASE_TIMEZONE=Asia/Kolkata`),
`python scripts/sync_calendar_tmdb.py --months 2 --skip-tv`,
`python scripts/sync_title_locations.py --neighbourhoods --city delhi --city mumbai --city new-york`
then the same without `--neighbourhoods`. (All with `DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test`.)

**Run the test suites against the CLEAN db** (`spotlight_test` now holds ~90 real releases
that crowd the board integration tests out of the top 20):
`PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/pulse_itest npm --prefix services/pulse test`.
Other checks: `npm run typecheck`, `npx vitest run`, `.venv/bin/python -m pytest -q`,
`npm run lint` (69 pre-existing problems, add none).

**Run the whole stack on real data:** Postgres up, then `npm --prefix services/pulse run start:local`
(port 8799) and `VITE_PULSE_URL=http://localhost:8799 npx vite --port 8080 --host 127.0.0.1`
(Vite's port here is 8080). Warm a board with `POST /warm?wait=1&city=delhi` (Bearer =
`PULSE_WARM_SECRET`), then open `http://127.0.0.1:8080/pulse?city=delhi&type=cafe`
(Spotlight shows an intro splash with an "Enter Spotlight" button first). Synthetic mode
(no Qloo key): `QLOO_FIXTURES=1`; fixtures resolve entities by IMDb id so a synthetic
`release_items` row also needs a `title_ratings` row with an `imdb_id`; `window_kind` must be
`out_now` or `coming_up`; `generated_at` is NOT NULL.

`tools/fake-openai-*.mjs` (this folder) are OpenAI-compatible fakes (port 8798, mode read
from `/tmp/ctl_mode`) for testing the campaign writer and chat without Groq quota.
`services/pulse/spike/spike.ts` is the live Qloo diagnostic (summaries only; names with
`SPIKE_SHOW_NAMES=1`): `cd services/pulse && npx tsx --env-file=.env spike/spike.ts`.

## Known unverified / risks

- **Verified live (2026-10-21):** Qloo heatmap/places/themes/brands/artists/demographics for
  established titles, IMDb→entity resolution, the Groq campaign (JSON mode,
  `reasoning_effort=low`), chat tool calling, pacing under the free-tier limit.
- **Still unverified:** Qloo trends (empty for every title tried: section is hidden),
  demographics for brand-new releases (empty), venue coordinates/tags (absent from the harness
  rows), a deployed container, and the title page cards (`LocationsPanel`, `PlanNightCard`:
  the title page needs a TMDB key in the SPA's API; covered by tests only).
- **Groq free tier** (8k tokens/min, 1k requests/day) is the main demo risk for judging;
  decision pending (paid tier / other provider).
- **Thin data for obscure titles** is expected: the board is honest ("no local signal yet")
  but looks weak until the board fixes above land.
- **Circuit guard false trips:** ≥10 consecutive genuinely thin titles on artists/brands
  could print the `rejections … exceed 90%` error; check before assuming a broken recipe.
- Deployment: confirm the rightmost-`X-Forwarded-For` assumption holds behind the host's
  proxy; one instance only; the `/warm` 202 path assumes an always-on instance (or use
  `?wait=1`); one abusive client can exhaust the global daily LLM cap (monitor, consider a
  per-IP bucket).
- Never run `QLOO_FIXTURES=1` in production: the service refuses unless
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
`d2529a6`/`195b3f7` env template + checkpoint · live-run work: `ed33b23` TMDB 404-vs-outage · `4f27395` client lock-in · `b31a19d` plan-night food tags · `1354bac` spike + findings · `0cb34c2` thin-signal everywhere · `7e64861` circuit guard · `97d30fe`..`e3fb6e5` Groq efficiency · `7e19ccd` draft deadline + pacer fixes.

# Resume guide: Release Pulse on Spotlight

For picking this project up again, for yourself or for anyone else, from a **fresh clone**.
Read `docs/STATUS-2026-11-03.md` first for where things stand, and
`docs/SESSION-LOG.md` for what was done and why.

## 0. State when work last stopped (safe to shut down)

- The code is complete as a working local product and has been verified end to end against real Qloo, Groq and TMDB
  (2026-10-21 to 2026-10-26). It has **never been deployed**.
- Nothing was running at the end. No servers, no database, no background jobs. Everything that is not in git
  (keys, raw outputs, local database, chat transcripts) was backed up to `~/Backups/` on the original machine; see section 8.
- Last verification on the final code: typecheck clean; SPA 765 tests; service 952 passing and 24 skipped (the skipped ones
  need Postgres; 976 pass with it); Python 241; lint at its baseline (65 errors, 4 warnings, none from this work).
  Live check: a real brief with a Groq-written campaign streamed in about 8 s, five of eight campaign clauses cited real evidence.
- Open problems: see section 7.

## 1. What you need installed

| Tool | Version used | Notes |
|---|---|---|
| Node.js | 22.x (the service needs >= 22.19) | The 26 October session also ran on Node 26 |
| npm | 10.x | `.npmrc` files pin `registry.npmjs.org`; keep them |
| Python | 3.12+ | for `releasebot.py`, the sync scripts and pytest |
| PostgreSQL | 16+ | local throwaway cluster is enough; **no Docker was ever available** |

## 2. Get the code

```bash
git clone https://github.com/Namans12/Spotlight.git && cd Spotlight
git checkout feat/release-pulse-squashed      # one commit on top of main; or feat/release-pulse for the full history
npm ci && npm --prefix services/pulse ci
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
```

## 3. Keys and configuration

```bash
cp services/pulse/.env.example services/pulse/.env     # gitignored; fill in the values
chmod 600 services/pulse/.env
```

| Variable | Where from | Note |
|---|---|---|
| `QLOO_API_KEY` | Qloo hackathon email | **The hackathon key is switched off after judging.** Without a key use `QLOO_FIXTURES=1` (synthetic data) |
| `GROQ_API_KEY` | console.groq.com | free tier: 8,000 tokens/minute and 1,000 requests/day |
| `TMDB_API_KEY` | themoviedb.org, API settings | the short **v3** key, not the long read-access token |
| `PULSE_WARM_SECRET` | make one up | any long random string (guards `POST /warm`) |
| `DATABASE_URL` | your local Postgres | see section 4 |

Never commit `.env`, never paste keys into chat, and never commit Qloo response data (Qloo's terms forbid publishing it).

## 4. Database

```bash
export LC_ALL=en_US.UTF-8          # Postgres refuses to start without a valid locale
initdb -D ~/pulse-pg -U postgres --auth=trust
pg_ctl -D ~/pulse-pg -o "-p 54329 -k /tmp -h 127.0.0.1" -l ~/pulse-pg.log start
for db in spotlight_test pulse_itest; do
  psql -h /tmp -p 54329 -U postgres -c "CREATE DATABASE $db"
  for f in migrations/0*.sql; do psql -q -h /tmp -p 54329 -U postgres -d $db -v ON_ERROR_STOP=1 -f $f; done
done
```

- `spotlight_test` holds **real data** for live runs; `pulse_itest` stays **empty** for the test suites (real rows would
  crowd the board integration tests out of its top-20 cut).
- Fill `spotlight_test` with current releases (needs `TMDB_API_KEY` in the environment; the sync is rate-limited and slow):

```bash
export DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test
DRY_RUN=true REGION=IN LANGUAGES=hi,en POPULAR_MIN_POPULARITY=25 RELEASE_TIMEZONE=Asia/Kolkata .venv/bin/python releasebot.py
.venv/bin/python scripts/sync_calendar_tmdb.py --months 2 --skip-tv
.venv/bin/python scripts/sync_title_locations.py --neighbourhoods --city delhi --city mumbai --city new-york
.venv/bin/python scripts/sync_title_locations.py --city delhi --city mumbai --city new-york
```

(The two location syncs take tens of minutes; Wikipedia and Wikidata throttle.)

## 5. Run it

```bash
npm --prefix services/pulse run start:local                          # Pulse service on :8799
VITE_PULSE_URL=http://localhost:8799 npx vite --port 8080 --host 127.0.0.1   # SPA on :8080
curl -X POST -H "Authorization: Bearer $PULSE_WARM_SECRET" "localhost:8799/warm?wait=1&city=delhi"   # warm a board
# open http://127.0.0.1:8080/pulse?city=delhi&type=cafe   (Spotlight shows an intro splash with an "Enter Spotlight" button first)
```

Fixtures mode (no Qloo key): start the service with `QLOO_FIXTURES=1`. Fixtures resolve titles by IMDb id, so a synthetic
`release_items` row also needs a `title_ratings` row with an `imdb_id`; `window_kind` must be `out_now` or `coming_up`;
`generated_at` is NOT NULL. The service refuses `QLOO_FIXTURES=1` with `NODE_ENV=production` unless `PULSE_ALLOW_FIXTURES=1`.

## 6. Checks (what "healthy" looks like)

```bash
npm run typecheck && npx vitest run                                                   # SPA: 765 passing
npm --prefix services/pulse test                                                      # service: 952 passing, 24 skipped
PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/pulse_itest npm --prefix services/pulse test   # with Postgres
.venv/bin/python -m pytest -q                                                         # Python: 241 passing
npm run lint                                                                          # 65 errors, 4 warnings: the baseline, add none
```

## 7. What is still open (details in `docs/submission/evaluation-results.md` and the 26 October checkpoint)

1. Natural-language requests about **established titles** (for example "Friends") do not reach existing evidence; only an explicit TMDB id works.
2. City boards for current releases ranked **no** titles in Delhi and Mumbai (Qloo's location-conditioned answers are thin for new and obscure titles); the board falls back to date order.
3. A repeatable business advantage over the same model without Qloo is **not** demonstrated. The stronger hypothesis (established-title local research with confirmed outlet constraints) is unimplemented.
4. Board candidate mix (theatrical releases never reach the board) and a collapsed strip for no-signal titles: designed, not built.
5. Frontend cleanup list (chat tool-line states, polling back-off on 429, focus handling, stream buffer cap, touch targets).
6. Never run: the container image on Linux/Node 22, a hosted deployment (Render blueprint: `render.yaml`, steps: `docs/submission/deploy.md`), signed-in flows, OMDb enrichment, mobile review.
7. Hosting: the Vercel account behind `spotlighthub.vercel.app` was **blocked** (HTTP 402) as of 2026-11-03.
8. Choose a Groq tier before any public demo: the free tier cannot carry concurrent judges.

## 8. What is NOT in git, and where it was backed up

| Item | Why not in git | Backup on the original machine (`~/Backups/spotlight-release-pulse-2026-11-03/`) |
|---|---|---|
| `services/pulse/.env` | real keys | `private-ignored-items.tar.gz` |
| `services/pulse/spike/out/` | raw Qloo outputs (forbidden to publish), evaluation runs, the local Postgres cluster, the data dump | same tarball |
| `.superpowers/` | working ledger and 25 review diffs (2 MB) | same tarball |
| Chat transcripts | may contain tool output and partial key text | `chat-transcripts/` |
| Full git history | for safety | `*.bundle` |

If a backup is gone, nothing essential is lost: code, docs, decisions and the per-task reports are all in git; only keys,
raw data and the local database must be recreated (sections 3 and 4).

## 9. Gotchas learned the hard way

- Postgres needs `LC_ALL=en_US.UTF-8`. Run the integration tests against the **clean** `pulse_itest`.
- Qloo is thin for brand-new and obscure titles: demographics empty, trends empty everywhere, some heatmap/artists calls answer 400.
  The service maps those to an honest `empty` and has a circuit guard that turns a *systematic* 400 back into an error; if
  `rejections ... exceed 90%` appears in the log, investigate before assuming titles are merely thin.
- After deploying new code over an existing database run
  `DELETE FROM qloo_evidence WHERE kind IN ('brands','place_tags','places_open'); DELETE FROM qloo_entities WHERE not_found;`
- Run **one** instance of the service: rate limiters and in-flight maps are per process.
- Groq's `x-ratelimit-reset-tokens` is the full-window reset, so the pacer waits only for the token shortfall.
- Vite's port in this repo is 8080, not 5173; add the origin to `PULSE_ALLOWED_ORIGINS` if you change it.
- The title-page cards ("Filmed in & set in", "Plan the night") were never viewed in a browser during the build; they are covered by tests only.

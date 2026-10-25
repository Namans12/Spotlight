# Release Pulse deployment runbook

Status: **public deployment on hold pending product evaluation**; see
[evaluation plan](evaluation-plan.md) and [findings](product-validation.md).
This is preparation, not a deployment record. No live Pulse URL has
been published or verified by this document. Use a separate hackathon database,
container service and Vercel project. Keep Spotlight's existing production project
and customer database separate.

## Free-first choice (selected October 25)

Keep Groq free-tier defaults: 300 global drafts/chat turns daily, 12 chat turns
and 20 campaigns per session. These are application caps, not guarantees of
provider capacity; a chat turn may use multiple model requests. Queuing and
rate-limit pacing remain enabled. The owner may switch providers later.

Recommended stack: **Render Free Docker web service + Vercel Hobby hackathon
frontend + separate Neon Free project**. This is a non-commercial hackathon demo;
check plan eligibility/limits for any later commercial use.

- [Render Free](https://render.com/docs/free) supports Docker-backed web services,
  but sleeps after 15 idle minutes and reports roughly one-minute startup.
  It includes 750 running hours per workspace/month and has usage/traffic limits.
  It is not an always-on production service. Other services share the allowance.
- [Neon Free](https://neon.com/pricing) provides durable PostgreSQL within its
  storage/compute allowance. Use it rather than Render's expiring free database.
  Scaling to zero can add a separate database startup delay.
- [Vercel Hobby](https://vercel.com/docs/plans/hobby) hosts the existing frontend
  and original APIs; the Qloo child process stays in the Render container.
- [Railway Free](https://docs.railway.com/pricing/plans) has $1/month resource
  credit. Its eligible new-account trial is temporary; do not assume continuous
  hosting fits that credit without measuring actual usage.
- Hugging Face Docker Spaces are not the default here: the current official docs
  require a paid plan for compute Spaces, and the documented outbound-port policy
  does not include PostgreSQL's 5432 used by our current driver. It would require
  additional eligibility/network/storage changes, not a drop-in free host.

`render.yaml` prepares one Free service and secret prompts. In Render, connect the
chosen public repository and **select the branch containing this work**; it has
not been pushed yet. Keep the repo root as build context and use
`services/pulse/Dockerfile`. Set secrets in Render, never in YAML. The generated
`PULSE_WARM_SECRET` must be copied privately into the hackathon GitHub secret.
The frontend origin must exactly match `PULSE_ALLOWED_ORIGINS`.

Because the free instance sleeps, do not use fire-and-forget warming as a
reliability guarantee. The scheduled workflow now warms Delhi and Mumbai via
`/warm?wait=1&city=...`, with bounded timeouts and checked reports. Evidence remains
in Neon across sleeps; the in-process campaign cache, limiter counters and MCP
connection restart. Never set `QLOO_FIXTURES=1` to hide a cold start or outage.

The first board request may exceed its existing 16-second client timeout while
Render wakes. The page offers retry; allow roughly a minute, then retry. Check
this on the real host before submission and explain it in judge instructions.
This is a tradeoff of the recommended free-first setup, not a claim of instant
availability. Do not add artificial pings to defeat the free host's sleep policy.
If this materially hurts the demo, an approved paid always-on instance is the
straightforward upgrade; no paid plan has been enabled.

## Architecture and host settings

- SPA and existing `api/` endpoints: separate Vercel project, repository root.
- Pulse: **one Node container (Render Free may sleep)**, built from the repository root using
  `services/pulse/Dockerfile`; internal port `8787` or the host's injected `PORT`.
- PostgreSQL: separate Neon database or branch; share its connection string only
  between this hackathon deployment's API, Pulse service and sync worker.
- Qloo: the locked npm harness runs `qloo mcp` as a private stdio child process.
  Expose the HTTP service, not an unauthenticated public MCP endpoint.

The in-memory Qloo limiter, request coalescing and route limits are process-local.
Do not enable replicas/autoscaling without moving those controls to shared state.
On a host that can sleep, use `/warm?wait=1`; background 202 acceptance does not
establish that warming completed.
Use the host's init-process option when available (local Docker: `--init`) so the
Node process and its Qloo child are reaped on restart. Allow at least 30 seconds
for process termination. Confirm an in-progress stream behaves correctly during
restart before calling the deployment ready.

For Railway/Render/Fly or another container host: choose Docker deployment, build
context `.`, Dockerfile path `services/pulse/Dockerfile`, one replica,
health path `/readyz`, and TLS ingress. Host selection and any paid resources
remain an explicit owner decision; no provisioning is implied here.

## 1. Fresh database and release data

Use Node **22.19+**, Python 3.10+ and `psql`. From the repository root:

```bash
npm ci
npm --prefix services/pulse ci
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt pytest
```

Set `DATABASE_URL` and `TMDB_API_KEY` in your private shell/secret manager. Do not
print them or paste them into a command transcript. For a new, empty database:

```bash
(
  set -e
  for migration in migrations/0*.sql; do
    psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
  done
)
```

There are currently migrations 0001–0016. Confirm every migration succeeded before
proceeding; a stopped loop is not a successful migration. On an existing database,
review which migrations have already run and apply only missing ones in order.
Do not repeatedly replay historical data-changing migrations.

Seed **current** catalog data from its sources, rather than copying Qloo caches or
production users. `DRY_RUN` suppresses messaging; it does **not** suppress DB writes:

```bash
DRY_RUN=true TELEGRAM_ENABLED=false EMAIL_ENABLED=false NEWS_ENABLED=false \
  REGION=IN LANGUAGES=hi,en POPULAR_MIN_POPULARITY=25 \
  RELEASE_TIMEZONE=Asia/Kolkata .venv/bin/python releasebot.py
.venv/bin/python scripts/sync_calendar_tmdb.py --months 2 --skip-tv
.venv/bin/python scripts/backfill_calendar_tmdb.py
.venv/bin/python scripts/sync_title_locations.py --neighbourhoods --city delhi --city mumbai --city new-york
.venv/bin/python scripts/sync_title_locations.py --city delhi --city mumbai --city new-york
```

The Wikipedia/Wikidata steps can take tens of minutes and can be rate limited.
These steps do not guarantee every current release resolves or has Qloo coverage.
They intentionally use India release dates, including when viewing New York or
London. Extend the location sync to other configured cities only when needed.

```sql
SELECT count(*) FROM release_items;
SELECT count(*) FROM calendar_entries WHERE tmdb_id IS NOT NULL;
SELECT city_slug, count(*) FROM title_locations GROUP BY city_slug;
```

Verify dates are current and both streaming and theatrical candidates exist; row
counts alone are not freshness checks. Keep Qloo cache tables out of SQL dumps,
public artifacts and repository commits. Local pause backups are recovery aids,
not the published demo's seed data.

## 2. Service secrets

Set these on the container host, never as image build arguments or `VITE_*` values:

| Variable | Value / purpose |
|---|---|
| `DATABASE_URL` | Hackathon Neon connection string (TLS required by the provider) |
| `TMDB_API_KEY` | TMDB v3 API key for title/IMDb resolution |
| `QLOO_API_KEY` | Qloo hackathon key |
| `QLOO_BASE_URL` | Usually leave unset: defaults to `https://hackathon.api.qloo.com` |
| `GROQ_API_KEY` | Server-side writer/chat provider key |
| `PULSE_ALLOWED_ORIGINS` | Exact HTTPS frontend origin, no trailing slash; comma-separated if needed |
| `PULSE_WARM_SECRET` | Independently generated long random secret for `POST /warm` |
| `NODE_ENV` | `production` (set in the Dockerfile) |
| `PORT` | Host-injected port, or `8787` |

Leave `QLOO_FIXTURES` and `PULSE_ALLOW_FIXTURES` **unset** in the real deployment.
Missing writer credentials produce explicit unavailable states; they do not make
the whole experience fully operational.

Optional provider controls: `GROQ_MODEL`, `GROQ_BASE_URL` (the **full chat/completions
endpoint**), `GROQ_REASONING_EFFORT=off` for a provider/model that does not support
that field. Another OpenAI-compatible provider still needs a compatible response
format and working tool calls; validate campaign JSON and multi-round chat with
that model before switching the judge deployment.

Defaults: `PULSE_SESSION_DAILY_CHAT=12`, `PULSE_SESSION_DAILY_CAMPAIGN=20`,
`PULSE_GLOBAL_DAILY_LLM=300`. The observed Groq free account on October 21 allowed
8,000 tokens/minute and 1,000 requests/day; account/model limits can differ. A
single chat turn may make several provider requests. Paid access can raise limits;
it does not remove all provider limits or the application's own caps. Confirm the
actual account quota, test concurrent visitors and retain a cost budget.

## 3. Container validation

```bash
docker build -f services/pulse/Dockerfile -t release-pulse .
docker run --rm --init -p 8787:8787 \
  --env-file services/pulse/.env release-pulse
```

For this command, your private env file must use the container's reachable DB
hostname; `127.0.0.1` inside the container is not your Mac. Match the published
port to `PORT` if your env file overrides it. Do not bake the env file into an image.

```bash
curl -fsS http://localhost:8787/healthz
curl -fsS http://localhost:8787/readyz
```

Expected: `{"ok":true}` for liveness and `{"ready":true}` for database/schema
access. `/readyz` returns 503 within its response deadline when its check fails
or stalls; concurrent probes share a pending check. It checks required tables,
not seeded titles, Qloo, TMDB or the LLM. Functional readiness requires all steps
in the final checklist below. The source-only container-layout simulation cannot
verify the actual Linux image, host ingress, health scheduling or restart behavior.

## 4. Frontend and scheduled refresh

Create a separate Vercel project with `npm run build`, output `dist`. Set the
existing server-side API settings documented in the main README, including the
hackathon `DATABASE_URL` and `TMDB_API_KEY`. For the judge deployment add:

```text
DEMO_GUEST=1
VITE_DEMO_GUEST=1
VITE_PULSE_URL=https://YOUR-PULSE-SERVICE
```

These example hostnames are placeholders. Set `VITE_PULSE_URL` **before building**.
Only the service's public URL belongs in this frontend variable; Qloo/LLM keys
must never reach the browser bundle. Pulse itself is public and requires no
sign-in. The guest flags enable Spotlight's pre-existing shared demo watchlist;
use them only on the isolated hackathon deployment, never a private user service.

Configure `PULSE_ALLOWED_ORIGINS` with the final Vercel origin. Do not wildcard
preview domains. CORS controls browser reads; it is not authorization and cannot
prevent direct clients from spending quota. Public routes have rate limits and
LLM caps; monitor them during judging.

In the hackathon repository's GitHub settings, set `PULSE_URL` as a variable and
`PULSE_WARM_SECRET` as a secret. The existing `ott-radar.yml` workflow invokes
`POST /warm?wait=1&city=...` for Delhi and Mumbai after its data refresh. Review every workflow's `DATABASE_URL` and
message-delivery secrets before enabling it: the hackathon worker must refresh
the hackathon database without sending production notifications. The nightly
workflow also needs the appropriate isolated database. Warm manually after any
release/calendar update when the scheduled warmer has not run.

Load `PULSE_URL` and `PULSE_WARM_SECRET` privately in your shell, then:

```bash
curl -fsS --max-time 300 -X POST \
  -H "Authorization: Bearer $PULSE_WARM_SECRET" \
  "${PULSE_URL%/}/warm?wait=1&city=delhi"
```

Inspect the returned report and then the board. A 202 from the background endpoint
only means accepted; it is not proof warming succeeded. A warm report with no
useful evidence is not sufficient for the judge demo.

## 5. Upgrade and proxy checks

When upgrading an existing hackathon database, invalidate its private evidence
cache once so older shapes and misleading provenance text cannot survive the
updated recipes/ranking semantics (source release data stays separate):

```sql
DELETE FROM qloo_evidence;
DELETE FROM qloo_entities WHERE not_found;
```

Do this in the hackathon database after checking the target connection. Fresh
databases do not need it. Rewarm affected cities after changing recipes or data.
This also removes `board_rank` entries: their fixed-slate fingerprints distinguish
candidate sets, but cannot invalidate changed interpretation/provenance by themselves.
A fresh warm may still yield sparse ranks; do not infer a useful comparison from
a successful HTTP status or invent scores for omitted candidates.

`clientAddress` uses the **rightmost `X-Forwarded-For` entry**. Before exposing the
service, verify the selected host overwrites or appends the real client address
there, and that the container cannot be reached around that trusted ingress.
With multiple trusted proxies, the rightmost address may be a shared proxy,
collapsing all visitors into one budget. If the host preserves caller-supplied
headers without appending, limits can be bypassed. Test two clients and an injected
header through the actual deployed ingress; adjust the trust policy before launch
if the assumption fails. Do not log complete forwarded chains or visitor history.

Briefs use NDJSON (`application/x-ndjson`); chat uses SSE (`text/event-stream`). Both must pass through without response buffering. Verify section-by-section brief
updates and chat tokens in a clean browser over HTTPS; an eventual full response
is not evidence streaming works. Check host idle/request timeouts and cancel/retry
behavior with a slow provider. Never put the long-running Pulse route behind a
Vercel function proxy.

## 6. Required launch evidence (pending until recorded)

- [ ] Build/run the actual Linux image and confirm healthy status as non-root.
- [ ] Confirm schema and current catalog data on the isolated database.
- [ ] Confirm trusted proxy client addresses and one replica (free hosting can sleep).
- [ ] `/healthz` and `/readyz` succeed; `/readyz` returns 503 during DB failure and recovers afterward.
- [ ] `/board?city=delhi&type=cafe` returns current titles; warm reports are useful.
- [ ] Fresh browser opens `/pulse?city=delhi&type=cafe` without an intro/login wall.
- [ ] Open a supported brief: evidence sections stream, source/limit labels render.
- [ ] Switch “Without Qloo”; the baseline is clearly labeled as an LLM comparison.
- [ ] Ask chat about the brief; tool results and citations work with the chosen LLM.
- [ ] New York/London disclose India dates; unknown city returns the picker.
- [ ] Empty evidence, provider failures, 429s and Stop/retry have understandable states.
- [ ] Test a restart with an active stream; no stuck request or orphan Qloo child.
- [ ] Check repository license and prepare screenshots of the final hosted UI.
- [ ] Record URLs/date, exact release/city used, and failures in `validation.md`.

Keep the public demo available through the announced judging period. Current
Devpost pages announce November 5 finalist presentations; verify dates again
before submission. This runbook does not authorize deployment, payment, pushing
code, publishing screenshots of restricted data or submitting to Devpost.

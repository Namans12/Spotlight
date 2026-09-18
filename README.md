# Spotlight

*Find what's worth watching.*

> **WebMCP Challenge submission note.** Spotlight has been live in
> production since June 2026 (first commit `2933cfd`, 2026-06-01) — well
> before this hackathon's Submission Period (2026-08-25 to 2026-09-03). Every
> commit through `df16001` (2026-09-03) is pre-existing work. **Everything
> under `src/webmcp/`, the guest sign-in path in `api/auth.ts` /
> `lib/usersDb.ts`, and the `LICENSE` file were added in a single commit,
> `d6a4e75` ("Add WebMCP tools: an agent co-pilot for the watchlist"), on
> 2026-09-03, during the Submission Period.** That commit is the entire diff
> of what's new for this submission — see the [WebMCP section](#webmcp-an-agent-co-pilot-for-your-watchlist)
> below for what it does. This repository mirrors the production app's full
> git history so that history is independently verifiable; the hackathon
> submission is deployed separately from Spotlight's live production
> deployment so the two never share risk.

A twice-weekly OTT release radar for India, plus a personal watchlist — one React app, backed by Postgres, deployed on Vercel.

It runs **every Wednesday and Friday at 2:00 PM IST** (plus a nightly refresh) using GitHub Actions: fetches OTT release data from TMDB and writes it to Postgres. The live site reads precomputed data straight from Postgres — no TMDB calls happen on a visitor's request.

The Wed/Fri run also sends a **Telegram alert scoped to your own watchlist** — nothing broadcast, nobody else's data — whenever a title on it releases (see [Watchlist-drop alerts](#watchlist-drop-alerts)). The pipeline can still send the full Out Now/Coming Up digest as a broadcast (Telegram and/or email; see `SEND_BROADCAST_DIGEST` and `EMAIL_ENABLED` in [Configuration](#configuration-env-vars)) if you want that instead of, or alongside, the watchlist alert — it's just off by default in this deployment.

## Testing this in 60 seconds (for judges)

**Demo video:** https://youtu.be/bbvMvbdw4s8

**Live app:** https://spotlighthub.vercel.app — no login required, a demo
session starts automatically on page load.

To see the WebMCP tools themselves:

1. Chrome 149+ → open `chrome://flags/#enable-webmcp-testing` → **Enabled** → relaunch.
2. Open https://spotlighthub.vercel.app/list/watchlist and open DevTools → Console.
3. Confirm all nine tools are registered and discoverable:

   ```js
   (await document.modelContext.getTools()).map(t => t.name)
   // → ['add_to_watchlist', 'correct_watch_order', 'get_calendar',
   //    'get_release_digest', 'get_watch_order', 'mark_watched',
   //    'plan_watch_order', 'reorder_watchlist', 'search_titles']
   ```

4. Run the flagship tool and watch the watchlist fill in, in correct watch
   order, without a page reload:

   ```js
   const tools = await document.modelContext.getTools();
   const plan = tools.find(t => t.name === 'plan_watch_order');
   await document.modelContext.executeTool(plan, JSON.stringify({ title: 'John Wick' }));
   ```

5. Mark the first film watched, then run the same plan again — it adds
   nothing and reports the film as already watched, because it read your real
   watch history:

   ```js
   const mw = (await document.modelContext.getTools()).find(t => t.name === 'mark_watched');
   await document.modelContext.executeTool(mw, JSON.stringify({ title: 'John Wick' }));
   await document.modelContext.executeTool(plan, JSON.stringify({ title: 'John Wick' }));
   ```

> **Note on argument encoding.** Chrome 149's experimental implementation
> expects `executeTool`'s arguments as a **JSON string**, not the plain object
> the specification's own examples show. Passing an object fails with
> `UnknownError: Failed to parse input arguments`. This is caller-side only —
> the browser hands the registered `execute()` a correctly parsed object
> either way.

> **On agents.** No shipping conversational agent routes through WebMCP yet —
> ChatGPT's desktop browsing uses generic Computer-Use/DOM automation, which
> we verified directly. The calls above are the specification's own invocation
> path (`getTools` / `executeTool`), which is exactly what an agent issues
> once one does.

## What's On The Site

Out Now / Coming Up, split into three sections, grouped by streaming platform — this is the same data the broadcast digest above draws from when it's turned on:

- **Out Now** — releases from the run day until the day before the next run
  (Wednesday covers Wed–Thu, Friday covers Fri–Tue: full coverage, no repeats)
- **Coming Up** — a ~7-day forward preview so you always know what's landing next
- 🇮🇳 **Hindi OTT** — movies + shows
- 🌍 **English OTT** — movies + shows
- 🔥 **Popular (Other Languages)** — any-language releases above a popularity threshold (big Tamil / Telugu / Korean / Spanish titles surface automatically)

Within each section, titles are grouped by platform. A title that's out on a per-title purchase rather than a subscription (buy/rent only — no service carries it with a subscription yet) gets its own **"⟨Service⟩ (Buy/Rent)"** group instead of either vanishing or being folded into a real subscription platform it isn't actually on.

Plus: Browse (trending/popular rows), Search (full TMDB multi-search), and a **My List** section (watchlist, watch later, watched, custom lists) — private per Google account, synced to Postgres.

## Architecture

| Piece | What |
|---|---|
| `releasebot.py` | The TMDB fetch pipeline. Runs only as a GitHub Action (Wed/Fri + nightly). Writes to Postgres. |
| Postgres (Neon) | Source of truth for releases, the calendar, and the private watchlist. |
| `api/*.ts` | Vercel serverless functions — DB reads, TMDB proxy (search/trending), auth, watchlist CRUD, IMDb/RT ratings cache. |
| `src/` | The React + Vite + Tailwind SPA (this is what's served at your domain). |
| Telegram + Email | Delivery channels, sent by the same GitHub Action that refreshes Postgres. |

The public site (Home, Browse, Search, Calendar) needs no login and is the same for everyone — releases, the calendar, ratings, and title relations are shared catalog data. The **My List** section requires Google sign-in; each account's watchlist, custom lists, and relation thumbs-downs are private to that account (see [Accounts](#accounts--google-sign-in)).

## What It Uses

- GitHub Actions: free scheduled runner for the fetch pipeline, no server needed
- Neon Postgres: free-tier serverless Postgres
- Vercel: hosts the React app + API functions
- TMDB API: movie, show, release, rating, poster, and provider data
- OMDb API (optional): IMDb and Rotten Tomatoes scores, cached in Postgres (see [Ratings](#ratings-imdb--rotten-tomatoes))
- Telegram Bot API: instant push notification — owner-scoped watchlist alerts by default, or the full broadcast digest if you turn `SEND_BROADCAST_DIGEST` back on
- SMTP email: optional, off by default (`EMAIL_ENABLED=false`) — a searchable inbox archive of the same broadcast digest, if you turn it on

## Setup

### 1. Create a Telegram bot

1. Open Telegram and message **`@BotFather`** (the official bot, blue checkmark).
2. Send `/newbot`.
3. Choose a display name (anything), then a **username** ending in `bot` (must be unique, e.g. `naman_ott_radar_bot`).
4. BotFather replies with a token that looks like `123456789:ABCDefGhIJKlmNoPQRstuVwxyZ` — copy it. This is your `TELEGRAM_BOT_TOKEN`.

### 2. Get your Telegram chat ID

1. Open a chat with your new bot (search its username) and send it **any message** (e.g. "hi"). This step is required — bots can't message you first.
2. In a browser, open (replace `<BOT_TOKEN>` with the token from step 1):

   `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates`

3. You'll see JSON. Find `"chat":{"id":123456789,...}` — that number (can be negative for groups) is your `TELEGRAM_CHAT_ID`.
   - If the JSON is empty `{"ok":true,"result":[]}`, you haven't sent the bot a message yet (or a previous getUpdates call already consumed it) — send it another message and reload.

### 3. Get a TMDB API key

1. Create a free account: https://www.themoviedb.org/signup
2. Verify your email, then go to **Profile icon (top-right) → Settings → API** (or go directly to https://www.themoviedb.org/settings/api).
3. Click **Create** under "Request an API Key" → choose **Developer** → fill the short form (any app name/URL works) → Submit.
4. Once approved (usually instant), copy the **API Key (v3 auth)** value — this is your `TMDB_API_KEY`. (Don't use the "API Read Access Token" — that's the longer v4 bearer token; this project expects the v3 key.)

### 4. Get email-sending credentials (Gmail example)

Using your own Gmail (or any account) as the sender needs an **app password**, not your normal login password.

1. Go to https://myaccount.google.com/security and make sure **2-Step Verification** is turned ON (app passwords require it).
2. Go to https://myaccount.google.com/apppasswords (or search "App passwords" in Google Account settings).
3. Under "App name" type something like `Spotlight` and click **Create**.
4. Google shows a 16-character password (spaces don't matter) — copy it. This is your `SMTP_PASSWORD`.
5. Your values:
   - `SMTP_USERNAME` → your full Gmail address
   - `SMTP_PASSWORD` → the 16-character app password from step 4
   - `EMAIL_FROM` → same Gmail address (or leave unset — it defaults to `SMTP_USERNAME`)
   - `EMAIL_TO` → the inbox you want the digest delivered to

### 5. Provision Neon Postgres

1. Create a free project at https://neon.tech (pick a region close to your Vercel deployment region).
2. Copy the pooled connection string.
3. Run the migrations once, in order: `0001_init.sql`, `0002_title_ratings.sql`, `0003_title_relations.sql`, `0004_title_relations_reverse_index.sql`, `0005_title_relation_lookups.sql`, `0006_calendar_entries_poster.sql`, `0007_multi_user_accounts.sql`, `0008_release_items_month_index.sql`, `0009_calendar_language_iso.sql`, `0010_calendar_origin_release.sql`, `0011_title_seasons.sql`, `0012_reset_tmdb_relations.sql`, `0013_per_user_watchlist_alerts.sql` — e.g. `psql "$DATABASE_URL" -f migrations/0001_init.sql` for each (or via a Python one-liner with `psycopg` if you don't have `psql` installed).
4. Link the seeded calendar rows to TMDB so they get posters and become clickable: `python scripts/backfill_calendar_tmdb.py` (safe to re-run; it only touches rows still missing a `tmdb_id`).
5. Keep the calendar populated past the seeded window: `python scripts/sync_calendar_tmdb.py --months 6`. Pulls region-aware theatrical dates (`/discover/movie` with `region` + `with_release_type=2|3` + `release_date.gte/lte` — not `primary_release_date.*`, which ignores `region` entirely and returns global junk) and TV premieres, and only ever *enriches* existing rows — a curated editorial row keeps its own platform and details and merely gains a poster and a `tmdb_id`. Queries one calendar month at a time rather than the whole window at once — TMDB caps each `/discover` call at a fixed page limit regardless of true match count, so a single big-range query lets a handful of popular titles anywhere in it crowd out an entire other month's releases before the cap even applies (confirmed directly: a 6-month single-query window had 178 real matches behind a 60-result cap, silently dropping 118). TV premieres are additionally scoped by `--tv-countries` (default `IN,US,GB`) — TMDB is crowdsourced and global TV volume runs into the hundreds a month, almost all obscure local productions; this trades missing an occasional big non-English hit for not drowning the calendar in noise. Runs nightly (see below).
4. Optionally seed the editorial calendar: `python scripts/seed_calendar_csv.py`.

### 6. Add secrets to GitHub

1. Go to your repo on GitHub
2. **Settings** tab (top of repo, not your account settings) → left sidebar **Secrets and variables → Actions**
3. Click **New repository secret** for each of these, pasting the value and clicking **Add secret**:

| Secret name | Value |
|---|---|
| `TMDB_API_KEY` | TMDB v3 API key (step 3) |
| `OMDB_API_KEY` | *Optional.* Free key from https://www.omdbapi.com/apikey.aspx — unlocks IMDb/RT scores. Leave unset and the site simply shows no ratings. |
| `DATABASE_URL` | Neon connection string (step 5) |
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather (step 1) |
| `TELEGRAM_CHAT_ID` | Your chat ID (step 2) |
| `SMTP_USERNAME` | Your Gmail address (step 4) |
| `SMTP_PASSWORD` | 16-char Gmail app password (step 4) |
| `EMAIL_FROM` | Sender address, usually same as `SMTP_USERNAME` |
| `EMAIL_TO` | Where you want the digest delivered |
| `AUTH_SECRET` | Random HMAC signing key for the session cookie: `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` | OAuth Client ID from Google Cloud Console (see [Accounts](#accounts--google-sign-in)) — not a secret, but convenient to manage alongside the others |

And one repo **variable** (not secret) under the same page's "Variables" tab:

| Variable name | Value |
|---|---|
| `DASHBOARD_URL` | Your deployed site URL, e.g. `https://your-project.vercel.app/` |
| `NOTIFY_OWNER_EMAILS` | Comma-separated email address(es) (the Google account(s) you sign into the site with) whose watchlist should trigger a Telegram alert when a title arrives |

### 7. Deploy to Vercel

1. Go to https://vercel.com → sign in with GitHub → **Add New… → Project** → import this repo.
2. Framework preset: **Other** (not "Python" — this project is a Vite SPA + TS/Python functions, not a Python web framework).
3. Under **Environment Variables**, add: `TMDB_API_KEY`, `DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID` (same value — the `VITE_` copy is what reaches the browser bundle; see [Accounts](#accounts--google-sign-in)), and optionally `OMDB_API_KEY`.
4. Deploy. Every push to `main` auto-redeploys.

### 8. Done

`.github/workflows/ott-radar.yml` runs Wed/Fri at 2:00 PM IST (Postgres refresh + owner-scoped Telegram watchlist alerts — see `SEND_BROADCAST_DIGEST`/`NOTIFY_OWNER_EMAILS` above). `.github/workflows/ott-radar-nightly.yml` runs daily (Postgres refresh, ratings backfill, calendar sync + TMDB linking — no notifications). Both can be triggered manually from the Actions tab.

## Configuration (env vars)

| Variable | Default | Meaning |
|---|---|---|
| `REGION` | `IN` | TMDB watch region |
| `LANGUAGES` | `hi,en` | Dedicated language sections |
| `POPULAR_MIN_POPULARITY` | `25` | Threshold for the any-language Popular section |
| `NEWS_ENABLED` | `true` | Augment TMDB with titles scraped from India OTT round-ups (see below) |
| `NEWS_URLS` | — | Comma-separated extra article URLs to scrape (optional; for publications whose section pages render client-side, e.g. Vogue India / WION / India TV) |
| `NEWS_INDEX_URLS` | built-in list | Comma-separated publication *section* pages to discover weekly round-ups from. Overrides `news_sources.ROUNDUP_INDEX_URLS` |
| `TMDB_CACHE_DIR` | — | Cache TMDB responses here. For development only — see [Staging](#staging-running-the-pipeline-without-touching-production) |
| `TMDB_CACHE_TTL_SECONDS` | `21600` | How long a cached TMDB response stays fresh (6 hours) |
| `RELEASE_TIMEZONE` | `Asia/Kolkata` | Timezone used for date windows |
| `DRY_RUN` | `false` | Skip Telegram/email, still refresh Postgres |
| `USE_SAMPLE_DATA` | `false` | Generate sample data without a TMDB key (local testing) |
| `DASHBOARD_URL` | — | Link included in Telegram/email digests |
| `DATABASE_URL` | — | Neon Postgres connection string |
| `TELEGRAM_ENABLED` | `true` | Toggle Telegram delivery |
| `EMAIL_ENABLED` | `false` | Toggle email delivery |
| `SEND_BROADCAST_DIGEST` | `true` | Send the full Out Now/Coming Up digest via Telegram/email. Set `false` to send only owner-scoped watchlist-drop alerts |
| `NOTIFY_OWNER_EMAILS` | — | Required whenever a watchlist-drop alert would fire (not dry-run, at least one channel enabled). Comma-separated owner email(s) — see repo variables above and [Watchlist-drop alerts](#watchlist-drop-alerts) |
| `OMDB_API_KEY` | — | OMDb key for IMDb/RT scores. Unset = no ratings anywhere, silently |
| `RATINGS_MAX_CALLS` | `400` | OMDb requests one `scripts/backfill_ratings.py` run may spend |
| `DEMO_GUEST` | unset | `1` enables the shared demo account (`POST /api/auth {guest:true}`). **Leave unset on any public deployment** — it is one `users` row that every visitor who takes it becomes, so they share a watchlist and can delete each other's items. Only the hackathon deployment sets it |
| `VITE_DEMO_GUEST` | unset | Build-time twin of `DEMO_GUEST`. Set both, or neither: this one hides the guest button and the auto-session, `DEMO_GUEST` is what actually enforces it server-side |
| `GITHUB_DISPATCH_OWNER` | `Namans12` | Repo owner whose workflow `/api/releases-refresh` triggers |
| `GITHUB_DISPATCH_REPO` | `ms-trigger` | Repo name for the same |
| `GITHUB_DISPATCH_WORKFLOW` | `ott-radar-nightly.yml` | Workflow file for the same |
| `SITE_URL` | Vercel's production domain, else `https://spotlighthub.vercel.app` | Canonical origin baked into prerendered pages, the sitemap and Open Graph tags. Set it on a fork or a custom domain |

## Accounts & Google Sign-In

The catalog (releases, calendar, ratings, title relations) is global — every
signed-in or anonymous visitor reads the same data. Only two things are
private per account: **My List** (watchlist, watch later, watched, custom
lists) and thumbs-downing a relation edge (hiding a wrong "Must Watch" link
for yourself doesn't remove it for anyone else — see
[Must Watch / Can Watch](#must-watch--can-watch-title-relations)).

Sign-in uses [Google Identity Services](https://developers.google.com/identity/gsi/web),
not a server-side OAuth redirect: the frontend gets a signed ID token
straight from Google, and the backend verifies it against Google's public
keys (`lib/auth.ts`, via `google-auth-library`). No client secret is
involved anywhere — that's only needed for the authorization-code flow,
which this isn't.

**Setup:**

1. [console.cloud.google.com](https://console.cloud.google.com) → new project → **APIs & Services → OAuth consent screen** (External, your app name + email).
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**, type **Web application**.
3. Authorized JavaScript origins: your deployed URL, plus `http://localhost:8080` for local dev.
4. Copy the Client ID and set it as **both** `GOOGLE_CLIENT_ID` (server-side verification) and `VITE_GOOGLE_CLIENT_ID` (same value — Vite only exposes `VITE_`-prefixed vars to the browser bundle, and the login button needs the id to render). It's the same, non-secret string in both places.

**Guest sign-in:** "Continue as guest" on the login page (and every mutating
WebMCP tool call, automatically — see [WebMCP](#webmcp-an-agent-co-pilot-for-your-watchlist))
skips Google entirely and lands on one fixed, shared demo account
(`lib/usersDb.ts`'s `upsertGuestUser`), reusing the exact same session-cookie
mechanism as a real sign-in. It exists so a judge, or an agent acting on
someone's behalf, can exercise the watchlist features with nothing to click
through first — not as a second real-auth path.

Every mutating watchlist/list query is scoped by `user_id` — including
writes, not just reads, since `dbId` is a small sequential integer and would
otherwise let one signed-in user edit another's rows just by guessing an id
(see `lib/watchlistDb.ts`). `api/releases-refresh` is rate-limited per
`migrations/0007_multi_user_accounts.sql`'s `refresh_dispatches` table: a
15-minute global cooldown (the pipeline is shared) plus a 5-per-day-per-user
quota, so one person can't monopolise the shared cooldown slots.

## Watchlist-drop alerts

Two paths, deliberately separate.

**Per-account (opt-in).** Any signed-in account can switch on *Email me on
drops* from the avatar menu. On the Wed/Fri run, `releasebot.py` cross-
references that week's Out Now list against every opted-in account's own
watchlist and emails each person, at their verified Google address, about the
titles from *their* list that just landed — one message per account per run,
not one per title. Off by default: nobody is enrolled by a migration, because
this sends mail to a real address.

Deduped per `(account, title, channel)` in `sent_notifications`. That table's
unique key used to be per *title* only, which meant the first account alerted
about a film consumed the only row that would ever exist for it and every
other account was silently skipped forever — see
`migrations/0013_per_user_watchlist_alerts.sql`, which re-keys it. The demo
guest account is excluded from the toggle: it is shared, so "email me" would
mean emailing a shared inbox.

**Owner broadcast (env-configured).** The original path, unchanged: scoped by
`NOTIFY_OWNER_EMAILS` and delivered through whichever of Telegram/email the
deployment has switched on.

Telegram is owner-only for now. Per-account Telegram needs a bot-linking flow
(a deep-link token and a webhook to receive `/start`), and there is no room for
a webhook function — the deployment is at Vercel Hobby's 12-function cap.



The Wed/Fri run also cross-references that day's **Out Now** items against
the watchlists of the accounts in `NOTIFY_OWNER_EMAILS`
(`find_watchlist_matches` in `releasebot.py`) and sends a Telegram message for
any match — independent of `SEND_BROADCAST_DIGEST`, so turning the full
digest off doesn't stop this.

**Never alerted twice on the same channel.** A match only sends if
`(tmdb_id, media_type, 'watchlist_drop', channel)` has no row yet in
`sent_notifications`; sending inserts that row. A title can keep matching
across several runs while it's still "Out Now" — only the first run alerts
it. The log reflects this: `Watchlist check: 3 match(es), sent 1 new
alert(s), 2 already notified previously` — fewer sends than matches means
dedup is working, not a partial failure.

## Ratings (IMDb / Rotten Tomatoes)

TMDB's own `vote_average` is the score shown on cards by default. IMDb and
Rotten Tomatoes numbers come from [OMDb](https://www.omdbapi.com/), whose free
tier allows **1,000 requests/day for the entire deployment** — far too few to
call while rendering a poster grid. So nothing does:

- `migrations/0002_title_ratings.sql` adds `title_ratings`, a cache keyed by
  `(tmdb_id, media_type)`. A title OMDb has no entry for is stored with
  `not_found = true`, so it isn't re-requested on every page view.
- `scripts/backfill_ratings.py` is the bulk filler. It walks `release_items` and
  `watchlist_items`, skips anything fetched in the last 7 days, and stops at
  `--max-calls` (default 400). Run it manually or add it to the nightly workflow:

      python scripts/backfill_ratings.py                     # fill up to 400
      python scripts/backfill_ratings.py --dry-run           # list, call nothing

- `GET /api/ratings?ids=movie:603,tv:1399` is a **cache-only** batch read — it
  never calls OMDb, so grids cost one Postgres query.
- `GET /api/ratings?type=movie&id=603` may spend exactly one OMDb call, and only
  when that title has never been fetched. Stale rows are served as-is; refreshing
  them is the backfill's job, never a request's.

With `OMDB_API_KEY` unset every path returns "no ratings" and the UI shows
nothing — no errors, no 500s, no degraded cards.

## Season counts

TV cards show "10 Seasons" (Friends), "8 Seasons" (Game of Thrones), etc. —
sourced from TMDB's per-title `/tv/{id}` detail endpoint, which is the *only*
TMDB endpoint that returns `number_of_seasons`; none of the search/trending/
discover/similar endpoints do. That means every poster grid would otherwise
need one live TMDB call per TV card, so this follows the exact same
cache-then-batch shape as ratings above, just against TMDB directly instead of
OMDb:

- `migrations/0011_title_seasons.sql` adds `title_seasons`, a cache keyed by
  `(tmdb_id, media_type)` (media_type is always `'tv'` — movies have no
  seasons). A show TMDB 404s on is stored with `not_found = true`.
- `scripts/backfill_seasons.py` is the bulk filler, walking the same two tables
  ratings does, skipping anything fetched in the last 30 days (season counts
  change far less often than ratings), capped at `--max-calls` (default 400):

      python scripts/backfill_seasons.py                     # fill up to 400
      python scripts/backfill_seasons.py --dry-run           # list, call nothing

- `GET /api/seasons?ids=tv:1668,tv:1399` is a **cache-only** batch read.
- `GET /api/seasons?type=tv&id=1668` may spend exactly one live TMDB call, and
  only on a genuine cache miss.
- The title detail page (`TitleDetail.tsx`) doesn't use either of these — it
  already fetches the full TMDB detail payload for the page itself, so its
  season count is free and always fresh.

## Must Watch / Can Watch (title relations)

A title's detail page shows what it assumes you've seen — split into two
buckets, stored as direct edges in `title_relations`
(`migrations/0003_title_relations.sql`):

- **Must Watch** — narrative continuity (prerequisites and continuations).
  Franchise chains come from TMDB's `belongs_to_collection`. These are **not
  limited to a curated list**: on a miss, `api/relations.ts` fetches the title's
  collection once, writes the whole chain, and serves it, so searching any film
  gets a Watch order. The first visitor pays two TMDB calls; everyone after
  reads Postgres. `title_relation_lookups` records the answer — including "this
  title has no collection" — so a standalone film isn't re-checked on every
  view, and a network failure is deliberately never cached as "there is
  nothing". `scripts/sync_relations_tmdb.py` does the same thing in bulk,
  offline, and runs nightly.

### Collection membership is not a watch order

A TMDB collection groups titles by brand, not by story, and treating every
release-adjacent pair as a prerequisite is wrong for three whole classes of
franchise. Both write paths — the request-path warm and the offline generator
— therefore classify a collection first, using the hand-verified table in
[`data/collection-shapes.json`](data/collection-shapes.json):

| Shape | What it means | Example |
|---|---|---|
| `chain` (default) | One story across N parts. Consecutive pairs become Must Watch. | Harry Potter (8 parts, all required) |
| `arcs` | Several independent stories in one collection object. Chains within an arc, never across. | Star Wars: the prequels are their own line |
| `episodic` | A brand, not a story. **No** Must Watch edges at all — only "same series, not required" Can Watch links. | James Bond (27 parts), the *Untold* documentary anthology (24) |
| `exclude` | A spin-off, recap, or alternate cut sitting inside the collection but outside its story. | *The Godfather, Coda* (a re-edit of Part III) |

Size is the tempting signal and it does not work: Harry Potter has 8 parts and
is a real chain, while Predator has 6 and is not. So the list is curated, with
a size fallback (`EPISODIC_PART_THRESHOLD`) set far above anything legitimate.
[`scripts/audit_collection_shapes.py`](scripts/audit_collection_shapes.py)
reports collections in the database that reach the chain path without an entry,
so the list can be kept current as the catalog grows.

The rules live in one place and are implemented twice — `shared/collectionShapes.ts`
for the runtime, `scripts/lib_collection_shapes.py` for the generator — because
the two must agree: `must` outranks `can` in the precedence ladder, so an edge
written wrongly by one side cannot be corrected by the other.
`tests/test_collection_shapes.py` asserts the same fixtures as
`shared/collectionShapes.test.ts` to keep them in step.

### Release order vs story order

The Must Watch chain always encodes **release order** — that is the order the
edges are written in, and it is the right default. Where a franchise is told
out of order, the connections view offers a **Story order** toggle that
re-sorts the timeline by the curated `story` list in the same JSON file
(Star Wars, X-Men, Insidious, Fast & Furious today). The toggle only appears
when a curated order exists for something on screen, the choice rides in the
URL (`?order=story`) so the view is shareable, and the "Part N of M" label is
counted off the rendered order so it can never contradict the timeline beside
it.
- **Can Watch** — enrichment (references, callbacks, shared-cast in-jokes).
  No structured source can produce these, so they come from an agent session
  run by hand: see [docs/relations-seed-prompt.md](docs/relations-seed-prompt.md)
  for the prompt and workflow, `data/relations_seed.json` for the format, and
  `scripts/seed_relations.py` for the loader.

A third source, Wikidata `P155`/`P156` sequence data, was built and
**deliberately not shipped** — `scripts/sync_relations_wikidata.py --spot-check`
found ~17% of its edges wrong (including a prequel whose direction came out
inverted), no coverage at all for shared universes, and no way for the offline
seed to correct it afterwards. The script's docstring records the evidence; run
the spot check again before reconsidering.

Both generators are manual, offline, and idempotent — re-running either over
unchanged input changes no rows, and a thumbed-down edge survives a full
regeneration. Every candidate passes one shared validation gate
(`scripts/lib_relations.py`): it must resolve to a real TMDB id, must not be a
self-edge, and must not use an unreleased title as a prerequisite. Rejections
are printed with a reason, and "TMDB said no such title" is reported separately
from "TMDB was unreachable" — only the second is fixed by running again.

Generation is offline and manual, never part of a request or a deployed cron
— see the design doc for why. `GET /api/relations?type=movie&id=603&depth=1`
is the only read path: public, cache-only, and — like ratings — answers `200`
with empty arrays on any failure so a title page never fails to render over a
relation lookup.

**Where it shows up.** A title's detail page carries a *Watch order* button
when it has relations (and nothing at all when it doesn't); recommendations
sit behind a *You may also like* toggle beside it, collapsed by default. The
button opens `/title/:type/:id/connections`, which plots the full chain as a
timeline — numbered position, cover art, release date, a "you're here" marker,
and a connector that fills as you scroll.

That view walks the chain at `MAX_DEPTH` and needs **zero** TMDB calls: every
node, including the title you're on, renders from denormalised columns on
`title_relations`. The origin's own fields come back on the same response,
recovered from the reciprocal edges pointing at it — so the timeline stays
whole even when TMDB is unreachable.

**Shows.** TMDB has no collection concept for TV, so a series gets a chain only
from the curated seed (MCU, Star Wars, and the other franchises in
`data/relations_seed.json`). Outside those, the page says so rather than
claiming the series stands alone — and for a multi-season show it gives the
watch order it actually has: start at Season 1, `N` seasons in order, read from
the `title_seasons` cache.

**Correcting a bad edge.** Signed in as the owner, each related title carries a
thumbs-down; `POST /api/relations` sets `suppressed` and the edge is gone for
good. That is the *only* correction mechanism, by design: the upsert precedence
ladder (`tmdb` > `wikidata` > `seed` > `llm`) means a lower-trust generator can
never overwrite a higher-trust one, so a wrong TMDB collection edge cannot be
fixed by re-seeding. No generator ever clears `suppressed`, so the correction
survives a full regeneration. There is no un-suppress in the UI — reversing one
is a single `UPDATE` on a single-owner app.

## Search: prerendered pages, not a blank shell

`"<franchise> watch order"` is a question people type into a search engine
constantly, and this app has a programmatic answer for it. It was unreachable:
Spotlight is a client-rendered SPA, so every route served the same
`index.html` — one `<title>Spotlight</title>` and one description for the whole
site — and a crawler fetching a watch-order page got an empty `<div>`.

`scripts/prerender.ts` runs after `vite build` and writes real HTML for every
page worth finding: a per-page title and description, canonical URL, Open Graph
and Twitter cards (so a pasted link stops rendering as a blank grey box), a
schema.org `ItemList` carrying the order itself, and the chain as plain markup
inside `#root` that React replaces on mount. Plus a `sitemap.xml` and a
`robots.txt` that points at it. Roughly 230 pages today, and it grows with the
nightly relations sync.

Prerendering rather than SSR for two reasons: the deployment already sits at
Vercel Hobby's 12-serverless-function cap, so there is no room for a rendering
function — and it matches how everything else here works, computing offline and
serving static. Vercel checks the filesystem before applying `vercel.json`'s SPA
rewrite, so a prerendered file wins and every other route still falls through to
the SPA unchanged.

The step fails soft by design. No `DATABASE_URL`, or Postgres briefly
unreachable, and the build still ships — just without fresh title pages, which
the next build picks up. A site that ships without new metadata is a setback; a
site that does not ship is an outage.

`shared/seo.ts` holds the strings, because they are produced twice: baked into
HTML at build time (what a crawler reads) and applied on client-side navigation
by `src/hooks/useDocumentMeta.ts` (what a share button copies once the SPA has
taken over). If those drifted, the page a crawler indexed would not be the page
a reader shares.

## WebMCP: an agent co-pilot for your watchlist

Spotlight registers [WebMCP](https://github.com/webmachinelearning/webmcp) tools
(`document.modelContext.registerTool`) in `src/webmcp/`, so an agent in
ChatGPT's in-app browser (or Chrome with the WebMCP flag on) can act inside
your real, signed-in session instead of guessing its way through the UI. Every
tool is a thin wrapper around the exact same client-side functions the page's
own buttons call (`src/lib/watchlistApi.ts`, `src/lib/relations.ts`,
`src/lib/api.ts`) — there's no separate "agent" backend, and the on-screen
list updates live either way because a tool call invalidates the same React
Query cache a click would.

**The flagship tool: `plan_watch_order`.** This is why the feature exists.
Ask ChatGPT "what order should I watch the Conjuring movies in, and get me
caught up" and a generic agent answers from parametric memory — no real data,
often wrong, and it can't act on it even when it's right. `plan_watch_order`
instead reads the real Must Watch chain from [Postgres](#must-watch--can-watch-title-relations)
(TMDB collections + Wikidata's canonical ordering + curated edges, not a
guess), cross-references it against what you've actually marked watched, and
writes the remaining titles into your real watchlist **in the correct
order** — something an agent that only reads the page can't do, because it
has no way to act on your authenticated account state.

**All nine tools:**

| Tool | What it does |
|---|---|
| `search_titles` | TMDB multi-search |
| `get_release_digest` | The Out Now / Coming Up digest, by section and window |
| `get_calendar` | Calendar entries for a given month |
| `get_watch_order` | Read-only: a title's Must Watch chain + Can Watch extras, with reasons |
| `plan_watch_order` | **Flagship.** Builds the chain into the watchlist, in order, skipping what's already watched or already on the list |
| `add_to_watchlist` | Add a title to watchlist / watch later |
| `mark_watched` | Move a title to watched |
| `reorder_watchlist` | Reorder the watchlist by title |
| `correct_watch_order` | Thumbs-down a wrong connection, same as the UI's suppress button |

Every mutating tool calls `ensureAuthenticated()` first, which silently signs
into the [shared guest account](#accounts--google-sign-in) if there's no
session yet — an agent (or a judge) should be able to just ask for something
and have it work, not hit a login wall first.

Tool registration no-ops quietly in any browser that doesn't implement
`document.modelContext` (still almost all of them) — the site works exactly
as it did before there.

## Theatrical calendar: three sources, and a home-market date in parentheses

`scripts/sync_calendar_tmdb.py` covers licensed, TMDB-backed theatrical data —
but a spot-check of one real Friday found 8 of 16 films playing in Hyderabad
cinemas were either absent from TMDB or present with no release date recorded
at all (small regional-language films routinely have no typed theatrical
release on TMDB whatsoever). No query change fixes that; the data isn't there.
`scripts/sync_theatrical_district.py` covers the gap: district.in's per-city
"upcoming movies" pages embed a fully structured, dated, per-language film list
in the page's own Next.js JSON — no HTML fragility, real fields.

**district.in is IP-blocked from GitHub Actions.** Confirmed by dispatching a
real workflow run and testing every plausible cause from an actual runner: the
default UA, a full set of browser headers, and a cookie warm-up all still got
a 403 — even on the plain homepage. That's Akamai denying GitHub's
hosted-runner ranges outright, not a fingerprint check any header change gets
past. The step is left in the nightly workflow (harmless — it just logs seven
403s and writes nothing when blocked, and would start working again for free
if the block is ever lifted or the job ever moves to a self-hosted runner),
but `scripts/sync_theatrical_wikipedia.py` is what actually covers this gap in
CI today: Wikipedia's per-language "List of *language* films of *year*" pages
carry the same kind of dated, per-title listing, and aren't blocked the same
way. Coverage is narrower — Wikipedia maintains a dedicated per-year page only
for languages with enough editors (Telugu, Tamil, Kannada, Malayalam, Hindi;
not Punjabi or Bengali) — and disclosed as narrower rather than silently
dropped. Its per-year lists also mix theatrical and straight-to-streaming
titles with no column marking which is which; a row whose studio/production
cell names a known streaming platform (`OTT_PRODUCTION_MARKERS` in the script)
is skipped outright rather than guessed at, since wrongly marking a
streaming-only release as theatrical is worse than missing a theatrical one.

All three sync scripts are deliberately independent of one another for
matching purposes: a second source with its own spelling of a title creates a
near-duplicate row rather than an update, since `calendar_entries`'s
uniqueness is on the exact title string — see **Duplicate releases** below for
how that gets caught after the fact.

**The India-first date, with the home-market date in parentheses.** The site
is not India-only, and a foreign film usually opens in its home market before
its Indian release — sometimes weeks or months. `sync_calendar_tmdb.py` now
makes one detail call per discovered film (mirroring the existing per-show
call for TV networks) to read its real per-country `release_dates`, because
`/discover/movie`'s own `release_date` field is documented as a filter, not a
reliable per-region value. India's date becomes the one shown; the film's
**production country's** date is kept alongside in
`origin_region`/`origin_release_date` when it differs, rendered as
`ChaO ja (JP: 15th Aug)`. The origin is the film's `production_countries[0]`
from TMDB — not whichever territory happens to release earliest, which a first
pass at this got wrong: a US tentpole opening a day early in France or Belgium
during an international rollout is not "a French film", and labelling it that
way was worse than showing no bracket at all. Both columns stay `NULL` when
there's nothing extra to say: a regional Indian film releases day-and-date
within India (no second date exists), and a title with no known India date at
all just shows the one date it has.

    python scripts/sync_calendar_tmdb.py --months 6
    python scripts/sync_theatrical_district.py
    python scripts/sync_theatrical_wikipedia.py

All three scripts enrich existing rows rather than overwrite them (every
updated column is a `COALESCE` that keeps whatever is already there) — the
same convention `sync_calendar_tmdb.py` already used for editorial CSV rows.
The trade-off: a row TMDB got to first with a *wrong* value (e.g. `Judaa`
recorded as `en` when district.in correctly has it as `pa`, Punjabi) keeps
that wrong value even after a more accurate source runs, since a non-null
field is never replaced. Fixing a specific known-wrong row is a manual
`UPDATE`, not something any sync script will do automatically.

**Duplicate releases.** `calendar_entries` is unique on `(release_date, title,
entry_type)` — not on `tmdb_id`. Two rows can independently resolve to the
same `tmdb_id` whenever their title strings differ even slightly (a case
difference, an abbreviated title, a working title later replaced by the
announced one), and once linked the unique constraint no longer catches it —
found in production as "Mirzapur" and "Mirzapur: The Movie" both rendering as
separate theatrical releases on the same date.
`scripts/reconcile_calendar_duplicates.py` finds rows sharing a `tmdb_id` and
resolves each group one of three ways: **dedupe** (the losing title still
finds the shared id when searched fresh on TMDB, or is a recognisable
placeholder like "Untitled ... Film" — merge its fields into the row matching
TMDB's canonical title, then remove it), **unlink** (the losing title finds
nothing on TMDB at all — it's a real, different, not-yet-catalogued release
that a fuzzy matcher forced onto the wrong entry, so only the bad `tmdb_id`
link is cleared, not the row), or **manual review** (nothing in the group
matches TMDB's title — left untouched rather than guessed at). Safe to
re-run; a clean database just reports zero groups.

    python scripts/reconcile_calendar_duplicates.py --dry-run
    python scripts/reconcile_calendar_duplicates.py

**A link that was correct can stop being correct.** `backfill_calendar_tmdb.py`
only ever runs once per row (it selects `WHERE tmdb_id IS NULL`), so a link it
made is never revisited — but TMDB's own data for that id can still change.
Mid-session, TMDB renamed a linked record from "Khalifa Part 1" to "Khalifa:
The Ruler"; separately, ~40 linked rows had a `language` that no longer agreed
with TMDB's `original_language`, the field every other write path here treats
as ground truth. `scripts/verify_calendar_tmdb_links.py` re-checks every linked
row against TMDB's *current* data: a title that no longer matches is a rename
if the release date still agrees (title + language refreshed, link kept) or a
wrong match if it doesn't (unlinked, same reasoning as the duplicate case
above); a `language` disagreement on a title that still matches is corrected
to TMDB's current value.

It cannot catch a wrong match whose title string is byte-identical to the real
one (TMDB has more than one "Perfect Match", more than one "Giant" — decoys
found only by reading the overview by hand) — `KNOWN_WRONG_MATCHES` and
`NEVER_AUTO_MATCH_TITLES` in `backfill_calendar_tmdb.py` are the record of
that: without them, unlinking a decoy just makes the row a fresh candidate
that finds a *different* wrong entry on the next run, which is exactly what
happened once, in production, before those existed. A `LANGUAGE_OVERRIDES`
map in `verify_calendar_tmdb_links.py` plays the same role for one TMDB record
(Judaa) whose own `original_language` is simply wrong. Extend these by hand
when a new one turns up; don't expect either script to find it unassisted.

    python scripts/verify_calendar_tmdb_links.py --dry-run
    python scripts/verify_calendar_tmdb_links.py

## News augmentation (why the digest is fuller than TMDB alone)

TMDB's India OTT discover feeds are incomplete and often lag the real streaming
calendar, so the digest used to miss titles that every "OTT releases this week"
article lists. `news_sources.py` closes that gap:

1. It harvests candidate titles from editorially-curated Indian OTT round-ups
   via three **evergreen** routes (no per-week URL maintenance):
   - **Google News India RSS** — the widest publication reach, but *headlines
     only*. Its `<link>` is a `news.google.com/rss/articles/…` interstitial that
     resolves via JavaScript, so the article body is unreachable from there. A
     round-up headline names 3–5 titles; its body lists 10–15.
   - **Publication section pages** (`ROUNDUP_INDEX_URLS`) — each is scanned for
     links that look like a weekly round-up, and those articles are then scraped
     in full. This is what recovers the other two thirds of each week, and it
     also picks up the platform each entry names. Currently: GQ India, Esquire
     India, Pinkvilla, News18, Republic World. Override with `NEWS_INDEX_URLS`.
   - **`NEWS_URLS`** — explicit article URLs, for publications whose section
     pages render client-side (Vogue India, WION, India TV, ETV Bharat).

   Candidates not yet wired in, found while researching alternates — noted here
   so the next pass doesn't re-discover them from scratch:
   - **India TV's RSS feed** (`indiatvnews.com/rssnews/topstory-entertainment.xml`)
     bypasses that site's JS-shell problem — confirmed live with real article
     content — but titles arrive wrapped in `<![CDATA[...]]>`, which
     `_candidates_from_rss`'s tag-stripping regex does not handle correctly, so
     it needs a small parser fix before it can be added.
   - **Koimoi** (`/what-to-watch/`) publishes round-ups in exactly this format,
     but every request from this environment timed out — untested from a real
     deployment.
   - **ABP Live** (`news.abplive.com/entertainment/ott`) is a live, real OTT
     section, but its articles are single-title announcements rather than
     weekly round-ups — lower yield per fetch than the sources above.
   - **Wikipedia list pages** (e.g. `List_of_Netflix_India_original_films`) and
     **JustWatch India** (`justwatch.com/in/new`) are stable and scrape cleanly,
     but as a title *cross-check* source rather than discovery — useful for a
     future confidence signal, not a round-up harvester.
   - Ruled out: **IMDb's India new-releases page** (403, bot-blocked) and
     **WION's** RSS/tag feeds (403).
   - **Sacnilk** (`sacnilk.com/entertainmenttopbar/Upcoming_Movies`) — found
     while chasing the one title (Bhagyashaali) neither district.in nor
     Siasat had. Real, structured (`@type: Movie` JSON-LD with a confirmed
     date), and it's what closed that gap. Its poster URLs 410 on this one
     sample — worth re-checking before trusting them at scale — and its
     `inLanguage` field looked templated rather than reflecting the film's
     actual spoken language (said "English" for a film Siasat's own
     Hyderabad listing categorized as Kannada), so language still needs a
     second source. Not yet wired into either sync script.
2. Every candidate is then **validated and enriched against TMDB** (real title,
   language, rating, poster, watch providers, links) in `releasebot.enrich_news_candidates`.
   Anything TMDB can't confirm as a near-term movie/show is dropped — that's the
   quality gate that filters out the noise scraping inevitably picks up.
3. Each confirmed title is dated by its **OTT** date, not the primary date
   `/search` returns. For a movie that means the digital (type 4) release date;
   a movie with no digital date and no providers is **dropped** rather than
   filed under its theatrical date — that is what keeps cinema-only releases
   (7 Dogs, Irumudi, Khalifa) out of an OTT digest. For a returning series the
   date comes from `/tv/{id}/season/{n}`, because `first_air_date` is when the
   *series* began (Outer Banks: 2020, not its 2026 season 5).
4. Confirmed titles are merged into the Hindi / English / Popular sections
   (`merge_sections`, keeping the richer copy on collision) and bucketed into
   Out Now vs Coming Up by that OTT date. `drop_cross_window_duplicates` then
   collapses any title that landed in both windows — `merge_sections` only
   de-duplicates within one window, so a title the discover and news passes
   dated differently used to appear twice, a month apart. Then written to
   Postgres like any other release.

A scraped platform hint is only used when TMDB has no availability for the
region yet, and only when the source names exactly one platform: a headline
reading "…on Netflix, JioHotstar, SonyLIV & more" says nothing about which of
its titles goes where, and a wrong platform is worse than none.

Set `NEWS_ENABLED=false` to fall back to TMDB-only behavior.

## Tests

```bash
pytest
```

Offline by design — the TMDB client is faked and the scraper runs against HTML
fixtures, so no network, API key or database is needed. The suite covers the
rules that decide what reaches the digest: OTT-date resolution (digital date vs.
theatrical date, cinema-only titles being dropped), season resolution for
returning shows, cross-window de-duplication, region gating of platforms, and
the scraper's title/platform extraction. Each test names the failure it guards
against.

```bash
npm test
```

The frontend's equivalent — [Vitest](https://vitest.dev), configured
separately from the app's own `vite.config.ts` (`vitest.config.ts`) so the
PWA plugin and its manifest/service-worker setup never load into a test run.
`npm run test:watch` for the interactive runner. Currently covers
`src/lib/languages.ts` (the ISO-code-to-display-name layer behind the
Calendar/Search language filters) and `FilterSelect`'s `getLabel` behaviour —
the piece that lets a filter's stored value and displayed label diverge, which
has no other way to catch a regression before it reaches the browser.

## Staging: running the pipeline without touching production

`releasebot.py` writes to Postgres whenever `DATABASE_URL` is set — `DRY_RUN`
only suppresses Telegram and email, not the database write. To exercise the
pipeline for real, point it at a staging schema instead:

```bash
python scripts/make_staging.py --reset
```

That builds a `staging` schema in the same database, applies every migration to
it, and copies production's rows in (production is only ever read). Then:

```bash
DATABASE_URL="$(python scripts/make_staging.py --print-url)" python releasebot.py
```

The isolation rests on pinning `search_path=staging` **alone**, never
`staging,public` — so a table missing from staging raises `UndefinedTable`
rather than silently falling through to the production table.

To point the dev server and API at staging too, set the same URL as
`DATABASE_URL` before starting `npm run dev:full` (both `scripts/dev-api-server.mjs`
and `lib/db.ts` honour it, and the `postgres` client reads the `?options=` query
parameter).

Set `TMDB_CACHE_DIR` to cache TMDB responses on disk while iterating — a full
digest is several hundred requests, and a cache makes repeated runs cheap and
survivable on a flaky connection. `TMDB_CACHE_TTL_SECONDS` defaults to 6 hours.
Leave it unset in production: provider attribution appears days after a title
goes live, and serving that from a stale cache is the staleness this radar
exists to avoid.

## Local development

```bash
# Python pipeline
pip install -r requirements.txt
DRY_RUN=true USE_SAMPLE_DATA=true python releasebot.py   # no keys needed, writes sample data to Postgres if DATABASE_URL is set

# Frontend
npm install
npm run dev   # http://localhost:8080 (or the port vite picks)
```

The `api/*.ts` functions only run under Vercel (`vercel dev`) or in production — plain `npm run dev` serves the frontend only, so pages that hit `/api/*` will show their "could not load" fallback state locally unless you run `vercel dev` instead.

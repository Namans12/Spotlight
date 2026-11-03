# Consumer taste companion: Scene & Plate, Plan the Night, reminders

Status: deferred. Written 2026-10-21, during the Qloo Agentic Hackathon
(deadline 30 Oct 2026), to be built after it. Anything marked **(builder's
call)** was decided by the author of this doc, not by the team; revisit it
before building.

## Problem

Spotlight tells people *what is releasing* and tracks *what they saved and
liked*. It stops at the screen. Two things people do next are unserved:

1. **Going somewhere because of a title.** Booking.com: 44% of Indians get trip
   ideas from films and series. Skyscanner (1,000 Indians): 94% want to visit
   filming locations (Ladakh/3 Idiots 47%); India to Paris searches rose 23%
   after Emily in Paris S3 (Outlook Traveller). Expedia Unpack '24: 53%
   researched or booked a trip after seeing a destination on screen.
2. **Turning a title into an evening.** Gracenote puts the time spent choosing
   what to watch at 12-14 minutes. We found no data on streaming-night food
   ordering (Swiggy's IPL data is cricket only), so Plan the Night is a
   **delight feature, not an impact claim**. Do not write copy that implies
   otherwise.

The hackathon entry, "Release Pulse", points the same Qloo plumbing at
businesses. This doc is the consumer direction, and reuses Pulse's parts.

Competitors: SetJetters (~900 titles, 47 countries, US-heavy, no taste
personalisation); FlickyPlots and TasteTrails (set-jetting entries in Qloo's
2025 hackathon, neither placed). Our edge: taste personalisation, India
coverage, and a watchlist people already use.

## User flows

**Delhi, Friends night.** Aanya (Delhi, signed in, 9 liked titles) opens
Friends. The title page shows a collapsed "Plan the night" card. She expands it:
three Delhi cafés that Friends fans over-index on (with a pizza-led shortlist,
labelled "Agent's suggestion: pizza"), six artists the audience likes, and
draft text "Friends marathon Friday? I'll get pizza from X". She taps Share
(WhatsApp opens with the text; she sends it herself), then "Remind me Friday 8pm".
Telegram is not linked, so the card offers the deep link and an `.ics` download.

**Traveller to Manali.** Rohan searches "Manali" on the city page and flips to
"I'm visiting". He sees the 37 films shot in Manali (ranked toward his thumbs),
then cafés and sights that fans of those films over-index on, with a chip
"Based on: <film>, <film> +4". Where Qloo has nothing for Manali, the
page says so rather than padding.

## Shared dependencies (Pulse builds these; this spec's Phase 0 is the fallback)

If Pulse shipped, these exist; read its code and skip Phase 0. If not, Phase 0
builds them, and Pulse's later work should reuse them, not fork them.

1. **Qloo service**: a Node container on Railway/Render, not Vercel. Qloo's
   hackathon kit says serverless is not a supported route, and Vercel Hobby is
   already at its 12-function cap (the 12 files under `api/`). It wraps Qloo via the official
   `@qloo/qloo-harness` (`qloo mcp` stdio tool server / `qloo exec`) and holds
   `QLOO_API_KEY` and a server-side LLM key. Container hosting has no
   function cap and a persistent process, which reminders need.
2. **Entity resolution**: TMDB id to IMDb id to Qloo entity.
   IMDb id comes from `title_ratings.imdb_id` (migrations/0002; written by
   `lib/omdb.ts` and `lib/ratingsDb.ts`), falling back to TMDB `external_ids`.
   Then `GET /entities?external.imdb.ids=tt...`, cached in
   `qloo_entities(tmdb_id, media_type, qloo_entity_id, resolved_at)`, with
   **negative results cached too** (`qloo_entity_id NULL`, retry after 30 days
   **(builder's call)**) so a title Qloo does not know is not re-queried per request.
3. **`title_locations`**: built from Wikidata + Wikipedia (below).

## Goals, non-goals, anti-goals

**Goals**: a city page and a title-page panel with better India coverage than
the incumbents; personalisation from thumbs users already give
(`title_opinions`); every recommendation traceable to the Qloo entities and tags
behind it; no user-supplied LLM key.

**Non-goals**: booking, maps, routing, reviews, or place data beyond what Qloo
returns; messaging anyone for the user (share sheet only); a second taste model
(reuse `src/lib/taste.ts`); "shot 2 km from you" for Indian titles.

**Anti-goals** (reject a PR that does any of these)
- **Hallucinated places.** Every place shown is a Qloo entity row; the LLM never
  names or invents one.
- **Claims about an individual.** "Fans of Friends over-index on...", never "you
  will love...".
- **GPS tracking or location history.** City only, never stored as a trail.
- Sending user-identifying fields to Qloo, or presenting LLM output as Qloo data.

## Data coverage (live-tested 2026-10-21)

Wikidata P915 (filming location) / P840 (narrative location) is thin for India
and strong for the West:

| City | filmed / set |
|---|---|
| Delhi | 57 / 110 |
| Mumbai | 45 / 337 |
| Goa | 3 / 56 |
| Manali | 2 / 1 |
| New York City | 1,489 filmed (1,622 with P131* roll-up) / 5,250 |
| Paris | 806 / 3,127 |

Wikipedia categories are far better for India: "Films shot in Delhi" 240 (228
with a TMDB id), "Films set in Delhi" 289, Mumbai shot 838, Goa shot 199,
"Films shot in Manali, Himachal Pradesh" 37, Himachal 125, Ladakh 54, Shimla
set 55, NYC shot 1,926. 93-97% map to TMDB ids. TV coverage is weak everywhere;
do not promise series.

Indian titles' filming locations are city or state level only (212 distinct
places), so proximity features are Hollywood-only. **Use a city radius for
India (builder's call: same city, no distance maths).**

Qloo is **not** a source for shot/set-in: movies carry one
`properties.filming_location` string (often a street address) with no filter.
Its `signal.location` on movies means "popular with that city's audience", a
different, also useful signal ("what Delhi is watching").

## Design

### 1. Location pipeline (`scripts/sync_title_locations.py`)

Follow `scripts/sync_relations_wikidata.py`, including its **documented
lesson**: Wikidata error rates are real, and precedence can make a wrong row
permanent. That script's spot check found ~17% wrong edges and the generator was
not shipped. Here, a wrong "filmed in" is cheaper than a wrong "must watch
first", but the same discipline applies: a mandatory `--spot-check` gate.

1. **City registry**, `data/cities.json`, hand-curated and committed (it is our
   own data, not Qloo's). Per city: slug, display name, country, centroid, Wikidata
   QID(s), Wikipedia category names, and a Qloo `location.query` string. Hand-curated
   because of the gotchas: category names are inconsistent
   (`Films_shot_in_Manali,_Himachal_Pradesh` exists, plain `Manali` is empty); "Manali"
   is QID-ambiguous (Q83443 vs a Chennai suburb, Q986582); Delhi is Q1353 but New
   Delhi is Q987. Start with ~40 cities **(builder's call)**: Indian metros, Goa,
   Manali, Shimla, Ladakh, Jaipur, plus NYC, Paris, London, etc.
2. **Wikipedia**: MediaWiki `generator=categorymembers&prop=pageprops&ppprop=wikibase_item`
   gives page -> QID. List subcategories explicitly in the registry; **never
   recurse blindly** (it pulls in noise such as "Indian Army in films").
3. **Wikidata**: SPARQL `VALUES` over those QIDs for P4947 (TMDB movie),
   P4983 (TMDB TV), P345 (IMDb). Separately, P915/P840 per city QID (with `P131*`
   roll-up for the big Western cities). Page at <=15k rows; back off on 429.
4. **Merge** into `title_locations(tmdb_id, media_type, place_qid, place_name,
   kind 'filmed'|'set', lat, lon, source 'wikidata'|'wikipedia'|'both', confidence)`
   plus `places(qid, name, aliases, lat, lon, country)`. Confidence **(builder's
   call)**: both 0.90, wikipedia-only 0.75, wikidata-only 0.70. Render only at
   >= 0.70, the same floor pattern as `MUST_CONFIDENCE_FLOOR`.
5. **Suspect places**: 184 Indian films are bulk-tagged "filmed in Ooty", an
   import artefact. Registry flag `suspect: true` caps wikidata-only rows at 0.40.
6. **Overrides**: `data/title_location_overrides.csv` (committed) applied last,
   so a bad row can be killed without waiting for upstream.

Runs weekly plus manual dispatch **(builder's call)**, as its own workflow
rather than in the nightly: location facts change slowly. Spot check: sample 30 titles across 6 cities, judge by hand, ship at
<=5% wrong **(builder's call)**.

### 2. Qloo call recipes

Base `https://hackathon.api.qloo.com`, header `X-Api-Key`. `/v2/insights` is
GET-only. Rules the client wrapper enforces (all learned the hard way):
- **Invalid params return an empty 200, silently.** Treat empty as "maybe my
  params are wrong": log the param hash, and keep a live smoke test (below).
- `take` <= 50. 429 on bursts: **concurrency cap 2, exponential backoff.**
- Movie and artist insights take ~3-4s. UI shows skeletons and caches hard.
- **Never resolve places by name.** Always entity UUIDs.
- Use `admin2_region` for municipality. Place properties available: address,
  lat/lon, `price_level` 1-4, `business_rating`, hours, website, `menu_url`,
  images, `external` (google_place, resy, michelin, tripadvisor).

| Feature | Params |
|---|---|
| Places for a city, personalised | `filter.type=urn:entity:place` `signal.interests.entities=<<=10 qloo ids>` `filter.location.query=<city>` `take=20` |
| Places for one title (Plan the Night) | same, one entity id, optional `filter.tags=<resolved theme tag>`, `take=10` |
| Playlist | `filter.type=urn:entity:artist` `signal.interests.entities=<title id>` `take=10` |
| "What <city> is watching" (optional) | `filter.type=urn:entity:movie` `signal.location.query=<city>` |

**Place type filtering.** Jaipur worked but returned hotels and banquet halls.
Split Eat / Cafés / Bars / See by place tag, not by name. Discover the real
tag URNs in a Phase 2 spike (Qloo's tag search under the place parent); the
only one confirmed so far is `urn:tag:genre:place:restaurant:pizza`.
`filter.geocode.country_code=IN` used alone is not a city filter.

**Theme tags.** An LLM reads title metadata/keywords (never user data) and
proposes a theme word ("pizza" for Friends). The service resolves it through
Qloo tag search and uses it **only if a matching place tag exists**; the LLM
never supplies URNs. Whether TV shows carry food/vibe tags in Qloo is unknown,
hence the LLM. The theme is always labelled "Agent's suggestion", never Qloo data.

**Fallback ladder** (stop at the first non-empty; show which rung was used):
1. User's seeds (>=3 liked titles, same threshold as `MIN_OPINIONS_TO_RERANK`).
2. The city's own shot/set titles (top 5 by `title_ratings.imdb_votes` that resolve
   to Qloo): "fans of films shot in Manali over-index on...".
3. No signal, location only (popularity order; verify Qloo behaves this way).
4. An honest empty state ("not enough data for <city> yet"). Never fill with LLM text.

**Caching**: all Qloo responses go in a Postgres `qloo_cache(cache_key, response
jsonb, fetched_at)` on the service's DB. Key = endpoint + canonical params
(sorted seed ids). TTL 7 days for places, 30 for playlists **(builder's call)**.
Plan the Night depends only on (title, city, theme), not on the user, so it is
shared across everyone and hits often. **Qloo data is never committed to the
public repo**: test fixtures are synthetic; real recordings go in gitignored
`*.local` files.

### 3. Taste bridge

`likedSeeds()` (`src/lib/taste.ts`, cap ~15) gives the user's liked titles; the
client sends `[{tmdbId, mediaType}]` with each request (at most 10 for places,
**builder's call**: faster and less noisy). The service resolves them via
`qloo_entities` and passes the UUIDs as `signal.interests.entities`. No user id
reaches Qloo, and the service does not log seed lists next to user ids.

**Guest pollution.** All guests share one `users` row (`lib/usersDb.ts`
`upsertGuestUser`, gated by `DEMO_GUEST`), so their thumbs mix. For a guest
session, taste is **per-session and local**: thumbs write to `sessionStorage`
(`spotlight:guest-taste`), seeds come from there, nothing persists. Guests get
ICS reminders (client-side) but not Telegram or email, since a shared account
cannot own a chat id.

**City-page ranking.** The server returns up to 200 candidates ordered by
confidence, then `imdb_votes`. The client hydrates the first ~48 through the
existing TMDB proxy and applies `tasteScore`. `rerankByTaste` moves items at most
5 places, which was right for a list ranked on hard evidence and is too weak
for a popularity-ordered list; add an optional `maxShift` parameter (default 5,
so existing callers are unchanged), and use ~15 here **(builder's call)**.

### 4. Features and UI placement

**Scene & Plate**, new route `/city/:slug` (`src/routes/City.tsx`, lazy-loaded
like `Duel` in `src/App.tsx`). Tabs: Shot here / Set here (a "both" badge),
then Eat / Cafés / Bars / See. A chip row shows provenance ("Based on: Gully Boy,
Panchayat + 3 more"). "Near me" runs `navigator.geolocation` once, finds the
nearest registry city by haversine in the browser (within ~60 km, else asks the
user to pick), and discards the coordinates. Trip mode is the same route with
an "I'm visiting" toggle that only changes copy and falls back to rung 2 when
the user has few seeds. City choice lives in `localStorage` (`spotlight:city`),
not on the account **(builder's call)**.

**Filmed in / Set in panel**: new `src/components/title/LocationsPanel.tsx`,
inserted in `src/routes/TitleDetail.tsx` between `<FactsPanel detail={data} />`
(line ~413) and the `TrailerCard` line. Renders nothing when there are no rows
at or above the floor. Each place links to `/city/:slug`.

**Plan the Night**, `src/components/plan/PlanNightCard.tsx`, one component, three
mounts: collapsed on `TitleDetail.tsx` below the locations panel; behind a
"Plan the night" button in the `Result` component of `src/routes/Duel.tsx`
(beside Where to watch / Watchlist / Again); and as an action on the top title in
`src/components/watchlist/WatchlistView.tsx`, since `WatchNowBar.tsx` is a
filter bar with no single title. (I did not read WatchlistView closely; confirm
there.) Output: food plan (3 places + the "Agent's suggestion: pizza" label if
used), playlist (artist names with `open.spotify.com/search/<name>` links, no
Spotify integration), invite text ("Friends marathon Friday? I'll get pizza from X").
Share uses `navigator.share`, falling back to `https://wa.me/?text=`. The user
taps send; we send nothing.

### 5. Reminders

"Remind me Friday 8pm to watch X" creates a delivered plan. Constraints:
Telegram today is owner-only (single `TELEGRAM_CHAT_ID`, no per-user chat id, no
webhook because of the function cap); per-user email exists
(`users.notify_watchlist_drops`, `sent_notifications` with per-user dedupe from
migration 0013) but fires only on the Wed/Fri/nightly cron.

| Option | Verdict |
|---|---|
| (a) Email at the nightly run | Fallback only: a "Friday 8pm" reminder arrives sometime Friday-night-cron, which is wrong. |
| (b) Per-user Telegram via `/start <token>` deep link | **Recommended.** Exact time. The Node service has no function cap, so it hosts the webhook. |
| (c) `.ics` download | **Recommended with (b).** Zero backend, works for guests, uses the user's own calendar. |

**Telegram linking (b).** `POST /svc/v1/telegram/link-token` (signed-in, non-guest)
stores a single-use token (hashed, 15 min expiry) and returns
`https://t.me/<bot>?start=<token>`. The bot's webhook (`setWebhook` to the service,
verified with Telegram's `secret_token` header) receives `/start <token>` and sets
`users.telegram_chat_id`. The existing bot is send-only in `releasebot.py`, so
sharing it is safe **(builder's call; confirm no `getUpdates` poller)**. `/stop`
clears the id.

**Delivery.** `reminders(id, user_id, tmdb_id, media_type, city, due_at timestamptz,
plan jsonb, channel, sent_at)`. The plan is **snapshotted at creation**, so
delivery makes no Qloo call and the message matches what the user approved
**(builder's call)**. A once-a-minute loop in the service claims due rows with
`FOR UPDATE SKIP LOCKED` and sends. Capture the user's timezone from `Intl` and
store UTC. Without a linked chat, `releasebot.py` gets a
`send_due_reminders_email` step modelled on `send_user_watchlist_alerts` (fallback (a); honest
copy: "we'll email you on the day", not "at 8pm").

### 6. Agent tools (hosted)

`find_titles_shot_in(city)`, `places_for_title(title, city, theme?)`,
`plan_night(title, city)`: executed on the service, so no user key is needed
(`api/agent-relay.ts` and the BYO-key flow stay). `src/webmcp/registerTools.ts`
gets thin wrappers calling the service, so the Chrome WebMCP path has the same
tools. `src/webmcp/AgentChat.tsx` renders only when `document.modelContext?.getTools`
exists today; add a hosted mode (`POST /svc/v1/agent/chat`, SSE) that renders
for everyone. The hosted loop exposes **only read-only tools**; side effects
(set reminder, add to watchlist) come back as a button the user taps. **Place cards render from
the tool JSON, not from model prose**, and the system prompt forbids naming
places absent from tool output. Because the LLM key is ours, rate-limit per
user and per IP (**builder's call**: 20 messages/day signed-in, 5 guest) and
cap tool rounds at the existing `MAX_TOOL_ROUNDS` (6).

## API and service surface

Zero new Vercel functions. The browser calls same-origin `/svc/*`, which
`vercel.json` rewrites to the Node service (add `{ "source": "/svc/:path*",
"destination": "https://<service>/:path*" }` **before** the SPA catch-all).
Same-origin means the `spotlight_session` cookie (HMAC over `AUTH_SECRET`,
`lib/auth.ts`) arrives with each request, and the service verifies it with
the same secret. Copy the verifier and add a shared test vector so the two
cannot drift. **Spike in Phase 0**: confirm external rewrites forward cookies,
honour `s-maxage`, and tolerate the 3-4s Qloo latency. If they do not, the
fallback is a CORS call with a bearer token minted by `api/auth.ts`, and
public reads can fold into `api/relations.ts` as a `kind=locations` mode.

`GET /v1/title/:type/:id/locations`, `GET /v1/city/:slug/titles` (public, edge-cached),
`POST /v1/city/places`, `POST /v1/plan-night`, `POST /v1/reminders` /
`GET` / `DELETE`, `POST /v1/telegram/link-token`, `POST /v1/telegram/webhook`,
`POST /v1/agent/chat`.

## Migrations

Take the **next free number** (0016 unless Pulse used some; keep the existing
`BEGIN; ... COMMIT;` and explanatory-header style).
- **N**: `qloo_entities`, `qloo_cache`, `places`, `title_locations`. Skipped if Pulse made them.
- **N+1**: `users.telegram_chat_id BIGINT`, `telegram_link_tokens`, `reminders`
  (`ON DELETE CASCADE` on `user_id`, per 0007). The chat id is personal data:
  null on `/stop`, gone with the account.

## Privacy and Qloo SAFE_USE

- Qloo requests carry entity UUIDs, tag URNs and a city string. Never names,
  emails, account ids, or location histories. The call is server-side, so the
  user's IP never reaches Qloo.
- The city is an explicit per-request value. Geolocation never leaves the browser.
- Copy states aggregate affinities, never individual inference. The provenance
  chips show which titles and tags drove a result, and the page says what Qloo
  cannot tell us (coverage, TV, India place depth).
- The LLM sees title metadata only, never a user identifier.
- Attribution footer: "Location data: Wikidata (CC0), Wikipedia (CC BY-SA)".
- No Qloo data in git (see Caching).

## Testing

- **vitest** (patterns of `src/lib/taste.test.ts`, `lib/relationsDb.test.ts`):
  the Qloo param builder as a pure function asserting exact params per feature;
  response normaliser on synthetic fixtures; fallback-ladder order; seed selection
  and guest-local taste; ICS builder; haversine nearest-city; `rerankByTaste`
  with `maxShift`; the cookie verifier against a shared vector. Service tests
  use a fake `sql`, as `relationsDb.test.ts` does.
- **pytest** (patterns of `tests/test_sync_theatrical_wikipedia.py`,
  `tests/test_per_user_alerts.py`): category -> QID parsing, SPARQL batching, merge
  and confidence, the Ooty cap, 429 backoff, overrides, and
  `send_due_reminders_email` with a fake cursor.
- **Service**: scheduler claims a row once under two workers (fake clock); Telegram
  link expiry, single use, guest refused.
- **Live smoke** (`npm run qloo:smoke`, manual, never in CI because of 429s):
  Friends + NYC and Gully Boy + Delhi must return non-empty. This is the only
  defence against the silent empty 200.

## Phased rollout (engineer-days, rough)

| Phase | Scope | Days |
|---|---|---|
| 0 | Shared deps (skip if Pulse shipped): service skeleton + harness, resolver, `title_locations` pipeline + spot check, `/svc` rewrite spike | 4-6 |
| 1 | LocationsPanel + City page, titles only, **no Qloo** | 3 |
| 2 | Places on the city page, taste bridge, trip mode, tag spike | 3-4 |
| 3 | Plan the Night (theme, playlist, share), three mounts | 3-4 |
| 4 | Reminders: ICS 0.5; Telegram link + scheduler 3; email fallback 1 | ~4.5 |
| 5 | Hosted agent tools + chat mode | 2-3 |

Phase 1 ships alone: it depends only on Wikipedia/Wikidata, so it stays
valuable if Qloo's Indian place depth disappoints. **Gate before Phase 2
ships (builder's call)**: 10 Indian cities x 3 seed sets, hand-graded; proceed
if >=8 cities return >=5 results and >=70% of the top 10 are real eat/see
places, not banquet halls. Otherwise ship places for metros only and keep the
rest titles-only.

## Open questions

- Qloo's terms on caching/storing responses, and what production access, rate
  limits and base URL look like after the hackathon key lapses.
- Does Qloo `filter.location.query` resolve "Manali" to the Himachal town?
- Do Qloo TV entities carry any food/vibe tags?
- Does Pulse's service expose an API we should match, or own the auth model?
- Do Vercel external rewrites meet the three needs in "API and service surface"?
- Hosted LLM provider and monthly cost ceiling.
- Can the always-on service send the email reminder at the exact time too,
  making option (a) unnecessary?

## Risks

- **Qloo returns thin or noisy India places.** Mitigation: the fallback ladder,
  the Phase 2 gate, and Phase 1 shipping without Qloo.
- **Wrong Wikidata rows** (error rates, the Ooty import). Mitigation: confidence
  floor, suspect flag, overrides, spot-check gate.
- **The service becomes a single point of failure.** A sleeping free tier would
  silently miss reminders: pay for always-on and run exactly one scheduler.
- **Hosted LLM key abuse.** Mitigation: rate limits, read-only tools, round cap.
- **Scope creep into a travel product.** The non-goals are the defence.
- **Hackathon API key and base URL stop working** after 30 Oct. Phase 0 should
  make both configuration, not code.

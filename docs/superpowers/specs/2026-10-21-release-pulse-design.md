# Release Pulse: a taste-grounded release-marketing agent (Qloo Agentic Hackathon)

## Problem

Every week, 15–20 titles land on Indian OTT platforms and in cinemas. Indian
brands have a long habit of riding those moments: Amul has run topicals since
1966, and Swiggy, Durex and Mother Dairy all posted *Sacred Games* tie-ins in
2018. Big brands have agencies and social-listening contracts for this.
Brandwatch has a median contract of about $50k a year, and Talkwalker starts at
$15–25k. A café owner in Hauz Khas, a two-person D2C snack brand, or a
food creator in Pune has neither. They guess: they theme the weekend around
whatever is loudest on Instagram, without knowing whether *their* local
audience cares about it or what else that audience likes.

Spotlight already knows what is releasing and when. That is the calendar
`releasebot.py` keeps current twice a week. Qloo knows who loves what,
and where. Release Pulse joins the two. For a business in a given city it
produces:

- the upcoming releases ranked by how much that city's audience cares,
- an evidence-backed brief on each audience,
- a ready-to-use tie-in campaign.

Every claim in that campaign is traceable to a Qloo result or to a cited
public source.

## Why this, and why now

This is a hackathon entry (deadline **30 Oct 2026, 11:45 pm ET**). The judges
score four things equally: Qloo technical depth, design, impact and idea.
The research behind choosing this direction, all done on 2026-10-21:

- **What won last time.** At Qloo's 2025 hackathon (344 entries), business
  "agent as analyst" tools that output a finished deliverable won 3 of 4
  prizes. The grand prize was GeoTaste, a location-based business
  consultant. Travel planners (about 15% of entries), food recommenders and
  movie recommenders won nothing. Set-jetting was tried (FlickyPlots,
  TasteTrails) and did not place.
- **Qloo's own test:** "If your submission would work the same without Qloo,
  you're building the wrong thing." In Pulse, every ranking and every
  audience claim comes from Qloo. Without it, an LLM can only guess.
- **Matches Qloo's sales pitch.** Pulse uses heatmaps, demographics,
  cross-domain affinity and tags together, which is what Qloo sells to brands
  and media companies (JCDecaux, media planning, "no cookies, no profiles").

The consumer direction (filmed-here city pages, "Plan the Night") is
specified separately in
`docs/superpowers/specs/2026-10-21-consumer-taste-companion-design.md` for
later. Pulse builds the engine that both share.

## Goals

1. **Business profile, no sign-in.** The user picks:
   - a city from a curated list,
   - a business type: **café/restaurant** or **D2C food & beverage brand**.

   The profile lives in the URL (`/pulse?city=delhi&type=cafe`) and
   `localStorage`. It holds no personal data, and a brief is shareable by
   copying the link.

   *Builder's call, made in spec review.* Creators and small cinemas are
   cut from launch. Qloo's place and brand data fits these two types
   directly, and they are the persona the market research singled out (the
   solo social manager at a small café or D2C food brand). The other two
   would need different recipes. They are a post-hackathon addition.
2. **The Pulse board.** It shows upcoming releases ranked by a local
   relevance score.
   - OTT comes from `release_items` (both the Out Now and Coming Up windows,
     about 9 days).
   - Theatrical comes from `calendar_entries` rows that have a `tmdb_id`,
     dated within the next 14 days, with `kind` derived at read time exactly
     as `lib/calendarDb.ts:getCalendarMonth` does. Never trust the stored
     `is_theatrical`.
   - A title present in both appears once, with the `release_items` row
     winning.

   Each card says *why* it ranks where it does in one line, e.g. "#2 of 14
   for Delhi audiences · strongest around Hauz Khas · shot in Chandni
   Chowk". The rank is claimed within this city's candidate set only.
3. **The release brief.** Each title in a city gets six sections:
   - **Who:** the audience's age and gender skew.
   - **Where:** a heatmap across the city with the strongest neighbourhoods
     named.
   - **What else they love:** venues, cuisine/place tags, artists and brands
     this audience over-indexes on in that city, filtered to what's useful
     for the business type.
   - **Local hook:** whether the title was shot or set in this city, and
     where.
   - **Campaign:** three concrete tie-in ideas (a menu or product special, a
     social post with copy, and an in-store event or screening night), each
     timed to the release date.
   - **Provenance:** the exact Qloo entities, tags and parameters behind each
     claim, and what the result does *not* establish.
4. **An agent judges can talk to.** A server-side chat on `/pulse` answers
   questions like "which release should I theme my weekend menu around, and
   why?". It calls Pulse and Qloo tools and needs no API key from the
   visitor.
5. **"With vs without Qloo."** A toggle on the brief shows what a plain LLM
   proposes for the same release and city, next to the Qloo-grounded brief.
   This answers the judges' central question on screen. It is the builder's
   call to cut this if Phase 3 runs late, but it is the cheapest
   high-value demo moment, so cut it last.
6. **Thin consumer slice (stretch).** A "Filmed in / Set in" panel on the
   title page, and a minimal "Plan the night" card on the title page. Both
   reuse the same service and tables, and are the first slice of the
   consumer spec.

## Non-goals

- Posting to social media, sending messages, or buying ads for the business.
  Pulse drafts and the human publishes.
- Covering every Indian city. The launch list is curated (see Constraints).
- Live trend charts. Qloo's `/v2/trending` has conflicting docs, and another
  team reported empty results. Trends are shown only when non-empty and never
  feed the ranking.
- Any change to Spotlight's existing consumer features, except the stretch
  slice in Goal 6.

## Anti-goals (failure even if it works)

- **A claim that looks like data but isn't.** Every sentence in a campaign is
  tagged as Qloo evidence, public-source evidence, or the agent's suggestion.
  An untagged factual claim is a bug.
- **Statements about individuals.** Qloo results describe aggregate
  affinities. Copy says "fans of X in Delhi over-index on Y", never "your
  customers like Y" or "you will like Y". This is the kit's `SAFE_USE.md`
  rule, and the judges' rubric names responsible data handling.
- **Personal data sent to Qloo.** No names, emails, account ids, or location
  histories go to Qloo. A city chosen from a list is fine, and GPS is not
  used at all.
- **A raw-JSON dashboard.** The kit's `SUBMISSION.md` says projects are
  stronger when Qloo results are evidence in a clear product flow.
- **A demo that makes judges work.** Judges should not need a Google sign-in,
  a pasted key, a Chrome flag, or a wait of more than about 10 s with no
  progress.
- **Qloo data in the public repo.** It stays in Postgres. Seed files must not
  contain Qloo responses.

## Architecture

```
Browser (Spotlight SPA on Vercel)
   │  /pulse board, brief, chat (new route, public)
   ▼
pulse-service  (Node 22 container, Railway or Render)   ◄── QLOO_API_KEY, LLM key
   ├─ long-lived `qloo mcp` child (stdio, @qloo/qloo-harness ≥0.1.26)
   ├─ REST: GET /board, GET /brief, POST /chat (SSE)
   ├─ deterministic pipeline: resolve → fetch Qloo evidence → score → cache
   └─ agent loop: LLM + tools (Pulse tools + harness Qloo tools)
   ▼
Neon Postgres (same database as Spotlight's hackathon deployment)
   release_items, calendar_entries, title_ratings     (existing, read-only)
   qloo_entities, qloo_evidence, title_locations, places, pulse_usage  (new)
```

**Why a separate service rather than Vercel functions.** There are four
reasons, and each one is sufficient on its own:

1. Qloo's kit says "Serverless functions are not a supported route". The
   supported surfaces are the harness's `mcp`, `exec` and `api` commands.
2. `api/` is at the Vercel Hobby cap of 12 functions.
3. `maxDuration` is 15 s, while a brief needs several Qloo calls at about
   3–4 s each with concurrency capped at about 2.
4. The agent loop needs streaming and more than one round.

The SPA talks to the service directly over CORS, allowlisted to Spotlight's
origins. Nothing new is added under `api/`.

**The service lives in this repo** under `services/pulse/`. It has its own
`package.json` and Dockerfile, so the public repo contains everything needed
to run the project, as the rules require.

**Builder's call:** the Docker build context is the repo root. The service
imports `lib/db.ts`, `lib/calendarDb.ts` and `shared/` directly, rather than
copying them, and runs under `tsx`. It gets its own
`tsconfig.service.json`, added to the `typecheck` script.

**Database.** The service holds a read-write `DATABASE_URL` for the
hackathon deployment's Neon database. That database is a separate Neon
branch or project from production, matching how the WebMCP deployment was
kept apart. Migrations `0016+` are plain SQL applied by hand with `psql`,
like every existing migration (README, Setup step 5), before the service or
the Vercel build that prerenders against them is deployed. The Python sync
scripts and the service write to disjoint tables, so concurrent writers
don't collide.

**The Qloo kit is public:** https://github.com/qloo/qloo-hackathon-kit.
`docs/SAFE_USE.md`, `docs/API_ACCESS.md`, `docs/SUBMISSION.md` and
`starter/mcp-client/backend.mjs` are the references cited throughout this
spec.

### Qloo access

- **One long-lived MCP client.** The service starts `qloo mcp` once and keeps
  an MCP client to it (pattern: `starter/mcp-client/backend.mjs` in the kit,
  `env: process.env`). Both the deterministic pipeline and the agent call the
  same harness tools: `qloo_recommend`, `qloo_where_popular`,
  `qloo_audience_demographics`, `qloo_find_tags`, `qloo_describe`,
  `qloo_rank` and `qloo_compare_audiences`. The first call takes about 12 s,
  so warm it at boot.
- **Raw endpoints.** Anything the workflows don't cover goes through
  `qloo api …`, for example looking up an entity by IMDb id or a heatmap with
  explicit `output.heatmap.boundary`. Phase 0 determines exactly which.
- **Limits and failures.**
  - Concurrency is 2, with retry backoff at 3 s and 8 s on 429.
  - Every harness result is `{status, …}`. `empty`, `needs_input`,
    `degraded` and `error` are rendered honestly, e.g. "Qloo has too little
    signal for this title in Pune". They are never silently filled by the
    LLM.

### Entity resolution: TMDB → Qloo

Spotlight keys everything on `(tmdb_id, media_type)`, and Qloo has no TMDB
ids. Resolution goes in this order:

1. **IMDb id.** Use `title_ratings.imdb_id` where present. Otherwise use
   TMDB's `external_ids`, the same lookup as `lib/omdb.ts:resolveOmdbLookup`.
2. **Qloo by IMDb id:** `GET /entities?external.imdb.ids=…`.
3. **Fallback search:** `/search` with the title, `types=urn:entity:movie` or
   `tv_show`, and a match accepted only if the release year is within ±1 and
   the type agrees.
4. **Store the result** in `qloo_entities(tmdb_id, media_type, imdb_id,
   qloo_entity_id, method, not_found, resolved_at)`. A miss is stored with
   `not_found` and retried after 3 days, because new releases may appear in
   Qloo late. This follows the same pattern as `title_ratings`.

### Location data: `title_locations`

Qloo is not the source for "shot or set in". Its `filming_location` is a
single unfilterable string. The data comes from public sources, tested live
on 2026-10-21:

| Place | Wikidata P915 (filmed) | Wikipedia "Films shot in …" |
|---|---|---|
| Delhi | 57 | 240 (228 with a TMDB id) |
| Mumbai | 45 | 838 |
| Goa | 3 | 199 |
| Manali | 2 | 37 |
| NYC | 1,489 | 1,926 |

Wikipedia "Films set in …" counts include Delhi 289 and Mumbai 670.

**The script.** `scripts/sync_title_locations.py` (Python, nightly workflow)
does three things:

- walks the Wikipedia "Films/Television series shot in X" and "… set in X"
  categories for the supported cities,
- maps pages to Wikidata QIDs through
  `generator=categorymembers&prop=pageprops&ppprop=wikibase_item`, then to
  TMDB ids via P4947/P4983 (the same resolution pattern as
  `scripts/sync_relations_wikidata.py`),
- unions the result with Wikidata P915 and P840 for the same city QIDs.

**The tables:**

- `title_locations(tmdb_id, media_type, place_qid, kind 'filmed'|'set', source 'wikidata'|'wikipedia'|'both', landmark_label, landmark_lat, landmark_lon)`
- `places(qid, slug, name, aliases, lat, lon, country, qloo_location_query)`

**Gotchas already found:**

- Category names are inconsistent: `Films_shot_in_Manali,_Himachal_Pradesh`
  exists but `Films_shot_in_Manali` is empty. The category-to-place mapping
  is therefore a hand-written table in the script.
- Don't recurse subcategories, which contain noise such as "Indian Army in
  films".
- Delhi is Q1353 and New Delhi is Q987, so treat both as one place.
- Wikidata has 184 Indian films bulk-tagged as filmed in Ooty. Ignore that
  place.
- Keep WDQS pages at 15k rows or fewer, with backoff on 429.
- For Indian titles, Wikidata gives only city-level precision. Landmarks
  (e.g. Chandni Chowk) appear only where Wikipedia or Wikidata names them.
  Don't promise them.

### Cached evidence

`qloo_evidence(release_key, city_slug, kind, params jsonb, status, payload jsonb, fetched_at)`:

- `kind` is one of `demographics`, `heatmap`, `places`, `place_tags`,
  `artists` or `brands`.
- `release_key` is the Qloo entity id.
- Evidence is computed **lazily** on the first request for that release and
  city, then reused for 3 days.
- The Wed/Fri workflow pre-warms only the top 10 releases × the launch cities
  so the demo is instant. The kit's `API_ACCESS.md` says to cache only what's
  needed and not to bulk-recreate Qloo's database. Pre-warming beyond that
  is out of scope.
- Demographics don't depend on the city, so they are stored once per release.
- **Demo scale (builder's call).** Pre-warm the top 10 releases for three
  demo cities (Delhi, Mumbai, Bengaluru), roughly 30 briefs. Any other city
  is computed cold. That takes about 10–15 s, which is acceptable only
  because sections stream in independently. Plan for a handful of judges
  at once, not a traffic spike.

## The Qloo recipe per brief section

Exact parameter names are verified in Phase 0, because Qloo silently ignores
invalid params and returns an empty 200.

| Section | Call | Notes |
|---|---|---|
| Who | `qloo_audience_demographics` (raw: `filter.type=urn:demographics`, `signal.interests.entities=<release>`) | Global, not per-city. The UI says so. Values are signed skew relative to average, not percentages. |
| Where | `qloo_where_popular` (raw: `filter.type=urn:heatmap`, `filter.location.query=<city>`, `signal.interests.entities=<release>`) | Returns geohash cells with affinity. Show the top cells on a map and label each with the nearest entry in `neighbourhoods(city_slug, name, lat, lon)`, a static table of about 10–20 named areas per launch city. *Builder's call:* fill it from a one-off Wikidata SPARQL pull of neighbourhood items located in each city with P625 coordinates, then hand-check it. Use nearest-centroid labelling within 3 km, and leave a cell unlabelled when nothing is that close. The harness keeps 20 cells. |
| What else (venues) | `qloo_recommend` (`target_type=place`, signals=release, `filter_location`=city), optionally with `include_tags` for the business type (café → coffee/café/bakery tags found via `qloo_find_tags`) | Jaipur results from another team included hotels and banquet halls, so filter by place type for the business. Use `admin2_region` for the municipality. Always show the venue's tags. |
| What else (themes) | `filter.type=urn:tag`, `filter.parents.types=urn:entity:place`, signal=release, with location | Gives the cuisines and place genres this audience over-indexes on. This drives menu ideas. |
| What else (artists, brands) | `qloo_recommend` with `target_type=artist` / `brand`, signals=release | Artists give playlist or event ideas, and brands give D2C collab ideas. Shown per business type. |
| Local hook | `title_locations` join `places` | No Qloo call. |
| Trend | `qloo_trends` | Display only, and only if non-empty. |

### Local relevance score (board ranking)

The score is deterministic and explainable, and **never** computed by the
LLM:

```
score = 0.55 · local_affinity      (heatmap: mean affinity of top cells in city, normalised within this city's candidate set)
      + 0.25 · business_fit        (share of top venue/tag results matching the business type's tag set)
      + 0.10 · local_hook          (1 if shot or set in this city)
      + 0.10 · freshness           (release within 0–7 days ranks above 8–14)
```

The weights are the builder's call. The rules are fixed: each card must show
its two biggest contributors in words, and titles that could not be resolved
in Qloo rank in a separate "Not enough taste data yet" strip. They are never
interleaved with fake scores. Heatmap affinity is comparable only within one
query, so normalise per city and never across cities.

## The campaign (LLM)

**Provider: Groq** (team decision, 2026-10-21). It is free, and it is the
same OpenAI-compatible endpoint Spotlight's chat already defaults to
(`openai/gpt-oss-120b`; see `src/webmcp/AgentChat.tsx`). The key is held
server-side as `GROQ_API_KEY`. The model sits behind a small
OpenAI-compatible client so it can be swapped by changing the base URL and
model name. Because a free open-weight model follows strict citation less
reliably, the evidence validation below is a **validate-and-retry loop**:

- At most 2 retries, each feeding back the specific invalid or missing
  evidence ids.
- After that, any clause that still fails is shown as an agent suggestion,
  never as evidence.
- Groq's free-tier rate limits are a real ceiling, so `pulse_usage` caps are
  set below them and a cap hit says so in the UI.

- **One LLM call per brief, with structured output.** The input is the
  evidence bundle (ids plus human-readable facts), the business type and the
  release date. The model writes three ideas. Every factual clause carries an
  evidence id, and anything else is marked `suggestion`.
- **Validation.** The service checks every cited id exists in the bundle and
  drops or flags anything that doesn't.
- **Display.** The UI renders evidence chips ("Qloo · heatmap", "Wikipedia ·
  Films shot in Delhi", "Agent suggestion") inline.
- **"Without Qloo" view.** The same prompt with no evidence bundle, and the
  label "What an LLM guesses with no taste data".

## The agent

`POST /chat` on the service streams over SSE, with the LLM loop server-side.

**Tools:**

- `pulse_board(city, business_type)`
- `release_brief(title_or_tmdb_id, city, business_type)`
- `search_releases(query)`
- `titles_shot_in(city)`
- the harness Qloo tools: `recommend`, `where_popular`,
  `audience_demographics`, `rank`, `compare_audiences`, `find_tags` and
  `describe`

The system prompt holds the SAFE_USE rules and the provenance-tagging rule.

**Cost control.** `pulse_usage` rows (session hash, day, calls) enforce
per-session and global daily caps. The existing in-memory limiter
(`lib/rateLimit.ts`) is per instance and keyed on a spoofable header, so it
is not enough for a server-held key.

**UI.** A chat panel on `/pulse`, independent of the WebMCP feature. The
existing `src/webmcp/AgentChat.tsx` stays as it is.

## UI

- **Route.** `/pulse` and `/pulse/:city/:tmdbType/:tmdbId` (the brief). Add a
  lazy route in `src/App.tsx` and a nav item in
  `src/components/layout/Sidebar.tsx`. Both are public, not behind
  `RequireAuth`.
- **Board.** A city and business-type picker, then ranked cards in Spotlight's
  existing poster-card idiom (poster, platform, date), plus a "why" line and
  a score bar.
- **Brief.**
  - Sections in the order of Goal 3.
  - The heatmap uses a light map (react-leaflet with OSM tiles, or an SVG
    geohash grid; builder's call). It is the first new map dependency in the
    repo.
  - A collapsible provenance drawer lists the entity and tag ids, the
    parameters (no key), and a "What this doesn't tell you" note.
- **Loading.** Sections stream in as evidence arrives, each with its own
  skeleton. One slow section must not block the rest.
- **Design.** Match the existing Tailwind/Radix look. Pulse is a mode of
  Spotlight, not a separate product skin.

## Constraints

- **Launch cities.** Delhi NCR, Mumbai, Bengaluru, Hyderabad, Chennai, Pune,
  Kolkata, Goa, **plus New York and London** (team decision, 2026-10-21).
  Most judges are US-based and should be able to try a city they know. In
  New York and London the board still lists India's releases, and the UI
  says so plainly, e.g. "Release dates are for India; audience data is for
  New York". Phase 0 cuts any city where Qloo place results are thin.
- **Release data.** Releases are India-region (`REGION=IN`). Theatrical rows
  in `calendar_entries` may lack `tmdb_id`, and those are skipped.
- **Separate deployment.** The hackathon runs on its own Vercel project and
  service, as the WebMCP submission did. It uses guest mode
  (`DEMO_GUEST=1`, `VITE_DEMO_GUEST=1`) so judges never hit a sign-in wall.
- **README reframe.** The README currently opens with the WebMCP Challenge
  note. The Qloo submission needs its own top section with four parts:
  - What's new since the 30 Sep 2026 start, with commit references. The
    rules require explaining how an existing project was significantly
    updated.
  - A "test in 60 seconds" path for judges.
  - The Qloo tools used and why.
  - A redacted request-to-result walkthrough and known limitations (both
    from the kit's `SUBMISSION.md`).
- **License.** The MIT `LICENSE` exists. Confirm GitHub shows it in the
  repo's About sidebar.
- **Checks.** `npm run typecheck` runs all four tsconfigs, and must pass
  together with `npm test` and `pytest` before each deploy.

## Phases

The dates assume work starts on 21 Oct and the submission goes in on 30 Oct.

| Phase | Dates | Work | Exit criterion |
|---|---|---|---|
| 0. Live spike | 21–22 Oct | Qloo key. A throwaway script with about 20 calls: resolve 10 current releases by IMDb id; demographics, heatmap, place recs and place tags for Delhi, Mumbai and one non-Indian city; verify the exact params and harness tool names. | **Go:** ≥7/10 releases resolve, Delhi place recs return ≥5 real F&B venues, and the Delhi heatmap returns cells. **No-go:** see Risks. |
| 1. Plumbing | 22–24 Oct | `services/pulse` skeleton with an MCP client, `qloo_entities` and resolution, the `qloo_evidence` cache, migrations, `sync_title_locations.py`, and a container deploy. | `GET /brief` returns cached evidence JSON for a real release and city. |
| 2. Product | 24–27 Oct | Scoring, `/board`, the `/pulse` board and brief UI, provenance drawer and map. | A judge can go from city pick to a full brief in under 10 s, warm. |
| 3. Agent | 27–28 Oct | Campaign LLM call with evidence validation, the "without Qloo" toggle, the chat with tools and usage caps. | The chat answers "what should my Delhi café theme this weekend around?" with cited evidence. |
| 4. Stretch | 28–29 Oct | "Filmed in" panel and "Plan the night" card on the title page. Pre-warm in the Wed/Fri workflow. | Optional. |
| 5. Ship | 29–30 Oct | Hackathon deployment, README, Devpost text, a full judge run-through in a fresh incognito window, and screenshots. | Submitted before 30 Oct, 6 pm ET, leaving buffer. |

## Risks

- **India data in Qloo is thinner than hoped.** Another team confirmed Indian
  titles resolve and Jaipur places return. Delhi venue depth is unproven.
  - *Fallback 1:* switch the venue section to city-level place *tags*
    (cuisines and genres) instead of named venues.
  - *Fallback 2:* lead the demo with a city where results are strong, and
    keep India cities that pass.
- **The hackathon key exposes fewer endpoints** than documented. A 2025
  entrant lost one. Phase 0 checks heatmap and demographics first, because
  the board's ranking depends on the heatmap. *Fallback:* rank on
  `signal.location`-biased insights affinity instead.
- **Latency.** At 3–4 s per call with concurrency 2, a cold brief takes about
  10–15 s. Mitigate with section streaming, pre-warming the demo set, and
  3-day caching.
- **The key arrives late.** As of 2026-10-21 it has been applied for and is
  not yet received, so this risk is live.
  - Phases 1 and 2 are built against fixtures shaped like the documented
    responses, behind a `QLOO_FIXTURES=1` switch.
  - The fixture schemas are educated guesses, so the Qloo adapter is kept to
    one module that maps responses into Pulse's own types. When the real
    shapes differ, only that module changes.
  - Nothing is claimed as working until it has been verified live.
  - If the key hasn't arrived by 25 Oct, the team escalates in the Qloo
    Discord (#api-help).
- **Scope.** Goal 6 and the weekly digest are the first things cut.

## Left to the builder

- Map library.
- Score weights within the stated rules.
- Business-type → tag sets, discovered with `qloo_find_tags` in Phase 0.
- Prompt wording.
- Container host (Railway or Render).
- Visual design within Spotlight's system.
- Whether evidence fetches use harness workflows or `qloo api`, per call,
  whichever Phase 0 shows is more reliable.

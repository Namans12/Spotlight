# Release Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Release Pulse. For a café or D2C food brand in a chosen
city, it ranks upcoming releases by local audience affinity. For each
release it produces an evidence-backed brief and a tie-in campaign. A
server-side agent that judges can chat with sits on top. All of it is
grounded in Qloo, plus public filming-location data.

**Architecture:** There is one new Node 22 service, `services/pulse/`,
deployed as a container. It holds the Qloo key and the Groq key, talks to
Qloo through the official harness (a long-lived `qloo mcp` child plus
`qloo api` for raw calls), and caches every Qloo result in Postgres. It
serves `/board`, `/brief` (NDJSON stream), `/chat` (SSE) and `/warm`. The
existing Vercel SPA gains `/pulse` routes that call the service over CORS.
A new Python nightly script fills `title_locations` from Wikipedia and
Wikidata.

**Tech Stack:**
- Service: Node 22.19+, TypeScript run by `tsx`, `node:http`,
  `@modelcontextprotocol/sdk`, `@qloo/qloo-harness` ≥0.1.26, `postgres`
  (postgres.js), vitest.
- Frontend: React 18, react-router 6, TanStack Query, Tailwind, `leaflet`
  plus `react-leaflet@4`.
- Pipeline: Python 3.12, `requests`, `psycopg`, pytest.
- LLM: Groq's OpenAI-compatible API.

**Spec:** `docs/superpowers/specs/2026-10-21-release-pulse-design.md`.
Executors read it alongside this plan.

## Plan-level decisions (beyond the spec, made while planning)

- **Pre-warmed cities.** Delhi, Mumbai, Bengaluru, **New York and London**
  are pre-warmed, not just the spec's three. The team added NYC and London
  for US judges, and those are the cities judges will try first.
- **The board never blocks on Qloo.**
  - `/board` returns at once with cards scored from cached evidence.
  - Uncached candidates come back as `pending`, and the service warms them
    in the background.
  - The SPA polls every 5 s until nothing is pending, for at most 2 min.
  - Candidates are capped at the 20 most popular per city before any Qloo
    call.
  - The reason: a cold board is about 40 Qloo calls (a heatmap and place
    tags per candidate). At concurrency 2 and 3–4 s per call, that's over a
    minute.
- **Brief transport is NDJSON**, one `BriefEvent` per line, on a plain GET.
  The chat uses SSE because it's a POST with a conversation body.
- **DTO types live in `shared/types/pulse.ts`.** The service and the SPA
  both import them, following the existing `shared/types/*` pattern.
- **One `package.json` for the service.** Its own deps are kept out of the
  root, so Vercel's install never pulls the harness. The service imports
  root `lib/` and `shared/` by relative path. Root `node_modules` must
  therefore be installed too, and the Dockerfile does both.
- **Map:** `leaflet` and `react-leaflet@4` (React 18 compatible), with OSM
  tiles and attribution.
- **Release window** for the board is release dates from today − 3 to
  today + 14. That captures "Out Now" items released a few days ago, and
  theatrical rows up to 14 days ahead.

## Global Constraints

- Node ≥ 22.19.0 for the service. `@qloo/qloo-harness` ≥ 0.1.26. The
  `QLOO_API_KEY` env var is how the harness gets the credential.
- **Never commit Qloo response data.** Test fixtures are hand-written and
  synthetic. `services/pulse/spike/out/` is gitignored, and so is anything
  with `qloo` in a data filename.
- **Never send personal data to Qloo.** The only location input is a city
  slug from `data/pulse_cities.json`. No GPS, names, emails or ids.
- **Copy rule:** say "Fans of ⟨title⟩ in ⟨City⟩ over-index on ⟨Y⟩". Never
  "your customers", never "you will", never a probability about a person.
- **Evidence chip labels**, exactly: `Qloo · heatmap`, `Qloo · demographics`,
  `Qloo · places`, `Qloo · tags`, `Qloo · artists`, `Qloo · brands`,
  `Wikipedia · Films shot in ⟨City⟩`, `Wikidata · filming location`,
  `Agent suggestion`.
- **Without-Qloo view label**, exactly: `What an LLM guesses with no taste data`.
- **Qloo call limits:** concurrency 2, retry on 429 after 3 s, then 8 s,
  then give up with status `error`.
- **Cache times:** evidence TTL is 3 days. A `not_found` entity resolution
  is retried after 3 days.
- **Score weights:** `local_affinity` 0.55, `business_fit` 0.25,
  `local_hook` 0.10, `freshness` 0.10.
- **Neighbourhood label radius** is 3 km, using nearest centroid.
- **LLM defaults:** `GROQ_BASE_URL` defaults to
  `https://api.groq.com/openai/v1/chat/completions`, and `GROQ_MODEL`
  defaults to `openai/gpt-oss-120b`. At most 2 retries for citation
  validation.
- **Business types:** `cafe` and `d2c_food`.
- **Launch city slugs:** `delhi`, `mumbai`, `bengaluru`, `hyderabad`,
  `chennai`, `pune`, `kolkata`, `goa`, `new-york`, `london`.
- **Hosting rules:**
  - No new files under `api/`, which is at the 12-function Vercel cap.
  - Every new SPA route is public, not behind `RequireAuth`.
- **Before each deploy,** all of these must pass: `npm run typecheck`,
  `npm test`, `npm --prefix services/pulse test`, `pytest`.
- **Git:**
  - Work on branch `feat/release-pulse`.
  - End every commit message with
    `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A release with no Qloo match**, for example a new regional Indian
   title. It must show in the board's "Not enough taste data yet" strip,
   and its brief must render honest empty sections, never a 500. Tests go
   in Tasks 6 and 8.
2. **Qloo errors or 429s partway through a brief.** The failing section
   shows an error state, and every other section still streams. Test goes
   in Task 7.
3. **A city where the heatmap returns zero cells.** The card still ranks,
   with `local_affinity` = 0 and the why-line "no local signal yet". Never
   `NaN`, and never dropped. Test goes in Task 8.
4. **The LLM returns invalid JSON, or cites ids not in the bundle, on every
   attempt.** The campaign still renders, with every clause shown as
   `Agent suggestion`. Never blank. Test goes in Task 9.
5. **A shared brief URL** for a title outside the current window, or an
   unknown city slug.
   - Outside the window: the brief renders anyway, since briefs don't
     require window membership.
   - Unknown city: the service answers 400
     `{"error":"unknown_city"}`, and the SPA shows a picker, not a crash.
   - Tests go in Tasks 7 and 12.

---

## Phase 0 — Live spike (run the moment the Qloo key arrives; Tasks 2–5 proceed without it)

### Task 1: Qloo live spike and recipe lock-in

**Files:**
- Create: `services/pulse/spike/spike.ts`
- Create: `services/pulse/spike/README.md` (how to run it, and the
  go/no-go criteria copied from the spec)
- Modify: `.gitignore` (add `services/pulse/spike/out/`)
- Modify (after the run): `services/pulse/src/qloo/recipes.ts`, created in
  Task 4

**Interfaces:**
- Produces: `services/pulse/spike/out/REPORT.md` and `tools.json`
  (gitignored). These record:
  - the exact harness tool names and argument schemas from `tools/list`,
  - the exact `qloo api` argument forms that worked,
  - the go/no-go results.

- [ ] **Step 1: Write `spike.ts`.** It starts `qloo mcp` over stdio, as in
  the kit's `starter/mcp-client/backend.mjs`, with `env: process.env`, then:
  1. Writes `tools/list` to `out/tools.json`.
  2. Resolves 10 titles currently in `release_items`, read through
     `DATABASE_URL`, by IMDb id through `qloo api`. If that isn't
     supported, falls back to `/search`.
  3. For 2 resolved titles × {Delhi, Mumbai, New York}, calls
     demographics, `where_popular`, `recommend` (`place`), the place tags
     query, `recommend` (`artist`), `recommend` (`brand`) and trends.
  4. Calls `find_tags` for `cafe`, `coffee`, `bakery`, `dessert`, `pizza`
     and `snacks`.
  5. Writes status, result count and the first 3 result names per call to
     `out/REPORT.md`.

  Run it with
  `npx tsx services/pulse/spike/spike.ts`.
- [ ] **Step 2: Run it.** Check `out/REPORT.md` against go/no-go:
  - ≥ 7/10 titles resolve,
  - Delhi place recs return ≥ 5 real food or drink venues,
  - the Delhi heatmap returns cells.

  Record the verdict at the top of `REPORT.md`.
- [ ] **Step 3: On "go":**
  - Update `recipes.ts` (Task 4) so its tool names, argument keys and
    `qloo api` argv forms match `tools.json` exactly.
  - Update the synthetic fixtures in `services/pulse/src/qloo/fixtures.ts`
    so their *shapes*, not their values, match what came back.
  - Run `npm --prefix services/pulse test` and confirm it passes.
- [ ] **Step 4: On "no-go":** apply the spec's Risks fallbacks.
  - Venues section falls back to place tags.
  - Ranking falls back to `signal.location`-biased affinity.
  - Note in `REPORT.md` which fallback is active.
  - Tell the team before continuing to Task 7.
- [ ] **Step 5: Commit** the spike script and README only. `out/` stays
  ignored.

```bash
git add .gitignore services/pulse/spike/spike.ts services/pulse/spike/README.md services/pulse/src/qloo/recipes.ts services/pulse/src/qloo/fixtures.ts
git commit -m "Lock Qloo recipes to what the hackathon key actually returns"
```

---

## Phase 1 — Plumbing

### Task 2: Service scaffold, shared types, CORS and health

**Files:**
- Create: `services/pulse/package.json`
  - `"type": "module"`, `"engines": {"node": ">=22.19.0"}`
  - deps: `@modelcontextprotocol/sdk@1.30.1`, `@qloo/qloo-harness@^0.1.26`
  - devDeps: `vitest@^2.1.9`, `tsx`
  - scripts: `start` (`tsx src/server.ts`), `test` (`vitest run`)
- Create: `services/pulse/vitest.config.ts` (`environment: "node"`)
- Create: `services/pulse/src/config.ts`, `src/http/cors.ts`,
  `src/http/router.ts`, `src/server.ts`
- Create: `shared/types/pulse.ts`
- Create: `tsconfig.service.json`. Copy `tsconfig.server.json`'s
  compilerOptions, with `include`
  `["services/pulse/src", "lib", "shared"]` and `exclude`
  `["**/*.test.ts"]`.
- Modify: `package.json`:
  - append `&& tsc --noEmit -p tsconfig.service.json` to `typecheck`,
  - add the script `"test:pulse": "npm --prefix services/pulse test"`.
- Modify: `vitest.config.ts`. Add `exclude: [...configDefaults.exclude,
  "services/**"]` so the jsdom suite doesn't pick up service tests.
- Test: `services/pulse/src/http/cors.test.ts`,
  `services/pulse/src/config.test.ts`

**Interfaces:**
- Produces, in `shared/types/pulse.ts`:

```ts
export type BusinessType = "cafe" | "d2c_food";
export type EvidenceStatus = "ok" | "empty" | "needs_input" | "partial" | "degraded" | "error";
export type AgeBucket = "24_and_younger" | "25_to_29" | "30_to_34" | "35_to_44" | "45_to_54" | "55_and_older";
export interface Provenance { source: "qloo" | "wikipedia" | "wikidata" | "spotlight"; call: string; params: Record<string, string>; limits: string; }
export interface EvidenceSection<T> { status: EvidenceStatus; data: T | null; provenance: Provenance[]; note?: string; }
export interface DemographicsData { age: Record<AgeBucket, number>; gender: { male: number; female: number }; }
export interface HeatCell { lat: number; lon: number; geohash: string; affinity: number; popularity: number; neighbourhood: string | null; }
export interface Venue { entityId: string; name: string; address: string | null; lat: number | null; lon: number | null; priceLevel: number | null; tags: string[]; affinity: number | null; }
export interface TagAffinity { tagId: string; name: string; affinity: number | null; }
export interface NamedEntity { entityId: string; name: string; affinity: number | null; }
export interface LocalHook { kind: "filmed" | "set"; placeName: string; landmark: string | null; source: "wikidata" | "wikipedia" | "both"; }
export interface CampaignClause { text: string; evidence: string[]; } // [] means "Agent suggestion"
export interface CampaignIdea { kind: "special" | "social" | "event"; title: string; timing: string; clauses: CampaignClause[]; }
export interface Campaign { ideas: CampaignIdea[]; groundedBy: "qloo" | "none"; }
export type BriefSectionKey = "who" | "where" | "venues" | "themes" | "artists" | "brands" | "hook" | "trend" | "campaign";
export interface BriefHeader { tmdbId: number; mediaType: "movie" | "tv"; title: string; posterUrl: string | null; releaseDate: string | null; city: string; cityName: string; businessType: BusinessType; qlooEntityId: string | null; }
export type BriefEvent = { type: "header"; header: BriefHeader } | { type: "section"; key: BriefSectionKey; section: EvidenceSection<unknown> } | { type: "done" };
export interface BoardCard { tmdbId: number; mediaType: "movie" | "tv"; title: string; posterUrl: string | null; releaseDate: string; platform: string | null; kind: string; score: number | null; why: string | null; }
export interface BoardResponse { city: string; cityName: string; businessType: BusinessType; ranked: BoardCard[]; pending: BoardCard[]; unresolved: BoardCard[]; }
export type AgentEvent = { type: "tool"; name: string; args: string } | { type: "tool_result"; name: string; summary: string } | { type: "message"; text: string } | { type: "error"; text: string } | { type: "done" };
```

- Produces, in `services/pulse/src`:
  - `config.ts`: `loadConfig(env: NodeJS.ProcessEnv): PulseConfig`, where
    `PulseConfig = { port: number; allowedOrigins: string[];
    databaseUrl: string; qlooFixtures: boolean; groqApiKey: string | null;
    groqBaseUrl: string; groqModel: string; warmSecret: string | null;
    sessionDailyChat: number; globalDailyLlm: number }`.
  - `http/cors.ts`: `corsHeaders(origin: string | undefined, allowed:
    string[]): Record<string, string>`.
  - `http/router.ts`: `type Handler = (req: IncomingMessage, res:
    ServerResponse, url: URL) => Promise<void>` and
    `createRouter(routes: Record<string, Handler>): Handler`. Keys are
    `"GET /board"` style. An unknown key gives a JSON 404
    `{"error":"not_found"}`.
  - `server.ts`: `GET /healthz` returns `{"ok":true}`.

- [ ] **Step 1: Write failing tests.**

```ts
// cors.test.ts
it("echoes an allowlisted origin", () => {
  expect(corsHeaders("https://pulse.example", ["https://pulse.example"])["Access-Control-Allow-Origin"]).toBe("https://pulse.example");
});
it("never sends a wildcard or a foreign origin", () => {
  expect(corsHeaders("https://evil.example", ["https://pulse.example"])["Access-Control-Allow-Origin"]).toBeUndefined();
});
// config.test.ts
it("defaults Groq to the spec's endpoint and model", () => {
  const c = loadConfig({ DATABASE_URL: "postgres://x", PULSE_ALLOWED_ORIGINS: "https://a,https://b" });
  expect(c.groqBaseUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
  expect(c.groqModel).toBe("openai/gpt-oss-120b");
  expect(c.allowedOrigins).toEqual(["https://a", "https://b"]);
});
it("throws when DATABASE_URL is missing", () => {
  expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
});
```

- [ ] **Step 2:** Run `npm --prefix services/pulse install && npm
  --prefix services/pulse test`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement `config.ts`, `cors.ts`, `router.ts` and
  `server.ts` per the signatures above. `server.ts` also answers
  `OPTIONS` preflight, using `corsHeaders`.
- [ ] **Step 4:** Run `npm --prefix services/pulse test`. Expected: PASS.
  Then run `npm run typecheck` and `npm test`. Expected: both still PASS.
- [ ] **Step 5: Commit.**

```bash
git add services/pulse shared/types/pulse.ts tsconfig.service.json package.json vitest.config.ts
git commit -m "Scaffold the Pulse service: config, CORS allowlist, health, shared DTOs"
```

### Task 3: Schema and the city registry

**Files:**
- Create: `migrations/0016_release_pulse.sql`
- Create: `data/pulse_cities.json`
- Create: `services/pulse/src/cities.ts`
- Test: `services/pulse/src/cities.test.ts`

**Interfaces:**
- Produces the tables, all created with `IF NOT EXISTS` inside one
  `BEGIN/COMMIT`:
  - `qloo_entities(tmdb_id BIGINT, media_type TEXT CHECK IN ('movie','tv'), imdb_id TEXT, qloo_entity_id TEXT, method TEXT CHECK IN ('imdb','search'), not_found BOOLEAN NOT NULL DEFAULT false, resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tmdb_id, media_type))`
  - `qloo_evidence(entity_id TEXT, city_slug TEXT NOT NULL DEFAULT '', kind TEXT, params JSONB, status TEXT, payload JSONB, fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (entity_id, city_slug, kind))`. `kind` is one of `demographics`, `heatmap`, `places`, `place_tags`, `artists`, `brands`, `trends`. `city_slug` is `''` for city-independent kinds.
  - `places(qid TEXT PRIMARY KEY, city_slug TEXT NOT NULL, name TEXT NOT NULL)`, which maps every QID (including aliases such as New Delhi Q987) to a city slug.
  - `title_locations(tmdb_id BIGINT, media_type TEXT, city_slug TEXT, kind TEXT CHECK IN ('filmed','set'), source TEXT CHECK IN ('wikidata','wikipedia','both'), landmark_label TEXT, landmark_lat DOUBLE PRECISION, landmark_lon DOUBLE PRECISION, PRIMARY KEY (tmdb_id, media_type, city_slug, kind))`, plus an index on `(city_slug, kind)`.
  - `neighbourhoods(city_slug TEXT, name TEXT, lat DOUBLE PRECISION, lon DOUBLE PRECISION, PRIMARY KEY (city_slug, name))`
  - `pulse_usage(session_hash TEXT, day DATE, kind TEXT CHECK IN ('chat','campaign'), count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (session_hash, day, kind))`. The global total is the sum over the day.
- Produces `data/pulse_cities.json`, an array of
  `{ slug, name, country, lat, lon, qids: string[], qlooLocationQuery: string, wikipedia: { filmed: string[], set: string[] }, prewarm: boolean }`.
  - QIDs: delhi `["Q1353","Q987"]`, mumbai `["Q1156"]`, bengaluru
    `["Q1355"]`, hyderabad `["Q1361"]`, chennai `["Q1352"]`, pune
    `["Q1538"]`, kolkata `["Q1348"]`, goa `["Q1171"]`, new-york `["Q60"]`,
    london `["Q84"]`.
  - `prewarm` is true for delhi, mumbai, bengaluru, new-york and london.
  - Wikipedia category names are exact titles without the `Category:`
    prefix. Examples: `Films_shot_in_Delhi`, `Films_set_in_Delhi`,
    `Television_shows_set_in_Delhi`. Task 5 verifies every listed name
    exists.
- Produces, in `services/pulse/src/cities.ts`:
  - `interface City { slug; name; country; lat; lon; qlooLocationQuery; prewarm }`
  - `getCity(slug: string): City | null`
  - `allCities(): City[]`

- [ ] **Step 1: Write failing tests.**

```ts
it("knows all ten launch cities", () => {
  expect(allCities().map(c => c.slug).sort()).toEqual(["bengaluru","chennai","delhi","goa","hyderabad","kolkata","london","mumbai","new-york","pune"]);
});
it("pre-warms exactly the five demo cities", () => {
  expect(allCities().filter(c => c.prewarm).map(c => c.slug).sort()).toEqual(["bengaluru","delhi","london","mumbai","new-york"]);
});
it("returns null for an unknown slug", () => { expect(getCity("atlantis")).toBeNull(); });
```

- [ ] **Step 2:** Run `npm --prefix services/pulse test -- cities`.
  Expected: FAIL.
- [ ] **Step 3:** Write the JSON, `cities.ts` (it reads
  `../../../data/pulse_cities.json` through `fs` at module load), and the
  migration.
- [ ] **Step 4:** Run the tests. Expected: PASS. Apply the migration to
  the **hackathon** Neon branch:
  `psql "$PULSE_DATABASE_URL" -f migrations/0016_release_pulse.sql`.
  Expected: `COMMIT`. Then run `\dt qloo_*` and expect both tables listed.
- [ ] **Step 5:** Add `0016_release_pulse.sql` to the README migration
  list (Setup step 5). Commit.

```bash
git add migrations/0016_release_pulse.sql data/pulse_cities.json services/pulse/src/cities.ts services/pulse/src/cities.test.ts README.md
git commit -m "Add the Pulse schema and the launch-city registry"
```

### Task 4: Qloo adapter (harness client, fixtures, limiter)

**Files:**
- Create: `services/pulse/src/qloo/client.ts` (interface and domain
  mapping)
- Create: `services/pulse/src/qloo/recipes.ts`. This is the *only* place
  holding tool names, argument keys and `qloo api` argv.
- Create: `services/pulse/src/qloo/harness.ts`
- Create: `services/pulse/src/qloo/fixtures.ts` (synthetic data)
- Create: `services/pulse/src/qloo/limiter.ts`
- Test: `services/pulse/src/qloo/limiter.test.ts`,
  `services/pulse/src/qloo/client.test.ts`

**Interfaces:**
- Consumes: `City` (Task 3) and the types in `shared/types/pulse.ts`
  (Task 2).
- Produces:

```ts
export interface QlooEntityRef { entityId: string; name: string; type: "movie" | "tv_show"; year: number | null; }
export interface QlooClient {
  entityByImdb(imdbId: string): Promise<QlooEntityRef | null>;
  searchTitles(title: string, type: "movie" | "tv_show"): Promise<QlooEntityRef[]>;
  demographics(entityId: string): Promise<EvidenceSection<DemographicsData>>;
  heatmap(entityId: string, city: City): Promise<EvidenceSection<Omit<HeatCell, "neighbourhood">[]>>;
  places(entityId: string, city: City, includeTagIds: string[]): Promise<EvidenceSection<Venue[]>>;
  placeTags(entityId: string, city: City): Promise<EvidenceSection<TagAffinity[]>>;
  artists(entityId: string): Promise<EvidenceSection<NamedEntity[]>>;
  brands(entityId: string): Promise<EvidenceSection<NamedEntity[]>>;
  trends(entityId: string): Promise<EvidenceSection<{ date: string; percentile: number }[]>>;
  findTags(query: string, parentType: "place" | "brand"): Promise<{ tagId: string; name: string }[]>;
  listTools(): Promise<{ name: string; description: string; inputSchema: unknown }[]>; // for the agent
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;            // for the agent
}
export function createQlooClient(cfg: PulseConfig): QlooClient; // fixtures when cfg.qlooFixtures
export function mapHarnessResult<T>(raw: unknown, call: string, params: Record<string, string>, pick: (results: unknown[]) => T): EvidenceSection<T>;
// limiter.ts
export function createLimiter(opts: { concurrency: number; backoffMs: number[]; sleep?: (ms: number) => Promise<void> }): <T>(fn: () => Promise<T>) => Promise<T>;
export class RateLimitedError extends Error {}
```

- [ ] **Step 1: Write failing tests.**

```ts
// limiter.test.ts
it("never runs more than 2 calls at once", async () => {
  const run = createLimiter({ concurrency: 2, backoffMs: [3000, 8000], sleep: async () => {} });
  let live = 0, peak = 0;
  await Promise.all(Array.from({ length: 6 }, () => run(async () => { live++; peak = Math.max(peak, live); await Promise.resolve(); live--; })));
  expect(peak).toBe(2);
});
it("retries a 429 after 3s then 8s, then rethrows", async () => {
  const waits: number[] = [];
  const run = createLimiter({ concurrency: 2, backoffMs: [3000, 8000], sleep: async ms => { waits.push(ms); } });
  await expect(run(async () => { throw new RateLimitedError("429"); })).rejects.toBeInstanceOf(RateLimitedError);
  expect(waits).toEqual([3000, 8000]);
});
// client.test.ts
it("maps a harness ok result into an EvidenceSection with provenance", () => {
  const s = mapHarnessResult({ status: "ok", results: [{ name: "A" }], result_count: 1 }, "recommend", { target_type: "place" }, r => r.length);
  expect(s).toEqual({ status: "ok", data: 1, provenance: [{ source: "qloo", call: "recommend", params: { target_type: "place" }, limits: expect.any(String) }] });
});
it("passes empty and error through without inventing data", () => {
  expect(mapHarnessResult({ status: "empty", results: [] }, "recommend", {}, r => r).data).toBeNull();
  expect(mapHarnessResult({ status: "error", error: { code: "x", retryable: false } }, "recommend", {}, r => r).status).toBe("error");
});
it("fixture client returns shaped, synthetic data for every method", async () => {
  const q = createQlooClient({ ...baseConfig, qlooFixtures: true });
  expect((await q.heatmap("fx-1", delhi)).status).toBe("ok");
  expect((await q.demographics("fx-1")).data?.age["25_to_29"]).toEqual(expect.any(Number));
});
```

- [ ] **Step 2:** Run `npm --prefix services/pulse test -- qloo`.
  Expected: FAIL.
- [ ] **Step 3:** Implement.
  - **Harness transport.** `harness.ts` starts one
    `StdioClientTransport({ command: <service>/node_modules/.bin/qloo,
    args: ["mcp"], env: process.env })` lazily, and restarts it once if it
    dies.
  - **Calls.** Every method goes through the limiter
    (`concurrency: 2, backoffMs: [3000, 8000]`).
  - **429 detection.** A harness error carrying `error.retryable === true`
    together with a rate-limit code throws `RateLimitedError` inside the
    limiter.
  - **`entityByImdb` and `heatmap`.** If the tool list lacks these, use
    `recipes.ts`' `qloo api` argv via `execFile`, parsing `--json` stdout.
  - **`limits` strings** are fixed per call and come from the spec. For
    example, demographics uses `"Global audience skew relative to
    average, not specific to this city; not a percentage."`
  - **Fixture values** are invented and obviously synthetic: names such as
    `"Fixture Café 1"` and ids prefixed `fx-`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add services/pulse/src/qloo
git commit -m "Qloo adapter: harness client, synthetic fixtures, 2-wide limiter with 429 backoff"
```

### Task 5: Filming-location and neighbourhood pipeline (Python)

**Files:**
- Create: `scripts/sync_title_locations.py`
- Create: `tests/test_sync_title_locations.py`
- Modify: `.github/workflows/ott-radar-nightly.yml`. Add a step after the
  watch-order syncs that runs `python scripts/sync_title_locations.py`
  with `DATABASE_URL`.

**Interfaces:**
- Consumes: `data/pulse_cities.json` (Task 3), and the `title_locations`,
  `places` and `neighbourhoods` tables (Task 3).
- Reuses: `run_query`, the `USER_AGENT` constant and the backoff pattern
  from `scripts/sync_relations_wikidata.py`. Import them, don't copy them.
- Produces:
  - CLI modes: `--check-categories` (verifies every listed category exists
    and prints its member count), `--neighbourhoods` (refills the
    `neighbourhoods` table), `--dry-run`, and the default (sync).
  - Pure functions:
    - `merge_rows(wikidata: list[LocRow], wikipedia: list[LocRow]) -> list[LocRow]`
    - `LocRow = (tmdb_id, media_type, city_slug, kind, source, landmark_label, lat, lon)`
    - `drop_suspect(rows) -> rows`, which removes the Ooty bulk-import
      place QID.

- [ ] **Step 1: Write failing tests.** Use a fake cursor, as in
  `tests/test_per_user_alerts.py`.

```python
def test_same_title_from_both_sources_becomes_both():
    wd = [(1, "movie", "delhi", "filmed", "wikidata", "Chandni Chowk", 28.65, 77.23)]
    wp = [(1, "movie", "delhi", "filmed", "wikipedia", None, None, None)]
    assert merge_rows(wd, wp) == [(1, "movie", "delhi", "filmed", "both", "Chandni Chowk", 28.65, 77.23)]

def test_new_delhi_rolls_up_to_delhi():
    assert city_for_qid("Q987") == "delhi"

def test_rows_without_tmdb_id_are_dropped():
    assert to_rows([{"qid": "Q1", "tmdb_movie": None, "tmdb_tv": None}], "delhi", "filmed", "wikipedia") == []

def test_ooty_bulk_import_is_ignored():
    rows = [(5, "movie", "ooty", "filmed", "wikidata", None, None, None)]
    assert drop_suspect(rows) == []

def test_subcategories_are_not_recursed():
    # categorymembers returns ns=14 (subcategory) and ns=0 (article); only ns=0 survive
    assert article_titles([{"ns": 14, "title": "Category:Indian Army in films"}, {"ns": 0, "title": "Rang De Basanti"}]) == ["Rang De Basanti"]
```

- [ ] **Step 2:** Run `pytest tests/test_sync_title_locations.py -v`.
  Expected: FAIL.
- [ ] **Step 3:** Implement each source as follows.
  - **Wikipedia:**
    - `action=query&generator=categorymembers&gcmtitle=Category:<name>&gcmlimit=500&gcmnamespace=0&prop=pageprops&ppprop=wikibase_item`,
      following `continue`.
    - QIDs → TMDB ids via SPARQL `VALUES` over P4947/P4983, in batches of
      ≤ 200.
  - **Wikidata:** P915 and P840 for each city's QIDs, plus P625 on the
    filming-location item for landmark coordinates. Page at ≤ 15k rows.
  - **Neighbourhoods:** items with `wdt:P31/wdt:P279* wd:Q123705`
    (neighbourhood) and `wdt:P131+ <city qid>`, with P625. Insert name, lat
    and lon. Print them for a hand check.
  - **Writes:** delete the city's rows, then insert, in one transaction per
    city.
- [ ] **Step 4:** Run `pytest`. Expected: PASS. Then run
  `python scripts/sync_title_locations.py --check-categories`.
  - Expected: a count printed for every category, with no `MISSING`.
  - Fix any `MISSING` name in `data/pulse_cities.json` and re-run.
  - Then run `--neighbourhoods` and the sync against the hackathon DB.
    Expect Delhi `filmed` ≥ 200 rows.
- [ ] **Step 5: Commit.**

```bash
git add scripts/sync_title_locations.py tests/test_sync_title_locations.py .github/workflows/ott-radar-nightly.yml data/pulse_cities.json
git commit -m "Fill title_locations from Wikipedia categories and Wikidata, nightly"
```

### Task 6: Entity resolution (TMDB → IMDb → Qloo)

**Files:**
- Create: `services/pulse/src/db/pool.ts`, which exports
  `getPool(cfg): postgres.Sql` with `max: 5`.
- Create: `services/pulse/src/db/entities.ts`
- Create: `services/pulse/src/resolve.ts`
- Test: `services/pulse/src/resolve.test.ts`

**Interfaces:**
- Consumes: `QlooClient.entityByImdb` and `searchTitles` (Task 4), and
  `resolveOmdbLookup(mediaType, tmdbId)` from `lib/omdb.ts`. That needs
  `TMDB_API_KEY` in the service env.
- Produces:

```ts
export interface TitleKey { tmdbId: number; mediaType: "movie" | "tv"; }
export type Resolution = { entityId: string; method: "imdb" | "search" } | { entityId: null; reason: "not_in_qloo" | "no_imdb_and_no_match" };
export function pickSearchMatch(cands: QlooEntityRef[], want: { year: number | null; type: "movie" | "tv_show" }): QlooEntityRef | null;
export function notFoundIsStale(resolvedAt: Date, now: Date): boolean; // > 3 days
export async function resolveTitle(sql: EntitySql, qloo: QlooClient, key: TitleKey, now?: Date): Promise<Resolution>;
```

  `resolveTitle` works in this order:
  1. Cache hit: return it.
  2. A cached `not_found` that is not stale: return `not_in_qloo`.
  3. IMDb id from `title_ratings`, else `resolveOmdbLookup`.
  4. `entityByImdb`.
  5. `searchTitles` plus `pickSearchMatch`.
  6. Upsert the outcome.

- [ ] **Step 1: Write failing tests.** Use a fake `sql` in the style of
  `lib/relationsDb.test.ts`.

```ts
it("accepts a search match only within ±1 year and the same type", () => {
  const c = [{ entityId: "a", name: "X", type: "movie", year: 2019 }, { entityId: "b", name: "X", type: "tv_show", year: 2024 }];
  expect(pickSearchMatch(c, { year: 2024, type: "tv_show" })?.entityId).toBe("b");
  expect(pickSearchMatch(c, { year: 2022, type: "movie" })).toBeNull();
});
it("does not re-ask Qloo for a fresh not_found", async () => {
  const qloo = { entityByImdb: vi.fn(), searchTitles: vi.fn() } as any;
  const sql = fakeSql({ qloo_entities: [{ not_found: true, resolved_at: new Date("2026-10-20") }] });
  expect(await resolveTitle(sql, qloo, { tmdbId: 1, mediaType: "movie" }, new Date("2026-10-21"))).toEqual({ entityId: null, reason: "not_in_qloo" });
  expect(qloo.entityByImdb).not.toHaveBeenCalled();
});
it("retries a not_found older than 3 days", () => {
  expect(notFoundIsStale(new Date("2026-10-17"), new Date("2026-10-21"))).toBe(true);
});
it("records a miss as not_found instead of throwing (Review Focus 1)", async () => {
  const qloo = { entityByImdb: vi.fn().mockResolvedValue(null), searchTitles: vi.fn().mockResolvedValue([]) } as any;
  const { sql, upserts } = fakeSqlCapturing({ title_ratings: [{ imdb_id: "tt1" }] });
  const r = await resolveTitle(sql, qloo, { tmdbId: 9, mediaType: "movie" });
  expect(r.entityId).toBeNull();
  expect(upserts[0]).toMatchObject({ not_found: true });
});
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `pool.ts`, `entities.ts`
  (`getCachedEntity`, `getImdbId`, `upsertEntity`) and `resolve.ts`.
  `EntitySql` is the narrow tagged-template type, defined the same way as
  `FakeSql` in `lib/relationsDb.test.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add services/pulse/src/db services/pulse/src/resolve.ts services/pulse/src/resolve.test.ts
git commit -m "Resolve Spotlight titles to Qloo entities via IMDb, cached with a 3-day miss retry"
```

---

## Phase 2 — Product

### Task 7: Cached evidence and the streamed brief

**Files:**
- Create: `services/pulse/src/db/evidence.ts`, `src/db/locations.ts`
- Create: `services/pulse/src/geo.ts`, `src/businessTypes.ts`,
  `src/evidence.ts`, `src/brief.ts`, `src/http/ndjson.ts`
- Modify: `services/pulse/src/server.ts` (route `GET /brief`)
- Test: `services/pulse/src/geo.test.ts`,
  `services/pulse/src/evidence.test.ts`, `services/pulse/src/brief.test.ts`

**Interfaces:**
- Consumes: `resolveTitle` (Task 6), `QlooClient` (Task 4), `getCity`
  (Task 3), and the `title_locations`, `neighbourhoods` and
  `qloo_evidence` tables.
- Produces:

```ts
// geo.ts
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number;
export function labelCell(cell: { lat: number; lon: number }, hoods: { name: string; lat: number; lon: number }[], maxKm = 3): string | null;
// businessTypes.ts
export const BUSINESS_TYPES: Record<BusinessType, { label: string; sections: BriefSectionKey[]; placeTagQueries: string[]; venueBlocklist: string[] }>;
//   cafe:     sections who, where, venues, themes, artists, hook, trend, campaign; placeTagQueries ["cafe","coffee","bakery","dessert"]
//   d2c_food: sections who, where, themes, brands, artists, hook, trend, campaign; placeTagQueries ["snacks","dessert","beverage","street food"]
//   venueBlocklist for both: ["hotel","banquet","lodging","resort","motel"]
export function filterVenues(venues: Venue[], blocklist: string[]): Venue[]; // drops a venue if any tag or its name contains a blocklisted word
// evidence.ts
export type EvidenceKind = "demographics" | "heatmap" | "places" | "place_tags" | "artists" | "brands" | "trends";
export async function getEvidence<T>(sql, kind: EvidenceKind, entityId: string, city: City | null, fetch: () => Promise<EvidenceSection<T>>, now?: Date): Promise<EvidenceSection<T>>;
//   reads qloo_evidence (city_slug '' when city is null); uses it if fetched_at within 3 days AND status != 'error'; otherwise fetches and upserts.
export async function peekEvidence<T>(sql, kind: EvidenceKind, entityId: string, city: City | null, now?: Date): Promise<EvidenceSection<T> | null>;
//   the same freshness rule, cache read only; never calls Qloo. Used by the board (Task 8).
// brief.ts
export async function* streamBrief(deps: BriefDeps, req: { city: City; businessType: BusinessType; key: TitleKey }): AsyncGenerator<BriefEvent>;
//   yields header first, then each section in BUSINESS_TYPES[type].sections order AS EACH COMPLETES (sections run concurrently, the limiter bounds Qloo), then {type:"done"}.
//   "campaign" is yielded last; it is produced by Task 9's draftCampaign, injected via deps.draftCampaign.
```

  Route `GET /brief?city=&type=&mediaType=&tmdbId=` behaves as follows:
  - Content type is `application/x-ndjson`.
  - An unknown city gives 400 `{"error":"unknown_city"}`.
  - An unknown type gives 400 `{"error":"unknown_business_type"}`.
  - The header's title, poster and date come from `release_items` or
    `calendar_entries`, else from TMDB detail through `lib/tmdbProxy.ts`.

- [ ] **Step 1: Write failing tests.**

```ts
// geo.test.ts
it("labels a cell with the nearest neighbourhood within 3 km", () => {
  const hoods = [{ name: "Hauz Khas", lat: 28.5494, lon: 77.2001 }, { name: "Karol Bagh", lat: 28.6519, lon: 77.1909 }];
  expect(labelCell({ lat: 28.55, lon: 77.205 }, hoods)).toBe("Hauz Khas");
  expect(labelCell({ lat: 28.9, lon: 77.6 }, hoods)).toBeNull();
});
// evidence.test.ts
it("serves cached evidence younger than 3 days without calling Qloo", async () => { /* fetch spy not called */ });
it("refetches cached evidence whose status was error", async () => { /* fetch spy called once */ });
it("stores city-independent kinds under city_slug ''", async () => { /* captured upsert has city_slug '' for demographics */ });
// brief.test.ts
it("streams header first and done last, with every cafe section in between", async () => {
  const keys = (await collect(streamBrief(fixtureDeps(), { city: delhi, businessType: "cafe", key: { tmdbId: 1, mediaType: "movie" } })))
    .map(e => e.type === "section" ? e.key : e.type);
  expect(keys[0]).toBe("header"); expect(keys.at(-1)).toBe("done");
  expect(new Set(keys)).toEqual(new Set(["header","who","where","venues","themes","artists","hook","trend","campaign","done"]));
});
it("a failing section does not stop the others (Review Focus 2)", async () => {
  const deps = fixtureDeps({ heatmap: () => Promise.reject(new RateLimitedError("429")) });
  const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: { tmdbId: 1, mediaType: "movie" } }));
  expect(sectionOf(events, "where").status).toBe("error");
  expect(sectionOf(events, "who").status).toBe("ok");
});
it("an unresolved title streams honest empty sections, never throws (Review Focus 1)", async () => {
  const events = await collect(streamBrief(fixtureDeps({ resolve: async () => ({ entityId: null, reason: "not_in_qloo" }) }), { city: delhi, businessType: "cafe", key: { tmdbId: 2, mediaType: "movie" } }));
  expect(sectionOf(events, "who")).toMatchObject({ status: "empty", note: expect.stringContaining("Qloo") });
  expect(sectionOf(events, "hook").status).not.toBe("error"); // hook needs no Qloo
});
it("drops hotels and banquet halls from cafe venues", () => {
  expect(filterVenues([{ name: "Grand Banquet", tags: [] } as any, { name: "Blue Tokai", tags: ["Coffee"] } as any], BUSINESS_TYPES.cafe.venueBlocklist).map(v => v.name)).toEqual(["Blue Tokai"]);
});
it("GET /brief with an unknown city answers 400 unknown_city (Review Focus 5)", async () => { /* invoke router */ });
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - **Labelling:** `where` cells get `neighbourhood` from `labelCell`.
  - **Tag ids:** `venues` uses tag ids from
    `qloo.findTags(q, "place")` for each `placeTagQueries` entry,
    memoised in-process.
  - **Hook:** `hook` reads `title_locations` for the city:
    - status `ok` with `LocalHook[]` when rows exist,
    - `empty` with the note `"No record of this title being shot or set in <City>."`
      when none do.
  - **Provenance for `hook`:** source `wikipedia` / `wikidata`, as stored.
  - **Trend:** `trend` passes through `empty` untouched.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then, with
  `QLOO_FIXTURES=1`, run `npm --prefix services/pulse start` and
  `curl -N "localhost:8787/brief?city=delhi&type=cafe&mediaType=movie&tmdbId=<a real release_items id>"`.
  Expected: NDJSON lines, header first and `done` last.
- [ ] **Step 5: Commit.**

```bash
git add services/pulse/src
git commit -m "Stream release briefs section by section from cached Qloo evidence"
```

### Task 8: Board candidates, scoring and background warming

**Files:**
- Create: `services/pulse/src/board.ts`, `src/score.ts`, `src/warm.ts`
- Modify: `services/pulse/src/server.ts`. Add `GET /board` and
  `POST /warm`. `/warm` requires the header
  `Authorization: Bearer <PULSE_WARM_SECRET>` and answers 401 otherwise.
- Modify: `.github/workflows/ott-radar.yml`. After the releasebot step,
  add a `curl -fsS -X POST -H "Authorization: Bearer
  ${{ secrets.PULSE_WARM_SECRET }}" "${{ vars.PULSE_URL }}/warm"`. This
  step uses `continue-on-error: true`, so a sleeping container never fails
  the release run.
- Test: `services/pulse/src/score.test.ts`,
  `services/pulse/src/board.test.ts`

**Interfaces:**
- Consumes: `getCalendarMonth(sql, "YYYY-MM")` from `lib/calendarDb.ts`
  (it already merges `release_items` with `calendar_entries` and derives
  `kind`), plus `resolveTitle`, `getEvidence` and `BUSINESS_TYPES`.
- Produces:

```ts
export interface Candidate { card: Omit<BoardCard, "score" | "why">; popularity: number; entityId: string | null; heat: number[] | null; placeTagNames: string[] | null; hook: LocalHook | null; daysAhead: number; }
export interface Scored { candidate: Candidate; score: number; parts: { local_affinity: number; business_fit: number; local_hook: number; freshness: number }; }
export function freshness(daysAhead: number): number;       // 1 for -3..7, 0.5 for 8..14
export function businessFit(tagNames: string[], type: BusinessType): number; // share of top-10 tag names matching any BUSINESS_TYPES[type].placeTagQueries word, 0..1
export function scoreCandidates(cands: Candidate[], type: BusinessType): Scored[]; // ranked desc
export function whyLine(s: Scored, rank: number, total: number, cityName: string, topHood: string | null): string;
export async function listCandidates(sql, city: City, today: Date): Promise<Candidate[]>; // window today-3..today+14, tmdbId != null, deduped, top 20 by popularity
export async function buildBoard(deps, city: City, type: BusinessType, today?: Date): Promise<BoardResponse>; // never awaits an uncached Qloo call; enqueues warm(...) for pending ones
export async function warmCity(deps, city: City, type: BusinessType): Promise<{ warmed: number; failed: number }>;
```

  The scoring algorithm has three parts:
  1. **`local_affinity`** is the mean of the top 5 heatmap cell
     affinities. It is min-max normalised across the scored candidates
     *of this city only*. If every candidate has the same value, or there
     is only one, each gets 1. A candidate with no cells gets 0.
  2. **`score`** = 0.55·local_affinity + 0.25·business_fit + 0.10·hook +
     0.10·freshness.
  3. **The why-line** opens with `#<rank> of <total> for <City> audiences`,
     followed by the two largest weighted parts, as words:
     - local_affinity → `strongest around <topHood>`, or
       `no local signal yet` when it is 0,
     - business_fit → `fans over-index on café-style spots` (cafe) or
       `fans over-index on snack & dessert brands` (d2c_food),
     - hook → `shot in <landmark ?? City>` or `set in <City>`,
     - freshness → `out this week`.

  Parts are joined with ` · `.

- [ ] **Step 1: Write failing tests.**

```ts
it("weights parts 0.55/0.25/0.10/0.10", () => {
  const [a] = scoreCandidates([cand({ heat: [0.9], placeTagNames: [], hook: null, daysAhead: 20 }), cand({ heat: [0.1], placeTagNames: [], hook: null, daysAhead: 20 })], "cafe");
  expect(a.score).toBeCloseTo(0.55);
});
it("a city with no heatmap cells still ranks every card, without NaN (Review Focus 3)", () => {
  const s = scoreCandidates([cand({ heat: [] }), cand({ heat: null })], "cafe");
  expect(s).toHaveLength(2);
  s.forEach(x => expect(Number.isFinite(x.score)).toBe(true));
  expect(whyLine(s[0], 1, 2, "Goa", null)).toContain("no local signal yet");
});
it("why-line names rank within the city and the two biggest contributors", () => {
  const s = scoreCandidates([cand({ heat: [0.9], hook: { kind: "filmed", placeName: "Delhi", landmark: "Chandni Chowk", source: "both" }, daysAhead: 2 }), cand({ heat: [0.2] })], "cafe");
  expect(whyLine(s[0], 1, 2, "Delhi", "Hauz Khas")).toBe("#1 of 2 for Delhi audiences · strongest around Hauz Khas · shot in Chandni Chowk");
});
it("unresolved titles go to the unresolved strip, never interleaved (Review Focus 1)", async () => {
  const board = await buildBoard(depsWith({ resolved: [true, false] }), delhi, "cafe", new Date("2026-10-21"));
  expect(board.unresolved).toHaveLength(1);
  expect(board.ranked.every(c => c.score !== null)).toBe(true);
});
it("uncached candidates come back pending and are queued for warming", async () => { /* warm spy called; board.pending.length > 0 */ });
it("POST /warm without the bearer secret is 401", async () => { /* router */ });
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - `buildBoard` reads cached `heatmap` and `place_tags` evidence only,
    through `peekEvidence`. `warmCity` and the background warm use
    `getEvidence`.
  - `warm.ts` keeps an in-process `Set` of in-flight `(city, entity)`
    pairs, so polling never double-enqueues.
  - `POST /warm` iterates the `prewarm` cities × both business types.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then, with fixtures on,
  `curl "localhost:8787/board?city=delhi&type=cafe"` should return valid
  `BoardResponse` JSON within 1 s.
- [ ] **Step 5: Commit.**

```bash
git add services/pulse/src .github/workflows/ott-radar.yml
git commit -m "Rank upcoming releases by local affinity; warm in the background and on Wed/Fri"
```

---

## Phase 3 — Agent

### Task 9: Groq client, the campaign writer and the without-Qloo guess

**Files:**
- Create: `services/pulse/src/llm/client.ts`, `src/campaign.ts`,
  `src/db/usage.ts`, `src/usage.ts`
- Modify: `services/pulse/src/brief.ts`. Wire the real `draftCampaign`
  into `BriefDeps`.
- Modify: `services/pulse/src/server.ts`. Add
  `GET /guess?city=&type=&mediaType=&tmdbId=`, which returns a
  `Campaign` with `groundedBy: "none"`.
- Test: `services/pulse/src/campaign.test.ts`,
  `services/pulse/src/usage.test.ts`

**Interfaces:**
- Consumes: the `EvidenceSection`s gathered in `streamBrief` (Task 7).
- Produces:

```ts
// llm/client.ts
export interface ChatMessage { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; }
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface ToolSpec { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface LlmClient { chat(messages: ChatMessage[], opts?: { tools?: ToolSpec[]; json?: boolean }): Promise<ChatMessage>; }
export function createGroqClient(cfg: PulseConfig, fetchImpl?: typeof fetch): LlmClient; // json:true sends response_format {type:"json_object"}; on a 400 mentioning response_format, retries once without it
// campaign.ts
export interface EvidenceFact { id: string; label: string; fact: string; } // ids: "demo:<bucket>", "heat:<i>", "venue:<entityId>", "tag:<tagId>", "artist:<id>", "brand:<id>", "hook:<kind>"
export function buildBundle(sections: Partial<Record<BriefSectionKey, EvidenceSection<unknown>>>, cityName: string, title: string): EvidenceFact[];
export function validateCampaign(raw: unknown, bundleIds: Set<string>): { campaign: Campaign | null; invalidIds: string[]; parseError: string | null };
export function downgradeUncited(c: Campaign, bundleIds: Set<string>): Campaign; // any clause citing an id not in the bundle → evidence []
export async function draftCampaign(llm: LlmClient, bundle: EvidenceFact[], ctx: { title: string; cityName: string; businessType: BusinessType; releaseDate: string | null }): Promise<Campaign>; // ≤ 2 retries with feedback
export async function draftWithoutQloo(llm: LlmClient, ctx: { title: string; cityName: string; businessType: BusinessType; releaseDate: string | null }): Promise<Campaign>; // every clause evidence []
// usage.ts
export function capDecision(counts: { session: number; global: number }, caps: { session: number; global: number }): { allowed: true } | { allowed: false; reason: "session_cap" | "global_cap" };
export async function takeUsage(sql, sessionHash: string, kind: "chat" | "campaign", caps): Promise<ReturnType<typeof capDecision>>;
```

  The campaign prompt must require all of the following:
  - exactly 3 ideas, one each of `special`, `social` and `event`,
  - every factual clause citing ids from the bundle,
  - the copy rule from Global Constraints, verbatim,
  - JSON matching `Campaign` minus `groundedBy`.

  A campaign that hits a usage cap returns a `Campaign` with `ideas: []`.
  The brief section then gets status `degraded` and the note
  `"Daily AI limit reached — the evidence above is unaffected."`

- [ ] **Step 1: Write failing tests.**

```ts
it("validator rejects ids not in the bundle and reports them", () => {
  const r = validateCampaign({ ideas: [{ kind: "special", title: "t", timing: "Fri", clauses: [{ text: "x", evidence: ["venue:zzz"] }] }] }, new Set(["venue:a"]));
  expect(r.invalidIds).toEqual(["venue:zzz"]);
});
it("retries at most twice, feeding back the invalid ids", async () => {
  const llm = fakeLlm([badJson, citesUnknown, citesUnknown]);
  await draftCampaign(llm, bundle, ctx);
  expect(llm.calls).toHaveLength(3);
  expect(llm.calls[2].at(-1).content).toContain("venue:zzz");
});
it("after three bad answers every clause renders as an agent suggestion, never blank (Review Focus 4)", async () => {
  const c = await draftCampaign(fakeLlm([citesUnknown, citesUnknown, citesUnknown]), bundle, ctx);
  expect(c.ideas.length).toBeGreaterThan(0);
  c.ideas.flatMap(i => i.clauses).forEach(cl => expect(cl.evidence).toEqual([]));
});
it("three unparseable answers still yield a non-empty campaign (Review Focus 4)", async () => {
  const c = await draftCampaign(fakeLlm(["nope", "{", "]"]), bundle, ctx);
  expect(c.ideas).toHaveLength(1); // single fallback idea: title "Campaign draft unavailable", one clause explaining, evidence []
});
it("without-Qloo campaigns are marked groundedBy none with no evidence", async () => {
  const c = await draftWithoutQloo(fakeLlm([validNoEvidence]), ctx);
  expect(c.groundedBy).toBe("none");
});
it("caps: session first, then global", () => {
  expect(capDecision({ session: 30, global: 1 }, { session: 30, global: 800 })).toEqual({ allowed: false, reason: "session_cap" });
  expect(capDecision({ session: 1, global: 800 }, { session: 30, global: 800 })).toEqual({ allowed: false, reason: "global_cap" });
});
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The session hash is the SHA-256 of the
  `X-Pulse-Session` header, a random id the SPA keeps in `localStorage`,
  plus the day. A missing header hashes the remote address.
  `pulse_usage` increments with `INSERT … ON CONFLICT DO UPDATE SET count
  = pulse_usage.count + 1 RETURNING count`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then, with a real
  `GROQ_API_KEY` and fixtures on, `curl -N` a brief. Expected: the
  `campaign` section has 3 ideas, and its cited ids exist in the bundle.
- [ ] **Step 5: Commit.**

```bash
git add services/pulse/src
git commit -m "Draft cited tie-in campaigns with Groq; validate, retry twice, downgrade the rest"
```

### Task 10: The chat agent

**Files:**
- Create: `services/pulse/src/agent/prompt.ts`, `src/agent/tools.ts`,
  `src/agent/loop.ts`, `src/http/sse.ts`
- Modify: `services/pulse/src/server.ts` (`POST /chat`)
- Test: `services/pulse/src/agent/loop.test.ts`,
  `services/pulse/src/agent/tools.test.ts`

**Interfaces:**
- Consumes: `buildBoard` (Task 8), `streamBrief` (Task 7, collected to a
  compact summary), `LlmClient` and `takeUsage` (Task 9), and
  `QlooClient.listTools`/`callTool` (Task 4).
- Produces:

```ts
export interface AgentTool { spec: ToolSpec; run(args: Record<string, unknown>): Promise<unknown>; }
export async function buildTools(deps): Promise<AgentTool[]>;
//   pulse_board(city, business_type), release_brief(title_or_tmdb_id, media_type?, city, business_type),
//   search_releases(query), titles_shot_in(city), plus harness tools whose names are in QLOO_AGENT_TOOLS
//   (recommend, where_popular, audience_demographics, rank, compare_audiences, find_tags, describe — exact names from Task 1's tools.json)
// AgentEvent is imported from shared/types/pulse.ts (Task 2)
export async function* runAgent(llm: LlmClient, tools: AgentTool[], history: ChatMessage[], maxRounds = 6): AsyncGenerator<AgentEvent>;
```

  `POST /chat` takes the body `{ messages: {role:"user"|"assistant",
  content:string}[] }`. History is capped at the last 12 messages, and
  each message at 4,000 characters.

  The system prompt (`prompt.ts`) holds:
  - the SAFE_USE rules: aggregate only, no individual claims, never
    request personal data,
  - the copy rule,
  - "Name the Qloo call behind every number you state",
  - the list of launch cities and business types.

- [ ] **Step 1: Write failing tests.**

```ts
it("runs a tool call and returns the final message", async () => {
  const llm = fakeLlm([{ role: "assistant", content: null, tool_calls: [call("pulse_board", { city: "delhi", business_type: "cafe" })] }, { role: "assistant", content: "Theme it around X." }]);
  const ev = await collect(runAgent(llm, [fakeTool("pulse_board", { ranked: [] })], [user("what should my Delhi café do?")]));
  expect(ev.map(e => e.type)).toEqual(["tool", "tool_result", "message", "done"]);
});
it("stops after 6 rounds with an honest message", async () => {
  const ev = await collect(runAgent(fakeLlm(Array(10).fill(toolCallMsg)), [fakeTool("pulse_board", {})], [user("loop")]));
  expect(ev.filter(e => e.type === "tool")).toHaveLength(6);
  expect(ev.at(-2)).toMatchObject({ type: "message", text: expect.stringContaining("step limit") });
});
it("an unknown tool name becomes a tool error the model can recover from, not a crash", async () => { /* tool_result summary contains "unknown tool" */ });
it("only allowlisted harness tools are exposed", async () => {
  const names = (await buildTools(depsWithHarnessTools(["recommend", "dangerous_admin"]))).map(t => t.spec.function.name);
  expect(names).toContain("recommend"); expect(names).not.toContain("dangerous_admin");
});
it("/chat answers 429 with a friendly message when the session cap is hit", async () => { /* router + capped usage */ });
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. `sse.ts` writes `data: <json>\n\n` per
  `AgentEvent`, and a 15 s `: ping` comment keeps proxies open.
- [ ] **Step 4:** Run the tests. Expected: PASS. Manual check, with a real
  Groq key and fixtures:
  `curl -N -X POST localhost:8787/chat -d '{"messages":[{"role":"user","content":"Which release should my Delhi café theme this weekend around?"}]}'`.
  Expected: `tool` events, then a message citing a Qloo call.
- [ ] **Step 5: Commit.**

```bash
git add services/pulse/src
git commit -m "Server-side Pulse agent: Pulse + Qloo tools over SSE, capped and allowlisted"
```

---

## Phase 2b — Frontend

### Task 11: Pulse API client and the board page

**Files:**
- Create: `src/lib/pulseApi.ts`, `src/routes/Pulse.tsx`
- Create: `src/components/pulse/CityTypePicker.tsx`,
  `src/components/pulse/BoardCard.tsx`
- Modify: `src/App.tsx`. Add a lazy `Pulse` route at `/pulse`, inside
  `<AppShell />`, not under `RequireAuth`.
- Modify: `src/components/layout/Sidebar.tsx`. Add
  `{ to: '/pulse', label: 'Pulse', icon: <Activity size={18} /> }` to the
  Discover group, after Calendar.
- Modify: `src/vite-env.d.ts` (`VITE_PULSE_URL`)
- Test: `src/lib/pulseApi.test.ts`, `src/routes/Pulse.test.tsx`

**Interfaces:**
- Consumes: the `/board` contract (Task 8) and `shared/types/pulse.ts`.
- Produces:

```ts
export const PULSE_URL: string; // import.meta.env.VITE_PULSE_URL
export function pulseSessionId(): string; // random id in localStorage 'spotlight:pulse-session', try/catch, falls back to an in-memory id
export function fetchBoard(city: string, type: BusinessType): Promise<BoardResponse>;
export function streamBrief(params: { city: string; type: BusinessType; mediaType: "movie" | "tv"; tmdbId: number }, onEvent: (e: BriefEvent) => void, signal?: AbortSignal): Promise<void>; // parses NDJSON incrementally
export function fetchGuess(params: same as streamBrief): Promise<Campaign>;
export function streamChat(messages: { role: "user" | "assistant"; content: string }[], onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void>;
export function readProfile(search: URLSearchParams): { city: string | null; type: BusinessType | null }; // URL wins over localStorage 'spotlight:pulse-profile'
```

  All requests send `X-Pulse-Session`.

  **Board UI:**
  - With no profile, show only the picker.
  - With a profile, show ranked cards (poster, title, platform, date,
    score bar, why-line).
  - `pending` cards appear as skeletons with "Reading Delhi's taste…".
    The query refetches every 5 s while `pending.length > 0`, stopping
    after 2 min.
  - Below that, a collapsed "Not enough taste data yet (n)" strip.
  - A card links to `/pulse/<city>/<mediaType>/<tmdbId>?type=<type>`.
  - The page subtitle is `"Release dates are for India; audience data is
    for <City>."`, shown only when the city's country is not `IN`.

- [ ] **Step 1: Write failing tests.**

```ts
it("parses NDJSON split across chunk boundaries", async () => {
  const events: BriefEvent[] = [];
  await streamBrief(params, e => events.push(e), undefined /* fetch mocked to emit '{"type":"hea' + 'der",...}\n{"type":"done"}\n' in two chunks */);
  expect(events.map(e => e.type)).toEqual(["header", "done"]);
});
it("URL profile wins over the stored one", () => {
  expect(readProfile(new URLSearchParams("city=mumbai&type=cafe"))).toEqual({ city: "mumbai", type: "cafe" });
});
it("shows the India-dates note only for non-Indian cities", async () => { /* render Pulse with mocked board for new-york → note visible; delhi → absent */ });
it("renders unresolved titles in their own strip, not among ranked cards", async () => { /* mocked board */ });
```

- [ ] **Step 2:** Run `npx vitest run src/lib/pulseApi.test.ts
  src/routes/Pulse.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement in Spotlight's existing Tailwind and Radix
  idiom. Reuse the existing poster-card styling from `src/components/release/`.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
  Then run `npm run dev` with `VITE_PULSE_URL=http://localhost:8787` and
  the service on fixtures. `/pulse` should show the picker, then cards.
- [ ] **Step 5: Commit.**

```bash
git add src/lib/pulseApi.ts src/lib/pulseApi.test.ts src/routes/Pulse.tsx src/routes/Pulse.test.tsx src/components/pulse src/App.tsx src/components/layout/Sidebar.tsx src/vite-env.d.ts
git commit -m "Pulse board: city and business picker, ranked releases with reasons"
```

### Task 12: The brief page (sections, map, provenance, without-Qloo toggle)

**Files:**
- Create: `src/routes/PulseBrief.tsx`
- Create: `src/components/pulse/BriefSection.tsx`, `HeatMap.tsx`,
  `ProvenanceDrawer.tsx`, `CampaignView.tsx`, `EvidenceChip.tsx`
- Modify: `src/App.tsx`. Add a lazy route
  `/pulse/:city/:mediaType/:tmdbId`.
- Modify: `package.json`. Add `leaflet` and `react-leaflet@4`, plus
  `@types/leaflet` as a dev dependency.
- Test: `src/routes/PulseBrief.test.tsx`,
  `src/components/pulse/CampaignView.test.tsx`

**Interfaces:**
- Consumes: `streamBrief` and `fetchGuess` (Task 11), and the
  `BriefEvent` and `Campaign` types.
- Produces:
  - `EvidenceChip({ id, bundle })` renders one of the exact chip labels in
    Global Constraints, mapped from the id prefix. `heat` gives
    `Qloo · heatmap`, `venue` gives `Qloo · places`, and so on. The `hook`
    chip label comes from its source, and `[]` gives `Agent suggestion`.
  - `CampaignView({ campaign })` renders each clause followed by its chips.

**Page layout:**
- **Header.** Poster, title, date, city, business type.
- **Sections**, in `BUSINESS_TYPES` order, each with its own skeleton
  until its event arrives:
  - **Who:** age and gender bars of signed skew, with the label
    "relative to average".
  - **Where:** `HeatMap` with circles per cell, sized by affinity, and
    the top 3 named neighbourhoods listed.
  - **Venues:** a list with tags.
  - **Themes, Artists, Brands:** chips.
  - **Hook:** "Shot in Chandni Chowk, Delhi" with its source chip.
  - **Trend:** only if `ok`.
  - **Campaign.**
- **Section statuses.**
  - `empty` shows the note in muted text.
  - `error` shows "Qloo didn't answer this part — Retry", which re-fetches
    the whole brief.
  - `degraded` shows the note.
- **Toggle.** "Without Qloo" calls `fetchGuess` and shows its campaign
  side by side, under the exact label
  `What an LLM guesses with no taste data`.
- **ProvenanceDrawer** lists each section's `provenance[]` (call, params,
  limits), under the heading "What this doesn't tell you" for limits.
- **Unknown city** (400 `unknown_city`): render `CityTypePicker`, with the
  message "That city isn't supported yet — pick one of these."

- [ ] **Step 1: Write failing tests.**

```ts
it("renders sections as they stream, before done", async () => { /* mock streamBrief to emit header + who, hold; expect who visible and venues skeleton */ });
it("an error section offers retry while other sections stay visible (Review Focus 2)", async () => { /* where: error → 'Retry' button; who still rendered */ });
it("an unknown city shows the picker, not a crash (Review Focus 5)", async () => { /* streamBrief rejects with HttpError(400) unknown_city */ });
it("clauses with no evidence render the Agent suggestion chip", () => {
  render(<CampaignView campaign={{ groundedBy: "qloo", ideas: [{ kind: "social", title: "t", timing: "Fri", clauses: [{ text: "Post at 7pm", evidence: [] }] }] }} />);
  expect(screen.getByText("Agent suggestion")).toBeInTheDocument();
});
it("the without-Qloo panel uses the exact label", async () => {
  expect(await screen.findByText("What an LLM guesses with no taste data")).toBeInTheDocument();
});
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. `HeatMap` is lazy-loaded so Leaflet's CSS
  and JS stay out of the main bundle. Tiles come from
  `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, with the attribution
  "© OpenStreetMap contributors".
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run build`.
  Expected: PASS. Then check by hand: the brief page streams in on
  fixtures, and the toggle shows two campaigns side by side.
- [ ] **Step 5: Commit.**

```bash
git add src package.json package-lock.json
git commit -m "Pulse brief: streamed evidence sections, heatmap, provenance and the without-Qloo view"
```

### Task 13: The chat panel

**Files:**
- Create: `src/components/pulse/PulseChat.tsx`
- Modify: `src/routes/Pulse.tsx` and `src/routes/PulseBrief.tsx`, which
  mount `PulseChat` as a right-side panel on desktop and a bottom sheet on
  mobile.
- Test: `src/components/pulse/PulseChat.test.tsx`

**Interfaces:**
- Consumes: `streamChat` (Task 11) and `AgentEvent`.
- Produces: `PulseChat({ city, type, title? })`. It seeds three suggested
  prompts:
  - "Which release should my ⟨City⟩ ⟨café|brand⟩ theme this weekend around?"
  - "Who is the audience for ⟨title⟩ here?" (only when `title` is set)
  - "Plan a screening-night special for Friday."

  Tool events render as small collapsible lines, e.g. "Checked Qloo
  heatmap for Delhi". A cap-hit or error event renders as a muted system
  line.

- [ ] **Step 1: Write failing tests.**

```ts
it("shows tool activity, then the answer", async () => { /* mock streamChat emitting tool, tool_result, message, done */ });
it("disables send while streaming and re-enables after done", async () => {});
it("renders a cap message as a system line, not an error toast", async () => {});
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Do not reuse `src/webmcp/AgentChat.tsx`: it
  is gated on the WebMCP flag and needs a key from the visitor. The visual
  style can match it.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/components/pulse/PulseChat.tsx src/components/pulse/PulseChat.test.tsx src/routes/Pulse.tsx src/routes/PulseBrief.tsx
git commit -m "Pulse chat panel: a keyless agent judges can talk to"
```

---

## Phase 4 — Stretch (cut first)

### Task 14: "Filmed in" panel and "Plan the night" card on the title page

**Files:**
- Modify: `services/pulse/src/server.ts`. Add
  `GET /title-locations?mediaType=&tmdbId=`, returning `{ city_slug,
  cityName, kind, landmark_label, source }[]`. Add
  `GET /plan-night?mediaType=&tmdbId=&city=`, which returns
  `EvidenceSection<Venue[]>` from `places` with no tag filter, plus
  artists, through `getEvidence`.
- Create: `src/components/title/LocationsPanel.tsx`,
  `src/components/title/PlanNightCard.tsx`
- Modify: `src/routes/TitleDetail.tsx`. Mount `LocationsPanel` between
  `FactsPanel` (about line 413) and `TrailerCard` (about line 415).
  Mount `PlanNightCard` after `LocationsPanel`.
- Test: `src/components/title/LocationsPanel.test.tsx`,
  `src/components/title/PlanNightCard.test.tsx`

**Interfaces:**
- Consumes: `title_locations` (Task 5), `getEvidence` and `resolveTitle`
  (Tasks 6 and 7), and the city picker (Task 11).
- Produces:
  - `LocationsPanel({ mediaType, tmdbId })` renders nothing when there are
    no rows. Each city links to `/pulse?city=<slug>`.
  - `PlanNightCard({ mediaType, tmdbId, title })` asks for a city with the
    picker, then lists places with the copy "Fans of ⟨title⟩ in ⟨City⟩
    over-index on these spots". It also offers a Web Share / `wa.me` link
    with the invite text. It never sends anything itself.

- [ ] **Step 1: Write failing tests.** A panel with no rows renders
  nothing. The card copy follows the copy rule exactly. The share link
  contains no personal data.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src services/pulse/src
git commit -m "Title page: where it was filmed, and a taste-matched plan for the night"
```

---

## Phase 5 — Ship

### Task 15: Container, deployments, README and submission text

**Files:**
- Create: `services/pulse/Dockerfile` (build context is the repo root):
  - `FROM node:22.19-slim`
  - `WORKDIR /app`
  - copy the root `package.json` and `package-lock.json`, then
    `npm ci --omit=dev --ignore-scripts`
  - copy `services/pulse/package*.json`, then
    `npm ci --prefix services/pulse --omit=dev`
  - copy `lib`, `shared`, `data` and `services/pulse/src`
  - `ENV NODE_ENV=production`
  - `CMD ["npx","tsx","services/pulse/src/server.ts"]`
  - Move `tsx` to the service's `dependencies` so it survives
    `--omit=dev`.
- Create: `.dockerignore` (`node_modules`, `dist`, `.git`,
  `services/pulse/spike/out`)
- Create: `docs/submission/devpost.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - **The live container**, on Railway or Render. Its env is:
    `DATABASE_URL` (hackathon branch), `QLOO_API_KEY`, `GROQ_API_KEY`,
    `TMDB_API_KEY`, `PULSE_ALLOWED_ORIGINS`, `PULSE_WARM_SECRET` and
    `PORT`.
  - **A separate hackathon Vercel project.** Its env is the existing vars
    plus `DEMO_GUEST=1`, `VITE_DEMO_GUEST=1` and `VITE_PULSE_URL`.
  - **GitHub settings:** the secret `PULSE_WARM_SECRET` and the variable
    `PULSE_URL`.

- [ ] **Step 1:** Run `docker build -f services/pulse/Dockerfile -t
  pulse . && docker run --rm -p 8787:8787 --env-file .env.pulse pulse`,
  then `curl localhost:8787/healthz`. Expected: `{"ok":true}`.
- [ ] **Step 2:** Deploy the container and the Vercel project. Run
  `curl -fsS $PULSE_URL/healthz` and expect `{"ok":true}`. Then call
  `/warm` with the secret, and expect a JSON report with `warmed > 0`.
- [ ] **Step 3: README.** Replace the WebMCP top note with a "Qloo
  Agentic Hackathon submission" section. Keep the WebMCP material lower
  down as history. It contains:
  - What's new since 30 Sep 2026: list the commits on `feat/release-pulse`
    and the Pulse files.
  - Test in 60 seconds: the live URL, then `/pulse`, Delhi → Café,
    open the #1 card, flip "Without Qloo", and ask the chat.
  - The Qloo tools used and why.
  - A redacted request-to-result walkthrough for one brief: the entity and
    tag choices, and the params with no key.
  - Known limitations: the global (not per-city) demographics, India
    release dates in NYC and London, and Wikipedia coverage gaps.
  - Setup steps for the service.
- [ ] **Step 4:** Write `docs/submission/devpost.md`: the problem, the
  audience, what it does, how it's Qloo-powered, the evidence numbers from
  the spec, and the limitations.
- [ ] **Step 5: Judge run-through.** In a fresh incognito window on the
  live URL, with no sign-in, check that:
  - `/pulse` shows Delhi/Café with ranked cards in under 10 s,
  - a brief streams in, with a heatmap, venues and a hook where one
    exists,
  - the toggle works,
  - the chat answers and cites Qloo,
  - New York shows the India-dates note,
  - an unknown-city URL shows the picker.

  Then check the repo's About sidebar shows the MIT license. Take
  screenshots.
- [ ] **Step 6:** Run `npm run typecheck && npm test && npm run test:pulse
  && pytest`. Expected: all pass. Then commit.

```bash
git add services/pulse/Dockerfile .dockerignore README.md docs/submission/devpost.md services/pulse/package.json services/pulse/package-lock.json
git commit -m "Ship Pulse: container, hackathon deployment, README and submission text"
```

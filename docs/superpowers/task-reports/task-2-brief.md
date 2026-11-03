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


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


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


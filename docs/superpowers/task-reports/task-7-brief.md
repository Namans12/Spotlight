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


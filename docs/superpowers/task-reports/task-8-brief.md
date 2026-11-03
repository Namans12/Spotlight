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


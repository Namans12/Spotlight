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


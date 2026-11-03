# Task 13 report: the Pulse chat panel

Commit: 283b63f "Pulse chat panel: a keyless agent judges can talk to" (branch feat/release-pulse).

## What was built
Split by responsibility:
- `src/lib/pulseChat.ts`: pure wording and rules: `toWire` (last 12 messages, 4000-char cap), `toolLabel` (friendly sentence per tool; "Qloo" only for qloo_*), `failureLine` (PulseApiError code -> sentence + whether to offer "Try again"), `suggestedPrompts`.
- `src/hooks/usePulseChat.ts`: the state machine. Items: user / assistant / tool / system. In-memory only (ref mirror + state), AbortController per turn, `send/stop/retry/reset`, unmount aborts. tool_result pairs with the earliest pending call of that name (events carry no id).
- `src/hooks/useMediaQuery.ts`: `useSyncExternalStore`-based, falls back (param) where `window.matchMedia` is missing (jsdom, SSR). The existing `useIsMobile` assumes matchMedia exists and would throw in the existing route tests, hence a separate hook. Query is `(min-width: 48rem)` (768 px at 16 px root, same as use-mobile.tsx).
- `src/components/pulse/ChatToolLine.tsx`: native `<details>/<summary>`, `aria-live="off"`; opens to Tool / Arguments / Result (text only). "running…" in the summary while pending.
- `src/components/pulse/PulseChat.tsx`: `PulseChat({city,type,title?,autoFocus?})`: log + composer + New chat + footnote.
- `src/components/pulse/PulseChatLauncher.tsx`: `PulseChatLauncher({city,type,title?})`: renders null when `!pulseConfigured()`; "Ask Pulse" button (MessageCircle) opening a Sheet: `right` (w-full sm:max-w-md) at >= 768 px, `bottom` (h-[85dvh], rounded-t-2xl) below. Title "Ask Pulse" + description live here (Radix needs them inside the dialog); `onOpenAutoFocus` is prevented and PulseChat focuses the textarea; Radix returns focus to the trigger; Escape closes; closing unmounts the chat so the conversation is dropped and a running stream is aborted.
- Mounted in `src/routes/Pulse.tsx` (header, right after "Change", only on the profile view) and `src/routes/PulseBrief.tsx` (same row group as "How this was made"; `title={header?.title}`, so the audience prompt appears only once the title has loaded).
- `src/test/pulseChatStream.ts`: shared hand-controlled streamChat emitter for tests.

## Decisions / deviations (please review)
1. Prompt 3 reads "Plan a screening-night special for Friday at my <City> <café|brand>." The brief gives the bare sentence, but the task context says all three prompts must carry city and type because the model does not know the page. The button label equals the text sent.
2. Live-region choice: message list is `role="log" aria-live="polite" aria-relevant="additions"`; tool lines opt out (`aria-live="off"`); system lines are `role="status"`; "Pulse is thinking…" is a separate polite status; no `role="alert"` anywhere. The log is `tabIndex=0` so keyboard users can scroll it.
3. `rate_limited` unknown wait: "You're asking quickly — try again in a moment." (number omitted; 1 -> "1 second").
4. A failure whose retry was offered loses the button once a newer question is sent; retry removes the failure line and resends without duplicating the user message. Error events from the server (incl. cap messages) are system lines with no retry button.
5. Assistant text sent back is capped at 4000 chars defensively (server rejects longer). A window can begin with an assistant message after slicing (server accepts).
6. Straight apostrophes in the exact strings from the spec.
7. Not lazy-loaded separately: the chat lands in the shared chunk used by the two lazy Pulse pages (see below), so it is "with the pages".

## Tests
- Hook (written first): `src/hooks/usePulseChat.test.tsx`, 24 tests. Component/launcher: `src/components/pulse/PulseChat.test.tsx`, 49 tests. Route integration: +2 in Pulse.test.tsx, +2 in PulseBrief.test.tsx.
- Coverage: everything in the task list (3 brief tests; prompts per type/title and click-to-send hides suggestions; Enter vs Shift+Enter; empty/whitespace; 12-message window with no tool/system content; Stop aborts + "Stopped" + no error; each PulseApiError code incl. rate_limited with/without seconds; network error -> Try again resends same message; error-event line; tool lines (12 names, Qloo only for qloo_*, collapsed, expands, running…); hostile `<img onerror>`/`<b>`/`<script>` rendered literally; New chat; launcher hidden when unconfigured; sheet side by media query + no-matchMedia fallback; focus in textarea at open, Escape returns focus to launcher and drops the conversation; unmount aborts; auto-scroll follows unless scrolled up; no Storage.setItem ever (asserted in afterEach)).
- TDD evidence: with only the hook test file present, `npx vitest run src/hooks/usePulseChat.test.tsx` failed to load (module `./usePulseChat` missing: "Failed to resolve import", 0 tests = RED). After implementing: 23/24 green; the one failure was my own off-by-one in the 12-window test (the 17th-message window starts at "answer 3", not "question 5"); test corrected -> 24/24 GREEN. UI tests were written alongside the implementation and passed on first run (so they were not individually seen failing).
- Results: `npx vitest run` -> 46 files, 679 tests passed (602 + 77). `npm run typecheck` clean (one TS2550 for `Object.hasOwn` fixed along the way). `npm run lint` -> 69 problems (65 errors, 4 warnings), unchanged. `npm --prefix services/pulse test` -> 687 passed, 22 skipped. `npm run build` OK.

## Build
Entry `index-*.js` 205.11 kB -> 205.13 kB (gzip 65.58 -> 65.59). `Pulse` 10.56 -> 10.63 kB, `PulseBrief` 33.51 -> 30.87 kB (gzip 10.83 -> 9.97); the chat, Sheet and Notice now sit together in the shared chunk `Notice-*.js` (~25.8 kB raw) that both lazy pages load. Nothing meaningful added to the entry.

## Files changed
New: src/components/pulse/{ChatToolLine.tsx,PulseChat.tsx,PulseChat.test.tsx,PulseChatLauncher.tsx}, src/hooks/{useMediaQuery.ts,usePulseChat.ts,usePulseChat.test.tsx}, src/lib/pulseChat.ts, src/test/pulseChatStream.ts. Modified: src/routes/{Pulse.tsx,Pulse.test.tsx,PulseBrief.tsx,PulseBrief.test.tsx}. Service untouched.

## Self-review
- Completeness vs brief and additions: done per above. No `dangerouslySetInnerHTML`; no storage use; no hard-coded URLs (only `streamChat`); footnote present; targets min-h-11 for launcher, Send, Stop, New chat, Try again, suggested prompts and tool summaries (the sheet's built-in Close "X" is the existing 16 px control, left as in the other drawer).
- Reduced motion: only animations added are the thinking dot (`motion-safe:animate-pulse`) and the disclosure arrow (`motion-reduce:transition-none`); the Sheet's own slide animation is the existing component's.
- 375 px: containers use min-w-0/break-words/break-all, `overflow-x-hidden` on the log, full-width sheet below 768 px. Not verified in a real browser (jsdom has no layout).

## Concerns
- No manual/visual check done (optional this round): real-viewport layout, composer stickiness with the mobile keyboard (`dvh` + safe-area padding used), and the `<details>` arrow rotation are untested in a browser.
- Prompt 3 wording deviation (see 1).
- Stop shows "Stopped" immediately and ignores any later events; the server stream is cancelled via abort only (server-side handling was reviewed in Task 11).

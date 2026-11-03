# Task 11 report: Pulse API client and board page

Status: DONE_WITH_CONCERNS. Commit `a2130b2` "Pulse board: city and business picker, ranked releases with reasons".

## What was built

- `src/lib/pulseApi.ts`
  - `PULSE_URL` (trailing slashes trimmed), `pulseConfigured()`, `PulseApiError`, `pulseSessionId()`, `readProfile()`, `saveProfile()`.
  - `fetchBoard`, `fetchGuess`, `streamBrief` (NDJSON), `streamChat` (SSE).
  - `PulseApiError` extends `HttpError`, so the repo's `shouldRetry` already skips 4xx and retries 5xx. It carries `status`, `code` and `retryAfterSeconds`. `code` is null for a non-JSON body.
  - Streams decode with `TextDecoder` in streaming mode, so a split multibyte character is safe. Blank lines are ignored and a malformed line is skipped with a `console.warn`. A non-2xx response throws before any event. An abort throws `AbortError` and stops delivery.
  - SSE ignores `:` comment lines such as the server's ping, accepts CRLF, and flushes a final event that has no trailing blank line.
  - JSON calls have a 16 s timeout that is remapped to the repo's `TimeoutError`. Streams have no overall timeout, only the caller's signal.
  - `readProfile` merges the URL and storage per field. A URL value that is present but invalid gives null; it does not fall back to storage, so a link to an unknown city never silently shows another one.
- `src/lib/pulseCities.ts`: the city list is read from `data/pulse_cities.json` and mapped to `{slug, name, country}`. Business-type labels are a small constant with a comment pointing at the service's `BUSINESS_TYPES`.
- `src/lib/pulseFormat.ts`: `formatReleaseDate` (UTC, no timezone drift) and `splitWhy`. I split these out of `BoardCard.tsx` so that file exports only components, which clears the react-refresh lint warning.
- `src/routes/Pulse.tsx` at `/pulse` (lazy, public, not under `RequireAuth`), plus `components/pulse/{CityTypePicker,BoardCard,UnresolvedStrip}.tsx`.
  - No profile: only the picker, with the tagline.
  - Profile: header with a "Change" button, and the India-dates note for non-IN cities only.
  - Ranked cards are an ordered list. Each shows poster, title, Film/TV, date, platform, a `role="meter"` score bar captioned "Relative to other releases in <City>", and the why-line.
  - The score bar is never drawn without a why-line.
  - Pending titles show their real poster and title with a `Skeleton` for the part not ready ("Reading <City>'s taste…"), sized the same as ranked cards.
  - Unresolved titles go in a native `<details>` strip, collapsed by default.
  - Polling: React Query key `['pulse-board', city, type]`, `refetchInterval` 5 s while pending, stopped after 2 min with "Still reading — refresh to check again" and a "Check again" button. `staleTime` is 10 s and `retry` is `shouldRetry`.
  - Errors: `unknown_city` or `unknown_business_type` reopens the picker with a message. `rate_limited` shows the wait plus a retry button. A network error shows a retry button. When `VITE_PULSE_URL` is unset the page shows "Pulse isn't configured on this deployment" and makes no call.
  - The profile is mirrored into the URL (replace) when it came from storage. The picker submit writes the URL (push) and localStorage.
  - Card links go to `/pulse/<city>/<mediaType>/<tmdbId>?type=<type>`. Unresolved rows link the same way.
  - The rank-only why-line renders with no dangling separator.
- `src/App.tsx` (lazy route), `Sidebar.tsx` (Pulse entry after Calendar, `Activity` icon), `src/vite-env.d.ts` (`VITE_PULSE_URL`), `tsconfig.app.json` (`resolveJsonModule`).

## Tests and results

| Command | Result |
|---|---|
| `npx vitest run` | 35 files, 476 tests pass (414 before, +62 new) |
| `npm run typecheck` (all five configs) | clean |
| `npm run lint` | 65 errors / 4 warnings; identical to the baseline (checked with `git stash -u`). My files lint clean. |
| `npm --prefix services/pulse test` | 687 passed, 22 skipped (integration, no DB env in that run) |
| `npm run build` | succeeds without `DATABASE_URL` ("skipping title pages"); Pulse chunk 19.9 kB (6.7 kB gzip) |

New suites:
- `pulseApi.test.ts` (31 tests): NDJSON split chunks, split multibyte, blank lines, malformed line, no trailing newline, non-2xx throws `PulseApiError`, abort; SSE data/ping/split/CRLF/malformed/abort/non-2xx; session id persistence and storage-throws fallback; `readProfile` precedence and invalid values; `fetchGuess`; `shouldRetry` behaviour.
- `pulseCities.test.ts` (3), `pulseFormat.test.ts` (5).
- `Pulse.test.tsx` (23): picker-only, loading skeleton, ranked card contents, rank-only why-line, no bar without why, link target, unresolved strip collapsed and separate, empty board, India note on and off, `unknown_city`, `rate_limited`, network error with retry (fake timers, since `shouldRetry` backs off 1 s then 2 s), a 4xx is not retried, not-configured, polling every 5 s and stopping after 2 min, no polling without pending, picker writes URL and localStorage, disabled submit, storage mirrored into the URL, Change/Cancel, unknown URL city.
- The new tests emit no stderr. The router future-flag warnings seen elsewhere in the repo's suite are from existing tests.

## TDD evidence

- RED: `npx vitest run src/lib/pulseApi.test.ts src/lib/pulseCities.test.ts` failed with 2 files failed and "no tests", because the modules did not exist (vite import resolution error).
- GREEN: after implementing, 34/34 passed (one fix: my test expected "New York" but the data says "New York City").
- UI tests were written alongside the implementation. First run had 2 failures (an `<output>` element also has `role="status"`; the network-error test needed three rejections plus fake timers because of the retry policy). Both were test bugs, fixed.

## Manual check

- Setup: Postgres on 54329 was already running. Service in fixtures mode on 8799 with `PULSE_ALLOWED_ORIGINS=http://localhost:8080`. Vite was started with `VITE_PULSE_URL=http://localhost:8799`.
- Rows: 3 synthetic `release_items` (ids 999600001..3). The first attempt, without `title_ratings`, put all 3 in "Not enough taste data yet (3)". Entity resolution needs an imdb id from `title_ratings`, so I added 3 rows there and cleared the cached `qloo_entities` misses.
- Desktop (`/pulse?city=delhi&type=cafe`, after the app's intro gate): header "Pulse for Delhi · Café / restaurant · Change". Three ranked cards in a two-column grid, with rank numbers, striped no-poster placeholders, platform, date, gold score bars with the "Relative to other releases in Delhi" caption, and why-lines like "#1 of 3 for Delhi audiences · strongest around Raisina Hill · out this week". The Pulse sidebar item is highlighted.
- 375 px, `new-york` + `d2c_food` (served live while the board warmed): heading, type label and Change fit; the India-dates note shows; three pending cards show real titles, dates and platforms with skeleton bars and "Reading New York City's taste…". `scrollWidth` equals `clientWidth` (375), so no horizontal scroll. The picker at 375 also fits, with both segments visible.
- Cleanup: all synthetic rows deleted from `release_items`, `title_ratings`, `qloo_entities`, `qloo_evidence` (counts 0). Vite and the service are stopped. Postgres was left running because it was already up.

## Files changed

Created: `src/lib/pulseApi.ts`, `src/lib/pulseApi.test.ts`, `src/lib/pulseCities.ts`, `src/lib/pulseCities.test.ts`, `src/lib/pulseFormat.ts`, `src/lib/pulseFormat.test.ts`, `src/routes/Pulse.tsx`, `src/routes/Pulse.test.tsx`, `src/components/pulse/CityTypePicker.tsx`, `src/components/pulse/BoardCard.tsx`, `src/components/pulse/UnresolvedStrip.tsx`.
Modified: `src/App.tsx`, `src/components/layout/Sidebar.tsx`, `src/vite-env.d.ts`, `tsconfig.app.json`.

## Self-review

- Brief: exports match (`PULSE_URL`, `pulseSessionId`, `fetchBoard`, `streamBrief`, `fetchGuess`, `streamChat`, `readProfile`) plus `saveProfile`, `pulseConfigured`, `PulseApiError`. All four required brief tests are covered, plus the extra cases in the task text.
- No hand-copied city list. The cities module is the only mapping.
- Accessibility: a labelled native select, the existing `Segmented` with an aria-label, real `<details>`/`<summary>`, `role="meter"` with a label, focus rings on the new controls, decorative images have empty alt text.
- Anti-goals: copy is aggregate; the picker and cards say nothing about "your customers"; no percentage is shown. The tagline "your city's audience" is the task's own wording.
- YAGNI: no Toolbar use and no new dependencies. `fetchGuess`, `streamBrief` and `streamChat` are written but have no UI caller yet (Tasks 12 and 13).

## Concerns

1. Dev origin: Vite's dev port is 8080 (`strictPort`, `vite.config.ts`), not 5173 as in the task text. `PULSE_ALLOWED_ORIGINS` for local dev must include `http://localhost:8080`. I used that for the manual check.
2. I composed the card from ReleaseCard's styling (same shell, 56 px poster, hover border) instead of wrapping `PosterCard`/`ReleaseCard`, because neither can carry a score bar or a multi-line why-line, and `PosterCard` clamps its reason to 10 px, two lines. There is some class-string duplication with ReleaseCard.
3. `data/pulse_cities.json` is imported whole, so the extra fields (qids, wikipedia lists) ship in the Pulse chunk. It is about 4 KB, so I left it.
4. The page sets `retry: shouldRetry` at query level, which overrides a test QueryClient's `retry: false`. Tests that exercise failures use fake timers or 4xx errors for that reason.
5. Fixtures mode resolves entities by imdb id, so the manual-check recipe also needs `title_ratings` rows with an `imdb_id`, not just `release_items`.

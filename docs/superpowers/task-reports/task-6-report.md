# Task 6 report: Entity resolution (TMDB -> IMDb -> Qloo)

Commit: 8f2b97d "Resolve Spotlight titles to Qloo entities via IMDb, cached with a 3-day miss retry"

## Built
- `services/pulse/src/db/pool.ts`: `getPool(cfg)` memoized `postgres(url, {max: 5})`, `closePool()`.
- `services/pulse/src/db/entities.ts`: narrow `EntitySql` type; `getCachedEntity`, `getImdbId` (null on missing row / NULL / empty), `upsertEntity` (ON CONFLICT (tmdb_id, media_type) DO UPDATE). All parameterized.
- `services/pulse/src/resolve.ts`: `TitleKey`, `Resolution`, `pickSearchMatch`, `notFoundIsStale`, `resolveTitle` with the exact brief signatures. Flow: cache hit -> fresh not_found -> IMDb id (title_ratings, else resolveOmdbLookup) -> entityByImdb -> lazy title/year (one TMDB call at most) -> searchTitles + pickSearchMatch -> upsert.
- R17: errors thrown by Qloo or the DB propagate and cache nothing (documented in the doc comment, tested). Only definite null/empty is cached as not_found.
- In-flight map keyed `${mediaType}:${tmdbId}`, cleared in `.finally` (rejections included).
- `postgres@^3.4.9` added to `services/pulse/package.json` and its lock (the service imported it only through root hoisting before; `lib/` also needs it).
- Reasons: search impossible (no title) -> `no_imdb_and_no_match`; search ran, no match -> `not_in_qloo` if an IMDb id existed, else `no_imdb_and_no_match`; entityByImdb null + search miss with an IMDb id -> `not_in_qloo`.

## Tests
- `resolve.test.ts` (26): brief cases + pickSearchMatch (+-1 boundary, null year both ways, closest-year then first, type), strict 3-day boundary, cache hit (asserts SELECT values), stale retry overwrites row (asserts every upserted column/value), IMDb id source order, lazy title lookup called once, tv->tv_show mapping, no-year no-search, outages propagate with no upsert (entityByImdb, searchTitles, DB read, DB write), failed in-flight call retried, concurrent calls share one Qloo call/one upsert, different keys (movie vs tv same id) not shared. The fake asserts the INSERT column list and ON CONFLICT clause first.
- `db/pool.test.ts` (3): memoization, max=5, fresh pool after closePool.
- `resolve.integration.test.ts` (2, `skipIf(!PULSE_TEST_DATABASE_URL)`): real Postgres.

## TDD
RED: first run of the new tests: `Failed to load url ./resolve.js` / `./pool.js` (2 suites failed). GREEN after implementation: 92 passed.

## Real-DB verification
`PULSE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/spotlight_test npm --prefix services/pulse test`
-> `Test Files 9 passed (9) / Tests 94 passed (94)`, including resolve.integration.test.ts (2 tests): inserted title_ratings rows with imdb ids; hit written to qloo_entities (imdb_id, qloo_entity_id='q-hit', method='imdb', not_found=false) and 2nd call a cache hit (stub called once); miss stored with not_found=true, qloo_entity_id NULL; re-resolve at +2 days did not call Qloo; at +4 days it did, and the row count stayed 1 (upsert). Fixture client's entityByImdb never returns null so a stub QlooClient was used. Cleanup verified: 0 leftover rows in qloo_entities and title_ratings (ids >= 990000000).

## Gates
- `npm --prefix services/pulse test`: 92 passed, 2 skipped (no env var).
- `npm run typecheck`: clean (incl. tsconfig.service.json; also confirmed with a throwaway file that real `postgres.Sql` and `getPool()` are assignable to `EntitySql`, then deleted it).
- root `npx vitest run`: 414 passed. `.venv/bin/python -m pytest -q`: all passed.

## Files
services/pulse/src/db/pool.ts, db/pool.test.ts, db/entities.ts, resolve.ts, resolve.test.ts, resolve.integration.test.ts, services/pulse/package.json, package-lock.json.

## Self-review / concerns
- CONCERN: `resolveOmdbLookup` returns null for TMDB-unreachable AND TMDB_API_KEY unset AND 404 (per lib/omdb.ts doc). When title_ratings has no IMDb id, a TMDB outage or a missing key is therefore indistinguishable from "no IMDb id" and gets cached as not_found for 3 days. Can't be fixed in this task without changing lib/omdb.ts. Suggest the service fail startup if TMDB_API_KEY is unset (config task), and/or a lib change that throws on network failure.
- An entityId cached with a method of null (shouldn't happen given CHECK/our writes) would be treated as not cached and re-resolved.
- The in-flight map is module-level and ignores differing `sql`/`qloo`/`now` args for the same key; fine for a single-process service.
- Integration test is opt-in via env var, so CI without a DB skips it.

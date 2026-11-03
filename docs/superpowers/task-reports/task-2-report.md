# Task 2 report: Service scaffold, shared types, CORS and health

Status: DONE. Commit fbae5b3 "Scaffold the Pulse service: config, CORS allowlist, health, shared DTOs" (trailer: Claude Sonnet 5.5, per the coordinator's correction; committed once, no amend needed).

## Implemented
- services/pulse package (ESM, node >=22.19.0, tsx in dependencies per R1, vitest in devDependencies), lockfile committed.
- config.ts (loadConfig, throws on missing DATABASE_URL; blank/typo'd numeric values fall back to defaults rather than NaN), http/cors.ts, http/router.ts (own-property lookup, JSON 404), server.ts (GET /healthz, OPTIONS preflight 204, CORS headers on every response, 500 JSON fallback).
- shared/types/pulse.ts verbatim from the brief.
- tsconfig.service.json mirrors tsconfig.server.json compilerOptions; package.json typecheck + test:pulse; root vitest.config.ts excludes services/**.

## TDD
- RED: `npm --prefix services/pulse test` -> 2 suites failed: "Failed to load url ./config.js ... Does the file exist?" and same for ./cors.js (modules missing, as expected).
- GREEN: same command -> 2 files, 4 tests passed.

## Verification
- `npm run typecheck`: passes, including tsconfig.service.json.
- Root `npx vitest run`: 31 files, 414 tests passed (services/** not picked up).
- Manual smoke test (PORT=8799): /healthz 200 with allow-origin echoed for allowlisted origin; OPTIONS 204 with CORS headers; unknown path -> {"error":"not_found"}.

## Files
package.json, vitest.config.ts, tsconfig.service.json, shared/types/pulse.ts, services/pulse/{package.json,package-lock.json,vitest.config.ts}, services/pulse/src/{config.ts,config.test.ts,server.ts}, services/pulse/src/http/{cors.ts,cors.test.ts,router.ts}.

## Self-review / concerns
- Beyond the brief: cors.ts also sends Vary: Origin, Allow-Methods (GET, POST, OPTIONS), Allow-Headers (Content-Type) and Max-Age only for allowlisted origins; later tasks may need to extend Allow-Headers (e.g. custom session header).
- tsx pinned as ^4.19.0 (brief gave no version). Config's intOr treats negative numbers as invalid; 0 is accepted (a zero quota).
- server.ts runs loadConfig at import time, so it needs DATABASE_URL to start; no test covers server.ts beyond the manual smoke test.

---

## Fix report (review round 1)

Commit: see `git log` ("Pin npm registry, allow X-Pulse-Session in CORS, parse config ints strictly").

Changes:
1. Added `.npmrc` at the repo root and in `services/pulse/`, each containing exactly `registry=https://registry.npmjs.org/`.
2. Deleted `services/pulse/package-lock.json` and `node_modules`, reinstalled with `--registry=https://registry.npmjs.org/`. `grep -c npmmirror` gives 0 for both `services/pulse/package-lock.json` and the root `package-lock.json` (root not regenerated). All 354 `resolved` URLs use registry.npmjs.org. `@modelcontextprotocol/sdk` is 1.30.1, `@qloo/qloo-harness` is 0.1.26.
3. `cors.ts`: Allow-Headers is now `Content-Type, X-Pulse-Session` (no Authorization); new assertion test in `cors.test.ts`.
4. `config.ts` `intOr`: only `/^\d+$/` strings parse, otherwise the default. New tests: default port/sessionDailyChat/globalDailyLlm, valid overrides (including 0), and fallback for "8787abc" and "1e3".

Verification:
- `npm --prefix services/pulse test`: 2 files, 8 tests passed.
- `npm run typecheck`: passes.
- Root `npx vitest run`: 31 files, 414 tests passed. (A stack trace in its output predates this change and is logged stderr from an existing test; it appears with the change stashed too.)

// Local stand-in for Vercel's serverless routing. Every handler in api/** is
// already written against plain Node `IncomingMessage`/`ServerResponse` (no
// @vercel/node wrapper), so it can run unmodified on a bare http.Server —
// this isn't a mock, it's your real handlers hitting your real database.
//
// Run via `npm run dev:api` (or `npm run dev:full` for this + Vite together).
// vite.config.ts proxies /api to this server's port during `vite dev`.
//
// Editing api/** or lib/** requires this process to restart to see the
// change — run it under `tsx watch` (already wired into the npm script)
// rather than polling the filesystem yourself.

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.DEV_API_PORT || 3001);

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}
loadEnvFile();

/** Maps a request path onto the same api/*.ts file Vercel would route it to. */
function resolveHandlerFile(pathname) {
  if (pathname === "/api/auth") return "api/auth.ts";
  if (pathname === "/api/calendar") return "api/calendar.ts";
  if (pathname === "/api/releases") return "api/releases.ts";
  if (pathname === "/api/releases-refresh") return "api/releases-refresh.ts";
  if (pathname === "/api/ratings") return "api/ratings.ts";
  if (pathname === "/api/seasons") return "api/seasons.ts";
  if (pathname === "/api/relations") return "api/relations.ts";
  if (pathname === "/api/agent-relay") return "api/agent-relay.ts";
  // More specific files win over a catch-all one level up — same precedence
  // Vercel's real filesystem router applies. Getting this wrong here once
  // already hid a production bug: this file used to route every
  // /api/watchlist/* path to the catch-all regardless of depth, which matched
  // dev-api-server's own (too permissive) matching rather than what Vercel
  // actually does, so a route that only worked because of that mismatch
  // shipped broken.
  if (/^\/api\/watchlist\/items\/[^/]+$/.test(pathname)) return "api/watchlist/items/[id].ts";
  if (/^\/api\/watchlist\/lists\/[^/]+$/.test(pathname)) return "api/watchlist/lists/[id].ts";

  // The two catch-alls are sub-path-only on purpose: Vercel's router never
  // matches a catch-all against its own bare parent path, so serving
  // /api/tmdb or /api/watchlist here would hide a production 404 in dev —
  // which is exactly how the watchlist shipped broken the first time.
  if (pathname.startsWith("/api/tmdb/")) return "api/tmdb/[...path].ts";
  if (pathname.startsWith("/api/watchlist/")) return "api/watchlist/[...path].ts";
  return null;
}

// Imported once and reused, not per-request: lib/db.ts caches a single
// postgres connection (max: 1) at module scope, so re-importing per request
// would open a fresh connection every time and never close the old one.
const handlerCache = new Map();

async function loadHandler(relativeFile) {
  if (handlerCache.has(relativeFile)) return handlerCache.get(relativeFile);
  const mod = await import(pathToFileURL(path.join(ROOT, relativeFile)).href);
  const handler = mod.default;
  handlerCache.set(relativeFile, handler);
  return handler;
}

const missingEnvWarned = new Set();
function warnOnceIfMissing(name) {
  if (!process.env[name] && !missingEnvWarned.has(name)) {
    missingEnvWarned.add(name);
    console.warn(`[dev-api] ${name} is not set — endpoints that need it will respond with an error or empty data.`);
  }
}
["DATABASE_URL", "TMDB_API_KEY", "OMDB_API_KEY", "AUTH_SECRET", "GOOGLE_CLIENT_ID"].forEach(warnOnceIfMissing);

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  if (!pathname.startsWith("/api/")) {
    res.statusCode = 404;
    res.end("not an /api route");
    return;
  }

  const file = resolveHandlerFile(pathname);
  if (!file) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `no local handler mapped for ${pathname}` }));
    return;
  }

  try {
    const handler = await loadHandler(file);
    await handler(req, res);
  } catch (err) {
    console.error(`[dev-api] ${pathname} ->`, err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    } else {
      res.end();
    }
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // A previous `npm run dev:full` is almost always still alive on this
    // port — that instance is already serving requests fine, so exit quietly
    // instead of a stack trace that reads like a crash.
    console.log(`[dev-api] port ${PORT} is already in use — another dev-api-server is likely still running there.`);
    console.log(`[dev-api] if it's stale, stop it first (Windows: find its PID with \`netstat -ano | findstr :${PORT}\`, then \`taskkill /PID <pid> /F\`).`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`[dev-api] listening on http://localhost:${PORT} (proxied from Vite at /api)`);
});

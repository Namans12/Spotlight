import { createServer } from "node:http";
import { tmdbDetail } from "../../../lib/tmdbProxy.js";
import { assertTmdbConfigured, loadConfig } from "./config.js";
import { corsHeaders } from "./http/cors.js";
import { createRouter, type Handler } from "./http/router.js";
import { createQlooClient } from "./qloo/client.js";
import { getPool } from "./db/pool.js";
import { isKnownTitle } from "./db/titles.js";
import { createRateLimiter } from "./http/rateLimit.js";
import { resolveTitle } from "./resolve.js";
import { boardHandler } from "./routes/board.js";
import { briefHandler } from "./routes/brief.js";
import { warmHandler } from "./routes/warm.js";
import { createBackgroundWarmer, createWarmQueue, warmCities, type WarmDeps } from "./warm.js";
import { createTitleLookup } from "./titleHeader.js";

const config = loadConfig(process.env);
assertTmdbConfigured(config, process.env);

const sql = getPool(config);
const qloo = createQlooClient(config);

const briefRoute = briefHandler({
  sql,
  qloo,
  resolve: (key) => resolveTitle(sql, qloo, key),
  isKnown: (key) => isKnownTitle(sql, key),
  // 30 briefs a minute per client: each one can cost Qloo calls on a public endpoint.
  rateLimiter: createRateLimiter({ max: 30, windowMs: 60_000 }),
  header: createTitleLookup(sql, (mediaType, id) => tmdbDetail(mediaType, id)),
  // Replaced by the real drafter in a later task; until then the brief says so
  // rather than showing an empty box with no explanation.
  draftCampaign: async () => ({ status: "empty", data: null, provenance: [], note: "Campaign drafting is added in a later task." }),
  onError: (context, err) => console.error(`brief: ${context} failed:`, err instanceof Error ? err.message : String(err)),
});

const logError = (context: string, err: unknown) => console.error(`${context} failed:`, err instanceof Error ? err.message : String(err));

// Everything warming needs, shared by the board's background queue and POST /warm.
const warmDeps: WarmDeps = { sql, qloo, resolve: (key) => resolveTitle(sql, qloo, key), onError: logError };
const warmQueue = createWarmQueue({ onError: (key, err) => logError(`warm ${key}`, err) });

const boardRoute = boardHandler({
  sql,
  enqueueWarm: createBackgroundWarmer(warmDeps, warmQueue),
  // Its own limiter: polling the board must not spend a client's brief budget.
  rateLimiter: createRateLimiter({ max: 30, windowMs: 60_000 }),
  onError: logError,
});

const warmRoute = warmHandler({
  secret: config.warmSecret,
  warm: (city) => warmCities(warmDeps, city ? [city] : undefined),
  onError: logError,
});

const healthz: Handler = async (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
};

const route = createRouter({
  "GET /healthz": healthz,
  "GET /brief": briefRoute,
  "GET /board": boardRoute,
  "POST /warm": warmRoute,
});

const server = createServer(async (req, res) => {
  // CORS headers go on before routing so that every response — including 404s
  // and errors — carries them; a browser otherwise reports a CORS failure
  // instead of the real status.
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  for (const [name, value] of Object.entries(corsHeaders(origin, config.allowedOrigins))) {
    res.setHeader(name, value);
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // The Host header is client-controlled and only needed to parse the path
    // and query, so a fixed base avoids trusting it.
    await route(req, res, new URL(req.url ?? "/", "http://pulse.local"));
  } catch (err) {
    console.error("unhandled request error", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "internal_error" }));
  }
});

server.listen(config.port, () => {
  console.log(`pulse listening on :${config.port}`);
});

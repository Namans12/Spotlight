import { createServer } from "node:http";
import { tmdbDetail } from "../../../lib/tmdbProxy.js";
import { assertTmdbConfigured, loadConfig } from "./config.js";
import { corsHeaders } from "./http/cors.js";
import { createRouter, type Handler } from "./http/router.js";
import { createToolProvider } from "./agent/tools.js";
import { createGroqClient } from "./llm/client.js";
import { createQlooClient } from "./qloo/client.js";
import { getPool } from "./db/pool.js";
import { isKnownTitle } from "./db/titles.js";
import { createRateLimiter } from "./http/rateLimit.js";
import { makeDraftCampaign } from "./campaignSection.js";
import { resolveTitle } from "./resolve.js";
import { boardHandler } from "./routes/board.js";
import { briefHandler } from "./routes/brief.js";
import { chatHandler } from "./routes/chat.js";
import { guessHandler } from "./routes/guess.js";
import { warmHandler } from "./routes/warm.js";
import { createBackgroundWarmer, createWarmQueue, warmCities, type WarmDeps } from "./warm.js";
import { createTitleLookup } from "./titleHeader.js";
import { takeUsage } from "./usage.js";

const config = loadConfig(process.env);
assertTmdbConfigured(config, process.env);

const sql = getPool(config);
const qloo = createQlooClient(config);

// Null without GROQ_API_KEY: the brief then says the writer is not configured
// and /guess answers 503, rather than the service refusing to start.
const llm = config.groqApiKey ? createGroqClient(config) : null;
const campaignCaps = { session: config.sessionDailyCampaign, global: config.globalDailyLlm };
const takeCampaignUsage = (session: string) => takeUsage(sql, session, "campaign", campaignCaps);
const logError = (context: string, err: unknown) => console.error(`${context} failed:`, err instanceof Error ? err.message : String(err));
const titleHeader = createTitleLookup(sql, (mediaType, id) => tmdbDetail(mediaType, id));

const briefRoute = briefHandler({
  sql,
  qloo,
  resolve: (key) => resolveTitle(sql, qloo, key),
  isKnown: (key) => isKnownTitle(sql, key),
  // 30 briefs a minute per client: each one can cost Qloo calls on a public endpoint.
  rateLimiter: createRateLimiter({ max: 30, windowMs: 60_000 }),
  header: titleHeader,
  draftCampaign: makeDraftCampaign({ llm, model: config.groqModel, takeUsage: takeCampaignUsage, onError: logError }),
  onError: (context, err) => console.error(`brief: ${context} failed:`, err instanceof Error ? err.message : String(err)),
});

// Everything warming needs, shared by the board's background queue and POST /warm.
const warmDeps: WarmDeps = { sql, qloo, resolve: (key) => resolveTitle(sql, qloo, key), onError: logError };
const warmQueue = createWarmQueue({ onError: (key, err) => logError(`warm ${key}`, err) });
const enqueueWarm = createBackgroundWarmer(warmDeps, warmQueue);

const guessRoute = guessHandler({
  // Its own, stricter limiter than the brief's: every guess is a model call.
  rateLimiter: createRateLimiter({ max: 10, windowMs: 60_000 }),
  isKnown: (key) => isKnownTitle(sql, key),
  header: titleHeader,
  llm,
  takeUsage: takeCampaignUsage,
});

// The chat agent. Its tools read the same tables and call the same Qloo client
// as the routes above, so it can show nothing a brief could not. One usage slot
// is taken per chat turn, however many model rounds it takes.
const takeChatUsage = (session: string) =>
  takeUsage(sql, session, "chat", { session: config.sessionDailyChat, global: config.globalDailyLlm });
const chatRoute = chatHandler({
  // Its own, strictest limiter: one chat is up to six model calls and a handful of Qloo lookups.
  rateLimiter: createRateLimiter({ max: 10, windowMs: 60_000 }),
  llm,
  takeUsage: takeChatUsage,
  getTools: createToolProvider({
    sql,
    qloo,
    resolve: (key) => resolveTitle(sql, qloo, key),
    header: titleHeader,
    isKnown: (key) => isKnownTitle(sql, key),
    enqueueWarm,
    fixtures: config.qlooFixtures,
    onError: logError,
  }),
  onError: logError,
});

const boardRoute = boardHandler({
  sql,
  enqueueWarm,
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
  "GET /guess": guessRoute,
  "GET /board": boardRoute,
  "POST /warm": warmRoute,
  "POST /chat": chatRoute,
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

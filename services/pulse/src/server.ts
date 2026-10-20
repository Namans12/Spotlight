import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { corsHeaders } from "./http/cors.js";
import { createRouter, type Handler } from "./http/router.js";

const config = loadConfig(process.env);

const healthz: Handler = async (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
};

const route = createRouter({
  "GET /healthz": healthz,
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

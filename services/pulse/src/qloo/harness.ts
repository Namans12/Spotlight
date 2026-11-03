// The Qloo harness (`qloo mcp`, from @qloo/qloo-harness) is the only thing in
// this service that talks to Qloo for insights: it resolves names, builds the
// /v2/insights query and normalises the reply. This module owns the process
// and the connection, and nothing about what any Qloo call means; that lives
// in recipes.ts and client.ts.
//
// Two lookups are not workflows in the harness: IMDb-id -> entity
// (GET /entities?external.imdb.ids=) and title search with years (GET
// /search). `qloo api` cannot reach them either (its `entity` takes only
// --id, and `search` prints through a formatter), so they go over a plain
// authenticated GET here, using the same QLOO_API_KEY the child process gets.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { RateLimitedError } from "./limiter.js";

export interface HarnessTool { name: string; description: string; inputSchema: unknown; }

/** One live connection to a harness process. Separate from the transport so
 *  tests can script connections without spawning anything. */
export interface McpSession {
  isAlive(): boolean;
  listTools(): Promise<HarnessTool[]>;
  /** Resolves to the harness's result envelope, already parsed. */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface HarnessTransport {
  listTools(): Promise<HarnessTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Authenticated GET against the Qloo API, for lookups the harness lacks. */
  getJson(path: string, params: Record<string, string>): Promise<unknown>;
  close(): Promise<void>;
}

export interface HarnessTransportOptions {
  connect?: () => Promise<McpSession>;
  env?: Readonly<Record<string, string | undefined>>;
  fetchFn?: typeof fetch;
}

// The host the hackathon key is issued for. The harness would otherwise
// default to api.qloo.com, so the child is pointed here explicitly (see
// childEnv) and the two paths cannot disagree about the host.
const DEFAULT_BASE_URL = "https://hackathon.api.qloo.com";

const REST_TIMEOUT_MS = 15_000;

const harnessBin = fileURLToPath(new URL("../../node_modules/.bin/qloo", import.meta.url));

function baseUrlOf(env: Readonly<Record<string, string | undefined>>): string {
  return (env.QLOO_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

// Only these (and every QLOO_*) reach the child. The service's own secrets,
// GROQ_API_KEY and DATABASE_URL among them, have no business in a third-party
// package's process.
const PASSTHROUGH_ENV = new Set([
  "PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
]);

/** The harness refuses a non-official base URL unless it is also marked
 *  trusted. The operator choosing QLOO_BASE_URL is that decision, so mirror
 *  it rather than make every deploy set two variables to the same value. */
export function buildChildEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const base = baseUrlOf(env);
  const picked: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    if (PASSTHROUGH_ENV.has(k) || k.startsWith("QLOO_")) picked[k] = v;
  }
  picked.QLOO_BASE_URL = base;
  picked.QLOO_TRUSTED_BASE_URL = env.QLOO_TRUSTED_BASE_URL?.trim() || base;
  return Object.fromEntries(Object.entries(picked).filter((e): e is [string, string] => typeof e[1] === "string"));
}

export function parseEnvelope(result: { structuredContent?: unknown; content?: unknown; isError?: unknown }): unknown {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  const text = first && typeof first === "object" && (first as { type?: unknown }).type === "text"
    ? String((first as { text?: unknown }).text)
    : null;
  // An error reply without an envelope (bad arguments, an unknown tool) is
  // plain text; show it rather than a JSON parse failure about it.
  if (result.isError === true) throw new Error(text ?? "Qloo harness returned an error with no details.");
  if (text === null) throw new Error("Qloo harness returned a result with no structured content.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Qloo harness returned a result that is not JSON: ${text.slice(0, 200)}`);
  }
}

async function connectToHarness(env: Readonly<Record<string, string | undefined>>): Promise<McpSession> {
  // Fall back to PATH when the package is not installed beside the service
  // (a global install), rather than failing on a path we guessed.
  const command = existsSync(harnessBin) ? harnessBin : "qloo";
  // `env` must be passed whole: the child reads QLOO_API_KEY from it.
  const transport = new StdioClientTransport({ command, args: ["mcp"], env: buildChildEnv(env) });
  const client = new Client({ name: "spotlight-pulse", version: "0.1.0" });
  let alive = true;
  client.onclose = () => { alive = false; };
  await client.connect(transport);
  return {
    isAlive: () => alive,
    async listTools() {
      const { tools } = await client.listTools();
      return tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema }));
    },
    async callTool(name, args) {
      return parseEnvelope((await client.callTool({ name, arguments: args })) as { structuredContent?: unknown; content?: unknown; isError?: unknown });
    },
    async close() {
      alive = false;
      await client.close();
    },
  };
}

// MCP's ConnectionClosed is -32000; the message check covers a broken pipe
// surfacing as a plain Error before the close event lands.
function looksLikeDeadConnection(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === -32000 || /connection closed|EPIPE/i.test(err instanceof Error ? err.message : String(err));
}

export function createHarnessTransport(opts: HarnessTransportOptions = {}): HarnessTransport {
  const env = opts.env ?? process.env;
  const connect = opts.connect ?? (() => connectToHarness(env));
  const fetchFn = opts.fetchFn ?? fetch;

  let session: McpSession | null = null;
  let starting: Promise<McpSession> | null = null;
  let closed = false;

  // Started lazily so a service that only serves cached briefs never spawns
  // the child, and shared so concurrent first calls do not spawn several.
  const acquire = async (): Promise<McpSession> => {
    if (closed) throw new Error("Qloo harness transport closed");
    if (session?.isAlive()) return session;
    session = null;
    starting ??= connect().then(
      (s) => { session = s; starting = null; return s; },
      (e) => { starting = null; throw e; },
    );
    return starting;
  };

  const drop = (dead: McpSession): void => {
    if (session === dead) session = null;
    void dead.close().catch(() => {});
  };

  // Restart once per call: a dead child gets one fresh start and one retry
  // (the calls are GET-only reads, so repeating one is harmless), after which
  // the failure is real and surfaces.
  const withSession = async <T>(op: (s: McpSession) => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const s = await acquire();
      try {
        return await op(s);
      } catch (err) {
        // A call that failed because close() ran is the shutdown, not a crash.
        if (closed) throw new Error("Qloo harness transport closed");
        const died = !s.isAlive() || looksLikeDeadConnection(err);
        if (!died || attempt >= 1) throw err;
        drop(s);
      }
    }
  };

  return {
    listTools: () => withSession((s) => s.listTools()),
    callTool: (name, args) => withSession((s) => s.callTool(name, args)),
    async getJson(path, params) {
      const key = env.QLOO_API_KEY?.trim();
      if (!key) throw new Error("QLOO_API_KEY is not set; refusing to call Qloo without it.");
      const url = `${baseUrlOf(env)}${path}?${new URLSearchParams(params).toString()}`;
      // Bounded, so a hung lookup frees its limiter slot instead of holding it.
      const res = await fetchFn(url, {
        headers: { "X-Api-Key": key, accept: "application/json" },
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
      });
      if (res.status === 429) throw new RateLimitedError(`Qloo ${path} returned 429`);
      if (!res.ok) throw new Error(`Qloo ${path} returned HTTP ${res.status}`);
      return res.json();
    },
    async close() {
      closed = true;
      const current = session ?? (await starting?.catch(() => null)) ?? null;
      session = null;
      if (current) await current.close();
    },
  };
}

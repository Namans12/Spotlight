import { describe, expect, it } from "vitest";
import { buildChildEnv, createHarnessTransport, parseEnvelope, type McpSession } from "./harness.js";

function fakeSession(over: Partial<McpSession> = {}): McpSession & { closed: boolean; calls: string[] } {
  const s = {
    alive: true,
    closed: false,
    calls: [] as string[],
    isAlive() { return this.alive; },
    async listTools() { return [{ name: "qloo_find_tags", description: "d", inputSchema: { type: "object" } }]; },
    async callTool(name: string) { this.calls.push(name); return { status: "ok", results: [] }; },
    async close() { this.closed = true; this.alive = false; },
    ...over,
  };
  return s as McpSession & { closed: boolean; calls: string[] };
}

describe("the harness transport", () => {
  it("does not start the harness until the first call, then shares one connection", async () => {
    let connects = 0;
    const session = fakeSession();
    const t = createHarnessTransport({ connect: async () => { connects++; return session; } });
    expect(connects).toBe(0);
    await t.callTool("qloo_find_tags", {});
    await t.callTool("qloo_find_tags", {});
    await t.listTools();
    expect(connects).toBe(1);
  });

  it("restarts the harness once when it died, and retries the call on the new connection", async () => {
    const first = fakeSession({
      async callTool() { (this as any).alive = false; throw new Error("MCP error -32000: Connection closed"); },
    });
    const second = fakeSession();
    const sessions = [first, second];
    let connects = 0;
    const t = createHarnessTransport({ connect: async () => sessions[connects++]! });
    await expect(t.callTool("qloo_find_tags", {})).resolves.toEqual({ status: "ok", results: [] });
    expect(connects).toBe(2);
    expect(second.calls).toEqual(["qloo_find_tags"]);
  });

  it("gives up after one restart when the second connection dies too", async () => {
    const dying = () => fakeSession({
      async callTool() { (this as any).alive = false; throw new Error("Connection closed"); },
    });
    let connects = 0;
    const t = createHarnessTransport({ connect: async () => { connects++; return dying(); } });
    await expect(t.callTool("qloo_find_tags", {})).rejects.toThrow("Connection closed");
    expect(connects).toBe(2);
  });

  it("does not restart for an error from a connection that is still alive", async () => {
    let connects = 0;
    const t = createHarnessTransport({
      connect: async () => { connects++; return fakeSession({ async callTool() { throw new Error("bad arguments"); } }); },
    });
    await expect(t.callTool("qloo_find_tags", {})).rejects.toThrow("bad arguments");
    expect(connects).toBe(1);
  });

  it("closes the connection it opened, and is a no-op when it never opened one", async () => {
    const session = fakeSession();
    const t = createHarnessTransport({ connect: async () => session });
    await t.close();
    expect(session.closed).toBe(false);

    const used = fakeSession();
    const t2 = createHarnessTransport({ connect: async () => used });
    await t2.callTool("qloo_find_tags", {});
    await t2.close();
    expect(used.closed).toBe(true);
  });

  it("does not respawn the harness for a call that failed because close() ran", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let connects = 0;
    const session = fakeSession({
      async callTool() {
        await gate;
        throw new Error("MCP error -32000: Connection closed");
      },
    });
    const t = createHarnessTransport({ connect: async () => { connects++; return session; } });
    const inFlight = t.callTool("qloo_find_tags", {});
    const settled = expect(inFlight).rejects.toThrow(/transport closed/i);
    await Promise.resolve();
    await Promise.resolve();
    await t.close();
    release();
    await settled;
    expect(connects).toBe(1);
    await expect(t.callTool("qloo_find_tags", {})).rejects.toThrow(/transport closed/i);
    expect(connects).toBe(1);
  });

  it("times a REST lookup out instead of holding a limiter slot forever", async () => {
    let signal: AbortSignal | null | undefined;
    const t = createHarnessTransport({
      connect: async () => fakeSession(),
      env: { QLOO_API_KEY: "k" },
      fetchFn: async (_url, init) => {
        signal = init?.signal;
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    });
    await expect(t.getJson("/search", { query: "x" })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the Qloo key as X-Api-Key to the configured base URL for REST lookups", async () => {
    const seen: { url: string; key: string | null }[] = [];
    const t = createHarnessTransport({
      connect: async () => fakeSession(),
      env: { QLOO_API_KEY: "test-key-123", QLOO_BASE_URL: "https://qloo.example.test" },
      fetchFn: async (url, init) => {
        seen.push({ url: String(url), key: new Headers(init?.headers).get("x-api-key") });
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      },
    });
    await t.getJson("/entities", { "external.imdb.ids": "tt1" });
    expect(seen).toEqual([{ url: "https://qloo.example.test/entities?external.imdb.ids=tt1", key: "test-key-123" }]);
  });

  it("maps a REST 429 to a rate-limit error the limiter can retry", async () => {
    const t = createHarnessTransport({
      connect: async () => fakeSession(),
      env: { QLOO_API_KEY: "k" },
      fetchFn: async () => new Response("slow down", { status: 429 }),
    });
    await expect(t.getJson("/search", { query: "x" })).rejects.toMatchObject({ name: "RateLimitedError" });
  });

  it("refuses a REST lookup without a key rather than sending an unauthenticated request", async () => {
    let called = false;
    const t = createHarnessTransport({
      connect: async () => fakeSession(),
      env: {},
      fetchFn: async () => { called = true; return new Response("{}"); },
    });
    await expect(t.getJson("/search", { query: "x" })).rejects.toThrow(/QLOO_API_KEY/);
    expect(called).toBe(false);
  });
});

describe("buildChildEnv", () => {
  it("hands the harness the Qloo settings and the basics, but none of the service's other secrets", () => {
    const env = buildChildEnv({
      PATH: "/usr/bin", HOME: "/home/x", HTTPS_proxy: "http://p", https_proxy: "http://p", NODE_OPTIONS: "--x",
      QLOO_API_KEY: "test-key-123", QLOO_HOME: "/q",
      DATABASE_URL: "postgres://secret", GROQ_API_KEY: "groq-secret", PULSE_WARM_SECRET: "warm",
    });
    expect(env.QLOO_API_KEY).toBe("test-key-123");
    expect(env.QLOO_HOME).toBe("/q");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/x");
    expect(env.https_proxy).toBe("http://p");
    expect(env.NODE_OPTIONS).toBe("--x");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("GROQ_API_KEY");
    expect(env).not.toHaveProperty("PULSE_WARM_SECRET");
  });

  it("points the child at one base URL and trusts it", () => {
    expect(buildChildEnv({}).QLOO_BASE_URL).toBe("https://hackathon.api.qloo.com");
    expect(buildChildEnv({}).QLOO_TRUSTED_BASE_URL).toBe("https://hackathon.api.qloo.com");
    const custom = buildChildEnv({ QLOO_BASE_URL: "https://q.example.test/" });
    expect(custom.QLOO_BASE_URL).toBe("https://q.example.test");
    expect(custom.QLOO_TRUSTED_BASE_URL).toBe("https://q.example.test");
  });
});

describe("parseEnvelope", () => {
  it("prefers structured content", () => {
    expect(parseEnvelope({ structuredContent: { status: "ok" }, content: [] })).toEqual({ status: "ok" });
  });

  it("surfaces an isError text reply as the error rather than failing to parse it", () => {
    expect(() => parseEnvelope({ isError: true, content: [{ type: "text", text: "Invalid arguments for qloo_recommend" }] }))
      .toThrow("Invalid arguments for qloo_recommend");
  });
});

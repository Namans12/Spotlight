import { describe, expect, it } from "vitest";
import { createHarnessTransport, type McpSession } from "./harness.js";

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
    await t.callTool("qloo_find_tags", {});
    await t.close();
    expect(session.closed).toBe(true);
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

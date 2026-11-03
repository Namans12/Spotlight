import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { readJsonBody } from "./body.js";

const req = (stream: Readable, headers: Record<string, string> = {}) => Object.assign(stream, { headers }) as unknown as IncomingMessage;
const from = (...parts: (string | Buffer)[]) => Readable.from(parts, { objectMode: false });

describe("readJsonBody", () => {
  it("parses a JSON object body sent as application/json", async () => {
    const out = await readJsonBody(req(from('{"a":', "1}"), { "content-type": "application/json; charset=utf-8" }), 1000);
    expect(out).toEqual({ ok: true, value: { a: 1 } });
  });

  it.each([[undefined], ["text/plain"], ["application/x-www-form-urlencoded"], ["application/jsonx"]])("rejects the content type %s", async (ct) => {
    const out = await readJsonBody(req(from("{}"), ct ? { "content-type": ct } : {}), 1000);
    expect(out).toEqual({ ok: false, reason: "bad_request" });
  });

  it.each([["{nope"], [""], ["[1]"], ["null"], ["42"], ['"s"']])("rejects the body %j as bad_request", async (body) => {
    const out = await readJsonBody(req(from(body), { "content-type": "application/json" }), 1000);
    expect(out).toEqual({ ok: false, reason: "bad_request" });
  });

  it("rejects, without reading, a declared length over the limit", async () => {
    let pulled = 0;
    const stream = new Readable({ read() { pulled++; this.push("x"); } });
    const out = await readJsonBody(req(stream, { "content-type": "application/json", "content-length": "5000" }), 1000);
    expect(out).toEqual({ ok: false, reason: "too_large" });
    expect(pulled).toBeLessThan(5);
    stream.destroy();
  });

  it("stops at the limit when the length is not declared, without waiting for the end of the stream, then discards a bounded remainder and hangs up", async () => {
    // A body that never ends: the result must still arrive, as soon as the limit is crossed.
    let sent = 0;
    const stream = new Readable({ read() { sent += 1000; this.push("x".repeat(1000)); } });
    const out = await readJsonBody(req(stream, { "content-type": "application/json" }), 10_000, { drainBytes: 5000 });
    expect(out).toEqual({ ok: false, reason: "too_large" });
    await vi.waitFor(() => expect(stream.destroyed).toBe(true));
    // The limit, plus the drain, plus whatever the stream had already buffered: never an endless read.
    expect(sent).toBeLessThan(10_000 + 5000 + 100_000);
  });

  it("accepts a body of exactly the limit", async () => {
    const body = JSON.stringify({ k: "x".repeat(90) });
    const out = await readJsonBody(req(from(body), { "content-type": "application/json" }), Buffer.byteLength(body));
    expect(out.ok).toBe(true);
  });

  it("counts bytes, not characters", async () => {
    const body = JSON.stringify({ k: "é".repeat(60) }); // 2 bytes each
    const out = await readJsonBody(req(from(body), { "content-type": "application/json" }), body.length + 10);
    expect(out).toEqual({ ok: false, reason: "too_large" });
  });
});

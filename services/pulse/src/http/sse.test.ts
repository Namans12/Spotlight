import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { manualTimers } from "../testing/agent.js";
import { startSse, writeEvent, writeSseHead } from "./sse.js";

class FakeRes extends EventEmitter {
  status = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  writableEnded = false;
  headersFlushed = false;
  writeHead(status: number, headers: Record<string, string>) { this.status = status; this.headers = headers; return this; }
  flushHeaders() { this.headersFlushed = true; }
  write(chunk: string) { this.chunks.push(chunk); return true; }
  end() { this.writableEnded = true; this.emit("close"); }
  get body() { return this.chunks.join(""); }
}
const fake = () => new FakeRes() as unknown as ServerResponse & FakeRes;

describe("writeSseHead", () => {
  it("sends 200 with the event-stream headers a proxy needs, and flushes them", () => {
    const res = fake();
    writeSseHead(res);
    expect(res.status).toBe(200);
    expect(res.headers).toEqual({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    expect(res.headersFlushed).toBe(true);
  });
});

describe("writeEvent", () => {
  it("frames an event as `data: <json>` and a blank line", () => {
    const res = fake();
    expect(writeEvent(res, { type: "message", text: "hi\nthere" })).toBe(true);
    expect(res.body).toBe('data: {"type":"message","text":"hi\\nthere"}\n\n');
  });
  it("writes nothing once the response has ended", () => {
    const res = fake();
    res.writableEnded = true;
    expect(writeEvent(res, { type: "done" })).toBe(false);
    expect(res.body).toBe("");
  });
});

describe("startSse", () => {
  it("opens the stream, writes events, and ends it", () => {
    const res = fake();
    const sse = startSse(res, { timers: manualTimers() });
    expect(res.status).toBe(200);
    expect(sse.write({ type: "done" })).toBe(true);
    sse.end();
    expect(res.body).toBe('data: {"type":"done"}\n\n');
    expect(res.writableEnded).toBe(true);
  });

  it("sends a `: ping` comment every 15 seconds, from an injected timer", () => {
    const res = fake();
    const timers = manualTimers();
    startSse(res, { timers });
    expect(timers.intervalMs).toEqual([15_000]);
    timers.fire();
    timers.fire();
    expect(res.body).toBe(": ping\n\n: ping\n\n");
  });

  it("clears the keep-alive timer when the stream ends", () => {
    const res = fake();
    const timers = manualTimers();
    const sse = startSse(res, { timers });
    expect(timers.pending()).toBe(1);
    sse.end();
    expect(timers.pending()).toBe(0);
  });

  it("when the client disconnects it stops writing, stops pinging, and aborts the signal", () => {
    const res = fake();
    const timers = manualTimers();
    const sse = startSse(res, { timers });
    expect(sse.signal.aborted).toBe(false);
    res.emit("close");
    expect(sse.closed).toBe(true);
    expect(sse.signal.aborted).toBe(true);
    expect(timers.pending()).toBe(0);
    expect(sse.write({ type: "done" })).toBe(false);
    expect(res.body).toBe("");
    expect(() => sse.end()).not.toThrow();
  });

  it("a response already destroyed before streaming starts is closed at once: no head, no timer, signal aborted", () => {
    const res = fake();
    (res as { destroyed: boolean }).destroyed = true;
    const timers = manualTimers();
    const sse = startSse(res, { timers });
    expect(sse.closed).toBe(true);
    expect(sse.signal.aborted).toBe(true);
    expect(res.status).toBe(0);
    expect(timers.pending()).toBe(0);
    expect(sse.write({ type: "done" })).toBe(false);
    expect(res.body).toBe("");
    expect(() => sse.end()).not.toThrow();
  });

  it("a response that has already ended counts as gone too", () => {
    const res = fake();
    res.writableEnded = true;
    const sse = startSse(res, { timers: manualTimers() });
    expect(sse.closed).toBe(true);
    expect(sse.signal.aborted).toBe(true);
  });

  it("does not ping a stream that has already ended", () => {
    const res = fake();
    const timers = manualTimers();
    startSse(res, { timers });
    res.writableEnded = true; // ended behind our back
    timers.fire();
    expect(res.body).toBe("");
  });
});

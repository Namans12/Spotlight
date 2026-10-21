import type { ServerResponse } from "node:http";
import { realTimers, type Timers } from "../timers.js";

/** Starts a server-sent-events response. Headers go out immediately so a proxy
 *  or browser sees the stream open before the first event is ready;
 *  `X-Accel-Buffering: no` tells nginx-style proxies not to hold the body back. */
export function writeSseHead(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
}

/** One event as `data: <json>` and a blank line. False (and a no-op) once the response has ended. */
export function writeEvent(res: ServerResponse, event: unknown): boolean {
  if (res.writableEnded) return false;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  return true;
}

const PING_MS = 15_000;

export interface SseStream {
  /** Aborted when the client's connection closes, so producers can stop. */
  signal: AbortSignal;
  readonly closed: boolean;
  /** Writes one event; false (and a no-op) once the client is gone. */
  write(event: unknown): boolean;
  end(): void;
}

/** An SSE response with a keep-alive. A comment line (`: ping`) every 15 s
 *  keeps proxies from closing a stream that is quiet while a slow tool runs.
 *  The timer is cleared as soon as the stream ends or the client goes, and is
 *  unref'd so it can never hold the process open. */
export function startSse(res: ServerResponse, opts: { timers?: Timers } = {}): SseStream {
  const timers = opts.timers ?? realTimers;
  const ac = new AbortController();
  // A client can disconnect before the stream is opened (while the caller was
  // awaiting something else), and "close" has then already fired: a listener
  // registered now would never hear it. So the stream starts already closed.
  if (res.destroyed || res.writableEnded) {
    ac.abort();
    return {
      signal: ac.signal,
      closed: true,
      write: () => false,
      end() { /* nothing was started, nothing to end */ },
    };
  }
  writeSseHead(res);
  let closed = false;

  const ping = timers.setInterval(() => {
    if (closed || res.writableEnded) return;
    res.write(": ping\n\n");
  }, PING_MS);
  (ping as { unref?: () => void } | null)?.unref?.();
  const stop = () => timers.clearInterval(ping);

  // "close" fires for a normal end as well as a dropped connection; either
  // way there is nothing further to write.
  res.on("close", () => { closed = true; stop(); ac.abort(); });

  return {
    signal: ac.signal,
    get closed() { return closed; },
    write(event) {
      if (closed) return false;
      return writeEvent(res, event);
    },
    end() {
      stop();
      if (!closed && !res.writableEnded) res.end();
    },
  };
}

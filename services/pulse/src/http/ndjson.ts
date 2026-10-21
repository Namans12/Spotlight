import type { ServerResponse } from "node:http";

export interface NdjsonStream {
  /** Aborted when the client's connection closes, so producers can stop. */
  signal: AbortSignal;
  readonly closed: boolean;
  /** Writes one event as a line and flushes it; false (and a no-op) once the client is gone. */
  write(event: unknown): boolean;
  end(): void;
}

/** Starts a newline-delimited JSON response. Headers go out immediately so a
 *  proxy or browser sees the stream open before the first event is ready. */
export function startNdjson(res: ServerResponse): NdjsonStream {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    // Tells nginx-style proxies not to hold the body back until it is complete.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const ac = new AbortController();
  let closed = false;
  // "close" fires for a normal end as well as a dropped connection; either
  // way there is nothing further to write.
  res.on("close", () => { closed = true; ac.abort(); });
  return {
    signal: ac.signal,
    get closed() { return closed; },
    write(event) {
      if (closed || res.writableEnded) return false;
      res.write(`${JSON.stringify(event)}\n`);
      return true;
    },
    end() {
      if (!closed && !res.writableEnded) res.end();
    },
  };
}

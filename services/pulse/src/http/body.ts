import type { IncomingMessage } from "node:http";

export type BodyResult = { ok: true; value: Record<string, unknown> } | { ok: false; reason: "bad_request" | "too_large" };

/** After the limit is crossed the rest of the body is read and thrown away,
 *  up to this much, so the 413 reaches a client that is still sending (closing
 *  a socket with unread data can reset it before it reads the answer). */
const DRAIN_BYTES = 1024 * 1024;

/** Reads a JSON object body of at most `maxBytes`. The limit is enforced while
 *  reading, byte by byte, so an oversized or never-ending body is refused as
 *  soon as it crosses the line and is never held in memory; a declared
 *  Content-Length over the limit is refused without reading at all. A wrong
 *  content type, invalid JSON, or JSON that is not an object is "bad_request". */
export function readJsonBody(req: IncomingMessage, maxBytes: number, opts: { drainBytes?: number } = {}): Promise<BodyResult> {
  const drainBytes = opts.drainBytes ?? DRAIN_BYTES;
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return Promise.resolve({ ok: false, reason: "bad_request" });

  const declared = Number(req.headers["content-length"]);
  const tooLarge = (alreadyRead: number): BodyResult => {
    // Discard what is still coming (bounded), then hang up.
    let drained = alreadyRead;
    req.on("data", (c: Buffer) => {
      drained += c.length;
      if (drained > maxBytes + drainBytes) req.destroy();
    });
    req.on("error", () => {});
    req.resume();
    return { ok: false, reason: "too_large" };
  };
  if (Number.isFinite(declared) && declared > maxBytes) return Promise.resolve(tooLarge(0));

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (r: BodyResult) => { if (!settled) { settled = true; resolve(r); } };

    const onData = (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        req.off("data", onData);
        req.off("end", onEnd);
        finish(tooLarge(size));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return finish({ ok: false, reason: "bad_request" }); }
      if (typeof value !== "object" || value === null || Array.isArray(value)) return finish({ ok: false, reason: "bad_request" });
      finish({ ok: true, value: value as Record<string, unknown> });
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", () => finish({ ok: false, reason: "bad_request" }));
    req.on("close", () => finish({ ok: false, reason: "bad_request" }));
  });
}

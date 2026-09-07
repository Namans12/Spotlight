import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../../../lib/db.js";
import { requireUserId } from "../../../lib/auth.js";
import { moveWatchlistItem, removeWatchlistItem } from "../../../lib/watchlistDb.js";
import type { Bucket } from "../../../shared/types/watchlist.js";

// Split out of api/watchlist/[...path].ts: that catch-all's route pattern only
// ever matches a SINGLE path segment on this deployment (confirmed via
// X-Vercel-Id — a failing request never leaves the edge region, so it's Vercel
// never invoking the function at all, not a bug in the handler). Every /:id
// path under /api/watchlist therefore needs its own single-bracket dynamic
// file rather than living behind the catch-all one level deeper.

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (body === undefined) {
    res.end();
  } else {
    res.end(JSON.stringify(body));
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const userId = requireUserId(req, res);
  if (userId === null) return;

  const url = new URL(req.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/api/watchlist/items/")[1]?.split("/").filter(Boolean) ?? [];
  const dbId = Number(segments[0]);
  if (!Number.isFinite(dbId)) return sendJson(res, 400, { error: "invalid id" });

  const sql = getDb();

  try {
    if (req.method === "PATCH") {
      const body: { bucket: Bucket; listId?: number } = JSON.parse(await readBody(req));
      if (!body.bucket) return sendJson(res, 400, { error: "bucket is required" });
      const item = await moveWatchlistItem(sql, userId, dbId, body.bucket, body.listId ?? null);
      if (!item) return sendJson(res, 404, { error: "not found" });
      return sendJson(res, 200, item);
    }
    if (req.method === "DELETE") {
      await removeWatchlistItem(sql, userId, dbId);
      return sendJson(res, 204, undefined);
    }
    return sendJson(res, 405, { error: "method not allowed" });
  } catch (err) {
    console.error("[watchlist] item request failed", err);
    return sendJson(res, 500, { error: "could not complete that request" });
  }
}

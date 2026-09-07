import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../../../lib/db.js";
import { requireUserId } from "../../../lib/auth.js";
import { renameCustomList, deleteCustomList } from "../../../lib/watchlistDb.js";

// See api/watchlist/items/[id].ts for why this lives in its own file rather
// than behind the api/watchlist/[...path].ts catch-all one level deeper.

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
  const segments = url.pathname.split("/api/watchlist/lists/")[1]?.split("/").filter(Boolean) ?? [];
  const listId = Number(segments[0]);
  if (!Number.isFinite(listId)) return sendJson(res, 400, { error: "invalid id" });

  const sql = getDb();

  try {
    if (req.method === "PATCH") {
      const { name } = JSON.parse(await readBody(req));
      if (!name || typeof name !== "string") return sendJson(res, 400, { error: "name is required" });
      const list = await renameCustomList(sql, userId, listId, name);
      if (!list) return sendJson(res, 404, { error: "not found" });
      return sendJson(res, 200, list);
    }
    if (req.method === "DELETE") {
      await deleteCustomList(sql, userId, listId);
      return sendJson(res, 204, undefined);
    }
    return sendJson(res, 405, { error: "method not allowed" });
  } catch (err) {
    console.error("[watchlist] list request failed", err);
    return sendJson(res, 500, { error: "could not complete that request" });
  }
}

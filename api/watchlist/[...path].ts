import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../../lib/db.js";
import { requireUserId } from "../../lib/auth.js";
import { getWatchlistState, addWatchlistItem, reorderBucket, createCustomList } from "../../lib/watchlistDb.js";
import { setProgress, clearProgress } from "../../lib/progressDb.js";
import type { AddWatchlistItemBody, Bucket } from "../../shared/types/watchlist.js";

// Catch-all for the FLAT /api/watchlist/* routes (state, items, reorder,
// lists) — Vercel Hobby caps a deployment at 12 serverless functions, so these
// share one function instead of four separate files.
//
// /items/:id and /lists/:id are deliberately NOT here — see
// api/watchlist/items/[id].ts. This catch-all's route pattern only ever
// matches a single path segment on this deployment (confirmed via
// X-Vercel-Id: a request for a 2-segment path never leaves the edge region,
// so Vercel itself never invokes this function for it — not a bug in the code
// below). Every route two segments deep needs its own single-bracket dynamic
// file instead.
//
// Bare /api/watchlist (no segment at all) also 404s before this function ever
// runs, which is why every route here lives on a named sub-path rather than
// the catch-all's own root.

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
  // pathname: /api/watchlist/{state|items|items/:id|reorder|lists|lists/:id}
  const afterWatchlist = url.pathname.split("/api/watchlist")[1] ?? "";
  const segments = afterWatchlist.split("/").filter(Boolean);
  const sql = getDb();

  try {
    // /api/watchlist/state
    if (segments.length === 1 && segments[0] === "state") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      return sendJson(res, 200, await getWatchlistState(sql, userId));
    }

    // /api/watchlist/items
    if (segments.length === 1 && segments[0] === "items") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
      const body: AddWatchlistItemBody = JSON.parse(await readBody(req));
      if (!body.tmdbId || !body.mediaType || !body.bucket) {
        return sendJson(res, 400, { error: "tmdbId, mediaType, and bucket are required" });
      }
      return sendJson(res, 201, await addWatchlistItem(sql, userId, body));
    }

    // /api/watchlist/progress — where this account is up to in a series.
    //
    // Lives here rather than in a file of its own because the deployment sits
    // at Vercel Hobby's 12-serverless-function cap, and because progress is
    // read as part of the watchlist state anyway (GET /state returns it). Only
    // the write needs a route.
    //
    // A null season clears the row instead of writing a zero: "not started" is
    // the absence of a pointer, not a pointer at episode zero.
    if (segments.length === 1 && segments[0] === "progress") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
      const body = JSON.parse(await readBody(req));
      const tmdbId = Number(body?.tmdbId);
      const mediaType = body?.mediaType;

      if (!Number.isFinite(tmdbId) || tmdbId <= 0 || mediaType !== "tv") {
        return sendJson(res, 400, { error: "tmdbId and mediaType 'tv' are required" });
      }

      if (body.season === null) {
        await clearProgress(sql, userId, tmdbId, mediaType);
        return sendJson(res, 200, { ok: true });
      }

      const season = Number(body?.season);
      const episode = Number(body?.episode);
      // Rejected rather than clamped. The client already knows the season list
      // and clamps before sending (src/lib/progress.ts); a request arriving
      // here with season 0 is a bug or a hand-rolled call, and silently
      // rewriting it to something else would hide both.
      if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1) {
        return sendJson(res, 400, { error: "season and episode must be positive integers, or season null to clear" });
      }

      await setProgress(sql, userId, { tmdbId, mediaType, season, episode });
      return sendJson(res, 200, { ok: true });
    }

    // /api/watchlist/reorder
    if (segments.length === 1 && segments[0] === "reorder") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
      const body: { bucket: Bucket; listId?: number | null; orderedIds: number[] } = JSON.parse(await readBody(req));
      if (!body.bucket || !Array.isArray(body.orderedIds)) {
        return sendJson(res, 400, { error: "bucket and orderedIds are required" });
      }
      await reorderBucket(sql, userId, body.bucket, body.listId ?? null, body.orderedIds);
      return sendJson(res, 200, { ok: true });
    }

    // /api/watchlist/lists
    if (segments.length === 1 && segments[0] === "lists") {
      if (req.method === "GET") {
        const rows = await sql`SELECT id, name, created_at FROM custom_lists WHERE user_id = ${userId} ORDER BY created_at ASC`;
        return sendJson(
          res,
          200,
          rows.map((r: any) => ({ id: Number(r.id), name: r.name, createdAt: new Date(r.created_at).getTime() })),
        );
      }
      if (req.method === "POST") {
        const { name } = JSON.parse(await readBody(req));
        if (!name || typeof name !== "string") return sendJson(res, 400, { error: "name is required" });
        return sendJson(res, 201, await createCustomList(sql, userId, name));
      }
      return sendJson(res, 405, { error: "method not allowed" });
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (err) {
    // Logged in full, reported generically: a raw driver message can carry
    // table names, column names, constraint names and connection detail, and
    // this route is reachable by any signed-in user. Matches api/calendar.ts.
    console.error("[watchlist] request failed", err);
    return sendJson(res, 500, { error: "could not complete that request" });
  }
}

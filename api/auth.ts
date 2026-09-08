import type { IncomingMessage, ServerResponse } from "http";
import { createSessionCookie, clearSessionCookie, getSessionUserId, verifyGoogleIdToken } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import {
  upsertUserFromGoogle,
  upsertGuestUser,
  getUserById,
  guestSessionsEnabled,
  setNotifyWatchlistDrops,
} from "../lib/usersDb.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "GET") {
    const userId = getSessionUserId(req);
    if (userId === null) {
      res.statusCode = 200;
      res.end(JSON.stringify({ authenticated: false, user: null }));
      return;
    }
    // The cookie only proves an id; the row it names may have been deleted
    // (or never existed, if the signing secret rotated). Treat that as
    // logged-out rather than erroring the whole app.
    const user = await getUserById(getDb(), userId);
    res.statusCode = 200;
    res.end(JSON.stringify({ authenticated: user !== null, user }));
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");

      // Guest sign-in: no Google identity involved, just the same session
      // cookie pointing at one fixed demo account — lets a WebMCP tool call
      // establish a session on its own, with nothing for a judge to click
      // through first. See upsertGuestUser for why it's the same account
      // every time rather than a fresh row per visit.
      //
      // Gated on DEMO_GUEST because that shared account is only acceptable on
      // the hackathon deployment (see guestSessionsEnabled). A public host
      // leaves it off and every visitor signs in with Google, which is what
      // makes "private per account" actually true. 404, not 403: with the
      // flag off this route does not exist on this deployment.
      if (parsed.guest === true) {
        if (!guestSessionsEnabled()) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "guest sessions are not enabled on this deployment" }));
          return;
        }
        const user = await upsertGuestUser(getDb());
        res.statusCode = 200;
        res.setHeader("Set-Cookie", createSessionCookie(user.id));
        res.end(JSON.stringify({ ok: true, user }));
        return;
      }

      const { idToken } = parsed;

      if (typeof idToken !== "string" || !idToken) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "idToken is required" }));
        return;
      }

      let google;
      try {
        google = await verifyGoogleIdToken(idToken);
      } catch (err) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "Google sign-in could not be verified" }));
        return;
      }

      const user = await upsertUserFromGoogle(getDb(), google);

      res.statusCode = 200;
      res.setHeader("Set-Cookie", createSessionCookie(user.id));
      res.end(JSON.stringify({ ok: true, user }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // Account preferences. Folded into this function rather than given its own
  // route because Vercel Hobby caps a deployment at 12 serverless functions
  // and this one is already at the cap — see api/ratings.ts for the same
  // reasoning applied to a two-mode read.
  if (req.method === "PATCH") {
    const userId = getSessionUserId(req);
    if (userId === null) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse((await readBody(req)) || "{}");
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "body must be JSON" }));
      return;
    }

    // Strictly boolean. Accepting anything truthy would let a stray "false"
    // string switch email alerts *on* for a real address.
    if (typeof parsed.notifyWatchlistDrops !== "boolean") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "notifyWatchlistDrops must be true or false" }));
      return;
    }

    try {
      const user = await setNotifyWatchlistDrops(getDb(), userId, parsed.notifyWatchlistDrops);
      if (!user) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "account not found" }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, user }));
    } catch (err) {
      console.error("[auth] preference update failed", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "could not save that preference" }));
    }
    return;
  }

  if (req.method === "DELETE") {
    res.statusCode = 200;
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: "method not allowed" }));
}

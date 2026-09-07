import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../lib/db.js";
import { requireUserId, getSessionUserId } from "../lib/auth.js";
import { isRateLimited } from "../lib/rateLimit.js";
import {
  getRelations,
  suppressRelation,
  hasFreshCollectionLookup,
  recordCollectionLookup,
  writeCollectionChain,
  DEFAULT_DEPTH,
  MAX_DEPTH,
  type RelationKey,
  type TitleRelationsDTO,
} from "../lib/relationsDb.js";
import { tmdbCollectionParts } from "../lib/tmdbProxy.js";

// Must Watch / Can Watch relations for a title (migrations/0003_title_relations.sql,
// migrations/0007_multi_user_accounts.sql).
//
//   GET  /api/relations?type=movie&id=693134&depth=1     public, read-only
//   POST /api/relations  { from, to, action: "suppress" } any signed-in user, 204
//
// Suppression is per-user (user_relation_suppressions), not a write to
// title_relations — one person hiding a wrong "Must Watch" link must not
// remove it for everyone else. It's still the only way to correct a
// structured edge for yourself: the upsert precedence ladder means a
// lower-trust generator can never overwrite a higher-trust one, so a wrong
// 'tmdb' edge is fixed by thumbing it down, not by regenerating.
//
// GET is decorative, same posture as ratings: Postgres down, table missing,
// malformed row — it answers 200 with empty arrays, never an error, because a
// title detail page must never fail to render over a relation lookup failing.
// POST is the opposite: it is a deliberate write, so it reports failure.

const CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";

// A request-path warm makes two sequential TMDB calls and must finish well
// inside vercel.json's 15s maxDuration, or the platform kills the function and
// the caller gets an opaque error page instead of this file's degrade-to-empty
// behaviour. Bounded by wall clock rather than attempt count, so a transient
// connection reset (which TMDB produces often enough to matter) is still
// retried — it just stops when the budget is gone.
const WARM_TMDB_ATTEMPTS = 3;
const WARM_TMDB_BUDGET_MS = 9_000;

const EMPTY_RELATIONS = {
  mustWatch: { before: [], after: [] },
  canWatch: [],
  origin: null,
  depth: DEFAULT_DEPTH,
  hasMore: false,
};

function sendJson(res: ServerResponse, status: number, body: unknown, cacheControl: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", cacheControl);
  res.end(JSON.stringify(body ?? null));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Accepts { mediaType | media_type, tmdbId | tmdb_id } and returns null when
 *  either field is unusable, so a malformed body is a 400 rather than a write
 *  against a garbage key. */
function parseKey(raw: unknown): RelationKey | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const mediaType = value.mediaType ?? value.media_type;
  const tmdbId = Number(value.tmdbId ?? value.tmdb_id);
  if (mediaType !== "movie" && mediaType !== "tv") return null;
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;
  return { tmdbId, mediaType };
}

async function handleSuppress(req: IncomingMessage, res: ServerResponse) {
  // Any signed-in user may suppress an edge — for themselves only, checked
  // before anything is read or parsed.
  const userId = requireUserId(req, res);
  if (userId === null) return;

  // Unlike GET, this writes a row per call and nothing else bounds how many.
  // A real person thumbs an edge down a handful of times; anything at request
  // rate is a script filling user_relation_suppressions. 429 rather than a
  // silent empty answer, because the caller needs to know the write did not
  // land (see this file's header on why POST reports failure and GET doesn't).
  if (isRateLimited(req)) {
    return sendJson(res, 429, { error: "too many requests" }, "no-store");
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return sendJson(res, 400, { error: "body must be JSON" }, "no-store");
  }

  if (body.action !== "suppress") {
    return sendJson(res, 400, { error: 'action must be "suppress"' }, "no-store");
  }
  const from = parseKey(body.from);
  const to = parseKey(body.to);
  if (!from || !to) {
    return sendJson(res, 400, { error: "from and to each need mediaType (movie|tv) and a positive tmdbId" }, "no-store");
  }

  try {
    await suppressRelation(getDb(), userId, from, to);
  } catch (err) {
    console.error("[relations] suppress failed", err);
    // Unlike GET, a failed write is reported: silently swallowing it would let
    // the UI claim an edge was hidden when it is still live.
    return sendJson(res, 500, { error: "could not suppress relation" }, "no-store");
  }

  res.statusCode = 204;
  res.setHeader("Cache-Control", "no-store");
  return res.end();
}

/**
 * Fills a title's chain from its TMDB collection the first time anyone asks.
 *
 * This is what makes relations work for any title rather than only the few
 * hundred the offline generators covered — search The Godfather and the chain
 * is there, because the first visitor pays two TMDB calls and everyone after
 * reads Postgres. The whole collection is written, not just this title's
 * neighbours, so one lookup warms the entire franchise.
 *
 * Returns true when something was written and the caller should re-read.
 */
async function warmFromCollection(
  sql: ReturnType<typeof getDb>,
  key: RelationKey,
  current: TitleRelationsDTO,
): Promise<boolean> {
  // TMDB has no collection concept for TV, and a title that already has a
  // chain needs nothing. Both are cheap outs before any network call.
  if (key.mediaType !== "movie") return false;
  if (current.mustWatch.before.length > 0 || current.mustWatch.after.length > 0) return false;
  if (await hasFreshCollectionLookup(sql, key)) return false;

  let collection;
  try {
    // Retries within a shared 9s budget (see the constants above). A warm is
    // opportunistic anyway: if it doesn't land now, no tombstone is written
    // and the next viewer retries it.
    collection = await tmdbCollectionParts(key.tmdbId, WARM_TMDB_ATTEMPTS, WARM_TMDB_BUDGET_MS);
  } catch (err) {
    // Reached TMDB and it failed. Deliberately no tombstone: caching "we
    // learned nothing" as "there is nothing" would hide a real franchise for
    // the whole TTL over one blip.
    console.error("[relations] collection warm failed", err);
    return false;
  }

  await recordCollectionLookup(sql, key, collection !== null);
  if (collection === null) return false;

  const { written, classification } = await writeCollectionChain(sql, collection.id, collection.parts);
  if (written > 0) {
    console.info(
      `[relations] warmed collection ${collection.id} "${collection.name}" as ${classification} (${written} edges)`,
    );
  }
  return written > 0;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "POST") return handleSuppress(req, res);
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "method not allowed" }, "no-store");
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const mediaType = url.searchParams.get("type");
  const tmdbId = Number(url.searchParams.get("id"));
  if ((mediaType !== "movie" && mediaType !== "tv") || !Number.isFinite(tmdbId) || tmdbId <= 0) {
    return sendJson(res, 400, { error: "type (movie|tv) and id are required" }, "no-store");
  }

  // Never trust the client's depth — clamp server-side regardless of what
  // getRelations would otherwise do internally.
  const rawDepth = Number(url.searchParams.get("depth"));
  const depth = Number.isFinite(rawDepth) ? Math.min(Math.max(Math.trunc(rawDepth), 1), MAX_DEPTH) : DEFAULT_DEPTH;

  // no-store, not CACHE_CONTROL: this response is empty only because THIS
  // request got rate-limited, not because the title has no relations. The
  // CDN caches per-URL, not per-IP, so a long TTL here would paint every
  // other visitor to this title with one spammer's empty answer for a day —
  // and would also block warmFromCollection from ever running until the
  // entry expired.
  if (isRateLimited(req)) return sendJson(res, 200, EMPTY_RELATIONS, "no-store");

  const key: RelationKey = { tmdbId, mediaType };
  const userId = getSessionUserId(req);
  try {
    const sql = getDb();
    let relations = await getRelations(sql, key, depth, userId);

    const warmed = await warmFromCollection(sql, key, relations);
    if (warmed) relations = await getRelations(sql, key, depth, userId);

    // The CDN caches by URL, which carries no user identity — but this
    // payload isn't the same for everyone: a signed-in user's own
    // suppressions filter it (see walkMustChain/getCanWatch). Caching that
    // publicly would let one person's thumbs-down get served to every other
    // visitor to this title, or a stale personalised view get served back to
    // that same person once they're no longer the one populating the cache.
    // Only the userId === null (anonymous) response is the same for everyone
    // and safe to cache at the edge.
    return sendJson(res, 200, relations, userId === null ? CACHE_CONTROL : "no-store");
  } catch (err) {
    console.error("[relations] lookup failed", err);
    return sendJson(res, 200, EMPTY_RELATIONS, "no-store");
  }
}

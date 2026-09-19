import type postgres from "postgres";
import type {
  WatchlistItemDTO,
  WatchlistStateDTO,
  CustomListDTO,
  AddWatchlistItemBody,
  Bucket,
} from "../shared/types/watchlist.js";
import { getProgressForUser } from "./progressDb.js";
import { getOpinionsForUser } from "./opinionsDb.js";

// Every query here is scoped to one signed-in user's rows. That scoping is
// deliberately on every write, not just the reads: dbId (BIGSERIAL) is a
// small, sequential, trivially-guessable integer, so a mutation that only
// checked `WHERE id = $dbId` — without also requiring `user_id = $userId` —
// would let any signed-in user edit or delete any OTHER user's watchlist item
// just by incrementing a number. This is the single most important property
// of this file post-multi-user; every function signature below carries
// userId specifically so that property can't quietly regress.

function toItemDTO(row: any): WatchlistItemDTO {
  return {
    dbId: Number(row.id),
    tmdbId: Number(row.tmdb_id),
    mediaType: row.media_type,
    title: row.title,
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    overview: row.overview,
    releaseDate: row.release_date,
    voteAverage: Number(row.vote_average),
    originalLanguage: row.original_language,
    bucket: row.bucket,
    listId: row.list_id !== null ? Number(row.list_id) : null,
    addedAt: new Date(row.added_at).getTime(),
  };
}

function toListDTO(row: any): CustomListDTO {
  return { id: Number(row.id), name: row.name, createdAt: new Date(row.created_at).getTime() };
}

export async function getWatchlistState(sql: postgres.Sql<any>, userId: number): Promise<WatchlistStateDTO> {
  const rows = await sql`SELECT * FROM watchlist_items WHERE user_id = ${userId} ORDER BY sort_order ASC`;
  const listRows = await sql`SELECT * FROM custom_lists WHERE user_id = ${userId} ORDER BY created_at ASC`;
  // Part of the same state, fetched with it. A separate request would load on
  // exactly the same screens a moment later and make every TV card pop from
  // "not started" to "S2 E4" after the list had already painted.
  const [progress, opinions] = await Promise.all([
    getProgressForUser(sql, userId),
    getOpinionsForUser(sql, userId),
  ]);

  const state: WatchlistStateDTO = {
    watchlist: [],
    watchLater: [],
    watched: [],
    customLists: listRows.map(toListDTO),
    customListItems: {},
    progress,
    opinions,
  };

  for (const row of rows) {
    const item = toItemDTO(row);
    if (item.bucket === "watchlist") state.watchlist.push(item);
    else if (item.bucket === "watchLater") state.watchLater.push(item);
    else if (item.bucket === "watched") state.watched.push(item);
    else if (item.bucket === "custom" && item.listId !== null) {
      if (!state.customListItems[item.listId]) state.customListItems[item.listId] = [];
      state.customListItems[item.listId].push(item);
    }
  }

  return state;
}

/** Purge-then-insert: removes any existing placement of this title across ALL
 * of THIS USER's buckets (mirrors the old client-side purgeFromAll — one
 * active placement per title, per user), then inserts the new row at the end
 * of its target bucket. The purge is user-scoped — without that, adding a
 * film to your own watchlist would delete it from every other user's. */
export async function addWatchlistItem(
  sql: postgres.Sql<any>,
  userId: number,
  body: AddWatchlistItemBody,
): Promise<WatchlistItemDTO> {
  return sql.begin(async (tx) => {
    await tx`DELETE FROM watchlist_items WHERE user_id = ${userId} AND tmdb_id = ${body.tmdbId} AND media_type = ${body.mediaType}`;

    const listId = body.bucket === "custom" ? body.listId ?? null : null;
    const [{ next_order }] = await tx`
      SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order
      FROM watchlist_items
      WHERE user_id = ${userId} AND bucket = ${body.bucket} AND list_id IS NOT DISTINCT FROM ${listId}
    `;

    // Every optional field is coalesced to the column's own default rather
    // than passed through: postgres.js rejects `undefined` outright
    // (UNDEFINED_VALUE) instead of treating it as NULL, so a title that
    // reaches us without, say, a release date would fail the whole add with
    // a 500 that reads like a database outage.
    const [row] = await tx`
      INSERT INTO watchlist_items
        (user_id, tmdb_id, media_type, title, poster_path, backdrop_path, overview, release_date,
         vote_average, original_language, bucket, list_id, sort_order)
      VALUES (
        ${userId}, ${body.tmdbId}, ${body.mediaType}, ${body.title}, ${body.posterPath ?? null}, ${body.backdropPath ?? null},
        ${body.overview ?? ""}, ${body.releaseDate ?? ""}, ${body.voteAverage ?? 0}, ${body.originalLanguage ?? ""},
        ${body.bucket}, ${listId}, ${next_order}
      )
      RETURNING *
    `;
    return toItemDTO(row);
  });
}

export async function moveWatchlistItem(
  sql: postgres.Sql<any>,
  userId: number,
  dbId: number,
  bucket: Bucket,
  listId: number | null,
): Promise<WatchlistItemDTO | null> {
  return sql.begin(async (tx) => {
    const existing = await tx`SELECT tmdb_id, media_type FROM watchlist_items WHERE id = ${dbId} AND user_id = ${userId}`;
    if (existing.length === 0) return null;
    const { tmdb_id, media_type } = existing[0];

    // Moving to a standard bucket must still respect "one active placement per
    // title, per user" — purge any OTHER row of this user's for this title
    // first (e.g. it could exist in a custom list simultaneously; moving to
    // watchlist should replace that).
    await tx`
      DELETE FROM watchlist_items
      WHERE user_id = ${userId} AND tmdb_id = ${tmdb_id} AND media_type = ${media_type} AND id != ${dbId}
    `;

    const [{ next_order }] = await tx`
      SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order
      FROM watchlist_items
      WHERE user_id = ${userId} AND bucket = ${bucket} AND list_id IS NOT DISTINCT FROM ${listId} AND id != ${dbId}
    `;

    const [row] = await tx`
      UPDATE watchlist_items
      SET bucket = ${bucket}, list_id = ${listId}, sort_order = ${next_order}, added_at = now()
      WHERE id = ${dbId} AND user_id = ${userId}
      RETURNING *
    `;
    return row ? toItemDTO(row) : null;
  });
}

export async function removeWatchlistItem(sql: postgres.Sql<any>, userId: number, dbId: number): Promise<void> {
  await sql`DELETE FROM watchlist_items WHERE id = ${dbId} AND user_id = ${userId}`;
}

/** Rewrites sort_order for every item in a bucket to match the given order.
 *
 *  One statement via unnest, not one UPDATE per item in a transaction — a
 *  drag-and-drop reorder was previously as many sequential round trips as
 *  there were items in the bucket, which is exactly the latency a user
 *  dragging a card actually feels. Same pattern already used for batch reads
 *  in ratingsDb.ts's unnest(...)::bigint[] lookup. */
export async function reorderBucket(
  sql: postgres.Sql<any>,
  userId: number,
  bucket: Bucket,
  listId: number | null,
  orderedIds: number[],
): Promise<void> {
  if (orderedIds.length === 0) return;
  const sortOrders = orderedIds.map((_, i) => i);

  await sql`
    UPDATE watchlist_items AS w
    SET sort_order = data.sort_order
    FROM (
      SELECT * FROM unnest(${orderedIds}::bigint[], ${sortOrders}::int[]) AS t(id, sort_order)
    ) AS data
    WHERE w.id = data.id
      AND w.user_id = ${userId}
      AND w.bucket = ${bucket}
      AND w.list_id IS NOT DISTINCT FROM ${listId}
  `;
}

export async function createCustomList(sql: postgres.Sql<any>, userId: number, name: string): Promise<CustomListDTO> {
  const [row] = await sql`INSERT INTO custom_lists (user_id, name) VALUES (${userId}, ${name}) RETURNING *`;
  return toListDTO(row);
}

export async function renameCustomList(
  sql: postgres.Sql<any>,
  userId: number,
  id: number,
  name: string,
): Promise<CustomListDTO | null> {
  const [row] = await sql`UPDATE custom_lists SET name = ${name} WHERE id = ${id} AND user_id = ${userId} RETURNING *`;
  return row ? toListDTO(row) : null;
}

export async function deleteCustomList(sql: postgres.Sql<any>, userId: number, id: number): Promise<void> {
  // ON DELETE CASCADE on watchlist_items.list_id handles orphaned items.
  await sql`DELETE FROM custom_lists WHERE id = ${id} AND user_id = ${userId}`;
}

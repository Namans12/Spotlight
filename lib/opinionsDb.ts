import type postgres from "postgres";
import type { OpinionMap } from "../shared/types/watchlist.js";

// Same alias lib/relationsDb.ts uses: postgres.js is generic over a row-type
// map this module does not have, and repeating the escape hatch at every
// signature adds noise without adding safety.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = postgres.Sql<any>;

// Whether each account liked what it watched (migrations/0015_title_opinions.sql).
//
// User-scoped on every query, for the same reason lib/watchlistDb.ts and
// lib/progressDb.ts are: these are per-account facts and a write that forgot
// the user_id predicate would let any signed-in account overwrite anyone
// else's opinion.

/** "movie:920" — the same key shape every other per-title cache uses. */
export function opinionKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/** Everything this account has an opinion about, as one map. Read with the
 *  watchlist state so a taste profile can be built in the browser without a
 *  request per title. */
export async function getOpinionsForUser(sql: Db, userId: number): Promise<OpinionMap> {
  const rows = await sql`
    SELECT tmdb_id, media_type, liked
    FROM title_opinions
    WHERE user_id = ${userId}
  `;

  const map: OpinionMap = {};
  for (const row of rows) map[opinionKey(row.media_type, Number(row.tmdb_id))] = row.liked === true;
  return map;
}

/** Records an opinion, or changes one. */
export async function setOpinion(
  sql: Db,
  userId: number,
  tmdbId: number,
  mediaType: string,
  liked: boolean,
): Promise<void> {
  await sql`
    INSERT INTO title_opinions (user_id, tmdb_id, media_type, liked)
    VALUES (${userId}, ${tmdbId}, ${mediaType}, ${liked})
    ON CONFLICT (user_id, tmdb_id, media_type)
    DO UPDATE SET liked = EXCLUDED.liked, updated_at = now()
  `;
}

/** Withdraws an opinion entirely.
 *
 *  A delete rather than a third stored state, because "I have not said" is the
 *  absence of evidence and must not be mistaken for "I am indifferent" — the
 *  second would be a data point the taste profile would have to weigh, and
 *  nobody ever means it. */
export async function clearOpinion(
  sql: Db,
  userId: number,
  tmdbId: number,
  mediaType: string,
): Promise<void> {
  await sql`
    DELETE FROM title_opinions
    WHERE user_id = ${userId} AND tmdb_id = ${tmdbId} AND media_type = ${mediaType}
  `;
}

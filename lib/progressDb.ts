import type postgres from "postgres";
import type { ProgressDTO, ProgressMap } from "../shared/types/watchlist.js";

// Where each account is up to in a series (migrations/0014_title_progress.sql).
//
// Every query here is scoped to one signed-in user's rows, for the same reason
// lib/watchlistDb.ts is: these are per-account facts, and a mutation that
// forgot the user_id predicate would let any signed-in account overwrite
// anyone else's place in a show. Both functions below take userId first so
// that cannot quietly regress.

/** "tv:1396" — the same key shape the ratings, seasons and providers caches
 *  use, so a client can look progress up beside them without a second map. */
export function progressKey(mediaType: string, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/** Everything this account is part-way through, as one map. Read once when the
 *  watchlist state loads rather than per card: a reader with forty saved shows
 *  should cost one query, not forty. */
export async function getProgressForUser(sql: postgres.Sql<any>, userId: number): Promise<ProgressMap> {
  const rows = await sql`
    SELECT tmdb_id, media_type, season, episode
    FROM title_progress
    WHERE user_id = ${userId}
  `;

  const map: ProgressMap = {};
  for (const row of rows) {
    map[progressKey(row.media_type, Number(row.tmdb_id))] = {
      season: Number(row.season),
      episode: Number(row.episode),
    };
  }
  return map;
}

/**
 * Records where someone is up to.
 *
 * An upsert rather than an insert: a pointer is overwritten every time an
 * episode is watched, which for a show someone is actually following is most
 * days. `updated_at` is refreshed on conflict so a future "continue watching"
 * row can order by recency — the whole point of which is that the show you
 * touched last night comes first.
 *
 * Nothing here validates the pointer against the show's real season list. It
 * cannot: this module has no idea how many episodes season two has, and a
 * TMDB lookup per write would make marking an episode a network round trip
 * through a third party. src/lib/progress.ts clamps on every read instead, so
 * a pointer that outlives a season renumbering degrades rather than breaks.
 */
export async function setProgress(
  sql: postgres.Sql<any>,
  userId: number,
  entry: ProgressDTO,
): Promise<void> {
  await sql`
    INSERT INTO title_progress (user_id, tmdb_id, media_type, season, episode)
    VALUES (${userId}, ${entry.tmdbId}, ${entry.mediaType}, ${entry.season}, ${entry.episode})
    ON CONFLICT (user_id, tmdb_id, media_type)
    DO UPDATE SET season = EXCLUDED.season, episode = EXCLUDED.episode, updated_at = now()
  `;
}

/** Forgets a show entirely. Used by "start over", and by un-marking: absence
 *  of a row is what "not started" means, so there is nothing to set it to. */
export async function clearProgress(
  sql: postgres.Sql<any>,
  userId: number,
  tmdbId: number,
  mediaType: string,
): Promise<void> {
  await sql`
    DELETE FROM title_progress
    WHERE user_id = ${userId} AND tmdb_id = ${tmdbId} AND media_type = ${mediaType}
  `;
}

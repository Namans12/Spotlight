// Data access for qloo_entities (migrations/0016_release_pulse.sql) and the one
// column of title_ratings that resolution needs. Every value goes through the
// tagged template, so postgres.js parameterizes it; nothing is interpolated
// into the SQL text.

/** The narrow shape of the postgres.js tagged-template client these helpers
 *  use. postgres.Sql is generic over `any` and far wider than needed, so
 *  depending on this keeps tests free to pass a small fake (the same idea as
 *  FakeSql in lib/relationsDb.test.ts) while a real postgres.Sql still fits. */
export type EntitySql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<Record<string, unknown>[]>;

export interface EntityKey {
  tmdbId: number;
  mediaType: "movie" | "tv";
}

/** A qloo_entities row as the resolver needs it. A miss has notFound = true
 *  and entityId = null. */
export interface CachedEntity {
  entityId: string | null;
  method: "imdb" | "search" | null;
  notFound: boolean;
  resolvedAt: Date;
}

export interface EntityRow extends EntityKey {
  imdbId: string | null;
  entityId: string | null;
  method: "imdb" | "search" | null;
  notFound: boolean;
  resolvedAt: Date;
}

export async function getCachedEntity(sql: EntitySql, key: EntityKey): Promise<CachedEntity | null> {
  const rows = await sql`
    SELECT qloo_entity_id, method, not_found, resolved_at
    FROM qloo_entities
    WHERE tmdb_id = ${key.tmdbId} AND media_type = ${key.mediaType}`;
  const r = rows[0];
  if (!r) return null;
  return {
    entityId: (r.qloo_entity_id as string | null) ?? null,
    method: (r.method as "imdb" | "search" | null) ?? null,
    notFound: r.not_found === true,
    resolvedAt: r.resolved_at as Date,
  };
}

/** The IMDb id the ratings backfill already found, if any. A title_ratings row
 *  that is a tombstone (not_found) or has no id yields null, the same as no row. */
export async function getImdbId(sql: EntitySql, key: EntityKey): Promise<string | null> {
  const rows = await sql`
    SELECT imdb_id
    FROM title_ratings
    WHERE tmdb_id = ${key.tmdbId} AND media_type = ${key.mediaType}`;
  const id = rows[0]?.imdb_id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** Writes the outcome of a resolution, replacing any earlier row for the title,
 *  which is how a stale miss is overwritten by a later hit. */
export async function upsertEntity(sql: EntitySql, row: EntityRow): Promise<void> {
  await sql`
    INSERT INTO qloo_entities (tmdb_id, media_type, imdb_id, qloo_entity_id, method, not_found, resolved_at)
    VALUES (${row.tmdbId}, ${row.mediaType}, ${row.imdbId}, ${row.entityId}, ${row.method}, ${row.notFound}, ${row.resolvedAt})
    ON CONFLICT (tmdb_id, media_type) DO UPDATE SET
      imdb_id = EXCLUDED.imdb_id,
      qloo_entity_id = EXCLUDED.qloo_entity_id,
      method = EXCLUDED.method,
      not_found = EXCLUDED.not_found,
      resolved_at = EXCLUDED.resolved_at`;
}

import postgres from "postgres";
import type { PulseConfig } from "../config.js";

// One pool per process. Pulse shares the Spotlight database with the main app
// and the sync worker, so it keeps its own small ceiling rather than the
// driver's default of 10, which would crowd them out on a small plan.
const MAX_CONNECTIONS = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pool: postgres.Sql<any> | null = null;

/** The process's connection pool, created on first use. postgres.js connects
 *  lazily, so this does not touch the network until the first query. */
export function getPool(cfg: Pick<PulseConfig, "databaseUrl">): postgres.Sql {
  pool ??= postgres(cfg.databaseUrl, { max: MAX_CONNECTIONS });
  return pool;
}

/** Ends the pool and forgets it, for shutdown and for tests that must not
 *  leave open sockets behind. A later getPool builds a fresh one. */
export async function closePool(): Promise<void> {
  const p = pool;
  pool = null;
  await p?.end();
}

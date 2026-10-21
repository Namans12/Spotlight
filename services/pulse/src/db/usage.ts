// Data access for pulse_usage (migrations/0016_release_pulse.sql): one row per
// (session hash, UTC day, kind) holding how many LLM drafts that session has
// taken. Every value goes through the tagged template, so postgres.js
// parameterizes it. The cap logic itself lives in usage.ts; these are only the
// statements, which must run inside one transaction (see takeUsage).

export type UsageKind = "chat" | "campaign";

export type UsageTx = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<Record<string, unknown>[]>;

/** The one thing takeUsage needs from the driver: a transaction. postgres.js's
 *  `sql.begin(fn)` fits this, and so does a small in-memory fake. */
export interface UsageSql {
  begin<T>(fn: (tx: UsageTx) => Promise<T>): Promise<T>;
}

/** Serialises every takeUsage for one UTC day until the transaction ends, so
 *  the count-then-increment below cannot interleave across requests (or across
 *  service instances: it is a database lock, not a process one). Different
 *  days do not block each other. */
export async function lockDay(tx: UsageTx, day: string): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext('pulse_usage:' || ${day}::text))`;
}

/** This session's count for the kind, and the day's total over every session
 *  and both kinds, which is what the global cap limits. */
export async function readCounts(tx: UsageTx, sessionHash: string, kind: UsageKind, day: string): Promise<{ session: number; global: number }> {
  const rows = await tx`
    SELECT COALESCE(SUM(count), 0)::int AS global,
           COALESCE(SUM(count) FILTER (WHERE session_hash = ${sessionHash} AND kind = ${kind}), 0)::int AS session
    FROM pulse_usage WHERE day = ${day}::date`;
  return { session: Number(rows[0]?.session ?? 0), global: Number(rows[0]?.global ?? 0) };
}

/** Takes one slot: inserts the row or increments it, but only while the count
 *  is still under the cap. Returns false (and changes nothing) when the row is
 *  already at the cap. */
export async function takeSlot(tx: UsageTx, sessionHash: string, kind: UsageKind, day: string, sessionCap: number): Promise<boolean> {
  const rows = await tx`
    INSERT INTO pulse_usage (session_hash, day, kind, count) VALUES (${sessionHash}, ${day}::date, ${kind}, 1)
    ON CONFLICT (session_hash, day, kind) DO UPDATE SET count = pulse_usage.count + 1
    WHERE pulse_usage.count < ${sessionCap}
    RETURNING count`;
  return rows.length > 0;
}

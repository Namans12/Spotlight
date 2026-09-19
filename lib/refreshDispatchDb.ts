import type postgres from "postgres";

// Rate limiting for api/releases-refresh (migrations/0007_multi_user_accounts.sql).
//
// Two limits, because one alone doesn't protect the thing being protected:
//   - A global 15-minute cooldown: the pipeline is shared, so running it
//     twice in five minutes achieves nothing regardless of who asked.
//   - A 5-per-day-per-user quota: without this, 20 users each respecting the
//     cooldown could still add up to dozens of runs a day on a job meant to
//     run once nightly.
//
// The cooldown counts every dispatch attempt that actually reached GitHub —
// success or failure — because a failing pipeline shouldn't be hammerable.
// The quota counts only successes, so a GitHub outage doesn't silently burn
// someone's daily allowance for a click that never took effect.

export const GLOBAL_COOLDOWN_MINUTES = 15;
export const PER_USER_DAILY_QUOTA = 5;

export type RateLimitDenied = { allowed: false; retryAfterSeconds: number; reason: string };
export type RateLimitCheck = { allowed: true } | RateLimitDenied;

/** Narrows a check to its denied branch.
 *
 *  Explicit rather than letting a caller write `if (!check.allowed)`, because
 *  TypeScript only narrows a discriminated union when strictNullChecks is on,
 *  and this repository's ROOT tsconfig.json sets it to false. That is the
 *  config Vercel type-checks api/ against, so the shorthand compiled locally
 *  (tsconfig.server.json turns strictNullChecks on) and then failed the
 *  deploy with "Property 'reason' does not exist on type RateLimitCheck".
 *
 *  A user-defined type predicate narrows regardless of that flag, so this
 *  works under every config in the repo instead of only the strict ones. */
export function isRateLimited(check: RateLimitCheck): check is RateLimitDenied {
  return check.allowed === false;
}

function pluralize(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export async function checkRefreshRateLimit(sql: postgres.Sql<any>, userId: number): Promise<RateLimitCheck> {
  const [globalRow] = await sql`SELECT dispatched_at FROM refresh_dispatches ORDER BY dispatched_at DESC LIMIT 1`;
  if (globalRow) {
    const remainingMs = GLOBAL_COOLDOWN_MINUTES * 60_000 - (Date.now() - new Date(globalRow.dispatched_at).getTime());
    if (remainingMs > 0) {
      const retryAfterSeconds = Math.ceil(remainingMs / 1000);
      return {
        allowed: false,
        retryAfterSeconds,
        reason: `The pipeline was just refreshed — try again in ${pluralize(Math.ceil(retryAfterSeconds / 60), "minute")}.`,
      };
    }
  }

  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM refresh_dispatches
    WHERE user_id = ${userId} AND ok = true AND dispatched_at > now() - interval '24 hours'
  `;
  if (Number(count) >= PER_USER_DAILY_QUOTA) {
    const [oldest] = await sql`
      SELECT dispatched_at FROM refresh_dispatches
      WHERE user_id = ${userId} AND ok = true AND dispatched_at > now() - interval '24 hours'
      ORDER BY dispatched_at ASC LIMIT 1
    `;
    const retryAfterSeconds = Math.max(1, Math.ceil((new Date(oldest.dispatched_at).getTime() + 86_400_000 - Date.now()) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      reason: `You've used all ${PER_USER_DAILY_QUOTA} refreshes for today — resets in ${pluralize(Math.ceil(retryAfterSeconds / 3600), "hour")}.`,
    };
  }

  return { allowed: true };
}

export async function recordRefreshDispatch(sql: postgres.Sql<any>, userId: number, ok: boolean): Promise<void> {
  await sql`INSERT INTO refresh_dispatches (user_id, ok) VALUES (${userId}, ${ok})`;
}

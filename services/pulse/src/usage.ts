// Who has used how much of the day's LLM budget. Caps exist because Groq's
// free tier is a real ceiling and the endpoints are public.

import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { lockDay, readCounts, takeSlot, type UsageKind, type UsageSql } from "./db/usage.js";
import { clientAddress } from "./http/rateLimit.js";

export type { UsageKind, UsageSql, UsageTx } from "./db/usage.js";

export interface Caps { session: number; global: number }
export type CapDecision = { allowed: true } | { allowed: false; reason: "session_cap" | "global_cap" };

/** The UTC calendar day, which is also when every cap resets. */
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/** The session id is whatever the SPA keeps in localStorage and sends as
 *  X-Pulse-Session. It is client-chosen, so it is bounded before hashing. */
const MAX_SESSION_ID = 200;

/** The stored identity of a caller for one day: sha256 of the X-Pulse-Session
 *  header plus the UTC day, so yesterday's rows cannot be linked to today's and
 *  the table holds nothing that could be replayed as a credential. With no
 *  header it hashes the client address instead (the same rightmost
 *  X-Forwarded-For rule as the rate limiter). Neither raw value leaves this
 *  function, so neither can reach a log or a database row. */
export function sessionKey(req: IncomingMessage, now: Date): string {
  const raw = req.headers["x-pulse-session"];
  const header = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const identity = header ? header.slice(0, MAX_SESSION_ID) : clientAddress(req);
  return createHash("sha256").update(`${identity}:${utcDay(now)}`).digest("hex");
}

/** Session cap first, then global, so a caller who is over their own limit is
 *  told that, whatever the day's total. */
export function capDecision(counts: { session: number; global: number }, caps: Caps): CapDecision {
  if (counts.session >= caps.session) return { allowed: false, reason: "session_cap" };
  if (counts.global >= caps.global) return { allowed: false, reason: "global_cap" };
  return { allowed: true };
}

/** Takes one slot of the day's budget, atomically: an allowed call consumes
 *  one, a denied call consumes nothing (so refusals do not inflate the global
 *  total), and two concurrent calls cannot both take the last slot. The
 *  per-day advisory lock serialises the read and the increment; the
 *  conditional upsert's own WHERE is the second line of defence. */
export async function takeUsage(sql: UsageSql, sessionHash: string, kind: UsageKind, caps: Caps, now: Date = new Date()): Promise<CapDecision> {
  const day = utcDay(now);
  return sql.begin(async (tx) => {
    await lockDay(tx, day);
    const decision = capDecision(await readCounts(tx, sessionHash, kind, day), caps);
    if (!decision.allowed) return decision;
    return (await takeSlot(tx, sessionHash, kind, day, caps.session)) ? decision : { allowed: false, reason: "session_cap" };
  });
}

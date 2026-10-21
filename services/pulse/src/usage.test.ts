import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { capDecision, sessionKey, takeUsage, utcDay, type UsageSql, type UsageTx } from "./usage.js";

const req = (headers: Record<string, string | string[]> = {}, remoteAddress = "10.0.0.9") =>
  ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const NOW = new Date("2026-10-21T23:59:30Z");

describe("capDecision (session first, then global)", () => {
  const caps = { session: 30, global: 800 };
  it("denies on the session cap before looking at the global one", () => {
    expect(capDecision({ session: 30, global: 1 }, caps)).toEqual({ allowed: false, reason: "session_cap" });
    expect(capDecision({ session: 30, global: 800 }, caps)).toEqual({ allowed: false, reason: "session_cap" });
  });
  it("denies on the global cap when the session is under its own", () => {
    expect(capDecision({ session: 1, global: 800 }, caps)).toEqual({ allowed: false, reason: "global_cap" });
  });
  it("allows below both, and treats a cap of 0 as closed", () => {
    expect(capDecision({ session: 29, global: 799 }, caps)).toEqual({ allowed: true });
    expect(capDecision({ session: 0, global: 0 }, { session: 0, global: 5 })).toEqual({ allowed: false, reason: "session_cap" });
    expect(capDecision({ session: 0, global: 0 }, { session: 5, global: 0 })).toEqual({ allowed: false, reason: "global_cap" });
  });
});

describe("utcDay", () => {
  it("is the UTC calendar day, not the local one", () => {
    expect(utcDay(NOW)).toBe("2026-10-21");
    expect(utcDay(new Date("2026-10-22T00:00:01Z"))).toBe("2026-10-22");
  });
});

describe("sessionKey", () => {
  it("hashes the X-Pulse-Session header with the UTC day", () => {
    expect(sessionKey(req({ "x-pulse-session": "abc-123" }), NOW)).toBe(sha("abc-123:2026-10-21"));
  });
  it("changes at the UTC day boundary", () => {
    const next = new Date("2026-10-22T00:00:00Z");
    expect(sessionKey(req({ "x-pulse-session": "abc-123" }), next)).not.toBe(sessionKey(req({ "x-pulse-session": "abc-123" }), NOW));
  });
  it("falls back to the rightmost X-Forwarded-For entry, as the rate limiter does", () => {
    const k = sessionKey(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }), NOW);
    expect(k).toBe(sha("203.0.113.7:2026-10-21"));
  });
  it("falls back to the socket address with no header at all", () => {
    expect(sessionKey(req({}, "192.0.2.4"), NOW)).toBe(sha("192.0.2.4:2026-10-21"));
  });
  it("treats an empty or whitespace header as absent", () => {
    expect(sessionKey(req({ "x-pulse-session": "   " }, "192.0.2.4"), NOW)).toBe(sha("192.0.2.4:2026-10-21"));
  });
  it("never returns the raw header or address", () => {
    const k = sessionKey(req({ "x-pulse-session": "raw-session-id" }, "192.0.2.4"), NOW);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toContain("raw-session-id");
    expect(sessionKey(req({}, "192.0.2.4"), NOW)).not.toContain("192.0.2.4");
  });
  it("bounds an oversized header instead of hashing megabytes", () => {
    const huge = "x".repeat(100_000);
    expect(sessionKey(req({ "x-pulse-session": huge }), NOW)).toBe(sha(`${"x".repeat(200)}:2026-10-21`));
  });
});

/** An in-memory stand-in for the statements takeUsage issues, run one
 *  transaction at a time like the advisory lock does. */
function fakeUsageSql() {
  const rows = new Map<string, number>(); // `${hash}|${day}|${kind}`
  const log: { text: string; values: unknown[] }[] = [];
  const sql: UsageSql = {
    async begin(fn) {
      const tx: UsageTx = async (strings, ...values) => {
        const text = strings.join("?").replace(/\s+/g, " ").trim();
        log.push({ text, values });
        if (text.startsWith("SELECT pg_advisory_xact_lock(hashtext('pulse_usage:' || ?::text))")) return [];
        if (text.includes("FROM pulse_usage WHERE day = ?::date")) {
          const [hash, kind, day] = values as [string, string, string];
          let global = 0, session = 0;
          for (const [k, c] of rows) {
            const [h, d, kd] = k.split("|");
            if (d !== day) continue;
            global += c;
            if (h === hash && kd === kind) session += c;
          }
          return [{ global, session }];
        }
        if (text.startsWith("INSERT INTO pulse_usage (session_hash, day, kind, count) VALUES (?, ?::date, ?, 1) ON CONFLICT (session_hash, day, kind) DO UPDATE SET count = pulse_usage.count + 1 WHERE pulse_usage.count < ? RETURNING count")) {
          const [hash, day, kind, cap] = values as [string, string, string, number];
          const key = `${hash}|${day}|${kind}`;
          const cur = rows.get(key);
          if (cur === undefined) { rows.set(key, 1); return [{ count: 1 }]; }
          if (cur < cap) { rows.set(key, cur + 1); return [{ count: cur + 1 }]; }
          return [];
        }
        throw new Error(`unexpected statement: ${text}`);
      };
      return fn(tx);
    },
  };
  return { sql, rows, log };
}

describe("takeUsage", () => {
  const caps = { session: 2, global: 3 };
  it("allows up to the session cap, then denies without consuming anything", async () => {
    const { sql, rows, log } = fakeUsageSql();
    expect(await takeUsage(sql, "s1", "campaign", caps, NOW)).toEqual({ allowed: true });
    expect(await takeUsage(sql, "s1", "campaign", caps, NOW)).toEqual({ allowed: true });
    const before = log.length;
    expect(await takeUsage(sql, "s1", "campaign", caps, NOW)).toEqual({ allowed: false, reason: "session_cap" });
    expect(rows.get("s1|2026-10-21|campaign")).toBe(2);
    expect(log.slice(before).some((c) => c.text.startsWith("INSERT"))).toBe(false);
  });

  it("sums chat and campaign across sessions for the global cap, and a denial does not inflate it", async () => {
    const { sql, rows } = fakeUsageSql();
    expect(await takeUsage(sql, "s1", "campaign", caps, NOW)).toEqual({ allowed: true });
    expect(await takeUsage(sql, "s2", "chat", caps, NOW)).toEqual({ allowed: true });
    expect(await takeUsage(sql, "s3", "campaign", caps, NOW)).toEqual({ allowed: true });
    expect(await takeUsage(sql, "s4", "chat", caps, NOW)).toEqual({ allowed: false, reason: "global_cap" });
    expect(await takeUsage(sql, "s4", "chat", caps, NOW)).toEqual({ allowed: false, reason: "global_cap" });
    expect([...rows.values()].reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("keeps the kinds' session counts apart and the days apart", async () => {
    const { sql } = fakeUsageSql();
    expect(await takeUsage(sql, "s1", "campaign", { session: 1, global: 99 }, NOW)).toEqual({ allowed: true });
    expect(await takeUsage(sql, "s1", "chat", { session: 1, global: 99 }, NOW)).toEqual({ allowed: true });
    expect(await takeUsage(sql, "s1", "campaign", { session: 1, global: 99 }, NOW)).toEqual({ allowed: false, reason: "session_cap" });
    expect(await takeUsage(sql, "s1", "campaign", { session: 1, global: 99 }, new Date("2026-10-22T00:00:01Z"))).toEqual({ allowed: true });
  });

  it("takes the per-day advisory lock first and passes every value as a parameter", async () => {
    const { sql, log } = fakeUsageSql();
    await takeUsage(sql, "hash-1", "campaign", caps, NOW);
    expect(log[0].text).toContain("pg_advisory_xact_lock(hashtext('pulse_usage:' || ?::text))");
    expect(log[0].values).toEqual(["2026-10-21"]);
    for (const c of log) expect(c.text).not.toContain("hash-1");
    expect(log.at(-1)!.values).toEqual(["hash-1", "2026-10-21", "campaign", 2]);
  });

  it("denies as session_cap if the conditional upsert itself refuses (defence in depth)", async () => {
    const { sql } = fakeUsageSql();
    const wrapped: UsageSql = {
      begin: (fn) => sql.begin(async (tx) => fn(async (s, ...v) => {
        const text = s.join("?");
        // Make the count read stale so only the upsert's own WHERE can refuse.
        if (text.includes("FROM pulse_usage WHERE day")) return [{ global: 0, session: 0 }];
        return tx(s, ...v);
      })),
    };
    await takeUsage(wrapped, "s1", "campaign", { session: 1, global: 9 }, NOW);
    expect(await takeUsage(wrapped, "s1", "campaign", { session: 1, global: 9 }, NOW)).toEqual({ allowed: false, reason: "session_cap" });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { takeUsage } from "./usage.js";

// Real-database check that takeUsage is atomic (see resolve.integration.test.ts
// for how to run). It uses a far-future day so it cannot meet real usage rows,
// and deletes every row it creates.
const url = process.env.PULSE_TEST_DATABASE_URL;
const NOW = new Date("2099-01-05T12:00:00Z");
const DAY = "2099-01-05";

describe.skipIf(!url)("takeUsage against Postgres", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 10 });
  const cleanup = async () => { await sql`DELETE FROM pulse_usage WHERE day = ${DAY}::date`; };
  beforeAll(cleanup);
  afterAll(async () => { await cleanup(); await sql.end(); });

  const allowed = (rs: { allowed: boolean }[]) => rs.filter((r) => r.allowed).length;

  it("lets exactly the session cap through under 20 concurrent calls", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => takeUsage(sql, "it-session-a", "campaign", { session: 5, global: 1000 }, NOW)));
    expect(allowed(results)).toBe(5);
    expect(results.filter((r) => !r.allowed).every((r) => !r.allowed && r.reason === "session_cap")).toBe(true);
    const [row] = await sql`SELECT count FROM pulse_usage WHERE session_hash = 'it-session-a' AND day = ${DAY}::date AND kind = 'campaign'`;
    expect(row.count).toBe(5);
  });

  it("lets exactly the global cap through across sessions, and denials consume nothing", async () => {
    await cleanup();
    const caps = { session: 100, global: 7 };
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => takeUsage(sql, `it-session-${i % 3}`, i % 2 ? "chat" : "campaign", caps, NOW)));
    expect(allowed(results)).toBe(7);
    expect(results.filter((r) => !r.allowed).every((r) => !r.allowed && r.reason === "global_cap")).toBe(true);
    const [{ total }] = await sql`SELECT COALESCE(SUM(count), 0)::int AS total FROM pulse_usage WHERE day = ${DAY}::date`;
    expect(total).toBe(7);
  });
});

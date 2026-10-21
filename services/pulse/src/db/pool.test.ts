import { afterEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "./pool.js";

// postgres.js connects lazily, so constructing a pool needs no server.
describe("getPool", () => {
  afterEach(() => closePool());

  it("memoizes one pool per process", () => {
    const cfg = { databaseUrl: "postgres://u@127.0.0.1:1/x" };
    expect(getPool(cfg)).toBe(getPool(cfg));
  });

  it("caps the pool at 5 connections", () => {
    expect(getPool({ databaseUrl: "postgres://u@127.0.0.1:1/x" }).options.max).toBe(5);
  });

  it("builds a fresh pool after closePool", async () => {
    const cfg = { databaseUrl: "postgres://u@127.0.0.1:1/x" };
    const first = getPool(cfg);
    await closePool();
    expect(getPool(cfg)).not.toBe(first);
  });
});

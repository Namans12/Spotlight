import { describe, expect, it } from "vitest";
import { MAX_RESULT_CHARS, parseArguments, sanitiseArgs, summarise, truncateResult } from "./sanitize.js";

const strict = { type: "object", properties: { a: {}, b: {}, list: {}, nested: {} }, additionalProperties: false };

describe("parseArguments", () => {
  it("parses an object given as JSON text, or as an object", () => {
    expect(parseArguments('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseArguments({ a: 1 })).toEqual({ ok: true, value: { a: 1 } });
  });
  it("treats an empty string as no arguments", () => {
    expect(parseArguments("")).toEqual({ ok: true, value: {} });
    expect(parseArguments(undefined)).toEqual({ ok: true, value: {} });
  });
  it.each(["{nope", "[1,2]", "42", "null", '"text"'])("rejects %s", (raw) => {
    expect(parseArguments(raw)).toEqual({ ok: false });
  });
});

describe("sanitiseArgs", () => {
  it("cuts strings at 120 characters", () => {
    const out = sanitiseArgs({ a: "x".repeat(500) }, strict);
    expect((out.a as string).length).toBe(120);
  });

  it("keeps at most 10 items of an array, and cuts the strings inside", () => {
    const out = sanitiseArgs({ list: Array.from({ length: 25 }, (_, i) => `item-${i}-${"y".repeat(200)}`) }, strict);
    const list = out.list as string[];
    expect(list).toHaveLength(10);
    expect(list[0].startsWith("item-0-")).toBe(true);
    expect(list.every((s) => s.length === 120)).toBe(true);
  });

  it("drops containers nested deeper than two levels, keeping what is shallower", () => {
    // The arguments object is level 0; containers inside it may go two levels down.
    const out = sanitiseArgs({ nested: { ok: { fine: 1 }, tooDeep: { a: { b: 1 } }, list: [[["x"]]], flat: [1, 2] } }, strict);
    expect(out).toEqual({ nested: { ok: { fine: 1 }, tooDeep: {}, list: [], flat: [1, 2] } });
  });

  it("drops keys the schema does not list when additionalProperties is false", () => {
    const out = sanitiseArgs({ a: 1, evil: "x", __proto__x: 1 }, strict);
    expect(out).toEqual({ a: 1 });
  });

  it("keeps every key when the schema allows additional properties, or there is none", () => {
    expect(sanitiseArgs({ a: 1, extra: 2 }, { type: "object", additionalProperties: true })).toEqual({ a: 1, extra: 2 });
    expect(sanitiseArgs({ a: 1, extra: 2 })).toEqual({ a: 1, extra: 2 });
  });

  it("never lets a __proto__ key through, at any level", () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true},"a":{"__proto__":{"x":1},"b":2}}');
    const out = sanitiseArgs(parsed, { type: "object", additionalProperties: true });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.hasOwn(out, "__proto__")).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out).toEqual({ a: { b: 2 } });
  });

  it("keeps booleans and finite numbers, and drops null and non-finite numbers", () => {
    expect(sanitiseArgs({ a: true, b: 3, c: null, d: Number.NaN, e: Infinity }, { type: "object", additionalProperties: true })).toEqual({ a: true, b: 3 });
  });

  it("caps the number of keys", () => {
    const wide = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(sanitiseArgs(wide)).length).toBeLessThanOrEqual(20);
  });
});

describe("truncateResult", () => {
  it("passes a small result through as its JSON text", () => {
    expect(truncateResult({ a: 1 })).toBe('{"a":1}');
  });

  it("cuts a big one to the limit, as valid JSON that carries the …truncated marker", () => {
    const text = truncateResult({ rows: Array.from({ length: 2000 }, (_, i) => `row ${i}`) });
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(text).toContain("…truncated");
    expect(JSON.parse(text)).toMatchObject({ truncated: true });
  });

  it("stays within the limit when the preview is full of characters JSON escapes", () => {
    const text = truncateResult({ s: '"\\\n'.repeat(10_000) });
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("turns something that cannot be serialised into an error result", () => {
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(JSON.parse(truncateResult(circular))).toEqual({ error: "unserialisable_result" });
    expect(JSON.parse(truncateResult(10n))).toEqual({ error: "unserialisable_result" });
    expect(JSON.parse(truncateResult(undefined))).toEqual({ error: "unserialisable_result" });
  });
});

describe("summarise (what the user is shown, at most 200 characters)", () => {
  it("shows an error result as its error", () => {
    expect(summarise({ error: "unknown tool" })).toBe("error: unknown tool");
  });
  it("uses a harness result's own summary sentence", () => {
    expect(summarise({ status: "ok", summary: "Found 3 places." })).toBe("Found 3 places.");
  });
  it("describes the shape of anything else: counts, not contents", () => {
    expect(summarise({ ranked: [1, 2, 3], pendingCount: 2, note: "x" })).toBe("ranked[3], pendingCount=2, note=x");
  });
  it("is bounded", () => {
    expect(summarise({ summary: "z".repeat(1000) }).length).toBe(200);
    expect(summarise(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`key${i}`, "v".repeat(40)]))).length).toBeLessThanOrEqual(200);
    expect(summarise(null).length).toBeLessThanOrEqual(200);
  });
});

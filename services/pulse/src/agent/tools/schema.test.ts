import { describe, expect, it } from "vitest";
import real from "./harnessSchemas.fixture.json";
import { normaliseToolSchema } from "./schema.js";

// The seven allowlisted tools' input schemas, copied from the harness's own
// tool list (tool metadata, not Qloo data).
const schemas = real as Record<string, Record<string, unknown>>;
const FORBIDDEN = ["examples", "default", "uniqueItems", "$schema", "title", "anyOf", "oneOf", "allOf", "pattern", "format"];

const keysDeep = (v: unknown, skipPropertyNames = true): string[] => {
  if (Array.isArray(v)) return v.flatMap((x) => keysDeep(x));
  if (typeof v !== "object" || v === null) return [];
  return Object.entries(v).flatMap(([k, x]) => [k, ...(k === "properties" && skipPropertyNames ? Object.values(x as object).flatMap((p) => keysDeep(p)) : keysDeep(x))]);
};

describe("normaliseToolSchema", () => {
  it("has the real harness schemas to work on", () => {
    expect(Object.keys(schemas).sort()).toEqual(["qloo_audience_demographics", "qloo_compare_audiences", "qloo_describe", "qloo_find_tags", "qloo_rank", "qloo_recommend", "qloo_where_popular"]);
    // The inputs really do carry what is to be stripped.
    expect(JSON.stringify(schemas)).toContain('"examples"');
    expect(JSON.stringify(schemas)).toContain('"default"');
  });

  it.each(Object.keys(schemas))("%s: keeps type, required and the property names; strips examples and defaults", (name) => {
    const original = schemas[name];
    const out = normaliseToolSchema(original);
    expect(out.type).toBe("object");
    expect(out.required).toEqual(original.required);
    expect(out.additionalProperties).toBe(false);
    expect(Object.keys(out.properties as object)).toEqual(Object.keys(original.properties as object));
    const used = keysDeep(out);
    for (const bad of FORBIDDEN) expect(used).not.toContain(bad);
  });

  it("keeps the constraints a model needs: enums, bounds, item schemas", () => {
    const out = normaliseToolSchema(schemas.qloo_recommend) as { properties: Record<string, Record<string, unknown>> };
    expect(out.properties.target_type.enum).toContain("movie");
    expect(out.properties.limit).toMatchObject({ type: "integer", minimum: 1, maximum: 20 });
    expect(out.properties.limit).not.toHaveProperty("default");
    expect(out.properties.signals).toMatchObject({ type: "array", maxItems: 10, items: { type: "string", minLength: 1 } });
    expect(out.properties.demographic).not.toHaveProperty("examples");
    expect(out.properties.demographic.description).toMatch(/natural language/);
  });

  it("does not mistake a property NAME for a keyword", () => {
    const out = normaliseToolSchema({ type: "object", properties: { default: { type: "string", default: "x" }, examples: { type: "string" } }, required: ["default"] });
    expect(out).toEqual({ type: "object", properties: { default: { type: "string" }, examples: { type: "string" } }, required: ["default"] });
  });

  it("does not change its input", () => {
    const copy = JSON.stringify(schemas.qloo_describe);
    normaliseToolSchema(schemas.qloo_describe);
    expect(JSON.stringify(schemas.qloo_describe)).toBe(copy);
  });

  it("returns an empty schema for something that is not one", () => {
    expect(normaliseToolSchema(null)).toEqual({});
    expect(normaliseToolSchema("x")).toEqual({});
  });
});

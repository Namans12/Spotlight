import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The launch cities live in data/pulse_cities.json, not in code, so that the
// QIDs and Wikipedia category names the Task 5 builder reads and the plain
// fields the service serves have one source. This module exposes only the
// plain fields; qids and wikipedia stay in the JSON for the builder.
export interface City {
  slug: string;
  name: string;
  country: "IN" | "US" | "GB";
  lat: number;
  lon: number;
  qlooLocationQuery: string;
  prewarm: boolean;
}

const COUNTRIES = ["IN", "US", "GB"];

function fail(where: string, problem: string): never {
  throw new Error(`pulse_cities.json: ${where}: ${problem}`);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0);
}

// Pure so a bad data edit can be tested without touching the file. The
// loader below runs this at module load, which is the point: a malformed or
// duplicated city should stop the service at startup with a message naming
// the entry, not surface as a confusing empty result inside a request.
export function parseCities(raw: unknown): City[] {
  if (!Array.isArray(raw)) fail("file", "expected a JSON array of cities");
  const seen = new Set<string>();
  return raw.map((entry, i): City => {
    if (typeof entry !== "object" || entry === null) fail(`entry ${i}`, "expected an object");
    const e = entry as Record<string, unknown>;
    if (typeof e.slug !== "string" || e.slug === "") fail(`entry ${i}`, "missing slug");
    const slug = e.slug;
    if (seen.has(slug)) fail(`"${slug}"`, `duplicate slug "${slug}"`);
    seen.add(slug);
    const str = (field: string): string => {
      const v = e[field];
      if (typeof v !== "string" || v === "") fail(`"${slug}"`, `${field} must be a non-empty string`);
      return v;
    };
    const num = (field: string): number => {
      const v = e[field];
      if (typeof v !== "number" || !Number.isFinite(v)) fail(`"${slug}"`, `${field} must be a number`);
      return v;
    };
    const country = str("country");
    if (!COUNTRIES.includes(country)) fail(`"${slug}"`, `country must be one of ${COUNTRIES.join(", ")}`);
    if (typeof e.prewarm !== "boolean") fail(`"${slug}"`, "prewarm must be a boolean");
    if (!isStringArray(e.qids) || e.qids.length === 0) fail(`"${slug}"`, "qids must be a non-empty array of strings");
    const w = e.wikipedia as { filmed?: unknown; set?: unknown } | null | undefined;
    if (!w || !isStringArray(w.filmed) || !isStringArray(w.set)) {
      fail(`"${slug}"`, "wikipedia must have filmed and set arrays of category names");
    }
    return {
      slug,
      name: str("name"),
      country: country as City["country"],
      lat: num("lat"),
      lon: num("lon"),
      qlooLocationQuery: str("qlooLocationQuery"),
      prewarm: e.prewarm,
    };
  });
}

const dataPath = fileURLToPath(new URL("../../../data/pulse_cities.json", import.meta.url));
const cities = parseCities(JSON.parse(readFileSync(dataPath, "utf8")));
const bySlug = new Map(cities.map((c) => [c.slug, c]));

export function getCity(slug: string): City | null {
  return bySlug.get(slug) ?? null;
}

export function allCities(): City[] {
  return cities.map((c) => ({ ...c }));
}

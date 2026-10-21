import { describe, expect, it } from "vitest";
import { getNeighbourhoods, getTitleLocations, type LocationsSql } from "./locations.js";

function recorder(rows: Record<string, unknown>[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((s: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: s.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(rows);
  }) as unknown as LocationsSql;
  return { sql, calls };
}

describe("getTitleLocations", () => {
  it("reads kind, source and landmark for one title in one city, parameterized", async () => {
    const { sql, calls } = recorder([
      { kind: "filmed", source: "both", landmark_label: "India Gate" },
      { kind: "set", source: "wikipedia", landmark_label: null },
    ]);
    const out = await getTitleLocations(sql, { tmdbId: 7, mediaType: "movie" }, "delhi");
    expect(calls[0].text).toContain("SELECT kind, source, landmark_label FROM title_locations");
    expect(calls[0].text).toContain("source IS NOT NULL");
    expect(calls[0].values).toEqual([7, "movie", "delhi"]);
    expect(out).toEqual([
      { kind: "filmed", source: "both", landmark: "India Gate" },
      { kind: "set", source: "wikipedia", landmark: null },
    ]);
  });
});

describe("getNeighbourhoods", () => {
  it("returns named centroids and drops rows without coordinates", async () => {
    const { sql, calls } = recorder([
      { name: "Hauz Khas", lat: 28.5494, lon: 77.2001 },
      { name: "No Coords", lat: null, lon: null },
      { name: "String Coords", lat: "28.6", lon: "77.2" },
    ]);
    const out = await getNeighbourhoods(sql, "delhi");
    expect(calls[0].text).toContain("SELECT name, lat, lon FROM neighbourhoods WHERE city_slug =");
    expect(calls[0].values).toEqual(["delhi"]);
    expect(out).toEqual([{ name: "Hauz Khas", lat: 28.5494, lon: 77.2001 }, { name: "String Coords", lat: 28.6, lon: 77.2 }]);
  });
});

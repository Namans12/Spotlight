import { describe, expect, it } from "vitest";
import { getLocationsForTitle, getNeighbourhoods, getTitleLocations, getTitleLocationsBatch, type LocationsSql } from "./locations.js";

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

describe("getTitleLocationsBatch", () => {
  it("reads every title in one parameterized statement and groups rows by media type and id", async () => {
    const { sql, calls } = recorder([
      { tmdb_id: "7", media_type: "movie", kind: "filmed", source: "both", landmark_label: "India Gate" },
      { tmdb_id: "7", media_type: "movie", kind: "set", source: "wikipedia", landmark_label: null },
      { tmdb_id: "7", media_type: "tv", kind: "set", source: "wikipedia", landmark_label: "Other Kind" }, // same id, not asked for
      { tmdb_id: "8", media_type: "tv", kind: "set", source: "wikidata", landmark_label: null },
    ]);
    const out = await getTitleLocationsBatch(sql, [{ tmdbId: 7, mediaType: "movie" }, { tmdbId: 8, mediaType: "tv" }], "delhi");
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("FROM title_locations WHERE city_slug = ? AND tmdb_id = ANY(?)");
    expect(calls[0].text).toContain("source IS NOT NULL");
    expect(calls[0].values).toEqual(["delhi", [7, 8]]);
    expect(out.get("movie:7")).toEqual([
      { kind: "filmed", source: "both", landmark: "India Gate" },
      { kind: "set", source: "wikipedia", landmark: null },
    ]);
    expect(out.get("tv:8")).toEqual([{ kind: "set", source: "wikidata", landmark: null }]);
    expect(out.has("tv:7")).toBe(false);
  });

  it("issues no statement for no titles", async () => {
    const { sql, calls } = recorder([]);
    expect((await getTitleLocationsBatch(sql, [], "delhi")).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("getLocationsForTitle", () => {
  it("reads every city of one title with exact columns and parameters, skipping unattributed rows", async () => {
    const { sql, calls } = recorder([
      { city_slug: "delhi", kind: "filmed", source: "both", landmark_label: "Chandni Chowk" },
      { city_slug: "new-york", kind: "set", source: "wikipedia", landmark_label: null },
    ]);
    const out = await getLocationsForTitle(sql, { tmdbId: 9, mediaType: "tv" });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("SELECT city_slug, kind, source, landmark_label FROM title_locations");
    expect(calls[0].text).toContain("WHERE tmdb_id = ? AND media_type = ?");
    expect(calls[0].text).toContain("source IS NOT NULL");
    expect(calls[0].text).not.toContain("city_slug =");
    expect(calls[0].values).toEqual([9, "tv"]);
    expect(out).toEqual([
      { citySlug: "delhi", kind: "filmed", source: "both", landmark: "Chandni Chowk" },
      { citySlug: "new-york", kind: "set", source: "wikipedia", landmark: null },
    ]);
  });
});

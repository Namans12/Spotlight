import { describe, expect, it } from "vitest";
import { allCities, getCity, parseCities } from "./cities.js";

const valid = {
  slug: "delhi",
  name: "Delhi",
  country: "IN",
  lat: 28.61,
  lon: 77.21,
  qids: ["Q1353"],
  qlooLocationQuery: "Delhi",
  wikipedia: { filmed: ["Films_shot_in_Delhi"], set: ["Films_set_in_Delhi"] },
  prewarm: true,
};

describe("the launch-city registry", () => {
  it("knows all ten launch cities", () => {
    expect(allCities().map((c) => c.slug).sort()).toEqual([
      "bengaluru", "chennai", "delhi", "goa", "hyderabad", "kolkata", "london", "mumbai", "new-york", "pune",
    ]);
  });

  it("pre-warms exactly the five demo cities", () => {
    expect(allCities().filter((c) => c.prewarm).map((c) => c.slug).sort()).toEqual([
      "bengaluru", "delhi", "london", "mumbai", "new-york",
    ]);
  });

  it("returns null for an unknown slug", () => {
    expect(getCity("atlantis")).toBeNull();
  });

  it("returns the city for a known slug, without the data-only fields", () => {
    const c = getCity("new-york");
    expect(c).toEqual({
      slug: "new-york", name: "New York City", country: "US", lat: expect.any(Number), lon: expect.any(Number),
      qlooLocationQuery: "New York City", prewarm: true,
    });
  });
});

describe("parseCities", () => {
  it("keeps only the plain City fields", () => {
    expect(parseCities([valid])).toEqual([
      { slug: "delhi", name: "Delhi", country: "IN", lat: 28.61, lon: 77.21, qlooLocationQuery: "Delhi", prewarm: true },
    ]);
  });

  it("rejects a duplicate slug, naming it", () => {
    expect(() => parseCities([valid, { ...valid }])).toThrow(/duplicate.*delhi/i);
  });

  it("rejects a city with no slug", () => {
    const { slug: _slug, ...noSlug } = valid;
    expect(() => parseCities([noSlug])).toThrow(/slug/);
  });

  it("names the city and the field when another field is missing or mistyped", () => {
    expect(() => parseCities([{ ...valid, lat: "28.6" }])).toThrow(/delhi.*lat/);
    expect(() => parseCities([{ ...valid, prewarm: undefined }])).toThrow(/delhi.*prewarm/);
    expect(() => parseCities([{ ...valid, country: "FR" }])).toThrow(/delhi.*country/);
  });

  it("rejects non-array input", () => {
    expect(() => parseCities({})).toThrow(/array/);
  });
});

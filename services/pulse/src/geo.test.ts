import { describe, expect, it } from "vitest";
import { haversineKm, labelCell } from "./geo.js";

describe("haversineKm", () => {
  it("is zero for the same point and about 111 km per degree of latitude", () => {
    expect(haversineKm({ lat: 28.6, lon: 77.2 }, { lat: 28.6, lon: 77.2 })).toBe(0);
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111.19, 1);
  });
});

describe("labelCell", () => {
  const hoods = [{ name: "Hauz Khas", lat: 28.5494, lon: 77.2001 }, { name: "Karol Bagh", lat: 28.6519, lon: 77.1909 }];

  it("labels a cell with the nearest neighbourhood within 3 km", () => {
    expect(labelCell({ lat: 28.55, lon: 77.205 }, hoods)).toBe("Hauz Khas");
    expect(labelCell({ lat: 28.9, lon: 77.6 }, hoods)).toBeNull();
  });

  it("picks the nearer of two neighbourhoods that are both in range", () => {
    const close = [{ name: "Far", lat: 28.57, lon: 77.2 }, { name: "Near", lat: 28.552, lon: 77.2 }];
    expect(labelCell({ lat: 28.55, lon: 77.2 }, close)).toBe("Near");
  });

  it("breaks an exact distance tie by name so the label is stable", () => {
    const tied = [{ name: "Zeta", lat: 28.56, lon: 77.2 }, { name: "Alpha", lat: 28.56, lon: 77.2 }];
    expect(labelCell({ lat: 28.55, lon: 77.2 }, tied)).toBe("Alpha");
  });

  it("honours a custom radius and returns null with no neighbourhoods", () => {
    expect(labelCell({ lat: 28.55, lon: 77.205 }, hoods, 0.1)).toBeNull();
    expect(labelCell({ lat: 28.55, lon: 77.205 }, [])).toBeNull();
  });
});

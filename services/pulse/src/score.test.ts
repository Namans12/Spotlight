import { describe, expect, it } from "vitest";
import { businessFit, freshness } from "./score.js";

describe("freshness", () => {
  it.each([
    [-4, 0], [-3, 1], [0, 1], [7, 1], [8, 0.5], [14, 0.5], [15, 0], [30, 0],
  ])("daysAhead %i -> %f", (d, want) => expect(freshness(d)).toBe(want));
});

describe("businessFit", () => {
  it("is the share of the top 10 tag names containing a cafe query word, case-insensitively", () => {
    expect(businessFit(["Coffee Shops", "Rooftop", "BAKERY", "Gym"], "cafe")).toBe(0.5);
  });
  it("only looks at the first 10 names", () => {
    const names = [...Array(10).fill("Gym"), "Cafe", "Cafe"];
    expect(businessFit(names, "cafe")).toBe(0);
    expect(businessFit([...Array(8).fill("Gym"), "Cafe", "Dessert Bar", "Cafe"], "cafe")).toBe(0.2);
  });
  it("uses the words of the business type: d2c_food does not count coffee", () => {
    const tags = ["Coffee", "Street Food Stalls", "Snacks", "Gym"];
    expect(businessFit(tags, "cafe")).toBe(0.25);
    expect(businessFit(tags, "d2c_food")).toBe(0.5);
  });
  it("matches an accented spelling of a query word", () => {
    expect(businessFit(["Café", "Gym"], "cafe")).toBe(0.5);
  });
  it("is 0 for an empty list, never NaN", () => {
    expect(businessFit([], "cafe")).toBe(0);
    expect(businessFit([], "d2c_food")).toBe(0);
  });
  it("is 1 when every tag matches", () => {
    expect(businessFit(["cafe", "coffee"], "cafe")).toBe(1);
  });
});

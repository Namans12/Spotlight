import { describe, expect, it } from "vitest";
import { corsHeaders } from "./cors.js";

describe("corsHeaders", () => {
  it("echoes an allowlisted origin", () => {
    expect(corsHeaders("https://pulse.example", ["https://pulse.example"])["Access-Control-Allow-Origin"]).toBe("https://pulse.example");
  });

  it("never sends a wildcard or a foreign origin", () => {
    expect(corsHeaders("https://evil.example", ["https://pulse.example"])["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

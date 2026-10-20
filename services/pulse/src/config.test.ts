import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("defaults Groq to the spec's endpoint and model", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x", PULSE_ALLOWED_ORIGINS: "https://a,https://b" });
    expect(c.groqBaseUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(c.groqModel).toBe("openai/gpt-oss-120b");
    expect(c.allowedOrigins).toEqual(["https://a", "https://b"]);
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});

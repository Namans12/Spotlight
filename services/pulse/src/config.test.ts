import { describe, expect, it } from "vitest";
import { assertTmdbConfigured, loadConfig } from "./config.js";

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

  it("defaults the port and the daily quotas", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x" });
    expect(c.port).toBe(8787);
    expect(c.sessionDailyChat).toBe(30);
    expect(c.globalDailyLlm).toBe(800);
  });

  it("honours valid numeric overrides", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x", PORT: "9000", PULSE_SESSION_DAILY_CHAT: "5", PULSE_GLOBAL_DAILY_LLM: "0" });
    expect(c.port).toBe(9000);
    expect(c.sessionDailyChat).toBe(5);
    expect(c.globalDailyLlm).toBe(0);
  });

  it("falls back to the default for values that are not plain integers", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://x", PORT: "8787abc" }).port).toBe(8787);
    expect(loadConfig({ DATABASE_URL: "postgres://x", PULSE_GLOBAL_DAILY_LLM: "1e3" }).globalDailyLlm).toBe(800);
  });
});

describe("fixtures in production", () => {
  const base = { DATABASE_URL: "postgres://x", QLOO_FIXTURES: "1" };

  it("refuses to start with QLOO_FIXTURES=1 and NODE_ENV=production unless PULSE_ALLOW_FIXTURES=1 is also set", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(
      "QLOO_FIXTURES=1 serves synthetic data and must not run in production; set PULSE_ALLOW_FIXTURES=1 only for a deliberate demo",
    );
    expect(() => loadConfig({ ...base, NODE_ENV: "production", PULSE_ALLOW_FIXTURES: "0" })).toThrow(/PULSE_ALLOW_FIXTURES=1/);
  });

  it("starts, and flags it for a loud startup line, when production fixtures are deliberately allowed", () => {
    const c = loadConfig({ ...base, NODE_ENV: "production", PULSE_ALLOW_FIXTURES: "1" });
    expect(c.qlooFixtures).toBe(true);
    expect(c.fixturesInProduction).toBe(true);
  });

  it("is unaffected outside production, and in production without fixtures", () => {
    for (const env of [{ ...base }, { ...base, NODE_ENV: "development" }, { ...base, NODE_ENV: "test" }]) {
      const c = loadConfig(env);
      expect(c.qlooFixtures).toBe(true);
      expect(c.fixturesInProduction).toBe(false);
    }
    const live = loadConfig({ DATABASE_URL: "postgres://x", NODE_ENV: "production" });
    expect(live.qlooFixtures).toBe(false);
    expect(live.fixturesInProduction).toBe(false);
  });
});

describe("assertTmdbConfigured", () => {
  const live = loadConfig({ DATABASE_URL: "postgres://x" });
  const fixtures = loadConfig({ DATABASE_URL: "postgres://x", QLOO_FIXTURES: "1" });

  it("fails fast outside fixtures mode when TMDB_API_KEY is missing or blank", () => {
    expect(() => assertTmdbConfigured(live, {})).toThrow(/TMDB_API_KEY/);
    expect(() => assertTmdbConfigured(live, { TMDB_API_KEY: "  " })).toThrow(/TMDB_API_KEY/);
  });

  it("passes with a key, and in fixtures mode without one", () => {
    expect(() => assertTmdbConfigured(live, { TMDB_API_KEY: "k" })).not.toThrow();
    expect(() => assertTmdbConfigured(fixtures, {})).not.toThrow();
  });
});

describe("sessionDailyCampaign (R27)", () => {
  it("defaults to 40, separate from the chat quota", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x" });
    expect(c.sessionDailyCampaign).toBe(40);
    expect(c.sessionDailyChat).toBe(30);
  });
  it("honours PULSE_SESSION_DAILY_CAMPAIGN, parsed as strictly as the other quotas", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://x", PULSE_SESSION_DAILY_CAMPAIGN: "2" }).sessionDailyCampaign).toBe(2);
    expect(loadConfig({ DATABASE_URL: "postgres://x", PULSE_SESSION_DAILY_CAMPAIGN: "0" }).sessionDailyCampaign).toBe(0);
    expect(loadConfig({ DATABASE_URL: "postgres://x", PULSE_SESSION_DAILY_CAMPAIGN: "4x" }).sessionDailyCampaign).toBe(40);
    expect(loadConfig({ DATABASE_URL: "postgres://x", PULSE_SESSION_DAILY_CAMPAIGN: "" }).sessionDailyCampaign).toBe(40);
  });
});

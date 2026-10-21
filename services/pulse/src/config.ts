export interface PulseConfig {
  port: number;
  allowedOrigins: string[];
  databaseUrl: string;
  qlooFixtures: boolean;
  /** Synthetic Qloo data is being served in production, by an explicit PULSE_ALLOW_FIXTURES=1. */
  fixturesInProduction: boolean;
  groqApiKey: string | null;
  groqBaseUrl: string;
  groqModel: string;
  /** Sent as `reasoning_effort`; null means it is not sent. Default "low" for openai/gpt-oss models. */
  groqReasoningEffort: string | null;
  warmSecret: string | null;
  sessionDailyChat: number;
  /** Campaign drafts (a brief's campaign, a /guess) per session per UTC day. Separate from chat. */
  sessionDailyCampaign: number;
  /** Chat plus campaign drafts across every session per UTC day. */
  globalDailyLlm: number;
}

const DEFAULT_PORT = 8787;
const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
// Sized for Groq's free tier: 1,000 provider requests a day and 8,000 tokens a
// minute. The units here are drafts and chat turns, and one chat turn can make
// several provider requests, so the global cap is well under 1,000. Raising
// these needs a paid Groq tier, or another OpenAI-compatible provider via
// GROQ_BASE_URL and GROQ_MODEL.
const DEFAULT_SESSION_DAILY_CHAT = 12;
const DEFAULT_SESSION_DAILY_CAMPAIGN = 20;
const DEFAULT_GLOBAL_DAILY_LLM = 300;

/** Only plain digit strings parse; anything else falls back to the default.
 *  parseInt would accept "8787abc" as 8787 and a typo in a quota variable would
 *  then be silently honoured, while a NaN result would be worse still, since
 *  every `count >= limit` comparison treats it as "never exceeded" and so
 *  disables the cap. */
function intOr(raw: string | undefined, fallback: number): number {
  const v = raw?.trim();
  return v && /^\d+$/.test(v) ? Number(v) : fallback;
}

/** Empty strings count as unset, since deploy dashboards commonly leave a
 *  variable defined but blank. */
function optional(raw: string | undefined): string | null {
  const v = raw?.trim();
  return v ? v : null;
}

/** GROQ_REASONING_EFFORT: unset means "low" for openai/gpt-oss models (verified
 *  live on 2026-10-21) and not sent for any other model; "off" or an empty
 *  string turns it off for every model. */
function reasoningEffort(raw: string | undefined, model: string): string | null {
  if (raw === undefined) return model.startsWith("openai/gpt-oss") ? "low" : null;
  const v = raw.trim();
  return v === "" || v.toLowerCase() === "off" ? null : v;
}

/** Reads the service's settings from the environment, failing at startup
 *  rather than on the first request when the one required value is absent. */
export function loadConfig(env: NodeJS.ProcessEnv): PulseConfig {
  const databaseUrl = optional(env.DATABASE_URL);
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const qlooFixtures = env.QLOO_FIXTURES === "1";
  const production = env.NODE_ENV === "production";
  // A forgotten QLOO_FIXTURES=1 would serve invented data as if it were Qloo's.
  if (qlooFixtures && production && env.PULSE_ALLOW_FIXTURES !== "1") {
    throw new Error("QLOO_FIXTURES=1 serves synthetic data and must not run in production; set PULSE_ALLOW_FIXTURES=1 only for a deliberate demo");
  }

  const groqModel = optional(env.GROQ_MODEL) ?? DEFAULT_GROQ_MODEL;
  return {
    port: intOr(env.PORT, DEFAULT_PORT),
    allowedOrigins: (env.PULSE_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    databaseUrl,
    qlooFixtures,
    fixturesInProduction: qlooFixtures && production,
    groqApiKey: optional(env.GROQ_API_KEY),
    groqBaseUrl: optional(env.GROQ_BASE_URL) ?? DEFAULT_GROQ_BASE_URL,
    groqModel,
    groqReasoningEffort: reasoningEffort(env.GROQ_REASONING_EFFORT, groqModel),
    warmSecret: optional(env.PULSE_WARM_SECRET),
    sessionDailyChat: intOr(env.PULSE_SESSION_DAILY_CHAT, DEFAULT_SESSION_DAILY_CHAT),
    sessionDailyCampaign: intOr(env.PULSE_SESSION_DAILY_CAMPAIGN, DEFAULT_SESSION_DAILY_CAMPAIGN),
    globalDailyLlm: intOr(env.PULSE_GLOBAL_DAILY_LLM, DEFAULT_GLOBAL_DAILY_LLM),
  };
}

/** Resolution needs a TMDB key to find IMDb ids for titles Spotlight has not
 *  rated yet. lookupTmdbTitle throws on a missing key (and on a TMDB outage), so
 *  nothing would be cached as a miss, but every uncached title would then fail
 *  to resolve. Outside fixtures mode a missing key must therefore stop the
 *  service at startup, where it is obvious, instead of failing request by request. */
export function assertTmdbConfigured(cfg: Pick<PulseConfig, "qlooFixtures">, env: NodeJS.ProcessEnv): void {
  if (cfg.qlooFixtures) return;
  if (!optional(env.TMDB_API_KEY)) {
    throw new Error("TMDB_API_KEY is required unless QLOO_FIXTURES=1: without it no title that Spotlight has not rated can be resolved");
  }
}

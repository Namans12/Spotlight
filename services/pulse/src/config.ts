export interface PulseConfig {
  port: number;
  allowedOrigins: string[];
  databaseUrl: string;
  qlooFixtures: boolean;
  groqApiKey: string | null;
  groqBaseUrl: string;
  groqModel: string;
  warmSecret: string | null;
  sessionDailyChat: number;
  globalDailyLlm: number;
}

const DEFAULT_PORT = 8787;
const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const DEFAULT_SESSION_DAILY_CHAT = 30;
const DEFAULT_GLOBAL_DAILY_LLM = 800;

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

/** Reads the service's settings from the environment, failing at startup
 *  rather than on the first request when the one required value is absent. */
export function loadConfig(env: NodeJS.ProcessEnv): PulseConfig {
  const databaseUrl = optional(env.DATABASE_URL);
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  return {
    port: intOr(env.PORT, DEFAULT_PORT),
    allowedOrigins: (env.PULSE_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    databaseUrl,
    qlooFixtures: env.QLOO_FIXTURES === "1",
    groqApiKey: optional(env.GROQ_API_KEY),
    groqBaseUrl: optional(env.GROQ_BASE_URL) ?? DEFAULT_GROQ_BASE_URL,
    groqModel: optional(env.GROQ_MODEL) ?? DEFAULT_GROQ_MODEL,
    warmSecret: optional(env.PULSE_WARM_SECRET),
    sessionDailyChat: intOr(env.PULSE_SESSION_DAILY_CHAT, DEFAULT_SESSION_DAILY_CHAT),
    globalDailyLlm: intOr(env.PULSE_GLOBAL_DAILY_LLM, DEFAULT_GLOBAL_DAILY_LLM),
  };
}

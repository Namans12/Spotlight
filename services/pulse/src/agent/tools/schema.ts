// The JSON Schemas the harness publishes are richer than a model provider's
// function-calling layer is known to accept (`examples`, `default`,
// `uniqueItems`, `$schema`, ...). Whether Groq tolerates them is unverified, and
// a rejected tool list would fail every chat, so what is sent to the provider
// is a conservative subset of JSON Schema. The harness still validates the real
// call against its own schema; this only shapes what the model is shown.

const KEEP = new Set(["type", "required", "enum", "minItems", "maxItems", "minimum", "maximum", "minLength", "maxLength", "description"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `properties` is a map of names to schemas: its keys are data, never filtered. */
function normaliseProperties(props: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).filter(([k]) => k !== "__proto__").map(([k, v]) => [k, normaliseToolSchema(v)]));
}

export function normaliseToolSchema(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (KEEP.has(k)) out[k] = v;
    else if (k === "properties" && isRecord(v)) out.properties = normaliseProperties(v);
    else if (k === "items") out.items = Array.isArray(v) ? v.map(normaliseToolSchema) : normaliseToolSchema(v);
    else if (k === "additionalProperties") out.additionalProperties = typeof v === "boolean" ? v : normaliseToolSchema(v);
  }
  return out;
}

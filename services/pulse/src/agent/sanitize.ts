// Everything the model hands the agent (tool arguments) or gets back from it
// (tool results) passes through here. Arguments are model output, so they are
// bounded and stripped of anything the tool's schema does not name before a
// tool sees them; results are third-party data, so they are bounded before
// they re-enter the model's context, and only a short summary reaches the user.

export const MAX_STRING = 120;
export const MAX_ARRAY = 10;
/** Containers may nest this deep inside the arguments object (which is level 0). */
export const MAX_DEPTH = 2;
const MAX_KEYS = 20;
/** Characters of a tool result the model receives. Every result is re-sent on each later round, and Groq's free tier allows 8,000 tokens a minute. */
export const MAX_RESULT_CHARS = 2800;
export const MAX_SUMMARY_CHARS = 200;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Tool-call arguments arrive as JSON text (or, from some providers, an
 *  object). Only a JSON object is a valid argument list; no arguments at all
 *  is an empty one. */
export function parseArguments(raw: unknown): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: {} };
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return { ok: false }; }
  }
  return isPlainObject(value) ? { ok: true, value } : { ok: false };
}

const DROP = Symbol("drop");

/** `level` is how deep the container v would sit; the arguments object is 0. */
function clean(v: unknown, level: number): unknown {
  if (typeof v === "string") return [...v].length > MAX_STRING ? [...v].slice(0, MAX_STRING).join("") : v;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : DROP;
  if (level > MAX_DEPTH) return DROP;
  if (Array.isArray(v)) return v.slice(0, MAX_ARRAY).map((x) => clean(x, level + 1)).filter((x) => x !== DROP);
  if (isPlainObject(v)) return cleanObject(v, level, null);
  return DROP; // null, undefined, functions, symbols, bigint
}

function cleanObject(o: Record<string, unknown>, level: number, allowed: Set<string> | null): Record<string, unknown> {
  const entries: [string, unknown][] = [];
  for (const [k, v] of Object.entries(o)) {
    // fromEntries below defines own properties, so "__proto__" could not
    // change a prototype; it is dropped anyway because no tool wants it.
    if (k === "__proto__" || (allowed && !allowed.has(k))) continue;
    const c = clean(v, level + 1);
    if (c === DROP) continue;
    entries.push([k, c]);
    if (entries.length >= MAX_KEYS) break;
  }
  return Object.fromEntries(entries);
}

/** The arguments a tool may see: strings cut to 120 characters, arrays to 10
 *  items, containers nested at most two deep, at most 20 keys, and, when the
 *  tool's schema says `additionalProperties: false`, only the keys it lists. */
export function sanitiseArgs(args: Record<string, unknown>, schema?: unknown): Record<string, unknown> {
  const s = isPlainObject(schema) ? schema : null;
  const props = s && isPlainObject(s.properties) ? Object.keys(s.properties) : null;
  const closed = s?.additionalProperties === false && props !== null;
  return cleanObject(args, 0, closed ? new Set(props) : null);
}

/** A tool result as the text the model receives: its JSON, at most 2800
 *  characters. Over the limit it becomes a valid JSON object that says so and
 *  carries the start of the data, so the model is never shown a cut-off
 *  result as if it were complete. */
export function truncateResult(value: unknown, max = MAX_RESULT_CHARS): string {
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { text = undefined; }
  if (typeof text !== "string") return JSON.stringify({ error: "unserialisable_result" });
  if (text.length <= max) return text;
  const wrap = (preview: string) => JSON.stringify({ truncated: true, note: "…truncated", preview });
  // JSON escaping can grow the preview, so shrink it until the whole thing fits.
  let keep = Math.max(0, max - 80);
  let out = wrap(text.slice(0, keep));
  while (out.length > max && keep > 0) {
    keep = Math.floor(keep * 0.9);
    out = wrap(text.slice(0, keep));
  }
  return out;
}

const cut = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join("")}…` : s);

/** What the user is shown for a tool result: at most 200 characters. An error
 *  result shows its error, a harness result its own summary sentence, and
 *  anything else only its shape (counts and short scalars), never its
 *  contents, so a large or odd payload cannot flood the page. */
export function summarise(result: unknown, max = MAX_SUMMARY_CHARS): string {
  if (Array.isArray(result)) return cut(`[${result.length} items]`, max);
  if (!isPlainObject(result)) return cut(String(result ?? "no result").replace(/\s+/g, " "), max);
  if (typeof result.error === "string") return cut(`error: ${result.error}`, max);
  if (typeof result.summary === "string" && result.summary.trim()) return cut(result.summary.replace(/\s+/g, " ").trim(), max);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(result).slice(0, 8)) {
    if (Array.isArray(v)) parts.push(`${k}[${v.length}]`);
    else if (typeof v === "string") parts.push(`${k}=${cut(v.replace(/\s+/g, " "), 30)}`);
    else if (typeof v === "number" || typeof v === "boolean") parts.push(`${k}=${v}`);
  }
  return cut(parts.join(", ") || "ok", max);
}

const BOUND_STRING = 200;
const BOUND_ARRAY = 10;
const BOUND_KEYS = 20;
const BOUND_DEPTH = 4;

/** A third-party payload cut down to something that is safe to hand the model:
 *  strings cleaned (see cleanText) and cut to 200 characters, arrays to 10
 *  items, objects to 20 keys, nesting to 4 levels, nulls dropped. Never the
 *  whole payload. */
export function boundValue(v: unknown, clean: (s: string, max: number) => string, depth = 0): unknown {
  if (typeof v === "string") return clean(v, BOUND_STRING);
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (depth >= BOUND_DEPTH) return undefined;
  if (Array.isArray(v)) return v.slice(0, BOUND_ARRAY).map((x) => boundValue(x, clean, depth + 1)).filter((x) => x !== undefined);
  if (isPlainObject(v)) {
    const entries: [string, unknown][] = [];
    for (const [k, x] of Object.entries(v)) {
      if (k === "__proto__") continue;
      const b = boundValue(x, clean, depth + 1);
      if (b !== undefined) entries.push([k, b]);
      if (entries.length >= BOUND_KEYS) break;
    }
    return Object.fromEntries(entries);
  }
  return undefined;
}

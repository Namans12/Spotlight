// The Qloo harness tools the model may call directly. Only an explicit
// allowlist is offered, intersected with what the harness really lists, so a
// tool added to the harness later (or one that writes, or inspects the host)
// never reaches the model by accident. The harness's own input schemas are the
// tool parameters, and its reply is cut down before the model sees it.

import { cleanText } from "../../campaign.js";
import type { ToolSpec } from "../../llm/client.js";
import { boundValue } from "../sanitize.js";
import { normaliseToolSchema } from "./schema.js";
import type { AgentTool, AgentToolDeps } from "./types.js";

/** The exact tool names from the harness's own tool list. */
export const QLOO_AGENT_TOOLS = [
  "qloo_recommend",
  "qloo_where_popular",
  "qloo_audience_demographics",
  "qloo_rank",
  "qloo_compare_audiences",
  "qloo_find_tags",
  "qloo_describe",
] as const;

/** The fixture client's only tool, allowed in fixtures mode so the agent can be
 *  run end to end with no Qloo key. */
const FIXTURE_TOOL = "qloo_fixture_echo";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The harness reply as the model should see it: status, its own summary
 *  sentence, the result rows (bounded), warnings, and on failure the code and
 *  recovery hint. Its execution trace, provenance block and query echo are
 *  dropped: they are large and the model has no use for them. */
export function compactHarnessResult(tool: string, raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return { tool, status: "error", error: { code: "unreadable_result", recovery: "Qloo returned a result this service could not read." } };
  const out: Record<string, unknown> = { tool, status: typeof raw.status === "string" ? cleanText(raw.status, 20) : "unknown" };
  if (typeof raw.summary === "string") out.summary = cleanText(raw.summary, 300);
  if (typeof raw.result_count === "number" && Number.isFinite(raw.result_count)) out.result_count = raw.result_count;
  if (raw.results !== undefined) out.results = boundValue(raw.results, cleanText);
  if (Array.isArray(raw.warnings)) out.warnings = raw.warnings.filter((w): w is string => typeof w === "string").slice(0, 5).map((w) => cleanText(w, 200));
  if (isRecord(raw.error)) {
    out.error = {
      ...(typeof raw.error.code === "string" ? { code: cleanText(raw.error.code, 60) } : {}),
      ...(typeof raw.error.recovery === "string" ? { recovery: cleanText(raw.error.recovery, 300) } : {}),
    };
  }
  return out;
}

function asSpec(name: string, description: string, inputSchema: unknown): ToolSpec {
  // A conservative subset (see schema.ts); a non-object schema becomes an empty parameter list.
  const normalised = isRecord(inputSchema) && inputSchema.type === "object" ? normaliseToolSchema(inputSchema) : { type: "object", properties: {} };
  return { type: "function", function: { name, description: cleanText(description, 400), parameters: normalised } };
}

/** An allowlisted tool the harness does not list is simply absent. A harness
 *  that cannot be listed at all costs the model these tools, not the whole
 *  agent: the Pulse tools still work. */
export async function harnessTools(deps: AgentToolDeps): Promise<AgentTool[]> {
  let listed: Awaited<ReturnType<AgentToolDeps["qloo"]["listTools"]>>;
  try {
    listed = await deps.qloo.listTools();
  } catch (err) {
    try { deps.onError?.("listTools", err); } catch { /* a broken logger must not break the request */ }
    return [];
  }
  const allowed = new Set<string>([...QLOO_AGENT_TOOLS, ...(deps.fixtures ? [FIXTURE_TOOL] : [])]);
  return listed
    .filter((t) => allowed.has(t.name))
    .map((t): AgentTool => ({
      spec: asSpec(t.name, t.description, t.inputSchema),
      // Counted against the chat's Qloo budget, and cancellable while it waits in the limiter.
      budget: "harness",
      run: async (args, ctx) => compactHarnessResult(t.name, await deps.qloo.callTool(t.name, args, { signal: ctx?.signal })),
    }));
}

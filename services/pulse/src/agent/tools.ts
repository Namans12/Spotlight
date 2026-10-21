// The agent's tool registry: four Spotlight tools plus the allowlisted Qloo
// harness tools. Each tool lives in tools/ and stays small; this file only
// assembles them, and caches the assembled set (the harness tool list does not
// change within a process's life in practice, and listing it costs a round trip).

import { harnessTools } from "./tools/harness.js";
import { pulseBoardTool } from "./tools/pulseBoard.js";
import { releaseBriefTool } from "./tools/releaseBrief.js";
import { searchReleasesTool } from "./tools/searchReleases.js";
import { titlesShotInTool } from "./tools/titlesShotIn.js";
import type { AgentTool, AgentToolDeps } from "./tools/types.js";

export type { AgentTool, AgentToolDeps } from "./tools/types.js";
export { QLOO_AGENT_TOOLS } from "./tools/harness.js";

/** pulse_board, release_brief, search_releases, titles_shot_in, then whichever
 *  allowlisted harness tools the harness lists. */
export async function buildTools(deps: AgentToolDeps): Promise<AgentTool[]> {
  return [pulseBoardTool(deps), releaseBriefTool(deps), searchReleasesTool(deps), titlesShotInTool(deps), ...(await harnessTools(deps))];
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** `buildTools` behind a time-based cache. A build that could not list the
 *  harness (an outage) is NOT kept, so one blip does not strip the Qloo tools
 *  for the whole ttl. */
export function createToolProvider(deps: AgentToolDeps, opts: { ttlMs?: number; now?: () => number } = {}): () => Promise<AgentTool[]> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now;
  let kept: { tools: AgentTool[]; at: number } | null = null;
  return async () => {
    if (kept && now() - kept.at < ttl) return kept.tools;
    let degraded = false;
    const tools = await buildTools({ ...deps, onError: (context, err) => { if (context === "listTools") degraded = true; deps.onError?.(context, err); } });
    if (!degraded) kept = { tools, at: now() };
    return tools;
  };
}

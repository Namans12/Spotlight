import type { BoardDeps } from "../../board.js";
import type { BriefDeps } from "../../brief.js";
import type { EvidenceSql } from "../../db/evidence.js";
import type { ToolSpec } from "../../llm/client.js";
import type { QlooClient } from "../../qloo/client.js";
import type { TitleKey } from "../../resolve.js";

/** One thing the model may call. `run` gets arguments the loop has already
 *  sanitised, and a signal that aborts when the call times out or the client
 *  leaves. A tool reports a bad argument by RETURNING `{error, ...}` (data the
 *  model can act on); throwing is for real failures, which the loop turns into
 *  a fixed "the tool failed" result. */
export interface AgentTool {
  spec: ToolSpec;
  /** "harness" marks a call that goes to Qloo uncached; the loop caps those per chat. */
  budget?: "harness";
  run(args: Record<string, unknown>, ctx?: { signal: AbortSignal }): Promise<unknown>;
}

export interface AgentToolDeps {
  /** One tagged-template statement type serves every read the tools make. */
  sql: EvidenceSql;
  qloo: QlooClient;
  resolve: BriefDeps["resolve"];
  header: BriefDeps["header"];
  /** True when Spotlight already knows the title (release data, or resolved before). */
  isKnown: (key: TitleKey) => Promise<boolean>;
  enqueueWarm: BoardDeps["enqueueWarm"];
  enqueueRank?: BoardDeps["enqueueRank"];
  /** Fixtures mode: the fixture client's stand-in harness tool is offered too. */
  fixtures?: boolean;
  now?: () => Date;
  onError?: (context: string, err: unknown) => void;
}

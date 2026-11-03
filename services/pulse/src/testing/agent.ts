// Doubles for the agent tests: a scripted tool, tool-call messages, and timers
// that fire only when a test says so. No test framework is imported, as with
// fakes.ts, so this file also type-checks under the service's own tsconfig.

import type { AgentTool } from "../agent/tools.js";
import type { ChatMessage, ToolCall } from "../llm/client.js";
import type { Timers } from "../timers.js";

export const user = (content: string): ChatMessage => ({ role: "user", content });
export const assistant = (content: string): ChatMessage => ({ role: "assistant", content });

let nextId = 0;
export const call = (name: string, args: unknown = {}, id?: string): ToolCall => ({
  id: id ?? `call_${++nextId}`,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
export const toolCallMsg = (...calls: ToolCall[]): ChatMessage => ({ role: "assistant", content: null, tool_calls: calls });

export async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

export interface FakeTool extends AgentTool {
  /** The (already sanitised) arguments each run() received. */
  calls: Record<string, unknown>[];
  signals: (AbortSignal | undefined)[];
}

/** A tool that returns `result` (or what the function returns, or throws if it throws). */
export function fakeTool(
  name: string,
  result: unknown | ((args: Record<string, unknown>, signal?: AbortSignal) => unknown),
  parameters: Record<string, unknown> = { type: "object", properties: {}, additionalProperties: true },
): FakeTool {
  const calls: Record<string, unknown>[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  return {
    spec: { type: "function", function: { name, description: `fake ${name}`, parameters } },
    calls,
    signals,
    async run(args, ctx) {
      calls.push(args);
      signals.push(ctx?.signal);
      return typeof result === "function" ? (result as (a: Record<string, unknown>, s?: AbortSignal) => unknown)(args, ctx?.signal) : result;
    },
  };
}

export interface ManualTimers extends Timers {
  /** Timeouts and intervals not yet cleared (or fired, for timeouts). */
  pending(): number;
  /** Runs the pending callbacks once (only those set with `ms`, when given); timeouts are then gone, intervals stay. */
  fire(ms?: number): void;
  cleared: number;
  readonly intervalMs: number[];
  /** The delay of every setTimeout, in order. */
  readonly timeoutMs: number[];
}

export function manualTimers(): ManualTimers {
  let id = 0;
  const live = new Map<number, { fn: () => void; interval: boolean; ms: number }>();
  const intervalMs: number[] = [];
  const timeoutMs: number[] = [];
  const t: ManualTimers = {
    setTimeout: (fn, ms) => { timeoutMs.push(ms); live.set(++id, { fn, interval: false, ms }); return id; },
    clearTimeout: (h) => { if (live.delete(h as number)) t.cleared++; },
    setInterval: (fn, ms) => { intervalMs.push(ms); live.set(++id, { fn, interval: true, ms }); return id; },
    clearInterval: (h) => { if (live.delete(h as number)) t.cleared++; },
    pending: () => live.size,
    fire(ms) {
      for (const [k, v] of [...live]) {
        if (ms !== undefined && v.ms !== ms) continue;
        if (!v.interval) live.delete(k);
        v.fn();
      }
    },
    cleared: 0,
    intervalMs,
    timeoutMs,
  };
  return t;
}

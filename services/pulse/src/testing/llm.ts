// A scripted LlmClient for the campaign tests: each chat() call returns the
// next scripted reply and records the messages it was given. No test framework
// is imported, as with fakes.ts.

import type { ChatMessage, LlmClient } from "../llm/client.js";

type ChatOpts = Parameters<LlmClient["chat"]>[1];

export interface FakeLlm extends LlmClient {
  /** A snapshot of the messages passed to each chat() call, in order. */
  calls: ChatMessage[][];
  /** The options passed to each chat() call. */
  opts: ChatOpts[];
}

/** Replies are returned in order; the last one repeats if the script runs out.
 *  An Error in the script is thrown instead of returned, and a function is
 *  called with the messages to compute the reply text. */
export function fakeLlm(script: (string | Error | ChatMessage | ((messages: ChatMessage[]) => string))[]): FakeLlm {
  const calls: ChatMessage[][] = [];
  const opts: FakeLlm["opts"] = [];
  return {
    calls,
    opts,
    async chat(messages, o) {
      calls.push(messages.map((m) => ({ ...m })));
      opts.push(o);
      const next = script[Math.min(calls.length - 1, script.length - 1)];
      if (next instanceof Error) throw next;
      if (typeof next === "function") return { role: "assistant", content: next(messages) };
      return typeof next === "string" ? { role: "assistant", content: next } : next;
    },
  };
}

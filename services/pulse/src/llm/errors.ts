// The one error type the LLM layer throws: a kind and a fixed sentence. Kept in
// its own file so the client and the pacer can both throw it without importing
// each other. The key, the request body and the upstream response body never
// appear in a message, a stack line or a `cause`.

export type LlmErrorKind = "rate_limited" | "unavailable" | "bad_response";

export class LlmError extends Error {
  /** True for a `rate_limited` whose provider wait was too long to sit out (the
   *  daily limit, minutes away): callers then say "try again later", not "in a minute". */
  readonly limitReached: boolean;
  constructor(readonly kind: LlmErrorKind, message: string, opts: { limitReached?: boolean } = {}) {
    super(message);
    this.name = "LlmError";
    this.limitReached = opts.limitReached === true;
  }
}

// The one error type the LLM layer throws: a kind and a fixed sentence. Kept in
// its own file so the client and the pacer can both throw it without importing
// each other. The key, the request body and the upstream response body never
// appear in a message, a stack line or a `cause`.

export type LlmErrorKind = "rate_limited" | "unavailable" | "bad_response";

export class LlmError extends Error {
  constructor(readonly kind: LlmErrorKind, message: string) {
    super(message);
    this.name = "LlmError";
  }
}

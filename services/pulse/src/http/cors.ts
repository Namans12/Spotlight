/** CORS headers for one request. The allowlist is matched exactly and the
 *  matching origin is echoed back; a wildcard would let any site's script read
 *  responses, and an unlisted origin simply gets no Allow-Origin header so the
 *  browser blocks it. `Vary: Origin` is always sent because the response
 *  differs by origin and a shared cache must not serve one origin's headers to
 *  another. */
export function corsHeaders(origin: string | undefined, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Pulse-Session";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

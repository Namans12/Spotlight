import type { IncomingMessage, ServerResponse } from "node:http";

export type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

/** Dispatches on an exact "METHOD /path" key. A table lookup rather than a
 *  framework: the service has a handful of fixed routes and no path
 *  parameters, so there is nothing a routing library would add. */
export function createRouter(routes: Record<string, Handler>): Handler {
  // Object.hasOwn rather than `routes[key]`, so a request for "GET /constructor"
  // cannot resolve to something inherited from Object.prototype.
  return async (req, res, url) => {
    const key = `${req.method ?? "GET"} ${url.pathname}`;
    const handler = Object.hasOwn(routes, key) ? routes[key] : undefined;
    if (!handler) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    await handler(req, res, url);
  };
}

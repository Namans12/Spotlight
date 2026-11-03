import { createHash, timingSafeEqual } from "node:crypto";
import { getCity, type City } from "../cities.js";
import type { Handler } from "../http/router.js";
import type { WarmReport } from "../warm.js";

export interface WarmRouteDeps {
  /** PULSE_WARM_SECRET; null disables the endpoint. */
  secret: string | null;
  /** Warms one city, or the prewarm cities when given null. */
  warm: (city: City | null) => Promise<WarmReport>;
  onError?: (context: string, err: unknown) => void;
}

function json(res: Parameters<Handler>[1], status: number, body: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Compares digests, not the strings: timingSafeEqual needs equal lengths,
 *  and hashing gives that without revealing the secret's length. */
function sameSecret(given: string, secret: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

/** POST /warm[?city=][&wait=1], called by the Wed/Fri workflow after the
 *  release bot. Disabled (503) with no secret configured; 401 without the
 *  bearer. By default answers 202 at once and warms in the background, since
 *  a run can outlast an HTTP timeout; `wait=1` waits and returns the report. */
export function warmHandler(deps: WarmRouteDeps): Handler {
  const report = (context: string, err: unknown) => {
    try { deps.onError?.(context, err); } catch { /* ignore */ }
  };
  return async (req, res, url) => {
    if (deps.secret === null) return json(res, 503, { error: "warm_disabled" });
    const header = req.headers.authorization ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (given === null || given === "" || !sameSecret(given, deps.secret)) return json(res, 401, { error: "unauthorized" });

    const slug = url.searchParams.get("city");
    let city: City | null = null;
    if (slug !== null) {
      city = getCity(slug);
      if (!city) return json(res, 400, { error: "unknown_city" });
    }

    if (url.searchParams.get("wait") === "1") {
      try {
        return json(res, 200, await deps.warm(city));
      } catch (err) {
        report("warm", err);
        return json(res, 500, { error: "warm_failed" });
      }
    }
    json(res, 202, { started: true });
    // After the answer is out; a failure here has nobody to tell but the log.
    void Promise.resolve().then(() => deps.warm(city)).catch((err) => report("warm", err));
  };
}

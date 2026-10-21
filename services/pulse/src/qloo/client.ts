// The service's view of Qloo. Everything else (the builder, the agent, the
// routes) depends on the QlooClient interface below, so the real harness and
// the synthetic fixtures are interchangeable and nothing downstream knows
// which one it has.

import type {
  DemographicsData, EvidenceSection, EvidenceStatus, HeatCell, NamedEntity, Provenance, TagAffinity, Venue,
} from "../../../../shared/types/pulse.js";
import type { PulseConfig } from "../config.js";
import type { City } from "../cities.js";
import { createFixtureClient } from "./fixtures.js";
import { createHarnessTransport, type HarnessTransport } from "./harness.js";
import { createLimiter, RateLimitedError } from "./limiter.js";
import * as recipes from "./recipes.js";

export interface QlooEntityRef { entityId: string; name: string; type: "movie" | "tv_show"; year: number | null; }

export interface QlooClient {
  entityByImdb(imdbId: string): Promise<QlooEntityRef | null>;
  searchTitles(title: string, type: "movie" | "tv_show"): Promise<QlooEntityRef[]>;
  demographics(entityId: string): Promise<EvidenceSection<DemographicsData>>;
  heatmap(entityId: string, city: City): Promise<EvidenceSection<Omit<HeatCell, "neighbourhood">[]>>;
  places(entityId: string, city: City, includeTagIds: string[]): Promise<EvidenceSection<Venue[]>>;
  placeTags(entityId: string, city: City): Promise<EvidenceSection<TagAffinity[]>>;
  artists(entityId: string): Promise<EvidenceSection<NamedEntity[]>>;
  brands(entityId: string): Promise<EvidenceSection<NamedEntity[]>>;
  trends(entityId: string): Promise<EvidenceSection<{ date: string; percentile: number }[]>>;
  findTags(query: string, parentType: "place" | "brand"): Promise<{ tagId: string; name: string }[]>;
  listTools(): Promise<{ name: string; description: string; inputSchema: unknown }[]>; // for the agent
  /** For the agent. An aborted `signal` stops a call that is still queued behind the limiter. */
  callTool(name: string, args: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<unknown>;
  /** Stops the harness process, if one was started. Optional because the
   *  fixture client has nothing to stop. */
  close?(): Promise<void>;
}

const STATUSES: readonly EvidenceStatus[] = ["ok", "empty", "needs_input", "partial", "degraded", "error"];

function provenance(call: string, params: Record<string, string>): Provenance[] {
  return [{ source: "qloo", call, params, limits: recipes.limitsFor(call) }];
}

function failed<T>(call: string, params: Record<string, string>, note: string): EvidenceSection<T> {
  return { status: "error", data: null, provenance: provenance(call, params), note };
}

/** Turns the harness's result envelope into an EvidenceSection. It carries
 *  the harness's own status through and never fills in data the harness did
 *  not return: empty, needs_input and error sections have `data: null`, and
 *  the harness's explanation travels as `note`. */
export function mapHarnessResult<T>(
  raw: unknown,
  call: string,
  params: Record<string, string>,
  pick: (results: unknown[]) => T,
): EvidenceSection<T> {
  const env = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  const status = env?.status;
  if (!env || typeof status !== "string" || !STATUSES.includes(status as EvidenceStatus)) {
    return failed(call, params, "Qloo returned a result this service could not read.");
  }
  const results = Array.isArray(env.results) ? env.results : [];
  const error = typeof env.error === "object" && env.error !== null ? (env.error as Record<string, unknown>) : null;
  const note = [
    typeof env.summary === "string" ? env.summary : null,
    typeof error?.recovery === "string" ? error.recovery : null,
    ...(Array.isArray(env.warnings) ? env.warnings.filter((w): w is string => typeof w === "string") : []),
    typeof error?.code === "string" ? `(${error.code})` : null,
  ].filter(Boolean).join(" ");
  const withNote = note ? { note } : {};

  if (status === "empty" || status === "needs_input" || status === "error") {
    return { status, data: null, provenance: provenance(call, params), ...withNote };
  }
  // A row-less ok is the harness saying "found nothing" in different words.
  if (results.length === 0) {
    return { status: "empty", data: null, provenance: provenance(call, params), ...withNote };
  }
  try {
    return { status: status as EvidenceStatus, data: pick(results), provenance: provenance(call, params), ...(status === "ok" ? {} : withNote) };
  } catch (err) {
    // The reply was well-formed but not the shape the recipe expects: say so
    // rather than hand the UI a half-read result.
    return failed(call, params, `Qloo's result was not in the expected shape: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A retryable rate-limit error from the harness becomes the limiter's cue to
 *  back off; every other error envelope is mapped, not thrown. */
function throwIfRateLimited(raw: unknown): void {
  const env = raw as { status?: unknown; error?: { code?: unknown; retryable?: unknown } } | null;
  if (env?.status === "error" && env.error?.retryable === true && /rate.?limit|429/i.test(String(env.error.code))) {
    throw new RateLimitedError(`Qloo rate limit (${String(env.error.code)})`);
  }
}

export interface HarnessClientOptions {
  /** Injectable so tests do not wait out the real backoffs. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export function createHarnessQlooClient(transport: HarnessTransport, opts: HarnessClientOptions = {}): QlooClient {
  const now = opts.now ?? (() => new Date());
  // Two at a time, then 3s and 8s waits on a 429. The limits are Qloo's tier,
  // not ours to tune per call site.
  const limited = createLimiter({ concurrency: 2, backoffMs: [3000, 8000], ...(opts.sleep ? { sleep: opts.sleep } : {}) });

  // Remembered from title lookups so trends need not ask Qloo for the type
  // again; qloo_trends requires it and the QlooClient interface does not carry it.
  const typeOf = new Map<string, "movie" | "tv_show">();
  const remember = (refs: QlooEntityRef[]) => { for (const r of refs) typeOf.set(r.entityId, r.type); return refs; };

  const callTool = (name: string, args: Record<string, unknown>, callOpts: { signal?: AbortSignal } = {}) =>
    limited(async () => {
      const raw = await transport.callTool(name, args);
      throwIfRateLimited(raw);
      return raw;
    }, { signal: callOpts.signal });

  async function section<T>(r: recipes.ToolRecipe<T>): Promise<EvidenceSection<T>> {
    try {
      const raw = await callTool(r.tool, r.args);
      return mapHarnessResult(r.envelope ? r.envelope(raw) : raw, r.call, r.params, r.pick);
    } catch (err) {
      return failed(r.call, r.params, `Qloo call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function titleType(entityId: string): Promise<"movie" | "tv_show" | null> {
    const known = typeOf.get(entityId);
    if (known) return known;
    const d = recipes.describeType(entityId);
    const s = await section(d);
    if (s.data) typeOf.set(entityId, s.data);
    return s.data;
  }

  return {
    async entityByImdb(imdbId) {
      const req = recipes.entityByImdbRequest(imdbId);
      const body = await limited(() => transport.getJson(req.path, req.params));
      const ref = recipes.parseImdbMatch(body, imdbId);
      if (ref) typeOf.set(ref.entityId, ref.type);
      return ref;
    },
    async searchTitles(title, type) {
      const req = recipes.searchTitlesRequest(title, type);
      const body = await limited(() => transport.getJson(req.path, req.params));
      return remember(recipes.parseEntityRefs(body));
    },
    demographics: (entityId) => section(recipes.demographics(entityId)),
    heatmap: (entityId, city) => section(recipes.heatmap(entityId, city)),
    places: (entityId, city, includeTagIds) => section(recipes.places(entityId, city, includeTagIds)),
    async placeTags(entityId, city) {
      const venues = await section(recipes.venuesToTag(entityId, city));
      if (!venues.data || venues.data.length === 0) {
        return { status: venues.status, data: null, provenance: venues.provenance, ...(venues.note ? { note: venues.note } : {}) };
      }
      const tags = await section(recipes.tagsOfVenues(venues.data));
      return { ...tags, provenance: [...venues.provenance, ...tags.provenance] };
    },
    artists: (entityId) => section(recipes.artists(entityId)),
    brands: (entityId) => section(recipes.brands(entityId)),
    async trends(entityId) {
      const type = await titleType(entityId);
      if (!type) return failed("trends", { entity_id: entityId }, "Could not work out whether this title is a movie or a show, which Qloo's trends need.");
      return section(recipes.trends(entityId, type, now()));
    },
    async findTags(query, parentType) {
      const r = recipes.findTags(query, parentType);
      const raw = await callTool(r.tool, r.args);
      const s = mapHarnessResult(raw, r.call, r.params, r.pick);
      // An outage must not read as "Qloo has no such tag".
      if (s.status === "error" || s.status === "needs_input") throw new Error(s.note ?? "Qloo tag search failed");
      return s.data ?? [];
    },
    async listTools() { return transport.listTools(); },
    callTool,
    close: () => transport.close(),
  };
}

export function createQlooClient(
  cfg: PulseConfig,
  deps: { transport?: HarnessTransport } & HarnessClientOptions = {},
): QlooClient {
  if (cfg.qlooFixtures) return createFixtureClient();
  const { transport, ...opts } = deps;
  return createHarnessQlooClient(transport ?? createHarnessTransport(), opts);
}

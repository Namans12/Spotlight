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

export const NO_FOOD_THEMES_NOTE = "No food or drink themes stood out for this audience in this city.";

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

/** The harness's HTTP 400 for an entity Qloo has too little signal on
 *  (QLOO_CONTRACT, not retryable). Returns the code, or null for any other reply. */
function contractRejection(raw: unknown): string | null {
  const env = raw as { status?: unknown; error?: { code?: unknown; retryable?: unknown } } | null;
  return env?.status === "error" && env.error?.code === "QLOO_CONTRACT" && env.error.retryable !== true ? "QLOO_CONTRACT" : null;
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

  // Circuit guard for the thin-signal mapping below. The harness uses
  // QLOO_CONTRACT for every HTTP 400, so a recipe or argument bug (a city
  // string Qloo rejects, a renamed tag id, too many include_tags) looks exactly
  // like "thin-signal title" for EVERY title, and would be cached as such for 3
  // days. A call rejected nearly every time is not a thin-signal title: per
  // call name, remember the last 20 outcomes (true = contract rejection; a
  // success, a thin-signal answer's non-rejections and any other error all
  // count false), and stop mapping to `empty` once a rejection arrives with
  // at least 10 samples of which at least 90% were rejections. The trip ends
  // when the ratio falls below 50%. State is per client instance.
  const RING = 20;
  const MIN_SAMPLES = 10;
  const TRIP_RATIO = 0.9;
  const RESET_RATIO = 0.5;
  const rings = new Map<string, { outcomes: boolean[]; tripped: boolean }>();

  /** Records one outcome; true when the call is currently tripped. */
  function recordOutcome(call: string, rejected: boolean): boolean {
    let st = rings.get(call);
    if (!st) rings.set(call, (st = { outcomes: [], tripped: false }));
    st.outcomes.push(rejected);
    if (st.outcomes.length > RING) st.outcomes.shift();
    const ratio = st.outcomes.filter(Boolean).length / st.outcomes.length;
    if (st.tripped) {
      if (ratio < RESET_RATIO) st.tripped = false;
    } else if (rejected && st.outcomes.length >= MIN_SAMPLES && ratio >= TRIP_RATIO) {
      st.tripped = true;
      console.error(`qloo contract rejections for ${call} exceed 90% of the last 20 calls \u2014 the recipe may be broken (not a thin-signal title)`);
    }
    return st.tripped;
  }

  /** Every call keyed on one title goes through here, and a contract
   *  rejection of it means "too little taste data on this title": an answer
   *  (empty, so it caches for 3 days and the board stops waiting on it) rather
   *  than a failure that re-fails on every request. It is still logged, with
   *  no params or keys, so a genuine recipe bug stays visible in the server log
   *  instead of hiding as "empty"; and while the circuit guard above is tripped
   *  the rejection is an ordinary error section (never cached, so retried).
   *  `thinSignal: false` is for lookups that are not entity-signal calls (the
   *  type lookup behind trends): no mapping, no guard. */
  async function section<T>(r: recipes.ToolRecipe<T>, opts: { thinSignal?: boolean } = {}): Promise<EvidenceSection<T>> {
    const guarded = opts.thinSignal !== false;
    let recorded = false;
    try {
      const raw = await callTool(r.tool, r.args);
      const rejected = guarded ? contractRejection(raw) : null;
      recorded = guarded;
      const tripped = guarded ? recordOutcome(r.call, rejected !== null) : false;
      if (rejected && !tripped) {
        console.warn(`qloo contract rejection (${r.call}): ${rejected}`);
        return { status: "empty", data: null, provenance: provenance(r.call, r.params), note: r.thinSignalNote ?? recipes.THIN_SIGNAL_NOTE };
      }
      const mapped = mapHarnessResult(r.envelope ? r.envelope(raw) : raw, r.call, r.params, r.pick);
      return r.emptyNote && mapped.status === "empty" ? { ...mapped, note: r.emptyNote } : mapped;
    } catch (err) {
      if (guarded && !recorded) recordOutcome(r.call, false); // the call itself threw (transport, rate limit)
      return failed(r.call, r.params, `Qloo call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function titleType(entityId: string): Promise<"movie" | "tv_show" | null> {
    const known = typeOf.get(entityId);
    if (known) return known;
    const d = recipes.describeType(entityId);
    const s = await section(d, { thinSignal: false });
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
      const provenanceOf = [...venues.provenance, ...tags.provenance];
      if (!tags.data) return { ...tags, provenance: provenanceOf };
      // Filtered here, at the mapping step, so what the evidence cache stores
      // is the food themes the page shows, not Qloo's raw tag dump (which is
      // mostly hobbies, keywords and other non-food families). Changing the
      // filter therefore takes effect as cached rows expire (3 days).
      const themes = recipes.foodThemes(tags.data);
      if (themes.length === 0) return { status: "empty", data: null, provenance: provenanceOf, note: NO_FOOD_THEMES_NOTE };
      return { ...tags, data: themes, provenance: provenanceOf };
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

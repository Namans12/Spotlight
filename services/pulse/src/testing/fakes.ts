// Test doubles shared by the brief, evidence and route tests: a fake of the
// postgres.js tagged-template client that understands the handful of
// statements Pulse issues, and a BriefDeps built on the synthetic Qloo
// fixtures. No test framework is imported so this file also type-checks under
// the service's own tsconfig.

import type { EvidenceSection } from "../../../../shared/types/pulse.js";
import { createFixtureClient } from "../qloo/fixtures.js";
import type { QlooClient } from "../qloo/client.js";
import type { BriefDeps } from "../brief.js";
import { createRateLimiter, type RateLimiter } from "../http/rateLimit.js";
import type { BriefRouteDeps } from "../routes/brief.js";

export type Row = Record<string, unknown>;
export interface Call { text: string; values: unknown[] }

export interface FakeDb {
  /** Rows of qloo_evidence, keyed "entity|city|kind", payload/params parsed as the driver would. */
  evidence: Map<string, Row>;
  locations: Row[];
  neighbourhoods: Row[];
  calls: Call[];
  /** Every INSERT INTO qloo_evidence, in order. */
  upserts: Row[];
  fail?: { evidenceRead?: boolean; neighbourhoods?: boolean };
}

export const EVIDENCE_INSERT_COLUMNS =
  "INSERT INTO qloo_evidence (entity_id, city_slug, kind, params, status, payload, fetched_at)";

export function newDb(init: Partial<Pick<FakeDb, "locations" | "neighbourhoods" | "fail">> = {}): FakeDb {
  return { evidence: new Map(), locations: [], neighbourhoods: [], calls: [], upserts: [], ...init };
}

export function fakeSql(db: FakeDb) {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    db.calls.push({ text, values });
    if (text.startsWith("INSERT INTO qloo_evidence")) {
      if (!text.includes(EVIDENCE_INSERT_COLUMNS)) throw new Error(`unexpected INSERT columns: ${text}`);
      if (!text.includes("ON CONFLICT (entity_id, city_slug, kind) DO UPDATE")) throw new Error("upsert lost its ON CONFLICT");
      const [entity_id, city_slug, kind, params, status, payload, fetched_at] = values;
      // params and payload travel as JSON text (cast to jsonb in SQL), as in production.
      const row = { entity_id, city_slug, kind, params: JSON.parse(params as string), status, payload: JSON.parse(payload as string), fetched_at };
      db.upserts.push(row);
      db.evidence.set(`${entity_id}|${city_slug}|${kind}`, row);
      return Promise.resolve([]);
    }
    if (text.includes("FROM qloo_evidence")) {
      if (db.fail?.evidenceRead) return Promise.reject(new Error("db read down"));
      const [entityId, citySlug, kind] = values;
      const r = db.evidence.get(`${entityId}|${citySlug}|${kind}`);
      return Promise.resolve(r ? [{ status: r.status, payload: r.payload, fetched_at: r.fetched_at }] : []);
    }
    if (text.includes("FROM title_locations")) return Promise.resolve(db.locations);
    if (text.includes("FROM neighbourhoods")) {
      if (db.fail?.neighbourhoods) return Promise.reject(new Error("db neighbourhoods down"));
      return Promise.resolve(db.neighbourhoods);
    }
    throw new Error(`unexpected statement: ${text}`);
  }) as unknown as BriefDeps["sql"];
}

export type QlooOverrides = Partial<Record<keyof QlooClient, unknown>>;

export interface FixtureOverrides extends QlooOverrides {
  resolve?: BriefDeps["resolve"];
  header?: BriefDeps["header"];
  draftCampaign?: BriefDeps["draftCampaign"];
  isKnown?: BriefRouteDeps["isKnown"];
  rateLimiter?: RateLimiter;
  db?: FakeDb;
  now?: () => Date;
}

export interface FixtureDeps extends BriefRouteDeps {
  db: FakeDb;
  /** How many times each QlooClient method was called. */
  qlooCalls: Record<string, number>;
  /** Errors reported through deps.onError. */
  errors: { context: string; err: unknown }[];
}

/** BriefDeps over the synthetic fixture client and an in-memory database. */
export function fixtureDeps(over: FixtureOverrides = {}): FixtureDeps {
  const { resolve, header, draftCampaign, isKnown, rateLimiter, db: givenDb, now, ...qlooOver } = over;
  const db = givenDb ?? newDb();
  const qlooCalls: Record<string, number> = {};
  const base = { ...createFixtureClient(), ...qlooOver } as unknown as Record<string, (...a: unknown[]) => unknown>;
  const qloo = Object.fromEntries(
    Object.entries(base).map(([name, fn]) => [name, (...args: unknown[]) => { qlooCalls[name] = (qlooCalls[name] ?? 0) + 1; return fn(...args); }]),
  ) as unknown as QlooClient;
  const errors: FixtureDeps["errors"] = [];
  return {
    sql: fakeSql(db),
    qloo,
    resolve: resolve ?? (async () => ({ entityId: "fx-entity-1", method: "imdb" as const })),
    header: header ?? (async () => ({ title: "Fixture Film", posterUrl: "https://img.example/p.jpg", releaseDate: "2026-11-01" })),
    draftCampaign: draftCampaign ?? (async () => ({ status: "empty", data: null, provenance: [], note: "stub" } as EvidenceSection<unknown>)),
    isKnown: isKnown ?? (async () => true),
    // Generous by default so only the tests about limiting ever meet it.
    rateLimiter: rateLimiter ?? createRateLimiter({ max: 100_000, windowMs: 60_000 }),
    ...(now ? { now } : {}),
    onError: (context, err) => { errors.push({ context, err }); },
    db,
    qlooCalls,
    errors,
  };
}

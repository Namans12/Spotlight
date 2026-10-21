// Data access for qloo_evidence (migrations/0016_release_pulse.sql). The
// payload and params go in as JSON text cast to jsonb: postgres.js would
// JSON-encode a JS string a second time for a jsonb parameter, storing a
// JSON string instead of an object.

export type EvidenceSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<Record<string, unknown>[]>;

export interface EvidenceRow {
  entityId: string;
  citySlug: string;
  kind: string;
  params: Record<string, string>;
  status: string;
  payload: unknown;
  fetchedAt: Date;
}

export interface StoredEvidence { status: string | null; payload: unknown; fetchedAt: Date }

export async function readEvidence(sql: EvidenceSql, entityId: string, citySlug: string, kind: string): Promise<StoredEvidence | null> {
  const rows = await sql`
    SELECT status, payload, fetched_at
    FROM qloo_evidence
    WHERE entity_id = ${entityId} AND city_slug = ${citySlug} AND kind = ${kind}`;
  const r = rows[0];
  if (!r) return null;
  return { status: (r.status as string | null) ?? null, payload: r.payload, fetchedAt: r.fetched_at as Date };
}

export async function upsertEvidence(sql: EvidenceSql, row: EvidenceRow): Promise<void> {
  await sql`
    INSERT INTO qloo_evidence (entity_id, city_slug, kind, params, status, payload, fetched_at)
    VALUES (${row.entityId}, ${row.citySlug}, ${row.kind}, ${JSON.stringify(row.params)}::text::jsonb, ${row.status}, ${JSON.stringify(row.payload)}::text::jsonb, ${row.fetchedAt})
    ON CONFLICT (entity_id, city_slug, kind) DO UPDATE SET
      params = EXCLUDED.params,
      status = EXCLUDED.status,
      payload = EXCLUDED.payload,
      fetched_at = EXCLUDED.fetched_at`;
}

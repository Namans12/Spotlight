/** Read-only calendar reconciliation queue. No network requests or writes. */
import postgres from 'postgres';
import { buildCalendarReviewQueue, type ReviewQueueRow } from '../lib/calendarReviewQueue.js';

function options(args: string[]) {
  let days = 90, limit = 2000, asOf: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--days', '--limit', '--as-of'].includes(key) || i + 1 >= args.length) throw new Error('Usage: npm run calendar:review-queue -- [--days 1-365] [--limit 1-5000] [--as-of YYYY-MM-DD]');
    const value = args[++i];
    if (key === '--days') days = Number(value);
    else if (key === '--limit') limit = Number(value);
    else asOf = value;
  }
  if (!Number.isInteger(days) || days < 1 || days > 365 || !Number.isInteger(limit) || limit < 1 || limit > 5000)
    throw new Error('days must be 1–365 and limit must be 1–5000');
  if (asOf && (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(`${asOf}T00:00:00Z`)) || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf))
    throw new Error('as-of must be a real date in YYYY-MM-DD format');
  const now = asOf ? new Date(`${asOf}T23:59:59.999Z`) : new Date();
  return { days, limit, now, start: now.toISOString().slice(0, 10) };
}

async function main() {
  const { days, limit, now, start } = options(process.argv.slice(2));
  const dsn = process.env.DATABASE_URL;
  if (!dsn) throw new Error('DATABASE_URL is required');
  const sql = postgres(dsn, { max: 1, connect_timeout: 10 });
  try {
    const result = await sql.begin('read only', async tx => tx`
      SELECT id, origin, tmdb_id, media_type, title, language, release_date::text AS release_date, source_url,
        entry_type, platform_or_distributor, evidence->>'region' AS event_region, evidence,
        (to_jsonb(calendar_entries) - 'id' - 'created_at' - 'source_key' - 'is_theatrical')::text AS observation_fingerprint
      FROM calendar_entries
      WHERE release_date >= ${start}::date AND release_date < ${start}::date + ${days}::int
      ORDER BY release_date, id LIMIT ${limit + 1}`);
    const truncated = result.length > limit;
    const rows: ReviewQueueRow[] = result.slice(0, limit).map(row => ({
      id: row.id, origin: row.origin, tmdb_id: row.tmdb_id, media_type: row.media_type, title: row.title, language: row.language,
      release_date: row.release_date, source_url: row.source_url, entry_type: row.entry_type,
      platform_or_distributor: row.platform_or_distributor, event_region: row.event_region, evidence: row.evidence,
      observation_fingerprint: row.observation_fingerprint,
    }));
    const items = buildCalendarReviewQueue(rows, now);
    const counts: Record<string, number> = {};
    for (const item of items) for (const reason of item.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
    console.log(JSON.stringify({ asOf: now.toISOString(), days, scanned: rows.length, truncated, counts, items }, null, 2));
  } finally { await sql.end(); }
}

main().catch(error => { console.error(error instanceof Error && /^(Usage:|days must|as-of must|DATABASE_URL is required)/.test(error.message) ? error.message : 'Calendar queue failed; check database connectivity and permissions.'); process.exitCode = 1; });

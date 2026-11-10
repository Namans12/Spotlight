import type postgres from "postgres";
import type { CalendarEntryDTO } from "../shared/types/calendar.js";
import { classifyPlatform, isKnownStreamer, mediaTypeFromEntryType, normalizePlatforms, splitPlatformField } from "../shared/platforms.js";
import { reviewedCalendarEntry } from "./calendarReconciliation.js";

/** Only merge observations when all event dimensions are known and agree.
 * An unknown season is not interchangeable with a known season. */
function eventKey(entry: CalendarEntryDTO): string | null {
  if (entry.kind === 'global_premiere' && entry.evidenceStatus === 'global' && entry.mediaType === 'tv' && entry.tmdbId)
    return JSON.stringify(['global_first_air', entry.mediaType, entry.tmdbId, entry.releaseDate]);
  if (!entry.region || !entry.mediaType || !entry.tmdbId) return null;
  const part = entry.title.match(/\b(?:season|series|s|part|chapter)\s*(\d+)\s*$/i);
  return JSON.stringify([entry.region, entry.mediaType, entry.tmdbId, entry.releaseDate, entry.kind,
    part ? `${part[0].replace(/\s+/g, " ").toLowerCase()}` : null]);
}

export async function getCalendarMonth(sql: postgres.Sql<any>, month: string, region = process.env.REGION ?? "IN"): Promise<CalendarEntryDTO[]> {
  const monthStart = `${month}-01`;
  const releaseRows = await sql`
    SELECT tmdb_id, media_type, title, language, release_date::text AS release_date, rating, poster_url, overview,
      CASE WHEN evidence->>'provider_source' = 'tmdb_regional_availability' THEN providers ELSE ARRAY[]::text[] END AS providers, evidence
    FROM release_items
    WHERE region = ${region} AND evidence->>'region' = region
      AND evidence->>'date_source' = 'tmdb_regional_digital'
      AND date_trunc('month', release_date::timestamp) = date_trunc('month', ${monthStart}::date)
    ORDER BY release_date, tmdb_id, media_type
  `;
  const calendarRows = await sql`
    SELECT id, origin, release_date::text AS release_date, title, language, entry_type, platform_or_distributor,
      tmdb_id, media_type, details, poster_url, origin_region, origin_release_date::text AS origin_release_date,
      evidence->>'region' AS event_region, evidence, source, source_url
    FROM calendar_entries
    WHERE date_trunc('month', release_date::timestamp) = date_trunc('month', ${monthStart}::date)
      AND (evidence->>'region' IS NULL OR evidence->>'region' = ${region})
      AND (origin <> 'tmdb_upcoming' OR
           (media_type = 'movie' AND tmdb_id IS NOT NULL AND evidence->>'source_url' = 'https://www.themoviedb.org/movie/' || tmdb_id::text
             AND evidence->>'region' = ${region} AND evidence->>'date_source' = 'tmdb_regional_theatrical') OR
           (media_type = 'tv' AND tmdb_id IS NOT NULL AND evidence->>'source_url' = 'https://www.themoviedb.org/tv/' || tmdb_id::text
             AND evidence->>'date_source' = 'tmdb_global_first_air' AND evidence->>'region' IS NULL))
    ORDER BY release_date, id
  `;

  const entries: CalendarEntryDTO[] = [];
  const byEvent = new Map<string, CalendarEntryDTO>();
  const add = (entry: CalendarEntryDTO) => {
    const key = eventKey(entry);
    const existing = key ? byEvent.get(key) : undefined;
    if (!existing) {
      entries.push(entry);
      if (key) byEvent.set(key, entry);
      return;
    }
    // The same event may occur in multiple digest sections. Preserve all
    // observed providers, while keeping each event and region distinct.
    existing.platforms = [...new Set([...existing.platforms, ...entry.platforms])];
    existing.platform = existing.platforms[0] ?? null;
    existing.posterUrl ??= entry.posterUrl;
    existing.overview ??= entry.overview;
    existing.rating ??= entry.rating;
    const times = [existing.observedAt, entry.observedAt].map(value => value ? Date.parse(value) : NaN);
    existing.observedAt = times.every(Number.isFinite) ? new Date(Math.min(...times)).toISOString() : null;
    const types = existing.availabilityTypes ?? {};
    for (const [name, values] of Object.entries(entry.availabilityTypes ?? {}))
      types[name] = [...new Set([...(types[name] ?? []), ...values])];
    existing.availabilityTypes = types;
  };

  for (const row of releaseRows) {
    const platforms = normalizePlatforms(row.providers);
    add({ releaseDate: String(row.release_date), title: row.title, language: row.language,
      mediaType: row.media_type, kind: "streaming", isTheatrical: false,
      platform: platforms[0] ?? null, platforms, region, tmdbId: Number(row.tmdb_id),
      posterUrl: row.poster_url, rating: row.rating !== null ? Number(row.rating) : null,
      overview: row.overview, origin: "tmdb", originRegion: null, originReleaseDate: null,
      source: platforms.length ? "TMDB / JustWatch" : "TMDB", sourceUrl: row.evidence?.source_url ?? null, observedAt: row.evidence?.observed_at ?? null,
      availabilityTypes: row.evidence?.provider_types ?? null, evidenceStatus: "regional" });
  }
  for (const row of calendarRows) {
    const review = reviewedCalendarEntry({ origin: row.origin, tmdb_id: row.tmdb_id, media_type: row.media_type,
      title: row.title, release_date: String(row.release_date), source_url: row.source_url,
      event_region: row.event_region, evidence: row.evidence, platform_or_distributor: row.platform_or_distributor, entry_type: row.entry_type });
    const matchingTmdbEvidence = row.tmdb_id != null && (row.media_type === 'movie' || row.media_type === 'tv') &&
      row.evidence?.source_url === `https://www.themoviedb.org/${row.media_type}/${row.tmdb_id}`;
    const globalPremiere = matchingTmdbEvidence && row.evidence?.date_source === 'tmdb_global_first_air' && !row.event_region && row.media_type === 'tv';
    const regionalEvidence = matchingTmdbEvidence && row.media_type === 'movie' && row.event_region &&
      row.evidence?.date_source === 'tmdb_regional_theatrical';
    const kind = globalPremiere || review?.type === 'season' ? 'global_premiere' : review?.type === 'event' ? review.kind : classifyPlatform(row.entry_type, row.platform_or_distributor);
    const parts = splitPlatformField(row.platform_or_distributor);
    const platforms = globalPremiere || review?.type === 'season' || review?.type === 'event' ? [] : kind === "streaming" ? normalizePlatforms(parts.filter(isKnownStreamer)) : parts;
    add({ releaseDate: String(row.release_date), title: row.title, language: row.language,
      mediaType: row.media_type ?? mediaTypeFromEntryType(row.entry_type), kind,
      isTheatrical: kind === "theatrical", platform: platforms[0] ?? null, platforms,
      region: regionalEvidence ? row.event_region : null, tmdbId: row.tmdb_id !== null ? Number(row.tmdb_id) : null,
      posterUrl: row.poster_url ?? null, rating: null, overview: row.details,
      origin: "csv_seed", originRegion: row.origin_region ?? null, originReleaseDate: row.origin_release_date ?? null,
      source: (regionalEvidence || globalPremiere) && row.source && row.source.toLowerCase() !== 'tmdb' ? `${row.source} / TMDB` : row.source ?? null, sourceUrl: row.source_url ?? null,
      observedAt: regionalEvidence || globalPremiere ? row.evidence?.observed_at ?? null : null, availabilityTypes: null,
      evidenceStatus: globalPremiere ? "global" : regionalEvidence ? "regional" : "unverified",
      seasonPremiere: review?.type === 'season' ? review : null,
      dateCorroboration: review?.type === 'corroboration' || review?.type === 'event' ? review : null,
      dateConflict: review?.type === 'conflict' ? review : null });
  }
  entries.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.title.localeCompare(b.title));
  return entries;
}

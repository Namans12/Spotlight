import type postgres from "postgres";
import type { CalendarEntryDTO } from "../shared/types/calendar.js";
import { classifyPlatform, isKnownStreamer, mediaTypeFromEntryType, normalizePlatforms, splitPlatformField } from "../shared/platforms.js";
import { reviewedCalendarEntry, reviewedTmdbConflictAfterEvidence } from "./calendarReconciliation.js";
import { reviewFreshness } from "../shared/calendarFreshness.js";
import { hasUnverifiedEditorialTmdbIdentity, reviewedEditorialDateConflict, reviewedEditorialTmdbIdentity } from "./calendarIdentity.js";

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

export async function getCalendarMonth(sql: postgres.Sql, month: string, region = process.env.REGION ?? "IN"): Promise<CalendarEntryDTO[]> {
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
      evidence->>'region' AS event_region, evidence, source, source_url,
      (to_jsonb(calendar_entries) - 'id' - 'created_at' - 'source_key' - 'is_theatrical')::text AS observation_fingerprint
    FROM calendar_entries
    WHERE date_trunc('month', release_date::timestamp) = date_trunc('month', ${monthStart}::date)
      AND (evidence->>'region' IS NULL OR evidence->>'region' = ${region} OR
           (origin IN ('wikipedia','csv_seed','district_in') AND evidence->>'date_source' IN ('tmdb_regional_theatrical','tmdb_global_first_air')))
      AND (origin <> 'tmdb_upcoming' OR
           (origin = 'tmdb_upcoming' AND evidence IS NULL) OR
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
    // Preserve distinct review annotations instead of silently dropping one.
    if ((existing.dateConflict && entry.dateConflict && JSON.stringify(existing.dateConflict) !== JSON.stringify(entry.dateConflict)) ||
        (existing.seasonPremiere && entry.seasonPremiere && JSON.stringify(existing.seasonPremiere) !== JSON.stringify(entry.seasonPremiere))) {
      entries.push(entry);
      return;
    }
    const extraSource = { source: entry.source ?? null, sourceUrl: entry.sourceUrl ?? null, observedAt: entry.observedAt ?? null };
    const prior = { source: existing.source ?? null, sourceUrl: existing.sourceUrl ?? null, observedAt: existing.observedAt ?? null };
    if ((extraSource.source || extraSource.sourceUrl) &&
        (extraSource.source !== prior.source || extraSource.sourceUrl !== prior.sourceUrl) &&
        !(existing.additionalSources ?? []).some(source => source.source === extraSource.source && source.sourceUrl === extraSource.sourceUrl)) {
      existing.additionalSources = [...(existing.additionalSources ?? []), extraSource];
    }
    for (const corroboration of [entry.dateCorroboration, ...(entry.additionalCorroborations ?? [])]) {
      if (!corroboration) continue;
      if (!existing.dateCorroboration) existing.dateCorroboration = corroboration;
      else if (JSON.stringify(existing.dateCorroboration) !== JSON.stringify(corroboration) &&
          !(existing.additionalCorroborations ?? []).some(item => JSON.stringify(item) === JSON.stringify(corroboration)))
        existing.additionalCorroborations = [...(existing.additionalCorroborations ?? []), corroboration];
    }
    existing.dateConflict ??= entry.dateConflict;
    existing.seasonPremiere ??= entry.seasonPremiere;
    if (entry.reviewFreshness === 'stale' || (entry.reviewFreshness === 'unknown' && existing.reviewFreshness !== 'stale') || !existing.reviewFreshness)
      existing.reviewFreshness = entry.reviewFreshness ?? existing.reviewFreshness;
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
  const seenEditorialObservations = new Set<string>();
  for (const row of calendarRows) {
    // Copies from the same Wikipedia observation are not separate releases.
    // Ignore only storage metadata and the unsupported legacy theatrical flag;
    // never merge based only on a title/date or unknown region.
    if (row.origin === 'wikipedia' && typeof row.observation_fingerprint === 'string') {
      if (seenEditorialObservations.has(row.observation_fingerprint)) continue;
      seenEditorialObservations.add(row.observation_fingerprint);
    }
    const reviewRow = { origin: row.origin, tmdb_id: row.tmdb_id, media_type: row.media_type,
      title: row.title, release_date: String(row.release_date), source_url: row.source_url,
      event_region: row.event_region, evidence: row.evidence, platform_or_distributor: row.platform_or_distributor, entry_type: row.entry_type, language: row.language };
    const review = reviewedCalendarEntry(reviewRow) ?? reviewedTmdbConflictAfterEvidence(reviewRow);
    if (review && 'suppressEvent' in review && review.suppressEvent) continue;
    // The SQL includes unverified TMDB candidates so exact manual reviews can
    // be applied. Never expose the rest merely because they were fetched.
    if (row.origin === 'tmdb_upcoming' && row.evidence == null && !review) continue;
    if (review?.type === 'regional' && review.region !== region) continue;
    const reviewInput = { origin: row.origin, tmdb_id: row.tmdb_id, media_type: row.media_type,
      title: row.title, language: row.language, release_date: String(row.release_date), source_url: row.source_url,
      entry_type: row.entry_type, evidence: row.evidence, platform_or_distributor: row.platform_or_distributor };
    const identityReview = reviewedEditorialTmdbIdentity(reviewInput);
    const identityDateConflict = reviewedEditorialDateConflict(reviewInput);
    const identityUnverified = hasUnverifiedEditorialTmdbIdentity(row.origin, row.evidence) && !identityReview;
    if (identityReview && !('identityOnly' in identityReview && identityReview.identityOnly) && row.event_region !== region) continue;
    const suppressTitleLink = identityUnverified || (review != null && 'suppressTitleLink' in review && review.suppressTitleLink);
    const matchingTmdbEvidence = !identityUnverified && !(identityReview && 'identityOnly' in identityReview && identityReview.identityOnly) && row.tmdb_id != null && (row.media_type === 'movie' || row.media_type === 'tv') &&
      row.evidence?.source_url === `https://www.themoviedb.org/${row.media_type}/${row.tmdb_id}`;
    const globalPremiere = matchingTmdbEvidence && row.evidence?.date_source === 'tmdb_global_first_air' && !row.event_region && row.media_type === 'tv';
    const regionalEvidence = matchingTmdbEvidence && row.media_type === 'movie' && row.event_region &&
      row.evidence?.date_source === 'tmdb_regional_theatrical';
    // Wikipedia's film lists mix cinema and streaming releases; a Movie label
    // alone does not establish the release type. A disputed date also cannot
    // inherit a type from an old distributor field unless independent evidence
    // identifies the event. Explicit global and regional evidence take priority.
    const kind = globalPremiere || review?.type === 'season' ? 'global_premiere' : review?.type === 'event' ? review.kind :
      !regionalEvidence && review?.type !== 'regional' &&
        (row.origin === 'wikipedia' || review?.type === 'conflict' || identityDateConflict) ? 'unknown' : classifyPlatform(row.entry_type, row.platform_or_distributor);
    const parts = splitPlatformField(row.platform_or_distributor);
    const platforms = globalPremiere || review?.type === 'season' || review?.type === 'event' ? [] : kind === "streaming" ? normalizePlatforms(parts.filter(isKnownStreamer)) : parts;
    add({ releaseDate: String(row.release_date), title: row.title, language: review && 'correctedLanguage' in review ? review.correctedLanguage : row.language,
      mediaType: row.media_type ?? mediaTypeFromEntryType(row.entry_type), kind,
      isTheatrical: kind === "theatrical", platform: platforms[0] ?? null, platforms,
      region: review?.type === 'regional' ? review.region : regionalEvidence ? row.event_region : null,
      tmdbId: !suppressTitleLink ? (review && 'reviewedTmdbId' in review && review.reviewedTmdbId != null ? review.reviewedTmdbId : row.tmdb_id !== null ? Number(row.tmdb_id) : null) : null,
      // A restored identity does not verify a poster left on the unlinked row.
      posterUrl: suppressTitleLink || (row.tmdb_id == null && review && 'reviewedTmdbId' in review) ? null : row.poster_url ?? null, rating: null, overview: row.details,
      origin: "csv_seed", originRegion: row.origin_region ?? null, originReleaseDate: row.origin_release_date ?? null,
      source: review?.type === 'regional' ? [row.source, review.source].filter(Boolean).join(' / ') : (regionalEvidence || globalPremiere) && row.source && row.source.toLowerCase() !== 'tmdb' ? `${row.source} / TMDB` : row.source ?? null, sourceUrl: row.source_url ?? null,
      observedAt: review?.type === 'regional' ? review.checkedAt : regionalEvidence || globalPremiere ? row.evidence?.observed_at ?? null : null, availabilityTypes: null,
      evidenceStatus: globalPremiere ? "global" : regionalEvidence || review?.type === 'regional' ? "regional" : "unverified",
      reviewFreshness: review ? reviewFreshness(review.checkedAt) : identityReview ? reviewFreshness(identityReview.checkedAt) : identityDateConflict ? reviewFreshness(identityDateConflict.checkedAt) : null,
      seasonPremiere: review?.type === 'season' ? review : null,
      dateCorroboration: review?.type === 'corroboration' || review?.type === 'event' || review?.type === 'regional' ? review : identityReview,
      dateConflict: review?.type === 'conflict' ? review : identityDateConflict });
  }
  entries.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.title.localeCompare(b.title));
  return entries;
}

import { reviewedCalendarEntry, reviewedTmdbReviewAfterEvidence } from './calendarReconciliation.js';
import { reviewFreshness } from '../shared/calendarFreshness.js';
import { hasUnverifiedEditorialTmdbIdentity, reviewedEditorialDateConflict, reviewedEditorialTmdbIdentity } from './calendarIdentity.js';

export interface ReviewQueueRow {
  id: string | number; origin: string; tmdb_id: number | null; media_type: string | null;
  title: string; release_date: string; source_url: string | null; entry_type: string | null;
  event_region: string | null; evidence: unknown; platform_or_distributor: string | null;
  language?: string | null;
  observation_fingerprint?: string | null;
}
export interface ReviewQueueItem {
  id: string; title: string; releaseDate: string; origin: string; region: string | null;
  tmdbId: number | null; reviewedTmdbId: number | null; sourceUrl: string | null; reviewSourceUrl: string | null;
  checkedAt: string | null; reasons: string[]; duplicateObservationIds: string[];
  matchingIdentityDateEvidenceIds: string[];
  evidenceObservedAt: string | null; reviewCheckedAt: string | null;
}

/** Read-only triage: a fresh observation does not verify identity or region. */
export function buildCalendarReviewQueue(rows: ReviewQueueRow[], now: Date): ReviewQueueItem[] {
  const queue: ReviewQueueItem[] = [];
  const observations = new Map<string, string[]>();
  const evidenceByIdentityDate = new Map<string, string[]>();
  const identityDateKey = (row: ReviewQueueRow): string | null => {
    if (row.origin !== 'tmdb_upcoming' || row.tmdb_id == null || (row.media_type !== 'movie' && row.media_type !== 'tv')) return null;
    return JSON.stringify([Number(row.tmdb_id), row.media_type, row.title, row.language ?? null, row.release_date,
      row.entry_type, row.platform_or_distributor, row.source_url]);
  };
  for (const row of rows) {
    const key = identityDateKey(row);
    const evidence = row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
      ? row.evidence as Record<string, unknown> : null;
    const matchesSource = row.tmdb_id != null && evidence?.source_url === `https://www.themoviedb.org/${row.media_type}/${row.tmdb_id}` &&
      row.source_url === evidence.source_url;
    const validEvent = (row.media_type === 'movie' && evidence?.date_source === 'tmdb_regional_theatrical' &&
      typeof evidence.region === 'string' && /^[A-Z]{2}$/.test(evidence.region) && row.event_region === evidence.region) ||
      (row.media_type === 'tv' && evidence?.date_source === 'tmdb_global_first_air' && evidence.region == null && row.event_region == null);
    if (key && matchesSource && validEvent) {
      const ids = evidenceByIdentityDate.get(key) ?? [];
      ids.push(String(row.id));
      evidenceByIdentityDate.set(key, ids);
    }
    if (row.origin !== 'wikipedia' || typeof row.observation_fingerprint !== 'string' || !row.observation_fingerprint) continue;
    const ids = observations.get(row.observation_fingerprint) ?? [];
    ids.push(String(row.id));
    observations.set(row.observation_fingerprint, ids);
  }
  for (const row of rows) {
    const review = reviewedCalendarEntry(row) ?? reviewedTmdbReviewAfterEvidence(row);
    const identityDateConflict = reviewedEditorialDateConflict(row);
    const evidence = row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
      ? row.evidence as Record<string, unknown> : null;
    const reasons: string[] = [];
    const duplicateObservationIds = row.origin === 'wikipedia' && row.observation_fingerprint
      ? (observations.get(row.observation_fingerprint) ?? []).filter(id => id !== String(row.id)) : [];
    const identityDate = identityDateKey(row);
    const matchingIdentityDateEvidenceIds = row.evidence == null && identityDate ? evidenceByIdentityDate.get(identityDate) ?? [] : [];
    if (duplicateObservationIds.length) reasons.push('duplicate_observation');
    if (review?.type === 'conflict' || identityDateConflict) reasons.push('date_conflict');
    if (!evidence && !review) reasons.push('unreviewed');
    if (row.evidence != null && !evidence) reasons.push('invalid_evidence');
    if (row.tmdb_id == null) reasons.push('identity_missing');
    const identityReview = reviewedEditorialTmdbIdentity(row);
    const identityUnverified = hasUnverifiedEditorialTmdbIdentity(row.origin, evidence) && !identityReview;
    const identityOnly = !!identityReview && 'identityOnly' in identityReview && identityReview.identityOnly;
    if (identityUnverified || (review && 'suppressTitleLink' in review && review.suppressTitleLink)) reasons.push('identity_unverified');
    const globalPremiere = !identityUnverified && !identityOnly && evidence?.date_source === 'tmdb_global_first_air' && row.media_type === 'tv' && row.tmdb_id != null &&
      evidence.source_url === `https://www.themoviedb.org/tv/${row.tmdb_id}`;
    const region = review?.type === 'regional' ? review.region : identityUnverified || identityOnly ? null : row.event_region;
    if (!region) reasons.push(globalPremiere ? 'global_premiere_local_unknown' : 'region_unknown');
    const tmdbClaim = typeof evidence?.date_source === 'string' && evidence.date_source.startsWith('tmdb_');
    if (evidence && (typeof evidence.date_source !== 'string' || !evidence.date_source ||
        typeof evidence.source_url !== 'string' || !evidence.source_url.startsWith('https://') ||
        (tmdbClaim && (row.tmdb_id == null || (row.media_type !== 'movie' && row.media_type !== 'tv') ||
          (typeof evidence.source_url === 'string' && !evidence.source_url.startsWith('https://www.themoviedb.org/')))))) reasons.push('evidence_incomplete');
    const tmdbSourceConflict = row.origin === 'tmdb_upcoming' && row.tmdb_id != null && (row.media_type === 'movie' || row.media_type === 'tv') &&
      typeof row.source_url === 'string' && /^https:\/\/www\.themoviedb\.org\/(?:movie|tv)\/\d+$/.test(row.source_url) &&
      row.source_url !== `https://www.themoviedb.org/${row.media_type}/${row.tmdb_id}`;
    if (tmdbSourceConflict || (review && 'identityMismatch' in review && review.identityMismatch) || (evidence && row.tmdb_id != null && (row.media_type === 'movie' || row.media_type === 'tv') &&
        typeof evidence.source_url === 'string' && evidence.source_url.startsWith('https://www.themoviedb.org/') &&
        evidence.source_url !== `https://www.themoviedb.org/${row.media_type}/${row.tmdb_id}`)) reasons.push('identity_conflict');
    const evidenceObservedAt = typeof evidence?.observed_at === 'string' ? evidence.observed_at : null;
    const checked = review?.checkedAt ?? evidenceObservedAt;
    if (evidence) {
      const freshness = reviewFreshness(evidenceObservedAt, now);
      if (freshness === 'unknown') reasons.push('freshness_unknown');
      else if (freshness === 'stale') reasons.push('evidence_stale');
    }
    if (review) {
      const freshness = reviewFreshness(review.checkedAt, now);
      if (freshness === 'unknown') reasons.push('review_freshness_unknown');
      else if (freshness === 'stale') reasons.push('review_stale');
    }
    if (identityReview && reviewFreshness(identityReview.checkedAt, now) !== 'fresh') reasons.push('identity_review_stale');
    if (identityDateConflict && reviewFreshness(identityDateConflict.checkedAt, now) !== 'fresh') reasons.push('date_review_stale');
    if (!reasons.length) continue;
    queue.push({ id: String(row.id), title: row.title, releaseDate: row.release_date, origin: row.origin,
      region, tmdbId: row.tmdb_id == null ? null : Number(row.tmdb_id),
      reviewedTmdbId: review && 'reviewedTmdbId' in review ? review.reviewedTmdbId ?? null : null, sourceUrl: row.source_url,
      reviewSourceUrl: review?.sourceUrl ?? identityDateConflict?.sourceUrl ?? identityReview?.sourceUrl ?? null, checkedAt: identityDateConflict?.checkedAt ?? checked,
      evidenceObservedAt, reviewCheckedAt: review?.checkedAt ?? identityDateConflict?.checkedAt ?? identityReview?.checkedAt ?? null, reasons, duplicateObservationIds, matchingIdentityDateEvidenceIds });
  }
  const rank = (x: ReviewQueueItem) => x.reasons.includes('date_conflict') || x.reasons.includes('identity_conflict') ? 0 : x.reasons.includes('unreviewed') ? 1 : 2;
  return queue.sort((a, b) => rank(a) - rank(b) || a.releaseDate.localeCompare(b.releaseDate) || a.id.localeCompare(b.id, 'en', { numeric: true }));
}

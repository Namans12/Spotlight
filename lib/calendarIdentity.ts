/** A TMDB observation proves a fact about that TMDB ID, not that a separately
 * sourced editorial record was matched to the correct title. Legacy rechecks
 * did not persist independent identity evidence for these sources. */
export function hasUnverifiedEditorialTmdbIdentity(origin: string, evidence: unknown): boolean {
  if (!['wikipedia', 'csv_seed', 'district_in'].includes(origin) || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  const source = (evidence as Record<string, unknown>).date_source;
  return source === 'tmdb_regional_theatrical' || source === 'tmdb_global_first_air';
}

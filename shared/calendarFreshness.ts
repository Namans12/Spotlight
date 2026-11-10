export const CALENDAR_REVIEW_MAX_AGE_DAYS = 30;
export type ReviewFreshness = 'fresh' | 'stale' | 'unknown';

/** A timestamp proves when evidence was observed, not whether it is still true. */
export function reviewFreshness(checkedAt: unknown, now = new Date(), maxAgeDays = CALENDAR_REVIEW_MAX_AGE_DAYS): ReviewFreshness {
  if (typeof checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(checkedAt)) return 'unknown';
  const datePart = checkedAt.slice(0, 10);
  const day = new Date(`${datePart}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== datePart) return 'unknown';
  const instant = Date.parse(checkedAt);
  if (!Number.isFinite(instant) || !Number.isFinite(now.getTime()) || instant > now.getTime()) return 'unknown';
  return now.getTime() - instant >= maxAgeDays * 86_400_000 ? 'stale' : 'fresh';
}

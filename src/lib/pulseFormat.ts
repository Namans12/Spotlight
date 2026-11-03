// Small pure formatters for the Pulse board.

/** "2026-08-21" -> "21 Aug". Read as UTC so the day never shifts with the
 *  viewer's timezone; the date is a calendar day, not an instant. */
export function formatReleaseDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * Splits the service's why-line ("#3 of 14 for Delhi audiences · strongest
 * around Hauz Khas · shot in Chandni Chowk") into its rank sentence and its
 * reasons. The reasons can be absent — when no claim cleared its floor the
 * line is just the rank — so nothing here may assume a separator exists.
 */
export function splitWhy(why: string): { rank: string; reasons: string[] } {
  const [rank = '', ...reasons] = why
    .split('·')
    .map((p) => p.trim())
    .filter(Boolean);
  return { rank, reasons };
}

/** "2026-10-24" -> "24 Oct 2026". Same UTC reading as formatReleaseDate; a
 *  value that is not a date comes back as it was. */
export function formatReleaseDateFull(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Human formatting for the numbers a title page shows.
 *
 * "93 min" is the number TMDB stores; "1 hr 33 min" is the number a person
 * thinks in. Nobody decides whether they have time for a film by dividing by
 * sixty. The conversion is trivial, which is exactly why it belongs in one
 * place — every surface that ever prints a runtime must print it the same way,
 * and a second copy is how "1 hr 33 min" and "93m" end up on the same screen.
 */

/**
 * Minutes -> "1 hr 33 min". Null for anything that isn't a real duration, so
 * callers render nothing rather than "0 min" or "NaN min" — TMDB leaves
 * `runtime` at 0 or null for plenty of titles, and an unknown runtime must
 * look unknown.
 *
 *   45  -> "45 min"      (under an hour: no "0 hr" prefix)
 *   120 -> "2 hr"        (exact hours: no trailing "0 min")
 *   93  -> "1 hr 33 min"
 */
export function formatRuntime(minutes: number | null | undefined): string | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
}

/** The same duration spelled out, for a screen reader or a tooltip. "hr" is
 *  read aloud as "hr" by some screen readers, which is why the visible short
 *  form isn't simply reused here. */
export function formatRuntimeLong(minutes: number | null | undefined): string | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (mins > 0) parts.push(`${mins} ${mins === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}

/**
 * "Start now, and you're done by 9:42 pm."
 *
 * The one piece of information a runtime is actually standing in for. It is
 * deliberately clock time rather than a countdown: "2 hr 46 min" makes you do
 * arithmetic against your own evening, and this does it for you.
 *
 * `now` is a parameter so this is testable and so a caller can pass a fixed
 * clock; it must not be called during prerender, where "now" is build time.
 */
export function finishTime(minutes: number | null | undefined, now: Date = new Date()): string | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  const end = new Date(now.getTime() + Math.round(minutes) * 60_000);
  try {
    return end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    // A runtime without Intl time formatting. The finish time is a garnish;
    // losing it must never cost the runtime itself.
    return null;
  }
}

/**
 * TMDB reports budget and revenue in whole US dollars, and reports 0 for "we
 * don't know" — which is indistinguishable from a genuine zero and is almost
 * never one. Treated as unknown, because "$0" printed next to a film that
 * plainly cost money reads as a bug.
 */
export function formatMoney(amount: number | null | undefined): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  try {
    const compact = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount);
    // Some ICU versions render a round number as "$80.0M" even with
    // maximumFractionDigits set, and `trailingZeroDisplay` is too new to rely
    // on. Strip the dead decimal rather than depend on the runtime's mood.
    return compact.replace(/\.0(?=\D*$)/, '');
  } catch {
    return `$${Math.round(amount).toLocaleString('en-US')}`;
  }
}

/** "2026-08-12" -> "12 Aug 2026". Day-first because the audience is Indian.
 *  Returns null for the empty strings TMDB uses for an undated title. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso || iso.length < 10) return null;
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return iso.slice(0, 10);
  }
}

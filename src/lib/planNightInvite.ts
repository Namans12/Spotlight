import type { Venue } from '../../shared/types/pulse';

/** Shareable draft containing only the title, selected city and public venue
 * names. Recommendations are attributed to Qloo without asserting where fans
 * live or what they personally like. This helper does not send the invite. */
export function inviteText(
  title: string | null | undefined,
  cityName: string,
  places: Venue[],
  mediaType: 'movie' | 'tv' = 'movie',
): string {
  const names = places.slice(0, 2).map((p) => p.name).filter((n) => n.trim() !== '');
  const name = title?.trim();
  if (name) {
    const spots = names.length > 0 ? ` — Qloo suggested ${names.join(' and ')} in ${cityName} for this title` : '';
    return `Movie night? ${name}${spots}. Want to go?`;
  }
  const what = mediaType === 'tv' ? 'this show' : 'this film';
  return names.length > 0
    ? `Movie night in ${cityName}? Qloo suggested ${names.join(' and ')} for ${what}. Want to go?`
    : `Movie night in ${cityName}? Want to go?`;
}

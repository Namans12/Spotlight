import type { Venue } from '../../shared/types/pulse';

/** The text a visitor can send to friends. Only the title, the city and
 *  public venue names go in: nothing about the visitor, and nothing is sent by
 *  this page, which only offers the text to the share sheet, WhatsApp or the
 *  clipboard.
 *
 *  With a title: "Movie night? <title> — fans of it in <City> love spots like
 *  <A> and <B>. Want to go?" With none (a blank or missing title), the title
 *  is left out rather than replaced by a placeholder that reads like a name:
 *  "Movie night in <City>? Fans of this film love spots like <A> and <B>. Want
 *  to go?" ("this show" for a series). The places part is dropped when there
 *  are no places. */
export function inviteText(
  title: string | null | undefined,
  cityName: string,
  places: Venue[],
  mediaType: 'movie' | 'tv' = 'movie',
): string {
  const names = places.slice(0, 2).map((p) => p.name).filter((n) => n.trim() !== '');
  const name = title?.trim();
  if (name) {
    const spots = names.length > 0 ? ` — fans of it in ${cityName} love spots like ${names.join(' and ')}` : '';
    return `Movie night? ${name}${spots}. Want to go?`;
  }
  const what = mediaType === 'tv' ? 'this show' : 'this film';
  return names.length > 0
    ? `Movie night in ${cityName}? Fans of ${what} love spots like ${names.join(' and ')}. Want to go?`
    : `Movie night in ${cityName}? Want to go?`;
}

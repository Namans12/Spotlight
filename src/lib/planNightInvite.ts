import type { Venue } from '../../shared/types/pulse';

/** The text a visitor can send to friends. Only the title, the city and
 *  public venue names go in: nothing about the visitor, and nothing is sent by
 *  this page, which only offers the text to the share sheet, WhatsApp or the
 *  clipboard. */
export function inviteText(title: string, cityName: string, places: Venue[]): string {
  const names = places.slice(0, 2).map((p) => p.name).filter((n) => n.trim() !== '');
  const spots = names.length > 0 ? ` — fans of it in ${cityName} love spots like ${names.join(' and ')}` : '';
  return `Movie night? ${title}${spots}. Want to go?`;
}

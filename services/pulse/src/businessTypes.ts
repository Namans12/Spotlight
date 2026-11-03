import type { BriefSectionKey, BusinessType, Venue } from "../../../shared/types/pulse.js";

export interface BusinessTypeSpec {
  label: string;
  /** In display order; "campaign" is always last because it is drafted from the others. */
  sections: BriefSectionKey[];
  /** Qloo place-tag searches whose results narrow the venue recommendation. */
  placeTagQueries: string[];
  /** Words that mark a venue as the wrong kind of business for this type. */
  venueBlocklist: string[];
}

// Qloo's place recommendations for a cafe query also return hotels and
// banquet halls (they serve coffee too), which are no use to a cafe owner
// looking for peers.
const LODGING = ["hotel", "banquet", "lodging", "resort", "motel"];

export const BUSINESS_TYPES: Record<BusinessType, BusinessTypeSpec> = {
  cafe: {
    label: "Café / restaurant",
    sections: ["who", "where", "venues", "themes", "artists", "hook", "trend", "campaign"],
    placeTagQueries: ["cafe", "coffee", "bakery", "dessert"],
    venueBlocklist: [...LODGING],
  },
  d2c_food: {
    label: "D2C food & beverage brand",
    sections: ["who", "where", "themes", "brands", "artists", "hook", "trend", "campaign"],
    placeTagQueries: ["snacks", "dessert", "beverage", "street food"],
    venueBlocklist: [...LODGING],
  },
};

export function isBusinessType(v: string): v is BusinessType {
  return Object.hasOwn(BUSINESS_TYPES, v);
}

/** Drops a venue when its name or any tag contains a blocklisted word, case
 *  insensitively. The name is checked as well as the tags because Qloo's
 *  place tags are often empty on the harness path, and then the name is all
 *  there is. Substring rather than whole-word, so "Resorts" and "Hotels"
 *  go too; no cafe is lost to this in practice. */
export function filterVenues(venues: Venue[], blocklist: string[]): Venue[] {
  const words = blocklist.map((w) => w.toLowerCase()).filter(Boolean);
  if (words.length === 0) return venues;
  return venues.filter((v) => {
    const haystack = [v.name, ...(v.tags ?? [])].map((s) => s.toLowerCase());
    return !words.some((w) => haystack.some((h) => h.includes(w)));
  });
}

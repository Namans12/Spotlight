import type { BusinessType } from '../../shared/types/pulse';
// The service's city list is the single source of truth; the SPA reads the
// same file rather than keeping a copy that could drift (a city the picker
// offers but the service rejects, or the reverse).
import rawCities from '../../data/pulse_cities.json';

export interface PulseCity {
  slug: string;
  name: string;
  /** ISO 3166-1 alpha-2. Drives the "release dates are for India" note. */
  country: string;
}

export const PULSE_CITIES: readonly PulseCity[] = rawCities.map(({ slug, name, country }) => ({ slug, name, country }));

const BY_SLUG = new Map(PULSE_CITIES.map((c) => [c.slug, c]));

export function getPulseCity(slug: string | null | undefined): PulseCity | null {
  return (slug != null && BY_SLUG.get(slug)) || null;
}

export function isPulseCitySlug(slug: unknown): slug is string {
  return typeof slug === 'string' && BY_SLUG.has(slug);
}

// Labels mirror BUSINESS_TYPES in services/pulse/src/businessTypes.ts. They
// are repeated rather than imported because that module pulls in the service's
// server-only code; the ids are what must match, and the type system enforces
// those through BusinessType.
export const BUSINESS_TYPE_OPTIONS: readonly { id: BusinessType; label: string }[] = [
  { id: 'cafe', label: 'Café / restaurant' },
  { id: 'd2c_food', label: 'D2C food & beverage brand' },
];

export function isBusinessType(v: unknown): v is BusinessType {
  return typeof v === 'string' && BUSINESS_TYPE_OPTIONS.some((o) => o.id === v);
}

export function businessTypeLabel(type: BusinessType): string {
  return BUSINESS_TYPE_OPTIONS.find((o) => o.id === type)?.label ?? type;
}

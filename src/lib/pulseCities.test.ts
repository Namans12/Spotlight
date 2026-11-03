import { describe, expect, it } from 'vitest';
import raw from '../../data/pulse_cities.json';
import { BUSINESS_TYPE_OPTIONS, PULSE_CITIES, getPulseCity, isBusinessType, isPulseCitySlug } from './pulseCities';

describe('pulseCities', () => {
  it('mirrors every city in data/pulse_cities.json, in order, with only slug, name and country', () => {
    expect(PULSE_CITIES.map((c) => c.slug)).toEqual(raw.map((c) => c.slug));
    expect(Object.keys(PULSE_CITIES[0]).sort()).toEqual(['country', 'name', 'slug']);
  });

  it('looks a city up by slug and rejects anything else', () => {
    expect(getPulseCity('new-york')).toEqual({ slug: 'new-york', name: 'New York City', country: 'US' });
    expect(getPulseCity('atlantis')).toBeNull();
    expect(getPulseCity(null)).toBeNull();
    expect(isPulseCitySlug('delhi')).toBe(true);
    expect(isPulseCitySlug('constructor')).toBe(false);
  });

  it('knows the two business types, labelled for the picker', () => {
    expect(BUSINESS_TYPE_OPTIONS.map((o) => o.id)).toEqual(['cafe', 'd2c_food']);
    expect(isBusinessType('cafe')).toBe(true);
    expect(isBusinessType('d2c_food')).toBe(true);
    expect(isBusinessType('creator')).toBe(false);
    expect(isBusinessType('toString')).toBe(false);
    expect(isBusinessType(null)).toBe(false);
  });
});

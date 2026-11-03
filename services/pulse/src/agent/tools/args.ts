import type { BusinessType } from "../../../../../shared/types/pulse.js";
import { BUSINESS_TYPES, isBusinessType } from "../../businessTypes.js";
import { allCities, getCity, type City } from "../../cities.js";

export const citySlugs = (): string[] => allCities().map((c) => c.slug);
export const businessTypeSlugs = (): string[] => Object.keys(BUSINESS_TYPES);

export type CityArg = { ok: true; city: City } | { ok: false; error: { error: "unknown_city"; valid: string[] } };
export type BusinessTypeArg = { ok: true; businessType: BusinessType } | { ok: false; error: { error: "unknown_business_type"; valid: string[] } };

/** A bad city or business type comes back as DATA with the valid choices, so
 *  the model can correct itself instead of the call failing. Case and stray
 *  spaces are forgiven; nothing else is. */
export function cityArg(v: unknown): CityArg {
  const city = typeof v === "string" ? getCity(v.trim().toLowerCase()) : null;
  return city ? { ok: true, city } : { ok: false, error: { error: "unknown_city", valid: citySlugs() } };
}

export function businessTypeArg(v: unknown): BusinessTypeArg {
  const slug = typeof v === "string" ? v.trim().toLowerCase() : "";
  return isBusinessType(slug) ? { ok: true, businessType: slug } : { ok: false, error: { error: "unknown_business_type", valid: businessTypeSlugs() } };
}

export const citySchema = () => ({ type: "string", enum: citySlugs(), description: "Launch city slug." });
export const businessTypeSchema = () => ({ type: "string", enum: businessTypeSlugs(), description: "cafe = café / restaurant; d2c_food = D2C food & beverage brand." });

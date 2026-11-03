export interface LatLon { lat: number; lon: number }

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Names a heatmap cell after the nearest neighbourhood centroid within
 *  `maxKm`, or null when none is that close: a cell on the edge of the city
 *  is better unlabelled than wrongly labelled. Equal distances go to the
 *  alphabetically first name so the label never depends on table order. */
export function labelCell(cell: LatLon, hoods: (LatLon & { name: string })[], maxKm = 3): string | null {
  let best: { name: string; km: number } | null = null;
  for (const h of hoods) {
    const km = haversineKm(cell, h);
    if (km > maxKm) continue;
    if (!best || km < best.km || (km === best.km && h.name < best.name)) best = { name: h.name, km };
  }
  return best?.name ?? null;
}

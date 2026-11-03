// A QlooClient that answers from invented data, so the whole service can be
// built, demoed and tested with no Qloo key. Everything here is obviously
// synthetic ("Fixture Café 1", ids starting fx-) and sections say so in
// `note` and in the provenance call name, so none of it can be mistaken for
// Qloo evidence. Never paste a real Qloo response into this file.

import type {
  DemographicsData, EvidenceSection, HeatCell, NamedEntity, Provenance, TagAffinity, Venue,
} from "../../../../shared/types/pulse.js";
import type { City } from "../cities.js";
import type { QlooClient, QlooEntityRef } from "./client.js";
import { limitsFor } from "./recipes.js";

const NOTE = "Synthetic fixture data, not from Qloo.";

function fixtureSection<T>(call: string, params: Record<string, string>, data: T): EvidenceSection<T> {
  const provenance: Provenance = {
    source: "qloo",
    call: `fixture:${call}`,
    params,
    limits: `Synthetic fixture data. ${limitsFor(call)}`,
  };
  return { status: "ok", data, provenance: [provenance], note: NOTE };
}

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Standard geohash, so a later map or neighbourhood step that decodes the
 *  string gets a valid one. */
function geohash(lat: number, lon: number, length = 6): string {
  let latR: [number, number] = [-90, 90];
  let lonR: [number, number] = [-180, 180];
  let out = "";
  let bits = 0;
  let ch = 0;
  let evenBit = true;
  while (out.length < length) {
    const range = evenBit ? lonR : latR;
    const value = evenBit ? lon : lat;
    const mid = (range[0] + range[1]) / 2;
    if (value >= mid) { ch = (ch << 1) | 1; range[0] = mid; } else { ch <<= 1; range[1] = mid; }
    evenBit = !evenBit;
    if (++bits === 5) { out += BASE32[ch]; bits = 0; ch = 0; }
  }
  return out;
}

/** Offsets that fan out from the city centre in a spiral, up to about 5 km,
 *  so a map of the fixture looks like a spread of neighbourhoods. */
function nearCity(city: City, i: number): { lat: number; lon: number } {
  const radius = 0.012 + 0.0035 * i; // degrees of latitude
  const angle = i * 2.399963; // golden angle: no two points line up
  return {
    lat: Number((city.lat + radius * Math.sin(angle)).toFixed(5)),
    lon: Number((city.lon + (radius * Math.cos(angle)) / Math.cos((city.lat * Math.PI) / 180)).toFixed(5)),
  };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

const DEMOGRAPHICS: DemographicsData = {
  age: { "24_and_younger": 0.21, "25_to_29": 0.34, "30_to_34": 0.18, "35_to_44": -0.05, "45_to_54": -0.22, "55_and_older": -0.4 },
  gender: { male: -0.08, female: 0.08 },
};

export function createFixtureClient(): QlooClient {
  const ref = (n: number, type: QlooEntityRef["type"], label: string): QlooEntityRef =>
    ({ entityId: `fx-${type}-${n}`, name: `Fixture ${label} ${n}`, type, year: 2024 });

  return {
    async entityByImdb(imdbId) {
      return { entityId: `fx-${imdbId}`, name: `Fixture Title ${imdbId}`, type: "movie", year: 2024 };
    },
    async searchTitles(title, type) {
      return [1, 2].map((n) => ref(n, type, type === "movie" ? "Film" : "Show"));
    },
    async demographics(entityId) {
      return fixtureSection("audience_demographics", { entity_id: entityId }, DEMOGRAPHICS);
    },
    async heatmap(entityId, city) {
      const cells: Omit<HeatCell, "neighbourhood">[] = range(12).map((i) => {
        const { lat, lon } = nearCity(city, i);
        return { lat, lon, geohash: geohash(lat, lon), affinity: Number((0.95 - 0.05 * i).toFixed(2)), popularity: Number((0.5 - 0.03 * i).toFixed(2)) };
      });
      return fixtureSection("where_popular", { entity_id: entityId, within: city.qlooLocationQuery }, cells);
    },
    async places(entityId, city, includeTagIds) {
      const venues: Venue[] = range(6).map((i) => ({
        entityId: `fx-venue-${i + 1}`,
        name: `Fixture Café ${i + 1}`,
        address: `${i + 1} Fixture Lane, ${city.name}`,
        ...nearCity(city, i),
        priceLevel: (i % 3) + 1,
        tags: includeTagIds.length > 0 ? [...includeTagIds] : ["fx-tag-1"],
        affinity: Number((0.9 - 0.08 * i).toFixed(2)),
      }));
      return fixtureSection("recommend_places", { entity_id: entityId, filter_location: city.qlooLocationQuery }, venues);
    },
    async placeTags(entityId, city) {
      const tags: TagAffinity[] = range(4).map((i) => ({ tagId: `urn:tag:genre:place:restaurant:fx-tag-${i + 1}`, name: `Fixture Tag ${i + 1}`, affinity: Number((0.8 - 0.15 * i).toFixed(2)) }));
      return fixtureSection("entity_tags", { entity_id: entityId, within: city.qlooLocationQuery }, tags);
    },
    async artists(entityId) {
      const rows: NamedEntity[] = range(5).map((i) => ({ entityId: `fx-artist-${i + 1}`, name: `Fixture Artist ${i + 1}`, affinity: Number((0.85 - 0.1 * i).toFixed(2)) }));
      return fixtureSection("recommend_artists", { entity_id: entityId }, rows);
    },
    async brands(entityId) {
      const rows: NamedEntity[] = range(5).map((i) => ({ entityId: `fx-brand-${i + 1}`, name: `Fixture Brand ${i + 1}`, affinity: Number((0.8 - 0.1 * i).toFixed(2)) }));
      return fixtureSection("recommend_brands", { entity_id: entityId }, rows);
    },
    async trends(entityId) {
      // Fixed dates, not "last N days", so a fixture run is reproducible.
      const points = range(12).map((i) => ({
        date: new Date(Date.UTC(2026, 0, 5 + 7 * i)).toISOString().slice(0, 10),
        percentile: Number((0.4 + 0.04 * i).toFixed(2)),
      }));
      return fixtureSection("trends", { entity_id: entityId }, points);
    },
    async findTags(query, parentType) {
      return [1, 2].map((n) => ({ tagId: `fx-tag-${parentType}-${n}`, name: `Fixture ${query} ${n}` }));
    },
    async listTools() {
      return [{
        name: "qloo_fixture_echo",
        description: "Synthetic stand-in for the Qloo harness tools; echoes its arguments.",
        inputSchema: { type: "object", additionalProperties: true },
      }];
    },
    async callTool(name, args) {
      if (name === "qloo_rank") return { status: "ok", summary: NOTE, results: (args.options as string[]).map(entity_id => ({ entity_id })) };
      return { status: "ok", summary: "Synthetic fixture echo, not from Qloo.", results: [{ tool: name, args }], result_count: 1 };
    },
  };
}

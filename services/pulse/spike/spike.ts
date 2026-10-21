// Live Qloo diagnostic (the Task 1 spike). Drives the service's own Qloo client
// against the real hackathon host and prints SUMMARIES, so you can see what the
// service will actually get: entity resolution for the most popular current
// releases, then for 3 titles x Delhi/Mumbai/New York the heatmap, venues
// (with and without tag filters), place themes and, for Delhi, demographics,
// artists, brands and trends.
//
// Usage (needs services/pulse/.env with DATABASE_URL, QLOO_API_KEY, TMDB_API_KEY;
// QLOO_FIXTURES must not be set):
//
//   cd services/pulse && npx tsx --env-file=.env spike/spike.ts
//
// It makes about 70 live Qloo calls, so run it deliberately, not in a loop.
// stdout is summaries only: statuses, counts, booleans and tag-id families, with
// no Qloo-returned entity, venue, artist, brand or theme names. Set
// SPIKE_SHOW_NAMES=1 to print names and heatmap cells too (for your eyes only:
// Qloo's terms forbid publishing its data). Raw responses go to spike/out/
// (gitignored) either way. It never prints any key.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCity } from "../src/cities.js";
import { loadConfig } from "../src/config.js";
import { createQlooClient, type QlooEntityRef } from "../src/qloo/client.js";
import { lookupTmdbTitle, type TmdbTitle } from "../src/tmdbLookup.js";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(out, { recursive: true });

const cfg = loadConfig(process.env);
if (cfg.qlooFixtures) throw new Error("QLOO_FIXTURES is set: the spike must hit real Qloo");
const qloo = createQlooClient(cfg);
const sql = postgres(cfg.databaseUrl, { max: 1 });

const raw: Record<string, unknown> = {};
const summary = (label: string, s: { status: string; data: unknown; note?: string }) => {
  const d = s.data;
  const n = Array.isArray(d) ? d.length : d && typeof d === "object" ? Object.keys(d).length : 0;
  console.log(`  ${label.padEnd(22)} ${s.status.padEnd(11)} items=${String(n).padEnd(3)} ${s.note ? "note: " + s.note.slice(0, 110) : ""}`);
};
type Row = Record<string, unknown>;
const rows_ = (xs: unknown): Row[] => (Array.isArray(xs) ? (xs as Row[]) : []);
const SHOW_NAMES = process.env.SPIKE_SHOW_NAMES === "1";
/** Names only when asked for; otherwise an empty string, so lines carry counts alone. */
const names = (xs: unknown, key = "name", k = 4) => (SHOW_NAMES ? rows_(xs).slice(0, k).map((x) => String(x?.[key])).join(" | ") : "");
/** The family of a tag id ("urn:tag:genre:place"), without the specific tag. */
const families = (ids: string[]) => [...new Set(ids.map((id) => id.split(":").slice(0, 4).join(":")))].join(", ") || "(none)";

async function main() {
  console.log("== tools/list");
  const tools = await qloo.listTools();
  raw.tools = tools;
  console.log("  harness tools:", tools.map((t) => t.name).join(", "));

  console.log("\n== 1. entity resolution (TMDB → IMDb → Qloo) for the 12 most popular current releases");
  const rows = await sql`SELECT DISTINCT ON (tmdb_id, media_type) tmdb_id, media_type, title, popularity FROM release_items ORDER BY tmdb_id, media_type, popularity DESC`;
  rows.sort((a, b) => Number(b.popularity) - Number(a.popularity));
  const resolved: { title: string; ref: QlooEntityRef; how: string }[] = [];
  let tried = 0;
  for (const r of rows.slice(0, 12)) {
    tried++;
    const mt = r.media_type as "movie" | "tv";
    // null is a TMDB 404; an outage (after the lookup's own retries) is reported, not hidden.
    let lk: TmdbTitle | null = null;
    let how = "";
    try { lk = await lookupTmdbTitle(mt, Number(r.tmdb_id)); } catch (e) { how = "tmdb-error:" + String((e as Error).message).slice(0, 60); }
    let ref: QlooEntityRef | null = null;
    if (lk?.imdbId) {
      try { ref = await qloo.entityByImdb(lk.imdbId); how = ref ? "imdb" : ""; } catch (e) { how = "imdb-error:" + String((e as Error).message).slice(0, 60); }
    }
    if (!ref && lk?.title) {
      try {
        const cands = await qloo.searchTitles(lk.title, mt === "movie" ? "movie" : "tv_show");
        const year = lk.year;
        ref = cands.find((c) => year && c.year && Math.abs(c.year - Number(year)) <= 1) ?? null;
        how = ref ? "search(year-matched)" : `search-miss(cands=${cands.length})`;
      } catch (e) { how = "search-error:" + String((e as Error).message).slice(0, 60); }
    }
    console.log(`  ${String(r.title).slice(0, 38).padEnd(38)} imdb=${lk?.imdbId ?? "-"}`.padEnd(62) + ` → ${ref ? `${SHOW_NAMES ? `${ref.name} ` : "resolved "}(${ref.year ?? "?"}) [${how}]` : how || "no IMDb id on TMDB yet"}`);
    if (ref) resolved.push({ title: String(r.title), ref, how });
  }
  console.log(`  RESOLVED ${resolved.length}/${tried}   (go/no-go bar: ≥ 7/10)`);
  raw.resolved = resolved;
  if (resolved.length === 0) { console.log("No titles resolved — cannot continue."); return; }

  const probes = resolved.slice(0, 3);
  for (const cityId of ["delhi", "mumbai", "new-york"]) {
    const city = getCity(cityId)!;
    for (const p of probes) {
      console.log(`\n== 2. ${p.title} × ${city.name}`);
      const id = p.ref.entityId;
      const rec: Record<string, unknown> = {};
      const heat = await qloo.heatmap(id, city); rec.heatmap = heat; summary("heatmap", heat);
      if (SHOW_NAMES && Array.isArray(heat.data) && heat.data.length) console.log("    cells:", rows_(heat.data).slice(0, 3).map((c) => `${String(c.geohash)}@${Number(c.affinity).toFixed(2)}`).join(" "));
      const tagQs = ["cafe", "coffee", "bakery", "dessert"];
      const tagIds: string[] = [];
      for (const q of tagQs) { try { const t = await qloo.findTags(q, "place"); rec["tags_" + q] = t; tagIds.push(...t.slice(0, 2).map((x) => x.tagId)); } catch (e) { rec["tags_" + q] = String(e); } }
      console.log("    place-tag ids found:", new Set(tagIds).size, "| families:", families(tagIds));
      const places = await qloo.places(id, city, [...new Set(tagIds)].slice(0, 6)); rec.places = places; summary("places (cafe tags)", places);
      if (Array.isArray(places.data)) {
        const vs = rows_(places.data);
        console.log("    venues:", vs.length, names(places.data), "| with address:", vs.filter((v) => v.address).length, "| with lat/lon:", vs.filter((v) => v.lat != null).length, "| with tags:", vs.filter((v) => Array.isArray(v.tags) && v.tags.length).length);
      }
      const open = await qloo.places(id, city, []); rec.places_open = open; summary("places (no tag filter)", open);
      if (Array.isArray(open.data)) console.log("    venues (no filter):", open.data.length, names(open.data));
      const pt = await qloo.placeTags(id, city); rec.place_tags = pt; summary("place_tags (themes)", pt);
      if (Array.isArray(pt.data)) console.log("    themes:", pt.data.length, "| tag-id families:", families(rows_(pt.data).map((x) => String(x.tagId))), names(pt.data, "name", 6));
      if (cityId === "delhi") {
        const demo = await qloo.demographics(id); rec.demographics = demo; summary("demographics", demo);
        const art = await qloo.artists(id); rec.artists = art; summary("artists", art); if (SHOW_NAMES && Array.isArray(art.data)) console.log("    artists:", names(art.data));
        const br = await qloo.brands(id); rec.brands = br; summary("brands", br); if (SHOW_NAMES && Array.isArray(br.data)) console.log("    brands:", names(br.data));
        const tr = await qloo.trends(id); rec.trends = tr; summary("trends", tr);
      }
      raw[`${cityId}:${p.title}`] = rec;
    }
  }
  writeFileSync(join(out, "spike-raw.json"), JSON.stringify(raw, null, 2));
  console.log("\nRaw responses written to services/pulse/spike/out/spike-raw.json (gitignored).");
}

main()
  .catch((e) => { console.error("SPIKE FAILED:", (e as Error).message); process.exitCode = 1; })
  .finally(async () => { await sql.end({ timeout: 2 }); await qloo.close?.(); });

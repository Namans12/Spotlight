// release_brief: the brief pipeline, collected into a compact summary the model
// can reason over. The campaign drafter is a no-op on purpose: the agent writes
// its own recommendation from this evidence, and an LLM call inside a tool call
// would spend the model budget twice for one question.

import type { BriefSectionKey, EvidenceSection, HeatCell, LocalHook, NamedEntity, TagAffinity, Venue } from "../../../../../shared/types/pulse.js";
import { BUSINESS_TYPES } from "../../businessTypes.js";
import { streamBrief, type BriefDeps, type DraftCampaign } from "../../brief.js";
import { cleanText } from "../../campaign.js";
import type { TitleKey } from "../../resolve.js";
import { businessTypeArg, businessTypeSchema, cityArg, citySchema } from "./args.js";
import { queryArg, searchReleases } from "./searchReleases.js";
import type { AgentTool, AgentToolDeps } from "./types.js";

/** Returns an empty section without a model call; see the file header. */
export const noopDrafter: DraftCampaign = async () => ({ status: "empty", data: null, provenance: [], note: "The agent writes its own advice." });

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round2 = (n: number) => Math.round(n * 100) / 100;
const arrayOf = <T>(s: EvidenceSection<unknown>): T[] => (Array.isArray(s.data) ? (s.data.filter((x) => x && typeof x === "object") as T[]) : []);
const names = (rows: { name?: unknown }[], n: number) => rows.map((r) => cleanText(r.name, 60)).filter(Boolean).slice(0, n);

/** One section as a few bounded facts: its status and note, the Qloo calls
 *  behind it (so the model can name them), and a short rendering of the data
 *  (never the cells or payload themselves). Third-party text is cleaned. */
function summariseSection(key: BriefSectionKey, section: EvidenceSection<unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    status: section.status,
    ...(section.note ? { note: cleanText(section.note, 200) } : {}),
    calls: [...new Set(section.provenance.map((p) => cleanText(p.call, 60)))].slice(0, 4),
  };
  if (section.data === null || section.data === undefined) return base;

  switch (key) {
    case "who": {
      const d = section.data as { age?: Record<string, number>; gender?: { male?: number; female?: number } };
      const topAge = Object.entries(d.age ?? {}).filter(([, v]) => isNum(v)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([bucket, affinity]) => ({ bucket, affinity: round2(affinity) }));
      const g = d.gender;
      return { ...base, topAge, ...(g && isNum(g.male) && isNum(g.female) ? { gender: { male: round2(g.male), female: round2(g.female) } } : {}) };
    }
    case "where": {
      const cells = arrayOf<HeatCell>(section);
      const best = new Map<string, number>();
      let unlabelled = 0;
      for (const c of cells) {
        if (!c.neighbourhood) { unlabelled++; continue; }
        const name = cleanText(c.neighbourhood, 60);
        if (isNum(c.affinity) && c.affinity > (best.get(name) ?? -Infinity)) best.set(name, c.affinity);
      }
      const top = [...best].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, affinity]) => ({ name, affinity: round2(affinity) }));
      return { ...base, cells: cells.length, top, unlabelledCells: unlabelled };
    }
    case "venues": return { ...base, names: names(arrayOf<Venue>(section), 5) };
    case "themes": return { ...base, names: names(arrayOf<TagAffinity>(section), 6) };
    case "artists":
    case "brands": return { ...base, names: names(arrayOf<NamedEntity>(section), 5) };
    case "hook": return { ...base, rows: arrayOf<LocalHook>(section).slice(0, 5).map((h) => ({ kind: h.kind, landmark: h.landmark ? cleanText(h.landmark, 60) : null })) };
    case "trend": { const n = arrayOf<unknown>(section).length; return { ...base, present: n > 0, points: n }; }
    default: return base;
  }
}

const NOTE = "Numbers are Qloo's relative affinity scores, not percentages of people. 'calls' names the Qloo call behind each section; name it when you cite a number.";

type KeyResult = { ok: true; key: TitleKey } | { ok: false; error: Record<string, unknown> };

/** A number or numeric string is a TMDB id; anything else is a title, resolved
 *  with the same search as search_releases (first match). Only titles Spotlight
 *  already knows get a brief: a made-up id must not cost Qloo calls. */
async function resolveKey(deps: AgentToolDeps, raw: unknown, mediaArg: unknown): Promise<KeyResult> {
  const media = mediaArg === undefined || mediaArg === null || mediaArg === "" ? null : mediaArg;
  if (media !== null && media !== "movie" && media !== "tv") return { ok: false, error: { error: "unknown_media_type", valid: ["movie", "tv"] } };

  const asId = typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : typeof raw === "string" && /^\d{1,15}$/.test(raw.trim()) ? Number(raw.trim()) : null;
  if (asId !== null && asId > 0) {
    if (media) return (await deps.isKnown({ tmdbId: asId, mediaType: media })) ? { ok: true, key: { tmdbId: asId, mediaType: media } } : { ok: false, error: { error: "unknown_title" } };
    const [asMovie, asTv] = [await deps.isKnown({ tmdbId: asId, mediaType: "movie" }), await deps.isKnown({ tmdbId: asId, mediaType: "tv" })];
    if (asMovie && asTv) return { ok: false, error: { error: "ambiguous_media_type", hint: "That id is known as both a movie and a show; pass media_type." } };
    if (!asMovie && !asTv) return { ok: false, error: { error: "unknown_title" } };
    return { ok: true, key: { tmdbId: asId, mediaType: asMovie ? "movie" : "tv" } };
  }

  const query = queryArg(raw);
  if (query === null) return { ok: false, error: { error: "missing_title", hint: "Pass a release title or a tmdbId." } };
  const hits = await searchReleases(deps.sql, query);
  const hit = media ? hits.find((h) => h.mediaType === media) : hits[0];
  // Search only reads titles Spotlight's own tables hold, so a hit is already known.
  return hit ? { ok: true, key: { tmdbId: hit.tmdbId, mediaType: hit.mediaType } } : { ok: false, error: { error: "unknown_title" } };
}

export function releaseBriefTool(deps: AgentToolDeps): AgentTool {
  return {
    spec: {
      type: "function",
      function: {
        name: "release_brief",
        description: "The audience evidence for one release in one city for one business type: who the fans are (age), where they are in the city, venues, themes, artists or brands, any local filming hook, and trend, each with the Qloo calls behind it. It does not write advice; you write the recommendation from it. Pass a tmdbId (digits only, from pulse_board or search_releases) or a title.",
        parameters: {
          type: "object",
          properties: {
            title_or_tmdb_id: { type: "string", description: "A release title, or a TMDB id as digits (a title that is only digits: use search_releases first)." },
            media_type: { type: "string", enum: ["movie", "tv"], description: "Optional; taken from the match when omitted." },
            city: citySchema(),
            business_type: businessTypeSchema(),
          },
          required: ["title_or_tmdb_id", "city", "business_type"],
          additionalProperties: false,
        },
      },
    },
    async run(args, ctx) {
      const city = cityArg(args.city);
      if (!city.ok) return city.error;
      const type = businessTypeArg(args.business_type);
      if (!type.ok) return type.error;
      const key = await resolveKey(deps, args.title_or_tmdb_id, args.media_type);
      if (!key.ok) return key.error;

      const briefDeps: BriefDeps = {
        sql: deps.sql,
        qloo: deps.qloo,
        resolve: deps.resolve,
        header: deps.header,
        draftCampaign: noopDrafter,
        ...(deps.now ? { now: deps.now } : {}),
        onError: deps.onError,
      };
      let title = "Untitled";
      let releaseDate: string | null = null;
      let hasEntity = false;
      let done = false;
      const sections: Partial<Record<BriefSectionKey, EvidenceSection<unknown>>> = {};
      for await (const ev of streamBrief(briefDeps, { city: city.city, businessType: type.businessType, key: key.key, signal: ctx?.signal })) {
        if (ev.type === "header") { title = cleanText(ev.header.title, 100); releaseDate = ev.header.releaseDate; hasEntity = ev.header.qlooEntityId !== null; }
        else if (ev.type === "section") sections[ev.key] = ev.section;
        else done = true;
      }

      // In the business type's own order, and never the (no-op) campaign.
      const ordered: Record<string, unknown> = {};
      for (const k of BUSINESS_TYPES[type.businessType].sections) {
        const s = sections[k];
        if (k !== "campaign" && s) ordered[k] = summariseSection(k, s);
      }
      const counts = new Map<string, number>();
      for (const v of Object.values(ordered)) counts.set((v as { status: string }).status, (counts.get((v as { status: string }).status) ?? 0) + 1);
      return {
        summary: `Brief for "${title}" in ${city.city.name}: ${Object.keys(ordered).length} sections (${[...counts].map(([k, n]) => `${n} ${k}`).join(", ")}).`,
        title,
        releaseDate,
        tmdbId: key.key.tmdbId,
        mediaType: key.key.mediaType,
        city: city.city.slug,
        cityName: city.city.name,
        businessType: type.businessType,
        hasQlooEntity: hasEntity,
        ...(done ? {} : { incomplete: true }),
        note: NOTE,
        sections: ordered,
      };
    },
  };
}

// The board: this week's releases ranked by how well their audience lines up
// with a city. A poll must answer from what is already cached, so nothing here
// can reach Qloo (the deps carry no client); titles that still need a look are
// handed to `enqueueWarm` and show up as "pending" until the cache fills.

import type postgres from "postgres";
import type { BoardCard, BoardResponse, BusinessType, HeatCell, LocalHook, TagAffinity } from "../../../shared/types/pulse.js";
import { getCalendarMonth } from "../../../lib/calendarDb.js";
import type { City } from "./cities.js";
import { getCachedEntities, type CachedEntity } from "./db/entities.js";
import type { EvidenceSql } from "./db/evidence.js";
import { getNeighbourhoods, getTitleLocationsBatch, type TitleLocation } from "./db/locations.js";
import { getPopularity } from "./db/titles.js";
import { peekEvidence } from "./evidence.js";
import { labelCell } from "./geo.js";
import { notFoundIsStale, type TitleKey } from "./resolve.js";
import type { Candidate } from "./score.js";
import { MAX_RANK_OPTIONS, readBoardRank } from "./boardRank.js";

/** One statement type serves every read the board makes. */
export type BoardSql = EvidenceSql;

export interface BoardDeps {
  sql: BoardSql;
  /** Asks for a title's resolution and evidence to be fetched in the background. */
  enqueueWarm: (city: City, type: BusinessType, key: TitleKey) => void;
  enqueueRank?: (city: City) => void;
  onError?: (context: string, err: unknown) => void;
}

const DAYS_BACK = 3;
const DAYS_AHEAD = 14;
const THEATRICAL_SLOTS = 6;
const TOP_TAG_NAMES = 10;
const DAY_MS = 86_400_000;

// Release dates are Indian dates, so "today" is the calendar day in India.
// Comparing date strings, not instants, keeps a release at 00:30 IST (19:00
// UTC the day before) from being a day off.
const indiaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const dayNumber = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };
const dayString = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

const keyOf = (mediaType: string, tmdbId: number) => `${mediaType}:${tmdbId}`;

/** filmed beats set, and a record that names a landmark beats one that does not. */
function bestHook(rows: TitleLocation[] | undefined, city: City): LocalHook | null {
  if (!rows || rows.length === 0) return null;
  const rank = (r: TitleLocation) => (r.kind === "filmed" ? 0 : 2) + (r.landmark ? 0 : 1);
  const best = [...rows].sort((a, b) => rank(a) - rank(b))[0];
  return { kind: best.kind, placeName: city.name, landmark: best.landmark, source: best.source };
}

/** Releases from three days ago to two weeks ahead, deduped, at most ten
 *  per media type with reserved theatrical slots. The calendar read is the one the Calendar page uses, so `kind`
 *  and `mediaType` are derived the same way (never from the stored
 *  is_theatrical). Rows with no TMDB id cannot be resolved to a Qloo entity
 *  and are dropped. */
export async function listCandidates(sql: BoardSql, city: City, today: Date): Promise<Candidate[]> {
  const todayStr = indiaDay.format(today);
  const todayN = dayNumber(todayStr);
  const first = dayString(todayN - DAYS_BACK);
  const last = dayString(todayN + DAYS_AHEAD);
  const months = [...new Set([first.slice(0, 7), last.slice(0, 7)])];

  const monthRows = await Promise.all(months.map((m) => getCalendarMonth(sql as unknown as postgres.Sql, m)));

  // Streaming (release_items-derived) rows win over a theatrical or network
  // row for the same title; otherwise the earliest date stands.
  const best = new Map<string, (typeof monthRows)[number][number]>();
  for (const row of monthRows.flat()) {
    if (row.tmdbId === null || row.mediaType === null) continue;
    if (row.releaseDate < first || row.releaseDate > last) continue;
    const k = keyOf(row.mediaType, row.tmdbId);
    const held = best.get(k);
    const better = !held
      || (row.kind === "streaming" && held.kind !== "streaming")
      || (row.kind === held.kind && row.releaseDate < held.releaseDate);
    if (better) best.set(k, row);
  }
  if (best.size === 0) return [];

  const keys: TitleKey[] = [...best.values()].map((r) => ({ tmdbId: r.tmdbId!, mediaType: r.mediaType! }));
  const popularity = await getPopularity(sql, keys);
  const ordered = [...best.values()]
    .map((row) => ({ row, popularity: popularity.get(keyOf(row.mediaType!, row.tmdbId!)) ?? 0 }))
    .sort((a, b) => b.popularity - a.popularity || a.row.releaseDate.localeCompare(b.row.releaseDate) || a.row.tmdbId! - b.row.tmdbId!);
  // Qloo's public rank tool accepts at most ten options of a single type.
  // Reserve up to six film slots for theatrical releases, then fill the
  // remainder by popularity. Never split a type across incomparable queries.
  const films = ordered.filter(x => x.row.mediaType === "movie");
  const theatre = films.filter(x => x.row.kind === "theatrical")
    .sort((a, b) => a.row.releaseDate.localeCompare(b.row.releaseDate) || a.row.tmdbId! - b.row.tmdbId!).slice(0, THEATRICAL_SLOTS);
  const chosen = new Set(theatre.map(x => x.row.tmdbId));
  const top = [...films.filter(x => !chosen.has(x.row.tmdbId)).slice(0, MAX_RANK_OPTIONS - theatre.length), ...theatre,
    ...ordered.filter(x => x.row.mediaType === "tv").slice(0, MAX_RANK_OPTIONS)];

  const hooks = await getTitleLocationsBatch(sql, top.map((t) => ({ tmdbId: t.row.tmdbId!, mediaType: t.row.mediaType! })), city.slug);
  return top.map(({ row, popularity: pop }): Candidate => ({
    card: {
      tmdbId: row.tmdbId!,
      mediaType: row.mediaType!,
      title: row.title,
      posterUrl: row.posterUrl,
      releaseDate: row.releaseDate,
      platform: row.platform,
      kind: row.kind,
    },
    popularity: pop,
    entityId: null,
    heat: null,
    placeTagNames: null,
    hook: bestHook(hooks.get(keyOf(row.mediaType!, row.tmdbId!)), city),
    daysAhead: dayNumber(row.releaseDate) - todayN,
  }));
}

type RawCell = Omit<HeatCell, "neighbourhood">;

/** Ranks what the cache can answer, lists what it cannot as pending (and
 *  asks for it to be warmed), and sets aside titles Qloo definitely does not
 *  know. Never awaits a Qloo call: warming runs behind `enqueueWarm`. */
export async function buildBoard(deps: BoardDeps, city: City, type: BusinessType, today: Date = new Date()): Promise<BoardResponse> {
  const { sql } = deps;
  const report = (context: string, err: unknown) => {
    try { deps.onError?.(context, err); } catch { /* a broken logger must not break the board */ }
  };
  const candidates = await listCandidates(sql, city, today);
  const entities = await getCachedEntities(sql, candidates.map((c) => ({ tmdbId: c.card.tmdbId, mediaType: c.card.mediaType })));

  const pending: BoardCard[] = [];
  const unresolved: BoardCard[] = [];
  const toScore: Candidate[] = [];
  const cellsOf = new Map<Candidate, RawCell[]>();
  const wanted: TitleKey[] = [];

  const unscored = (c: Candidate): BoardCard => ({ ...c.card, score: null, why: null });

  await Promise.all(candidates.map(async (c) => {
    const key = { tmdbId: c.card.tmdbId, mediaType: c.card.mediaType };
    const entity: CachedEntity | undefined = entities.get(keyOf(key.mediaType, key.tmdbId));
    if (entity?.notFound && !notFoundIsStale(entity.resolvedAt, today)) { unresolved.push(unscored(c)); return; }
    if (!entity || entity.notFound || !entity.entityId) { pending.push(unscored(c)); wanted.push(key); return; }

    const [heatmap, tags] = await Promise.all([
      peekEvidence<RawCell[]>(sql, "heatmap", entity.entityId, city, today),
      peekEvidence<TagAffinity[]>(sql, "place_tags", entity.entityId, city, today),
    ]);
    if (!heatmap || !tags) wanted.push(key); // optional brief evidence must not block a valid local rank

    const cells = (heatmap?.data ?? []).filter((x) => Number.isFinite(x.affinity));
    const scored: Candidate = {
      ...c,
      entityId: entity.entityId,
      heat: cells.map((x) => x.affinity),
      placeTagNames: tags ? (tags.data ?? []).slice(0, TOP_TAG_NAMES).map((t) => t.name) : null,
    };
    cellsOf.set(scored, cells);
    toScore.push(scored);
  }));

  // Promise.all settles in whatever order the reads finish; the lists must
  // follow the popularity order listCandidates chose.
  const order = new Map(candidates.map((c, i) => [c.card.tmdbId + c.card.mediaType, i]));
  const byOrder = (a: BoardCard, b: BoardCard) => order.get(a.tmdbId + a.mediaType)! - order.get(b.tmdbId + b.mediaType)!;
  pending.sort(byOrder);
  unresolved.sort(byOrder);
  wanted.sort((a, b) => order.get(a.tmdbId + a.mediaType)! - order.get(b.tmdbId + b.mediaType)!);

  // Read once per board, and only when there is a card to label.
  let hoods: Awaited<ReturnType<typeof getNeighbourhoods>> = [];
  if (toScore.length > 0) {
    try { hoods = await getNeighbourhoods(sql, city.slug); } catch (err) { report("neighbourhoods", err); }
  }

  const ranked: BoardCard[] = [];
  const noSignal: BoardCard[] = [];
  let needsRank = false;
  for (const mediaType of ["movie", "tv"] as const) {
    const group = candidates.filter(c => c.card.mediaType === mediaType && entities.get(keyOf(c.card.mediaType, c.card.tmdbId))?.entityId);
    const ids = group.map(c => entities.get(keyOf(c.card.mediaType, c.card.tmdbId))!.entityId!);
    if (ids.length === 0) continue;
    const ranking = await readBoardRank(sql, city, mediaType, ids, today);
    if (!ranking) needsRank = true;
    const positions = new Map((ranking?.data ?? []).map((id, i) => [id.toLowerCase(), i + 1]));
    const ready = toScore.filter(c => c.card.mediaType === mediaType);
    const ordered = ready.sort((a, b) => (positions.get(a.entityId!.toLowerCase()) ?? Infinity) - (positions.get(b.entityId!.toLowerCase()) ?? Infinity));
    for (const c of ordered) {
      const localRank = positions.get(c.entityId!.toLowerCase());
      const cells = cellsOf.get(c) ?? [];
      const strongest = cells.reduce<RawCell | null>((m, x) => (m === null || x.affinity > m.affinity ? x : m), null);
      const hood = strongest ? labelCell(strongest, hoods) : null;
      if (localRank !== undefined) {
        const noun = mediaType === "movie" ? "films" : "TV shows";
        const why = [`#${localRank} of ${positions.size} ${noun} in Qloo’s ${city.name} shortlist`,
          ...(hood ? [`heatmap signal near ${hood}`] : []),
          ...(c.hook ? [`${c.hook.kind === "filmed" ? "shot" : "set"} in ${city.name}`] : [])].slice(0, 3).join(" · ");
        ranked.push({ ...c.card, score: null, why, localRank, rankTotal: positions.size });
      } else {
        noSignal.push({ ...c.card, score: null, why: ranking ? "No comparable local ranking for this title" : "Local ranking unavailable; release order only" });
      }
    }
  }
  // A failure or sparse response must not leave an empty page or counterfeit
  // a demand score. Keep the calendar usable with an explicit fallback.
  const rankingBasis = ranked.length ? "qloo_shortlist" as const : "release_order" as const;
  if (!ranked.length) {
    ranked.push(...noSignal.splice(0).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.tmdbId - b.tmdbId)
      .map(c => ({ ...c, why: "Release order · no comparable local ranking" })));
  }
  if (needsRank) { try { deps.enqueueRank?.(city); } catch (err) { report("enqueueRank", err); } }

  noSignal.sort(byOrder);
  for (const key of wanted) {
    try { deps.enqueueWarm(city, type, key); } catch (err) { report("enqueueWarm", err); }
  }

  return { city: city.slug, cityName: city.name, businessType: type, ranked, pending, unresolved, noSignal, rankingBasis, rankingPending: needsRank };
}

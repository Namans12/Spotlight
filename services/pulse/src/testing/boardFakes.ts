// A fake of the postgres.js client for the board: the statements listCandidates
// and buildBoard issue (release and calendar rows, popularity, cached
// entities, hooks), layered over the evidence and neighbourhood fake in
// fakes.ts. No test framework is imported, as with fakes.ts.

import type { EvidenceSection } from "../../../../shared/types/pulse.js";
import type { BoardDeps } from "../board.js";
import { fakeSql, newDb, type FakeDb, type Row } from "./fakes.js";

export interface BoardDb extends FakeDb {
  /** release_items rows (streaming), release_date as YYYY-MM-DD. */
  releases: { tmdb_id: number; media_type: "movie" | "tv"; title: string; release_date: string; popularity?: number; poster_url?: string | null; providers?: string[] }[];
  /** calendar_entries rows. */
  calendar: { tmdb_id: number | null; media_type: "movie" | "tv" | null; title: string; release_date: string; entry_type: string; platform_or_distributor?: string | null }[];
  /** qloo_entities rows. */
  entities: Row[];
  /** title_locations rows for any city. */
  titleLocations: { tmdb_id: number; media_type: string; city_slug: string; kind: "filmed" | "set"; source: string | null; landmark_label: string | null }[];
}

export function newBoardDb(init: Partial<BoardDb> = {}): BoardDb {
  return { ...newDb(), releases: [], calendar: [], entities: [], titleLocations: [], ...init };
}

const inMonth = (date: string, month: string) => date.startsWith(month);

export function boardSql(db: BoardDb) {
  const base = fakeSql(db) as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<Row[]>;
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    if (text.includes("FROM release_items") && text.includes("DISTINCT ON")) {
      db.calls.push({ text, values });
      const month = String(values[0]).slice(0, 7);
      return Promise.resolve(db.releases.filter((r) => inMonth(r.release_date, month)).map((r) => ({
        tmdb_id: String(r.tmdb_id), media_type: r.media_type, title: r.title, language: "en", release_date: r.release_date,
        rating: null, poster_url: r.poster_url ?? null, overview: "", providers: r.providers ?? ["Netflix"],
      })));
    }
    if (text.includes("FROM calendar_entries")) {
      db.calls.push({ text, values });
      const month = String(values[0]).slice(0, 7);
      return Promise.resolve(db.calendar.filter((r) => inMonth(r.release_date, month)).map((r) => ({
        release_date: r.release_date, title: r.title, language: "en", entry_type: r.entry_type, is_theatrical: true,
        platform_or_distributor: r.platform_or_distributor ?? null, tmdb_id: r.tmdb_id === null ? null : String(r.tmdb_id),
        media_type: r.media_type, details: null, poster_url: null, origin_region: null, origin_release_date: null,
      })));
    }
    if (text.includes("MAX(popularity)") && text.includes("FROM release_items")) {
      db.calls.push({ text, values });
      const ids = new Set((values[0] as number[]).map(Number));
      return Promise.resolve(db.releases.filter((r) => ids.has(r.tmdb_id)).map((r) => ({ tmdb_id: String(r.tmdb_id), media_type: r.media_type, popularity: String(r.popularity ?? 0) })));
    }
    if (text.includes("FROM qloo_entities")) {
      db.calls.push({ text, values });
      const ids = new Set((values[0] as number[]).map(Number));
      return Promise.resolve(db.entities.filter((e) => ids.has(Number(e.tmdb_id))).map((e) => ({ ...e, tmdb_id: String(e.tmdb_id) })));
    }
    if (text.includes("FROM title_locations")) {
      db.calls.push({ text, values });
      const [slug, ids] = values as [string, number[]];
      const want = new Set(ids.map(Number));
      return Promise.resolve(db.titleLocations.filter((l) => l.city_slug === slug && want.has(l.tmdb_id)).map((l) => ({ ...l, tmdb_id: String(l.tmdb_id) })));
    }
    return base(strings, ...values);
  }) as unknown as BoardDeps["sql"];
}

/** Puts a fresh, usable section in the evidence cache. */
export function seedEvidence(db: BoardDb, entityId: string, citySlug: string, kind: string, section: EvidenceSection<unknown>, fetchedAt: Date): void {
  db.evidence.set(`${entityId}|${citySlug}|${kind}`, { status: section.status, payload: section, fetched_at: fetchedAt });
}

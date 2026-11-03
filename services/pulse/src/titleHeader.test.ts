import { describe, expect, it, vi } from "vitest";
import { createTitleLookup, type TitleSql } from "./titleHeader.js";

function fakeSql(tables: { release_items?: Record<string, unknown>[]; calendar_entries?: Record<string, unknown>[]; fail?: boolean }) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((s: TemplateStringsArray, ...values: unknown[]) => {
    const text = s.join("?").replace(/\s+/g, " ").trim();
    calls.push({ text, values });
    if (tables.fail) return Promise.reject(new Error("db down"));
    if (text.includes("FROM release_items")) return Promise.resolve(tables.release_items ?? []);
    if (text.includes("FROM calendar_entries")) return Promise.resolve(tables.calendar_entries ?? []);
    throw new Error(`unexpected: ${text}`);
  }) as unknown as TitleSql;
  return { sql, calls };
}
const key = { tmdbId: 7, mediaType: "movie" as const };
const detail = { title: "From TMDB", posterUrl: "https://img/p.jpg", releaseDate: "2026-12-01" };

describe("createTitleLookup", () => {
  it("prefers release_items and does not call TMDB", async () => {
    const { sql, calls } = fakeSql({ release_items: [{ title: "Local", poster_url: "https://img/l.jpg", release_date: "2026-11-05" }] });
    const tmdb = vi.fn(async () => detail);
    expect(await createTitleLookup(sql, tmdb)(key)).toEqual({ title: "Local", posterUrl: "https://img/l.jpg", releaseDate: "2026-11-05" });
    expect(tmdb).not.toHaveBeenCalled();
    expect(calls[0].text).toContain("SELECT title, poster_url, release_date::text AS release_date FROM release_items");
    expect(calls[0].values).toEqual([7, "movie"]);
  });

  it("falls back to calendar_entries, then to TMDB only when neither table has the title", async () => {
    const tmdb = vi.fn(async () => detail);
    const cal = fakeSql({ calendar_entries: [{ title: "Cal", poster_url: null, release_date: "2026-11-06" }] });
    expect(await createTitleLookup(cal.sql, tmdb)(key)).toEqual({ title: "Cal", posterUrl: null, releaseDate: "2026-11-06" });
    expect(tmdb).not.toHaveBeenCalled();
    expect(cal.calls[1].text).toContain("FROM calendar_entries");

    expect(await createTitleLookup(fakeSql({}).sql, tmdb)(key)).toEqual(detail);
    expect(tmdb).toHaveBeenCalledWith("movie", 7);
  });

  it("maps an empty TMDB date to null and a TMDB failure to null", async () => {
    const empty = vi.fn(async () => ({ ...detail, releaseDate: "" }));
    expect((await createTitleLookup(fakeSql({}).sql, empty)(key))?.releaseDate).toBeNull();
    const boom = vi.fn(async () => { throw new Error("TMDB_API_KEY is not set"); });
    expect(await createTitleLookup(fakeSql({}).sql, boom)(key)).toBeNull();
  });

  it("lets a database failure propagate so the caller can report it", async () => {
    await expect(createTitleLookup(fakeSql({ fail: true }).sql, vi.fn())(key)).rejects.toThrow("db down");
  });
});

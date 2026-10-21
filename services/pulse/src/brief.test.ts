import { describe, expect, it, vi } from "vitest";
import type { BriefEvent, BriefHeader, BriefSectionKey, EvidenceSection, Venue } from "../../../shared/types/pulse.js";
import { streamBrief } from "./brief.js";
import { BUSINESS_TYPES, filterVenues } from "./businessTypes.js";
import { getCity } from "./cities.js";
import { RateLimitedError } from "./qloo/limiter.js";
import { fixtureDeps, newDb } from "./testing/fakes.js";

const delhi = getCity("delhi")!;
const key = (tmdbId: number) => ({ tmdbId, mediaType: "movie" as const });

async function collect(gen: AsyncGenerator<BriefEvent>): Promise<BriefEvent[]> {
  const out: BriefEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
const names = (events: BriefEvent[]) => events.map((e) => (e.type === "section" ? e.key : e.type));
function sectionOf(events: BriefEvent[], k: BriefSectionKey): EvidenceSection<any> {
  const e = events.find((x) => x.type === "section" && x.key === k);
  if (!e || e.type !== "section") throw new Error(`no section ${k}`);
  return e.section;
}
const headerOf = (events: BriefEvent[]): BriefHeader => {
  const e = events[0];
  if (e.type !== "header") throw new Error("first event is not a header");
  return e.header;
};
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

const CAFE_KEYS = ["who", "where", "venues", "themes", "artists", "hook", "trend", "campaign"];

describe("streamBrief", () => {
  it("streams header first and done last, with every cafe section in between", async () => {
    const keys = names(await collect(streamBrief(fixtureDeps(), { city: delhi, businessType: "cafe", key: key(1) })));
    expect(keys[0]).toBe("header");
    expect(keys.at(-1)).toBe("done");
    expect(new Set(keys)).toEqual(new Set(["header", ...CAFE_KEYS, "done"]));
    expect(keys).toHaveLength(CAFE_KEYS.length + 2);
    expect(keys.at(-2)).toBe("campaign");
  });

  it("gives a d2c_food brief brands and no venues", async () => {
    const keys = names(await collect(streamBrief(fixtureDeps(), { city: delhi, businessType: "d2c_food", key: key(1) })));
    expect(new Set(keys)).toEqual(new Set(["header", "who", "where", "themes", "brands", "artists", "hook", "trend", "campaign", "done"]));
    expect(keys).not.toContain("venues");
  });

  it("fills the header from the lookup and the resolved entity", async () => {
    const h = headerOf(await collect(streamBrief(fixtureDeps(), { city: delhi, businessType: "cafe", key: key(5) })));
    expect(h).toEqual({
      tmdbId: 5, mediaType: "movie", title: "Fixture Film", posterUrl: "https://img.example/p.jpg", releaseDate: "2026-11-01",
      city: "delhi", cityName: "Delhi", businessType: "cafe", qlooEntityId: "fx-entity-1",
    });
  });

  it("still streams when the title lookup finds nothing or throws", async () => {
    for (const header of [async () => null, async () => { throw new Error("tmdb down"); }]) {
      const deps = fixtureDeps({ header });
      const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(5) }));
      expect(headerOf(events)).toMatchObject({ title: "Untitled", posterUrl: null, releaseDate: null });
      expect(sectionOf(events, "who").status).toBe("ok");
    }
  });

  it("a failing section does not stop the others (Review Focus 2)", async () => {
    const deps = fixtureDeps({ heatmap: () => Promise.reject(new RateLimitedError("429")) });
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
    expect(sectionOf(events, "where").status).toBe("error");
    expect(sectionOf(events, "who").status).toBe("ok");
    expect(names(events).at(-1)).toBe("done");
  });

  it("turns a thrown error into a short error section that leaks nothing and is not cached", async () => {
    const deps = fixtureDeps({ artists: async () => { throw new Error("connect failed postgres://u:hunter2@db token=abc\n    at stack"); } });
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
    const s = sectionOf(events, "artists");
    expect(s).toMatchObject({ status: "error", data: null, provenance: [] });
    expect(s.note).toEqual(expect.any(String));
    expect(JSON.stringify(events)).not.toMatch(/hunter2|token=abc|stack/);
    expect(deps.db.upserts.map((u) => u.kind)).not.toContain("artists");
    expect(deps.errors.some((e) => e.context.includes("artists"))).toBe(true);
    expect(sectionOf(events, "who").status).toBe("ok");
  });

  it("replaces the note of an error section returned by the Qloo client, and reports the original", async () => {
    const leaky = (note: string): EvidenceSection<any> => ({ status: "error", data: null, provenance: [{ source: "qloo", call: "artists", params: { entity_id: "e" }, limits: "l" }], note });
    const deps = fixtureDeps({ artists: async () => leaky("Qloo call failed: secret-ish upstream text"), brands: async () => leaky("x"), heatmap: async () => leaky("Qloo call failed: Rate limit exceeded (429)") });
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
    const a = sectionOf(events, "artists");
    expect(a.status).toBe("error");
    expect(a.note).not.toContain("secret-ish");
    expect(a.provenance).toHaveLength(1);
    expect(sectionOf(events, "where").note).toMatch(/rate|busy/i);
    expect(JSON.stringify(events)).not.toContain("secret-ish");
    expect(deps.errors.some((e) => String(e.err).includes("secret-ish upstream text"))).toBe(true);
  });

  it("keeps its own explanatory notes on error sections it creates itself", async () => {
    const deps = fixtureDeps({ resolve: async () => { throw new Error("boom"); } });
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
    expect(sectionOf(events, "who").note).toContain("could not be reached");
  });

  it("explains a rate limit in the note", async () => {
    const deps = fixtureDeps({ heatmap: () => Promise.reject(new RateLimitedError("429")) });
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
    expect(sectionOf(events, "where").note).toMatch(/rate|busy|moment/i);
  });

  it("an unresolved title streams honest empty sections, never throws (Review Focus 1)", async () => {
    const deps = fixtureDeps({ resolve: async () => ({ entityId: null, reason: "not_in_qloo" }) });
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(2) }));
    expect(sectionOf(events, "who")).toMatchObject({ status: "empty", data: null, provenance: [], note: expect.stringContaining("Qloo") });
    for (const k of ["who", "where", "venues", "themes", "artists", "trend"] as const) {
      expect(sectionOf(events, k).status).toBe("empty");
    }
    expect(sectionOf(events, "hook").status).not.toBe("error"); // hook needs no Qloo
    expect(headerOf(events).qlooEntityId).toBeNull();
    expect(Object.keys(deps.qlooCalls)).toEqual([]);
  });

  it("when resolveTitle throws, every Qloo section is an error section and hook still works", async () => {
    const deps = fixtureDeps({
      resolve: async () => { throw new Error("connect ECONNREFUSED postgres://u:hunter2@db"); },
      db: newDb({ locations: [{ kind: "filmed", source: "wikipedia", landmark_label: null }] }),
    });
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(3) }));
    for (const k of ["who", "where", "venues", "themes", "artists", "trend"] as const) {
      expect(sectionOf(events, k)).toMatchObject({ status: "error", data: null, provenance: [], note: expect.stringContaining("Qloo") });
    }
    expect(sectionOf(events, "hook").status).toBe("ok");
    expect(headerOf(events).qlooEntityId).toBeNull();
    expect(JSON.stringify(events)).not.toContain("hunter2");
    expect(deps.db.upserts).toHaveLength(0);
    expect(names(events).at(-1)).toBe("done");
  });

  it("emits each section as it completes, so a slow one does not hold up the rest", async () => {
    const slow = deferred<EvidenceSection<any>>();
    const draft = vi.fn(async () => ({ status: "empty", data: null, provenance: [] }) as EvidenceSection<unknown>);
    const deps = fixtureDeps({ heatmap: () => slow.promise, draftCampaign: draft });
    const gen = streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) });

    expect((await gen.next()).value).toMatchObject({ type: "header" });
    const early: string[] = [];
    for (let i = 0; i < CAFE_KEYS.length - 2; i++) { // everything but where and campaign
      const e = (await gen.next()).value as BriefEvent;
      early.push(e.type === "section" ? e.key : e.type);
    }
    expect(new Set(early)).toEqual(new Set(["who", "venues", "themes", "artists", "hook", "trend"]));
    expect(draft).not.toHaveBeenCalled();

    slow.resolve(await createHeat());
    const rest = names(await collect(gen));
    expect(rest).toEqual(["where", "campaign", "done"]);
    expect(draft).toHaveBeenCalledTimes(1);
  });

  it("calls the campaign drafter last, with the sections it collected", async () => {
    const draft = vi.fn(async (_ctx: unknown) => ({ status: "ok", data: { ideas: [] }, provenance: [] }) as EvidenceSection<unknown>);
    const deps = fixtureDeps({ draftCampaign: draft });
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
    const ctx = draft.mock.calls[0][0] as { sections: Record<string, EvidenceSection<unknown>>; header: BriefHeader; businessType: string };
    expect(Object.keys(ctx.sections).sort()).toEqual(["artists", "hook", "themes", "trend", "venues", "where", "who"]);
    expect(ctx.sections.who.status).toBe("ok");
    expect(ctx.header.title).toBe("Fixture Film");
    expect(ctx.businessType).toBe("cafe");
    expect(sectionOf(events, "campaign")).toMatchObject({ status: "ok", data: { ideas: [] } });
    expect(names(events).slice(-2)).toEqual(["campaign", "done"]);
  });

  it("turns a synchronously throwing campaign drafter into an error section and still finishes", async () => {
    const deps = fixtureDeps({ draftCampaign: (() => { throw new Error("sync boom sk-secret"); }) as never });
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
    expect(sectionOf(events, "campaign")).toMatchObject({ status: "error", data: null, provenance: [] });
    expect(JSON.stringify(events)).not.toContain("sk-secret");
    expect(names(events).at(-1)).toBe("done");
  });

  it("sanitises an error section returned by the campaign drafter", async () => {
    const deps = fixtureDeps({ draftCampaign: async () => ({ status: "error", data: null, provenance: [], note: "groq said sk-secret" }) });
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
    expect(JSON.stringify(events)).not.toContain("sk-secret");
  });

  it("turns a throwing campaign drafter into an error section", async () => {
    const deps = fixtureDeps({ draftCampaign: async () => { throw new Error("groq 500 key=sk-secret"); } });
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
    expect(sectionOf(events, "campaign")).toMatchObject({ status: "error", data: null, provenance: [] });
    expect(JSON.stringify(events)).not.toContain("sk-secret");
    expect(names(events).at(-1)).toBe("done");
  });

  it("stops before the campaign when the client has gone", async () => {
    const draft = vi.fn(async () => ({ status: "empty", data: null, provenance: [] }) as EvidenceSection<unknown>);
    const ac = new AbortController();
    const gen = streamBrief(fixtureDeps({ draftCampaign: draft }), { city: delhi, businessType: "cafe", key: key(1), signal: ac.signal });
    expect((await gen.next()).value).toMatchObject({ type: "header" });
    ac.abort();
    const rest = await collect(gen);
    expect(rest.some((e) => e.type === "section" && e.key === "campaign")).toBe(false);
    expect(rest.some((e) => e.type === "done")).toBe(false);
    expect(draft).not.toHaveBeenCalled();
  });

  it("serves a second brief from the evidence cache without calling Qloo again", async () => {
    const deps = fixtureDeps();
    await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
    const after1 = { ...deps.qlooCalls };
    expect(after1.demographics).toBe(1);
    const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
    expect(deps.qlooCalls).toEqual(after1);
    expect(sectionOf(events, "who").status).toBe("ok");
  });

  describe("where", () => {
    const centre = { name: "Fixture Centre", lat: delhi.lat, lon: delhi.lon };

    it("labels cells from the neighbourhoods table at read time and caches them unlabelled", async () => {
      const deps = fixtureDeps({ db: newDb({ neighbourhoods: [centre] }) });
      const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      const cells = sectionOf(events, "where").data as { neighbourhood: string | null }[];
      expect(cells[0].neighbourhood).toBe("Fixture Centre");
      expect(cells.at(-1)!.neighbourhood).toBeNull(); // ~5.6 km out
      const cached = deps.db.upserts.find((u) => u.kind === "heatmap")!;
      const stored = (cached.payload as EvidenceSection<object[]>).data!;
      expect(stored.length).toBeGreaterThan(0);
      for (const cell of stored) expect(cell).not.toHaveProperty("neighbourhood");
    });

    it("relabels a cached heatmap when the neighbourhoods table improves, without refetching", async () => {
      const db = newDb();
      const deps = fixtureDeps({ db });
      const first = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      expect((sectionOf(first, "where").data as { neighbourhood: string | null }[])[0].neighbourhood).toBeNull();
      db.neighbourhoods.push(centre);
      const second = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      expect((sectionOf(second, "where").data as { neighbourhood: string | null }[])[0].neighbourhood).toBe("Fixture Centre");
      expect(deps.qlooCalls.heatmap).toBe(1);
    });

    it("shows unlabelled cells rather than failing when the neighbourhoods read fails", async () => {
      const deps = fixtureDeps({ db: newDb({ neighbourhoods: [centre], fail: { neighbourhoods: true } }) });
      const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      const s = sectionOf(events, "where");
      expect(s.status).toBe("ok");
      expect((s.data as { neighbourhood: string | null }[]).every((c) => c.neighbourhood === null)).toBe(true);
    });

    it("passes an empty heatmap through untouched", async () => {
      const empty: EvidenceSection<any> = { status: "empty", data: null, provenance: [], note: "none" };
      const events = await collect(streamBrief(fixtureDeps({ heatmap: async () => empty }), { city: delhi, businessType: "cafe", key: key(1) }));
      expect(sectionOf(events, "where")).toEqual(empty);
    });
  });

  describe("venues", () => {
    const venue = (name: string, tags: string[] = []): Venue => ({ entityId: name, name, address: null, lat: null, lon: null, priceLevel: null, tags, affinity: 0.5 });
    const okVenues = (vs: Venue[]): EvidenceSection<Venue[]> => ({ status: "ok", data: vs, provenance: [{ source: "qloo", call: "recommend_places", params: {}, limits: "" }] });

    it("drops blocklisted venues by name alone when tags are empty, caching the unfiltered list", async () => {
      const deps = fixtureDeps({ places: async () => okVenues([venue("Grand Banquet Hall"), venue("Blue Tokai"), venue("The HOTEL Lobby Cafe")]) });
      const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      expect((sectionOf(events, "venues").data as Venue[]).map((v) => v.name)).toEqual(["Blue Tokai"]);
      const stored = (deps.db.upserts.find((u) => u.kind === "places")!.payload as EvidenceSection<Venue[]>).data!;
      expect(stored).toHaveLength(3);
    });

    it("reports empty, not ok-with-nothing, when every venue is filtered out", async () => {
      const deps = fixtureDeps({ places: async () => okVenues([venue("Grand Hotel")]) });
      const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      expect(sectionOf(events, "venues")).toMatchObject({ status: "empty", data: null, note: expect.stringContaining("hotel") });
    });

    it("works with null coordinates", async () => {
      const deps = fixtureDeps({ places: async () => okVenues([venue("Blue Tokai")]) });
      const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      expect(sectionOf(events, "venues").status).toBe("ok");
    });

    it("asks for places with tag ids from findTags, and looks each tag query up once per process", async () => {
      const places = vi.fn(async (_e: string, _c: unknown, _t: string[]) => okVenues([venue("Blue Tokai")]));
      const deps = fixtureDeps({ places });
      await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      expect(deps.qlooCalls.findTags).toBe(BUSINESS_TYPES.cafe.placeTagQueries.length);
      expect(places.mock.calls[0][2]).toEqual(["fx-tag-place-1", "fx-tag-place-2"]);
      // A different title needs places again but must not repeat the tag lookups.
      await collect(streamBrief({ ...deps, resolve: async () => ({ entityId: "fx-entity-2", method: "imdb" as const }) }, { city: delhi, businessType: "cafe", key: key(2) }));
      expect(places).toHaveBeenCalledTimes(2);
      expect(deps.qlooCalls.findTags).toBe(BUSINESS_TYPES.cafe.placeTagQueries.length);
    });

    it("a failing tag lookup means fewer tags and a degraded section, not an error", async () => {
      const places = vi.fn(async (_e: string, _c: unknown, _t: string[]) => okVenues([venue("Blue Tokai")]));
      const deps = fixtureDeps({ places, findTags: async () => { throw new Error("qloo down"); } });
      const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      expect(places.mock.calls[0][2]).toEqual([]);
      expect(sectionOf(events, "venues").status).toBe("degraded"); // see the caching test below
    });

    it("marks venues degraded and does not cache them when the tag lookup failed", async () => {
      const deps = fixtureDeps({ places: async () => okVenues([venue("Blue Tokai")]), findTags: async () => { throw new Error("qloo down"); } });
      const events = await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      expect(sectionOf(events, "venues")).toMatchObject({ status: "degraded", note: "Venue category filter was unavailable; results are broader than usual." });
      expect((sectionOf(events, "venues").data as Venue[]).map((v) => v.name)).toEqual(["Blue Tokai"]);
      expect(deps.db.upserts.filter((u) => u.kind === "places")).toHaveLength(0);
      // The next brief retries the tags and, once they work, caches the proper result.
      const healthy = fixtureDeps({ db: deps.db, places: async () => okVenues([venue("Blue Tokai")]) });
      const again = await collect(streamBrief(healthy, { city: delhi, businessType: "cafe", key: key(1) }));
      expect(sectionOf(again, "venues").status).toBe("ok");
      expect(deps.db.upserts.filter((u) => u.kind === "places")).toHaveLength(1);
    });

    it("does not look tags up at all when places is already cached", async () => {
      const deps = fixtureDeps();
      await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      const before = deps.qlooCalls.findTags;
      await collect(streamBrief(deps, { city: delhi, businessType: "cafe", key: key(1) }));
      expect(deps.qlooCalls.findTags).toBe(before);
    });
  });

  describe("hook", () => {
    it("lists where the title was filmed or set, with provenance per source", async () => {
      const db = newDb({ locations: [
        { kind: "filmed", source: "both", landmark_label: "India Gate" },
        { kind: "set", source: "wikipedia", landmark_label: null },
      ] });
      const events = await collect(streamBrief(fixtureDeps({ db }), { city: delhi, businessType: "cafe", key: key(1) }));
      const s = sectionOf(events, "hook");
      expect(s.status).toBe("ok");
      expect(s.data).toEqual([
        { kind: "filmed", placeName: "Delhi", landmark: "India Gate", source: "both" },
        { kind: "set", placeName: "Delhi", landmark: null, source: "wikipedia" },
      ]);
      const seen = s.provenance.map((p: any) => `${p.source}:${p.params.kind}`).sort();
      expect(seen).toEqual(["wikidata:filmed", "wikipedia:filmed", "wikipedia:set"]);
      for (const p of s.provenance) {
        expect(p).toMatchObject({ call: "title_locations", params: { city: "delhi" } });
        expect(p.limits).toMatch(/Wikipedia/);
        expect(p.limits).toMatch(/India/);
      }
    });

    it("says honestly when there is no record", async () => {
      const events = await collect(streamBrief(fixtureDeps(), { city: delhi, businessType: "cafe", key: key(1) }));
      expect(sectionOf(events, "hook")).toEqual({
        status: "empty", data: null, provenance: [], note: "No record of this title being shot or set in Delhi.",
      });
    });

    it("an error reading locations affects only the hook", async () => {
      const deps = fixtureDeps();
      const real = deps.sql;
      const sql = ((s: TemplateStringsArray, ...v: unknown[]) =>
        s.join("?").includes("title_locations") ? Promise.reject(new Error("db down")) : real(s, ...v)) as typeof real;
      const events = await collect(streamBrief({ ...deps, sql }, { city: delhi, businessType: "cafe", key: key(1) }));
      expect(sectionOf(events, "hook").status).toBe("error");
      expect(sectionOf(events, "who").status).toBe("ok");
    });
  });

  it("passes an empty trend through untouched", async () => {
    const empty: EvidenceSection<any> = { status: "empty", data: null, provenance: [{ source: "qloo", call: "trends", params: {}, limits: "" }], note: "no trend" };
    const events = await collect(streamBrief(fixtureDeps({ trends: async () => empty }), { city: delhi, businessType: "cafe", key: key(1) }));
    expect(sectionOf(events, "trend")).toEqual(empty);
  });
});

// A real-looking heatmap section for the deferred test.
async function createHeat(): Promise<EvidenceSection<any>> {
  return fixtureDeps().qloo.heatmap("e", delhi);
}

describe("filterVenues", () => {
  it("drops hotels and banquet halls from cafe venues", () => {
    expect(filterVenues([{ name: "Grand Banquet", tags: [] } as any, { name: "Blue Tokai", tags: ["Coffee"] } as any], BUSINESS_TYPES.cafe.venueBlocklist).map((v) => v.name)).toEqual(["Blue Tokai"]);
  });

  it("matches case-insensitively against the name and against any tag", () => {
    const vs = [
      { name: "THE RESORT CAFE", tags: [] },
      { name: "Sleepy Place", tags: ["Boutique Hotel"] },
      { name: "Blue Tokai", tags: ["Coffee", "Bakery"] },
    ] as Venue[];
    expect(filterVenues(vs, BUSINESS_TYPES.cafe.venueBlocklist).map((v) => v.name)).toEqual(["Blue Tokai"]);
  });

  it("keeps everything with an empty blocklist", () => {
    expect(filterVenues([{ name: "Hotel X", tags: [] } as any], [])).toHaveLength(1);
  });
});

describe("BUSINESS_TYPES", () => {
  it("defines the two launch types exactly", () => {
    expect(BUSINESS_TYPES.cafe).toEqual({
      label: "Café / restaurant",
      sections: ["who", "where", "venues", "themes", "artists", "hook", "trend", "campaign"],
      placeTagQueries: ["cafe", "coffee", "bakery", "dessert"],
      venueBlocklist: ["hotel", "banquet", "lodging", "resort", "motel"],
    });
    expect(BUSINESS_TYPES.d2c_food).toEqual({
      label: "D2C food & beverage brand",
      sections: ["who", "where", "themes", "brands", "artists", "hook", "trend", "campaign"],
      placeTagQueries: ["snacks", "dessert", "beverage", "street food"],
      venueBlocklist: ["hotel", "banquet", "lodging", "resort", "motel"],
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { EvidenceSection } from "../../../../shared/types/pulse.js";
import { allCities } from "../cities.js";
import type { QlooClient } from "../qloo/client.js";
import { call, collect, toolCallMsg, user, assistant } from "../testing/agent.js";
import { boardSql, newBoardDb, seedEvidence } from "../testing/boardFakes.js";
import { fixtureDeps, newDb } from "../testing/fakes.js";
import { fakeLlm } from "../testing/llm.js";
import { runAgent } from "./loop.js";
import { buildTools, createToolProvider, CHAT_QLOO_TOOLS, QLOO_EXTRA_TOOLS, type AgentTool, type AgentToolDeps } from "./tools.js";
import { escapeLike } from "./tools/searchReleases.js";

const TODAY = new Date("2026-10-21T06:00:00Z");
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);

type Rows = Record<string, unknown>[];
function recordingSql(rows: Rows | ((text: string) => Rows)) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push({ text, values });
    return Promise.resolve(typeof rows === "function" ? rows(text) : rows);
  }) as unknown as AgentToolDeps["sql"];
  return { sql, calls };
}

function harnessTools(...names: string[]) {
  return names.map((name) => ({
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: "object", properties: { entity: { type: "string" } }, required: ["entity"], additionalProperties: false },
  }));
}

function toolDeps(over: Partial<AgentToolDeps> = {}): AgentToolDeps & { qlooCalls: Record<string, number> } {
  const f = fixtureDeps();
  return {
    sql: f.sql as unknown as AgentToolDeps["sql"],
    qloo: f.qloo,
    resolve: f.resolve,
    header: f.header,
    isKnown: async () => true,
    enqueueWarm: vi.fn(),
    now: () => TODAY,
    onError: vi.fn(),
    ...over,
    qlooCalls: f.qlooCalls,
  };
}

const find = (tools: AgentTool[], name: string) => tools.find((t) => t.spec.function.name === name)!;
const names = (tools: AgentTool[]) => tools.map((t) => t.spec.function.name);

describe("buildTools: which tools the model gets", () => {
  it("always has the four Pulse tools", async () => {
    expect(names(await buildTools(toolDeps()))).toEqual(expect.arrayContaining(["pulse_board", "release_brief", "search_releases", "titles_shot_in"]));
  });

  it("only allowlisted harness tools are exposed", async () => {
    const qloo = { ...toolDeps().qloo, listTools: async () => harnessTools("qloo_recommend", "qloo_dangerous_admin", "qloo_capabilities", "qloo_trends", "qloo_entity_tags", "qloo_where_popular", "shell_exec") } as QlooClient;
    const out = names(await buildTools(toolDeps({ qloo })));
    expect(out).toContain("qloo_recommend");
    expect(out).toContain("qloo_where_popular");
    for (const bad of ["qloo_dangerous_admin", "qloo_capabilities", "qloo_trends", "qloo_entity_tags", "shell_exec"]) expect(out).not.toContain(bad);
  });

  it("the chat allowlist is exactly three Qloo tools; the other four are defined but not exposed", () => {
    expect([...CHAT_QLOO_TOOLS].sort()).toEqual(["qloo_audience_demographics", "qloo_recommend", "qloo_where_popular"]);
    expect([...QLOO_EXTRA_TOOLS].sort()).toEqual(["qloo_compare_audiences", "qloo_describe", "qloo_find_tags", "qloo_rank"]);
  });

  it("the chat exposes exactly seven tools (four Pulse + three Qloo), plus the fixture echo in fixtures mode", async () => {
    // The harness lists all seven real tools and the fixture echo; the four extras and (outside fixtures mode) the echo are filtered out.
    const all = harnessTools(...CHAT_QLOO_TOOLS, ...QLOO_EXTRA_TOOLS, "qloo_fixture_echo");
    const qloo = { ...toolDeps().qloo, listTools: async () => all } as QlooClient;
    expect(names(await buildTools(toolDeps({ qloo }))).sort()).toEqual([
      "pulse_board", "qloo_audience_demographics", "qloo_recommend", "qloo_where_popular", "release_brief", "search_releases", "titles_shot_in",
    ]);
    expect(names(await buildTools(toolDeps({ qloo, fixtures: true }))).sort()).toEqual([
      "pulse_board", "qloo_audience_demographics", "qloo_fixture_echo", "qloo_recommend", "qloo_where_popular", "release_brief", "search_releases", "titles_shot_in",
    ]);
  });

  it("does not expose the dropped extras even when the harness lists them", async () => {
    const qloo = { ...toolDeps().qloo, listTools: async () => harnessTools(...QLOO_EXTRA_TOOLS) } as QlooClient;
    expect(names(await buildTools(toolDeps({ qloo })))).toEqual(["pulse_board", "release_brief", "search_releases", "titles_shot_in"]);
  });

  it("offers an allowlisted tool only if the harness actually lists it", async () => {
    const qloo = { ...toolDeps().qloo, listTools: async () => harnessTools("qloo_where_popular") } as QlooClient;
    const out = names(await buildTools(toolDeps({ qloo })));
    expect(out).toContain("qloo_where_popular");
    expect(out).not.toContain("qloo_recommend");
  });

  it("allows the fixture client's echo tool only in fixtures mode", async () => {
    const real = names(await buildTools(toolDeps()));
    expect(real).not.toContain("qloo_fixture_echo");
    const fixtures = names(await buildTools(toolDeps({ fixtures: true })));
    expect(fixtures).toContain("qloo_fixture_echo");
  });

  it("the Pulse tools are not counted against the Qloo budget", async () => {
    const tools = await buildTools(toolDeps());
    for (const n of ["pulse_board", "release_brief", "search_releases", "titles_shot_in"]) expect(find(tools, n).budget).toBeUndefined();
  });

  it("sends the provider a conservative schema: no examples, defaults or uniqueItems, but type and required kept", async () => {
    const inputSchema = {
      $schema: "http://json-schema.org/draft-07/schema#", type: "object", required: ["entity"], additionalProperties: false,
      properties: { entity: { type: "string", minLength: 1, examples: ["x"] }, limit: { type: "integer", default: 10, minimum: 1 }, tags: { type: "array", uniqueItems: true, items: { type: "string" } } },
    };
    const qloo = { ...toolDeps().qloo, listTools: async () => [{ name: "qloo_recommend", description: "d", inputSchema }] } as QlooClient;
    const params = find(await buildTools(toolDeps({ qloo })), "qloo_recommend").spec.function.parameters;
    expect(params).toEqual({
      type: "object", required: ["entity"], additionalProperties: false,
      properties: { entity: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1 }, tags: { type: "array", items: { type: "string" } } },
    });
  });

  it("uses the harness's own schema as the tool's parameters", async () => {
    const qloo = { ...toolDeps().qloo, listTools: async () => harnessTools("qloo_recommend") } as QlooClient;
    const tool = find(await buildTools(toolDeps({ qloo })), "qloo_recommend");
    expect(tool.spec.function.parameters).toMatchObject({ type: "object", properties: { entity: { type: "string" } }, additionalProperties: false });
    expect(tool.spec.type).toBe("function");
  });

  it("degrades to the Pulse tools when the harness cannot be listed, and logs why", async () => {
    const onError = vi.fn();
    const qloo = { ...toolDeps().qloo, listTools: async () => { throw new Error("harness down"); } } as QlooClient;
    const out = names(await buildTools(toolDeps({ qloo, onError })));
    expect(out).toEqual(["pulse_board", "release_brief", "search_releases", "titles_shot_in"]);
    expect(onError).toHaveBeenCalledWith("listTools", expect.any(Error));
  });

  it("a harness tool calls the harness with the arguments and hands back a compact result", async () => {
    const callTool = vi.fn(async () => ({
      schema_version: "1.0-preview.1", operation: "describe", status: "ok", summary: "Found it.", result_count: 1,
      results: [{ name: "Fake Place", extra: "y".repeat(2000), list: Array.from({ length: 50 }, (_, i) => i) }],
      execution: { transport: "mcp", correlation_id: "abc", duration_ms: 3 }, provenance: { source: "qloo", endpoint: "/x", documentation: "d" },
      query_intent: { big: "z".repeat(5000) },
    }));
    const qloo = { ...toolDeps().qloo, listTools: async () => harnessTools("qloo_recommend"), callTool } as unknown as QlooClient;
    const tool = find(await buildTools(toolDeps({ qloo })), "qloo_recommend");
    const ac = new AbortController();
    const out = (await tool.run({ entity: "Fake Place" }, { signal: ac.signal })) as Record<string, unknown>;
    // The call's signal travels to the client, so a queued call can be dropped.
    expect(callTool).toHaveBeenCalledWith("qloo_recommend", { entity: "Fake Place" }, { signal: ac.signal });
    expect(tool.budget).toBe("harness");
    expect(out).toMatchObject({ tool: "qloo_recommend", status: "ok", summary: "Found it.", result_count: 1 });
    expect(out).not.toHaveProperty("execution");
    expect(out).not.toHaveProperty("query_intent");
    expect(JSON.stringify(out).length).toBeLessThan(3000);
  });

  it("a harness error envelope reaches the model as data (code and recovery hint), not an exception", async () => {
    const callTool = vi.fn(async () => ({ status: "error", error: { code: "validation", layer: "input", retryable: false, recovery: "Pass an entity." } }));
    const qloo = { ...toolDeps().qloo, listTools: async () => harnessTools("qloo_recommend"), callTool } as unknown as QlooClient;
    const out = await find(await buildTools(toolDeps({ qloo })), "qloo_recommend").run({});
    expect(out).toMatchObject({ tool: "qloo_recommend", status: "error", error: { code: "validation", recovery: "Pass an entity." } });
  });
});

describe("createToolProvider", () => {
  it("builds once and reuses the tools until the ttl passes", async () => {
    const listTools = vi.fn(async () => harnessTools("qloo_recommend"));
    const qloo = { ...toolDeps().qloo, listTools } as QlooClient;
    let now = 0;
    const get = createToolProvider(toolDeps({ qloo }), { ttlMs: 1000, now: () => now });
    await get(); await get();
    expect(listTools).toHaveBeenCalledTimes(1);
    now = 1001;
    await get();
    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it("does not keep a degraded build (a harness outage must not stick for the ttl)", async () => {
    let fail = true;
    const listTools = vi.fn(async () => { if (fail) throw new Error("down"); return harnessTools("qloo_recommend"); });
    const qloo = { ...toolDeps().qloo, listTools } as QlooClient;
    const get = createToolProvider(toolDeps({ qloo }), { ttlMs: 1000, now: () => 0 });
    expect(names(await get())).not.toContain("qloo_recommend");
    fail = false;
    expect(names(await get())).toContain("qloo_recommend");
  });
});

describe("city and business type arguments are checked against the allowlists, and a bad one comes back as data", () => {
  const slugs = allCities().map((c) => c.slug);
  it.each([
    ["pulse_board", { city: "atlantis", business_type: "cafe" }, "unknown_city"],
    ["pulse_board", { city: "delhi", business_type: "bank" }, "unknown_business_type"],
    ["pulse_board", { city: "delhi", business_type: "constructor" }, "unknown_business_type"],
    ["pulse_board", {}, "unknown_city"],
    ["release_brief", { title_or_tmdb_id: "dune", city: "atlantis", business_type: "cafe" }, "unknown_city"],
    ["release_brief", { title_or_tmdb_id: "dune", city: "delhi", business_type: "bank" }, "unknown_business_type"],
    ["titles_shot_in", { city: "atlantis" }, "unknown_city"],
    ["titles_shot_in", { city: 5 }, "unknown_city"],
  ])("%s %j -> %s", async (tool, args, error) => {
    const spy = recordingSql([]);
    const out = (await find(await buildTools(toolDeps({ sql: spy.sql })), tool).run(args)) as { error: string; valid: string[] };
    expect(out.error).toBe(error);
    expect(out.valid).toEqual(error === "unknown_city" ? slugs : ["cafe", "d2c_food"]);
    expect(spy.calls).toHaveLength(0);
  });

  it("accepts a slug in any case and with stray spaces", async () => {
    const spy = recordingSql([]);
    const out = (await find(await buildTools(toolDeps({ sql: spy.sql })), "titles_shot_in").run({ city: "  DELHI " })) as { city: string };
    expect(out.city).toBe("delhi");
  });

  it("declares the allowlists as enums in the tool schemas", async () => {
    const tools = await buildTools(toolDeps());
    const params = find(tools, "pulse_board").spec.function.parameters as { properties: { city: { enum: string[] }; business_type: { enum: string[] } } };
    expect(params.properties.city.enum).toEqual(slugs);
    expect(params.properties.business_type.enum).toEqual(["cafe", "d2c_food"]);
  });
});

describe("pulse_board", () => {
  const rel = (id: number, date: string, popularity: number, title: string) => ({ tmdb_id: id, media_type: "movie" as const, title, release_date: date, popularity });

  function boardDeps(n: number, pending = 0, unresolved = 0) {
    const releases = Array.from({ length: n + pending + unresolved }, (_, i) => rel(i + 1, "2026-10-22", 100 - i, `Fake Release ${i + 1}`));
    const db = newBoardDb({ releases });
    for (let i = 0; i < n; i++) {
      db.entities.push({ tmdb_id: i + 1, media_type: "movie", qloo_entity_id: `fx-${i}`, method: "imdb", not_found: false, resolved_at: daysAgo(1) });
      const section: EvidenceSection<unknown> = { status: "ok", data: [{ lat: 28.55, lon: 77.2, geohash: "g", affinity: 0.9 - i * 0.05, popularity: 0.1 }], provenance: [] };
      seedEvidence(db, `fx-${i}`, "delhi", "heatmap", section, daysAgo(1));
      seedEvidence(db, `fx-${i}`, "delhi", "place_tags", { status: "ok", data: [{ tagId: "t", name: "Gym", affinity: 0.5 }], provenance: [] }, daysAgo(1));
    }
    for (let i = 0; i < unresolved; i++) {
      db.entities.push({ tmdb_id: n + pending + i + 1, media_type: "movie", qloo_entity_id: null, method: null, not_found: true, resolved_at: daysAgo(1) });
    }
    return toolDeps({ sql: boardSql(db) });
  }

  it("returns the top 8 ranked releases, compacted, with counts and what pending means", async () => {
    const deps = boardDeps(12, 3, 2);
    const out = (await find(await buildTools(deps), "pulse_board").run({ city: "delhi", business_type: "cafe" })) as Record<string, unknown>;
    const ranked = out.ranked as Record<string, unknown>[];
    expect(ranked).toHaveLength(8);
    expect(Object.keys(ranked[0]).sort()).toEqual(["mediaType", "platform", "releaseDate", "score", "title", "tmdbId", "why"]);
    expect(out).toMatchObject({ city: "delhi", cityName: "Delhi", businessType: "cafe", rankedCount: 12, pendingCount: 3, unresolvedCount: 2 });
    expect(out.summary).toBe("12 ranked and 3 pending for Delhi (cafe).");
    expect(String(out.note)).toMatch(/pending means .*still loading/i);
    expect(JSON.stringify(out).length).toBeLessThan(4000);
    expect(out).not.toHaveProperty("pending");
    expect(out).not.toHaveProperty("posterUrl");
  });

  it("asks for pending titles to be warmed, as the board route does", async () => {
    const deps = boardDeps(0, 2);
    await find(await buildTools(deps), "pulse_board").run({ city: "delhi", business_type: "cafe" });
    expect(deps.enqueueWarm).toHaveBeenCalledTimes(2);
  });

  it("says so plainly when nothing is ranked yet", async () => {
    const out = (await find(await buildTools(boardDeps(0, 2)), "pulse_board").run({ city: "delhi", business_type: "d2c_food" })) as { ranked: unknown[]; note: string };
    expect(out.ranked).toEqual([]);
    expect(out.note).toMatch(/none are ranked yet|no release is ranked/i);
  });
});

describe("release_brief", () => {
  const base = { city: "delhi", business_type: "cafe" };
  const args = { title_or_tmdb_id: 550, media_type: "movie", ...base };

  it("collects the brief into a bounded summary: statuses, a few names, and the Qloo call names", async () => {
    const deps = toolDeps();
    const out = (await find(await buildTools(deps), "release_brief").run(args)) as { title: string; sections: Record<string, { status: string; calls: string[]; [k: string]: unknown }> };
    expect(out.title).toBe("Fixture Film");
    expect((out as unknown as { summary: string }).summary).toMatch(/^Brief for "Fixture Film" in Delhi: 7 sections \(.*6 ok.*1 empty.*\)\.$/);
    expect(Object.keys(out.sections).sort()).toEqual(["artists", "hook", "themes", "trend", "venues", "where", "who"].sort());
    expect(out.sections.who).toMatchObject({ status: "ok", calls: ["fixture:audience_demographics"] });
    expect((out.sections.who.topAge as unknown[])).toHaveLength(3);
    expect(out.sections.where.calls).toEqual(["fixture:where_popular"]);
    expect((out.sections.venues.names as string[]).length).toBeLessThanOrEqual(5);
    expect((out.sections.themes.names as string[]).length).toBeLessThanOrEqual(6);
    expect((out.sections.artists.names as string[]).length).toBeLessThanOrEqual(5);
    expect(out.sections.trend).toMatchObject({ status: "ok", present: true });
    expect(out.sections.hook).toMatchObject({ status: "empty" });
    expect(out.sections).not.toHaveProperty("campaign");
    expect(JSON.stringify(out).length).toBeLessThan(3500);
  });

  it("d2c_food includes brands, not venues", async () => {
    const out = (await find(await buildTools(toolDeps()), "release_brief").run({ ...args, business_type: "d2c_food" })) as { sections: Record<string, unknown> };
    expect(out.sections).toHaveProperty("brands");
    expect(out.sections).not.toHaveProperty("venues");
  });

  it("draws the top five labelled neighbourhoods with relative affinity, once each, and counts the unlabelled cells", async () => {
    const at = (i: number) => ({ lat: 28 + i * 0.1, lon: 77, geohash: `g${i}`, affinity: 0.9 - i * 0.05, popularity: 0.1 });
    const cells = [...Array.from({ length: 8 }, (_, i) => at(i)), { ...at(0), affinity: 0.1 }, { lat: 10, lon: 10, geohash: "far1", affinity: 0.5, popularity: 0 }, { lat: 11, lon: 11, geohash: "far2", affinity: 0.5, popularity: 0 }];
    const db = newDb();
    db.neighbourhoods.push(...Array.from({ length: 8 }, (_, i) => ({ name: `Fake Hood ${i}`, lat: at(i).lat, lon: at(i).lon })));
    const f = fixtureDeps({ db, heatmap: async () => ({ status: "ok", data: cells, provenance: [{ source: "qloo", call: "where_popular", params: {}, limits: "" }] }) });
    const deps = toolDeps({ sql: f.sql as unknown as AgentToolDeps["sql"], qloo: f.qloo });
    const out = (await find(await buildTools(deps), "release_brief").run(args)) as { sections: { where: { top: { name: string; affinity: number }[]; unlabelledCells: number; cells: number } } };
    expect(out.sections.where.top.map((t) => t.name)).toEqual(["Fake Hood 0", "Fake Hood 1", "Fake Hood 2", "Fake Hood 3", "Fake Hood 4"]);
    expect(out.sections.where.top[0].affinity).toBe(0.9);
    expect(out.sections.where).toMatchObject({ unlabelledCells: 2, cells: 11 });
  });

  it("makes no LLM call inside the tool: the campaign drafter is a no-op and the model is called only by the agent loop", async () => {
    const deps = toolDeps();
    const tools = await buildTools(deps);
    const llm = fakeLlm([toolCallMsg(call("release_brief", args)), assistant("Advice from the evidence.")]);
    const ev = await collect(runAgent(llm, tools, [user("brief me")]));
    expect(llm.calls).toHaveLength(2); // one per agent round, none from the tool
    expect(ev.map((e) => e.type)).toEqual(["tool", "tool_result", "message", "done"]);
    // The tool never reaches for a model: its deps have no client for one.
    expect(Object.keys(deps)).not.toContain("llm");
  });

  it("returns unknown_title as data when Spotlight does not know the title, and spends no Qloo call", async () => {
    const deps = toolDeps({ isKnown: async () => false });
    const out = await find(await buildTools(deps), "release_brief").run(args);
    expect(out).toEqual({ error: "unknown_title" });
    expect(Object.keys(deps.qlooCalls)).toEqual(["listTools"]); // listing the harness tools, nothing about the title
  });

  it("treats a numeric string as a tmdb id, and checks the media type it defaults to", async () => {
    const isKnown = vi.fn(async (k: { tmdbId: number; mediaType: string }) => k.mediaType === "tv");
    const out = (await find(await buildTools(toolDeps({ isKnown })), "release_brief").run({ ...base, title_or_tmdb_id: "1399" })) as { header?: unknown; mediaType: string; tmdbId: number };
    expect(isKnown).toHaveBeenCalledWith({ tmdbId: 1399, mediaType: "movie" });
    expect(isKnown).toHaveBeenCalledWith({ tmdbId: 1399, mediaType: "tv" });
    expect(out).toMatchObject({ tmdbId: 1399, mediaType: "tv" });
  });

  it("asks for the media type when a bare id is known as both", async () => {
    const out = await find(await buildTools(toolDeps({ isKnown: async () => true })), "release_brief").run({ ...base, title_or_tmdb_id: 12 });
    expect(out).toMatchObject({ error: "ambiguous_media_type" });
  });

  it("an explicit media_type is used as given", async () => {
    const isKnown = vi.fn(async () => true);
    await find(await buildTools(toolDeps({ isKnown })), "release_brief").run({ ...args, title_or_tmdb_id: 12, media_type: "tv" });
    expect(isKnown).toHaveBeenCalledTimes(1);
    expect(isKnown).toHaveBeenCalledWith({ tmdbId: 12, mediaType: "tv" });
  });

  it("resolves a title by the same search as search_releases, first match, media type from the match", async () => {
    const spy = recordingSql((t) => (t.includes("ILIKE") ? [
      { tmdb_id: "777", media_type: "tv", title: "Fake Show", release_date: "2026-10-25", platform: "Netflix" },
      { tmdb_id: "778", media_type: "movie", title: "Fake Show Movie", release_date: "2026-10-26", platform: null },
    ] : []));
    const f = fixtureDeps();
    const header = vi.fn(f.header);
    const out = (await find(await buildTools(toolDeps({ sql: spy.sql, header })), "release_brief").run({ ...base, title_or_tmdb_id: "Fake Show" })) as { tmdbId: number; mediaType: string };
    expect(spy.calls[0].values[0]).toBe("%Fake Show%");
    expect(out).toMatchObject({ tmdbId: 777, mediaType: "tv" });
    expect(header).toHaveBeenCalledWith({ tmdbId: 777, mediaType: "tv" });
  });

  it("with a media_type given, the first match of that type", async () => {
    const spy = recordingSql((t) => (t.includes("ILIKE") ? [
      { tmdb_id: "777", media_type: "tv", title: "Fake Show", release_date: "2026-10-25", platform: null },
      { tmdb_id: "778", media_type: "movie", title: "Fake Show Movie", release_date: "2026-10-26", platform: null },
    ] : []));
    const out = (await find(await buildTools(toolDeps({ sql: spy.sql })), "release_brief").run({ ...args, title_or_tmdb_id: "Fake Show", media_type: "movie" })) as { tmdbId: number };
    expect(out.tmdbId).toBe(778);
  });

  it("answers unknown_title for a name nothing matches", async () => {
    const spy = recordingSql([]);
    const out = await find(await buildTools(toolDeps({ sql: spy.sql })), "release_brief").run({ ...base, title_or_tmdb_id: "No Such Film" });
    expect(out).toEqual({ error: "unknown_title" });
  });

  it("passes an error section's note through without the upstream text (the brief already sanitises it)", async () => {
    const deps = toolDeps({ resolve: async () => ({ entityId: null, reason: "not_in_qloo" as const }) });
    const out = (await find(await buildTools(deps), "release_brief").run(args)) as { hasQlooEntity: boolean; sections: Record<string, { status: string; note?: string; calls: string[] }> };
    expect(out.hasQlooEntity).toBe(false);
    expect(out.sections.who).toMatchObject({ status: "empty", calls: [] });
    expect(out.sections.who.note).toMatch(/no entity/i);
  });

  it("is bounded however much the sections hold, and cleans third-party text", async () => {
    const big = (n: number, label: string) => Array.from({ length: n }, (_, i) => ({ entityId: `e${i}`, name: `${label} <b>${i}</b> ${"long ".repeat(60)}`, affinity: 0.5, tagId: `t${i}`, address: "x", lat: 1, lon: 1, priceLevel: 1, tags: [] }));
    const qloo = {
      ...toolDeps().qloo,
      places: async () => ({ status: "ok", data: big(200, "Venue"), provenance: [{ source: "qloo", call: "recommend_places", params: {}, limits: "" }] }),
      artists: async () => ({ status: "ok", data: big(200, "Artist"), provenance: [] }),
    } as unknown as QlooClient;
    const out = (await find(await buildTools(toolDeps({ qloo })), "release_brief").run(args)) as { sections: { venues: { names: string[] } } };
    const text = JSON.stringify(out);
    expect(text.length).toBeLessThan(4500);
    expect(text).not.toMatch(/[<>]/);
    expect(out.sections.venues.names).toHaveLength(5);
  });
});

describe("search_releases", () => {
  const tool = async (sql: AgentToolDeps["sql"]) => find(await buildTools(toolDeps({ sql })), "search_releases");

  it("escapes LIKE wildcards and the escape character, so user text matches literally", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
    expect(escapeLike("\\%_")).toBe("\\\\\\%\\_");
  });

  it("passes the pattern as a parameter, never in the statement text", async () => {
    const spy = recordingSql([]);
    await (await tool(spy.sql)).run({ query: "100%_\\ Dune'; DROP TABLE x;--" });
    const [c] = spy.calls;
    expect(c.text).not.toContain("DROP");
    expect(c.text).toMatch(/ILIKE \? ESCAPE '\\'/);
    expect(c.values[0]).toBe("%100\\%\\_\\\\ Dune'; DROP TABLE x;--%");
  });

  it("bounds the query at 80 characters and the results at 10", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ tmdb_id: String(i + 1), media_type: "movie", title: `T${i}`, release_date: "2026-10-22", platform: "Netflix" }));
    const spy = recordingSql(rows);
    const out = (await (await tool(spy.sql)).run({ query: "q".repeat(300) })) as { results: unknown[]; query: string };
    expect((spy.calls[0].values[0] as string).length).toBe(80 + 2);
    expect(out.query.length).toBe(80);
    expect(out.results).toHaveLength(10);
    expect(spy.calls[0].text).toMatch(/LIMIT 10/);
  });

  it("maps rows to tmdbId/mediaType/title/date/platform", async () => {
    const spy = recordingSql([{ tmdb_id: "123", media_type: "tv", title: "Fake Show", release_date: "2026-10-22", platform: "Netflix" }]);
    const out = await (await tool(spy.sql)).run({ query: "fake" });
    expect(out).toMatchObject({ results: [{ tmdbId: 123, mediaType: "tv", title: "Fake Show", date: "2026-10-22", platform: "Netflix" }] });
  });

  it("says plainly when nothing matches", async () => {
    const out = (await (await tool(recordingSql([]).sql)).run({ query: "zzz" })) as { results: unknown[]; note: string };
    expect(out.results).toEqual([]);
    expect(out.note).toMatch(/no release/i);
  });

  it.each([[{}], [{ query: "" }], [{ query: "   " }], [{ query: 5 }], [{ query: ["a"] }]])("%j -> an error result and no query", async (args) => {
    const spy = recordingSql([]);
    const out = (await (await tool(spy.sql)).run(args)) as { error: string };
    expect(out.error).toBe("empty_query");
    expect(spy.calls).toHaveLength(0);
  });
});

describe("titles_shot_in", () => {
  const tool = async (sql: AgentToolDeps["sql"]) => find(await buildTools(toolDeps({ sql })), "titles_shot_in");
  const row = (i: number, kind = "filmed", landmark: string | null = null) => ({ tmdb_id: String(i), media_type: "movie", title: `Fake Title ${i}`, release_date: "2026-10-22", kind, landmark_label: landmark });

  it("lists titles with kind and landmark, at most 20", async () => {
    const spy = recordingSql(Array.from({ length: 30 }, (_, i) => row(i + 1, i % 2 ? "set" : "filmed", i === 0 ? "Chandni Chowk" : null)));
    const out = (await (await tool(spy.sql)).run({ city: "delhi" })) as { titles: Record<string, unknown>[] };
    expect(out.titles).toHaveLength(20);
    expect(out.titles[0]).toEqual({ tmdbId: 1, mediaType: "movie", title: "Fake Title 1", releaseDate: "2026-10-22", kind: "filmed", landmark: "Chandni Chowk" });
    expect(spy.calls[0].values).toEqual(["delhi", "delhi"]);
    expect(spy.calls[0].text).toMatch(/LIMIT 20/);
  });

  it("says honestly that the list is empty, and that this is not proof a title was not shot there", async () => {
    const out = (await (await tool(recordingSql([]).sql)).run({ city: "mumbai" })) as { titles: unknown[]; note: string };
    expect(out.titles).toEqual([]);
    expect(out.note).toMatch(/no title/i);
    expect(out.note).toMatch(/Mumbai/);
    expect(out.note).toMatch(/partial|not (proof|evidence)|does not mean/i);
  });
});

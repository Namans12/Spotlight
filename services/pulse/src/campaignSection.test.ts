import { describe, expect, it, vi } from "vitest";
import type { BriefEvent, BriefHeader, BriefSectionKey, Campaign, EvidenceSection } from "../../../shared/types/pulse.js";
import { streamBrief, type CampaignContext } from "./brief.js";
import { createTtlCache } from "./campaignCache.js";
import { makeDraftCampaign, type CampaignSectionDeps } from "./campaignSection.js";
import { getCity } from "./cities.js";
import { LlmError, type LlmClient } from "./llm/client.js";
import { fixtureDeps } from "./testing/fakes.js";
import { fakeLlm, type FakeLlm } from "./testing/llm.js";

const ok = <T>(data: T): EvidenceSection<unknown> => ({ status: "ok", data, provenance: [] });
const idea = (kind: string, evidence: string[]) => ({ kind, title: `${kind} idea`, timing: "Release day", clauses: [{ text: `A ${kind} clause`, evidence }] });
const campaignJson = (ev: string[]) => JSON.stringify({ ideas: [idea("special", ev), idea("social", ev), idea("event", ev)] });

const header: BriefHeader = { tmdbId: 1, mediaType: "movie", title: "Dune", posterUrl: null, releaseDate: "2026-11-06", city: "delhi", cityName: "Delhi", businessType: "cafe", qlooEntityId: "ent-1" };
const SECTIONS: Partial<Record<BriefSectionKey, EvidenceSection<unknown>>> = {
  themes: ok([{ tagId: "t1", name: "Tag One", affinity: 0.5 }, { tagId: "t2", name: "Tag Two", affinity: 0.4 }]),
  artists: ok([{ entityId: "a1", name: "Artist One", affinity: 0.5 }]),
  who: { status: "empty", data: null, provenance: [] },
};
const ctxOf = (over: Partial<CampaignContext> = {}): CampaignContext => ({ sections: SECTIONS, header, businessType: "cafe", session: "sess-1", ...over });
const OK_REPLY = campaignJson(["tag:t1"]);
const NOTES = {
  notEnough: "Not enough taste data to ground a campaign for this title.",
  unconfigured: "The campaign writer isn't configured on this deployment.",
  cap: "Daily AI limit reached — the evidence above is unaffected.",
};

function setup(script: Parameters<typeof fakeLlm>[0] = [OK_REPLY], over: Partial<CampaignSectionDeps> = {}) {
  const llm: FakeLlm = fakeLlm(script);
  const takeUsage = vi.fn(async (_session: string) => ({ allowed: true }) as { allowed: true } | { allowed: false; reason: "session_cap" | "global_cap" });
  let t = 0;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const deps: CampaignSectionDeps = { llm, model: "m-1", takeUsage, now: clock.now, ...over };
  return { llm, takeUsage, clock, draft: makeDraftCampaign(deps) };
}

describe("makeDraftCampaign ordering", () => {
  it("R28a: with no facts it returns an empty section and makes no LLM call and takes no usage", async () => {
    const { draft, llm, takeUsage } = setup();
    const none = { who: { status: "empty", data: null, provenance: [] }, where: { status: "error", data: null, provenance: [], note: "x" } } as const;
    const s = await draft(ctxOf({ sections: { ...none } as CampaignContext["sections"] }));
    expect(s).toEqual({ status: "empty", data: null, provenance: [], note: NOTES.notEnough });
    expect(llm.calls).toHaveLength(0);
    expect(takeUsage).not.toHaveBeenCalled();
  });

  it("R28a comes before the not-configured check", async () => {
    const { draft } = setup([OK_REPLY], { llm: null });
    expect((await draft(ctxOf({ sections: {} }))).status).toBe("empty");
  });

  it("R28c: unconfigured is a degraded section with a fixed note, no usage taken", async () => {
    const { draft, takeUsage } = setup([OK_REPLY], { llm: null });
    expect(await draft(ctxOf())).toEqual({ status: "degraded", data: null, provenance: [], note: NOTES.unconfigured });
    expect(takeUsage).not.toHaveBeenCalled();
  });

  it("drafts an ok section with the campaign, writer provenance and the evidence count", async () => {
    const { draft, llm, takeUsage } = setup();
    const s = await draft(ctxOf());
    expect(s.status).toBe("ok");
    const data = s.data as Campaign;
    expect(data.groundedBy).toBe("qloo");
    expect(data.ideas).toHaveLength(3);
    expect(data.ideas[0].clauses[0].evidence).toEqual(["tag:t1"]);
    expect(s.provenance).toEqual([{
      source: "spotlight",
      call: "campaign_writer",
      params: { model: "m-1", evidenceFacts: "3" },
      limits: "Drafted by an AI model from the evidence listed above; every cited claim links to that evidence, uncited clauses are the model's own suggestions.",
    }]);
    expect(llm.calls).toHaveLength(1);
    expect(takeUsage).toHaveBeenCalledTimes(1);
    expect(takeUsage).toHaveBeenCalledWith("sess-1");
  });

  it("counts usage once per draft, not per validation retry", async () => {
    const { draft, llm, takeUsage } = setup(["not json", campaignJson(["tag:nope"]), OK_REPLY]);
    const s = await draft(ctxOf());
    expect(llm.calls).toHaveLength(3);
    expect(takeUsage).toHaveBeenCalledTimes(1);
    expect(s.status).toBe("ok");
  });

  it("R28d: a cap hit is a degraded section, either reason, and the LLM is not called", async () => {
    for (const reason of ["session_cap", "global_cap"] as const) {
      const { draft, llm } = setup([OK_REPLY], { takeUsage: async () => ({ allowed: false, reason }) });
      expect(await draft(ctxOf())).toEqual({ status: "degraded", data: null, provenance: [], note: NOTES.cap });
      expect(llm.calls).toHaveLength(0);
    }
  });

  it("lets a usage-store failure propagate (the brief turns it into an error section)", async () => {
    const { draft, llm } = setup([OK_REPLY], { takeUsage: async () => { throw new Error("db down"); } });
    await expect(draft(ctxOf())).rejects.toThrow("db down");
    expect(llm.calls).toHaveLength(0);
  });
});

describe("makeDraftCampaign cache (R28b)", () => {
  it("serves a repeat view from the cache: no LLM call and no usage", async () => {
    const { draft, llm, takeUsage } = setup();
    const first = await draft(ctxOf());
    const second = await draft(ctxOf({ session: "another-session" }));
    expect(second).toEqual(first);
    expect(llm.calls).toHaveLength(1);
    expect(takeUsage).toHaveBeenCalledTimes(1);
  });

  it("keys on entity, city and business type", async () => {
    const { draft, llm } = setup();
    await draft(ctxOf());
    await draft(ctxOf({ header: { ...header, city: "mumbai", cityName: "Mumbai" } }));
    await draft(ctxOf({ businessType: "d2c_food" }));
    await draft(ctxOf({ header: { ...header, qlooEntityId: "ent-2" } }));
    expect(llm.calls).toHaveLength(4);
    await draft(ctxOf());
    expect(llm.calls).toHaveLength(4);
  });

  it("expires after an hour", async () => {
    const { draft, llm, clock } = setup();
    await draft(ctxOf());
    clock.advance(3_599_000);
    await draft(ctxOf());
    expect(llm.calls).toHaveLength(1);
    clock.advance(2_000);
    await draft(ctxOf());
    expect(llm.calls).toHaveLength(2);
  });

  it("serves a cached campaign even when the cap has since been reached", async () => {
    const cache = createTtlCache<EvidenceSection<unknown>>({ ttlMs: 3_600_000, max: 50, now: () => 0 });
    const a = setup([OK_REPLY], { cache });
    await a.draft(ctxOf());
    const b = setup([OK_REPLY], { cache, takeUsage: async () => ({ allowed: false, reason: "global_cap" }) });
    expect((await b.draft(ctxOf())).status).toBe("ok");
    expect(b.llm.calls).toHaveLength(0);
  });

  it("does not cache failures, caps or the unavailable fallback", async () => {
    const failing = setup([new LlmError("unavailable", "x"), OK_REPLY]);
    expect((await failing.draft(ctxOf())).status).toBe("degraded");
    expect((await failing.draft(ctxOf())).status).toBe("ok"); // retried, not served from cache
    expect(failing.llm.calls).toHaveLength(2);

    const garbled = setup(["a", "b", "c", OK_REPLY]);
    const s1 = await garbled.draft(ctxOf());
    expect(s1.status).toBe("degraded");
    expect((s1.data as Campaign).ideas[0].title).toBe("Campaign draft unavailable");
    expect((await garbled.draft(ctxOf())).status).toBe("ok"); // fourth call: not cached
    expect(garbled.llm.calls).toHaveLength(4);

    let allowed = false;
    const capped = setup([OK_REPLY], { takeUsage: async () => (allowed ? { allowed: true } : { allowed: false, reason: "session_cap" }) });
    await capped.draft(ctxOf());
    allowed = true;
    expect((await capped.draft(ctxOf())).status).toBe("ok");
  });

  it("does not cache a campaign drafted while an evidence section was degraded or failed", async () => {
    const { draft, llm } = setup();
    const partial = { ...SECTIONS, where: { status: "error", data: null, provenance: [], note: "x" } } as CampaignContext["sections"];
    await draft(ctxOf({ sections: partial }));
    await draft(ctxOf({ sections: partial }));
    expect(llm.calls).toHaveLength(2);
    // ...and it does not poison the cache for the complete bundle either.
    await draft(ctxOf());
    await draft(ctxOf());
    expect(llm.calls).toHaveLength(3);
  });

  it("falls back to the tmdb key when there is no Qloo entity, so titles never share a cache slot", async () => {
    const { draft, llm } = setup();
    const noEntity = (id: number) => ctxOf({ header: { ...header, tmdbId: id, qlooEntityId: null } });
    await draft(noEntity(1));
    await draft(noEntity(2));
    expect(llm.calls).toHaveLength(2);
    await draft(noEntity(1));
    expect(llm.calls).toHaveLength(2);
  });
});

describe("makeDraftCampaign in-flight de-duplication", () => {
  const deferred = <T>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  /** An LLM that answers only when the test releases it. */
  function gatedLlm() {
    const gates: ReturnType<typeof deferred<string>>[] = [];
    const llm: LlmClient = { chat: () => { const g = deferred<string>(); gates.push(g); return g.promise.then((content) => ({ role: "assistant" as const, content })); } };
    return { llm, gates };
  }

  it("two overlapping identical briefs share one draft and take one usage slot", async () => {
    const { llm, gates } = gatedLlm();
    const takeUsage = vi.fn(async (_s: string) => ({ allowed: true }) as const);
    const draft = makeDraftCampaign({ llm, model: "m-1", takeUsage });
    const a = draft(ctxOf({ session: "s-a" }));
    const b = draft(ctxOf({ session: "s-b" }));
    await flush();
    expect(gates).toHaveLength(1);
    gates[0].resolve(OK_REPLY);
    const [sa, sb] = await Promise.all([a, b]);
    expect(sa.status).toBe("ok");
    expect(sb).toBe(sa);
    expect(gates).toHaveLength(1);
    expect(takeUsage).toHaveBeenCalledTimes(1);
  });

  it("after it finishes, the next identical call is a cache hit (and the entry is gone from the in-flight map)", async () => {
    const inflight = new Map<string, Promise<EvidenceSection<unknown>>>();
    const { llm, gates } = gatedLlm();
    const draft = makeDraftCampaign({ llm, model: "m-1", takeUsage: async () => ({ allowed: true }), inflight });
    const a = draft(ctxOf());
    await flush();
    expect(inflight.size).toBe(1);
    gates[0].resolve(OK_REPLY);
    await a;
    expect(inflight.size).toBe(0);
    await draft(ctxOf());
    expect(gates).toHaveLength(1);
  });

  it("a rejection reaches every waiter and clears the entry, so the next call tries again", async () => {
    const inflight = new Map<string, Promise<EvidenceSection<unknown>>>();
    const gate = deferred<{ allowed: true }>();
    let calls = 0;
    const takeUsage = vi.fn(async (_s: string) => { calls++; if (calls === 1) return gate.promise; return { allowed: true } as const; });
    const draft = makeDraftCampaign({ llm: fakeLlm([OK_REPLY]), model: "m-1", takeUsage, inflight });
    const a = draft(ctxOf());
    const b = draft(ctxOf());
    const settled = Promise.allSettled([a, b]);
    gate.reject(new Error("db down"));
    const [ra, rb] = await settled;
    expect(ra.status).toBe("rejected");
    expect(rb.status).toBe("rejected");
    expect(takeUsage).toHaveBeenCalledTimes(1);
    expect(inflight.size).toBe(0);
    expect((await draft(ctxOf())).status).toBe("ok");
    expect(takeUsage).toHaveBeenCalledTimes(2);
  });

  it("different keys do not share a draft", async () => {
    const { llm, gates } = gatedLlm();
    const takeUsage = vi.fn(async (_s: string) => ({ allowed: true }) as const);
    const draft = makeDraftCampaign({ llm, model: "m-1", takeUsage });
    const a = draft(ctxOf());
    const b = draft(ctxOf({ businessType: "d2c_food" }));
    const c = draft(ctxOf({ header: { ...header, city: "mumbai", cityName: "Mumbai" } }));
    await flush();
    expect(gates).toHaveLength(3);
    gates.forEach((g) => g.resolve(OK_REPLY));
    await Promise.all([a, b, c]);
    expect(takeUsage).toHaveBeenCalledTimes(3);
  });

  it("a shared cap refusal is shared too and is not cached", async () => {
    const { llm, gates } = gatedLlm();
    const takeUsage = vi.fn(async (_s: string) => ({ allowed: false, reason: "session_cap" }) as const);
    const draft = makeDraftCampaign({ llm, model: "m-1", takeUsage });
    const [a, b] = await Promise.all([draft(ctxOf()), draft(ctxOf())]);
    expect(a.note).toBe(NOTES.cap);
    expect(b).toBe(a);
    expect(takeUsage).toHaveBeenCalledTimes(1);
    expect(gates).toHaveLength(0);
  });
});

describe("makeDraftCampaign LlmError mapping", () => {
  const cases: [LlmError["kind"], RegExp][] = [
    ["rate_limited", /busy/i],
    ["unavailable", /unavailable/i],
  ];
  it.each(cases)("%s becomes a degraded section with a fixed sentence, never the raw error", async (kind, re) => {
    const { draft } = setup([new LlmError(kind, "RAW-UPSTREAM-DETAIL sk-secret")]);
    const s = await draft(ctxOf());
    expect(s).toMatchObject({ status: "degraded", data: null, provenance: [] });
    expect(s.note).toMatch(re);
    expect(s.note).toContain("the evidence above is unaffected");
    expect(JSON.stringify(s)).not.toMatch(/RAW-UPSTREAM|sk-secret/);
  });

  it("bad_response is retried inside the draft, so three of them give the placeholder draft, not an error", async () => {
    const { draft, llm } = setup([new LlmError("bad_response", "RAW-UPSTREAM-DETAIL")]);
    const s = await draft(ctxOf());
    expect(llm.calls).toHaveLength(3);
    expect(s.status).toBe("degraded");
    expect((s.data as Campaign).ideas[0].title).toBe("Campaign draft unavailable");
    expect(JSON.stringify(s)).not.toContain("RAW-UPSTREAM");
  });

  it("reports the real cause through onError", async () => {
    const onError = vi.fn();
    const { draft } = setup([new LlmError("rate_limited", "Groq HTTP 429")], { onError });
    await draft(ctxOf());
    expect(onError).toHaveBeenCalledWith("campaign writer", expect.objectContaining({ kind: "rate_limited" }));
  });
});

describe("brief integration", () => {
  const delhi = getCity("delhi")!;
  const collect = async (gen: AsyncGenerator<BriefEvent>) => { const out: BriefEvent[] = []; for await (const e of gen) out.push(e); return out; };

  /** Replies with a campaign citing whichever ids the prompt's DATA block holds. */
  const echoLlm = (): FakeLlm => fakeLlm([(messages) => {
    const user = String(messages[1].content);
    const block = user.slice(user.indexOf("<DATA>") + 6, user.indexOf("</DATA>"));
    const ids = (JSON.parse(block) as { evidence: { id: string }[] }).evidence.map((f) => f.id);
    return campaignJson(ids.slice(0, 2));
  }]);

  it("produces the campaign section from the sections the brief collected, and changes nothing else", async () => {
    const llm = echoLlm();
    const real = fixtureDeps({ draftCampaign: makeDraftCampaign({ llm, model: "m-1", takeUsage: async () => ({ allowed: true }) }) });
    const stub = fixtureDeps();
    const withLlm = await collect(streamBrief(real, { city: delhi, businessType: "cafe", key: { tmdbId: 1, mediaType: "movie" }, session: "s" }));
    const withStub = await collect(streamBrief(stub, { city: delhi, businessType: "cafe", key: { tmdbId: 1, mediaType: "movie" } }));

    const notCampaign = (e: BriefEvent) => !(e.type === "section" && e.key === "campaign");
    expect(withLlm.filter(notCampaign)).toEqual(withStub.filter(notCampaign));

    const ev = withLlm.find((e) => e.type === "section" && e.key === "campaign") as Extract<BriefEvent, { type: "section" }>;
    expect(ev.section.status).toBe("ok");
    const campaign = ev.section.data as Campaign;
    expect(campaign.ideas.map((i) => i.kind)).toEqual(["special", "social", "event"]);
    const cited = campaign.ideas.flatMap((i) => i.clauses.flatMap((c) => c.evidence));
    expect(cited.length).toBeGreaterThan(0);
    // Every cited id came from the fixture sections the brief collected.
    const user = String(llm.calls[0][1].content);
    for (const id of cited) expect(user).toContain(`"id":"${id}"`);
    expect(withLlm.at(-2)).toMatchObject({ type: "section", key: "campaign" });
    expect(withLlm.at(-1)).toEqual({ type: "done" });
  });
});

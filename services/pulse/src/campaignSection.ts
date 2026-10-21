// The brief's campaign section: decides whether to draft at all, spends the
// usage budget only when it does, and turns every outcome into an
// EvidenceSection the page can show with an honest note.

import type { Campaign, EvidenceSection } from "../../../shared/types/pulse.js";
import type { CampaignContext, DraftCampaign } from "./brief.js";
import { buildBundle, draftCampaign, isFallback } from "./campaign.js";
import { createTtlCache, type TtlCache } from "./campaignCache.js";
import { LlmError, type LlmClient, type LlmErrorKind } from "./llm/client.js";
import type { CapDecision } from "./usage.js";

export interface CampaignSectionDeps {
  /** Null when there is no GROQ_API_KEY. */
  llm: LlmClient | null;
  model: string;
  /** Takes one slot of the session's and the day's budget. Called once per draft. */
  takeUsage: (session: string) => Promise<CapDecision>;
  /** Drafted sections by (entity, city, business type); one is made if not given. */
  cache?: TtlCache<EvidenceSection<unknown>>;
  now?: () => number;
  onError?: (context: string, err: unknown) => void;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 50;

const NOT_ENOUGH = "Not enough taste data to ground a campaign for this title.";
const NOT_CONFIGURED = "The campaign writer isn't configured on this deployment.";
const CAP_HIT = "Daily AI limit reached — the evidence above is unaffected.";
const NO_DRAFT = "The writer didn't return a usable draft this time — try again in a moment. The evidence above is unaffected.";
const ERROR_NOTES: Record<LlmErrorKind, string> = {
  rate_limited: "The AI writer is busy right now — the evidence above is unaffected. Try again in a minute.",
  unavailable: "The AI writer is unavailable right now — the evidence above is unaffected.",
  bad_response: "The AI writer returned something unusable — the evidence above is unaffected.",
};
const WRITER_LIMITS = "Drafted by an AI model from the evidence listed above; every cited claim links to that evidence, uncited clauses are the model's own suggestions.";

const withoutData = (status: "empty" | "degraded", note: string): EvidenceSection<unknown> => ({ status, data: null, provenance: [], note });

/** A campaign drafted while an evidence section had failed or was a stopgap
 *  describes a partial picture, so it is not kept for an hour. */
const isComplete = (ctx: CampaignContext) => Object.values(ctx.sections).every((s) => s && s.status !== "error" && s.status !== "degraded");

/** In order: no facts means nothing to ground a campaign in, so no LLM call
 *  (a "Qloo-grounded" campaign with no Qloo evidence would be dishonest); no
 *  key; the cache; the usage cap (taken once per draft, not per validation
 *  retry); then the draft. A provider failure becomes a fixed human sentence,
 *  never the provider's text. Anything else (a usage-store failure) throws and
 *  the brief turns it into an error section. */
export function makeDraftCampaign(deps: CampaignSectionDeps): DraftCampaign {
  const cache = deps.cache ?? createTtlCache<EvidenceSection<unknown>>({ ttlMs: CACHE_TTL_MS, max: CACHE_MAX, now: deps.now });

  return async (ctx) => {
    const { header, businessType } = ctx;
    const bundle = buildBundle(ctx.sections, header.cityName, header.title);
    if (bundle.length === 0) return withoutData("empty", NOT_ENOUGH);
    if (!deps.llm) return withoutData("degraded", NOT_CONFIGURED);

    // Without a Qloo entity the key falls back to the TMDB id, so two titles can never share a slot.
    const key = `${header.qlooEntityId ?? `tmdb:${header.mediaType}:${header.tmdbId}`}|${header.city}|${businessType}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const decision = await deps.takeUsage(ctx.session ?? "unknown");
    if (!decision.allowed) return withoutData("degraded", CAP_HIT);

    let campaign: Campaign;
    try {
      campaign = await draftCampaign(deps.llm, bundle, { title: header.title, cityName: header.cityName, businessType, releaseDate: header.releaseDate });
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      try { deps.onError?.("campaign writer", err); } catch { /* a broken logger must not break the brief */ }
      return withoutData("degraded", ERROR_NOTES[err.kind]);
    }

    const provenance = [{ source: "spotlight" as const, call: "campaign_writer", params: { model: deps.model, evidenceFacts: String(bundle.length) }, limits: WRITER_LIMITS }];
    // The placeholder keeps the section from being blank; it is not a result worth keeping.
    if (isFallback(campaign)) return { status: "degraded", data: campaign, provenance, note: NO_DRAFT };
    const section: EvidenceSection<unknown> = { status: "ok", data: campaign, provenance };
    if (isComplete(ctx)) cache.set(key, section);
    return section;
  };
}

// Wire types for Release Pulse. They live in `shared/` because the service
// produces these payloads and the SPA renders them; a single definition keeps
// the two halves from drifting apart.

export type BusinessType = "cafe" | "d2c_food";
export type EvidenceStatus = "ok" | "empty" | "needs_input" | "partial" | "degraded" | "error";
export type AgeBucket = "24_and_younger" | "25_to_29" | "30_to_34" | "35_to_44" | "45_to_54" | "55_and_older";
export interface Provenance { source: "qloo" | "wikipedia" | "wikidata" | "spotlight"; call: string; params: Record<string, string>; limits: string; }
export interface EvidenceSection<T> { status: EvidenceStatus; data: T | null; provenance: Provenance[]; note?: string; }
export interface DemographicsData { age: Record<AgeBucket, number>; gender: { male: number; female: number }; }
export interface HeatCell { lat: number; lon: number; geohash: string; affinity: number; popularity: number; neighbourhood: string | null; }
export interface Venue { entityId: string; name: string; address: string | null; lat: number | null; lon: number | null; priceLevel: number | null; tags: string[]; affinity: number | null; }
export interface TagAffinity { tagId: string; name: string; affinity: number | null; }
export interface NamedEntity { entityId: string; name: string; affinity: number | null; }
export interface LocalHook { kind: "filmed" | "set"; placeName: string; landmark: string | null; source: "wikidata" | "wikipedia" | "both"; }
export interface CampaignClause { text: string; evidence: string[]; } // [] means "Agent suggestion"
export interface CampaignIdea { kind: "special" | "social" | "event"; title: string; timing: string; clauses: CampaignClause[]; }
export interface Campaign { ideas: CampaignIdea[]; groundedBy: "qloo" | "none"; }
export type BriefSectionKey = "who" | "where" | "venues" | "themes" | "artists" | "brands" | "hook" | "trend" | "campaign";
export interface BriefHeader { tmdbId: number; mediaType: "movie" | "tv"; title: string; posterUrl: string | null; releaseDate: string | null; city: string; cityName: string; businessType: BusinessType; qlooEntityId: string | null; }
export type BriefEvent = { type: "header"; header: BriefHeader } | { type: "section"; key: BriefSectionKey; section: EvidenceSection<unknown> } | { type: "done" };
export interface BoardCard { tmdbId: number; mediaType: "movie" | "tv"; title: string; posterUrl: string | null; releaseDate: string; platform: string | null; kind: string; score: number | null; why: string | null; localRank?: number; rankTotal?: number; }
export interface BoardResponse { city: string; cityName: string; businessType: BusinessType; ranked: BoardCard[]; pending: BoardCard[]; unresolved: BoardCard[]; noSignal?: BoardCard[]; rankingBasis?: "qloo_shortlist" | "release_order"; rankingPending?: boolean; rankingCoverage?: { mediaType: "movie" | "tv"; candidates: number; returned: number; comparable: boolean }[]; }
export type AgentEvent = { type: "tool"; name: string; args: string } | { type: "tool_result"; name: string; summary: string } | { type: "message"; text: string } | { type: "error"; text: string } | { type: "done" };
/** One row of GET /title-locations: a launch city a title was filmed or set in. */
export interface TitleLocationEntry { city_slug: string; cityName: string; kind: "filmed" | "set"; landmark_label: string | null; source: "wikidata" | "wikipedia" | "both"; }
/** GET /plan-night: city-filtered venue recommendations and global artists for a title signal. */
export interface PlanNightResponse { title: string | null; cityName: string; places: EvidenceSection<Venue[]>; artists: EvidenceSection<NamedEntity[]>; }

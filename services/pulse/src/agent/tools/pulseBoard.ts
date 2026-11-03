import { buildBoard } from "../../board.js";
import { cleanText } from "../../campaign.js";
import { businessTypeArg, businessTypeSchema, cityArg, citySchema } from "./args.js";
import type { AgentTool, AgentToolDeps } from "./types.js";

/** Top of the board shown to the model; a result is re-sent on every later round, so it is kept small (free-tier token budget). */
const TOP = 5;
const WHY_MAX = 200;
const TITLE_MAX = 80;

export function pulseBoardTool(deps: AgentToolDeps): AgentTool {
  return {
    spec: {
      type: "function",
      function: {
        name: "pulse_board",
        description: "Read this week's releases, ordered within separate film and TV shortlists by Qloo's city signal. Returns up to 5 with within-type ranks and reasons; no demand scores. If local ranking is unavailable, returns explicit release order. Pending means still loading.",
        parameters: { type: "object", properties: { city: citySchema(), business_type: businessTypeSchema() }, required: ["city", "business_type"], additionalProperties: false },
      },
    },
    async run(args) {
      const city = cityArg(args.city);
      if (!city.ok) return city.error;
      const type = businessTypeArg(args.business_type);
      if (!type.ok) return type.error;

      // The same read the board page polls: cache only, and titles that still
      // need a look are queued for the background warmer, not fetched here.
      const board = await buildBoard({ sql: deps.sql, enqueueWarm: deps.enqueueWarm, enqueueRank: deps.enqueueRank, onError: deps.onError }, city.city, type.businessType, deps.now?.());
      const pending = board.pending.length;
      const unresolved = board.unresolved.length;
      const rankedCount=board.ranked.filter(card=>card.localRank!==undefined).length;
      const notes = [
        board.ranked.length === 0
          ? "No release is ranked yet for this city and business type."
          : board.rankingBasis === "qloo_shortlist" ? "Qloo ranks films and TV in separate fixed shortlists. Ranks are not comparable across types or cities, and do not predict attendance." : "Release order only: no comparable Qloo local ranking is available.",
        "Pending means still loading, so no rank yet; say that, never guess a rank.",
        ...(unresolved > 0 ? [`${unresolved} not found in Qloo, left out.`] : []),
      ];
      return {
        summary: `${rankedCount} Qloo-ranked, ${board.ranked.length} displayed and ${pending} pending for ${board.cityName} (${type.businessType}).`,
        city: board.city,
        cityName: board.cityName,
        businessType: board.businessType,
        ranked: board.ranked.slice(0, TOP).map((c) => ({
          title: cleanText(c.title, TITLE_MAX),
          tmdbId: c.tmdbId,
          mediaType: c.mediaType,
          releaseDate: c.releaseDate,
          platform: c.platform === null ? null : cleanText(c.platform, 40),
          localRank: c.localRank,
          rankTotal: c.rankTotal,
          why: c.why === null ? null : cleanText(c.why, WHY_MAX),
        })),
        rankedCount,
        displayedCount: board.ranked.length,
        rankingCoverage:board.rankingCoverage,
        pendingCount: pending,
        pendingTitles: board.pending.slice(0, 3).map((c) => cleanText(c.title, 50)),
        unresolvedCount: unresolved,
        noSignalCount: board.noSignal?.length ?? 0,
        rankingBasis: board.rankingBasis,
        note: notes.join(" "),
      };
    },
  };
}

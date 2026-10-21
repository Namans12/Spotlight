import { buildBoard } from "../../board.js";
import { cleanText } from "../../campaign.js";
import { businessTypeArg, businessTypeSchema, cityArg, citySchema } from "./args.js";
import type { AgentTool, AgentToolDeps } from "./types.js";

const TOP = 8;
const WHY_MAX = 240;

export function pulseBoardTool(deps: AgentToolDeps): AgentTool {
  return {
    spec: {
      type: "function",
      function: {
        name: "pulse_board",
        description: "Rank this week's film and TV releases for one city and business type by how closely each release's audience lines up with the city, from Qloo evidence Spotlight has already cached. Returns the top 8 with a score and a one-line reason. Releases still being loaded are counted as pending.",
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
      const board = await buildBoard({ sql: deps.sql, enqueueWarm: deps.enqueueWarm, onError: deps.onError }, city.city, type.businessType, deps.now?.());
      const pending = board.pending.length;
      const unresolved = board.unresolved.length;
      const notes = [
        board.ranked.length === 0
          ? "No release is ranked yet for this city and business type."
          : `Ranked by how closely each release's audience lines up with ${board.cityName} (the score is relative, not a probability).`,
        "Pending means a release's data is still loading, so it has no rank yet; say that, and do not guess where it would rank.",
        ...(unresolved > 0 ? [`${unresolved} release(s) could not be found in Qloo and are left out.`] : []),
      ];
      return {
        summary: `${board.ranked.length} ranked and ${pending} pending for ${board.cityName} (${type.businessType}).`,
        city: board.city,
        cityName: board.cityName,
        businessType: board.businessType,
        ranked: board.ranked.slice(0, TOP).map((c) => ({
          title: cleanText(c.title, 100),
          tmdbId: c.tmdbId,
          mediaType: c.mediaType,
          releaseDate: c.releaseDate,
          platform: c.platform === null ? null : cleanText(c.platform, 40),
          score: c.score,
          why: c.why === null ? null : cleanText(c.why, WHY_MAX),
        })),
        rankedCount: board.ranked.length,
        pendingCount: pending,
        pendingTitles: board.pending.slice(0, 5).map((c) => cleanText(c.title, 100)),
        unresolvedCount: unresolved,
        note: notes.join(" "),
      };
    },
  };
}

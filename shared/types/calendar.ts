/** How a title is reaching its audience. `tv_network` is a linear-TV premiere
 * (HGTV, AMC, PBS) — neither a cinema release nor an OTT drop, and the case the
 * old boolean-only model got wrong for 154 of 267 shows. */
export type CalendarKind = "streaming" | "tv_network" | "theatrical" | "global_premiere" | "unknown";

export interface CalendarEntryDTO {
  releaseDate: string; // YYYY-MM-DD
  title: string;
  language: string | null;
  mediaType: "movie" | "tv" | null;
  kind: CalendarKind;
  /** Retained as a convenience alias for `kind === "theatrical"`. */
  isTheatrical: boolean;
  platform: string | null;
  /** All named providers or distributors; platform is the first for older clients. */
  platforms: string[];
  /** Event region, or null when its source does not establish one. */
  region: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  /** Further observations merged into this same verified event. */
  additionalSources?: { source: string | null; sourceUrl: string | null; observedAt: string | null }[];
  observedAt?: string | null;
  availabilityTypes?: Record<string, string[]> | null;
  evidenceStatus?: "regional" | "global" | "unverified";
  reviewFreshness?: "fresh" | "stale" | "unknown" | null;
  seasonPremiere?: { season: number; coverage: string; source: string; sourceUrl: string; checkedAt: string } | null;
  dateCorroboration?: { message: string; source: string; sourceUrl: string; checkedAt: string } | null;
  /** Other independent reviews of the same identified event. */
  additionalCorroborations?: { message: string; source: string; sourceUrl: string; checkedAt: string }[];
  dateConflict?: { message: string; source: string; sourceUrl: string; checkedAt: string } | null;
  tmdbId: number | null;
  posterUrl: string | null;
  rating: number | null;
  overview: string | null;
  origin: "tmdb" | "csv_seed";
  /** ISO 3166-1 country the release date belongs to when it differs from
   * `releaseDate` — a foreign film's home-market date, shown as "(US: 13 Aug)"
   * alongside the India date. Null whenever there is nothing extra to say:
   * regional Indian cinema releases day-and-date in India, and a title with
   * no known India date at all just shows its one known date with no bracket. */
  originRegion: string | null;
  originReleaseDate: string | null; // YYYY-MM-DD
}

import platformData from "./platforms.json" with { type: "json" };

const ALIASES: Record<string, string> = platformData.aliases;

// Longest-first so " Amazon Channel" is stripped before the shorter " Channel"
// would chop it into a half-name.
const STRIP_SUFFIXES: string[] = [...platformData.stripSuffixes].sort((a, b) => b.length - a.length);

/**
 * Collapses TMDB's several spellings of the same service into one canonical
 * name ("Amazon Prime Video with Ads" / "Prime Video" -> "Amazon Prime").
 * Unknown services pass through trimmed rather than being dropped, so a new
 * platform still shows up in the UI instead of silently vanishing.
 */
export function normalizePlatform(raw: string): string {
  let name = (raw || "").trim();
  if (!name) return "";

  // A service can carry more than one suffix ("... with Ads Amazon Channel").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of STRIP_SUFFIXES) {
      if (name.toLowerCase().endsWith(suffix.toLowerCase())) {
        name = name.slice(0, -suffix.length).trim();
        changed = true;
        break;
      }
    }
  }

  return ALIASES[name.toLowerCase()] ?? name;
}

const TV_NETWORKS = new Set<string>(platformData.tvNetworks.map((n) => n.toLowerCase()));

/** Distinct canonical services (values of the alias table), for streamer detection. */
const KNOWN_STREAMERS = new Set<string>(Object.values(ALIASES).map((n) => n.toLowerCase()));

/** Networks worth showing as a last-resort "where to watch" answer when a
 * title has no watch/providers listing anywhere yet — see resolveProviders
 * in lib/tmdbProxy.ts. Canonical-cased (not lowercased) since callers compare
 * against already-normalized platform names. */
export const STREAMING_NETWORKS = new Set<string>(platformData.streamingNetworks);

export type PlatformKind = "streaming" | "tv_network" | "theatrical";

/**
 * Splits the calendar CSV's multi-valued distributor column. It mixes two
 * separators — " / " on the Wikipedia/Deadline rows and ", " on the Hindi rows.
 */
export function splitPlatformField(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[/,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Whether a name maps to a known streaming service, rather than a distributor. */
export function isKnownStreamer(name: string): boolean {
  return KNOWN_STREAMERS.has(normalizePlatform(name).toLowerCase());
}

/**
 * Classifies a calendar row as a cinema release, a linear-TV premiere, or an
 * OTT drop.
 *
 * Parts are compared whole, never as substrings: the previous heuristic tested
 * `"max" in platform` and so read Miramax as HBO Max, Mahaveer Jain Films as
 * aha, and Constantin Film as Stan. It also had no TV-network list, which left
 * 154 of 267 shows (HGTV, TLC, HBO, Bravo, PBS…) labelled "Theatrical".
 */
export function classifyPlatform(entryType: string | null | undefined, platformField: string | null | undefined): PlatformKind {
  const parts = splitPlatformField(platformField);

  for (const part of parts) {
    if (KNOWN_STREAMERS.has(normalizePlatform(part).toLowerCase())) return "streaming";
  }
  for (const part of parts) {
    if (TV_NETWORKS.has(part.toLowerCase())) return "tv_network";
  }

  // Unrecognised distributor: a Show is a TV premiere, a Movie is a cinema release.
  return (entryType ?? "").trim().toLowerCase() === "show" ? "tv_network" : "theatrical";
}

/** Maps the CSV's `Movie`/`Show` to the app's `movie`/`tv` media type. */
export function mediaTypeFromEntryType(entryType: string | null | undefined): "movie" | "tv" | null {
  const value = (entryType ?? "").trim().toLowerCase();
  if (value === "movie") return "movie";
  if (value === "show") return "tv";
  return null;
}

const SEASON_SUFFIX = /\s+(?:season\s+\d+|s\d{1,2}|part\s+\d+|chapter\s+\d+)\s*$/i;

/**
 * Dedupe key for matching a CSV row against a TMDB row. Strips season/part
 * suffixes ("Undekhi Season 3" vs TMDB's "Undekhi") and folds the curly
 * apostrophes the scraped titles use, which previously defeated exact matching.
 */
export function calendarTitleKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .trim()
    .replace(SEASON_SUFFIX, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalizes a provider list, dropping blanks and duplicates while keeping order. */
export function normalizePlatforms(raw: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw ?? []) {
    const name = normalizePlatform(entry);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

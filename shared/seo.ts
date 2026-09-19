// Page metadata: one definition, used by both halves of the site.
//
// Every page shipped the same `<title>Spotlight</title>` and the same
// description. That is not a cosmetic problem. "<franchise> watch order" is a
// high-intent evergreen search, this app has a programmatic answer for it, and
// a search engine had no way to tell one of those pages from another — nor did
// anyone pasting a link into WhatsApp, which rendered a blank grey card.
//
// The strings live here, away from both consumers, because they are used
// twice and must not drift: scripts/prerender.ts bakes them into static HTML
// at build time (what a crawler reads), and src/hooks/useDocumentMeta.ts
// applies them on client-side navigation (what a share button reads once the
// app has taken over). If those two disagreed, the page a crawler indexed
// would not be the page a reader shares.

export interface ChainEntry {
  title: string;
  releaseDate: string | null;
  mediaType: "movie" | "tv";
  tmdbId: number;
}

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute. Both the canonical link and the og:url. */
  canonical: string;
  ogType: "website" | "video.movie" | "video.tv_show";
  image: string | null;
  /** schema.org payload, already an object. Serialised by the consumer. */
  jsonLd: Record<string, unknown> | null;
}

/** Search engines truncate a description around 155-160 characters. Cut on a
 *  word boundary rather than mid-word, and only when there is something to
 *  cut — an ellipsis on a description that already fit reads as broken. */
export function clampDescription(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

function year(date: string | null): string | null {
  if (!date || date.length < 4) return null;
  return /^\d{4}$/.test(date.slice(0, 4)) ? date.slice(0, 4) : null;
}

/** "A, B and C" — reads as a sentence, which is what a description is. */
function sentenceList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function absoluteUrl(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The watch-order page — the one this whole change exists for.
 *
 * Titled for the query people actually type ("John Wick watch order") rather
 * than for the app's own navigation label, and the count goes in the title
 * because "all 4 films in order" is the thing a searcher is scanning for.
 */
export function watchOrderMeta(
  origin: { title: string; mediaType: "movie" | "tv"; tmdbId: number; posterUrl?: string | null },
  chain: ChainEntry[],
  siteUrl: string,
): PageMeta {
  const path = `/title/${origin.mediaType}/${origin.tmdbId}/connections`;
  const canonical = absoluteUrl(siteUrl, path);
  const count = chain.length;

  // A franchise chain can mix films and series — the MCU's runs through The
  // Falcon and the Winter Soldier — so the noun is taken from the chain, not
  // from the title being viewed. Calling that "9 films" is simply false, and
  // it is the kind of false a reader notices immediately.
  const hasMovie = chain.some((c) => c.mediaType === "movie");
  const hasTv = chain.some((c) => c.mediaType === "tv");
  const noun = hasMovie && hasTv ? "titles" : hasTv ? "series" : "films";

  const title =
    count > 1
      ? `${origin.title} watch order — all ${count} ${noun} in order | Spotlight`
      : `${origin.title} — watch order | Spotlight`;

  // Front-loaded with the title, because a search engine shows roughly the
  // first 155 characters and the reader is scanning for the name they typed.
  // Naming the first few entries answers the query before the click.
  const named = sentenceList(chain.slice(0, 4).map((c) => c.title));
  const rest = count > 4 ? `, and ${count - 4} more` : "";
  const description = clampDescription(
    count > 1
      ? `${origin.title} in order: ${named}${rest}. The full watch order, with where to stream each one in India.`
      : `Where ${origin.title} sits in its series, and what to watch first.`,
  );

  return {
    title,
    description,
    canonical,
    ogType: origin.mediaType === "tv" ? "video.tv_show" : "video.movie",
    image: origin.posterUrl ?? null,
    // ItemList is the schema Google uses for ordered "how to watch in order"
    // results, and it is the one that can earn a numbered rich result.
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `${origin.title} watch order`,
      description,
      numberOfItems: count,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: chain.map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": entry.mediaType === "tv" ? "TVSeries" : "Movie",
          name: entry.title,
          ...(year(entry.releaseDate) ? { datePublished: year(entry.releaseDate) } : {}),
          url: absoluteUrl(siteUrl, `/title/${entry.mediaType}/${entry.tmdbId}`),
        },
      })),
    },
  };
}

/** A title's own page. */
export function titleDetailMeta(
  title: {
    title: string;
    mediaType: "movie" | "tv";
    tmdbId: number;
    releaseDate: string | null;
    overview?: string | null;
    posterUrl?: string | null;
    chainCount?: number;
  },
  siteUrl: string,
): PageMeta {
  const path = `/title/${title.mediaType}/${title.tmdbId}`;
  const y = year(title.releaseDate);
  const kind = title.mediaType === "tv" ? "series" : "film";

  const chainNote =
    title.chainCount && title.chainCount > 1 ? ` One of ${title.chainCount} — see the full watch order.` : "";

  return {
    title: `${title.title}${y ? ` (${y})` : ""} — where to watch | Spotlight`,
    description: clampDescription(
      title.overview?.trim()
        ? `${title.overview}`
        : `Where to stream ${title.title}${y ? ` (${y})` : ""} in India, its rating, and what to watch alongside this ${kind}.${chainNote}`,
    ),
    canonical: absoluteUrl(siteUrl, path),
    ogType: title.mediaType === "tv" ? "video.tv_show" : "video.movie",
    image: title.posterUrl ?? null,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": title.mediaType === "tv" ? "TVSeries" : "Movie",
      name: title.title,
      ...(y ? { datePublished: y } : {}),
      ...(title.overview ? { description: clampDescription(title.overview, 300) } : {}),
      ...(title.posterUrl ? { image: title.posterUrl } : {}),
      url: absoluteUrl(siteUrl, path),
    },
  };
}

/**
 * A cast or crew member's page.
 *
 * Not prerendered — there are hundreds of thousands of them and no evergreen
 * query behind most — so this exists purely for the client-side title and for
 * the card someone gets when they paste the link into a chat. `Person` schema
 * with a `knowsAbout`-free shape: naming the work would mean asserting a
 * relationship TMDB models loosely (a one-episode guest credit and a lead are
 * the same row), and a wrong structured claim is worse than none.
 */
export function personMeta(
  person: { id: number; name: string; knownFor?: string | null; profilePath?: string | null; credits?: { title: string }[] },
  siteUrl: string,
): PageMeta {
  const path = `/person/${person.id}`;
  const known = (person.credits ?? []).slice(0, 3).map((c) => c.title);
  const role = person.knownFor ? person.knownFor.toLowerCase() : null;

  return {
    title: `${person.name} — films and series | Spotlight`,
    description: clampDescription(
      known.length > 0
        ? `Everything ${person.name} has ${role === 'acting' ? 'appeared in' : 'worked on'}, including ${sentenceList(known)} — with where to stream each one in India.`
        : `Films and series featuring ${person.name}, and where to stream them in India.`,
    ),
    canonical: absoluteUrl(siteUrl, path),
    ogType: "website",
    image: person.profilePath ? `https://image.tmdb.org/t/p/w500${person.profilePath}` : null,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Person",
      name: person.name,
      url: absoluteUrl(siteUrl, path),
      ...(person.knownFor ? { jobTitle: person.knownFor } : {}),
    },
  };
}

/** The handful of fixed routes. Keyed by path so both consumers agree on
 *  which pages exist and what each one claims to be. */
export const STATIC_ROUTE_META: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Spotlight — new OTT releases in India, and what's worth watching",
    description:
      "What just landed on Netflix, Prime Video, JioHotstar and more in India, updated twice a week. Plus watch orders, a release calendar, and your own watchlist.",
  },
  "/browse": {
    title: "Browse trending films and series | Spotlight",
    description: "Trending and popular films and series right now, with where to stream each one in India.",
  },
  "/calendar": {
    title: "Release calendar — what's coming to cinemas and OTT | Spotlight",
    description:
      "Upcoming theatrical and streaming releases in India, month by month, with platforms and dates.",
  },
  // Personal and behind a login, so the prerendered version carries meta only
  // and never any numbers — see scripts/prerender.ts.
  "/wrapped": {
    title: "Your year in film and TV | Spotlight",
    description:
      "What you saved, what you watched, and how long it took — your year on Spotlight, counted from your own watchlist.",
  },
  "/duel": {
    title: "Can't decide what to watch? Pick one | Spotlight",
    description:
      "Two posters, five rounds, one answer. No questionnaires and no fixed list — the choices come from what's streaming now and what you've saved.",
  },
  "/search": {
    title: "Search films and series | Spotlight",
    description: "Search any film or series to find where to stream it in India, its ratings, and its watch order.",
  },
};

/**
 * Routes that have a title and a description but no business being indexed.
 *
 * They are real pages with real metadata — the tab title and the card someone
 * gets when they paste the link still matter — but what is on them is one
 * account's own data behind a login. A crawler following them finds a sign-in
 * wall, which is a soft-404 in everything but name.
 *
 * Kept here, beside STATIC_ROUTE_META, so the sitemap and robots.txt cannot
 * disagree: listing a URL in the sitemap while disallowing it in robots.txt is
 * a contradiction Search Console reports as an error against the whole site.
 */
export const PRIVATE_ROUTES = new Set(["/wrapped"]);

export function staticRouteMeta(path: string, siteUrl: string): PageMeta | null {
  const entry = STATIC_ROUTE_META[path];
  if (!entry) return null;
  return {
    title: entry.title,
    description: entry.description,
    canonical: absoluteUrl(siteUrl, path),
    ogType: "website",
    image: absoluteUrl(siteUrl, "/spotlight-mark.webp"),
    jsonLd:
      path === "/"
        ? {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "Spotlight",
            url: siteUrl,
            description: entry.description,
          }
        : null,
  };
}

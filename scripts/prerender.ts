/**
 * Post-build step: bake real HTML for the pages worth finding.
 *
 * Spotlight is a client-rendered SPA, so every route served the same
 * `index.html` — one `<title>Spotlight</title>` and one description for the
 * entire site. A crawler fetching a watch-order page got an empty div. That is
 * the whole reason "<franchise> watch order" traffic, which this app has a
 * genuinely good answer for, was unreachable.
 *
 * The fix is prerendering rather than server-side rendering, for two reasons.
 * The deployment already sits at Vercel Hobby's 12-serverless-function cap, so
 * there is no room for a rendering function. And it matches how the rest of
 * this app already works: compute offline, serve static (see the README on the
 * release pipeline). A crawler gets complete HTML with zero JavaScript, a
 * reader gets the same file and the SPA hydrates over it.
 *
 * Vercel checks the filesystem before applying vercel.json's SPA rewrite, so a
 * real file at dist/title/movie/245891/connections/index.html wins, and every
 * other route still falls through to the SPA exactly as before.
 *
 * Fails soft, always. A build must not break because Postgres was briefly
 * unreachable — the site still works, it is just not newly indexable, and the
 * next build picks it up.
 *
 *     npx tsx scripts/prerender.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { getRelations, MAX_DEPTH } from "../lib/relationsDb.js";
import {
  absoluteUrl,
  staticRouteMeta,
  titleDetailMeta,
  watchOrderMeta,
  STATIC_ROUTE_META,
  type ChainEntry,
  type PageMeta,
} from "../shared/seo.js";

const DIST = path.resolve(process.cwd(), "dist");

const NEWLINE_RE = /\r?\n/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const QUOTE_RE = /^["']|["']$/g;

/** Fills unset vars from a repo-root .env, so a local `npm run build`
 *  prerenders the same pages a deploy does. On Vercel the variables are
 *  already in the environment and this finds no file to read. Mirrors
 *  scripts/dev-api-server.mjs and lib_relations.load_local_env. */
async function loadLocalEnv(): Promise<void> {
  try {
    const raw = await fs.readFile(path.resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(NEWLINE_RE)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).trim();
      if (!KEY_RE.test(key) || key in process.env) continue;
      process.env[key] = trimmed.slice(eq + 1).trim().replace(QUOTE_RE, "");
    }
  } catch {
    // No .env is the normal case in CI, where the variables are already set.
  }
}

/** Canonical origin. Vercel exposes the stable production domain here; the
 *  explicit override is for a fork or a custom domain. */
function resolveSiteUrl(): string {
  return (
    process.env.SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "https://spotlighthub.vercel.app"
  ).replace(/\/+$/, "");
}

/** Cap on prerendered titles. Not a performance limit — the whole set is ~150
 *  pages today — but a guard so a runaway relations table cannot turn a build
 *  into a filesystem full of half a million files. */
const MAX_PAGES = 5000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON-LD sits inside a <script> block, so the one sequence that can break
 *  out of it has to go. Escaping the whole payload as HTML would corrupt the
 *  JSON instead. */
function safeJsonLd(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

function metaTags(meta: PageMeta): string {
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
    `<meta property="og:site_name" content="Spotlight" />`,
    `<meta property="og:type" content="${meta.ogType}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`,
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
  ];
  if (meta.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(meta.image)}" />`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(meta.image)}" />`);
  }
  if (meta.jsonLd) {
    tags.push(`<script type="application/ld+json">${safeJsonLd(meta.jsonLd)}</script>`);
  }
  return tags.join("\n    ");
}

/**
 * The content a crawler reads.
 *
 * Rendered inside #root, which React's createRoot clears on mount — so this is
 * what a crawler (and a reader on a slow connection) sees, and it is replaced
 * by the live app the moment JavaScript runs. Deliberately not hidden markup
 * off-screen: content a user can never see is cloaking, and the point here is
 * that the HTML and the rendered page say the same thing.
 */
function crawlableBody(heading: string, intro: string, items: { label: string; href: string }[]): string {
  const list = items
    .map(
      (item, i) =>
        `<li><a href="${escapeHtml(item.href)}">${i + 1}. ${escapeHtml(item.label)}</a></li>`,
    )
    .join("");
  return (
    `<div><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(intro)}</p>` +
    (list ? `<ol>${list}</ol>` : "") +
    `</div>`
  );
}

function renderPage(template: string, meta: PageMeta, body: string): string {
  // The template's own <title> and description are the site-wide defaults;
  // replacing rather than appending avoids two of each, which search engines
  // resolve unpredictably.
  let html = template
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+name="description"[^>]*>\s*/i, "");
  html = html.replace("</head>", `  ${metaTags(meta)}\n  </head>`);
  html = html.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  return html;
}

async function writePage(routePath: string, html: string): Promise<void> {
  const dir = path.join(DIST, routePath === "/" ? "" : routePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.html"), html, "utf8");
}

interface SitemapEntry {
  loc: string;
  priority: number;
}

function sitemapXml(entries: SitemapEntry[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const urls = entries
    .map(
      (e) =>
        `  <url><loc>${escapeHtml(e.loc)}</loc><lastmod>${today}</lastmod><priority>${e.priority.toFixed(1)}</priority></url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function main(): Promise<number> {
  await loadLocalEnv();
  const SITE_URL = resolveSiteUrl();
  const template = await fs.readFile(path.join(DIST, "index.html"), "utf8");
  const sitemap: SitemapEntry[] = [];

  // The fixed routes need no database and must always be written, so they are
  // done before anything that can fail.
  for (const routePath of Object.keys(STATIC_ROUTE_META)) {
    const meta = staticRouteMeta(routePath, SITE_URL)!;
    // Meta only, no body. dist/index.html is not just the home page — it is
    // also the SPA fallback that vercel.json rewrites every unprerendered
    // route to, so anything placed in its #root flashes on screen before
    // React mounts on EVERY such route. A home-page heading appearing for an
    // instant on /list/watchlist is a real regression, and these four routes
    // have no static content worth indexing anyway: what is on them is the
    // live release data, which is fetched.
    await writePage(routePath, renderPage(template, meta, ""));
    sitemap.push({ loc: meta.canonical, priority: routePath === "/" ? 1.0 : 0.7 });
  }
  console.log(`[prerender] ${Object.keys(STATIC_ROUTE_META).length} static routes`);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn("[prerender] DATABASE_URL is not set — skipping title pages (site still builds)");
    await fs.writeFile(path.join(DIST, "sitemap.xml"), sitemapXml(sitemap), "utf8");
    return 0;
  }

  const sql = postgres(connectionString, { max: 1 });
  let titlePages = 0;
  let orderPages = 0;

  try {
    // Every title that has at least one relation edge pointing out of it. The
    // denormalised columns mean this one query already carries the display
    // fields, so no TMDB call happens during a build.
    const origins = await sql<
      { media_type: "movie" | "tv"; tmdb_id: string; has_chain: boolean }[]
    >`
      SELECT from_media_type AS media_type,
             from_tmdb_id    AS tmdb_id,
             bool_or(kind = 'must') AS has_chain
      FROM title_relations
      WHERE suppressed = false
      GROUP BY from_media_type, from_tmdb_id
      ORDER BY from_media_type, from_tmdb_id
      LIMIT ${MAX_PAGES}
    `;

    for (const row of origins) {
      const key = { mediaType: row.media_type, tmdbId: Number(row.tmdb_id) };
      const relations = await getRelations(sql, key, MAX_DEPTH);
      const origin = relations.origin;
      // Without a reciprocal edge there is no name to put in a title tag, and
      // a page titled "undefined watch order" is worse than no page.
      if (!origin?.title) continue;

      const chain: ChainEntry[] = [
        ...relations.mustWatch.before.map((r) => ({
          title: r.title,
          releaseDate: r.releaseDate,
          mediaType: r.mediaType,
          tmdbId: r.tmdbId,
        })),
        { title: origin.title, releaseDate: origin.releaseDate, mediaType: key.mediaType, tmdbId: key.tmdbId },
        ...relations.mustWatch.after.map((r) => ({
          title: r.title,
          releaseDate: r.releaseDate,
          mediaType: r.mediaType,
          tmdbId: r.tmdbId,
        })),
      ];

      const detail = titleDetailMeta(
        {
          title: origin.title,
          mediaType: key.mediaType,
          tmdbId: key.tmdbId,
          releaseDate: origin.releaseDate,
          posterUrl: origin.posterUrl,
          chainCount: chain.length,
        },
        SITE_URL,
      );
      await writePage(
        `/title/${key.mediaType}/${key.tmdbId}`,
        renderPage(
          template,
          detail,
          crawlableBody(
            origin.title,
            detail.description,
            row.has_chain ? [{ label: `${origin.title} watch order`, href: `/title/${key.mediaType}/${key.tmdbId}/connections` }] : [],
          ),
        ),
      );
      sitemap.push({ loc: detail.canonical, priority: 0.6 });
      titlePages += 1;

      // Only a real chain earns a watch-order page. A title whose only
      // relations are "same series, not required" has no order to publish.
      if (!row.has_chain || chain.length < 2) continue;

      const order = watchOrderMeta(
        { title: origin.title, mediaType: key.mediaType, tmdbId: key.tmdbId, posterUrl: origin.posterUrl },
        chain,
        SITE_URL,
      );
      await writePage(
        `/title/${key.mediaType}/${key.tmdbId}/connections`,
        renderPage(
          template,
          order,
          crawlableBody(
            `${origin.title} watch order`,
            order.description,
            chain.map((entry) => ({
              label: entry.releaseDate ? `${entry.title} (${entry.releaseDate.slice(0, 4)})` : entry.title,
              href: `/title/${entry.mediaType}/${entry.tmdbId}`,
            })),
          ),
        ),
      );
      // The highest-value pages on the site: they answer a question people
      // actually type, and nothing else here does.
      sitemap.push({ loc: order.canonical, priority: 0.9 });
      orderPages += 1;
    }
  } catch (err) {
    // Soft failure by design — see this file's header.
    console.warn("[prerender] database read failed, shipping what was generated:", err instanceof Error ? err.message : err);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }

  await fs.writeFile(path.join(DIST, "sitemap.xml"), sitemapXml(sitemap), "utf8");
  await fs.writeFile(
    path.join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\n\n# Private, per-account, and useless to index.\nDisallow: /list\nDisallow: /login\n\nSitemap: ${absoluteUrl(SITE_URL, "/sitemap.xml")}\n`,
    "utf8",
  );

  console.log(`[prerender] ${titlePages} title pages, ${orderPages} watch-order pages`);
  console.log(`[prerender] sitemap.xml with ${sitemap.length} urls, robots.txt written`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Never fail the build. A site that ships without fresh metadata is a
    // setback; a site that does not ship is an outage.
    console.warn("[prerender] skipped:", err instanceof Error ? err.message : err);
    process.exit(0);
  });

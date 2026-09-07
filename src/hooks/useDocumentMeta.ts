import { useEffect } from 'react';
import type { PageMeta } from '../../shared/seo';

// Keeps <head> honest once the SPA has taken over.
//
// scripts/prerender.ts bakes the correct tags into the HTML a crawler or a
// cold visitor receives. From the moment React mounts, though, navigation is
// client-side: the URL changes and the document does not. So a reader who
// browses to a watch-order page and hits share would post the *previous*
// page's title and description, and the prerendered file would never be
// fetched again to correct it.
//
// Both halves read the same builders in shared/seo.ts, so what a crawler
// indexes and what a share button copies cannot drift apart.

const MANAGED = 'data-managed-meta';

/** Sets, updates or removes one tag, tracking what it created so switching to
 *  a page with fewer tags doesn't leave the previous page's behind. */
function apply(selector: string, create: () => HTMLElement, content: string | null): void {
  const existing = document.head.querySelector<HTMLElement>(selector);
  if (content === null) {
    if (existing?.hasAttribute(MANAGED)) existing.remove();
    return;
  }
  const el = existing ?? create();
  el.setAttribute(MANAGED, '');
  if (el instanceof HTMLMetaElement) el.content = content;
  else if (el instanceof HTMLLinkElement) el.href = content;
  if (!el.isConnected) document.head.appendChild(el);
}

function meta(attr: 'name' | 'property', key: string, content: string | null): void {
  apply(`meta[${attr}="${key}"]`, () => {
    const el = document.createElement('meta');
    el.setAttribute(attr, key);
    return el;
  }, content);
}

/**
 * Applies a page's metadata for as long as the component is mounted.
 *
 * `null` is the loading state and deliberately leaves the document alone —
 * on a prerendered page the correct tags are already in the HTML, and
 * blanking them while data loads would replace a good title with a worse one
 * for anyone who shares mid-load.
 */
export function useDocumentMeta(pageMeta: PageMeta | null): void {
  useEffect(() => {
    if (!pageMeta) return;

    document.title = pageMeta.title;
    meta('name', 'description', pageMeta.description);
    meta('property', 'og:title', pageMeta.title);
    meta('property', 'og:description', pageMeta.description);
    meta('property', 'og:url', pageMeta.canonical);
    meta('property', 'og:type', pageMeta.ogType);
    meta('property', 'og:site_name', 'Spotlight');
    meta('property', 'og:image', pageMeta.image);
    meta('name', 'twitter:card', pageMeta.image ? 'summary_large_image' : 'summary');
    meta('name', 'twitter:title', pageMeta.title);
    meta('name', 'twitter:description', pageMeta.description);
    meta('name', 'twitter:image', pageMeta.image);

    apply('link[rel="canonical"]', () => {
      const el = document.createElement('link');
      el.rel = 'canonical';
      return el;
    }, pageMeta.canonical);

    // JSON-LD is replaced wholesale rather than patched: it is one blob per
    // page and merging two pages' structured data would describe neither.
    document.head.querySelector(`script[type="application/ld+json"][${MANAGED}]`)?.remove();
    if (pageMeta.jsonLd) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.setAttribute(MANAGED, '');
      script.textContent = JSON.stringify(pageMeta.jsonLd);
      document.head.appendChild(script);
    }
  }, [pageMeta]);
}

/** The origin to build absolute canonical/og:url values from. Read from the
 *  live location so a preview deployment describes itself rather than
 *  claiming to be production. */
export function siteUrl(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

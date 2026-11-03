import { useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches, kept current as it changes.
 *
 * `fallback` is the answer where there is no window.matchMedia: server
 * rendering and jsdom, which does not implement it. Unlike useIsMobile (which
 * assumes matchMedia exists), this is safe to call from a component that is
 * rendered in tests that never mock the browser.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      // Some embedded browsers resize without dispatching `change`; see use-mobile.tsx.
      window.addEventListener('resize', onChange);
      return () => {
        mql.removeEventListener('change', onChange);
        window.removeEventListener('resize', onChange);
      };
    },
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}

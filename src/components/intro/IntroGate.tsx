import { useEffect, useState } from "react";
import { IntroScreen } from "./IntroScreen";

const SEEN_KEY = "spotlight:intro-seen";

function hasEnteredThisSession(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

/** Shows the animated intro splash once per browser session, on top of the
 * app (which mounts immediately underneath so data starts loading while
 * the intro plays). */
export function IntroGate({ children }: { children: React.ReactNode }) {
  const [showIntro, setShowIntro] = useState(() => !/^\/pulse(?:\/|$)/.test(window.location.pathname) && !hasEnteredThisSession());

  // The app underneath mounts and loads data while the intro plays, which can
  // make the page taller than the viewport — lock body scroll so that doesn't
  // leak through the fixed intro overlay.
  useEffect(() => {
    if (!showIntro) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [showIntro]);

  function handleEnter() {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private-mode storage restrictions are fine to ignore here */
    }
    setShowIntro(false);
  }

  return (
    <>
      {children}
      {showIntro && <IntroScreen onEnter={handleEnter} />}
    </>
  );
}

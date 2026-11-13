import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { SidebarContext } from './sidebar-context';

const STORAGE_KEY = 'spotlight:sidebar-expanded';

function readStored(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(STORAGE_KEY) !== 'false';
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(readStored);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(expanded));
  }, [expanded]);

  const toggleExpanded = useCallback(() => setExpanded((v) => !v), []);
  const toggle = useCallback(() => {
    if (isMobile) setMobileOpen((v) => !v);
    else setExpanded((v) => !v);
  }, [isMobile]);

  const value = useMemo(
    () => ({ expanded, toggleExpanded, mobileOpen, setMobileOpen, isMobile, toggle }),
    [expanded, toggleExpanded, mobileOpen, isMobile, toggle],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

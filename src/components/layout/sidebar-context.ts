import { createContext, useContext } from 'react';

export interface SidebarState {
  expanded: boolean;
  toggleExpanded: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  isMobile: boolean;
  toggle: () => void;
}

export const SidebarContext = createContext<SidebarState | null>(null);

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used inside <SidebarProvider>');
  return ctx;
}

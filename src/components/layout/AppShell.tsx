import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { SidebarProvider } from './SidebarContext';
import { useSidebar } from './sidebar-context';
import { Topbar } from './Topbar';
import { ToolbarOutlet, ToolbarProvider } from './Toolbar';
import { Footer } from './Footer';

function ShellFrame() {
  const { expanded } = useSidebar();

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      {/* The sidebar is fixed, so the content column is offset by its width and
          animates on the same curve — one moving edge instead of two. The offset
          itself is applied in CSS (.shell-content) because it only applies from
          the md breakpoint up, which an inline style can't express. */}
      <div
        className="shell-content flex min-h-screen flex-col"
        style={{
          ['--shell-offset' as string]: expanded ? 'var(--sidebar-w)' : 'var(--sidebar-w-mini)',
          ['--shell-dur' as string]: expanded ? 'var(--dur-enter)' : 'var(--dur-exit)',
        }}
      >
        {/* Topbar and filter strip stick as one block rather than each pinning
            itself, so the strip can't slide under the topbar on mobile (where
            the topbar grows a second row for the media-type control). */}
        <div className="sticky top-0 z-30">
          <Topbar />
          {/* Self-erasing: no border and no height on pages that portal
              nothing into it. */}
          <ToolbarOutlet className="glass border-b border-border empty:hidden" />
        </div>

        <main className="mx-auto w-full max-w-[80rem] flex-1 px-4 py-6 sm:px-gutter">
          <Outlet />
        </main>

        <Footer />
      </div>
    </div>
  );
}

export function AppShell() {
  return (
    <SidebarProvider>
      <ToolbarProvider>
        <ShellFrame />
      </ToolbarProvider>
    </SidebarProvider>
  );
}

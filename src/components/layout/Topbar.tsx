import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useMatch } from 'react-router-dom';
import { toast } from 'sonner';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SpotlightLogo } from '@/components/brand/SpotlightLogo';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { useAuth } from '@/hooks/useAuth';
import { useMediaScope, type MediaScope } from '@/hooks/useMediaScope';
import { useSidebar } from './SidebarContext';
import { cn } from '@/lib/utils';
import { Film, Tv, LayoutGrid, List, Eye, RefreshCw, LogOut, Bell } from 'lucide-react';

const SCOPE_OPTIONS: { id: MediaScope; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'All', icon: <LayoutGrid size={13} /> },
  { id: 'movie', label: 'Movies', icon: <Film size={13} /> },
  { id: 'tv', label: 'Shows', icon: <Tv size={13} /> },
];

/** Routes where a Movies/Shows split changes what you see. A title page or the
 *  login screen has nothing to scope, so the control is hidden there instead of
 *  sitting inert in the bar. */
function useScopeApplies(): boolean {
  const { pathname } = useLocation();
  const onTitle = useMatch('/title/*');
  if (onTitle) return false;
  return ['/', '/browse', '/calendar', '/search'].includes(pathname) || pathname.startsWith('/list');
}

function UserMenu() {
  const { user, logout, setNotifyWatchlistDrops } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (!user) return null;
  // The shared demo account (lib/usersDb.ts upsertGuestUser) has one address
  // that everyone using it would be emailing.
  const isGuest = user.email === 'guest@spotlight.demo';
  const initial = user.displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        className="flex size-control items-center justify-center overflow-hidden rounded-full bg-accent/20 text-xs font-bold text-accent ring-1 ring-border transition-all hover:ring-accent/40"
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-border bg-popover py-1.5 shadow-xl">
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-xs font-semibold text-foreground">{user.displayName}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
          </div>
          {/* The one setting worth putting behind the avatar rather than on a
              page of its own: it is the only thing here that makes Spotlight
              reach out to you, so it belongs next to the account it applies
              to. Guest accounts are excluded — the demo account is shared, so
              "email me" would mean emailing a shared inbox. */}
          {!isGuest && (
            <label className="flex cursor-pointer items-start gap-2.5 border-b border-border px-3 py-2.5">
              <input
                type="checkbox"
                checked={user.notifyWatchlistDrops}
                disabled={setNotifyWatchlistDrops.isPending}
                onChange={(e) => setNotifyWatchlistDrops.mutate(e.target.checked)}
                className="mt-0.5 size-3.5 shrink-0 cursor-pointer accent-accent disabled:opacity-50"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Bell size={12} className="shrink-0 text-accent" /> Email me on drops
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  When something on your watchlist starts streaming.
                </span>
              </span>
            </label>
          )}

          <button
            onClick={() => {
              setOpen(false);
              logout.mutate();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Live counts for the two buckets people check most. Hidden on narrow screens,
 *  where the sidebar already carries the same numbers as badges. */
function CountPills() {
  const wl = useWatchlistContext();
  return (
    <div className="hidden items-center gap-1.5 lg:flex">
      <NavLink
        to="/list/watchlist"
        className="inline-flex h-chip items-center gap-1 rounded-md bg-accent/10 px-2 text-[11px] font-semibold leading-none text-accent transition-colors hover:bg-accent/20"
      >
        <List size={11} className="shrink-0" /> {wl.watchlist.length}
      </NavLink>
      <NavLink
        to="/list/watched"
        className="inline-flex h-chip items-center gap-1 rounded-md bg-watched/10 px-2 text-[11px] font-semibold leading-none text-watched transition-colors hover:bg-watched/20"
      >
        <Eye size={11} className="shrink-0" /> {wl.watched.length}
      </NavLink>
    </div>
  );
}

export function Topbar() {
  const { isAuthenticated } = useAuth();
  const { toggle, expanded, isMobile, mobileOpen } = useSidebar();
  const [scope, setScope] = useMediaScope();
  const scopeApplies = useScopeApplies();
  const [refreshing, setRefreshing] = useState(false);

  const handleForceRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/releases-refresh', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`);
      toast.success(body.message || 'Refresh queued.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not queue a refresh.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <header className="glass border-b border-border">
      <div className="flex h-topbar items-center gap-3 px-4 sm:px-gutter">
        {/* The wordmark lives in the sidebar on desktop; on mobile the drawer is
            hidden, so the topbar carries it instead — and carries the sidebar's
            one show/hide control too, so there's a single place to learn
            instead of a dedicated toggle button. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={isMobile ? (mobileOpen ? 'Close navigation' : 'Open navigation') : expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          className="flex shrink-0 items-center gap-2 md:hidden"
        >
          <SpotlightLogo size={26} />
          <span className="font-display text-base font-semibold tracking-tight text-foreground">Spotlight</span>
        </button>

        {scopeApplies && (
          <Segmented
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={setScope}
            aria-label="Media type"
            className="hidden sm:flex"
          />
        )}

        <div className="flex-1" />

        <CountPills />

        {isAuthenticated && (
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <button
                onClick={handleForceRefresh}
                disabled={refreshing}
                aria-label="Force refresh release data"
                className="grid size-control shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground transition-all hover:bg-card-hover disabled:opacity-50"
              >
                <RefreshCw size={14} className={cn('shrink-0', refreshing && 'animate-spin')} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh release data</TooltipContent>
          </Tooltip>
        )}

        {isAuthenticated ? (
          <UserMenu />
        ) : (
          <NavLink
            to="/login"
            className="inline-flex h-control shrink-0 items-center rounded-lg bg-accent px-4 text-xs font-semibold leading-none text-accent-foreground transition-all hover:brightness-110"
          >
            Sign in
          </NavLink>
        )}
      </div>

      {/* Mobile keeps the scope control on its own row rather than squeezing it
          next to the wordmark. */}
      {scopeApplies && (
        <div className="border-t border-border px-4 py-2 sm:hidden">
          <Segmented options={SCOPE_OPTIONS} value={scope} onChange={setScope} aria-label="Media type" fill />
        </div>
      )}
    </header>
  );
}

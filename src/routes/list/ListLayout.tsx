import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useWatchlistContext } from '@/contexts/watchlist-context';
import { AddToListDialog } from '@/components/watchlist/AddToListDialog';
import { Toolbar } from '@/components/layout/Toolbar';
import { cn } from '@/lib/utils';
import { Movie } from '@/types/movie';
import { List, Clock, Eye, FolderOpen } from 'lucide-react';

/** Same four destinations as the sidebar's Library group, mirrored here as a
 *  tab row so switching lists doesn't mean travelling to the rail and back. */
const SUB_TABS = [
  { to: '/list/watchlist', label: 'Watchlist', icon: <List size={13} />, key: 'watchlist' as const },
  { to: '/list/later', label: 'Later', icon: <Clock size={13} />, key: 'watchLater' as const },
  { to: '/list/watched', label: 'Watched', icon: <Eye size={13} />, key: 'watched' as const },
  { to: '/list/lists', label: 'Lists', icon: <FolderOpen size={13} />, key: 'customLists' as const },
];

export default function ListLayout() {
  const wl = useWatchlistContext();
  const [addToListMovie, setAddToListMovie] = useState<Movie | null>(null);

  return (
    <div className="space-y-5">
      <Toolbar>
        <div className="flex h-toolbar items-center px-4 sm:px-gutter">
          {/* Routed tabs, so they can't use the button-based Segmented control —
              matched to it by hand: one track, same 36px height, same radii. */}
          <nav className="flex h-control items-center gap-0.5 rounded-lg bg-secondary p-0.5">
            {SUB_TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex h-full items-center gap-1.5 whitespace-nowrap rounded-[calc(var(--radius)-6px)] px-3 text-xs font-semibold leading-none transition-colors duration-200',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {tab.icon}
                <span>{tab.label}</span>
                <span className="tabular-nums opacity-60">{wl[tab.key].length}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </Toolbar>

      <Outlet context={{ setAddToListMovie }} />

      <AddToListDialog
        movie={addToListMovie}
        lists={wl.customLists}
        onAdd={wl.addToCustomList}
        onClose={() => setAddToListMovie(null)}
      />
    </div>
  );
}

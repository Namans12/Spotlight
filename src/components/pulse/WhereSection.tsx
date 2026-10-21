import { Component, Suspense, lazy, type ReactNode } from 'react';
import type { HeatCell } from '../../../shared/types/pulse';
import { Skeleton } from '@/components/ui/skeleton';
import { topNeighbourhoods } from '@/lib/pulseEvidence';

// Leaflet and its stylesheet are heavy and only this section wants them, so the
// map is its own chunk, fetched when a brief first reaches this section.
const HeatMap = lazy(() => import('@/components/pulse/HeatMap'));

// Mirrors HEAT_MAP_HEIGHT in HeatMap.tsx (not imported: that would pull the
// module, and Leaflet, back into this one's chunk).
const MAP_HEIGHT = 'h-72 sm:h-80';

/** Contains a failure in the map (a stale chunk after a deploy, a Leaflet
 *  runtime error) to the map's own box, so the rest of the brief stays up. */
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="status"
        className={`${MAP_HEIGHT} flex items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground`}
      >
        The map couldn’t load — the list below is the same data
      </div>
    );
  }
}

export function WhereSection({ cells, title, cityName }: { cells: HeatCell[]; title: string; cityName: string }) {
  const top = topNeighbourhoods(cells, 3);
  return (
    <div className="space-y-3">
      <MapBoundary>
        <Suspense fallback={<Skeleton role="status" aria-label="Loading map" className={`${MAP_HEIGHT} w-full`} />}>
          <HeatMap cells={cells} title={title} cityName={cityName} />
        </Suspense>
      </MapBoundary>
      {/* The text alternative to the map, and the part that is useful without it. */}
      {top.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Strongest around</p>
          <ol className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-foreground">
            {top.map((h) => (
              <li key={h.name}>{h.name}</li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No cell here has a neighbourhood name yet; the circles are still where fans concentrate.</p>
      )}
      <p className="text-xs text-muted-foreground">Larger circles are stronger relative to the other cells shown, not a count of people.</p>
    </div>
  );
}

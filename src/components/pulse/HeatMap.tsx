/**
 * The heatmap: one circle per Qloo cell on an OpenStreetMap base. This module
 * is only ever reached through React.lazy (see WhereSection), so Leaflet's JS
 * and this CSS import travel in their own chunk instead of the entry bundle.
 */
import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { HeatCell } from '../../../shared/types/pulse';
import { heatRadii } from '@/lib/pulseCharts';

/** Same height as the Suspense fallback, so the page does not shift when the map arrives. */
const HEAT_MAP_HEIGHT = 'h-72 sm:h-80';

/** Fits the view to the cells, and only when the cells themselves change: the
 *  page re-renders on every streamed section, and a fit on each of those would
 *  throw away wherever the reader had panned or zoomed to. The caller passes a
 *  memoised array, so its identity changes only with the data. */
function FitToCells({ cells }: { cells: HeatCell[] }) {
  const map = useMap();
  useEffect(() => {
    if (cells.length === 0) return;
    if (cells.length === 1) {
      map.setView([cells[0].lat, cells[0].lon], 13);
      return;
    }
    map.fitBounds(L.latLngBounds(cells.map((c) => [c.lat, c.lon] as [number, number])), { padding: [24, 24] });
  }, [map, cells]);
  return null;
}

interface HeatMapProps {
  cells: HeatCell[];
  /** The title, for the text alternative. */
  title: string;
  cityName: string;
}

export default function HeatMap({ cells, title, cityName }: HeatMapProps) {
  // Keyed on the `cells` prop, which the page keeps reference-stable until the
  // section is replaced, so neither the fit nor the circles redo on an
  // unrelated re-render.
  const drawn = useMemo(() => cells.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon)), [cells]);
  const radii = useMemo(() => heatRadii(drawn.map((c) => c.affinity)), [drawn]);

  if (drawn.length === 0) {
    return (
      <div className={`${HEAT_MAP_HEIGHT} flex items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground`}>
        No map locations returned
      </div>
    );
  }

  return (
    // A labelled group rather than role="img": the zoom buttons and the
    // attribution link inside are interactive, and an image role would hide
    // them from assistive tech. The neighbourhood list beside it (WhereSection)
    // carries the information in text.
    <div
      role="group"
      aria-roledescription="map"
      aria-label={`Heatmap of where fans of ${title} are concentrated in ${cityName}`}
      className={`isolate ${HEAT_MAP_HEIGHT} overflow-hidden rounded-lg border border-border`}
    >
      <MapContainer center={[drawn[0].lat, drawn[0].lon]} zoom={11} scrollWheelZoom={false} className="h-full w-full" attributionControl>
        <TileLayer attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'} url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitToCells cells={drawn} />
        {drawn.map((c, i) => (
          <CircleMarker
            key={`${c.geohash}-${i}`}
            center={[c.lat, c.lon]}
            radius={radii[i]}
            pathOptions={{ color: '#b45309', weight: 1, fillColor: '#f59e0b', fillOpacity: 0.55 }}
          >
            {c.neighbourhood && <Popup>{c.neighbourhood}</Popup>}
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

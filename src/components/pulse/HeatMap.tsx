/**
 * The heatmap: one circle per Qloo cell on an OpenStreetMap base. This module
 * is only ever reached through React.lazy (see WhereSection), so Leaflet's JS
 * and this CSS import travel in their own chunk instead of the entry bundle.
 */
import { useEffect } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { HeatCell } from '../../../shared/types/pulse';
import { heatRadii } from '@/lib/pulseCharts';

/** Same height as the Suspense fallback, so the page does not shift when the map arrives. */
const HEAT_MAP_HEIGHT = 'h-72 sm:h-80';

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
  const drawn = cells.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  const radii = heatRadii(drawn.map((c) => c.affinity));

  if (drawn.length === 0) {
    return (
      <div className={`${HEAT_MAP_HEIGHT} flex items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground`}>
        No map locations returned
      </div>
    );
  }

  return (
    // The map has no accessible structure of its own; the neighbourhood list
    // beside it (WhereSection) carries the information in text.
    <div
      role="img"
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

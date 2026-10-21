import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HeatCell } from '../../../shared/types/pulse';

// A stub map: what matters here is how often the view is re-fitted, not Leaflet's rendering.
const map = vi.hoisted(() => ({ fitBounds: vi.fn(), setView: vi.fn() }));
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ children, radius }: { children?: React.ReactNode; radius: number }) => (
    <div data-testid="circle" data-radius={radius}>
      {children}
    </div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useMap: () => map,
}));
import HeatMap from './HeatMap';

const cell = (lat: number, lon: number, affinity: number, neighbourhood: string | null = null): HeatCell => ({ lat, lon, geohash: `g${lat}`, affinity, popularity: 0.1, neighbourhood });

beforeEach(() => {
  map.fitBounds.mockClear();
  map.setView.mockClear();
});

describe('HeatMap', () => {
  it('fits the view to the cells once on mount', () => {
    render(<HeatMap cells={[cell(28.6, 77.2, 0.9), cell(28.7, 77.3, 0.5)]} title="Saffron Nights" cityName="Delhi" />);
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it('does not re-fit on a re-render with the same cells (the page re-renders on every streamed section)', () => {
    const cells = [cell(28.6, 77.2, 0.9), cell(28.7, 77.3, 0.5)];
    const { rerender } = render(<HeatMap cells={cells} title="Saffron Nights" cityName="Delhi" />);
    rerender(<HeatMap cells={cells} title="Saffron Nights" cityName="Delhi" />);
    rerender(<HeatMap cells={cells} title="Saffron Nights!" cityName="Delhi" />);
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
  });

  it('re-fits when a new cells array arrives', () => {
    const { rerender } = render(<HeatMap cells={[cell(28.6, 77.2, 0.9), cell(28.7, 77.3, 0.5)]} title="t" cityName="Delhi" />);
    rerender(<HeatMap cells={[cell(19.0, 72.8, 0.9), cell(19.1, 72.9, 0.5)]} title="t" cityName="Delhi" />);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
  });

  it('centres a single cell with setView instead of fitting bounds, also only once', () => {
    const cells = [cell(28.6, 77.2, 0.9)];
    const { rerender } = render(<HeatMap cells={cells} title="t" cityName="Delhi" />);
    rerender(<HeatMap cells={cells} title="t" cityName="Delhi" />);
    expect(map.setView).toHaveBeenCalledTimes(1);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it('is a labelled map group (not an image: its controls are interactive), with circles of at least 6 px', () => {
    render(<HeatMap cells={[cell(28.6, 77.2, 0.9, 'Saket'), cell(28.7, 77.3, 0.1)]} title="Saffron Nights" cityName="Delhi" />);
    const group = screen.getByRole('group', { name: 'Heatmap of where fans of Saffron Nights are concentrated in Delhi' });
    expect(group).toHaveAttribute('aria-roledescription', 'map');
    const radii = screen.getAllByTestId('circle').map((c) => Number(c.dataset.radius));
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(6);
    expect(radii[0]).toBeGreaterThan(radii[1]);
    expect(screen.getByText('Saket')).toBeInTheDocument();
  });

  it('shows a plain message, not an empty map, when no cell has coordinates', () => {
    render(<HeatMap cells={[cell(NaN, NaN, 0.5)]} title="t" cityName="Delhi" />);
    expect(screen.getByText('No map locations returned')).toBeInTheDocument();
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
  });
});

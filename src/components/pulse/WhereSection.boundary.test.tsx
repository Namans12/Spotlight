import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HeatCell } from '../../../shared/types/pulse';

// A map module that blows up when it renders, as a stale chunk or a Leaflet
// runtime error would.
vi.mock('@/components/pulse/HeatMap', () => ({
  default: () => {
    throw new Error('leaflet exploded');
  },
}));
import { WhereSection } from './WhereSection';

const cells: HeatCell[] = [{ lat: 28.6, lon: 77.2, geohash: 'ttn', affinity: 0.5, popularity: 0.1, neighbourhood: 'Saket' }];

beforeEach(() => {
  // React logs the caught error; the test asserts on the outcome instead.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('WhereSection: a failing map', () => {
  it('is contained to the map’s own box: a message, and the neighbourhood list still there', async () => {
    render(
      <div>
        <p>rest of the brief</p>
        <WhereSection cells={cells} title="Saffron Nights" cityName="Delhi" />
      </div>,
    );
    expect(await screen.findByText('The map couldn’t load — the list below is the same data')).toBeInTheDocument();
    expect(screen.getByText('Saket')).toBeInTheDocument();
    expect(screen.getByText('rest of the brief')).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HeatCell } from '../../../shared/types/pulse';

// Its own file because React.lazy caches the first load: in a file where the map
// had already rendered, the fallback would never show again.
let release: () => void = () => {};
const gate = new Promise<void>((resolve) => {
  release = resolve;
});
vi.mock('@/components/pulse/HeatMap', async () => {
  await gate;
  return { default: ({ cells }: { cells: HeatCell[] }) => <div data-testid="heatmap">{cells.length} cells</div> };
});
import { WhereSection } from './WhereSection';

const cells: HeatCell[] = [{ lat: 28.6, lon: 77.2, geohash: 'ttn', affinity: 0.5, popularity: 0.1, neighbourhood: 'Saket' }];

describe('WhereSection', () => {
  it('holds a same-height skeleton in the map’s place while the lazy map module loads, then swaps it in', async () => {
    render(<WhereSection cells={cells} title="Saffron Nights" cityName="Delhi" />);
    const fallback = screen.getByRole('status', { name: 'Loading map' });
    expect(fallback).toHaveClass('h-72', 'sm:h-80');
    // The text alternative does not wait for the map.
    expect(screen.getByText('Saket')).toBeInTheDocument();

    release();
    expect(await screen.findByTestId('heatmap')).toHaveTextContent('1 cells');
    expect(screen.queryByRole('status', { name: 'Loading map' })).not.toBeInTheDocument();
  });
});

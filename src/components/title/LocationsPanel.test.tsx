import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TitleLocationEntry } from '../../../shared/types/pulse';

vi.mock('@/lib/pulseApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pulseApi')>()),
  fetchTitleLocations: vi.fn(),
  pulseConfigured: vi.fn(() => true),
}));
import { PulseApiError, fetchTitleLocations, pulseConfigured } from '@/lib/pulseApi';
import { LocationsPanel } from './LocationsPanel';

const row = (over: Partial<TitleLocationEntry> = {}): TitleLocationEntry => ({
  city_slug: 'delhi',
  cityName: 'Delhi',
  kind: 'filmed',
  landmark_label: null,
  source: 'both',
  ...over,
});

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LocationsPanel mediaType="movie" tmdbId={999900001} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  vi.mocked(fetchTitleLocations).mockReset();
  vi.mocked(pulseConfigured).mockReturnValue(true);
});

describe('LocationsPanel renders nothing', () => {
  it('when Pulse is not configured, and does not even ask', async () => {
    vi.mocked(pulseConfigured).mockReturnValue(false);
    const { container } = renderPanel();
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(fetchTitleLocations).not.toHaveBeenCalled();
  });

  it('while loading', () => {
    vi.mocked(fetchTitleLocations).mockReturnValue(new Promise(() => {}));
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['a network failure', () => new TypeError('Failed to fetch')],
    ['a 5xx', () => new PulseApiError(503, 'unavailable')],
    ['a 429', () => new PulseApiError(429, 'rate_limited', 5)],
  ])('on %s', async (_n, err) => {
    vi.mocked(fetchTitleLocations).mockRejectedValue(err());
    const { container } = renderPanel();
    await waitFor(() => expect(fetchTitleLocations).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('when there are no rows', async () => {
    vi.mocked(fetchTitleLocations).mockResolvedValue([]);
    const { container } = renderPanel();
    await waitFor(() => expect(fetchTitleLocations).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('LocationsPanel with rows', () => {
  it('asks for the title it was given', async () => {
    vi.mocked(fetchTitleLocations).mockResolvedValue([row()]);
    renderPanel();
    await screen.findByRole('heading', { name: 'Filmed in & set in' });
    expect(vi.mocked(fetchTitleLocations).mock.calls[0].slice(0, 2)).toEqual(['movie', 999900001]);
  });

  it('words each row by kind and landmark', async () => {
    vi.mocked(fetchTitleLocations).mockResolvedValue([
      row({ landmark_label: 'Chandni Chowk' }),
      row({ city_slug: 'mumbai', cityName: 'Mumbai' }),
      row({ city_slug: 'new-york', cityName: 'New York City', kind: 'set', source: 'wikipedia' }),
    ]);
    renderPanel();
    await screen.findByRole('heading', { name: 'Filmed in & set in' });
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Shot in Chandni Chowk, Delhi', 'Shot in Mumbai', 'Set in New York City']);
  });

  it('links each city to its Pulse page, with the accessible name', async () => {
    vi.mocked(fetchTitleLocations).mockResolvedValue([row({ landmark_label: 'Chandni Chowk' }), row({ city_slug: 'new-york', cityName: 'New York City', kind: 'set' })]);
    renderPanel();
    const delhi = await screen.findByRole('link', { name: "See what's coming for Delhi" });
    expect(delhi).toHaveAttribute('href', '/pulse?city=delhi');
    expect(delhi).toHaveAttribute('title', "See what's coming for Delhi");
    expect(delhi).toHaveTextContent('Delhi');
    expect(screen.getByRole('link', { name: "See what's coming for New York City" })).toHaveAttribute('href', '/pulse?city=new-york');
  });

  it('shows the source note, muted, with the coverage caveat', async () => {
    vi.mocked(fetchTitleLocations).mockResolvedValue([row()]);
    renderPanel();
    const note = await screen.findByText(
      "From Wikipedia and Wikidata. Coverage varies, and India coverage is partial — a missing record doesn't mean a title wasn't shot or set somewhere.",
    );
    expect(note).toHaveClass('text-muted-foreground');
  });

  it('renders service text as text, never markup', async () => {
    vi.mocked(fetchTitleLocations).mockResolvedValue([row({ landmark_label: '<img src=x onerror=alert(1)>' })]);
    const { container } = renderPanel();
    await screen.findByRole('heading', { name: 'Filmed in & set in' });
    expect(container.querySelector('img')).toBeNull();
    const li = within(container).getAllByRole('listitem')[0];
    expect(li.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

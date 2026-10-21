import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EvidenceSection, NamedEntity, PlanNightResponse, Venue } from '../../../shared/types/pulse';

vi.mock('@/lib/pulseApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pulseApi')>()),
  fetchPlanNight: vi.fn(),
  pulseConfigured: vi.fn(() => true),
}));
import { PulseApiError, fetchPlanNight, pulseConfigured } from '@/lib/pulseApi';
import { inviteText } from '@/lib/planNightInvite';
import { PlanNightCard } from './PlanNightCard';

const venue = (i: number, over: Partial<Venue> = {}): Venue => ({
  entityId: `v${i}`, name: `Cafe ${i}`, address: null, lat: null, lon: null, priceLevel: null, tags: [], affinity: 0.5, ...over,
});
const artist = (i: number): NamedEntity => ({ entityId: `a${i}`, name: `Artist ${i}`, affinity: 0.4 });
const prov = [{ source: 'qloo' as const, call: 'recommend_places', params: {}, limits: 'Top matches only.' }];
const ok = <T,>(data: T): EvidenceSection<T> => ({ status: 'ok', data, provenance: prov });

const response = (over: Partial<PlanNightResponse> = {}): PlanNightResponse => ({
  title: 'Saffron Nights',
  cityName: 'Delhi',
  places: ok([venue(1, { address: '12 Khan Market', priceLevel: 2 }), venue(2), venue(3)]),
  artists: ok([artist(1), artist(2)]),
  ...over,
});

function renderCard(props: Partial<React.ComponentProps<typeof PlanNightCard>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlanNightCard mediaType="movie" tmdbId={999900001} title="Saffron Nights" {...props} />
    </QueryClientProvider>,
  );
}

async function plan(city = 'delhi') {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('City'), city);
  await user.click(screen.getByRole('button', { name: 'Show me places' }));
  return user;
}

function stubNavigator(share: unknown, clipboard: unknown) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true, writable: true });
}

beforeEach(() => {
  vi.mocked(fetchPlanNight).mockReset();
  vi.mocked(pulseConfigured).mockReturnValue(true);
  stubNavigator(undefined, undefined);
});
afterEach(() => {
  stubNavigator(undefined, undefined);
});

describe('PlanNightCard collapsed', () => {
  it('renders nothing when Pulse is not configured', () => {
    vi.mocked(pulseConfigured).mockReturnValue(false);
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the card with a labelled city select, a placeholder and a 44px button', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Plan the night' })).toBeInTheDocument();
    const select = screen.getByLabelText('City') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(within(select).getByRole('option', { name: 'Choose a city' })).toBeDisabled();
    expect(select.value).toBe('');
    expect(within(select).getAllByRole('option').length).toBeGreaterThan(5);
    const button = screen.getByRole('button', { name: 'Show me places' });
    expect(button).toBeDisabled();
    expect(button.className).toContain('min-h-11');
  });

  it('fetches nothing until the form is submitted, not even after choosing a city', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('City'), 'delhi');
    expect(fetchPlanNight).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('PlanNightCard results', () => {
  it('fetches with the chosen city and the title, and shows a loading skeleton meanwhile', async () => {
    vi.mocked(fetchPlanNight).mockReturnValue(new Promise(() => {}));
    renderCard();
    await plan('mumbai');
    expect(vi.mocked(fetchPlanNight).mock.calls[0][0]).toEqual({ city: 'mumbai', mediaType: 'movie', tmdbId: 999900001 });
    const loading = screen.getByText('Finding places…').closest('[role="status"]');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('uses the exact copy-rule headings, then lists places and artists as text', async () => {
    vi.mocked(fetchPlanNight).mockResolvedValue(response());
    renderCard();
    await plan();
    expect(await screen.findByRole('heading', { name: 'Fans of Saffron Nights in Delhi over-index on these spots' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '…and these artists' })).toBeInTheDocument();
    const places = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(places[0]).toContain('Cafe 1');
    expect(places[0]).toContain('12 Khan Market');
    expect(screen.getByLabelText('Price level 2 of 4')).toBeInTheDocument();
    expect(screen.getByText('Cafe 2')).toBeInTheDocument();
    const chips = within(screen.getByRole('list', { name: 'Artists fans of Saffron Nights over-index on' })).getAllByRole('listitem');
    expect(chips.map((c) => c.textContent)).toEqual(['Artist 1', 'Artist 2']);
  });

  it('omits address and price when the place has none, and uses the dollar sign outside India', async () => {
    vi.mocked(fetchPlanNight).mockResolvedValue(response({ cityName: 'London', places: ok([venue(1), venue(2, { priceLevel: 3 })]) }));
    renderCard();
    await plan('london');
    await screen.findByText('Cafe 1');
    expect(screen.getAllByLabelText(/^Price level/)).toHaveLength(1);
    expect(screen.getByLabelText('Price level 3 of 4').textContent).toContain('$$$');
  });

  it('falls back to "this title" in the heading when the page has no title', async () => {
    vi.mocked(fetchPlanNight).mockResolvedValue(response({ title: null }));
    renderCard({ title: null });
    await plan();
    expect(await screen.findByRole('heading', { name: 'Fans of this title in Delhi over-index on these spots' })).toBeInTheDocument();
  });

  it('shows the sources and their limits', async () => {
    vi.mocked(fetchPlanNight).mockResolvedValue(response());
    renderCard();
    await plan();
    expect((await screen.findAllByText('Source: Qloo. Top matches only.')).length).toBeGreaterThan(0);
  });

  it('renders service text as text, never markup', async () => {
    vi.mocked(fetchPlanNight).mockResolvedValue(response({ places: ok([venue(1, { name: '<b>Bold</b> Cafe', address: '<script>x</script>' })]) }));
    const { container } = renderCard();
    await plan();
    await screen.findByText('<b>Bold</b> Cafe');
    expect(container.querySelector('b, script')).toBeNull();
  });
});

describe('PlanNightCard states', () => {
  it('says plan-the-night is for release-radar titles on 404 unknown_title', async () => {
    vi.mocked(fetchPlanNight).mockRejectedValue(new PulseApiError(404, 'unknown_title'));
    renderCard();
    await plan();
    expect(await screen.findByText("Plan the night works for titles on Spotlight's release radar.")).toHaveClass('text-muted-foreground');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('asks for a wait on 429, naming the seconds', async () => {
    vi.mocked(fetchPlanNight).mockRejectedValue(new PulseApiError(429, 'rate_limited', 12));
    renderCard();
    await plan();
    expect(await screen.findByText(/Please wait about 12 seconds and try again/)).toBeInTheDocument();
  });

  it('asks for a wait on 429 without a Retry-After too', async () => {
    vi.mocked(fetchPlanNight).mockRejectedValue(new PulseApiError(429, 'rate_limited'));
    renderCard();
    await plan();
    expect(await screen.findByText(/Please wait a moment and try again/)).toBeInTheDocument();
  });

  it('offers Retry after a network failure, which asks again', async () => {
    vi.mocked(fetchPlanNight).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(response());
    renderCard();
    const user = await plan();
    expect(await screen.findByText(/Couldn't load places just now/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Cafe 1')).toBeInTheDocument();
    expect(fetchPlanNight).toHaveBeenCalledTimes(2);
  });

  it('submitting the same city again after an error asks again; after success it does not', async () => {
    vi.mocked(fetchPlanNight).mockRejectedValueOnce(new PulseApiError(503, 'unavailable')).mockResolvedValue(response());
    renderCard();
    const user = await plan();
    await screen.findByText(/Couldn't load places just now/);
    await user.click(screen.getByRole('button', { name: 'Show me places' }));
    await screen.findByText('Cafe 1');
    await user.click(screen.getByRole('button', { name: 'Show me places' }));
    expect(fetchPlanNight).toHaveBeenCalledTimes(2);
  });

  it('shows an empty section note instead of a list, with no retry', async () => {
    const empty: EvidenceSection<Venue[]> = { status: 'empty', data: null, provenance: [], note: 'Qloo has no entity for this title yet, so there is no taste data for it.' };
    vi.mocked(fetchPlanNight).mockResolvedValue(response({ places: empty, artists: { ...empty } as EvidenceSection<NamedEntity[]> }));
    renderCard();
    await plan();
    expect((await screen.findAllByText('Qloo has no entity for this title yet, so there is no taste data for it.')).length).toBe(2);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    // The heading is still the copy-rule sentence, and the invite still works without places.
    expect(screen.getByRole('heading', { name: 'Fans of Saffron Nights in Delhi over-index on these spots' })).toBeInTheDocument();
    expect(screen.getByLabelText('Invite text')).toHaveValue('Movie night? Saffron Nights. Want to go?');
  });

  it('shows a degraded note alongside the data', async () => {
    vi.mocked(fetchPlanNight).mockResolvedValue(response({ places: { ...ok([venue(1)]), status: 'degraded', note: 'Results are broader than usual.' } }));
    renderCard();
    await plan();
    expect(await screen.findByText('Cafe 1')).toBeInTheDocument();
    expect(screen.getByText('Results are broader than usual.')).toBeInTheDocument();
  });

  it('shows an error section with its note and a Try again that refetches', async () => {
    const err: EvidenceSection<Venue[]> = { status: 'error', data: null, provenance: [], note: 'This section could not be loaded just now. Try again shortly.' };
    vi.mocked(fetchPlanNight).mockResolvedValueOnce(response({ places: err })).mockResolvedValueOnce(response());
    renderCard();
    const user = await plan();
    expect(await screen.findByText("Qloo didn't answer this part.")).toBeInTheDocument();
    expect(screen.getByText('This section could not be loaded just now. Try again shortly.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Cafe 1')).toBeInTheDocument();
    expect(fetchPlanNight).toHaveBeenCalledTimes(2);
  });
});

describe('inviteText', () => {
  it('names the title, the city and the first two places only', () => {
    expect(inviteText('Saffron Nights', 'Delhi', [venue(1), venue(2), venue(3)])).toBe(
      'Movie night? Saffron Nights — fans of it in Delhi love spots like Cafe 1 and Cafe 2. Want to go?',
    );
    expect(inviteText('Saffron Nights', 'Delhi', [venue(1)])).toBe('Movie night? Saffron Nights — fans of it in Delhi love spots like Cafe 1. Want to go?');
  });

  it('drops the places part when there are none', () => {
    expect(inviteText('Saffron Nights', 'Delhi', [])).toBe('Movie night? Saffron Nights. Want to go?');
  });
});

describe('PlanNightCard invite', () => {
  const TEXT = 'Movie night? Saffron Nights — fans of it in Delhi love spots like Cafe 1 and Cafe 2. Want to go?';

  // navigator.share is read when the card renders; userEvent.setup() installs
  // its own clipboard on navigator, so that stub goes on after it.
  async function withResults(share?: unknown, clipboard?: unknown) {
    vi.mocked(fetchPlanNight).mockResolvedValue(response());
    stubNavigator(share, undefined);
    renderCard();
    const user = await plan();
    await screen.findByLabelText('Invite text');
    stubNavigator(share, clipboard);
    return user;
  }

  it('shows the invite text in a read-only textarea', async () => {
    await withResults();
    const area = screen.getByLabelText('Invite text') as HTMLTextAreaElement;
    expect(area).toHaveAttribute('readonly');
    expect(area.value).toBe(TEXT);
  });

  it('contains only the title, the city and public venue names: no personal data', async () => {
    vi.mocked(fetchPlanNight).mockResolvedValue(response({ places: ok([venue(1, { address: '12 Khan Market', lat: 28.6, lon: 77.2 }), venue(2)]) }));
    window.localStorage.setItem('spotlight:pulse-session', 'private-session-id-0001');
    renderCard();
    await plan();
    const text = (await screen.findByLabelText('Invite text') as HTMLTextAreaElement).value;
    const wa = screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('href') ?? '';
    for (const secret of ['private-session-id-0001', '12 Khan Market', '28.6', '77.2', 'Artist', 'v1', 'entity']) {
      expect(text).not.toContain(secret);
      expect(decodeURIComponent(wa)).not.toContain(secret);
    }
    expect(text).toBe(TEXT);
    // The link carries the text and nothing else in its query.
    expect(new URL(wa).searchParams.get('text')).toBe(text);
    expect([...new URL(wa).searchParams.keys()]).toEqual(['text']);
    window.localStorage.clear();
  });

  it('offers WhatsApp as a plain new-tab link to wa.me with the encoded text', async () => {
    await withResults();
    const link = screen.getByRole('link', { name: /WhatsApp/ });
    expect(link).toHaveAttribute('href', `https://wa.me/?text=${encodeURIComponent(TEXT)}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('has no Share button when the browser cannot share, and shares the text when it can', async () => {
    await withResults();
    expect(screen.queryByRole('button', { name: /Share/ })).toBeNull();
  });

  it('shares with navigator.share({ text }) when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const user = await withResults(share);
    await user.click(screen.getByRole('button', { name: /Share/ }));
    expect(share).toHaveBeenCalledWith({ text: TEXT });
  });

  it('treats dismissing the share sheet as nothing, and any other failure as a gentle message', async () => {
    const share = vi.fn().mockRejectedValueOnce(new DOMException('cancelled', 'AbortError')).mockRejectedValueOnce(new Error('boom'));
    const user = await withResults(share);
    await user.click(screen.getByRole('button', { name: /Share/ }));
    const live = screen.getAllByRole('status').find((el) => el.getAttribute('aria-live') === 'polite')!;
    expect(live).toHaveTextContent('');
    await user.click(screen.getByRole('button', { name: /Share/ }));
    expect(live).toHaveTextContent("Sharing isn't available here. Use Copy instead.");
  });

  it('copies to the clipboard and confirms in a polite live region', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = await withResults(undefined, { writeText });
    await user.click(screen.getByRole('button', { name: /Copy/ }));
    expect(writeText).toHaveBeenCalledWith(TEXT);
    const live = screen.getAllByRole('status').find((el) => el.getAttribute('aria-live') === 'polite')!;
    expect(live).toHaveTextContent('Copied');
  });

  it('falls back to selecting the text when the clipboard is blocked', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const user = await withResults(undefined, { writeText });
    await user.click(screen.getByRole('button', { name: /Copy/ }));
    expect(await screen.findByText(/Couldn't copy automatically/)).toBeInTheDocument();
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('copes with no clipboard API at all', async () => {
    const user = await withResults();
    await user.click(screen.getByRole('button', { name: /Copy/ }));
    expect(await screen.findByText(/Couldn't copy automatically/)).toBeInTheDocument();
  });

  it('never sends anything itself: nothing is fetched beyond the plan request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await withResults();
    await act(async () => {});
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fetchPlanNight).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

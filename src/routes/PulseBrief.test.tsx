import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { BriefEvent, BriefHeader, BriefSectionKey, Campaign, EvidenceSection, HeatCell, LocalHook } from '../../shared/types/pulse';

// The network layer is replaced; PulseApiError and the profile helpers stay real.
vi.mock('@/lib/pulseApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pulseApi')>()),
  streamBrief: vi.fn(),
  fetchGuess: vi.fn(),
  pulseConfigured: vi.fn(() => true),
}));
// Leaflet needs a real layout engine; the lazy module is replaced by a stub that
// shows what it was given.
vi.mock('@/components/pulse/HeatMap', () => ({
  default: ({ cells, title, cityName }: { cells: HeatCell[]; title: string; cityName: string }) => (
    <div data-testid="heatmap" data-cells={cells.length} data-title={title} data-city={cityName} />
  ),
}));
import { PulseApiError, fetchGuess, pulseConfigured, streamBrief } from '@/lib/pulseApi';
import { HttpError } from '@/lib/http';
import PulseBrief from './PulseBrief';

const header = (overrides: Partial<BriefHeader> = {}): BriefHeader => ({
  tmdbId: 999700001,
  mediaType: 'movie',
  title: 'Saffron Nights',
  posterUrl: null,
  releaseDate: '2026-10-24',
  city: 'delhi',
  cityName: 'Delhi',
  businessType: 'cafe',
  qlooEntityId: 'e1',
  ...overrides,
});

const ok = <T,>(data: T, provenance: EvidenceSection<T>['provenance'] = []): EvidenceSection<T> => ({ status: 'ok', data, provenance });
const withStatus = (status: EvidenceSection<unknown>['status'], note?: string): EvidenceSection<unknown> => ({ status, data: null, provenance: [], note });
const cell = (neighbourhood: string | null, affinity: number): HeatCell => ({ lat: 28.6, lon: 77.2, geohash: 'ttn', affinity, popularity: 0.1, neighbourhood });

const who = ok({ age: { '24_and_younger': 0.2, '25_to_29': 0.4, '30_to_34': 0, '35_to_44': -0.1, '45_to_54': -0.2, '55_and_older': -0.4 }, gender: { male: -0.1, female: 0.1 } });
const section = (key: BriefSectionKey, s: EvidenceSection<unknown>): BriefEvent => ({ type: 'section', key, section: s });
const header$ = (h = header()): BriefEvent => ({ type: 'header', header: h });
const done: BriefEvent = { type: 'done' };

const campaign: Campaign = {
  groundedBy: 'qloo',
  ideas: [
    { kind: 'special', title: 'Saffron latte', timing: 'Opening week', clauses: [{ text: 'Serve a saffron latte', evidence: ['venue:v1'] }] },
    { kind: 'social', title: 'Story post', timing: 'Fri', clauses: [{ text: 'Post at 7pm', evidence: [] }] },
    { kind: 'event', title: 'Screening night', timing: 'Sat', clauses: [{ text: 'Host a screening', evidence: ['hook:filmed'] }] },
  ],
};
const guess: Campaign = {
  groundedBy: 'none',
  ideas: [{ kind: 'special', title: 'Guessed special', timing: 'Anytime', clauses: [{ text: 'Offer a themed drink', evidence: ['heat:0'] }] }],
};

/** A stream the test drives by hand: `emit` delivers events, `end` closes it cleanly. */
function controlledStream() {
  let onEvent: (e: BriefEvent) => void = () => {};
  let end: () => void = () => {};
  let fail: (e: unknown) => void = () => {};
  const signals: AbortSignal[] = [];
  vi.mocked(streamBrief).mockImplementation((_params, cb, signal) => {
    onEvent = cb;
    if (signal) signals.push(signal);
    return new Promise<void>((resolve, reject) => {
      end = resolve;
      fail = reject;
    });
  });
  return {
    signals,
    emit: (...events: BriefEvent[]) => act(async () => { events.forEach((e) => onEvent(e)); }),
    end: () => act(async () => { end(); }),
    fail: (e: unknown) => act(async () => { fail(e); }),
  };
}

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderBrief(url = '/pulse/delhi/movie/999700001?type=cafe') {
  return render(
    <MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/pulse/:city/:mediaType/:tmdbId" element={<PulseBrief />} />
        <Route path="/pulse" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const sectionTitles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(streamBrief).mockReset();
  vi.mocked(fetchGuess).mockReset();
  vi.mocked(pulseConfigured).mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Pulse brief: streaming', () => {
  it('renders sections as they stream, before done: who is visible and venues is still a skeleton', async () => {
    const s = controlledStream();
    renderBrief();
    expect(screen.getByText('Loading venues…')).toBeInTheDocument();

    await s.emit(header$(), section('who', who));

    expect(await screen.findByRole('heading', { level: 1, name: 'Saffron Nights' })).toBeInTheDocument();
    expect(screen.getByText('Skew relative to average — not a share of people')).toBeInTheDocument();
    expect(screen.getByText('Loading venues…')).toBeInTheDocument();
    expect(screen.queryByText('Loading who…')).not.toBeInTheDocument();
    expect(screen.queryByText('No data returned')).not.toBeInTheDocument();
  });

  it('shows the header facts: date, city and business type, and a link back to the board', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(header$());
    expect(screen.getByText(/24 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Delhi · Café \/ restaurant/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to board/ })).toHaveAttribute('href', '/pulse?city=delhi&type=cafe');
  });

  it('keeps the section order fixed whatever order the events arrive in', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(
      header$(),
      section('hook', ok<LocalHook[]>([{ kind: 'set', placeName: 'Delhi', landmark: null, source: 'wikipedia' }])),
      section('artists', ok([{ entityId: 'a1', name: 'Prateek Kuhad', affinity: 0.3 }])),
      section('who', who),
      section('themes', ok([{ tagId: 't1', name: 'Rooftop', affinity: 0.2 }])),
      section('where', ok([cell('Hauz Khas', 0.9)])),
    );
    expect(sectionTitles()).toEqual(['Who', 'Where', 'Venues', 'Themes', 'Artists', 'Local hook', 'Campaign ideas']);
  });

  it('shows Brands and no Venues for a d2c_food brief', async () => {
    const s = controlledStream();
    renderBrief('/pulse/delhi/movie/999700001?type=d2c_food');
    await s.emit(header$(header({ businessType: 'd2c_food' })), section('brands', ok([{ entityId: 'b1', name: 'Blue Tokai', affinity: 0.4 }])));
    expect(sectionTitles()).toEqual(['Who', 'Where', 'Themes', 'Brands', 'Artists', 'Local hook', 'Campaign ideas']);
    expect(screen.getByText('Blue Tokai')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Venues' })).not.toBeInTheDocument();
  });

  it('turns a section the stream never sent into "No data returned" once done arrives', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('who', who), done);
    await s.end();
    // where, venues, themes, artists, hook, campaign never came; trend is hidden, not "missing".
    expect(screen.getAllByText('No data returned')).toHaveLength(6);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the trend only when it came back ok', async () => {
    const s = controlledStream();
    renderBrief();
    const points = [{ date: '2026-01-05', percentile: 0.4 }, { date: '2026-01-12', percentile: 0.6 }];
    await s.emit(header$(), section('trend', ok(points)));
    expect(screen.getByRole('heading', { level: 3, name: 'Trend' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Popularity percentile from 0.40 on 2026-01-05 to 0.60 on 2026-01-12/ })).toBeInTheDocument();
  });

  it.each(['empty', 'error', 'degraded', 'needs_input', 'partial'] as const)('hides the trend when its status is %s', async (status) => {
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('trend', withStatus(status, 'a note')), done);
    expect(screen.queryByRole('heading', { level: 3, name: 'Trend' })).not.toBeInTheDocument();
    expect(screen.queryByText('a note')).not.toBeInTheDocument();
  });

  it('renders venues that have no tags, coordinates, address or price level', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(
      header$(),
      section('venues', ok([{ entityId: 'v1', name: 'Bare Cafe', address: null, lat: null, lon: null, priceLevel: null, tags: [], affinity: null }])),
    );
    const list = screen.getByText('Bare Cafe').closest('li') as HTMLElement;
    expect(list).toBeInTheDocument();
    expect(within(list).queryByLabelText(/Price level/)).not.toBeInTheDocument();
    expect(screen.getByText(/Fans of Saffron Nights in Delhi over-index on these places/)).toBeInTheDocument();
  });

  it('shows address, price marks (₹ in India) and tags when the data has them', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(
      header$(),
      section('venues', ok([{ entityId: 'v1', name: 'Full Cafe', address: '12 Main Rd', lat: 28.6, lon: 77.2, priceLevel: 2, tags: ['coffee'], affinity: 0.3 }])),
    );
    const li = screen.getByText('Full Cafe').closest('li') as HTMLElement;
    expect(within(li).getByText('12 Main Rd')).toBeInTheDocument();
    expect(within(li).getByLabelText('Price level 2 of 4')).toHaveTextContent('₹₹₹₹');
    expect(within(li).getByText('coffee')).toBeInTheDocument();
  });

  it('phrases the lists as what fans over-index on, never about "your customers"', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(
      header$(),
      section('themes', ok([{ tagId: 't1', name: 'Rooftop', affinity: 0.2 }])),
      section('artists', ok([{ entityId: 'a1', name: 'Prateek Kuhad', affinity: 0.3 }])),
    );
    expect(screen.getByText('Fans of Saffron Nights in Delhi over-index on these place themes…')).toBeInTheDocument();
    expect(screen.getByText('Fans of Saffron Nights over-index on these artists…')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/your customers/i);
  });
});

describe('Pulse brief: where', () => {
  it('lists the top three distinct neighbourhoods by affinity and hands every cell to the map', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(
      header$(),
      section('where', ok([cell('Saket', 0.2), cell('Hauz Khas', 0.9), cell('Hauz Khas', 0.85), cell(null, 0.8), cell('Connaught Place', 0.7), cell('Khan Market', 0.6)])),
    );
    const map = await screen.findByTestId('heatmap');
    expect(map).toHaveAttribute('data-cells', '6');
    expect(map).toHaveAttribute('data-title', 'Saffron Nights');
    const list = screen.getByText('Strongest around').parentElement as HTMLElement;
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Hauz Khas', 'Connaught Place', 'Khan Market']);
  });

  it('says so when no cell has a neighbourhood name, and still draws the map', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('where', ok([cell(null, 0.5)])));
    expect(await screen.findByTestId('heatmap')).toBeInTheDocument();
    expect(screen.getByText(/No cell here has a neighbourhood name yet/)).toBeInTheDocument();
  });
});

describe('Pulse brief: hook', () => {
  it('reads "Shot in <landmark>, <City>" with its source chip', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('hook', ok<LocalHook[]>([{ kind: 'filmed', placeName: 'Delhi', landmark: 'Chandni Chowk', source: 'wikipedia' }])));
    expect(screen.getByText('Shot in Chandni Chowk, Delhi')).toBeInTheDocument();
    expect(screen.getByText('Wikipedia · Films shot in Delhi')).toBeInTheDocument();
  });

  it('reads "Set in <City>" with no landmark, and both chips for a record both sources hold', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('hook', ok<LocalHook[]>([{ kind: 'set', placeName: 'Delhi', landmark: null, source: 'both' }])));
    expect(screen.getByText('Set in Delhi')).toBeInTheDocument();
    expect(screen.getByText('Wikipedia · Films set in Delhi')).toBeInTheDocument();
    expect(screen.getByText('Wikidata · narrative location')).toBeInTheDocument();
  });
});

describe('Pulse brief: section statuses', () => {
  it('an empty section shows its note; a degraded one shows its note above the data', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(
      header$(),
      section('where', withStatus('empty', 'No heat for this title.')),
      section('themes', { status: 'degraded', data: [{ tagId: 't1', name: 'Rooftop', affinity: null }], provenance: [], note: 'Filter was unavailable.' }),
    );
    expect(screen.getByText('No heat for this title.')).toBeInTheDocument();
    expect(screen.getByText('Filter was unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Rooftop')).toBeInTheDocument();
  });

  it('an error section offers Retry while the other sections stay visible (Review Focus 2)', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('who', who), section('where', withStatus('error', 'Qloo is busy and rate limiting requests.')));
    expect(screen.getByText(/Qloo didn’t answer this part/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText('Qloo is busy and rate limiting requests.')).toBeInTheDocument();
    expect(screen.getByText('Skew relative to average — not a share of people')).toBeInTheDocument();
  });

  it('Retry re-fetches the whole brief, keeps the old sections shown (dimmed) until replaced, and aborts the old stream', async () => {
    const user = userEvent.setup();
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('who', who), section('where', withStatus('error', 'x')), done);
    await s.end();
    expect(streamBrief).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(streamBrief).toHaveBeenCalledTimes(2);
    expect(s.signals[0].aborted).toBe(true);
    expect(s.signals[1].aborted).toBe(false);
    // Still on screen, marked stale, until the new events arrive.
    expect(screen.getByText('Skew relative to average — not a share of people')).toBeInTheDocument();
    expect(screen.getByText(/Refreshing the brief/)).toBeInTheDocument();
    expect(screen.getByText('Skew relative to average — not a share of people').closest('section')).toHaveAttribute('aria-busy', 'true');

    await s.emit(header$(), section('who', who), section('where', ok([cell('Saket', 0.5)])), done);
    expect(await screen.findByTestId('heatmap')).toBeInTheDocument();
    expect(screen.queryByText(/Qloo didn’t answer this part/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Refreshing the brief/)).not.toBeInTheDocument();
  });

  it('a connection that closes before done says so and offers to try again, keeping what arrived', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('who', who));
    await s.end();
    expect(screen.getByRole('alert')).toHaveTextContent('The connection dropped before the brief finished.');
    expect(screen.getByText('Skew relative to average — not a share of people')).toBeInTheDocument();
    expect(screen.getByText('Loading venues…')).toBeInTheDocument();
  });
});

describe('Pulse brief: page states', () => {
  it('an unknown city shows the picker, not a crash (Review Focus 5)', async () => {
    vi.mocked(streamBrief).mockRejectedValue(new PulseApiError(400, 'unknown_city'));
    renderBrief();
    expect(await screen.findByText('That city isn’t supported yet — pick one of these.')).toBeInTheDocument();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
  });

  it('a bare HTTP 400 is treated the same way', async () => {
    vi.mocked(streamBrief).mockRejectedValue(new HttpError(400, 'bad'));
    renderBrief();
    expect(await screen.findByText('That city isn’t supported yet — pick one of these.')).toBeInTheDocument();
  });

  it('a city the SPA does not list never reaches the service', () => {
    renderBrief('/pulse/atlantis/movie/1?type=cafe');
    expect(screen.getByText('That city isn’t supported yet — pick one of these.')).toBeInTheDocument();
    expect(streamBrief).not.toHaveBeenCalled();
  });

  it('picking a city from the picker goes to that city’s board', async () => {
    const user = userEvent.setup();
    renderBrief('/pulse/atlantis/movie/1?type=cafe');
    await user.selectOptions(screen.getByLabelText('City'), 'delhi');
    await user.click(screen.getByRole('button', { name: 'Show the board' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/pulse?city=delhi&type=cafe');
  });

  it('a missing business type asks for one instead of guessing', () => {
    renderBrief('/pulse/delhi/movie/1');
    expect(screen.getByText('Pick a business type to open this brief.')).toBeInTheDocument();
    expect(streamBrief).not.toHaveBeenCalled();
  });

  it('an unknown title says so and links back to the board', async () => {
    vi.mocked(streamBrief).mockRejectedValue(new PulseApiError(404, 'unknown_title'));
    renderBrief();
    expect(await screen.findByText('We don’t have this title yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to board/ })).toHaveAttribute('href', '/pulse?city=delhi&type=cafe');
  });

  it('a nonsense title id is an unknown title too', () => {
    renderBrief('/pulse/delhi/movie/abc?type=cafe');
    expect(screen.getByText('We don’t have this title yet.')).toBeInTheDocument();
    expect(streamBrief).not.toHaveBeenCalled();
  });

  it('a rate limit says how long to wait, and Try again re-requests', async () => {
    const user = userEvent.setup();
    vi.mocked(streamBrief).mockRejectedValueOnce(new PulseApiError(429, 'rate_limited', 12));
    renderBrief();
    expect(await screen.findByText('Try again in 12 seconds.')).toBeInTheDocument();
    vi.mocked(streamBrief).mockReturnValue(new Promise(() => {}));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(streamBrief).toHaveBeenCalledTimes(2);
  });

  it('a network failure before anything arrived offers a retry', async () => {
    vi.mocked(streamBrief).mockRejectedValue(new TypeError('Failed to fetch'));
    renderBrief();
    expect(await screen.findByText('Couldn’t load this brief.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('a failure after sections arrived keeps them and shows a banner', async () => {
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('who', who));
    await s.fail(new TypeError('network'));
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t refresh the brief.');
    expect(screen.getByText('Skew relative to average — not a share of people')).toBeInTheDocument();
  });

  it('says Pulse is not configured, without calling the service', () => {
    vi.mocked(pulseConfigured).mockReturnValue(false);
    renderBrief();
    expect(screen.getByText('Pulse isn’t configured on this deployment')).toBeInTheDocument();
    expect(streamBrief).not.toHaveBeenCalled();
  });

  it('aborts the stream when the page goes away', async () => {
    const s = controlledStream();
    const { unmount } = renderBrief();
    await waitFor(() => expect(s.signals).toHaveLength(1));
    expect(s.signals[0].aborted).toBe(false);
    unmount();
    expect(s.signals[0].aborted).toBe(true);
  });

  it('events that arrive after the page went away change nothing and do not throw', async () => {
    const s = controlledStream();
    const { unmount } = renderBrief();
    unmount();
    await expect(s.emit(header$(), section('who', who))).resolves.not.toThrow();
  });
});

describe('Pulse brief: without Qloo', () => {
  async function ready() {
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('venues', ok([{ entityId: 'v1', name: 'Blue Door Cafe', address: null, lat: null, lon: null, priceLevel: null, tags: [], affinity: null }])), section('campaign', ok(campaign)), done);
    await s.end();
    return s;
  }

  it('does not call fetchGuess until the button is pressed', async () => {
    await ready();
    expect(screen.getByRole('button', { name: 'Compare without Qloo' })).toBeInTheDocument();
    expect(screen.queryByText('What an LLM guesses with no taste data')).not.toBeInTheDocument();
    expect(fetchGuess).not.toHaveBeenCalled();
  });

  it('the without-Qloo panel uses the exact label, side by side with the grounded campaign', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchGuess).mockResolvedValue(guess);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Compare without Qloo' }));
    expect(await screen.findByText('What an LLM guesses with no taste data')).toBeInTheDocument();
    expect(screen.getByText('Grounded in Qloo taste data')).toBeInTheDocument();
    expect(await screen.findByText('Guessed special')).toBeInTheDocument();
    expect(fetchGuess).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchGuess).mock.calls[0][0]).toEqual({ city: 'delhi', type: 'cafe', mediaType: 'movie', tmdbId: 999700001 });
  });

  it('every clause in the guess reads Agent suggestion, even if the response cited ids', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchGuess).mockResolvedValue(guess);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Compare without Qloo' }));
    const guessColumn = (await screen.findByText('What an LLM guesses with no taste data')).parentElement as HTMLElement;
    await within(guessColumn).findByText('Offer a themed drink');
    expect(within(guessColumn).getByText('Agent suggestion')).toBeInTheDocument();
    expect(within(guessColumn).queryByText('Qloo · heatmap')).not.toBeInTheDocument();
  });

  it('hides and re-shows the comparison without fetching a second time', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchGuess).mockResolvedValue(guess);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Compare without Qloo' }));
    await screen.findByText('Guessed special');
    await user.click(screen.getByRole('button', { name: 'Hide comparison' }));
    expect(screen.queryByText('Guessed special')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Compare without Qloo' }));
    expect(await screen.findByText('Guessed special')).toBeInTheDocument();
    expect(fetchGuess).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new PulseApiError(429, 'daily_limit'), 'Daily AI limit reached — try again tomorrow'],
    [new PulseApiError(503, 'llm_unavailable'), 'The AI writer isn’t configured on this deployment.'],
    [new PulseApiError(429, 'rate_limited', 30), /try again in 30 seconds/i],
    [new PulseApiError(503, 'unavailable'), /Couldn’t get the comparison/],
    [new TypeError('Failed to fetch'), /Couldn’t get the comparison/],
  ])('maps a fetchGuess failure (%#) to the right message', async (error, message) => {
    const user = userEvent.setup();
    vi.mocked(fetchGuess).mockRejectedValue(error);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Compare without Qloo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('offers Try again after a failure, and that retries the guess', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchGuess).mockRejectedValueOnce(new PulseApiError(503, 'unavailable')).mockResolvedValueOnce(guess);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Compare without Qloo' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Guessed special')).toBeInTheDocument();
    expect(fetchGuess).toHaveBeenCalledTimes(2);
  });

  it('abandons an in-flight guess when the page goes away', async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    vi.mocked(fetchGuess).mockImplementation((_p, sig) => {
      signal = sig;
      return new Promise(() => {});
    });
    const s = controlledStream();
    const { unmount } = renderBrief();
    await s.emit(header$(), section('campaign', ok(campaign)), done);
    await user.click(screen.getByRole('button', { name: 'Compare without Qloo' }));
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('renders the Qloo campaign with its chips resolved from the collected sections', async () => {
    await ready();
    const clause = screen.getByText('Serve a saffron latte').closest('li') as HTMLElement;
    expect(within(clause).getByRole('button', { name: /Qloo · places/ })).toHaveTextContent('Blue Door Cafe');
    expect(screen.getByText('Post at 7pm').closest('li')).toHaveTextContent('Agent suggestion');
  });
});

describe('Pulse brief: provenance', () => {
  const provenance = [
    { source: 'qloo' as const, call: 'where_popular', params: { entity_id: 'e1', city: 'delhi' }, limits: 'Affinity is comparable only within this query and city.' },
  ];

  it('lists each section’s call, params and limits under "What this doesn’t tell you"', async () => {
    const user = userEvent.setup();
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('where', ok([cell('Saket', 0.5)], provenance)));
    await user.click(screen.getByRole('button', { name: 'How this was made' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'Where' })).toBeInTheDocument();
    expect(within(drawer).getByText('where_popular')).toBeInTheDocument();
    expect(within(drawer).getByText('entity_id:')).toBeInTheDocument();
    expect(within(drawer).getByText('e1')).toBeInTheDocument();
    expect(within(drawer).getByText('city:')).toBeInTheDocument();
    expect(within(drawer).getByText('What this doesn’t tell you')).toBeInTheDocument();
    expect(within(drawer).getByText('Affinity is comparable only within this query and city.')).toBeInTheDocument();
  });

  it('closes with Escape and returns focus to the button', async () => {
    const user = userEvent.setup();
    const s = controlledStream();
    renderBrief();
    await s.emit(header$(), section('where', ok([cell('Saket', 0.5)], provenance)));
    const trigger = screen.getByRole('button', { name: 'How this was made' });
    await user.click(trigger);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('renders only a provenance entry’s own fields, not other parts of the section', async () => {
    const user = userEvent.setup();
    const s = controlledStream();
    renderBrief();
    const leaky = { ...ok([cell('Saket', 0.5)], provenance), apiKey: 'sk-secret-123', token: 'tok-abc' } as EvidenceSection<unknown>;
    (leaky.provenance[0] as unknown as Record<string, unknown>).headers = { Authorization: 'Bearer nope' };
    await s.emit(header$(), section('where', leaky));
    await user.click(screen.getByRole('button', { name: 'How this was made' }));
    const drawer = await screen.findByRole('dialog');
    expect(drawer.textContent).not.toMatch(/sk-secret|tok-abc|Bearer nope/);
  });
});

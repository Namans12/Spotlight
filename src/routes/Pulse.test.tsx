import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BoardCard, BoardResponse } from '../../shared/types/pulse';

// The network layer is replaced; PulseApiError and the profile helpers stay real.
vi.mock('@/lib/pulseApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pulseApi')>()),
  fetchBoard: vi.fn(),
  pulseConfigured: vi.fn(() => true),
}));
import { PulseApiError, fetchBoard, pulseConfigured } from '@/lib/pulseApi';
import Pulse from './Pulse';

function card(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    tmdbId: 1,
    mediaType: 'movie',
    title: 'Some Film',
    posterUrl: null,
    releaseDate: '2026-10-24',
    platform: 'Netflix',
    kind: 'ott',
    score: 0.6,
    why: '#1 of 2 for Delhi audiences · strongest around Hauz Khas',
    ...overrides,
  };
}

function board(overrides: Partial<BoardResponse> = {}): BoardResponse {
  return { city: 'delhi', cityName: 'Delhi', businessType: 'cafe', ranked: [], pending: [], unresolved: [], ...overrides };
}

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderPulse(url = '/pulse?city=delhi&type=cafe') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Pulse />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(fetchBoard).mockReset();
  vi.mocked(pulseConfigured).mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Pulse board: states', () => {
  it('shows only the picker, with the one-line explanation, when there is no profile', () => {
    renderPulse('/pulse');
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Business type' })).toBeInTheDocument();
    expect(screen.getByText(/Which upcoming releases will your city/)).toBeInTheDocument();
    expect(fetchBoard).not.toHaveBeenCalled();
  });

  it('shows skeletons while the board loads', () => {
    vi.mocked(fetchBoard).mockReturnValue(new Promise(() => {}));
    renderPulse();
    const loading = screen.getByText(/Loading this week/).closest('[role="status"]');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('renders ranked cards with title, platform, date, score bar and why-line', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(
      board({ ranked: [card({ title: 'Dune Three', platform: 'Prime Video', releaseDate: '2026-10-24' })] }),
    );
    renderPulse();
    expect(await screen.findByText('Dune Three')).toBeInTheDocument();
    expect(screen.getByText('Prime Video')).toBeInTheDocument();
    expect(screen.getByText('24 Oct')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: /relative to other releases in Delhi/i })).toHaveAttribute('aria-valuenow', '0.6');
    expect(screen.getByText('Relative to other releases in Delhi')).toBeInTheDocument();
    expect(screen.getByText(/strongest around Hauz Khas/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pulse for Delhi' })).toBeInTheDocument();
  });

  it('renders a rank-only why-line without dangling separators', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(
      board({ ranked: [card({ title: 'Plain', why: '#3 of 3 for Delhi audiences' })] }),
    );
    renderPulse();
    const line = (await screen.findByText('#3 of 3 for Delhi audiences')).closest('p');
    expect(line?.textContent).toBe('#3 of 3 for Delhi audiences');
  });

  it('draws no score bar for a card that has no why-line', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board({ ranked: [card({ title: 'Bare', why: null })] }));
    renderPulse();
    await screen.findByText('Bare');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('links a card to its brief with the business type in the query', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board({ ranked: [card({ tmdbId: 603, mediaType: 'tv', title: 'Linked' })] }));
    renderPulse();
    const link = (await screen.findByText('Linked')).closest('a');
    expect(link).toHaveAttribute('href', '/pulse/delhi/tv/603?type=cafe');
  });

  it('renders unresolved titles in their own collapsed strip, not among the ranked cards', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(
      board({
        ranked: [card({ tmdbId: 1, title: 'Ranked One' })],
        unresolved: [card({ tmdbId: 2, title: 'Mystery Title', score: null, why: null }), card({ tmdbId: 3, title: 'Other Mystery', score: null, why: null })],
      }),
    );
    renderPulse();
    await screen.findByText('Ranked One');
    const strip = screen.getByText('Not enough taste data yet (2)').closest('details') as HTMLDetailsElement;
    expect(strip).not.toBeNull();
    expect(strip.open).toBe(false);
    expect(within(strip).getByText('Mystery Title')).toBeInTheDocument();
    const rankedList = screen.getByRole('list', { name: /ranked for Delhi/i });
    expect(within(rankedList).queryByText('Mystery Title')).not.toBeInTheDocument();
  });

  it('shows no strip when nothing is unresolved', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board({ ranked: [card()] }));
    renderPulse();
    await screen.findByText('Some Film');
    expect(screen.queryByText(/Not enough taste data yet/)).not.toBeInTheDocument();
  });

  it('says so when there is nothing at all to rank', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board());
    renderPulse();
    expect(await screen.findByText('No upcoming releases to rank yet')).toBeInTheDocument();
  });
});

describe('Pulse board: India-dates note', () => {
  it('is shown for a non-Indian city', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board({ city: 'new-york', cityName: 'New York City', ranked: [card()] }));
    renderPulse('/pulse?city=new-york&type=cafe');
    await screen.findByText('Some Film');
    expect(screen.getByText('Release dates are for India; audience data is for New York City.')).toBeInTheDocument();
  });

  it('is absent for an Indian city', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board({ ranked: [card()] }));
    renderPulse();
    await screen.findByText('Some Film');
    expect(screen.queryByText(/Release dates are for India/)).not.toBeInTheDocument();
  });
});

describe('Pulse board: errors', () => {
  it('unknown_city from the service reopens the picker with a message', async () => {
    vi.mocked(fetchBoard).mockRejectedValue(new PulseApiError(400, 'unknown_city'));
    renderPulse();
    expect(await screen.findByText(/doesn’t cover that city yet/)).toBeInTheDocument();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
  });

  it('rate_limited gives a friendly message with the wait', async () => {
    vi.mocked(fetchBoard).mockRejectedValue(new PulseApiError(429, 'rate_limited', 12));
    renderPulse();
    expect(await screen.findByText('Try again in 12 seconds.')).toBeInTheDocument();
  });

  it('a network error offers a retry that refetches', async () => {
    // The shared retry policy tries a 5xx/network failure three times in all
    // (1 s then 2 s apart) before the error is shown, so fake timers step past it.
    vi.useFakeTimers();
    vi.mocked(fetchBoard)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(board({ ranked: [card({ title: 'Back Again' })] }));
    renderPulse();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(fetchBoard).toHaveBeenCalledTimes(3);
    const retry = screen.getByRole('button', { name: /try again/i });
    expect(screen.getByText('Couldn’t load the board.')).toBeInTheDocument();
    await act(async () => {
      retry.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Back Again')).toBeInTheDocument();
  });

  it('does not retry a 4xx: the rate-limit message appears after a single request', async () => {
    vi.mocked(fetchBoard).mockRejectedValue(new PulseApiError(429, 'rate_limited', 3));
    renderPulse();
    await screen.findByText('Try again in 3 seconds.');
    expect(fetchBoard).toHaveBeenCalledTimes(1);
  });

  it('shows the not-configured state and makes no network call when there is no service URL', () => {
    vi.mocked(pulseConfigured).mockReturnValue(false);
    renderPulse();
    expect(screen.getByText('Pulse isn’t configured on this deployment')).toBeInTheDocument();
    expect(fetchBoard).not.toHaveBeenCalled();
  });
});

describe('Pulse board: pending polling', () => {
  it('shows pending skeleton cards, polls every 5 s, then stops after 2 minutes with a note', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchBoard).mockResolvedValue(
      board({ ranked: [card({ title: 'Ready' })], pending: [card({ tmdbId: 9, title: 'Warming Up', score: null, why: null })] }),
    );
    renderPulse();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Warming Up')).toBeInTheDocument();
    expect(screen.getByText(/Reading Delhi.s taste/)).toBeInTheDocument();
    expect(fetchBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchBoard).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchBoard).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/Still reading/)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000);
    });
    expect(screen.getByText(/Still reading — refresh to check again/)).toBeInTheDocument();
    const calls = vi.mocked(fetchBoard).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchBoard).toHaveBeenCalledTimes(calls);
  });

  it('does not poll a board with nothing pending', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchBoard).mockResolvedValue(board({ ranked: [card()] }));
    renderPulse();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchBoard).toHaveBeenCalledTimes(1);
  });
});

describe('Pulse board: picker and profile', () => {
  it('submitting the picker writes the URL and localStorage and loads that board', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board({ city: 'mumbai', cityName: 'Mumbai', ranked: [card({ title: 'Mumbai Film' })] }));
    const user = userEvent.setup();
    renderPulse('/pulse');
    await user.selectOptions(screen.getByLabelText('City'), 'mumbai');
    await user.click(screen.getByRole('tab', { name: 'D2C food & beverage brand' }));
    await user.click(screen.getByRole('button', { name: 'Show the board' }));

    expect(await screen.findByText('Mumbai Film')).toBeInTheDocument();
    expect(fetchBoard).toHaveBeenCalledWith('mumbai', 'd2c_food', expect.anything());
    expect(screen.getByTestId('where').textContent).toBe('/pulse?city=mumbai&type=d2c_food');
    expect(JSON.parse(window.localStorage.getItem('spotlight:pulse-profile') as string)).toEqual({ city: 'mumbai', type: 'd2c_food' });
  });

  it('cannot be submitted until a city is chosen', () => {
    renderPulse('/pulse');
    expect(screen.getByRole('button', { name: 'Show the board' })).toBeDisabled();
  });

  it('mirrors a stored profile into the URL', async () => {
    window.localStorage.setItem('spotlight:pulse-profile', JSON.stringify({ city: 'london', type: 'cafe' }));
    vi.mocked(fetchBoard).mockResolvedValue(board({ city: 'london', cityName: 'London', ranked: [card()] }));
    renderPulse('/pulse');
    await screen.findByText('Some Film');
    expect(screen.getByTestId('where').textContent).toBe('/pulse?city=london&type=cafe');
  });

  it('"Change" reopens the picker and Cancel returns to the board', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board({ ranked: [card()] }));
    const user = userEvent.setup();
    renderPulse();
    await screen.findByText('Some Film');
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByLabelText('City')).toHaveValue('delhi');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Some Film')).toBeInTheDocument();
  });

  it('treats an unknown city in the URL as no profile and shows the picker', () => {
    renderPulse('/pulse?city=atlantis&type=cafe');
    expect(screen.getByLabelText('City')).toHaveValue('');
    expect(fetchBoard).not.toHaveBeenCalled();
  });
});

describe('Pulse board: Ask Pulse', () => {
  it('offers the chat next to Change once a profile is shown, with the profile in its prompts', async () => {
    vi.mocked(fetchBoard).mockResolvedValue(board());
    const user = userEvent.setup();
    renderPulse();
    const ask = await screen.findByRole('button', { name: 'Ask Pulse' });
    expect(screen.getByRole('button', { name: 'Change' }).parentElement).toBe(ask.parentElement);
    await user.click(ask);
    const dialog = await screen.findByRole('dialog', { name: 'Ask Pulse' });
    expect(within(dialog).getByRole('button', { name: 'Which release should my Delhi café theme this weekend around?' })).toBeInTheDocument();
  });

  it('is not offered while choosing a profile', () => {
    renderPulse('/pulse');
    expect(screen.queryByRole('button', { name: 'Ask Pulse' })).not.toBeInTheDocument();
  });
});

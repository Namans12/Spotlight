import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeasonProgress } from './SeasonProgress';
import type { SeasonSummary } from '@/lib/progress';

// src/lib/progress.test.ts covers the arithmetic. This covers the wiring: that
// the one-tap button sends the right episode, that the season picker does not
// silently claim episodes you have not watched, and that the control hides
// itself rather than rendering something that cannot move.

function season(seasonNumber: number, episodeCount: number): SeasonSummary {
  return {
    seasonNumber,
    episodeCount,
    airDate: '2010-01-01',
    name: seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`,
  };
}

const BREAKING_BAD = [season(0, 9), season(1, 7), season(2, 13), season(3, 13), season(4, 13), season(5, 16)];

const onSet = vi.fn();
const onAdvance = vi.fn();
beforeEach(() => {
  onSet.mockReset();
  onAdvance.mockReset();
});

function renderProgress(progress: { season: number; episode: number } | null, seasons = BREAKING_BAD) {
  return render(
    <SeasonProgress seasons={seasons} progress={progress} onSet={onSet} onAdvance={onAdvance} />,
  );
}

describe('the one-tap action', () => {
  // The button names the episode it is about to mark, and delegates the actual
  // resolution to the hook — which re-reads the live pointer, so two quick taps
  // do not both compute their "next" from the same stale render.
  it('offers the first episode to someone who has not started', async () => {
    const user = userEvent.setup();
    renderProgress(null);

    await user.click(screen.getByRole('button', { name: /Start — S1 E1/ }));

    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('names the next episode within a season', async () => {
    const user = userEvent.setup();
    renderProgress({ season: 2, episode: 4 });

    await user.click(screen.getByRole('button', { name: /Watched S2 E5/ }));

    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  // The season-boundary case, through the UI rather than only the maths:
  // season 1 has seven episodes, so the button after the finale must name
  // S2 E1 — never a special.
  it('names the next season after a finale, not a special', () => {
    renderProgress({ season: 1, episode: 7 });

    expect(screen.getByRole('button', { name: /Watched S2 E1/ })).toBeInTheDocument();
  });

  it('shows a finished show as finished, with nothing left to advance', () => {
    renderProgress({ season: 5, episode: 16 });

    expect(screen.getByText('Finished')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Watched/ })).not.toBeInTheDocument();
  });
});

describe('the pickers', () => {
  // Keeping the old episode number would silently claim you had watched nine
  // episodes of a season you just switched to.
  it('lands on episode 1 when the season changes', async () => {
    const user = userEvent.setup();
    renderProgress({ season: 1, episode: 5 });

    await user.selectOptions(screen.getByLabelText('Season'), '4');

    expect(onSet).toHaveBeenCalledWith(4, 1);
  });

  it('offers exactly the episodes that season has', () => {
    renderProgress({ season: 1, episode: 3 });
    // Season 1 of Breaking Bad is seven episodes.
    expect(screen.getAllByRole('option', { name: /^Episode / })).toHaveLength(7);
  });

  it('never offers the specials as a season', () => {
    renderProgress({ season: 1, episode: 1 });
    const seasonOptions = screen.getAllByRole('option', { name: /^Season / }).map((o) => o.textContent);
    expect(seasonOptions).toEqual(['Season 1', 'Season 2', 'Season 3', 'Season 4', 'Season 5']);
  });

  it('offers no episode picker before the show is started', () => {
    renderProgress(null);
    expect(screen.queryByLabelText('Episode')).not.toBeInTheDocument();
  });
});

describe('reset', () => {
  it('clears the pointer rather than setting it to zero', async () => {
    const user = userEvent.setup();
    renderProgress({ season: 3, episode: 2 });

    await user.click(screen.getByRole('button', { name: /Reset/ }));

    expect(onSet).toHaveBeenCalledWith(null);
  });

  it('is not offered for a show never started', () => {
    renderProgress(null);
    expect(screen.queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument();
  });
});

describe('when there is nothing to track', () => {
  // An announced series, or one TMDB lists with only specials. A control that
  // cannot move is worse than no control.
  it('renders nothing for a show with no watchable seasons', () => {
    const { container } = renderProgress(null, [season(0, 9)]);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a show with no season data at all', () => {
    const { container } = renderProgress(null, []);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the count', () => {
  it('counts against the real run, excluding specials', () => {
    renderProgress({ season: 2, episode: 4 });
    // 7 + 4 of 62 — the specials appear in neither number.
    expect(screen.getByText('11 of 62 episodes')).toBeInTheDocument();
  });
});

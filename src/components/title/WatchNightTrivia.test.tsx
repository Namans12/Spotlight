import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WatchNightTrivia } from './WatchNightTrivia';

describe('watch-night trivia', () => {
  it('reveals a sourced answer after an optional choice', async () => {
    render(<WatchNightTrivia mediaType="tv" id={1668} />);
    expect(screen.queryByText(/Which café/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try trivia' }));
    await userEvent.click(screen.getByRole('button', { name: 'Central Park' }));
    expect(screen.getByRole('status')).toHaveTextContent('The answer is Central Perk.');
    expect(screen.getByRole('link', { name: 'Source: Warner Bros. Discovery' })).toHaveAttribute('href', 'https://press.wbd.com/na/media-release/hbo-max/max-watch-lists/whats-new-max-december-0');
    await userEvent.click(screen.getByRole('button', { name: 'Central Perk' }));
    expect(screen.getByRole('status')).toHaveTextContent('Correct!');
  });
  it('uses media type in the key and does not invent trivia for other titles', () => {
    const { container, rerender } = render(<WatchNightTrivia mediaType="movie" id={1668} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WatchNightTrivia mediaType="tv" id={1399} />);
    expect(screen.getByRole('button', { name: 'Try trivia' })).toBeInTheDocument();
    rerender(<WatchNightTrivia mediaType="tv" id={123} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('advances through sourced questions without revealing the next answer', async () => {
    const user = userEvent.setup();
    render(<WatchNightTrivia mediaType="tv" id={1668} />);
    await user.click(screen.getByRole('button', { name: 'Try trivia' }));
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Central Perk' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rachel and Monica' }));
    expect(screen.getByRole('status')).toHaveTextContent('Correct!');
    expect(screen.getByRole('link', { name: 'Source: Warner Bros. Discovery' })).toHaveAttribute('href', 'https://press.wbd.com/na/media-release/hbo-max/max-watch-lists/whats-new-max-december-0');
    expect(screen.queryByRole('button', { name: 'Next question' })).not.toBeInTheDocument();
  });
  it('resets the quiz when the title changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WatchNightTrivia mediaType="tv" id={1668} />);
    await user.click(screen.getByRole('button', { name: 'Try trivia' }));
    await user.click(screen.getByRole('button', { name: 'Central Perk' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    rerender(<WatchNightTrivia mediaType="movie" id={2062} />);
    expect(screen.getByRole('button', { name: 'Try trivia' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try trivia' }));
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
  });
  it('offers a clearly attributed catalogue-year question only for a valid date', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<WatchNightTrivia mediaType="movie" id={123} releaseDate="2020-02-30" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WatchNightTrivia mediaType="movie" id={123} releaseDate="2020-02-29" />);
    await user.click(screen.getByRole('button', { name: 'Try trivia' }));
    expect(screen.getByText('Which year does TMDB list for this title?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '2020' }));
    expect(screen.getByRole('status')).toHaveTextContent('Correct!');
    expect(screen.getByRole('link', { name: 'Source: TMDB' })).toHaveAttribute('href', 'https://www.themoviedb.org/movie/123');
  });
  it.each([
    ['movie', 2062, 'Paris'], ['tv', 2316, 'Pretzels'], ['movie', 673, 'The Three Broomsticks'],
  ] as const)('checks the sourced answer for %s:%i', async (mediaType, id, answer) => {
    render(<WatchNightTrivia mediaType={mediaType} id={id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try trivia' }));
    await userEvent.click(screen.getByRole('button', { name: answer }));
    expect(screen.getByRole('status')).toHaveTextContent('Correct!');
    expect(screen.getByRole('link', { name: /^Source:/ })).toHaveAttribute('href', expect.stringMatching(/^https:\/\//));
  });
});

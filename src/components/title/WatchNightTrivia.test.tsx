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
    expect(screen.getByRole('link', { name: 'Source: Warner Bros. Studio Tour' })).toHaveAttribute('href', 'https://www.wbstudiotour.com/');
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
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WatchNightIdeas } from './WatchNightIdeas';

describe('watch-night ideas', () => {
  it('offers a sourced idea only on request', async () => {
    render(<WatchNightIdeas mediaType="tv" id={1668} />);
    expect(screen.queryByText('Pizza')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show food ideas' }));
    expect(screen.getByText('Pizza')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source: Warner Bros. Studio Tour' })).toHaveAttribute('href', 'https://www.wbstudiotour.com/');
    expect(screen.getByRole('button', { name: 'Hide food ideas' })).toHaveAttribute('aria-expanded', 'true');
  });
  it('matches both title type and identity and does not invent a fallback', () => {
    const { container, rerender } = render(<WatchNightIdeas mediaType="movie" id={1668} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WatchNightIdeas mediaType="tv" id={1399} />);
    expect(screen.getByRole('button', { name: 'Show food ideas' })).toBeInTheDocument();
    rerender(<WatchNightIdeas mediaType="tv" id={123} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('links the Game of Thrones idea to its source', async () => {
    render(<WatchNightIdeas mediaType="tv" id={1399} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show food ideas' }));
    expect(screen.getByText('Lemon cakes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source: George R. R. Martin' })).toHaveAttribute('href', 'https://georgerrmartin.com/dining-in-westeros-a-feast-of-ice-and-fire/');
  });
});

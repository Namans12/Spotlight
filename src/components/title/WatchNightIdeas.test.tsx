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
    expect(screen.getByText('A trifle')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Source: Warner Bros. Studio Tour' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Source: Warner Bros. Studio Tour' })[0]).toHaveAttribute('href', 'https://www.wbstudiotour.com/it/info/dining/');
    expect(screen.getByRole('button', { name: 'Hide food ideas' })).toHaveAttribute('aria-expanded', 'true');
  });
  it('offers creative vibe ideas without claiming an unsupported title association', async () => {
    const { container, rerender } = render(<WatchNightIdeas mediaType="movie" id={1668} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show food ideas' }));
    expect(screen.queryByText('Pizza')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Pick a vibe for more ideas'), 'fresh');
    expect(screen.getByRole('status')).toHaveTextContent('General ideas for your chosen vibe');
    expect(screen.getByText('Fruit or vegetable sticks')).toBeInTheDocument();
    rerender(<WatchNightIdeas mediaType="tv" id={1399} />);
    expect(screen.getByText('Lemon cakes')).toBeInTheDocument();
    rerender(<WatchNightIdeas mediaType="tv" id={123} />);
    expect(screen.queryByText('Lemon cakes')).not.toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });
  it('links the Game of Thrones idea to its source', async () => {
    render(<WatchNightIdeas mediaType="tv" id={1399} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show food ideas' }));
    expect(screen.getByText('Lemon cakes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source: George R. R. Martin' })).toHaveAttribute('href', 'https://georgerrmartin.com/dining-in-westeros-a-feast-of-ice-and-fire/');
  });
  it.each([
    ['movie', 2062, 'Ratatouille'], ['tv', 2316, 'Soft pretzels'], ['movie', 673, 'Butterbeer-inspired drink'],
  ] as const)('shows a curated idea for %s:%i', async (mediaType, id, food) => {
    render(<WatchNightIdeas mediaType={mediaType} id={id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show food ideas' }));
    expect(screen.getByText(food)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Source:/ })).toHaveAttribute('href', expect.stringMatching(/^https:\/\//));
  });
});

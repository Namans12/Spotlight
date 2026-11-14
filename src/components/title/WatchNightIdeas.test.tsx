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
  it('hides the section when there are no title-specific ideas', () => {
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
  it('uses general adaptable ideas when dietary or budget preferences are selected', async () => {
    const user = userEvent.setup();
    render(<WatchNightIdeas mediaType="tv" id={1668} />);
    await user.click(screen.getByRole('button', { name: 'Show food ideas' }));
    await user.selectOptions(screen.getByLabelText('Pick a vibe for more ideas'), 'cosy');
    await user.selectOptions(screen.getByLabelText('Dietary preference'), 'vegan');
    expect(screen.queryByText('A trifle')).not.toBeInTheDocument();
    expect(screen.getByText('Toast with plant-based spread')).toBeInTheDocument();
    expect(screen.getByText(/Check ingredients and allergens/)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Prefer simple, budget-conscious ideas'));
    expect(screen.getByText('Tea')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Dietary preference'), '');
    expect(screen.getByText('Toast with a suitable spread')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Prefer simple, budget-conscious ideas'));
    expect(screen.getByText('A trifle')).toBeInTheDocument();
  });
  it('previews only the chosen food and removes it when preferences hide it', async () => {
    const user = userEvent.setup();
    render(<WatchNightIdeas mediaType="tv" id={1668} title="Friends" />);
    await user.click(screen.getByRole('button', { name: 'Show food ideas' }));
    await user.click(screen.getByRole('button', { name: 'Make a shareable plan' }));
    const preview = screen.getByLabelText('Plan preview') as HTMLTextAreaElement;
    expect(preview.value).toContain('Watch night: Friends');
    expect(preview.value).toContain('/title/tv/1668');
    expect(preview.value).not.toContain('Food idea:');
    await user.selectOptions(screen.getByLabelText('Food idea to include'), 'Pizza');
    expect(preview.value).toContain('Food idea: Pizza');
    await user.selectOptions(screen.getByLabelText('Dietary preference'), 'vegan');
    expect(preview.value).not.toContain('Pizza');
    expect(preview.value).not.toContain('vegan');
    await user.click(screen.getByRole('button', { name: 'Copy plan' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Plan copied|Could not copy/);
  });
  it.each([
    ['movie', 2062, 'Ratatouille'], ['tv', 2316, 'Soft pretzels'], ['movie', 673, 'Butterbeer-inspired drink'],
    ['tv', 66732, 'Waffles'], ['movie', 10198, 'Beignets'], ['movie', 10340, 'Spaghetti and meatballs'], ['movie', 116149, 'Marmalade sandwich'],
  ] as const)('shows a curated idea for %s:%i', async (mediaType, id, food) => {
    render(<WatchNightIdeas mediaType={mediaType} id={id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show food ideas' }));
    expect(screen.getByText(food)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Source:/ })).toHaveAttribute('href', expect.stringMatching(/^https:\/\//));
  });
});

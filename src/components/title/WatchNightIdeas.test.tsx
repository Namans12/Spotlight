import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WatchNightIdeas } from './WatchNightIdeas';
import { foodPairings } from '@/lib/watchNightIdeas';

describe('title-specific food pairings', () => {
 it('hides scene connections until watched confirmation and removes them if revoked', async () => {
  const user = userEvent.setup(); render(<WatchNightIdeas mediaType="movie" id={24428} title="The Avengers" />);
  await user.click(screen.getByRole('button', { name: 'Show food ideas' }));
  expect(screen.queryByText('Shawarma wraps')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Not yet/ }));
  expect(screen.queryByText('Shawarma wraps')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Yes, show the connections' }));
  expect(screen.getByText('Shawarma wraps')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Make a shareable plan' }));
  await user.click(screen.getByRole('button', { name: /Not yet/ }));
  expect(screen.queryByLabelText('Plan preview')).not.toBeInTheDocument();
  expect(screen.queryByText(/post-credits meal/)).not.toBeInTheDocument();
 });
 it('keeps title-specific options when adapting food preferences', async () => {
  const user = userEvent.setup(); render(<WatchNightIdeas mediaType="movie" id={568124} title="Encanto" />);
  await user.click(screen.getByRole('button', { name: 'Show food ideas' }));
  await user.click(screen.getByRole('button', { name: /Not yet/ }));
  expect(screen.getByText('Arepas')).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Food preference'), 'vegan');
  expect(screen.getByText(/Use beans or avocado/)).toBeInTheDocument();
  await user.click(screen.getByRole('checkbox'));
  expect(screen.queryByText('Arepas')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument();
 });
 it('clears watched consent when navigating to another title', async () => {
  const user = userEvent.setup(); const view = render(<WatchNightIdeas mediaType="tv" id={1668} />);
  await user.click(screen.getByRole('button', { name: 'Show food ideas' }));
  await user.click(screen.getByRole('button', { name: 'Yes, show the connections' }));
  expect(screen.getByText('Pizza')).toBeInTheDocument();
  view.rerender(<WatchNightIdeas mediaType="movie" id={24428} />);
  expect(screen.queryByText('Shawarma wraps')).not.toBeInTheDocument();
  view.rerender(<WatchNightIdeas mediaType="movie" id={1668} />);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
 });
 it('uses exact title identities and does not infer unseen scene pairings', () => {
  expect(foodPairings('tv', 24428, true, '', false)).toEqual([]);
  expect(foodPairings('movie', 24428, false, '', false)).toEqual([]);
  expect(foodPairings('movie', 2062, false, 'vegan', false)[0].food).toBe('Ratatouille');
  expect(foodPairings('movie', 2062, true, '', true)).toEqual([]);
 });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WatchNightTrivia } from './WatchNightTrivia';
import { TRIVIA_PACKS } from '@/lib/watchNightTrivia';

describe('movie trivia', () => {
 it('requires watched confirmation, locks answers, advances and scores', async () => {
  const user = userEvent.setup(); render(<WatchNightTrivia mediaType="movie" id={284052} />);
  await user.click(screen.getByRole('button', { name: 'Try trivia' }));
  expect(screen.queryByText(/Wi-Fi password/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start quiz' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox')); await user.click(screen.getByRole('button', { name: 'Start quiz' }));
  expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Source:/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Shamballa' }));
  expect(screen.getByRole('status')).toHaveTextContent('Correct!');
  expect(screen.getByRole('button', { name: 'Agamotto' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Heart surgeon' }));
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  await user.click(screen.getByRole('button', { name: 'The Ancient One' }));
  await user.click(screen.getByRole('button', { name: 'See score' }));
  expect(screen.getByRole('status')).toHaveTextContent('2 / 3 correct');
  await user.click(screen.getByRole('button', { name: 'Change film or restart' }));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.queryByText(/Wi-Fi password/)).not.toBeInTheDocument();
 });
 it('requires new consent when changing films or navigating to another title', async () => {
  const user = userEvent.setup(); const view = render(<WatchNightTrivia mediaType="movie" id={284052} />);
  await user.click(screen.getByRole('button', { name: 'Try trivia' }));
  await user.click(screen.getByRole('checkbox'));
  await user.selectOptions(screen.getByRole('combobox'), 'movie:11854');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.queryByText('Who is Rahul’s first wife?')).not.toBeInTheDocument();
  view.rerender(<WatchNightTrivia mediaType="movie" id={2062} />);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 });
 it('offers explicitly different films for an uncovered title without a year question', async () => {
  const user = userEvent.setup(); render(<WatchNightTrivia mediaType="tv" id={284052} releaseDate="2026-11-14" />);
  await user.click(screen.getByRole('button', { name: 'Try trivia' }));
  expect(screen.getByText(/don’t have a reviewed quiz/)).toBeInTheDocument();
  expect(screen.getByRole('combobox')).toHaveValue('');
  expect(screen.queryByText(/Which year/)).not.toBeInTheDocument();
 });
 it('has multiple valid, sourced questions in every pack', () => {
  expect(new Set(TRIVIA_PACKS.map(pack => pack.key)).size).toBe(TRIVIA_PACKS.length);
  for (const pack of TRIVIA_PACKS) {
   expect(pack.questions.length).toBeGreaterThanOrEqual(3);
   for (const q of pack.questions) {
    expect(new Set(q.choices).size).toBe(q.choices.length);
    expect(q.choices.filter(choice => choice === q.answer)).toHaveLength(1);
    expect(q.sourceUrl).toMatch(/^https:\/\//);
    expect(q.explanation.length).toBeGreaterThan(10);
   }
  }
 });
});

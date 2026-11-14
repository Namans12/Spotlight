import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Footer } from './Footer';

describe('data credits', () => {
  it('attributes provider availability and identifies the TMDB source', () => {
    render(<Footer />);
    fireEvent.click(screen.getByText('Data credits'));
    const credits = screen.getByRole('region', { name: 'Credits' });
    expect(credits).toHaveTextContent('Streaming availability supplied by JustWatch via TMDB');
    expect(screen.getByRole('link', { name: 'JustWatch' })).toHaveAttribute('href', 'https://www.justwatch.com');
    expect(credits).toHaveTextContent('This product uses the TMDB API but is not endorsed or certified by TMDB.');
  });
});

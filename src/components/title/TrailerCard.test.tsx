import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrailerCard } from './TrailerCard';

describe('TrailerCard', () => {
  const trailer = { key: 'abc123', site: 'YouTube' as const, name: 'Official Trailer' };

  it('links out to the real YouTube page, not an embed', () => {
    render(<TrailerCard trailer={trailer} />);
    const link = screen.getByRole('link');

    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc123');
    // Never a same-page player: no iframe, and the click target is a link
    // element, not a button that would swap in a player.
    expect(document.querySelector('iframe')).toBeNull();
  });

  // Opening in a new tab without noopener leaks a window.opener reference the
  // destination page could use to navigate the original tab.
  it('opens safely in a new tab', () => {
    render(<TrailerCard trailer={trailer} />);
    const link = screen.getByRole('link');

    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  // The thumbnail is a static image fetch to img.youtube.com, not a script
  // load or a player — the whole reason this exists instead of an <iframe>.
  // alt="" is deliberate (the link's own text names the trailer), which also
  // means the image is decorative and absent from the accessibility tree —
  // queried by tag rather than by role.
  it('uses a static thumbnail image rather than an embedded player', () => {
    const { container } = render(<TrailerCard trailer={trailer} />);
    const img = container.querySelector('img');

    expect(img).toHaveAttribute('src', 'https://img.youtube.com/vi/abc123/hqdefault.jpg');
  });

  it('names the trailer', () => {
    render(<TrailerCard trailer={trailer} />);
    expect(screen.getByText('Official Trailer')).toBeInTheDocument();
  });
});

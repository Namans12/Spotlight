import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('./IntroScreen', () => ({ IntroScreen: () => <div>Enter Spotlight</div> }));
import { IntroGate } from './IntroGate';

afterEach(() => { window.history.replaceState({}, '', '/'); window.sessionStorage.clear(); });

describe('IntroGate', () => {
  it.each(['/pulse', '/pulse/delhi/movie/603?type=cafe'])('opens %s directly', (path) => {
    window.history.replaceState({}, '', path);
    render(<IntroGate><p>Pulse content</p></IntroGate>);
    expect(screen.getByText('Pulse content')).toBeInTheDocument();
    expect(screen.queryByText('Enter Spotlight')).not.toBeInTheDocument();
  });
  it('keeps the intro for the main app on a fresh session', () => {
    render(<IntroGate><p>Spotlight</p></IntroGate>);
    expect(screen.getByText('Enter Spotlight')).toBeInTheDocument();
  });
});

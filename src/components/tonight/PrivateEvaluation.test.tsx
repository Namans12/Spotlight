import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrivateEvaluation } from './PrivateEvaluation';
import { downloadTonightStudy } from '@/lib/tonightStudy';

vi.mock('@/lib/tonightStudy', async (original) => ({ ...await original<typeof import('@/lib/tonightStudy')>(), downloadTonightStudy: vi.fn() }));

describe('private evaluation', () => {
  it('requires a deliberate start, judgment and download', async () => {
    const user = userEvent.setup();
    render(<PrivateEvaluation candidates={[{ id: 1, title: 'Example', mediaType: 'movie', posterPath: null, overview: '',
      releaseDate: '2020-01-01', voteAverage: 7, originalLanguage: 'en', genres: ['Comedy'] }]}
      filters={{ mood: '', maxMinutes: null, language: '', services: [], includeRentBuy: false, mediaType: '' }}
      weights={{}} feedback={{}} availability={{}} disabled={false} />);
    expect(downloadTonightStudy).not.toHaveBeenCalled();
    await user.click(screen.getByText('Help evaluate suggestions (optional)'));
    expect(screen.getByText(/No account details are included/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start private evaluation' }));
    const download = screen.getByRole('button', { name: 'Download evaluation file' });
    expect(download).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Judgment for Example (movie)'), 'relevant');
    expect(downloadTonightStudy).not.toHaveBeenCalled();
    await user.click(download);
    expect(downloadTonightStudy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadTonightStudy).mock.calls[0][0].judgments).toEqual({ 'movie:1': 'relevant' });
    expect(within(screen.getByText('Example (film)').closest('label') as HTMLElement).getByRole('combobox')).toHaveValue('relevant');
  });
  it('presents titles alphabetically while preserving the original order in the export', async () => {
    const user = userEvent.setup();
    const base = { mediaType: 'movie' as const, posterPath: null, overview: '', releaseDate: '', voteAverage: 0, originalLanguage: 'en' };
    render(<PrivateEvaluation candidates={[{ ...base, id: 2, title: 'Zulu' }, { ...base, id: 1, title: 'Alpha' }]}
      filters={{ mood: '', maxMinutes: null, language: '', services: [], includeRentBuy: false, mediaType: '' }}
      weights={{}} feedback={{}} availability={{}} disabled={false} />);
    await user.click(screen.getByText('Help evaluate suggestions (optional)'));
    await user.click(screen.getByRole('button', { name: 'Start private evaluation' }));
    expect(screen.getAllByRole('combobox').map(node => node.getAttribute('aria-label'))).toEqual([
      'Judgment for Alpha (movie)', 'Judgment for Zulu (movie)',
    ]);
    await user.selectOptions(screen.getByLabelText('Judgment for Alpha (movie)'), 'relevant');
    await user.click(screen.getByRole('button', { name: 'Download evaluation file' }));
    expect(vi.mocked(downloadTonightStudy).mock.lastCall?.[0].candidates.map(item => item.title)).toEqual(['Zulu', 'Alpha']);
  });
});

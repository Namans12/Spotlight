import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Campaign, EvidenceSection, LocalHook } from '../../../shared/types/pulse';
import type { SectionBundle } from '@/lib/pulseEvidence';
import { CampaignView } from './CampaignView';
import { EvidenceChip } from './EvidenceChip';

const ok = <T,>(data: T): EvidenceSection<T> => ({ status: 'ok', data, provenance: [] });

const bundle: SectionBundle = {
  venues: ok([{ entityId: 'v1', name: 'Blue Door Cafe', address: null, lat: null, lon: null, priceLevel: null, tags: [], affinity: 0.5 }]),
  hook: ok<LocalHook[]>([{ kind: 'filmed', placeName: 'Delhi', landmark: 'Chandni Chowk', source: 'both' }]),
};

function campaign(clauses: { text: string; evidence: string[] }[]): Campaign {
  return { groundedBy: 'qloo', ideas: [{ kind: 'social', title: 'Friday post', timing: 'Fri 7pm', clauses }] };
}

describe('CampaignView', () => {
  it('clauses with no evidence render the Agent suggestion chip', () => {
    render(<CampaignView campaign={campaign([{ text: 'Post at 7pm', evidence: [] }])} />);
    expect(screen.getByText('Post at 7pm')).toBeInTheDocument();
    expect(screen.getByText('Agent suggestion')).toBeInTheDocument();
  });

  it('renders the idea, its timing, each clause and its chips, with the label visible without hovering', () => {
    render(
      <CampaignView
        campaign={campaign([
          { text: 'Pair the filter coffee with a Chandni Chowk tie-in', evidence: ['hook:filmed', 'venue:v1'] },
          { text: 'Run it as a story', evidence: [] },
        ])}
        bundle={bundle}
        cityName="Delhi"
      />,
    );
    expect(screen.getByText('Friday post')).toBeInTheDocument();
    expect(screen.getByText('Fri 7pm')).toBeInTheDocument();
    const clause = screen.getByText('Pair the filter coffee with a Chandni Chowk tie-in').closest('li') as HTMLElement;
    expect(within(clause).getByText('Wikipedia · Films shot in Delhi')).toBeVisible();
    expect(within(clause).getByText('Wikidata · filming location')).toBeVisible();
    expect(within(clause).getByText('Qloo · places')).toBeVisible();
    expect(within(clause).queryByText('Agent suggestion')).not.toBeInTheDocument();
  });

  it('dedupes chips within a clause', () => {
    const b: SectionBundle = {
      venues: ok([
        { entityId: 'a', name: 'A', address: null, lat: null, lon: null, priceLevel: null, tags: [], affinity: null },
        { entityId: 'b', name: 'B', address: null, lat: null, lon: null, priceLevel: null, tags: [], affinity: null },
      ]),
    };
    render(<CampaignView campaign={campaign([{ text: 'Two venues', evidence: ['venue:a', 'venue:b'] }])} bundle={b} cityName="Delhi" />);
    expect(screen.getAllByText('Qloo · places')).toHaveLength(1);
  });

  it('renders without a bundle: ids still draw their label chips', () => {
    render(<CampaignView campaign={campaign([{ text: 'Cites a heat cell', evidence: ['heat:0', 'demo:25_to_29'] }])} />);
    expect(screen.getByText('Qloo · heatmap')).toBeInTheDocument();
    expect(screen.getByText('Qloo · demographics')).toBeInTheDocument();
  });
});

describe('EvidenceChip', () => {
  it('shows the underlying fact on hover and keeps it available as text', async () => {
    const user = userEvent.setup();
    render(<EvidenceChip id="venue:v1" bundle={bundle} cityName="Delhi" />);
    const chip = screen.getByRole('button', { name: /Qloo · places/ });
    expect(chip).toHaveTextContent('Blue Door Cafe'); // screen-reader text, present without hover
    await user.hover(chip);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('The venue: Blue Door Cafe');
  });

  it('an id the bundle cannot resolve is a plain label chip, not a dead button', () => {
    render(<EvidenceChip id="venue:nope" bundle={bundle} cityName="Delhi" />);
    expect(screen.getByText('Qloo · places')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a hook found by both sources renders both chips', () => {
    render(<EvidenceChip id="hook:filmed" bundle={bundle} cityName="Delhi" />);
    expect(screen.getByText('Wikipedia · Films shot in Delhi')).toBeInTheDocument();
    expect(screen.getByText('Wikidata · filming location')).toBeInTheDocument();
  });
});

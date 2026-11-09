import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReleaseEvidence } from './ReleaseEvidence';

describe('release evidence', () => {
  it('shows region, source, date and known availability without inventing missing types', () => {
    render(<ReleaseEvidence evidence={{ region: 'IN', date_source: 'tmdb_regional_digital', provider_source: 'tmdb_regional_availability', observed_at: '2026-11-09T12:00:00Z', provider_types: { Netflix: ['subscription'] } }} providers={['Netflix', 'ZEE5']} />);
    expect(screen.getByText(/Netflix \(subscription\).*ZEE5 \(type unknown\)/)).toBeInTheDocument();
    expect(screen.getByText(/Source: TMDB \/ JustWatch.*Region: IN.*Checked/)).toBeInTheDocument();
    expect(screen.getByText(/availability may change/i)).toBeInTheDocument();
  });
  it('does not imply known availability or freshness when evidence is missing', () => {
    render(<ReleaseEvidence evidence={{}} providers={[]} />);
    expect(screen.getByText('Availability unknown')).toBeInTheDocument();
    expect(screen.getByText(/Region: unknown.*Last checked: unknown/)).toBeInTheDocument();
  });
});

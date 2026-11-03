import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AgeBars } from './AgeBars';

const data = {
  age: { '24_and_younger': 0.2, '25_to_29': 0.4, '30_to_34': 0, '35_to_44': -0.1, '45_to_54': -0.2, '55_and_older': -0.4 },
  gender: { male: -0.1, female: 0.1 },
};

describe('AgeBars', () => {
  it('labels the chart as skew relative to average, not a share of people', () => {
    render(<AgeBars data={data} />);
    expect(screen.getByText('Skew relative to average — not a share of people')).toBeInTheDocument();
  });

  it('draws below-average bars left and above-average bars right, from one shared scale', () => {
    render(<AgeBars data={data} />);
    expect(screen.getByTestId('bar-25_to_29')).toHaveAttribute('data-side', 'right');
    expect(screen.getByTestId('bar-55_and_older')).toHaveAttribute('data-side', 'left');
    expect(screen.getByTestId('bar-female')).toHaveAttribute('data-side', 'right');
    expect(screen.getByTestId('bar-male')).toHaveAttribute('data-side', 'left');
    // 0.4 is the largest value, so it fills half the track; 0.2 fills a quarter.
    expect(screen.getByTestId('bar-25_to_29')).toHaveStyle({ width: '50%' });
    expect(screen.getByTestId('bar-24_and_younger')).toHaveStyle({ width: '25%' });
    expect(screen.getByTestId('bar-male')).toHaveStyle({ width: '12.5%' });
    expect(screen.queryByTestId('bar-30_to_34')).not.toBeInTheDocument(); // zero: no bar, still a row
  });

  it('prints the signed values as text, so the numbers do not depend on the drawing', () => {
    render(<AgeBars data={data} />);
    const ages = screen.getByRole('list', { name: /Age skew/ });
    expect(within(ages).getByText('25–29').closest('li')).toHaveTextContent('+0.40');
    expect(within(ages).getByText('55 and older').closest('li')).toHaveTextContent('−0.40');
    expect(within(ages).getByText('30–34').closest('li')).toHaveTextContent('0.00');
    const gender = screen.getByRole('list', { name: /Gender skew/ });
    expect(within(gender).getByText('Female').closest('li')).toHaveTextContent('+0.10');
    expect(within(gender).getByText('Male').closest('li')).toHaveTextContent('−0.10');
  });

  it('skips a bucket the data does not have rather than drawing it as zero', () => {
    render(<AgeBars data={{ age: { '25_to_29': 0.3 } as never, gender: undefined as never }} />);
    expect(screen.getByText('25–29')).toBeInTheDocument();
    expect(screen.queryByText('30–34')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /Gender/ })).not.toBeInTheDocument();
  });
});

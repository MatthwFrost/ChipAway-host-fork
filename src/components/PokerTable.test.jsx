import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PokerTable } from './PokerTable';

// The table's player bar and the nav rail show the same person. They used to
// derive that independently -- the bar's avatar was a hardcoded 'M' beside a
// hardcoded 'Matty Frost' -- so anyone else signing in got somebody else's
// name on the felt.
describe('the table player bar', () => {
  test('shows the display name and an initial drawn from it', () => {
    render(<PokerTable user={{ email: 'sarah@example.com' }} displayName="Sarah" />);
    expect(screen.getByText(/Sarah/)).toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
  });

  test('falls back to the email before the display name has loaded', () => {
    render(<PokerTable user={{ email: 'sarah@example.com' }} displayName={null} />);
    expect(screen.getByText(/sarah@example.com/)).toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
  });

  test('says Guest, with a G, when nobody is signed in', () => {
    render(<PokerTable user={null} displayName={null} />);
    expect(screen.getByText(/Guest/)).toBeInTheDocument();
    expect(screen.getByText('G')).toBeInTheDocument();
  });

  test('the name and the avatar letter can never disagree', () => {
    render(<PokerTable user={{ email: 'a@b.com' }} displayName="Zoe" />);
    expect(screen.getByText(/Zoe/)).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });
});

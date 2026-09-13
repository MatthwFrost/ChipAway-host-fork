import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { GlossaryPanel } from './GlossaryPanel';
import { EquityPanel } from './EquityPanel';
import { CoachPanel } from './CoachPanel';
import { GLOSSARY } from '../engine/glossary';

// Every term the app puts on screen has to be defined somewhere a beginner can reach.
const REQUIRED = [
  'Range', 'Hand', 'Street', 'Equity', 'Raw equity', 'Range-adjusted equity',
  'Pot odds', 'Fold equity', 'EV (Expected Value)', 'Bluff', 'Value bet',
  'Bluff catcher', 'Blocker', 'Profile', 'Nit', 'TAG', 'LAG', 'Calling station',
  'Maniac', 'Multiway pot', 'Side pot', 'All-in', 'Check', 'Call', 'Raise', 'Fold',
  // terms the coach itself uses, so they have to be defined too
  'Position', 'Made hand', 'Draw', 'Outs', 'Semi-bluff', 'Brick',
];

test('the glossary defines every term the app uses', () => {
  const defined = GLOSSARY.flatMap(({ terms }) => terms.map(([term]) => term));
  REQUIRED.forEach((term) => expect(defined).toContain(term));
});

test('every glossary entry has a plain-language definition', () => {
  GLOSSARY.forEach(({ terms }) => terms.forEach(([term, meaning]) => {
    expect(meaning.length, term).toBeGreaterThan(30);
  }));
});

test('the glossary is reachable from the page', () => {
  render(<GlossaryPanel />);
  expect(screen.getByText('Glossary — what every term means')).toBeInTheDocument();
  expect(screen.getByText('Pot odds')).toBeInTheDocument();
});

test('the coach panel is the decision output, asked for on demand', () => {
  render(<CoachPanel />);
  expect(screen.getByText('ChipAway Poker Coach')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ask the coach' })).toBeInTheDocument();
});

test('equity is its own tab, not buried in the coach dropdown', () => {
  const { container } = render(<EquityPanel />);
  expect(screen.getByText('Your equity')).toBeInTheDocument();
  // range-adjusted is the headline, inside the ring; raw sits beside it, smaller
  expect(container.querySelector('.eq-ring .eq-ring-num').id).toBe('eqAdjNum');
  expect(container.querySelector('.eq-side .eq-raw-num').id).toBe('eqRawNum');
  expect(screen.getByText(/Range-adjusted/)).toBeInTheDocument();
  expect(screen.getByText(/vs a random hand/)).toBeInTheDocument();
  expect(screen.getByText('How reliable is this?')).toBeInTheDocument();
  expect(screen.getByText(/treat a couple of points either way as the same answer/)).toBeInTheDocument();
});

test('the ring is a progress track that starts empty', () => {
  const { container } = render(<EquityPanel />);
  const ring = container.querySelector('#eqRing');
  expect(ring.getAttribute('stroke-dasharray')).toBe(ring.getAttribute('stroke-dashoffset'));
});

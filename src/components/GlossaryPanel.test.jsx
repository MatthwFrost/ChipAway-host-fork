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

test('the coach panel is a bubble for one question — nothing to press, nothing to read off', () => {
  const { container } = render(<CoachPanel />);
  expect(screen.getByLabelText('ChipAway Poker Coach')).toBeInTheDocument();
  expect(container.querySelector('#coachNudge')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
  // The verdict and the maths belong to the hand review now. A stray detail
  // node here would put the answer back on screen mid-hand.
  expect(container.querySelectorAll('details')).toHaveLength(0);
});

test('equity is just a bar — no number, no detail toggle competing for attention', () => {
  const { container } = render(<EquityPanel />);
  // the fill track is the only visible thing
  expect(container.querySelector('.win-bar-track .m-win').id).toBe('mWin');
  expect(container.querySelector('.win-bar-track .m-tie').id).toBe('mTie');
  expect(container.querySelector('.win-bar-track .m-lose').id).toBe('mLose');
  expect(container.querySelector('.win-bar-more')).toBeNull();
  // the engine still writes these numbers every render, so they stay in the
  // DOM (hidden) rather than being removed, or renderEquityTab would throw
  const hidden = container.querySelector('.win-bar-hidden');
  expect(hidden.querySelector('#eqAdjNum')).not.toBeNull();
  expect(hidden.querySelector('#eqRawNum')).not.toBeNull();
});

test('the ring is a progress track that starts empty', () => {
  const { container } = render(<EquityPanel />);
  const ring = container.querySelector('#eqRing');
  expect(ring.getAttribute('stroke-dasharray')).toBe(ring.getAttribute('stroke-dashoffset'));
});

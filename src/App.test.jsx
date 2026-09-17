import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { App } from './App';

vi.mock('./engine/initializePokerTrainer', () => ({ initializePokerTrainer: vi.fn() }));

import { initializePokerTrainer } from './engine/initializePokerTrainer';

test('renders the componentised trainer shell and starts the poker engine', () => {
  render(<App />);

  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deal hand' })).toBeEnabled();
  expect(screen.getByRole('region', { name: 'Poker table' })).toBeInTheDocument();
  // "Equity" also appears in the glossary, so pin the heading by its id
  expect(document.getElementById('equityLabel')).toHaveTextContent('Equity');
  expect(initializePokerTrainer).toHaveBeenCalledOnce();
});

test('shows the player profile and empty match result trail beneath the table', () => {
  render(<App />);

  const profile = screen.getByRole('region', { name: 'Player profile and match results' });
  expect(profile).toBeInTheDocument();
  expect(profile).toHaveTextContent('Matty Frost');
  expect(document.getElementById('matchScore')).toHaveTextContent('0-0');
  expect(document.getElementById('matchResults')).toHaveAttribute('aria-label', 'No hands completed yet');
  // The session ledger sits under the name and reads level before the first deal
  const net = document.getElementById('sessionNet');
  expect(net).toHaveTextContent('even');
  expect(net).toHaveAttribute('aria-label', 'Even for the game');
});

test('the action dock opens on the pre-hand phase with the raise tray shut', () => {
  render(<App />);

  const dock = document.getElementById('actionDock');
  expect(dock).toHaveAttribute('data-phase', 'pre');
  expect(dock).not.toHaveAttribute('data-raise');
});

test('every phase group stays mounted so the engine keeps its one-time listeners', () => {
  // The engine binds click handlers once at startup. Swapping phases by
  // unmounting buttons would leave those listeners on detached nodes, so all
  // three groups live in the DOM at once and CSS decides which one is seen.
  render(<App />);

  ['Deal hand', 'Fold', 'Check', 'Raise', 'New hand', 'Review'].forEach((name) => {
    expect(screen.getByRole('button', { name }), name).toBeInTheDocument();
  });
});

test('the bulb opens tips, and the coaching notes live inside it', () => {
  render(<App />);

  const overlay = document.getElementById('tipsOverlay');
  expect(overlay.className).not.toContain('open');

  // The engine writes both notes by id, so they must exist whether or not the
  // modal has ever been opened.
  expect(overlay.querySelector('#drift')).not.toBeNull();
  expect(overlay.querySelector('#leak')).not.toBeNull();
  // nothing flagged yet, so the bulb stays dim and the empty state stands in
  expect(document.getElementById('btnTips').className).not.toContain('has-tips');
  expect(document.getElementById('tipsBox').dataset.tips).toBe('off');

  fireEvent.click(screen.getByRole('button', { name: 'Open tips' }));
  expect(overlay.className).toContain('open');

  fireEvent.click(screen.getByRole('button', { name: 'Close tips' }));
  expect(overlay.className).not.toContain('open');
});

test('the cog beside the book opens settings', () => {
  render(<App />);

  const overlay = document.getElementById('settingsOverlay');
  expect(overlay.className).not.toContain('open');

  const actions = document.querySelector('#actionBox .panel-head-actions');
  expect(actions, 'both glyphs share one right-aligned group').toContainElement(
    screen.getByRole('button', { name: 'Open settings' }),
  );
  expect(actions).toContainElement(screen.getByRole('button', { name: 'Open the hand book' }));

  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
  expect(overlay.className).toContain('open');

  fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
  expect(overlay.className).not.toContain('open');
});

test('the equity heading has an info button on its right', () => {
  render(<App />);

  const heading = document.getElementById('equityLabel').parentElement;
  const infoButton = screen.getByRole('button', { name: 'Equity information' });

  expect(heading).toContainElement(infoButton);
  expect(infoButton).toHaveAttribute('title', 'Equity information');
});

test('the book in the Game moves head opens a ranked list of hands', () => {
  render(<App />);

  const overlay = document.getElementById('handsOverlay');
  expect(overlay.className).not.toContain('open');

  fireEvent.click(screen.getByRole('button', { name: 'Open the hand book' }));
  expect(overlay.className).toContain('open');

  // strongest first, and the names come from the evaluator
  const names = [...overlay.querySelectorAll('.hand-book-name')].map((el) => el.textContent);
  expect(names[0]).toBe('Straight flush');
  expect(names.at(-1)).toBe('High card');
  expect(names).toHaveLength(9);

  fireEvent.click(screen.getByRole('button', { name: 'Close the hand book' }));
  expect(overlay.className).not.toContain('open');
});

test('#evReview stays mounted for the engine to write into', () => {
  // Review no longer opens a modal — it flips the moves block back to the move
  // list — but renderHandReview() still writes into #evReview by id at the end
  // of every hand, so the node has to be there whether or not it is on show.
  render(<App />);

  expect(document.getElementById('evReview')).toBeInTheDocument();
});

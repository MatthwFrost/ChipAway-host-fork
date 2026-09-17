import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { App } from './App';
import { clearHands, loadHands } from './engine/handStore';
import { createGame } from './engine/games';
import { snapshotAt, stepCount } from './engine/handReplay';

/* ============================================================
   The recorder's round-trip property is proved against the headless table in
   handRecorder.test.js. What that CANNOT prove is that the app's own call
   sites are wired up: the seven actions that record through logMove, and the
   four lifecycle hooks. Those are a second, hand-written set of calls into the
   same module, and a missing one would sail past every other test.

   So this plays a real hand through the real UI and checks the record that
   comes out the far end.
   ============================================================ */

let seed = 20260908;
const realRandom = Math.random;

// The hand is played ONCE, in beforeAll, and every test asserts on the record
// it produced. initializePokerTrainer guards on window.__chipAwayInitialized
// and caches its DOM nodes by id, so a second render(<App />) gets an engine
// still holding references to the nodes the first test's cleanup removed --
// the table would never deal again.
let hand = null;

beforeAll(() => {
  vi.useFakeTimers();
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  clearHands();
  // A real player reaches the table by starting a game, and the hand is filed
  // against it. Dealing without one is possible (the felt is live on the Play
  // screen regardless) and files an orphan, which is why the gameId assertion
  // below is worth having.
  createGame({});
  hand = playOneHand();
});
afterAll(() => {
  Math.random = realRandom;
  vi.useRealTimers();
});

const settle = (ms = 4000) => vi.advanceTimersByTime(ms);

const waitForHeroTurn = () => {
  for (let i = 0; i < 40; i++) {
    if (!screen.getByRole('button', { name: 'Fold' }).disabled) return true;
    settle();
  }
  return false;
};

// Plays one hand to completion by folding as soon as hero is asked, then
// letting the bots finish it out.
function playOneHand() {
  render(<App />);
  screen.getByRole('button', { name: 'Deal hand' }).click();
  settle();
  expect(waitForHeroTurn(), 'hero never got to act').toBe(true);
  screen.getByRole('button', { name: 'Fold' }).click();
  for (let i = 0; i < 60; i++) {
    settle();
    if (loadHands().length) return loadHands()[0];
  }
  return null;
}

test('playing a hand in the app records a replayable hand', () => {
  expect(hand, 'the app never filed the hand it just played').not.toBeNull();

  // The lifecycle hooks: a deal, both blinds, and a finished result.
  expect(hand.events[0].t).toBe('deal');
  expect(hand.events.filter((e) => e.t === 'blind')).toHaveLength(2);
  expect(hand.result).not.toBeNull();
  expect(hand.config.seats).toHaveLength(6);

  // The action hook: hero's fold is in there, recorded as a fold rather than
  // as a bare log row.
  const actions = hand.events.filter((e) => e.t === 'action');
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.some((e) => e.seat === 0 && e.action === 'fold')).toBe(true);

  // Every action carries the fields replay needs. A site that forgot its
  // second argument would record the move with everything at zero.
  actions.forEach((e) => {
    expect(typeof e.put).toBe('number');
    expect(typeof e.to).toBe('number');
    expect(['fold', 'check', 'call', 'bet', 'raise']).toContain(e.action);
  });
});

test('the recorded hand replays back to the stacks the app finished with', () => {
  const seated = hand.config.seats.reduce((a, s) => a + s.stack, 0);
  const final = snapshotAt(hand, stepCount(hand) - 1);
  const awarded = hand.events.filter((e) => e.t === 'award').reduce((a, e) => a + e.amount, 0);

  // Same conservation law the headless tests assert, now across the app's own
  // recording path.
  expect(final.players.reduce((a, p) => a + p.stack + p.bet, 0) + final.pot)
    .toBe(seated + awarded);
  expect(final.players[0].stack - hand.config.seats[0].stack).toBe(hand.result.net);
});

test('the hand is filed against the live game', () => {
  // Null would mean hands and games are two unrelated piles, and project 2
  // would have no foreign key to sync them by.
  expect(hand.gameId).toBeTruthy();
});

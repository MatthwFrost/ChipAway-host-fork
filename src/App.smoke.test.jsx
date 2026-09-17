import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { App } from './App';

// Deterministic shuffles and mixed strategies, so the hand plays the same way
// every run. The engine reaches for Math.random in a dozen places; seeding it
// is the only way to make an end-to-end pass repeatable.
let seed = 20260908;
const realRandom = Math.random;
beforeAll(() => {
  vi.useFakeTimers();
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  // Runs with no Supabase config, so guest mode is the right default to get
  // past the auth gate.
  localStorage.setItem('chipaway.guest', '1');
});
afterAll(() => {
  Math.random = realRandom;
  vi.useRealTimers();
});

const settle = (ms = 4000) => vi.advanceTimersByTime(ms);

// Runs the clock until the hero is asked to act, or gives up.
const waitForHeroTurn = () => {
  for (let i = 0; i < 40; i++) {
    if (!screen.getByRole('button', { name: 'Fold' }).disabled) return true;
    settle();
  }
  return false;
};

test('deals a hand, coaches the spot, and reviews the decision afterwards', () => {
  render(<App />);
  const dock = document.getElementById('actionDock');
  expect(dock.dataset.phase, 'starts before the first hand').toBe('pre');

  // The coach is at the table before the cards are. An empty bubble on the
  // opening screen reads as nobody being home.
  expect(document.getElementById('coachNudge').textContent.length,
    'the bubble should never be empty, even before the first deal').toBeGreaterThan(8);

  screen.getByRole('button', { name: 'Deal hand' }).click();
  settle();
  expect(dock.dataset.phase, 'dealing puts the dock in play').toBe('live');

  expect(waitForHeroTurn(), 'hero never got to act').toBe(true);

  /* No chip figure ever sits inside a button label -- amounts ride in the tabs
     above them, so the three buttons keep a fixed width all hand long. */
  const labels = () => ['btnFold', 'btnCall', 'btnRaise'].map((id) => document.getElementById(id).textContent);
  const restingLabels = labels();
  // This seeded hero is facing a bet, so the price of calling is showing --
  // in the tab, never in the label.
  expect(document.getElementById('btnCall').textContent).toBe('Call');
  expect(dock.dataset.call, 'facing a bet, so the call tab is up').toBe('on');
  expect(document.getElementById('callAmt').textContent, 'call amount tab').toMatch(/^\d+$/);
  expect(dock.dataset.raise).toBeUndefined();

  screen.getByRole('button', { name: 'Raise' }).click();
  expect(dock.dataset.raise, 'first press reveals the slider').toBe('open');
  expect(document.getElementById('raiseSlider').disabled).toBe(false);
  // The amount pops up above the button, never inside it. Putting a growing
  // number in the label pushed the three flex items around every time the
  // slider moved, because a flex item will not shrink past its min-content.
  expect(labels(), 'opening the tray must not resize the buttons').toEqual(restingLabels);
  expect(document.getElementById('raiseAmt').textContent).toMatch(/^\d+$/);
  expect(document.getElementById('raiseAmt').closest('.phase-live'), 'the amount rides with the buttons').not.toBeNull();

  /* The equity tab is live without anyone asking for it */
  const raw = document.getElementById('eqRawNum').textContent;
  const adj = document.getElementById('eqAdjNum').textContent;
  expect(raw, 'raw equity').toMatch(/^\d+%$/);                // whole numbers only
  expect(adj, 'range-adjusted equity').toMatch(/^\d+% ±\d+$/); // with visible uncertainty
  expect(document.getElementById('eqReliabilityBody').textContent).toContain('give or take');

  // the ring is filled to the range-adjusted figure
  const ring = document.getElementById('eqRing');
  const circumference = Number(ring.getAttribute('stroke-dasharray'));
  const filled = 1 - Number(ring.style.strokeDashoffset) / circumference;
  expect(Math.round(100 * filled)).toBe(parseInt(adj, 10));

  // The coach speaks unprompted — there is no button to press — but it only
  // ever asks. Naming the action here would put the answer on screen mid-hand
  // and leave the review with nothing to teach.
  const nudge = document.getElementById('coachNudge').textContent;
  expect(nudge.length, 'the coach should nudge without being asked').toBeGreaterThan(20);
  expect(nudge.trim().endsWith('?'), 'a nudge is a question').toBe(true);
  expect(screen.queryByRole('button', { name: 'Ask the coach' })).toBeNull();
  expect(nudge.toLowerCase()).not.toMatch(/\bfold\b|\braise\b|\bcheck\b/);

  /* Task 6: fold, let the hand finish, and read the review */
  screen.getByRole('button', { name: 'Fold' }).click();

  // Playing a move and getting small talk back reads as not being listened to,
  // so the bubble answers the move — without grading it, which is the review's
  // job and cannot honestly be done before the runout anyway.
  const reaction = document.getElementById('coachNudge').textContent;
  expect(reaction, 'the bubble should react to the move just played').not.toBe(nudge);
  expect(reaction.length).toBeGreaterThan(8);
  expect(reaction.toLowerCase()).not.toMatch(/\b(good|bad|nice|wrong|mistake|should)\b/);

  expect(dock.dataset.raise, 'acting shuts the slider away again').toBeUndefined();
  expect(dock.dataset.call, 'and takes the call tab down with it').toBeUndefined();
  for (let i = 0; i < 60; i++) {
    settle();
    // jsdom has no layout, so visibility is read off the style the engine sets
    if (document.getElementById('guessBox').style.display === 'block') {
      screen.getByRole('button', { name: 'Skip and reveal' }).click();
    }
    if (document.getElementById('evReview').textContent.length > 0) break;
  }

  // Everything the bubble withheld is paid out here, one section per decision.
  const review = document.getElementById('evReview').textContent;
  expect(review.length, 'post-hand review never rendered').toBeGreaterThan(20);
  expect(review).toMatch(/What the coach saw/);
  expect(review, 'the street that was actually played').toMatch(/Preflop — you fold/);
  expect(review).toMatch(/Why this/);
  expect(review).toMatch(/Action frequencies/);
  expect(review).toContain('they fold');
  expect(review).toMatch(/Pot odds|EV\(/);

  /* The nameplate keeps the running total for the whole session. This hero
     raised and then folded, so the game is down by the chips left behind. */
  const net = document.getElementById('sessionNet');
  const figure = net.querySelector('.earned-figure');
  expect(figure.textContent, 'session ledger after a losing hand').toMatch(/^−\d+$/);
  expect(figure.className).toContain('neg');
  const lost = Number(figure.textContent.slice(1));
  // Terse on screen, spelled out for a screen reader
  expect(net.textContent.trim()).toBe('−' + lost + 'chips');
  expect(net.getAttribute('aria-label')).toBe('Down ' + lost + ' chips for the game');

  /* A finished hand offers a new one and a look back, not the betting buttons */
  expect(dock.dataset.phase, 'a finished hand ends in the post phase').toBe('post');
  screen.getByRole('button', { name: 'New hand' }).click();
  settle();
  expect(dock.dataset.phase, 'New hand deals again').toBe('live');
});

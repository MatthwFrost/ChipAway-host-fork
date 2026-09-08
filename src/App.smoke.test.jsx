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
  screen.getByRole('button', { name: 'Deal hand' }).click();
  settle();

  expect(waitForHeroTurn(), 'hero never got to act').toBe(true);

  /* The equity tab is live without anyone asking for it */
  const raw = document.getElementById('eqRawNum').textContent;
  const adj = document.getElementById('eqAdjNum').textContent;
  expect(raw, 'raw equity').toMatch(/^\d+%$/);                // whole numbers only
  expect(adj, 'range-adjusted equity').toMatch(/^\d+% ±\d+$/); // with visible uncertainty
  expect(document.getElementById('eqReliabilityBody').textContent).toContain('95% confidence');

  // the ring is filled to the range-adjusted figure
  const ring = document.getElementById('eqRing');
  const circumference = Number(ring.getAttribute('stroke-dasharray'));
  const filled = 1 - Number(ring.style.strokeDashoffset) / circumference;
  expect(Math.round(100 * filled)).toBe(parseInt(adj, 10));

  // the coach itself stays behind the button until asked
  expect(document.getElementById('coachVerdict').textContent).toBe('');
  screen.getByRole('button', { name: 'Ask the coach' }).click();

  const verdict = document.getElementById('coachVerdict').textContent;
  expect(verdict.length).toBeGreaterThan(20);
  const lines = document.getElementById('coachLines').textContent;
  expect(lines).toMatch(/equity/);
  expect(lines, 'position should always be mentioned').toMatch(/You are |You act last|first to act/);
  expect(document.getElementById('coachFreqBody').textContent).toContain('they fold');
  expect(document.getElementById('coachMathsBody').textContent).toMatch(/Pot odds|EV\(/);

  /* Task 6: fold, let the hand finish, and read the review */
  screen.getByRole('button', { name: 'Fold' }).click();
  for (let i = 0; i < 60; i++) {
    settle();
    // jsdom has no layout, so visibility is read off the style the engine sets
    if (document.getElementById('guessBox').style.display === 'block') {
      screen.getByRole('button', { name: 'Skip and reveal' }).click();
    }
    if (document.getElementById('evReview').textContent.length > 0) break;
  }

  const review = document.getElementById('evReview').textContent;
  expect(review.length, 'post-hand review never rendered').toBeGreaterThan(20);
  expect(review).toMatch(/Street by street/);
  expect(review).toMatch(/Show the maths/);
});

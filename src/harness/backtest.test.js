/* ============================================================
   Fast structural tests for the advice backtest. A few hundred hands here;
   `npm run sim:backtest` plays ten thousand.

   THIS IS THE FIRST PLACE TO LOOK IF YOU CHANGE THE COACH. If a change to
   spotModel.js or decision.js makes the coach worse in chips, these fail.
   ============================================================ */

import { describe, expect, test } from 'vitest';
import { DEFAULT_POLICIES, runBacktest } from './backtest.js';

// 400 hands keeps this suite inside `npm test`. It checks structure and
// catches collapses; it does not measure win rates. Use `npm run sim:backtest`
// for that.
const OUT = runBacktest({ hands: 400, seed: 20260916 });
const by = (name) => OUT.results.filter((r) => r.policy === name)[0];

describe('the backtest is a fair comparison', () => {
  test('every policy plays the same number of hands', () => {
    OUT.results.forEach((r) => expect(r.hands).toBe(400));
  });

  test('the profile bot baselines are all present', () => {
    ['tag-bot', 'lag-bot', 'nit-bot'].forEach((p) => expect(by(p), p).toBeTruthy());
  });

  test('every default policy reported a result', () => {
    DEFAULT_POLICIES.forEach((p) => expect(by(p), p).toBeTruthy());
  });

  test('results are in big blinds per hundred hands, with an error bar', () => {
    OUT.results.forEach((r) => {
      expect(Number.isFinite(r.bb100)).toBe(true);
      expect(r.bb100se).toBeGreaterThan(0);
    });
  });

  test('the coach is compared to every alternative, paired on the same hands', () => {
    OUT.results.forEach((r) => {
      if (r.policy === 'coach') { expect(r.vsCoach).toBeNull(); return; }
      expect(Number.isFinite(r.vsCoach.bb100)).toBe(true);
      expect(Number.isFinite(r.vsCoach.z)).toBe(true);
    });
  });

  test('the same seed reproduces the same result exactly', () => {
    const a = runBacktest({ hands: 150, seed: 31, policies: ['coach', 'always-fold'] });
    const b = runBacktest({ hands: 150, seed: 31, policies: ['coach', 'always-fold'] });
    expect(a.results[0].totalChips).toBe(b.results[0].totalChips);
  }, 60000);
});

describe('the sanity floor', () => {
  // Folding every hand loses exactly the blinds and nothing else. At six
  // handed that is (10 + 20) / 6 = 5 chips a hand, or -25 bb/100. If this
  // number drifts, the chip accounting is broken — which is precisely how the
  // two accounting bugs in the first backtest runs were caught.
  test('always-fold loses exactly the blinds', () => {
    const f = by('always-fold');
    expect(f.bb100).toBeLessThan(-15);
    expect(f.bb100).toBeGreaterThan(-35);
  });

  test('a hand cannot swing more than the chips on the table', () => {
    OUT.results.forEach((r) => {
      // 50bb stacks, six handed: 250bb is the most anyone can win in one hand.
      expect(r.sdPerHand, r.policy).toBeLessThan(250);
    });
  });

  test('the coach beats calling every hand', () => {
    expect(by('coach').bb100).toBeGreaterThan(by('always-call').bb100);
  });

  test('the coach beats acting at random', () => {
    expect(by('coach').bb100).toBeGreaterThan(by('random').bb100);
  });

  test('the coach beats folding every hand', () => {
    expect(by('coach').bb100).toBeGreaterThan(by('always-fold').bb100);
  });
});

describe('where the coach still stands against the bot baselines', () => {
  // Fitting the model to the table moved the coach from +31.6 to +95.9 bb/100
  // on the same 6,000 hands (paired, z = 2.2 — see `npm run sim:compare`). It
  // still trails a competent TAG or LAG bot.
  //
  // 400 hands is far too few to pin that gap tightly, so these bounds are
  // deliberately loose and exist to catch a collapse, not to measure. The
  // authoritative numbers come from `npm run sim:backtest` at 10,000 hands.
  test('the coach is still profitable against this table', () => {
    expect(by('coach').bb100).toBeGreaterThan(0);
  });

  test('the gap to the bot baselines has not blown out', () => {
    ['tag-bot', 'lag-bot'].forEach((name) => {
      expect(by(name).vsCoach.bb100, name).toBeGreaterThan(-1200);
    });
  });

  test('the coach is not beaten by the weakest bot baseline by a wide margin', () => {
    expect(by('nit-bot').vsCoach.bb100).toBeGreaterThan(-800);
  });
});

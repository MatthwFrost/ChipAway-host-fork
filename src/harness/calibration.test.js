/* ============================================================
   Fast structural tests for the calibration harness. These run a few hundred
   hands so they belong in `npm test`; the real measurement is `npm run
   sim:calibrate`, which plays ten thousand.

   The thresholds below record the model's CURRENT accuracy. They are
   deliberately written as "no worse than this", so tightening the model makes
   them pass with room to spare and loosening it fails the build.
   ============================================================ */

import { describe, expect, test } from 'vitest';
import { runCalibration } from './calibration.js';
import { PROFILES, PROFILE_KEYS } from '../engine/opponentModel.js';

// 3,000 hands gives every profile several hundred postflop decisions, which is
// enough for a 6-point TVD ceiling to mean something. The authoritative
// measurement is `npm run sim:calibrate` at 10,000.
const RESULT = runCalibration({ hands: 3000, seed: 20260916 });

describe('the harness measures something', () => {
  test('every profile gets sampled', () => {
    PROFILE_KEYS.forEach((k) => {
      expect(RESULT.profiles[k], k).toBeTruthy();
      expect(RESULT.profiles[k].n).toBeGreaterThan(20);
    });
  });

  test('both sides of the comparison are probability distributions', () => {
    PROFILE_KEYS.forEach((k) => {
      const c = RESULT.profiles[k];
      const a = c.actual.fold + c.actual.call + c.actual.raise;
      const p = c.predicted.fold + c.predicted.call + c.predicted.raise;
      expect(a, k + ' actual').toBeCloseTo(1, 6);
      expect(p, k + ' predicted').toBeCloseTo(1, 6);
    });
  });

  test('total variation distance is a distance', () => {
    PROFILE_KEYS.forEach((k) => {
      expect(RESULT.profiles[k].tvd).toBeGreaterThanOrEqual(0);
      expect(RESULT.profiles[k].tvd).toBeLessThanOrEqual(1);
    });
  });

  test('the same seed measures the same thing twice', () => {
    const again = runCalibration({ hands: 200, seed: 5 });
    const once = runCalibration({ hands: 200, seed: 5 });
    expect(again.profiles.maniac.actual.fold).toBe(once.profiles.maniac.actual.fold);
  }, 60000);
});

describe('what the bots actually do', () => {
  // These are facts about the simulation, independent of the model. If the
  // profile parameters are ever retuned, these are the first things to move.
  test('the tight profiles fold more than the loose ones', () => {
    const f = (k) => RESULT.profiles[k].actual.fold;
    expect(f('nit')).toBeGreaterThan(f('lag'));
    expect(f('nit')).toBeGreaterThan(f('station'));
    expect(f('tag')).toBeGreaterThan(f('maniac'));
  });

  test('a calling station really does call', () => {
    expect(RESULT.profiles.station.actual.call).toBeGreaterThan(0.6);
    expect(RESULT.profiles.station.actual.raise).toBeLessThan(0.12);
  });

  test('a maniac really does play back', () => {
    expect(RESULT.profiles.maniac.actual.raise).toBeGreaterThan(0.1);
  });
});

describe('the model is calibrated against the table', () => {
  // Before any fitting, at 10,000 hands seed 20260916:
  //   nit +9.7  tag +14.2  lag +18.1  station +29.9  maniac +24.4
  // (percentage points of fold rate, model minus reality), TVD 12.5-29.9.
  //
  // After fitting with `npm run sim:tune`: TVD 2.0-5.3, cTVD 7.6-13.0.
  //
  // TWO metrics, and the distinction matters. TVD is the marginal action mix.
  // cTVD is the same thing measured WITHIN bet-size buckets. A model can sit at
  // a marginal TVD near zero while being 15 points out at every individual bet
  // size, and it is the conditional figure that tracks advice quality: refitting
  // from the marginal objective to the conditional one made TVD WORSE and the
  // coach roughly 50 bb/100 BETTER. Both are asserted; cTVD is the one to care
  // about.
  const TVD_CEILING = 0.09;
  const CTVD_CEILING = 0.17;

  test('every profile predicts the marginal action mix to within 9 points', () => {
    const bad = [];
    PROFILE_KEYS.forEach((k) => {
      const c = RESULT.profiles[k];
      if (c.tvd > TVD_CEILING) bad.push(k + ' TVD ' + (100 * c.tvd).toFixed(1));
    });
    expect(bad).toEqual([]);
  }, 60000);

  test('every profile is calibrated within bet-size buckets too', () => {
    const bad = [];
    PROFILE_KEYS.forEach((k) => {
      const c = RESULT.profiles[k];
      if (c.cTvd === undefined) return;
      if (c.cTvd > CTVD_CEILING) bad.push(k + ' cTVD ' + (100 * c.cTvd).toFixed(1));
    });
    expect(bad).toEqual([]);
  }, 60000);

  test('no profile has its fold rate out by more than 9 points either way', () => {
    const bad = [];
    PROFILE_KEYS.forEach((k) => {
      const e = RESULT.profiles[k].error.fold;
      if (Math.abs(e) > 0.09) bad.push(k + ' ' + (100 * e).toFixed(1));
    });
    expect(bad).toEqual([]);
  }, 60000);

  test('the error is no longer one-directional', () => {
    // The old model over-predicted folding for all five profiles. A fitted
    // model should scatter around zero instead of sitting on one side of it.
    const errs = PROFILE_KEYS.map((k) => RESULT.profiles[k].error.fold);
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
  });

  test('the model discriminates between profiles as sharply as the table does', () => {
    // The old model predicted 38-47% fold across all five styles where reality
    // spanned 12-37% — it barely told them apart.
    const spread = (pick) => {
      const xs = PROFILE_KEYS.map((k) => pick(RESULT.profiles[k]));
      return Math.max(...xs) - Math.min(...xs);
    };
    const real = spread((c) => c.actual.fold);
    const model = spread((c) => c.predicted.fold);
    expect(model).toBeGreaterThan(real * 0.8);
    expect(model).toBeLessThan(real * 1.25);
  });

  test('preflop and postflop are each calibrated, not just their average', () => {
    // They used to have errors of opposite sign — preflop under-predicted
    // folding by 16-27 points while postflop over-predicted by 15-31 — which a
    // single blended number hid entirely.
    const both = runCalibration({ hands: 1500, seed: 20260916, postflopOnly: false });
    ['preflop', 'postflop'].forEach((regime) => {
      PROFILE_KEYS.forEach((k) => {
        const c = both.streets[regime] && both.streets[regime][k];
        if (!c || c.n < 50) return;
        expect(Math.abs(c.error.fold), regime + ' ' + k).toBeLessThan(0.12);
      });
    });
  }, 120000);

  test('position is part of the preflop model', () => {
    // The bots scale their preflop continuing range by posMult x fieldBoost, so
    // a model without a positional term predicts one number for the button and
    // for under the gun. Adding it took station's worst preflop bucket from
    // 57.3 to 16.1.
    const wide = PROFILE_KEYS.filter((k) => PROFILES[k].posWeight > 0);
    expect(wide.length).toBe(PROFILE_KEYS.length);
    // The loosest profiles are the most position-sensitive, which is what the
    // fit found rather than what it was told.
    expect(PROFILES.station.posWeight).toBeGreaterThan(PROFILES.tag.posWeight);
    expect(PROFILES.maniac.posWeight).toBeGreaterThan(PROFILES.tag.posWeight);
  });
});

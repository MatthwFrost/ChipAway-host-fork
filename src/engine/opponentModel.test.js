import { describe, expect, test } from 'vitest';
import {
  BLUFF_TOP, HERO_PROF, PROFILES, PROFILE_KEYS,
  afterAggro, afterCall, afterCheck, airContinueRate, breakEvenFold, evOfBet,
  evOfCall, foldChance, jointResponse, raiseBranchValue, rangeWidth, reRaiseShare,
  requiredEquity, responseTo,
} from './opponentModel.js';

const FLOP = { preflop: false, bigBlind: 20, currentBet: 96, heroState: { rLo: 0.35, rBluff: 0 } };
const PRE = { preflop: true, bigBlind: 20, currentBet: 20, heroState: { rLo: 0, rBluff: 0 } };

// The range a profile shows after making its own standard-sized bet.
const shown = (key) => afterAggro({ rLo: 0, rBluff: 0 }, PROFILES[key], PROFILES[key].sizing);

describe('the response is a probability distribution', () => {
  test.each(PROFILE_KEYS)('%s folds, calls or raises and nothing else', (key) => {
    const r = responseTo(shown(key), PROFILES[key], 250, 213, FLOP);
    expect(r.fold + r.call + r.raise).toBeCloseTo(1, 10);
    [r.fold, r.call, r.raise].forEach((x) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    });
  });

  test.each(PROFILE_KEYS)('%s is a distribution preflop too', (key) => {
    const r = responseTo({ rLo: 0.2, rBluff: 0.1 }, PROFILES[key], 60, 50, PRE);
    expect(r.fold + r.call + r.raise).toBeCloseTo(1, 10);
  });
});

describe('air does not surrender on command', () => {
  // The bug this replaced: the bluff band was priced by CARD strength against a
  // continue threshold it could never clear, so 100% of EVERY player's air
  // folded to any bet, whoever was holding it. The more a style bluffed, the
  // easier it was to bluff — which is backwards, and is what produced "the
  // maniac folds 73% of the time".
  //
  // The fix is that air is priced on APPETITE, and appetite is a property of
  // the style. These values are now fitted to the bots by `npm run sim:tune`
  // rather than reasoned, and the fit put nit's at zero: a nit holds almost no
  // air (about 2% of its range) and gives up what little it has. That is a
  // finding, not a regression — what must never come back is air folding at a
  // flat 100% for everyone.
  test('air persistence is a property of the style, not a constant', () => {
    const rates = PROFILE_KEYS.map((k) => airContinueRate(PROFILES[k], 250, 213, false));
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(0.4);
  });

  test('the bluff-heavy styles keep firing with air; the tight ones do not', () => {
    const rate = (k) => airContinueRate(PROFILES[k], 250, 213, false);
    expect(rate('maniac')).toBeGreaterThan(0.5);
    expect(rate('maniac')).toBeGreaterThan(rate('lag'));
    expect(rate('lag')).toBeGreaterThan(rate('nit'));
    expect(rate('nit')).toBeLessThan(0.15);
  });

  test('a bigger bet never folds out less air than a small one', () => {
    PROFILE_KEYS.forEach((key) => {
      expect(airContinueRate(PROFILES[key], 300, 200, false))
        .toBeLessThanOrEqual(airContinueRate(PROFILES[key], 60, 200, false));
    });
  });

  // NOTE: there is deliberately no test that "more air means no more folds"
  // WITHIN a profile. Holding a weaker range really does mean folding more —
  // that part was never wrong. The bug was that air folded identically for
  // everyone, which is what the two tests above pin down, and the cross-profile
  // ordering below is what it actually broke.
  test('a bluffier style is not easier to bluff than a tighter one', () => {
    // Same hypothetical range for both, so only the style differs.
    const range = { rLo: 0.45, rBluff: 0.35 };
    const fold = (k) => responseTo(range, PROFILES[k], 250, 213, FLOP).fold;
    expect(fold('maniac')).toBeLessThan(fold('nit'));
    expect(fold('lag')).toBeLessThan(fold('tag'));
    expect(fold('station')).toBeLessThan(fold('tag'));
  });
});

describe('stickiness ordering', () => {
  // Each profile facing the same raise, having shown the same range. The
  // ordering is the whole point: a style defined by never letting go must not
  // price out as more foldable than a style defined by folding.
  const sameRange = { rLo: 0.45, rBluff: 0.20 };
  const foldOf = (key) => responseTo(sameRange, PROFILES[key], 250, 213, FLOP).fold;

  test('a nit folds more than a TAG, which folds more than a LAG', () => {
    expect(foldOf('nit')).toBeGreaterThan(foldOf('tag'));
    expect(foldOf('tag')).toBeGreaterThan(foldOf('lag'));
  });

  test('a maniac folds less than a LAG and far less than a nit', () => {
    expect(foldOf('maniac')).toBeLessThan(foldOf('lag'));
    expect(foldOf('maniac')).toBeLessThan(foldOf('nit') / 2);
  });

  test('the loose profiles let go far less than the tight ones', () => {
    // NOT simply the callBuffer ordering. callBuffer says maniac (-0.21) is
    // looser than station (-0.17), but the table disagrees: measured over
    // 10,000 hands the station folds 21.6% and the maniac 24.3%, so the station
    // is the harder of the two to move. The fitted model reproduces that, and
    // this test tracks the measurement rather than the parameter it was once
    // assumed to follow.
    ['nit', 'tag'].forEach((tight) => {
      ['station', 'maniac'].forEach((loose) => {
        expect(foldOf(loose), loose + ' vs ' + tight).toBeLessThan(foldOf(tight));
      });
    });
    expect(foldOf('lag')).toBeLessThan(foldOf('tag'));
  });

  test('the two styles that never let go are both well clear of the tight ones', () => {
    expect(foldOf('station')).toBeLessThan(foldOf('tag') * 0.75);
    expect(foldOf('maniac')).toBeLessThan(foldOf('tag') * 0.75);
  });

  test('a station continues by calling, not by raising', () => {
    const s = responseTo(sameRange, PROFILES.station, 250, 213, FLOP);
    expect(s.call).toBeGreaterThan(s.raise * 10);
    // Measured: the station raises 8.6% of the time it faces a bet, the lowest
    // of the five, and the fitted reRaise of 0.04 is the lowest too.
    PROFILE_KEYS.filter((k) => k !== 'station').forEach((k) => {
      expect(PROFILES.station.reRaise).toBeLessThan(PROFILES[k].reRaise);
    });
  });

  test('at the range they actually show, a station is the one you cannot move', () => {
    const foldShown = (k) => responseTo(shown(k), PROFILES[k], 250, 213, FLOP).fold;
    PROFILE_KEYS.filter((k) => k !== 'station').forEach((k) => {
      expect(foldShown('station')).toBeLessThan(foldShown(k));
    });
  });
});

describe('price elasticity', () => {
  test.each(PROFILE_KEYS)('%s folds more to a bigger bet', (key) => {
    const st = shown(key);
    const small = responseTo(st, PROFILES[key], 60, 200, FLOP).fold;
    const big = responseTo(st, PROFILES[key], 400, 200, FLOP).fold;
    expect(big).toBeGreaterThanOrEqual(small);
  });

  test.each(PROFILE_KEYS)('%s re-raises a smaller share of the time against a bigger bet', (key) => {
    expect(reRaiseShare(PROFILES[key], 400, 200)).toBeLessThan(reRaiseShare(PROFILES[key], 60, 200));
  });
});

describe('re-raising is modelled, not assumed away', () => {
  test('the aggressive styles play back and the passive ones do not', () => {
    const r = (key) => responseTo(shown(key), PROFILES[key], 250, 213, FLOP).raise;
    expect(r('maniac')).toBeGreaterThan(0.1);
    expect(r('station')).toBeLessThan(0.05);
    expect(r('lag')).toBeGreaterThan(r('station'));
    // How often a style raises OVERALL is a claim about the spots it gets into,
    // not about one artificial spot, so it is checked in calibration.test.js
    // against the measured rates rather than re-derived here.
  });

  test('a bet into a jamming opponent is worth less than one into a folder', () => {
    const P = 213, B = 250, e = 0.38;
    const folds = { fold: 0.6, call: 0.38, raise: 0.02 };
    const jams = { fold: 0.46, call: 0.35, raise: 0.19 };
    expect(evOfBet(e, P, B, jams)).toBeLessThan(evOfBet(e, P, B, folds));
  });

  test('pricing a raise as if it were a call overstates the bet', () => {
    // The old formula: everything that is not a fold is a call.
    const P = 213, B = 250, e = 0.38;
    const r = { fold: 0.46, call: 0.35, raise: 0.19 };
    const asIfNoRaise = { fold: r.fold, call: r.call + r.raise, raise: 0 };
    expect(evOfBet(e, P, B, r)).toBeLessThan(evOfBet(e, P, B, asIfNoRaise));
  });

  test('a bare fold number is read as fold-or-call, never as a raise', () => {
    const P = 150, B = 120, e = 0.3;
    expect(evOfBet(e, P, B, 0.4)).toBeCloseTo(evOfBet(e, P, B, { fold: 0.4, call: 0.6, raise: 0 }), 10);
  });
});

describe('the joint response over a field', () => {
  test('everyone folding is the product of each of them folding', () => {
    const reads = [{ fold: 0.5, call: 0.5, raise: 0 }, { fold: 0.4, call: 0.6, raise: 0 }];
    expect(jointResponse(reads).fold).toBeCloseTo(0.2, 10);
  });

  test('anyone raising is one minus nobody raising', () => {
    const reads = [{ fold: 0.3, call: 0.5, raise: 0.2 }, { fold: 0.3, call: 0.5, raise: 0.2 }];
    expect(jointResponse(reads).raise).toBeCloseTo(1 - 0.8 * 0.8, 10);
  });

  test('the field response stays a distribution', () => {
    const reads = [
      { fold: 0.2, call: 0.4, raise: 0.4 },
      { fold: 0.3, call: 0.4, raise: 0.3 },
      { fold: 0.6, call: 0.3, raise: 0.1 },
    ];
    const j = jointResponse(reads);
    expect(j.fold + j.call + j.raise).toBeCloseTo(1, 10);
    expect(j.fold).toBeGreaterThanOrEqual(0);
    expect(j.call).toBeGreaterThanOrEqual(0);
  });

  test('a bigger field is harder to fold out than any one of its members', () => {
    const reads = [{ fold: 0.6, call: 0.4, raise: 0 }, { fold: 0.6, call: 0.4, raise: 0 }];
    const j = jointResponse(reads);
    expect(j.fold).toBeLessThan(0.6);
  });

  test('no opponents means nothing to get through', () => {
    expect(jointResponse([]).fold).toBe(0);
  });
});

describe('range narrowing', () => {
  test('betting narrows the value range and opens a bluff band', () => {
    const after = afterAggro({ rLo: 0, rBluff: 0 }, PROFILES.tag, 0.65);
    expect(after.rLo).toBeGreaterThan(0);
    expect(after.rBluff).toBeGreaterThan(0);
  });

  test('a maniac betting shows 42% air, a nit almost none', () => {
    expect(Math.round(100 * shown('maniac').rBluff)).toBe(42);
    expect(shown('nit').rBluff).toBeLessThan(0.05);
  });

  test('calling cuts the air right down, checking only trims it', () => {
    const aggro = afterAggro({ rLo: 0, rBluff: 0 }, PROFILES.lag, 0.72);
    expect(afterCall(aggro, PROFILES.lag).rBluff).toBeLessThan(afterCheck(aggro).rBluff);
  });

  test('a range never widens as the hand goes on', () => {
    const a = afterAggro({ rLo: 0.5, rBluff: 0.1 }, PROFILES.tag, 0.65);
    expect(a.rLo).toBeGreaterThanOrEqual(0.5);
    expect(afterCall(a, PROFILES.tag).rLo).toBeGreaterThanOrEqual(a.rLo);
  });

  test('range width counts the bluff band at its own top, not the whole range', () => {
    const st = { rLo: 0.6, rBluff: 0.5 };
    expect(rangeWidth(st)).toBeCloseTo(((1 - 0.6) * 0.5 + BLUFF_TOP * 0.5) * 100, 6);
  });

  test('hero is modelled with the same machinery as everyone else', () => {
    expect(HERO_PROF.sigRaise).toBeGreaterThan(0);
    const r = responseTo({ rLo: 0.4, rBluff: 0.1 }, HERO_PROF, 100, 150, FLOP);
    expect(r.fold + r.call + r.raise).toBeCloseTo(1, 10);
  });
});

describe('pricing', () => {
  // MATHS.md §4 and §6
  test('a half-pot bet needs 25% equity to call', () => {
    expect(requiredEquity(50, 150)).toBeCloseTo(0.25, 6);
  });

  test('break-even bluff frequency for a pot-sized bet is one half', () => {
    expect(breakEvenFold(100, 100)).toBeCloseTo(0.5, 6);
  });

  test('EV(call) follows the formula in the docs', () => {
    expect(evOfCall(0.4, 200, 50)).toBeCloseTo(0.4 * 200 - 0.6 * 50, 10);
  });

  test('a bet that is always folded to wins exactly the pot', () => {
    expect(evOfBet(0.2, 150, 100, { fold: 1, call: 0, raise: 0 })).toBeCloseTo(150, 10);
  });

  test('a bet that is always raised, with no hand, loses exactly the bet', () => {
    expect(evOfBet(0, 150, 100, { fold: 0, call: 0, raise: 1 })).toBeCloseTo(-100, 10);
  });

  test('being raised with a strong hand is better than forfeiting the bet', () => {
    // Hero is not obliged to fold to a re-raise. Pricing the branch as a flat
    // forfeit of B understated every bet in the model.
    const strong = evOfBet(0.9, 150, 100, { fold: 0, call: 0, raise: 1 });
    expect(strong).toBeGreaterThan(-100);
    expect(raiseBranchValue(0.9, 150, 100)).toBeGreaterThan(raiseBranchValue(0.2, 150, 100));
  });

  test('the raise branch is never worse than folding to the raise', () => {
    [0, 0.1, 0.4, 0.7, 1].forEach((e) => {
      expect(raiseBranchValue(e, 200, 120)).toBeGreaterThanOrEqual(-120);
    });
  });

  test('foldChance is the fold leg of the response and nothing else', () => {
    const st = shown('lag');
    expect(foldChance(st, PROFILES.lag, 250, 213, FLOP))
      .toBeCloseTo(responseTo(st, PROFILES.lag, 250, 213, FLOP).fold, 12);
  });
});

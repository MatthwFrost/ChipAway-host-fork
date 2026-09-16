import { describe, expect, test } from 'vitest';
import {
  BLUFFABLE_FLOOR, JAM_RISK_FLOOR, STICKY_CEILING,
  actionFamily, assessBluff, buildSpotModel, checkModelConsistency, counterPlan,
  decisionClarity, foldBand, foldinessWord, pctWhole, requiredEquity, tableFoldRead,
} from './spotModel.js';

const opp = (over = {}) => ({
  name: 'Idris', styleLabel: 'Maniac', rangeTopPct: 52, airPct: 42,
  response: { fold: 0.46, call: 0.35, raise: 0.19 }, ...over,
});

const spot = (over = {}) => ({
  streetName: 'Flop', toCall: 96, pot: 213,
  rawEquity: 0.43, rangeEquity: 0.46, decisionEquity: 0.46, equitySe: 0.016,
  degradedShare: 0, trials: 900,
  opponents: [opp()],
  options: [
    { label: 'fold', ev: 0, amount: 0, evSe: 0 },
    { label: 'call 96', ev: 46, amount: 96, evSe: 6 },
    { label: 'raise to 250 (½ pot)', ev: 59, amount: 250, fold: 0.46, raise: 0.19, eCalled: 0.38, evSe: 14 },
  ],
  recommended: { label: 'raise to 250 (½ pot)', ev: 59, amount: 250, fold: 0.46, raise: 0.19, eCalled: 0.38, evSe: 14 },
  revealStyles: false,
  villain: { name: 'Idris' },
  field: { live: 1, contesting: 1, expectedFolds: 0 },
  blockerPct: 9, shape: null,
  position: { name: 'BTN', actsLast: true, preflop: false, credit: 0.035 },
  ...over,
});

describe('one fold ladder for the whole app', () => {
  test('the bands are contiguous and ordered', () => {
    expect(foldBand(0.9).key).toBe('often');
    expect(foldBand(0.55).key).toBe('often');
    expect(foldBand(0.54).key).toBe('enough');
    expect(foldBand(BLUFFABLE_FLOOR).key).toBe('enough');
    expect(foldBand(BLUFFABLE_FLOOR - 0.01).key).toBe('seldom');
    expect(foldBand(STICKY_CEILING).key).toBe('seldom');
    expect(foldBand(STICKY_CEILING - 0.01).key).toBe('never');
  });

  test('only the two upper bands are bluffable, and the floor is where it says', () => {
    expect(foldBand(BLUFFABLE_FLOOR).bluffable).toBe(true);
    expect(foldBand(BLUFFABLE_FLOOR - 0.001).bluffable).toBe(false);
  });

  test('the word and the band are the same decision', () => {
    [0.05, 0.2, 0.4, 0.7].forEach((f) => {
      expect(foldinessWord(f)).toBe(foldBand(f).word);
    });
  });

  test('a missing read is treated as never folding, not as a coin flip', () => {
    expect(foldBand(null).key).toBe('never');
    expect(foldBand(undefined).key).toBe('never');
  });
});

describe('the bluff assessment', () => {
  const at = (fold, raise, B = 250, P = 213) =>
    assessBluff({ fold, raise }, B, P, [{ fold, call: 1 - fold - raise, raise }]);

  test('needs the price AND the person, not either one', () => {
    // clears the price but the style never folds: not a bluff
    expect(at(0.3, 0, 60, 100).viable).toBe(false);
    // folds plenty but the size is too big to pay for itself: not a bluff
    expect(at(0.5, 0, 400, 100).viable).toBe(false);
    // both: a bluff
    expect(at(0.6, 0, 120, 200).viable).toBe(true);
  });

  test('names which of the three tests failed', () => {
    expect(at(0.1, 0, 120, 200).blockedBy).toBe('stickiness');
    expect(at(0.4, 0, 400, 200).blockedBy).toBe('price');
    expect(at(0.6, 0.3, 120, 200).blockedBy).toBe('reraise');
    expect(at(0.6, 0, 120, 200).blockedBy).toBeNull();
  });

  test('a real chance of being played back at kills the bluff', () => {
    expect(at(0.6, JAM_RISK_FLOOR, 120, 200).viable).toBe(false);
    expect(at(0.6, JAM_RISK_FLOOR - 0.01, 120, 200).viable).toBe(true);
  });

  test('headroom is folds minus the break-even, signed', () => {
    const a = at(0.6, 0, 100, 100);
    expect(a.breakEven).toBeCloseTo(0.5, 10);
    expect(a.headroom).toBeCloseTo(0.1, 10);
  });
});

describe('the model is built once and agrees with itself', () => {
  const model = buildSpotModel(spot());

  test('the reported spot passes every invariant', () => {
    expect(checkModelConsistency(model)).toEqual([]);
  });

  test('the bluff verdict uses the recommended size, not a different one', () => {
    expect(model.bluff.refAmount).toBe(250);
    expect(model.bluff.folds).toBeCloseTo(0.46, 10);
    expect(model.bluff.breakEven).toBeCloseTo(250 / 463, 10);
  });

  test('a half-pot raise against a maniac is not a bluff', () => {
    expect(model.bluff.viable).toBe(false);
    expect(model.bluff.blockedBy).toBe('price');
  });

  test('the equity the decision was made on is kept distinct from the headline', () => {
    const m = buildSpotModel(spot({ rangeEquity: 0.2, decisionEquity: 0.31 }));
    expect(m.equity.rangePct).toBe(20);
    expect(m.equity.decisionPct).toBe(31);
  });

  test('a missing decision equity falls back to the range figure', () => {
    const m = buildSpotModel(spot({ decisionEquity: undefined }));
    expect(m.equity.decisionPct).toBe(m.equity.rangePct);
  });

  test('an opponent given only a fold chance is not credited with never raising', () => {
    const m = buildSpotModel(spot({
      opponents: [{ name: 'Sofia', rangeTopPct: 18, airPct: 4, foldChance: 0.12 }],
      options: [
        { label: 'fold', ev: 0, amount: 0 },
        { label: 'bet 120 (¾ pot)', ev: -8, amount: 120, fold: 0.12 },
      ],
    }));
    expect(m.opponents[0].responseKnown).toBe(false);
    expect(m.opponents[0].raise).toBe(0);
  });
});

describe('the invariants actually catch things', () => {
  test('a response that is not a distribution is rejected', () => {
    const m = buildSpotModel(spot());
    m.opponents[0].call = 0.9;
    expect(checkModelConsistency(m).map((v) => v.code)).toContain('response-not-a-distribution');
  });

  test('a bet claiming folds its own opponents do not give is rejected', () => {
    const m = buildSpotModel(spot({
      options: [
        { label: 'fold', ev: 0, amount: 0, evSe: 0 },
        { label: 'raise to 250 (½ pot)', ev: 59, amount: 250, fold: 0.73, raise: 0.19, eCalled: 0.38, evSe: 14 },
      ],
    }));
    expect(checkModelConsistency(m).map((v) => v.code)).toContain('option-fold-disagrees-with-field');
  });

  test('a band that has drifted from its number is rejected', () => {
    const m = buildSpotModel(spot());
    m.opponents[0].band = foldBand(0.9);
    expect(checkModelConsistency(m).map((v) => v.code)).toContain('band-mismatch');
  });

  test('a bluff that is both on and blocked is rejected', () => {
    const m = buildSpotModel(spot());
    m.bluff.viable = true;
    expect(checkModelConsistency(m).map((v) => v.code)).toContain('bluff-viable-and-blocked');
  });
});

describe('the opponent tips are derived, never asserted', () => {
  test('a player who folds enough and clears the price gets a bluff green light', () => {
    const o = { name: 'Marguerite', airPct: 3, refPot: 200, fold: 0.7, call: 0.28, raise: 0.02, band: foldBand(0.7) };
    const plan = counterPlan(o, assessBluff({ fold: 0.7, raise: 0.02 }, 120, 200, [o]), false, 1);
    expect(plan.bullets[0]).toMatch(/Bluff them/);
  });

  test('a player who never folds gets an unambiguous red light', () => {
    const o = { name: 'Sofia', airPct: 1, refPot: 200, fold: 0.05, call: 0.93, raise: 0.02, band: foldBand(0.05) };
    const plan = counterPlan(o, assessBluff({ fold: 0.05, raise: 0.02 }, 120, 200, [o]), false, 1);
    expect(plan.bullets[0]).toMatch(/Do not bluff them/);
  });

  test('a bluffable player in a field that vetoes it is told so, not given the green light', () => {
    const o = { name: 'Kaz', airPct: 20, refPot: 200, fold: 0.7, call: 0.28, raise: 0.02, band: foldBand(0.7) };
    // field folds far less than this one player does
    const plan = counterPlan(o, assessBluff({ fold: 0.2, raise: 0.02 }, 120, 200, [o]), false, 3);
    expect(plan.bullets[0]).not.toMatch(/Bluff them, and do not be shy/);
    expect(plan.bullets[0]).toMatch(/get through 3 players at once/);
  });

  test('every bullet quotes a number the model holds', () => {
    const model = buildSpotModel(spot());
    const text = model.counter.bullets.join(' ');
    expect(text).toContain(Math.round(100 * model.opponents[0].fold) + '%');
    expect(text).toContain(Math.round(100 * model.opponents[0].call) + '%');
    expect(text).toContain(Math.round(model.opponents[0].airPct) + '%');
    expect(text).toContain(Math.round(100 * model.opponents[0].raise) + '%');
  });

  test('the style is only named when the player has turned styles on', () => {
    expect(buildSpotModel(spot()).counter.head).toBe('How to play Idris');
    expect(buildSpotModel(spot({ revealStyles: true })).counter.head).toBe('Idris is a maniac');
  });
});

describe('table reads', () => {
  const o = (name, fold) => ({ name, fold, call: 1 - fold, raise: 0, band: foldBand(fold) });

  test('two players who will not let go make a bluff hopeless', () => {
    expect(tableFoldRead([o('A', 0.1), o('B', 0.12)]).kind).toBe('sticky');
  });

  test('a table that all folds enough is read as foldy', () => {
    expect(tableFoldRead([o('A', 0.6), o('B', 0.58)]).kind).toBe('foldy');
  });

  test('a split table is read as mixed, not as either extreme', () => {
    expect(tableFoldRead([o('A', 0.7), o('B', 0.25)]).kind).toBe('mixed');
  });

  test('one opponent is described on their own terms', () => {
    const read = tableFoldRead([o('Idris', 0.46)]);
    expect(read.kind).toBe('single');
    expect(read.band.word).toBe(foldBand(0.46).word);
  });
});

describe('clarity and families', () => {
  test('a size change is not a change of decision', () => {
    expect(actionFamily('bet 120 (¾ pot)')).toBe('aggro');
    expect(actionFamily('raise to 250 (½ pot)')).toBe('aggro');
    expect(actionFamily('all in 900')).toBe('aggro');
    expect(actionFamily('call 96')).toBe('call');
    expect(actionFamily('check')).toBe('check');
    expect(actionFamily('fold')).toBe('fold');
  });

  test('folding is never the runner-up when checking is free', () => {
    const opts = [
      { label: 'check', ev: 0, amount: 0, evSe: 0 },
      { label: 'fold', ev: 0, amount: 0, evSe: 0 },
      { label: 'bet 80 (½ pot)', ev: -3, amount: 80, evSe: 5 },
    ];
    expect(decisionClarity(opts, opts[0], 160).alt.label).toBe('bet 80 (½ pot)');
  });

  test('two lines inside the noise are admitted as a toss-up', () => {
    const opts = [
      { label: 'call 96', ev: 46, amount: 96, evSe: 6 },
      { label: 'raise to 250 (½ pot)', ev: 48, amount: 250, evSe: 14 },
    ];
    expect(decisionClarity(opts, opts[1], 213).level).toBe('toss-up');
  });

  test('a wide gap in chips is called clear', () => {
    const opts = [
      { label: 'fold', ev: 0, amount: 0, evSe: 0 },
      { label: 'call 96', ev: 120, amount: 96, evSe: 4 },
    ];
    expect(decisionClarity(opts, opts[1], 213).level).toBe('clear');
  });
});

describe('formatting', () => {
  test('equity is whole percentages', () => {
    expect(pctWhole(0.342)).toBe(34);
    expect(pctWhole(null)).toBeNull();
  });

  test('pot odds follow MATHS.md §4', () => {
    expect(requiredEquity(50, 150)).toBeCloseTo(0.25, 10);
    expect(requiredEquity(0, 200)).toBe(0);
  });
});

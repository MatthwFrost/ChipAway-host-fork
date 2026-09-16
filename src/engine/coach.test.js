import { describe, expect, test } from 'vitest';
import {
  buildCoachAdvice,
  buildHandReview,
  breakEvenFold,
  ci95Points,
  describeVillain,
  pctWhole,
  requiredEquity,
} from './coach.js';

const strip = (s) => s.replace(/<[^>]+>/g, '');
const allText = (a) => strip([a.verdict, a.reason, ...a.points, ...a.lines, ...a.maths].join(' '));

describe('formatting', () => {
  test('equity is reported as whole percentages', () => {
    expect(pctWhole(0.342)).toBe(34);
    expect(pctWhole(0.345)).toBe(35);
    expect(pctWhole(null)).toBeNull();
  });

  test('uncertainty is a 95% half-width in whole percentage points', () => {
    // MATHS.md §2: the equity panel runs 900 trials, worst-case SE 1.67pp -> ±3pp
    expect(ci95Points(Math.sqrt(0.25 / 900))).toBe(3);
    expect(ci95Points(null)).toBeNull();
  });
});

describe('pot odds anchor', () => {
  // MATHS.md §4: e* = C / (P_table + C), P_table already holding their bet
  test('a half-pot bet needs 25% equity', () => {
    expect(requiredEquity(50, 150)).toBeCloseTo(0.25, 6);
  });

  test('a pot-sized bet needs one third', () => {
    expect(requiredEquity(100, 200)).toBeCloseTo(1 / 3, 6);
  });

  test('nothing to call needs nothing', () => {
    expect(requiredEquity(0, 200)).toBe(0);
  });

  // MATHS.md §6: f* = B / (P + B)
  test('break-even bluff frequency for a pot-sized bet is one half', () => {
    expect(breakEvenFold(100, 100)).toBeCloseTo(0.5, 6);
  });
});

const DEFAULT_OPP = { name: 'Sofia', foldChance: 0.12, rangeTopPct: 18, airPct: 4, styleLabel: 'Station' };

// A spot where the bet option claims a fold rate its own opponents do not
// support is not a spot that can happen at a table, and a fixture that
// describes one is asking the coach to be consistent about an impossibility.
// The field's fold chance is therefore derived from whoever is in the spot, so
// overriding `opponents` moves the bet option with it.
const jointFold = (opps) => opps.reduce((acc, o) => acc * o.foldChance, 1);

const spot = (over = {}) => {
  const opponents = over.opponents || [DEFAULT_OPP];
  const options = over.options || [
    { label: 'fold', ev: 0, amount: 0 },
    { label: 'call 50', ev: -12, amount: 50 },
    { label: 'bet 120 (¾ pot)', ev: -8, amount: 120, fold: jointFold(opponents) },
  ];
  return {
    streetName: 'Flop',
    toCall: 50,
    pot: 150,
    rawEquity: 0.35,
    rangeEquity: 0.23,
    equitySe: 0.014,
    degradedShare: 0,
    trials: 900,
    recommended: { label: 'fold', ev: 0, amount: 0 },
    revealStyles: false,
    villain: opponents[0],
    ...over,
    opponents,
    options,
  };
};

describe('coach advice', () => {
  test('anchors on pot odds in plain language', () => {
    const text = allText(buildCoachAdvice(spot()));
    expect(text).toContain('To call 50 here you could win 200 in total');
    expect(text).toContain('25% equity');
  });

  test('shows raw equity and the range-adjusted figure that replaces it', () => {
    const text = allText(buildCoachAdvice(spot()));
    expect(text).toContain('35% against a random hand');
    expect(text).toContain('23%');
  });

  test('calls a 2-point margin borderline rather than clear-cut, and still folds', () => {
    // 23% equity into a 25% price: honest answer is "close", not "clearly short"
    const advice = buildCoachAdvice(spot());
    expect(advice.action).toBe('fold');
    expect(allText(advice)).toContain('close to break-even either way');
  });

  test('says a call is short of the price when it clearly is', () => {
    const advice = buildCoachAdvice(spot({ rangeEquity: 0.15 }));
    expect(advice.action).toBe('fold');
    expect(allText(advice)).toContain('10 points short of the price');
  });

  test('advises against bluffing a player who does not fold', () => {
    expect(allText(buildCoachAdvice(spot()))).toContain('a bluff is not advised');
  });

  test('recommends the bluff when the field folds more than the price needs', () => {
    const text = allText(buildCoachAdvice(spot({
      opponents: [{ name: 'Idris', foldChance: 0.8, rangeTopPct: 15, airPct: 2, styleLabel: 'Nit' }],
      villain: { name: 'Idris', foldChance: 0.8, rangeTopPct: 15, airPct: 2, styleLabel: 'Nit' },
      options: [
        { label: 'fold', ev: 0, amount: 0 },
        { label: 'call 50', ev: -12, amount: 50 },
        { label: 'bet 120 (¾ pot)', ev: 44, amount: 120, fold: 0.8 },
      ],
      recommended: { label: 'bet 120 (¾ pot)', ev: 44, amount: 120, fold: 0.8 },
    })));
    expect(text).toContain('profits without your hand ever having to win');
  });

  test('two sticky players kill the bluff outright', () => {
    const opponents = [
      { name: 'Sofia', foldChance: 0.1, rangeTopPct: 30, airPct: 5, styleLabel: 'Station' },
      { name: 'Kaz', foldChance: 0.14, rangeTopPct: 55, airPct: 20, styleLabel: 'Maniac' },
    ];
    const text = allText(buildCoachAdvice(spot({ opponents, villain: opponents[0] })));
    expect(text).toContain('a bluff has nowhere to go');
  });

  const drawShape = {
    isDrawing: true, madeCategory: 0, usesHoleCards: false, outs: 9,
    equityFromOuts: 0.35, cardsToCome: 2, riverOnlyEquity: 0.19, description: 'a flush draw',
  };

  test('a semi-bluff into a player who almost never folds says so plainly', () => {
    const opponents = [{ name: 'Kaz', foldChance: 0.05, rangeTopPct: 55, airPct: 20, styleLabel: 'Maniac' }];
    const text = allText(buildCoachAdvice(spot({ opponents, villain: opponents[0], shape: drawShape })));
    expect(text).toContain('not a real bluff');
    expect(text).toContain('actually hitting your outs');
  });

  test('a semi-bluff into a player who folds a lot says the fold part is real', () => {
    const opponents = [{ name: 'Idris', foldChance: 0.8, rangeTopPct: 15, airPct: 2, styleLabel: 'Nit' }];
    const text = allText(buildCoachAdvice(spot({ opponents, villain: opponents[0], shape: drawShape })));
    expect(text).toContain('bluff part of this bet is real');
  });

  // Regression: the fold-chance context used to be hardcoded to 0.35 for any
  // spot with 2+ opponents, ignoring who was actually at the table. Two nits
  // who each fold 70% of the time give a joint fold chance of 49% (>= the 40%
  // foldy cutoff) — the old hardcoded default would have wrongly reported this
  // as a sticky table.
  test('two tight players who both fold a lot are read as foldy, not sticky', () => {
    const opponents = [
      { name: 'Idris', foldChance: 0.7, rangeTopPct: 15, airPct: 2, styleLabel: 'Nit' },
      { name: 'Bernard', foldChance: 0.7, rangeTopPct: 18, airPct: 2, styleLabel: 'Nit' },
    ];
    const text = allText(buildCoachAdvice(spot({ opponents, villain: opponents[0], shape: drawShape })));
    expect(text).toContain('bluff part of this bet is real');
  });

  test('multiway pots get a field-size line and the raise-as-a-tool line', () => {
    const opponents = [
      { name: 'Sofia', foldChance: 0.45, rangeTopPct: 30, airPct: 5, styleLabel: 'TAG' },
      { name: 'Kaz', foldChance: 0.5, rangeTopPct: 40, airPct: 8, styleLabel: 'TAG' },
    ];
    const text = allText(buildCoachAdvice(spot({ opponents, villain: opponents[0] })));
    expect(text).toContain('2 players are still in');
    expect(text).toContain('fold even one player out');
  });

  test('a small field gets every range named, not just the tightest', () => {
    const opponents = [
      { name: 'Marguerite', foldChance: 0.3, rangeTopPct: 22, airPct: 4, styleLabel: 'Nit' },
      { name: 'Kaz', foldChance: 0.1, rangeTopPct: 55, airPct: 20, styleLabel: 'Maniac' },
    ];
    const text = allText(buildCoachAdvice(spot({ opponents, villain: opponents[0] })));
    expect(text).toContain('Each range you have to get through');
    expect(text).toContain('Marguerite top 22%');
    expect(text).toContain('Kaz top 55%, 20% air');
  });

  test('a big field names the tightest two and says that is what it is doing', () => {
    const opponents = [
      { name: 'Marguerite', foldChance: 0.3, rangeTopPct: 18, airPct: 2, styleLabel: 'Nit' },
      { name: 'Bernard', foldChance: 0.3, rangeTopPct: 30, airPct: 2, styleLabel: 'Nit' },
      { name: 'Kaz', foldChance: 0.1, rangeTopPct: 55, airPct: 20, styleLabel: 'Maniac' },
      { name: 'Sofia', foldChance: 0.1, rangeTopPct: 70, airPct: 5, styleLabel: 'Station' },
    ];
    const text = allText(buildCoachAdvice(spot({ opponents, villain: opponents[0] })));
    expect(text).toContain('the two tightest are');
    expect(text).toContain('Marguerite top 18% and Bernard top 30%');
    expect(text).toContain('The other 2 are wider');
    expect(text).toContain('not named here');
  });

  test('multiway equity is attributed to the combined range, not one player', () => {
    const opponents = [
      { name: 'Marguerite', foldChance: 0.3, rangeTopPct: 22, airPct: 4, styleLabel: 'Nit' },
      { name: 'Kaz', foldChance: 0.1, rangeTopPct: 55, airPct: 20, styleLabel: 'Maniac' },
    ];
    const text = allText(buildCoachAdvice(spot({ opponents, villain: opponents[0] })));
    expect(text).toContain('the combined range of the 2 still in pulls that down');
    expect(text).not.toContain('of hands Marguerite is repping');
  });

  test('says how many of the field are expected to fold before it comes back', () => {
    const opponents = [
      { name: 'Marguerite', foldChance: 0.3, rangeTopPct: 22, airPct: 4, styleLabel: 'Nit' },
      { name: 'Kaz', foldChance: 0.1, rangeTopPct: 55, airPct: 20, styleLabel: 'Maniac' },
      { name: 'Sofia', foldChance: 0.6, rangeTopPct: 70, airPct: 5, styleLabel: 'Station' },
      { name: 'Bernard', foldChance: 0.6, rangeTopPct: 80, airPct: 5, styleLabel: 'Nit' },
    ];
    const text = allText(buildCoachAdvice(spot({
      opponents, villain: opponents[0], field: { live: 4, contesting: 2, expectedFolds: 1.4 },
    })));
    expect(text).toContain('about 1–2 of those still to act should fold');
    expect(text).toContain('priced against the 2 expected to see it through');
  });

  test('a negligible number of expected folds is not mentioned at all', () => {
    const opponents = [
      { name: 'Marguerite', foldChance: 0.3, rangeTopPct: 22, airPct: 4, styleLabel: 'Nit' },
      { name: 'Kaz', foldChance: 0.1, rangeTopPct: 55, airPct: 20, styleLabel: 'Maniac' },
    ];
    const text = allText(buildCoachAdvice(spot({
      opponents, villain: opponents[0], field: { live: 2, contesting: 2, expectedFolds: 0.3 },
    })));
    expect(text).not.toContain('should fold before it comes back');
  });

  test('does not leak hidden opponent styles', () => {
    const text = allText(buildCoachAdvice(spot()));
    expect(text).not.toMatch(/station|maniac|\bTAG\b|\bLAG\b/i);
    expect(text).toContain('the top 18% of hands Sofia is repping');
  });

  test('an opponent who has not acted is described as an unread range', () => {
    expect(describeVillain({ name: 'Sofia', rangeTopPct: 100 }, false))
      .toBe('the whole range Sofia could still have');
  });

  test('names the style once the player has turned styles on', () => {
    expect(describeVillain({ name: 'Sofia', rangeTopPct: 18, styleLabel: 'Station' }, true))
      .toBe("Sofia's station range");
  });

  test('flags a borderline call in plain language, with no talk of error bars', () => {
    const text = allText(buildCoachAdvice(spot({ rangeEquity: 0.26, equitySe: 0.02 })));
    expect(text).toContain('could fall either way on the day');
    expect(text).toContain('close call rather than a clear one');
  });

  // Uncertainty should read as a judgement about people and cards, never as the
  // model reporting on its own reliability.
  test('never uses statistical jargon in anything shown up front', () => {
    const jargon = /margin of error|error bar|confidence|standard error|Monte Carlo|estimate|variance|statistical/i;
    const spots = [
      spot(),
      spot({ rangeEquity: 0.26, equitySe: 0.02 }),
      spot({ degradedShare: 0.14 }),
      spot({
        options: [{ label: 'fold', ev: 0, amount: 0, evSe: 0 },
          { label: 'call 50', ev: 1, amount: 50, evSe: 0 }],
        recommended: { label: 'call 50', ev: 1, amount: 50, evSe: 0 },
      }),
    ];
    spots.forEach((s) => {
      const a = buildCoachAdvice(s);
      expect(strip([a.verdict, a.reason, ...a.points].join(' '))).not.toMatch(jargon);
    });
  });

  test('a check is never presented as a fold', () => {
    const advice = buildCoachAdvice(spot({
      toCall: 0,
      options: [{ label: 'fold', ev: 0, amount: 0 }, { label: 'check', ev: 0, amount: 0 }],
      recommended: { label: 'check', ev: 0, amount: 0 },
    }));
    expect(advice.action).toBe('check');
    expect(allText(advice)).toContain('a check is free');
  });

  test('exposes frequencies and maths as separate optional layers', () => {
    const advice = buildCoachAdvice(spot());
    expect(advice.frequencies.length).toBe(3);
    expect(advice.frequencies[0].ev).toMatch(/^[+-]/);
    expect(advice.maths.join(' ')).toContain('EV(call) = e·P − (1−e)·C');
  });
});

describe('confidence spectrum', () => {
  // 2-7 into a big preflop raise: there is exactly one answer and the coach
  // should sound like it.
  test('an obvious fold is stated flatly, with no alternative floated', () => {
    const fold = { label: 'fold', ev: 0, amount: 0, evSe: 0 };
    const advice = buildCoachAdvice(spot({
      streetName: 'Preflop', toCall: 200, pot: 300, rangeEquity: 0.08, rawEquity: 0.1,
      options: [fold, { label: 'call 200', ev: -160, amount: 200, evSe: 4 }],
      recommended: fold,
    }));
    expect(advice.clarity).toBe('clear');
    expect(advice.action).toBe('fold');
    expect(strip(advice.verdict)).toBe('Fold.');
    expect(strip(advice.reason)).toBe('You hold 8% where the price needs 40%.');
  });

  test('a comfortable edge is stated as best without overclaiming', () => {
    const call = { label: 'call 50', ev: 12, amount: 50, evSe: 0 };
    const advice = buildCoachAdvice(spot({
      rangeEquity: 0.4, options: [{ label: 'fold', ev: 0, amount: 0, evSe: 0 }, call], recommended: call,
    }));
    expect(advice.clarity).toBe('solid');
    expect(strip(advice.verdict)).toBe('Call 50.');
  });

  test('a close one names the runner-up as also playable, briefly', () => {
    const check = { label: 'check', ev: 0, amount: 0, evSe: 0 };
    const bet = { label: 'bet 91 (⅓ pot)', ev: 4, amount: 91, fold: 0.5, eCalled: 0.4, evSe: 0 };
    const advice = buildCoachAdvice(spot({
      toCall: 0, rangeEquity: 0.4,
      options: [{ label: 'fold', ev: 0, amount: 0, evSe: 0 }, check, bet], recommended: bet,
    }));
    expect(advice.clarity).toBe('marginal');
    expect(strip(advice.verdict)).toBe('Bet 91 (⅓ pot), just — but check also looks positive.');
  });

  test('a true coin flip is handed over as preference, with the trade-off named', () => {
    const call = { label: 'call 50', ev: 1, amount: 50, evSe: 0 };
    const advice = buildCoachAdvice(spot({
      rangeEquity: 0.3, options: [{ label: 'fold', ev: 0, amount: 0, evSe: 0 }, call], recommended: call,
    }));
    expect(advice.clarity).toBe('toss-up');
    expect(strip(advice.verdict)).toBe('Call 50 or fold — your call.');
    const r = strip(advice.reason);
    expect(r).toContain('Both rate about the same here (+1 against +0)');
    expect(r).toContain('fold risks nothing, where call 50 puts 50 at stake');
    expect(r).toContain('folding costs you nothing');
  });

  // rankOptions deliberately picks the cheaper option when two error bars
  // overlap, so the pick can trail on the raw number. Claiming the two "price
  // out the same" is then contradicted by the two figures printed beside it.
  test('a pick that trails on raw EV is explained, not called equal', () => {
    const fold = { label: 'fold', ev: 0, amount: 0, evSe: 0 };
    const allIn = { label: 'all in 7802', ev: 426, amount: 7802, fold: 0.66, eCalled: 0.05, evSe: 700 };
    const advice = buildCoachAdvice(spot({
      toCall: 1792, pot: 4303, rangeEquity: 0.05,
      options: [fold, allIn], recommended: fold,
    }));
    expect(advice.clarity).toBe('toss-up');
    expect(strip(advice.verdict)).toBe('Fold — the safer play.');
    const r = strip(advice.reason);
    expect(r).toContain('all in 7802 rates higher on paper (+426)');
    expect(r).toContain('leans on them folding, which is the hardest thing to call');
    expect(r).toContain('fancy the gamble');
    expect(r).not.toMatch(/error|estimate|variance/i);
  });

  // A call does not depend on anyone folding, so it cannot be passed over for
  // that reason — and the price sentence is dropped here because it would read
  // as a contradiction of the fold sitting above it.
  test('a higher-rated call is passed over for the right reason', () => {
    const fold = { label: 'fold', ev: 0, amount: 0, evSe: 0 };
    const call = { label: 'call 551', ev: 56, amount: 551, evSe: 120 };
    const advice = buildCoachAdvice(spot({
      toCall: 551, pot: 3200, rangeEquity: 0.16, decisionEquity: 0.16,
      options: [fold, call], recommended: fold,
    }));
    const r = strip(advice.reason);
    expect(strip(advice.verdict)).toBe('Fold — the safer play.');
    expect(r).toContain('thin enough to disappear if your read is even slightly off');
    expect(r).not.toContain('leans on them folding');
    expect(r).not.toContain('where the price needs');
  });

  test('a losing option is not marked as the same decision as the pick', () => {
    const fold = { label: 'fold', ev: 0, amount: 0, evSe: 0 };
    const bad = { label: 'raise to 4840 (½ pot)', ev: -270, amount: 4840, fold: 0.47, evSe: 90 };
    const advice = buildCoachAdvice(spot({
      toCall: 1792, pot: 4303, options: [fold, bad], recommended: fold,
    }));
    expect(advice.frequencies.find((f) => f.label === 'raise to 4840 (½ pot)').tied).toBe(false);
  });

  test('marks options inside the error bars as the same decision', () => {
    const call = { label: 'call 50', ev: 1, amount: 50, evSe: 0 };
    const advice = buildCoachAdvice(spot({
      options: [{ label: 'fold', ev: 0, amount: 0, evSe: 0 }, call], recommended: call,
    }));
    expect(advice.frequencies.find((f) => f.label === 'fold').tied).toBe(true);
  });
});

describe('fold-equity commentary stays consistent with the verdict', () => {
  const checkOpt = { label: 'check', ev: 0, amount: 0, evSe: 0 };

  test('a profitable-looking bluff that is not the pick is not sold as profit', () => {
    const bet = { label: 'bet 120 (¾ pot)', ev: -30, amount: 120, fold: 0.8, eCalled: 0.2, evSe: 0 };
    const opponents = [{ name: 'Idris', foldChance: 0.8, rangeTopPct: 15, airPct: 2, styleLabel: 'Nit' }];
    const advice = buildCoachAdvice(spot({
      toCall: 0, opponents, villain: opponents[0],
      options: [{ label: 'fold', ev: 0, amount: 0, evSe: 0 }, checkOpt, bet],
      recommended: checkOpt,
    }));
    const text = allText(advice);
    expect(advice.action).toBe('check');
    expect(text).not.toContain('profits without your hand ever having to win');
    expect(text).toContain('is a real option, not a mistake');
    expect(text).toContain('prices out better here');
  });

  test('a near-tied bet that is not the pick is offered as a live alternative', () => {
    const bet = { label: 'bet 120 (¾ pot)', ev: -4, amount: 120, fold: 0.8, eCalled: 0.2, evSe: 0 };
    const opponents = [{ name: 'Idris', foldChance: 0.8, rangeTopPct: 15, airPct: 2, styleLabel: 'Nit' }];
    const text = allText(buildCoachAdvice(spot({
      toCall: 0, opponents, villain: opponents[0],
      options: [{ label: 'fold', ev: 0, amount: 0, evSe: 0 }, checkOpt, bet],
      recommended: checkOpt,
    })));
    expect(text).toContain('it rates about the same as check');
    expect(text).toContain('if you would rather have the initiative');
  });

  test('a recommended bet that cannot win by folds says where its edge is instead', () => {
    const bet = { label: 'bet 120 (¾ pot)', ev: 26, amount: 120, fold: 0.05, eCalled: 0.62, evSe: 0 };
    const opponents = [{ name: 'Kaz', foldChance: 0.05, rangeTopPct: 55, airPct: 20, styleLabel: 'Maniac' }];
    const advice = buildCoachAdvice(spot({
      toCall: 0, rangeEquity: 0.66, opponents, villain: opponents[0],
      options: [{ label: 'fold', ev: 0, amount: 0, evSe: 0 }, checkOpt, bet],
      recommended: bet,
    }));
    const text = allText(advice);
    expect(advice.action).toBe('bet');
    expect(text).toContain('not being recommended as a bluff');
    expect(text).not.toContain('a bluff is not advised here');
    expect(strip(advice.reason)).toBe('It works even when they call: you hold 62% against the hands that continue.');
  });

  test('a bet carried by fold equity says so, as the headline reason', () => {
    // 20% when called is not enough on its own: with no folds the bet loses, so
    // fold equity is what makes it work and that is what leads.
    const bet = { label: 'bet 120 (¾ pot)', ev: 44, amount: 120, fold: 0.8, eCalled: 0.2, evSe: 0 };
    const opponents = [{ name: 'Idris', foldChance: 0.8, rangeTopPct: 15, airPct: 2, styleLabel: 'Nit' }];
    const advice = buildCoachAdvice(spot({
      toCall: 0, opponents, villain: opponents[0],
      options: [{ label: 'fold', ev: 0, amount: 0, evSe: 0 }, checkOpt, bet], recommended: bet,
    }));
    expect(strip(advice.reason)).toBe('It works because they fold about 80% of the time here, and this size only needs 44% to pay for itself.');
  });
});

describe('quick points', () => {
  test('are capped at two, and lead with what you are holding', () => {
    const opponents = [
      { name: 'Marguerite', foldChance: 0.3, rangeTopPct: 22, airPct: 4, styleLabel: 'Nit' },
      { name: 'Kaz', foldChance: 0.1, rangeTopPct: 55, airPct: 42, styleLabel: 'Maniac' },
      { name: 'Sofia', foldChance: 0.5, rangeTopPct: 70, airPct: 5, styleLabel: 'Station' },
    ];
    const advice = buildCoachAdvice(spot({
      opponents, villain: opponents[0], blockerPct: 40, degradedShare: 0.2,
      field: { live: 3, contesting: 2, expectedFolds: 1.2 },
      shape: {
        isDrawing: true, madeCategory: 0, usesHoleCards: false, outs: 9,
        equityFromOuts: 0.35, cardsToCome: 2, description: 'a flush draw',
      },
    }));
    expect(advice.points.length).toBe(2);
    expect(strip(advice.points[0])).toBe('9 outs — about 35% to get there by the river');
    expect(strip(advice.points[1])).toContain('3-way — you have to beat all of them');
    expect(strip(advice.points[1])).toContain('about 1–2 should fold');
  });

  test('stay empty when nothing extra is doing any work', () => {
    const opponents = [{ name: 'Sofia', foldChance: 0.4, rangeTopPct: 60, airPct: 5, styleLabel: 'TAG' }];
    const advice = buildCoachAdvice(spot({ opponents, villain: opponents[0] }));
    expect(advice.points).toEqual([]);
  });

  test('flag a table that will not fold, when that is the live fact', () => {
    const opponents = [{ name: 'Kaz', foldChance: 0.04, rangeTopPct: 55, airPct: 20, styleLabel: 'Maniac' }];
    const advice = buildCoachAdvice(spot({ opponents, villain: opponents[0] }));
    expect(advice.points.join(' ')).toContain('nobody here folds much');
  });
});

describe('position as the deciding factor', () => {
  test('is promoted into the reason when removing it flips the pick', () => {
    const call = { label: 'call 50', ev: 6, amount: 50, evSe: 0 };
    const advice = buildCoachAdvice(spot({
      rangeEquity: 0.28, options: [{ label: 'fold', ev: 0, amount: 0, evSe: 0 }, call], recommended: call,
      position: { name: 'BTN', actsLast: true, preflop: false, credit: 0.035 },
    }));
    expect(strip(advice.reason)).toContain('Acting last from here is what tips it');
  });

  test('is left out of the reason when it changes nothing', () => {
    const call = { label: 'call 50', ev: 40, amount: 50, evSe: 0 };
    const advice = buildCoachAdvice(spot({
      rangeEquity: 0.55, options: [{ label: 'fold', ev: 0, amount: 0, evSe: 0 }, call], recommended: call,
      position: { name: 'BTN', actsLast: true, preflop: false, credit: 0.035 },
    }));
    expect(strip(advice.reason)).not.toContain('Acting last');
  });
});

const decision = (over = {}) => ({
  streetName: 'Flop',
  taken: 'call 50',
  evTaken: 14,
  best: { label: 'call 50', ev: 14, amount: 50 },
  cost: 0,
  equity: 0.42,
  pot: 150,
  toCall: 50,
  nOpp: 1,
  ...over,
});

describe('post-hand review', () => {
  test('a hand you folded is not described as a lost runout', () => {
    const r = buildHandReview([decision({ taken: 'fold', evTaken: 0, best: { label: 'fold', ev: 0 } })],
      { net: -20, showdown: false, folded: true });
    expect(r.verdict).toContain('got out cheaply');
    expect(strip(r.lines.join(' '))).toContain('Preflop, your line was'.replace('Preflop', 'On the flop'));
    expect(strip(r.lines.join(' '))).toContain('the blind you had already posted');
  });

  test('preflop reads as "Preflop", not "on the preflop"', () => {
    const r = buildHandReview([decision({ streetName: 'Preflop' })], { net: -50, showdown: true, folded: false });
    expect(strip(r.lines.join(' '))).toContain('Preflop, your line was call 50.');
    expect(strip(r.lines.join(' '))).not.toContain('on the preflop');
  });

  test('a right decision that lost is reported as right', () => {
    const r = buildHandReview([decision()], { net: -50, showdown: true, folded: false });
    expect(r.clean).toBe(true);
    expect(r.verdict).toContain('The decisions were right');
    expect(strip(r.lines.join(' '))).toContain('Play it the same way next time');
  });

  test('the losing runout is named without being blamed on the decision', () => {
    const r = buildHandReview([decision()], { net: -50, showdown: true, folded: false });
    const text = strip(r.lines.join(' '));
    expect(text).toContain('The price asked for 25% and you held 42%');
    expect(text).toContain('It cost 50 chips on this hand');
  });

  test('a won hand played badly still names the better line, constructively', () => {
    const r = buildHandReview([decision({
      taken: 'call 50', evTaken: -30, cost: 44,
      best: { label: 'fold', ev: 14 },
    })], { net: 120, showdown: true, folded: false });
    expect(r.clean).toBe(false);
    expect(r.verdict).toContain('You won it');
    expect(strip(r.lines.join(' '))).toContain('nothing is at stake in fixing it now');
    expect(strip(r.lines.join(' '))).not.toContain('The cards decided this pot');
  });

  test('a sizing tweak is a tuning note, not a mistake', () => {
    // the real hand that prompted this: 1/3 pot worth +845, 1/2 pot worth +886
    const r = buildHandReview([decision({
      streetName: 'Turn', taken: 'bet 345 (⅓ pot)', evTaken: 845, toCall: 0,
      best: { label: 'bet 523 (½ pot)', ev: 886 }, cost: 41, pot: 1035, equity: 0.64,
    })], { net: 900, showdown: true, folded: false });
    // 41 chips against 886 on offer is inside the noise — it should not be flagged at all
    expect(r.clean).toBe(true);
    expect(r.verdict).toContain('earned it');
    expect(strip(r.lines.join(' '))).not.toContain('The cards decided this pot');
  });

  test('a genuine sizing miss is named as a size, not a wrong line', () => {
    const r = buildHandReview([decision({
      streetName: 'Turn', taken: 'bet 30 (⅓ pot)', evTaken: 40, toCall: 0,
      best: { label: 'bet 45 (½ pot)', ev: 52 }, cost: 12, pot: 90, equity: 0.7,
    })], { net: 60, showdown: true, folded: false });
    expect(r.verdict).toContain('only the size');
    const text = strip(r.lines.join(' '));
    expect(text).toContain('You had the right idea');
    expect(text).toContain('not a mistake');
  });

  test('raising rubbish when folding was right is still called a mistake', () => {
    const r = buildHandReview([decision({
      streetName: 'Flop', taken: 'raise to 300 (pot)', evTaken: -260, toCall: 60,
      best: { label: 'fold', ev: 0 }, cost: 260, pot: 300, equity: 0.12,
    })], { net: -300, showdown: false, folded: false });
    expect(r.clean).toBe(false);
    expect(r.verdict).toContain('One street');
    expect(strip(r.maths.join(' '))).toContain('Total expected value given up');
  });

  test('spells out that expected value and chips won are different facts', () => {
    const r = buildHandReview([decision()], { net: -50, showdown: true, folded: false });
    expect(r.maths.join(' ')).toContain('only the first one is your decision-making');
  });

  test('no decisions means no review', () => {
    expect(buildHandReview([], { net: 0 })).toBeNull();
  });
});

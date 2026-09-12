import { describe, expect, test } from 'vitest';
import {
  buildCoachAdvice,
  buildHandReview,
  breakEvenFold,
  ci95Points,
  describeVillain,
  pctWhole,
  requiredEquity,
} from './coach';

const strip = (s) => s.replace(/<[^>]+>/g, '');
const allText = (a) => strip([a.verdict, ...a.lines, ...a.maths].join(' '));

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

const spot = (over = {}) => ({
  streetName: 'Flop',
  toCall: 50,
  pot: 150,
  rawEquity: 0.35,
  rangeEquity: 0.23,
  equitySe: 0.014,
  degradedShare: 0,
  trials: 900,
  opponents: [{ name: 'Sofia', foldChance: 0.12, rangeTopPct: 18, airPct: 4, styleLabel: 'Station' }],
  options: [
    { label: 'fold', ev: 0, amount: 0 },
    { label: 'call 50', ev: -12, amount: 50 },
    { label: 'bet 120 (¾ pot)', ev: -8, amount: 120, fold: 0.12 },
  ],
  recommended: { label: 'fold', ev: 0, amount: 0 },
  revealStyles: false,
  villain: { name: 'Sofia', foldChance: 0.12, rangeTopPct: 18, airPct: 4, styleLabel: 'Station' },
  ...over,
});

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

  test('flags a borderline call whose margin is inside the error bar', () => {
    const text = allText(buildCoachAdvice(spot({ rangeEquity: 0.26, equitySe: 0.02 })));
    expect(text).toContain('genuinely close rather than clear-cut');
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

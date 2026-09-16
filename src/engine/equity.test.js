import { describe, expect, test } from 'vitest';
import { buildRangeIndex, calcEquity, handPercentile } from './equity';
import { cmpScore, evaluateBest, makeDeck, cardStr } from './evaluator';
import { makeRng } from './rng';

const C = (s) => ({ rank: '..23456789TJQKA'.indexOf(s[0]), suit: s[1] });
const hand = (str) => str.split(' ').map(C);

// Exact equity against one uniformly random opponent hand, by enumeration.
// Slow, but it is the definition — the Monte Carlo engine has to land on it.
function exactVsRandom(hole, board) {
  const dead = {};
  hole.concat(board).forEach((c) => { dead[cardStr(c)] = 1; });
  const rest = makeDeck().filter((c) => !dead[cardStr(c)]);
  const toCome = 5 - board.length;
  let sum = 0, n = 0;
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const opp = [rest[i], rest[j]];
      if (toCome === 0) {
        const mine = evaluateBest(hole.concat(board));
        const theirs = evaluateBest(opp.concat(board));
        const c = cmpScore(mine, theirs);
        sum += c > 0 ? 1 : (c === 0 ? 0.5 : 0);
        n++;
      } else {
        const pool = rest.filter((_, k) => k !== i && k !== j);
        for (let r = 0; r < pool.length; r++) {
          const b = board.concat([pool[r]]);
          const mine = evaluateBest(hole.concat(b));
          const theirs = evaluateBest(opp.concat(b));
          const c = cmpScore(mine, theirs);
          sum += c > 0 ? 1 : (c === 0 ? 0.5 : 0);
          n++;
        }
      }
    }
  }
  return 100 * sum / n;
}

describe('the Monte Carlo engine lands on the exact answer', () => {
  // calcEquity was rewritten to draw cards by partial Fisher-Yates over a typed
  // array instead of filtering and shuffling a fresh deck each trial. Same
  // distribution in theory; this is the check that it is so in fact.
  test('river spot matches enumeration', () => {
    const hole = hand('Ah Kd');
    const board = hand('As 7c 2d 9h 4s');
    const exact = exactVsRandom(hole, board);
    const mc = calcEquity(hole, board, [{ rLo: 0, rBluff: 0 }], 40000, false,
      buildRangeIndex(board), makeRng(7));
    expect(Math.abs(mc.equity - exact)).toBeLessThan(1.0);
  });

  test('turn spot matches enumeration', () => {
    const hole = hand('Qh Jh');
    const board = hand('Th 9c 2d 4s');
    const exact = exactVsRandom(hole, board);
    const mc = calcEquity(hole, board, [{ rLo: 0, rBluff: 0 }], 40000, false,
      buildRangeIndex(board), makeRng(11));
    expect(Math.abs(mc.equity - exact)).toBeLessThan(1.2);
  });

  test('aces against one random hand are worth about 85%', () => {
    const mc = calcEquity(hand('Ah Ad'), [], [{ rLo: 0, rBluff: 0 }], 30000, false,
      buildRangeIndex([]), makeRng(3));
    expect(mc.equity).toBeGreaterThan(83.5);
    expect(mc.equity).toBeLessThan(86.5);
  });

  test('aces against four random hands are worth much less', () => {
    const opps = [0, 1, 2, 3].map(() => ({ rLo: 0, rBluff: 0 }));
    const mc = calcEquity(hand('Ah Ad'), [], opps, 20000, false, buildRangeIndex([]), makeRng(5));
    expect(mc.equity).toBeGreaterThan(50);
    expect(mc.equity).toBeLessThan(62);
  });

  test('seven-deuce offsuit is the worst hand and reads like it', () => {
    const mc = calcEquity(hand('7h 2d'), [], [{ rLo: 0, rBluff: 0 }], 20000, false,
      buildRangeIndex([]), makeRng(9));
    expect(mc.equity).toBeGreaterThan(30);
    expect(mc.equity).toBeLessThan(40);
  });
});

describe('ranges bite', () => {
  test('equity against a tight range is lower than against a random hand', () => {
    const board = hand('Ks 8d 3c');
    const idx = buildRangeIndex(board);
    const loose = calcEquity(hand('9h 9d'), board, [{ rLo: 0, rBluff: 0 }], 8000, true, idx, makeRng(21));
    const tight = calcEquity(hand('9h 9d'), board, [{ rLo: 0.85, rBluff: 0 }], 8000, true, idx, makeRng(21));
    expect(tight.equity).toBeLessThan(loose.equity);
  });

  test('a range with air in it gives equity back', () => {
    const board = hand('Ks 8d 3c');
    const idx = buildRangeIndex(board);
    const pure = calcEquity(hand('9h 9d'), board, [{ rLo: 0.85, rBluff: 0 }], 8000, true, idx, makeRng(31));
    const airy = calcEquity(hand('9h 9d'), board, [{ rLo: 0.85, rBluff: 0.4 }], 8000, true, idx, makeRng(31));
    expect(airy.equity).toBeGreaterThan(pure.equity);
  });
});

describe('honesty about failure', () => {
  test('no opponents is 100%, not a simulation', () => {
    const r = calcEquity(hand('7h 2d'), [], [], 100, false, [], makeRng(1));
    expect(r.equity).toBe(100);
    expect(r.ok).toBe(true);
  });

  test('zero trials reports "could not measure", never 0% equity', () => {
    const r = calcEquity(hand('Ah Ad'), [], [{ rLo: 0, rBluff: 0 }], 0, false, buildRangeIndex([]), makeRng(1));
    expect(r.ok).toBe(false);
    expect(r.equity).toBeNull();
  });

  test('standard error shrinks with trials', () => {
    const idx = buildRangeIndex([]);
    const few = calcEquity(hand('Ah Ad'), [], [{ rLo: 0, rBluff: 0 }], 400, false, idx, makeRng(2));
    const many = calcEquity(hand('Ah Ad'), [], [{ rLo: 0, rBluff: 0 }], 10000, false, idx, makeRng(2));
    expect(many.se).toBeLessThan(few.se);
  });
});

describe('reproducibility', () => {
  test('the same seed gives the same number every time', () => {
    const idx = buildRangeIndex([]);
    const a = calcEquity(hand('Ah Kd'), [], [{ rLo: 0, rBluff: 0 }], 2000, false, idx, makeRng(42));
    const b = calcEquity(hand('Ah Kd'), [], [{ rLo: 0, rBluff: 0 }], 2000, false, idx, makeRng(42));
    expect(a.equity).toBe(b.equity);
  });

  test('a different seed gives a different draw', () => {
    const idx = buildRangeIndex([]);
    const a = calcEquity(hand('Ah Kd'), [], [{ rLo: 0, rBluff: 0 }], 2000, false, idx, makeRng(42));
    const b = calcEquity(hand('Ah Kd'), [], [{ rLo: 0, rBluff: 0 }], 2000, false, idx, makeRng(43));
    expect(a.equity).not.toBe(b.equity);
  });
});

describe('hand percentile', () => {
  test('aces are at the very top preflop', () => {
    const idx = buildRangeIndex([]);
    expect(handPercentile(hand('Ah Ad'), [], idx)).toBeGreaterThan(0.98);
  });

  test('seven-deuce is at the very bottom', () => {
    const idx = buildRangeIndex([]);
    expect(handPercentile(hand('7h 2d'), [], idx)).toBeLessThan(0.10);
  });

  test('on a board, percentile follows made strength', () => {
    const board = hand('Ks 8d 3c');
    const idx = buildRangeIndex(board);
    const top = handPercentile(hand('Kh Qd'), board, idx);
    const air = handPercentile(hand('5h 4d'), board, idx);
    expect(top).toBeGreaterThan(air);
  });
});

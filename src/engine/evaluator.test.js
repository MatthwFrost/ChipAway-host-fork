import { describe, expect, test } from 'vitest';
import {
  combos5, evaluate5, evaluateBest, evaluateBestByCombos, cmpScore, makeDeck, shuffle,
} from './evaluator';
import { makeRng } from './rng';

const C = (s) => ({ rank: '..23456789TJQKA'.indexOf(s[0]), suit: s[1] });
const hand = (str) => str.split(' ').map(C);

describe('the fast evaluator is the slow one', () => {
  // evaluateBest was rewritten from "try all 21 five-card subsets" to a single
  // pass for speed. Every claim the app makes about who won rests on it, so it
  // is checked against the original definition rather than trusted.
  test('agrees on 200,000 random 7-card hands', () => {
    const rng = makeRng(99);
    const deck = makeDeck();
    let checked = 0;
    for (let i = 0; i < 200000; i++) {
      const d = shuffle(deck, rng);
      const cards = d.slice(0, 7);
      const fast = evaluateBest(cards);
      const slow = evaluateBestByCombos(cards);
      if (cmpScore(fast, slow) !== 0 || fast.join(',') !== slow.join(',')) {
        throw new Error('mismatch on ' + cards.map((c) => c.rank + c.suit).join(' ') +
          ' fast=' + fast.join(',') + ' slow=' + slow.join(','));
      }
      checked++;
    }
    expect(checked).toBe(200000);
  }, 120000);

  test('agrees on 50,000 random 6-card hands', () => {
    const rng = makeRng(1234);
    const deck = makeDeck();
    for (let i = 0; i < 50000; i++) {
      const cards = shuffle(deck, rng).slice(0, 6);
      expect(evaluateBest(cards).join(',')).toBe(evaluateBestByCombos(cards).join(','));
    }
  }, 120000);

  test('agrees with evaluate5 on 50,000 random 5-card hands', () => {
    const rng = makeRng(555);
    const deck = makeDeck();
    for (let i = 0; i < 50000; i++) {
      const cards = shuffle(deck, rng).slice(0, 5);
      expect(evaluateBest(cards).join(',')).toBe(evaluate5(cards).join(','));
    }
  }, 120000);

  test('fewer than five cards has no hand', () => {
    expect(evaluateBest([C('Ah'), C('Kh')])).toEqual([-1]);
  });
});

describe('the awkward cases, named', () => {
  const same = (cards) => {
    const c = hand(cards);
    expect(evaluateBest(c).join(',')).toBe(evaluateBestByCombos(c).join(','));
    return evaluateBest(c);
  };

  test('the wheel is a five-high straight', () => {
    expect(same('Ah 2d 3c 4s 5h Kd Qc')).toEqual([4, 5]);
  });

  test('a steel wheel is a five-high straight flush', () => {
    expect(same('Ah 2h 3h 4h 5h Kd Qc')).toEqual([8, 5]);
  });

  test('two trips play as a full house, higher trips on top', () => {
    expect(same('3h 3d 3c 4s 4h 4d Kc')).toEqual([6, 4, 3]);
  });

  test('trips plus two pairs takes the bigger pair', () => {
    expect(same('9h 9d 9c 4s 4h Kd Kc')).toEqual([6, 9, 13]);
  });

  test('three pairs is two pair with the third pair playable as the kicker', () => {
    expect(same('Ah Ad 9c 9s 4h 4d 2c')).toEqual([2, 14, 9, 4]);
  });

  test('a flush beats a straight made from other suits', () => {
    const s = same('2h 5h 7h 9h Jh 3d 4c');
    expect(s[0]).toBe(5);
  });

  test('a full house beats a flush on the same seven cards', () => {
    const s = same('5h 5d 5c 9h 9d 2h 7h');
    expect(s[0]).toBe(6);
  });

  test('seven of one suit takes the top five', () => {
    expect(same('2h 5h 7h 9h Jh 3h 4h')).toEqual([5, 11, 9, 7, 5, 4]);
  });

  test('quads takes the highest kicker from the rest', () => {
    expect(same('7h 7d 7c 7s 2h Kd 3c')).toEqual([7, 7, 13]);
  });

  test('a straight on the board is read as a straight', () => {
    expect(same('5h 6d 7c 8s 9h 2d 3c')).toEqual([4, 9]);
  });

  test('ace-high straight', () => {
    expect(same('Ah Kd Qc Js Th 2d 3c')).toEqual([4, 14]);
  });
});

describe('combos5 still enumerates correctly', () => {
  test('seven cards make twenty-one five-card hands', () => {
    expect(combos5(makeDeck().slice(0, 7)).length).toBe(21);
  });
});

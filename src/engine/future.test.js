import { describe, expect, test, afterEach } from 'vitest';
import {
  NEXT_STREET_BET, barrelValue, callFutureValue, futureWeights,
  resetFutureWeights, setFutureWeights, streetsLeft,
} from './future.js';

afterEach(() => resetFutureWeights());

const draw = { isDrawing: true, outs: 9, madeCategory: 0, isMade: false, bricked: false };
// handShape sets isMade only from two pair upward, so a one-pair bluff-catcher
// has isMade === false. Getting that backwards silently disabled reverse
// implied odds entirely, so the fixtures mirror the real shapes exactly.
const bluffCatcher = { isDrawing: false, outs: 0, madeCategory: 1, isMade: false, bricked: false };
const air = { isDrawing: false, outs: 0, madeCategory: 0, isMade: false, bricked: false };
const strong = { isDrawing: false, outs: 0, madeCategory: 3, isMade: true, bricked: false };
const board = [{ rank: 6, suit: 'h' }, { rank: 14, suit: 'h' }, { rank: 11, suit: 'd' }];

const call = (over = {}) => callFutureValue(Object.assign({
  shape: draw, e: 0.45, pot: 200, toCall: 60, street: 1,
  board: board, oppCall: 0.6, actsLast: true,
}, over));

describe('streets remaining', () => {
  test('counts down to nothing on the river', () => {
    expect(streetsLeft(0)).toBe(3);
    expect(streetsLeft(1)).toBe(2);
    expect(streetsLeft(2)).toBe(1);
    expect(streetsLeft(3)).toBe(0);
  });
});

describe('implied odds', () => {
  test('a draw is worth more than the pot it is calling for', () => {
    expect(call({ shape: draw })).toBeGreaterThan(0);
  });

  test('more outs are worth more', () => {
    const few = call({ shape: { ...draw, outs: 4 } });
    const many = call({ shape: { ...draw, outs: 12 } });
    expect(many).toBeGreaterThan(few);
  });

  test('an opponent who never calls pays nothing off', () => {
    expect(call({ oppCall: 0 })).toBe(0);
  });

  test('a station pays off more than a nit', () => {
    expect(call({ oppCall: 0.85 })).toBeGreaterThan(call({ oppCall: 0.2 }));
  });

  test('position is worth real implied odds', () => {
    expect(call({ actsLast: true })).toBeGreaterThan(call({ actsLast: false }));
  });

  test('a strong made hand also collects later', () => {
    expect(call({ shape: strong })).toBeGreaterThan(0);
  });
});

describe('reverse implied odds', () => {
  test('a bluff-catcher is worth LESS than the pot it is calling for', () => {
    expect(call({ shape: bluffCatcher })).toBeLessThan(0);
  });

  test('the further behind it is, the more it costs', () => {
    const ahead = call({ shape: bluffCatcher, e: 0.75 });
    const behind = call({ shape: bluffCatcher, e: 0.25 });
    expect(behind).toBeLessThan(ahead);
  });

  test('out of position is the expensive place to hold one', () => {
    const ip = call({ shape: bluffCatcher, actsLast: true });
    const oop = call({ shape: bluffCatcher, actsLast: false });
    expect(oop).toBeLessThan(ip);
  });

  test('air with no draw pays off worst of all', () => {
    expect(call({ shape: air })).toBeLessThan(0);
  });

  test('a one-pair hand really is treated as a bluff-catcher', () => {
    // Regression: handShape reports isMade false for one pair, so a condition
    // written as `isMade && madeCategory <= 1` never fires.
    expect(bluffCatcher.isMade).toBe(false);
    expect(call({ shape: bluffCatcher })).toBeLessThan(0);
  });

  test('a missed draw is a bluff-catcher that cannot even catch bluffs', () => {
    expect(call({ shape: { isDrawing: false, outs: 0, bricked: true, isMade: false, madeCategory: 0 } }))
      .toBeLessThan(0);
  });
});

describe('the river ends it', () => {
  test('nothing is implied when there are no streets left', () => {
    expect(call({ street: 3 })).toBe(0);
    expect(call({ shape: bluffCatcher, street: 3 })).toBe(0);
  });

  test('and there is nothing to barrel into', () => {
    setFutureWeights({ barrel: 0.35 });
    expect(barrelValue({ pot: 200, bet: 100, street: 3, nextFold: 0.6, actsLast: true })).toBe(0);
  });
});

describe('barrel value', () => {
  // Switched OFF by default: crediting a bet with next street's fold equity
  // measured as actively harmful (sweep: 0 -> +148.8, 0.08 -> +116.9,
  // 0.15 -> +113.4, 0.35 -> +111.4 bb/100). These tests cover the mechanism,
  // which is still reachable, and pin the default at zero so it cannot be
  // switched back on without someone deciding to.
  const bv = (over = {}) => {
    setFutureWeights({ barrel: 0.35 });
    return barrelValue(Object.assign({
      pot: 200, bet: 100, street: 1, nextFold: 0.5, actsLast: true,
    }, over));
  };

  test('the default weight is zero, because it lost chips', () => {
    expect(futureWeights().barrel).toBe(0);
    expect(barrelValue({ pot: 200, bet: 100, street: 1, nextFold: 0.9, actsLast: true })).toBe(0);
  });

  test('when switched on, a called bet buys another chance to fold them out', () => {
    expect(bv()).toBeGreaterThan(0);
  });

  test('worth more against a field that folds next street', () => {
    expect(bv({ nextFold: 0.8 })).toBeGreaterThan(bv({ nextFold: 0.1 }));
  });

  test('worth nothing against a field that never folds', () => {
    expect(bv({ nextFold: 0 })).toBe(0);
  });

  test('worth more in position', () => {
    expect(bv({ actsLast: true })).toBeGreaterThan(bv({ actsLast: false }));
  });

  test('scales with the pot it is building', () => {
    expect(bv({ pot: 800, bet: 400 })).toBeGreaterThan(bv({ pot: 200, bet: 100 }));
  });
});

describe('the correction is bounded', () => {
  test('it never exceeds what is at stake on later streets', () => {
    const nextBet = NEXT_STREET_BET * (200 + 2 * 60);
    [draw, bluffCatcher, air, strong].forEach((shape) => {
      [0, 0.5, 1].forEach((oppCall) => {
        const v = call({ shape, oppCall, e: 0.1 });
        expect(Math.abs(v)).toBeLessThanOrEqual(nextBet + 1e-9);
      });
    });
  });

  test('a hand with no shape gets no correction', () => {
    expect(call({ shape: null })).toBe(0);
  });
});

describe('the weights are switchable, which is how they get measured', () => {
  test('zeroing them reproduces single-street pricing exactly', () => {
    setFutureWeights({ implied: 0, reverse: 0, barrel: 0 });
    expect(call({ shape: draw })).toBe(0);
    expect(call({ shape: bluffCatcher })).toBe(0);
    expect(barrelValue({ pot: 200, bet: 100, street: 1, nextFold: 0.9, actsLast: true })).toBe(0);
  });

  test('setting returns the previous weights so a harness can restore them', () => {
    const before = futureWeights();
    const was = setFutureWeights({ implied: 0 });
    expect(was.implied).toBe(before.implied);
    resetFutureWeights();
    expect(futureWeights().implied).toBe(before.implied);
  });
});

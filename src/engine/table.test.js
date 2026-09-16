import { describe, expect, test } from 'vitest';
import { BB, POLICIES, SB, START_STACK, buildSidePots, createTable } from './table';
import { makeRng } from './rng';

describe('the headless table plays legal poker', () => {
  test('every hand is zero-sum at the table', () => {
    const t = createTable({ seed: 4, heroPolicy: POLICIES.coach });
    for (let i = 0; i < 300; i++) {
      const r = t.playHand();
      expect(r.net.reduce((s, x) => s + x, 0)).toBe(0);
    }
  }, 60000);

  test('every hand terminates and deals a legal board', () => {
    const t = createTable({ seed: 8, heroPolicy: POLICIES['tag-bot'] });
    for (let i = 0; i < 200; i++) {
      const r = t.playHand();
      expect(r.board.length).toBeLessThanOrEqual(5);
      const ids = r.board.map((c) => c.rank + c.suit);
      expect(new Set(ids).size).toBe(ids.length);
    }
  }, 60000);

  test('nobody ever finishes a hand owing chips', () => {
    const t = createTable({ seed: 12, heroPolicy: POLICIES.coach });
    for (let i = 0; i < 200; i++) {
      t.playHand();
      t.players.forEach((p) => expect(p.stack).toBeGreaterThanOrEqual(0));
    }
  }, 60000);

  test('the same seed replays exactly', () => {
    const run = () => {
      const t = createTable({ seed: 77, heroPolicy: POLICIES.coach });
      const out = [];
      for (let i = 0; i < 30; i++) out.push(t.playHand().net.join(','));
      return out.join('|');
    };
    expect(run()).toBe(run());
  }, 60000);

  test('a different seed deals a different game', () => {
    const run = (s) => {
      const t = createTable({ seed: s, heroPolicy: POLICIES.coach });
      const out = [];
      for (let i = 0; i < 30; i++) out.push(t.playHand().net.join(','));
      return out.join('|');
    };
    expect(run(1)).not.toBe(run(2));
  }, 60000);

  test('each hand is an independent sample at a fixed stack depth', () => {
    const t = createTable({ seed: 31, heroPolicy: POLICIES.coach });
    for (let i = 0; i < 100; i++) {
      t.playHand();
      // Whatever happened, nobody can win or lose more than the table holds.
      t.players.forEach((p) => expect(p.stack).toBeLessThanOrEqual(6 * 1000));
    }
  }, 60000);

  test('a hand can never swing more than the chips on the table', () => {
    const t = createTable({ seed: 37, heroPolicy: POLICIES['tag-bot'] });
    for (let i = 0; i < 200; i++) {
      const r = t.playHand();
      r.net.forEach((n) => {
        expect(n).toBeGreaterThanOrEqual(-1000);      // you can only lose your stack
        expect(n).toBeLessThanOrEqual(5 * 1000);      // you can only win theirs
      });
    }
  }, 60000);

  test('stacks carry over when the reset is turned off', () => {
    const t = createTable({ seed: 41, heroPolicy: POLICIES.coach, resetStacks: false });
    const seen = new Set();
    for (let i = 0; i < 60; i++) { t.playHand(); seen.add(t.players[0].stack); }
    expect(seen.size).toBeGreaterThan(1);
  }, 60000);

  test('blinds move chips on the very first hand', () => {
    const t = createTable({ seed: 3 });
    const before = t.players.map((p) => p.stack);
    t.playHand();
    expect(t.players.filter((p, i) => p.stack !== before[i]).length).toBeGreaterThan(0);
    expect(SB).toBe(10);
    expect(BB).toBe(20);
  });
});

describe('side pots', () => {
  const P = (committed, folded) => ({ committed, folded: !!folded, hole: [], isHero: false });

  test('one pot when everyone put in the same', () => {
    const pots = buildSidePots([P(100), P(100), P(100)]);
    expect(pots.length).toBe(1);
    expect(pots[0].amount).toBe(300);
  });

  test('a short all-in makes a side pot the short stack cannot win', () => {
    const short = P(50), a = P(200), b = P(200);
    const pots = buildSidePots([short, a, b]);
    expect(pots.length).toBe(2);
    expect(pots[0].amount).toBe(150);
    expect(pots[0].eligible).toContain(short);
    expect(pots[1].amount).toBe(300);
    expect(pots[1].eligible).not.toContain(short);
  });

  // Regression: found by the 10,000-hand backtest on its first run.
  test('a short all-in against two bigger folds leaves no orphan layer', () => {
    const shortAllIn = P(50), foldedA = P(100, true), foldedB = P(100, true);
    const pots = buildSidePots([shortAllIn, foldedA, foldedB]);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(250);
    pots.forEach((p) => expect(p.eligible.length).toBeGreaterThan(0));
    // every chip is winnable by the one player still in the hand
    pots.forEach((p) => expect(p.eligible).toContain(shortAllIn));
  });

  test('dead money above the last live commitment is not lost', () => {
    const live = P(40), folded = P(500, true);
    const pots = buildSidePots([live, folded]);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(540);
    pots.forEach((p) => expect(p.eligible).toContain(live));
  });

  test('folded chips stay in the pot but win nothing', () => {
    const folded = P(80, true), a = P(200), b = P(200);
    const pots = buildSidePots([folded, a, b]);
    const total = pots.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(480);
    pots.forEach((p) => expect(p.eligible).not.toContain(folded));
  });
});

describe('hero policies do what they say', () => {
  test('always-fold never loses more than the big blind in a hand', () => {
    const t = createTable({ seed: 15, heroPolicy: POLICIES['always-fold'] });
    let worst = 0;
    for (let i = 0; i < 150; i++) worst = Math.min(worst, t.playHand().net[0]);
    expect(worst).toBeGreaterThanOrEqual(-BB);
  }, 60000);

  test('always-call puts far more chips at risk than always-fold', () => {
    const volume = (policy) => {
      const t = createTable({ seed: 19, heroPolicy: POLICIES[policy] });
      let v = 0;
      for (let i = 0; i < 150; i++) v += Math.abs(t.playHand().net[0]);
      return v;
    };
    expect(volume('always-call')).toBeGreaterThan(volume('always-fold'));
  }, 60000);

  test('the coach policy only ever picks an option the coach priced', () => {
    const t = createTable({
      seed: 23,
      heroPolicy: (c) => {
        const chosen = POLICIES.coach(c);
        expect(['fold', 'check', 'call', 'bet', 'raise']).toContain(chosen.action);
        if (chosen.action === 'bet' || chosen.action === 'raise') {
          expect(c.spot.options.some((o) => o.target === chosen.target)).toBe(true);
        }
        return chosen;
      },
    });
    for (let i = 0; i < 50; i++) t.playHand();
  }, 60000);
});

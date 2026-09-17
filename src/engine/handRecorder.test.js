/* ============================================================
   The recorder is verified against the engine that produced the hand, not
   against a fixture someone typed out. For every hand played, folding the
   event log all the way forward must reproduce the exact table the engine
   finished with — same stacks, same board, same folds.

   That is the property that matters. A recorder that drops one call, stores a
   raise's increment where its target belongs, or forgets to sweep bets into
   the pot on a street change all pass a "does it emit events" test and all
   fail this one.
   ============================================================ */

import { describe, expect, test } from 'vitest';
import { POLICIES, createTable, START_STACK } from './table.js';
import { createHandRecorder, HAND_SCHEMA_VERSION } from './handRecorder.js';
import { snapshotAt, stepCount, describeStep, parseCard } from './handReplay.js';
import { cardStr } from './evaluator.js';

function playRecorded(seed, policyName, hands) {
  const recorder = createHandRecorder();
  const table = createTable({
    seed: seed, dealSeed: seed, recorder: recorder,
    heroPolicy: POLICIES[policyName || 'coach'],
    botTrials: 40, calledTrials: 40, equityTrials: 60,
  });
  const out = [];
  for (let i = 0; i < (hands || 1); i++) {
    const summary = table.playHand();
    out.push({ summary: summary, hand: table.lastHand(), stacks: table.players.map(function (p) { return p.stack; }) });
  }
  return out;
}

describe('hand recorder', () => {
  test('records a well-formed hand', () => {
    const [{ hand }] = playRecorded(7);
    expect(hand.v).toBe(HAND_SCHEMA_VERSION);
    expect(hand.id).toBeTruthy();
    expect(hand.config.seats).toHaveLength(6);
    expect(Object.keys(hand.holeCards)).toHaveLength(6);
    // Two cards for every seat, in 'As' form.
    Object.keys(hand.holeCards).forEach((k) => {
      expect(hand.holeCards[k]).toHaveLength(2);
      hand.holeCards[k].forEach((c) => expect(parseCard(c)).not.toBeNull());
    });
    expect(hand.events[0]).toEqual({ t: 'deal', street: 0 });
    expect(hand.events.filter((e) => e.t === 'blind')).toHaveLength(2);
    expect(hand.result).not.toBeNull();
  });

  test('every seat is dealt a distinct card', () => {
    const [{ hand }] = playRecorded(11);
    const all = [];
    Object.keys(hand.holeCards).forEach((k) => all.push(...hand.holeCards[k]));
    expect(new Set(all).size).toBe(all.length);
  });

  test('records the range snapshot each street', () => {
    // Enough hands that at least one reaches a flop.
    const played = playRecorded(3, 'coach', 12);
    const withStreets = played.filter(({ hand }) => hand.events.some((e) => e.t === 'street'));
    expect(withStreets.length).toBeGreaterThan(0);
    withStreets.forEach(({ hand }) => {
      hand.events.filter((e) => e.t === 'street').forEach((ev, i) => {
        const next = hand.events[hand.events.indexOf(ev) + 1];
        expect(next.t).toBe('ranges');
        expect(next.street).toBe(ev.street);
        expect(Object.keys(next.seats).length).toBeGreaterThan(0);
        expect(i).toBeGreaterThanOrEqual(0);
      });
    });
  });
});

describe('replay reconstructs the engine', () => {
  // The headline property, over enough hands and policies to hit folds,
  // showdowns, all-ins and side pots rather than one lucky shape.
  const CASES = [
    { seed: 1, policy: 'coach' },
    { seed: 2, policy: 'always-call' },
    { seed: 3, policy: 'random' },
    { seed: 4, policy: 'always-fold' },
    { seed: 5, policy: 'lag-bot' },
  ];

  CASES.forEach(({ seed, policy }) => {
    test(`final stacks match after ${policy} (seed ${seed})`, () => {
      const played = playRecorded(seed, policy, 20);
      played.forEach(({ hand, stacks }) => {
        const final = snapshotAt(hand, stepCount(hand) - 1);
        expect(final.players.map((p) => p.stack)).toEqual(stacks);
      });
    });
  });

  test('final board matches the engine board', () => {
    const played = playRecorded(9, 'always-call', 20);
    played.forEach(({ hand, summary }) => {
      const final = snapshotAt(hand, stepCount(hand) - 1);
      // A hand everyone folded out of keeps whatever board it reached, so the
      // engine's board is only comparable where it ran out.
      if (summary.showdown) {
        expect(final.board.map(cardStr)).toEqual(summary.board.map(cardStr));
      }
    });
  });

  test('chips are conserved at every step', () => {
    const played = playRecorded(13, 'coach', 15);
    played.forEach(({ hand }) => {
      const seated = hand.config.seats.reduce((a, s) => a + s.stack, 0);
      for (let n = -1; n < stepCount(hand); n++) {
        const s = snapshotAt(hand, n);
        const onTable = s.players.reduce((a, p) => a + p.stack + p.bet, 0) + s.pot;
        // Until the pot is awarded, every chip is in a stack, a live bet or
        // the pot. Nothing is created and nothing leaks.
        const awarded = (hand.events || []).slice(0, n + 1)
          .filter((e) => e.t === 'award').reduce((a, e) => a + e.amount, 0);
        expect(onTable).toBe(seated + awarded);
      }
    });
  });

  test('hero net matches the recorded result', () => {
    const played = playRecorded(17, 'coach', 20);
    played.forEach(({ hand }) => {
      const final = snapshotAt(hand, stepCount(hand) - 1);
      const heroStart = hand.config.seats[0].stack;
      expect(final.players[0].stack - heroStart).toBe(hand.result.net);
    });
  });

  test('a folded player never acts again', () => {
    const played = playRecorded(21, 'random', 15);
    played.forEach(({ hand }) => {
      const folded = {};
      hand.events.filter((e) => e.t === 'action').forEach((e) => {
        expect(folded[e.seat]).toBeUndefined();
        if (e.action === 'fold') folded[e.seat] = true;
      });
    });
  });

  test('stacks never go negative mid-replay', () => {
    const played = playRecorded(23, 'always-call', 15);
    played.forEach(({ hand }) => {
      for (let n = -1; n < stepCount(hand); n++) {
        snapshotAt(hand, n).players.forEach((p) => expect(p.stack).toBeGreaterThanOrEqual(0));
      }
    });
  });

  test('every step has a caption', () => {
    const [{ hand }] = playRecorded(29, 'coach');
    for (let n = 0; n < stepCount(hand); n++) {
      expect(describeStep(hand, n)).not.toBe('');
    }
  });

  test('replaying past the end is the same as replaying to the end', () => {
    const [{ hand }] = playRecorded(31, 'coach');
    const last = snapshotAt(hand, stepCount(hand) - 1);
    expect(snapshotAt(hand, stepCount(hand) + 99)).toEqual(last);
  });

  test('the deal step shows hole cards and nothing else', () => {
    const [{ hand }] = playRecorded(37, 'coach');
    const s = snapshotAt(hand, 0);
    expect(s.pot).toBe(0);
    expect(s.board).toHaveLength(0);
    s.players.forEach((p) => {
      expect(p.hole).toHaveLength(2);
      expect(p.stack).toBe(START_STACK);
    });
  });
});

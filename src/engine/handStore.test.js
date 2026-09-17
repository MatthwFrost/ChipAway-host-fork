import { beforeEach, describe, expect, test } from 'vitest';
import { HANDS_KEY, MAX_HANDS, clearHands, getHand, listSummaries, loadHands, saveHand, summarize } from './handStore.js';
import { HAND_SCHEMA_VERSION } from './handRecorder.js';

function fakeHand(n, over) {
  return Object.assign({
    v: HAND_SCHEMA_VERSION,
    id: 'hand-' + n,
    handNo: n,
    startedAt: 1700000000000 + n,
    config: { sb: 10, bb: 20, startStack: 1000, dealerIdx: 0, heroIndex: 0, seats: [{ id: 0, name: 'You', profile: null, stack: 1000, isHero: true }] },
    holeCards: { 0: ['As', 'Kd'] },
    events: [{ t: 'deal', street: 0 }, { t: 'street', street: 1, cards: ['2h', '7c', 'Td'] }],
    decisions: [{ cost: 12 }, { cost: 0 }],
    result: { net: -40, potFinal: 120, showdown: true, heroFolded: false, winners: [1] },
  }, over || {});
}

describe('hand store', () => {
  beforeEach(() => { clearHands(); });

  test('round-trips a hand', () => {
    saveHand(fakeHand(1));
    expect(loadHands()).toHaveLength(1);
    expect(getHand('hand-1').handNo).toBe(1);
  });

  test('keeps hands in the order they were played', () => {
    [1, 2, 3].forEach((n) => saveHand(fakeHand(n)));
    expect(loadHands().map((h) => h.handNo)).toEqual([1, 2, 3]);
  });

  test('summaries read newest first', () => {
    [1, 2, 3].forEach((n) => saveHand(fakeHand(n)));
    expect(listSummaries().map((s) => s.handNo)).toEqual([3, 2, 1]);
  });

  test('drops the oldest hand past the cap', () => {
    for (let n = 1; n <= MAX_HANDS + 5; n++) saveHand(fakeHand(n));
    const hands = loadHands();
    expect(hands).toHaveLength(MAX_HANDS);
    expect(hands[0].handNo).toBe(6);
    expect(hands[hands.length - 1].handNo).toBe(MAX_HANDS + 5);
  });

  test('ignores records from another schema version', () => {
    saveHand(fakeHand(1));
    saveHand(fakeHand(2, { v: HAND_SCHEMA_VERSION + 1 }));
    expect(loadHands().map((h) => h.handNo)).toEqual([1]);
  });

  test('survives corrupt storage rather than throwing', () => {
    localStorage.setItem(HANDS_KEY, 'not json {{{');
    expect(loadHands()).toEqual([]);
    expect(() => saveHand(fakeHand(1))).not.toThrow();
    expect(loadHands()).toHaveLength(1);
  });

  test('summarize pulls out the headline facts', () => {
    const s = summarize(fakeHand(4));
    expect(s.hole).toEqual(['As', 'Kd']);
    expect(s.board).toEqual(['2h', '7c', 'Td']);
    expect(s.net).toBe(-40);
    expect(s.cost).toBe(12);
    expect(s.decisions).toBe(2);
    expect(s.showdown).toBe(true);
  });

  test('saving is best-effort when the quota is exhausted', () => {
    // A store that refuses everything must not throw out of saveHand -- the
    // hand that was just played is already over and cannot be replayed to
    // try again.
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
    try {
      expect(() => saveHand(fakeHand(1))).not.toThrow();
      expect(saveHand(fakeHand(2))).toBe(false);
    } finally {
      Storage.prototype.setItem = real;
    }
  });
});

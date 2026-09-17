import { beforeEach, describe, expect, test } from 'vitest';
import { clearHands, loadHands, mergeHands, saveHand } from './handStore.js';
import { clearAllGames, listGames, loadStore, mergeGames, saveStore } from './games.js';
import { HAND_SCHEMA_VERSION } from './handRecorder.js';

function hand(n, over) {
  return Object.assign({
    v: HAND_SCHEMA_VERSION, id: 'hand-' + n, gameId: 'g_1', handNo: n,
    startedAt: 1700000000000 + n,
    config: { sb: 10, bb: 20, startStack: 1000, dealerIdx: 0, heroIndex: 0, seats: [] },
    holeCards: {}, events: [], decisions: [],
    result: { net: 0, potFinal: 0, showdown: false, heroFolded: false, winners: [] },
  }, over || {});
}

function game(id, over) {
  return Object.assign({
    id: id, createdAt: 1700000000000, endedAt: null, status: 'ended',
    setup: {}, net: 0, state: {},
  }, over || {});
}

describe('mergeHands', () => {
  beforeEach(() => { clearHands(); });

  test('adds hands that are not held locally', () => {
    saveHand(hand(1));
    expect(mergeHands([hand(2), hand(3)])).toBe(2);
    expect(loadHands().map((h) => h.handNo)).toEqual([1, 2, 3]);
  });

  test('never duplicates a hand already held', () => {
    saveHand(hand(1));
    expect(mergeHands([hand(1)])).toBe(0);
    expect(loadHands()).toHaveLength(1);
  });

  test('keeps the local copy of a hand that exists on both sides', () => {
    // Hands are immutable once recorded, so a disagreement means one side is
    // corrupt. Preferring the local copy keeps replay working offline.
    saveHand(hand(1, { handNo: 1, result: { net: 500 } }));
    mergeHands([hand(1, { handNo: 1, result: { net: -999 } })]);
    expect(loadHands()[0].result.net).toBe(500);
  });

  test('orders the merged result oldest first', () => {
    mergeHands([hand(3), hand(1), hand(2)]);
    expect(loadHands().map((h) => h.handNo)).toEqual([1, 2, 3]);
  });
});

describe('mergeGames', () => {
  beforeEach(() => { clearAllGames(); });

  test('adds games that are not held locally', () => {
    expect(mergeGames([game('g_1'), game('g_2')])).toBe(2);
    expect(listGames().map((g) => g.id).sort()).toEqual(['g_1', 'g_2']);
  });

  test('leaves the live game alone', () => {
    // The live game is being played right now; a remote copy is by definition
    // staler than what is in front of the player.
    saveStore({ version: 1, liveId: 'g_1', games: [game('g_1', { status: 'live', net: 250 })] });
    mergeGames([game('g_1', { status: 'ended', net: 0 })]);
    const local = listGames().find((g) => g.id === 'g_1');
    expect(local.status).toBe('live');
    expect(local.net).toBe(250);
  });

  test('takes the remote copy of an ended game', () => {
    saveStore({ version: 1, liveId: null, games: [game('g_1', { net: 10 })] });
    mergeGames([game('g_1', { net: 99 })]);
    expect(listGames().find((g) => g.id === 'g_1').net).toBe(99);
  });
});

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHands, loadHands, MAX_HANDS, mergeHands, saveHand } from './handStore.js';
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

  test('rejects a hand missing config or events so it cannot vanish on the next load', () => {
    // readRaw() requires h.config && h.events on every read, so a hand that
    // slips past a looser merge filter would be counted here and then
    // silently dropped the next time loadHands() runs.
    expect(mergeHands([hand(1, { config: null })])).toBe(0);
    expect(loadHands()).toHaveLength(0);
    expect(mergeHands([hand(1, { events: undefined })])).toBe(0);
    expect(loadHands()).toHaveLength(0);
  });

  test('rejects a hand with a mismatched schema version', () => {
    expect(mergeHands([hand(1, { v: HAND_SCHEMA_VERSION + 1 })])).toBe(0);
    expect(loadHands()).toHaveLength(0);
  });

  test('returns 0 when the write to storage fails', () => {
    saveHand(hand(1));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(mergeHands([hand(2)])).toBe(0);
    setItem.mockRestore();
    // Nothing was persisted, so a plain read (bypassing the mock) still shows
    // only the hand that was already there.
    expect(loadHands().map((h) => h.handNo)).toEqual([1]);
  });

  test('does not count a merged hand that the MAX_HANDS trim immediately evicts', () => {
    // Fill local storage to the cap with hands newer than the one about to be
    // merged in, so the merged one is the oldest of the combined set and is
    // the one shifted off by the trim.
    for (let i = 0; i < MAX_HANDS; i++) {
      saveHand(hand(i + 1, { startedAt: 2000000000000 + i }));
    }
    const older = hand(MAX_HANDS + 1, { startedAt: 1 });
    // The merge step itself would have counted this as added, but the trim
    // that runs right after removes it again -- the returned count must
    // reflect what is actually in storage, not what was added before the trim.
    expect(mergeHands([older])).toBe(0);
    expect(loadHands()).toHaveLength(MAX_HANDS);
    expect(loadHands().some((h) => h.id === older.id)).toBe(false);
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

  // App.jsx reloads to show synced rows when a merge returns non-zero, so
  // this return value has to be able to settle at 0 -- otherwise re-pulling
  // the same already-known ended game over and over would reload forever.
  test('returns 0 for a game already held locally, even though it still updates it', () => {
    saveStore({ version: 1, liveId: null, games: [game('g_1', { net: 10 })] });
    expect(mergeGames([game('g_1', { net: 10 })])).toBe(0);
    // The update itself still happens (see "takes the remote copy" above) --
    // only the count that would drive a reload loop is what changed here.
    expect(listGames().find((g) => g.id === 'g_1').net).toBe(10);
  });
});

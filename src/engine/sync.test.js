import { beforeEach, describe, expect, test, vi } from 'vitest';
import { HAND_SCHEMA_VERSION } from './handRecorder.js';

const upsert = vi.fn();
const select = vi.fn();
const from = vi.fn(() => ({ upsert, select }));

vi.mock('./supabaseClient.js', () => ({
  supabase: { from: (...a) => from(...a) },
  isConfigured: true,
  SUPABASE_URL: 'https://example.supabase.co',
}));
vi.mock('./auth.js', () => ({ getUser: vi.fn(async () => ({ id: 'user-1' })) }));

let sync;
beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  upsert.mockResolvedValue({ error: null });
  select.mockResolvedValue({ data: [], error: null });
  sync = await import('./sync.js');
});

const HAND = {
  v: HAND_SCHEMA_VERSION, id: 'hand-1', gameId: 'g_1', handNo: 7,
  startedAt: 1700000000000, endedAt: 1700000060000,
  config: { sb: 10, bb: 20, startStack: 1000, dealerIdx: 0, heroIndex: 0, seats: [{ id: 0, isHero: true, stack: 1000 }] },
  holeCards: { 0: ['As', 'Kd'] }, events: [], decisions: [{ cost: 12 }],
  result: { net: -40, potFinal: 120, showdown: true, heroFolded: false, winners: [1] },
};

const GAME = {
  id: 'g_1', createdAt: 1700000000000, endedAt: null, status: 'live',
  setup: { pace: '1.15' }, net: 30, state: { handNo: 7 },
};

describe('row mapping', () => {
  test('a hand row carries the summary columns and the whole record', () => {
    const row = sync.toHandRow(HAND, 'user-1');
    expect(row.id).toBe('hand-1');
    expect(row.user_id).toBe('user-1');
    expect(row.game_id).toBe('g_1');
    expect(row.hand_no).toBe(7);
    expect(row.schema_version).toBe(HAND_SCHEMA_VERSION);
    expect(row.net).toBe(-40);
    expect(row.showdown).toBe(true);
    expect(row.ev_cost).toBe(12);
    // Timestamps go up as ISO strings; Postgres timestamptz will not take a
    // JavaScript epoch integer.
    expect(row.started_at).toBe(new Date(1700000000000).toISOString());
    expect(row.record).toEqual(HAND);
  });

  test('a hand row survives a null gameId', () => {
    expect(sync.toHandRow({ ...HAND, gameId: null }, 'u').game_id).toBeNull();
  });

  test('a game row maps status and jsonb blobs', () => {
    const row = sync.toGameRow(GAME, 'user-1');
    expect(row.id).toBe('g_1');
    expect(row.user_id).toBe('user-1');
    expect(row.status).toBe('live');
    expect(row.net).toBe(30);
    expect(row.setup).toEqual({ pace: '1.15' });
    expect(row.state).toEqual({ handNo: 7 });
    expect(row.ended_at).toBeNull();
  });

  test('round-trips a hand back out of a row unchanged', () => {
    expect(sync.fromHandRow(sync.toHandRow(HAND, 'user-1'))).toEqual(HAND);
  });

  test('a hand row falls back to a valid started_at when startedAt is missing or zero', () => {
    const missing = sync.toHandRow({ ...HAND, startedAt: undefined }, 'user-1');
    expect(missing.started_at).toEqual(expect.any(String));
    expect(() => new Date(missing.started_at).toISOString()).not.toThrow();
    expect(missing.ended_at).toBe(new Date(1700000060000).toISOString());

    const zero = sync.toHandRow({ ...HAND, startedAt: 0, endedAt: null }, 'user-1');
    expect(zero.started_at).toEqual(expect.any(String));
    expect(zero.started_at).not.toBeNull();
    expect(zero.ended_at).toBeNull();
  });

  test('round-trips a game back out of a row unchanged', () => {
    const back = sync.fromGameRow(sync.toGameRow(GAME, 'user-1'));
    expect(back.id).toBe(GAME.id);
    expect(back.createdAt).toBe(GAME.createdAt);
    expect(back.endedAt).toBeNull();
    expect(back.status).toBe('live');
    expect(back.net).toBe(30);
    expect(back.setup).toEqual(GAME.setup);
    expect(back.state).toEqual(GAME.state);
  });

  test('a game row falls back to a valid created_at when createdAt is missing or zero', () => {
    const missing = sync.toGameRow({ ...GAME, createdAt: undefined }, 'user-1');
    expect(missing.created_at).toEqual(expect.any(String));
    expect(() => new Date(missing.created_at).toISOString()).not.toThrow();
    expect(missing.ended_at).toBeNull();

    const zero = sync.toGameRow({ ...GAME, createdAt: 0 }, 'user-1');
    expect(zero.created_at).toEqual(expect.any(String));
    expect(zero.created_at).not.toBeNull();
    expect(zero.ended_at).toBeNull();
  });
});

describe('push', () => {
  test('sends nothing and reports zero when there is nothing local', async () => {
    const res = await sync.push();
    expect(res).toEqual({ games: 0, hands: 0, error: null });
    expect(upsert).not.toHaveBeenCalled();
  });

  test('upserts local games and hands', async () => {
    localStorage.setItem('chipaway.games.v1', JSON.stringify({ version: 1, liveId: 'g_1', games: [GAME] }));
    localStorage.setItem('chipaway.hands.v1', JSON.stringify([HAND]));
    const res = await sync.push();
    expect(res.error).toBeNull();
    expect(res.games).toBe(1);
    expect(res.hands).toBe(1);
    expect(from).toHaveBeenCalledWith('games');
    expect(from).toHaveBeenCalledWith('hands');
  });

  test('reports the error rather than throwing when a write is rejected', async () => {
    localStorage.setItem('chipaway.hands.v1', JSON.stringify([HAND]));
    upsert.mockResolvedValue({ error: { message: 'permission denied' } });
    const res = await sync.push();
    expect(res.error).toBe('permission denied');
  });

  test('reports a readable error rather than throwing when the upsert call itself rejects (transport-level)', async () => {
    localStorage.setItem('chipaway.hands.v1', JSON.stringify([HAND]));
    upsert.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await sync.push();
    expect(res.error).toBe("Can't reach the server. Check your connection and try again.");
    expect(res.games).toBe(0);
    expect(res.hands).toBe(0);
  });
});

describe('pull', () => {
  test('merges remote rows into the local stores', async () => {
    select.mockImplementation(() => Promise.resolve({
      data: [sync.toHandRow(HAND, 'user-1')], error: null,
    }));
    const res = await sync.pull();
    expect(res.error).toBeNull();
    expect(res.hands).toBeGreaterThanOrEqual(1);
  });

  test('reports a read error rather than throwing', async () => {
    select.mockResolvedValue({ data: null, error: { message: 'jwt expired' } });
    const res = await sync.pull();
    expect(res.error).toBe('jwt expired');
  });

  test('reports a readable error rather than throwing when the select call itself rejects (transport-level)', async () => {
    select.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await sync.pull();
    expect(res.error).toBe("Can't reach the server. Check your connection and try again.");
    expect(res.games).toBe(0);
    expect(res.hands).toBe(0);
  });
});

describe('syncNow', () => {
  test('refuses politely when nobody is signed in', async () => {
    const auth = await import('./auth.js');
    auth.getUser.mockResolvedValue(null);
    const res = await sync.syncNow();
    expect(res.error).toBe('Not signed in.');
    expect(upsert).not.toHaveBeenCalled();
  });

  test('resolves the user once and passes it down to pull() and push(), not three times', async () => {
    localStorage.setItem('chipaway.games.v1', JSON.stringify({ version: 1, liveId: 'g_1', games: [GAME] }));
    localStorage.setItem('chipaway.hands.v1', JSON.stringify([HAND]));
    const auth = await import('./auth.js');
    auth.getUser.mockResolvedValue({ id: 'user-1' });
    const res = await sync.syncNow();
    expect(res.error).toBeNull();
    expect(auth.getUser).toHaveBeenCalledTimes(1);
  });
});

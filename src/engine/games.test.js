import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GAMES_KEY, LEGACY_KEY,
  clearAllGames, createGame, endGame, getLiveGame, lifetimeStats,
  listGames, loadStore, migrateLegacySession, updateLiveGame,
} from './games.js';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function statsWith(fields) {
  return { hands: 0, vpip: 0, pfr: 0, f3bOpp: 0, f3b: 0, aggro: 0, calls: 0, wtsd: 0,
    guessTotal: 0, guessRight: 0, rgTotal: 0, rgRight: 0, ...fields };
}

describe('creating games', () => {
  it('points liveId at the new game', () => {
    const g = createGame({ pace: '0.65' });
    expect(getLiveGame().id).toBe(g.id);
    expect(g.status).toBe('live');
    expect(g.setup.pace).toBe('0.65');
  });

  it('fills in defaults for anything the setup leaves out', () => {
    const g = createGame({ pace: '1.7' });
    expect(g.setup.showdownGuess).toBe(false);
    expect(g.setup.rangeGuess).toBe(false);
    expect(g.setup.seats).toEqual([]);
  });

  it('retires the previous live game', () => {
    const first = createGame();
    const second = createGame();
    const store = loadStore();
    const retired = store.games.find((x) => x.id === first.id);
    expect(retired.status).toBe('ended');
    expect(retired.endedAt).toBeGreaterThan(0);
    expect(store.liveId).toBe(second.id);
  });

  it('keeps at most one live game however many are created', () => {
    createGame();
    createGame();
    createGame();
    expect(listGames().filter((g) => g.status === 'live')).toHaveLength(1);
  });
});

describe('ending games', () => {
  it('stamps endedAt and clears the pointer', () => {
    const g = createGame();
    endGame(g.id);
    expect(getLiveGame()).toBeNull();
    expect(listGames()[0].status).toBe('ended');
    expect(listGames()[0].endedAt).toBeGreaterThan(0);
  });

  // Ending a game that is already finished must not orphan the one still
  // running, which is why retire() checks the pointer before clearing it.
  it('leaves the live pointer alone when ending an older game', () => {
    const first = createGame();
    const second = createGame();
    endGame(first.id);
    expect(getLiveGame().id).toBe(second.id);
  });

  it('is harmless for an unknown id', () => {
    const g = createGame();
    expect(() => endGame('g_nope')).not.toThrow();
    expect(getLiveGame().id).toBe(g.id);
  });
});

describe('updating the live game', () => {
  it('merges the patch into the record', () => {
    createGame();
    updateLiveGame({ net: 240, state: { stats: statsWith({ hands: 3 }) } });
    const live = getLiveGame();
    expect(live.net).toBe(240);
    expect(live.state.stats.hands).toBe(3);
  });

  it('does nothing when no game is live', () => {
    expect(updateLiveGame({ net: 99 })).toBeNull();
    expect(listGames()).toHaveLength(0);
  });
});

describe('reading a damaged store', () => {
  it('returns an empty store for unparseable JSON', () => {
    localStorage.setItem(GAMES_KEY, '{not json');
    expect(loadStore()).toEqual({ version: 1, liveId: null, games: [] });
    expect(listGames()).toEqual([]);
    expect(getLiveGame()).toBeNull();
  });

  it('returns an empty store for JSON of the wrong shape', () => {
    localStorage.setItem(GAMES_KEY, '{"hello":"world"}');
    expect(listGames()).toEqual([]);
  });

  it('survives a liveId that points at nothing', () => {
    localStorage.setItem(GAMES_KEY, JSON.stringify({ version: 1, liveId: 'g_gone', games: [] }));
    expect(getLiveGame()).toBeNull();
  });
});

describe('listing', () => {
  it('returns games newest first', () => {
    const store = { version: 1, liveId: null, games: [
      { id: 'a', createdAt: 100, status: 'ended' },
      { id: 'c', createdAt: 300, status: 'ended' },
      { id: 'b', createdAt: 200, status: 'ended' },
    ] };
    localStorage.setItem(GAMES_KEY, JSON.stringify(store));
    expect(listGames().map((g) => g.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('lifetimeStats', () => {
  it('adds counters and nets across games', () => {
    const games = [
      { net: 300, state: { stats: statsWith({ hands: 10, vpip: 4, pfr: 2, aggro: 6, calls: 3 }), evRecords: [{ cost: 5 }] } },
      { net: -100, state: { stats: statsWith({ hands: 30, vpip: 8, pfr: 6, aggro: 6, calls: 9 }), evRecords: [{ cost: 7 }] } },
    ];
    const life = lifetimeStats(games);
    expect(life.games).toBe(2);
    expect(life.hands).toBe(40);
    expect(life.net).toBe(200);
    expect(life.vpip).toBeCloseTo(30);
    expect(life.pfr).toBeCloseTo(20);
    expect(life.af).toBeCloseTo(1);
    expect(life.evRecords).toHaveLength(2);
  });

  it('reports rates with no denominator as null rather than NaN', () => {
    const life = lifetimeStats([{ net: 0, state: { stats: statsWith({}) } }]);
    expect(life.f3b).toBeNull();
    expect(life.read).toBeNull();
    expect(life.vpip).toBe(0);
  });

  it('copes with games saved without state', () => {
    expect(() => lifetimeStats([{ net: 50 }])).not.toThrow();
    expect(lifetimeStats([{ net: 50 }]).net).toBe(50);
  });
});

describe('migration from the old single-session save', () => {
  const legacy = {
    stats: statsWith({ hands: 22, vpip: 9 }),
    handLog: [{ vpip: true }],
    evRecords: [{ cost: 4, n: 2 }],
    matchResults: [10, -20],
    handNo: 22,
  };

  it('wraps the legacy payload as one live game and removes the old key', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    const g = migrateLegacySession();
    expect(g.status).toBe('live');
    expect(g.migrated).toBe(true);
    expect(g.state.stats.hands).toBe(22);
    expect(g.state.handLog).toHaveLength(1);
    expect(g.state.handNo).toBe(22);
    expect(getLiveGame().id).toBe(g.id);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  // The old save never recorded a chip total, so there is nothing to recover.
  it('starts the migrated game at level rather than guessing a net', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    expect(migrateLegacySession().net).toBe(0);
  });

  it('does nothing on a second run', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    migrateLegacySession();
    const before = localStorage.getItem(GAMES_KEY);
    expect(migrateLegacySession()).toBeNull();
    expect(localStorage.getItem(GAMES_KEY)).toBe(before);
  });

  it('does not clobber an existing store', () => {
    const g = createGame({ pace: '1.7' });
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    expect(migrateLegacySession()).toBeNull();
    expect(getLiveGame().id).toBe(g.id);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('discards an unparseable legacy save instead of throwing', () => {
    localStorage.setItem(LEGACY_KEY, '{broken');
    expect(migrateLegacySession()).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('does nothing when there is no legacy save', () => {
    expect(migrateLegacySession()).toBeNull();
  });
});

describe('clearing', () => {
  it('removes every game', () => {
    createGame();
    endGame(getLiveGame().id);
    createGame();
    clearAllGames();
    expect(listGames()).toEqual([]);
    expect(getLiveGame()).toBeNull();
  });
});

describe('storage failures', () => {
  it('does not throw when localStorage refuses to write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => createGame()).not.toThrow();
  });
});

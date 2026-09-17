/* ============================================================
   GAMES — the record of every sitting at the table
   ============================================================
   A "game" is one sitting: created with a setup, played over many hands, ended
   explicitly. At most one is live at a time, and `liveId` is what says which.
   Deriving liveness from a status field alone would let two records disagree;
   a pointer cannot.

   This module is the only thing that touches the storage key. The dashboard
   never reaches into the engine and the engine never learns what a dashboard
   is — both talk to this.

   Every function here is total. Corrupt or absent storage yields an empty
   store rather than throwing: localStorage is shared with whatever else the
   browser has put there, and a dashboard that dies on bad JSON is worse than
   one showing no games.
   ============================================================ */

export const GAMES_KEY = 'chipaway.games.v1';
export const LEGACY_KEY = 'chipaway.session.v1';

// The counters the engine keeps on `stats`. Listed here so lifetimeStats can
// add up games without knowing what any individual field means.
const STAT_COUNTERS = [
  'hands', 'vpip', 'pfr', 'f3bOpp', 'f3b', 'aggro', 'calls', 'wtsd',
  'guessTotal', 'guessRight', 'rgTotal', 'rgRight',
];

export function emptyStore() {
  return { version: 1, liveId: null, games: [] };
}

export function defaultSetup() {
  return { pace: '1.15', showdownGuess: false, rangeGuess: false, seats: [] };
}

function emptyStats() {
  const s = { byStreet: {} };
  STAT_COUNTERS.forEach((k) => { s[k] = 0; });
  return s;
}

function emptyState() {
  return { stats: emptyStats(), handLog: [], evRecords: [], matchResults: [], handNo: 0 };
}

/* ---- storage ---- */

export function loadStore() {
  try {
    const raw = localStorage.getItem(GAMES_KEY);
    if (!raw) return emptyStore();
    const d = JSON.parse(raw);
    // A store missing its games array is indistinguishable from junk left by
    // something else under the same key, so treat both the same way.
    if (!d || !Array.isArray(d.games)) return emptyStore();
    return { version: 1, liveId: d.liveId || null, games: d.games };
  } catch (e) {
    return emptyStore();
  }
}

export function saveStore(store) {
  // Swallowed the same way saveSession() swallows it: a full or blocked
  // localStorage must not take the hand down with it.
  try {
    localStorage.setItem(GAMES_KEY, JSON.stringify(store));
  } catch (e) { /* quota, private mode, disabled storage */ }
}

/* ---- reading ---- */

export function listGames() {
  return loadStore().games.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getLiveGame() {
  const store = loadStore();
  if (!store.liveId) return null;
  return store.games.find((g) => g.id === store.liveId) || null;
}

/* ---- writing ---- */

// Retiring the live game here is what makes "at most one live game" an
// invariant of this module rather than a rule every caller has to remember.
// Two games created inside the same millisecond would collide on a timestamp
// alone, and every lookup here is a find-by-id — a duplicate means writes land
// on the wrong record. The suffix is what keeps ids unique.
function newId(now) {
  return 'g_' + now + '_' + Math.random().toString(36).slice(2, 8);
}

export function createGame(setup) {
  const store = loadStore();
  const now = Date.now();
  if (store.liveId) retire(store, store.liveId, now);
  const game = {
    id: newId(now),
    createdAt: now,
    endedAt: null,
    status: 'live',
    setup: { ...defaultSetup(), ...(setup || {}) },
    net: 0,
    state: emptyState(),
  };
  store.games.push(game);
  store.liveId = game.id;
  saveStore(store);
  return game;
}

export function endGame(id) {
  const store = loadStore();
  const game = retire(store, id, Date.now());
  saveStore(store);
  return game;
}

function retire(store, id, at) {
  const game = store.games.find((g) => g.id === id);
  if (game && game.status !== 'ended') {
    game.status = 'ended';
    game.endedAt = at;
  }
  // Only clear the pointer if it was pointing at this game — ending an
  // already-finished game must not orphan the one that is still running.
  if (store.liveId === id) store.liveId = null;
  return game || null;
}

export function updateLiveGame(patch) {
  const store = loadStore();
  if (!store.liveId) return null;
  const game = store.games.find((g) => g.id === store.liveId);
  if (!game) return null;
  Object.assign(game, patch);
  saveStore(store);
  return game;
}

export function clearAllGames() {
  try {
    localStorage.removeItem(GAMES_KEY);
  } catch (e) { /* see saveStore */ }
}

/* ---- aggregation ---- */

// The same shape heroMetrics() returns in the engine, plus the totals the
// dashboard strip shows, so the two read identically.
export function lifetimeStats(games) {
  const list = games || listGames();
  const stats = emptyStats();
  let net = 0;
  let evRecords = [];
  list.forEach((g) => {
    const s = (g.state && g.state.stats) || {};
    STAT_COUNTERS.forEach((k) => { stats[k] += Number(s[k]) || 0; });
    net += Number(g.net) || 0;
    if (g.state && Array.isArray(g.state.evRecords)) evRecords = evRecords.concat(g.state.evRecords);
  });
  const h = Math.max(1, stats.hands);
  return {
    games: list.length,
    hands: stats.hands,
    net,
    stats,
    evRecords,
    vpip: 100 * stats.vpip / h,
    pfr: 100 * stats.pfr / h,
    af: stats.aggro / Math.max(1, stats.calls),
    wtsd: 100 * stats.wtsd / h,
    f3b: stats.f3bOpp ? 100 * stats.f3b / stats.f3bOpp : null,
    read: stats.guessTotal ? 100 * stats.guessRight / stats.guessTotal : null,
  };
}

/* ---- migration ---- */

// Someone mid-session when this ships keeps their stats and hand log instead of
// silently losing them. Idempotent: once the legacy key is gone, or a store
// already exists, this does nothing.
export function migrateLegacySession() {
  let raw = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
  if (localStorage.getItem(GAMES_KEY)) {
    try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ }
    return null;
  }
  let legacy;
  try {
    legacy = JSON.parse(raw);
  } catch (e) {
    try { localStorage.removeItem(LEGACY_KEY); } catch (e2) { /* ignore */ }
    return null;
  }
  const now = Date.now();
  const game = {
    id: newId(now),
    createdAt: now,
    endedAt: null,
    status: 'live',
    setup: defaultSetup(),
    // The old save never recorded a chip total, so there is nothing to recover.
    // The flag is what lets the dashboard say "net from upgrade" rather than
    // implying this figure covers every hand played.
    net: 0,
    migrated: true,
    state: {
      stats: { ...emptyStats(), ...(legacy && legacy.stats) },
      handLog: (legacy && legacy.handLog) || [],
      evRecords: (legacy && legacy.evRecords) || [],
      matchResults: (legacy && legacy.matchResults) || [],
      handNo: (legacy && legacy.handNo) || 0,
    },
  };
  saveStore({ version: 1, liveId: game.id, games: [game] });
  try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ }
  return game;
}

/* Fold a batch of games in from the cloud. The LIVE game is never overwritten
   -- it is the sitting in front of the player right now, so any remote copy of
   it is by definition staler. Ended games take the remote version, which is
   what makes a game finished on another machine show up here.

   Returns how many rows were newly added -- deliberately NOT counting
   updates to games already held locally. An ended game gets Object.assign'd
   from its remote copy on every pull whether or not anything actually
   changed, so a count that included updates would be non-zero on every
   re-pull forever. Callers that need to know "did syncing just surface
   something the player has not seen yet" (e.g. reloading to show it) can
   rely on the added count settling at 0 once every remote id has been seen
   locally once; a count that includes updates cannot make that promise. */
export function mergeGames(list) {
  if (!Array.isArray(list) || !list.length) return 0;
  const store = loadStore();
  const byId = {};
  store.games.forEach(function (g) { byId[g.id] = g; });

  let added = 0;
  let updated = 0;
  list.forEach((remote) => {
    if (!remote || !remote.id) return;
    if (remote.id === store.liveId) return;
    const local = byId[remote.id];
    if (!local) {
      store.games.push(remote);
      byId[remote.id] = remote;
      added += 1;
      return;
    }
    Object.assign(local, remote);
    updated += 1;
  });
  if (added || updated) saveStore(store);
  return added;
}

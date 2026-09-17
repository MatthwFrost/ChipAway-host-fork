/* ============================================================
   SYNC — carrying games and hands between this browser and Postgres.

   Offline-first, deliberately. localStorage stays the write path while a hand
   is being played: the engine is synchronous, a hand can finish while the
   network is down, and a save that can fail is not something the end of a hand
   can cope with. Sync is a separate pass that runs at sign-in and after a hand
   is filed.

   Conflict policy, in one line each:
     hands  -- immutable once recorded, so first writer wins and duplicates are
               ignored on both sides.
     games  -- the LIVE game is authoritative locally (it is being played right
               now); ended games take whichever copy the cloud holds.
   ============================================================ */

import { isConfigured, supabase } from './supabaseClient.js';
import { getUser } from './auth.js';
import { listGames, mergeGames } from './games.js';
import { loadHands, mergeHands } from './handStore.js';

const iso = function (ms) { return ms ? new Date(ms).toISOString() : null; };
const ms = function (s) { return s ? new Date(s).getTime() : null; };

const evCostOf = function (hand) {
  return (hand.decisions || []).reduce(function (a, d) { return a + Math.max(0, d.cost || 0); }, 0);
};

/* ---- row mapping ---- */

export function toHandRow(hand, userId) {
  const result = hand.result || {};
  return {
    id: hand.id,
    user_id: userId,
    game_id: hand.gameId || null,
    hand_no: hand.handNo || 0,
    started_at: iso(hand.startedAt),
    ended_at: iso(hand.endedAt),
    schema_version: hand.v,
    net: result.net || 0,
    showdown: !!result.showdown,
    hero_folded: !!result.heroFolded,
    ev_cost: evCostOf(hand),
    record: hand,
  };
}

// The whole hand lives in `record`; the columns are a denormalised index for
// listing. So reading one back is just handing `record` over.
export function fromHandRow(row) { return row.record; }

export function toGameRow(game, userId) {
  return {
    id: game.id,
    user_id: userId,
    created_at: iso(game.createdAt),
    ended_at: iso(game.endedAt),
    status: game.status === 'live' ? 'live' : 'ended',
    setup: game.setup || {},
    net: game.net || 0,
    migrated: !!game.migrated,
    state: game.state || {},
  };
}

export function fromGameRow(row) {
  return {
    id: row.id,
    createdAt: ms(row.created_at),
    endedAt: ms(row.ended_at),
    status: row.status,
    setup: row.setup || {},
    net: row.net || 0,
    migrated: !!row.migrated,
    state: row.state || {},
  };
}

/* ---- transfer ---- */

async function requireUser() {
  if (!isConfigured) return { user: null, error: 'Accounts are not set up in this build.' };
  const user = await getUser();
  if (!user) return { user: null, error: 'Not signed in.' };
  return { user: user, error: null };
}

export async function push() {
  const { user, error } = await requireUser();
  if (error) return { games: 0, hands: 0, error: error };

  const games = listGames();
  const hands = loadHands();
  let pushedGames = 0, pushedHands = 0;

  if (games.length) {
    const rows = games.map(function (g) { return toGameRow(g, user.id); });
    const res = await supabase.from('games').upsert(rows, { onConflict: 'user_id,id' });
    if (res.error) return { games: 0, hands: 0, error: res.error.message };
    pushedGames = rows.length;
  }

  if (hands.length) {
    const rows = hands.map(function (h) { return toHandRow(h, user.id); });
    // ignoreDuplicates: a recorded hand never changes, so re-sending one is a
    // no-op rather than an overwrite.
    const res = await supabase.from('hands')
      .upsert(rows, { onConflict: 'user_id,id', ignoreDuplicates: true });
    if (res.error) return { games: pushedGames, hands: 0, error: res.error.message };
    pushedHands = rows.length;
  }

  return { games: pushedGames, hands: pushedHands, error: null };
}

export async function pull() {
  const { error } = await requireUser();
  if (error) return { games: 0, hands: 0, error: error };

  const gameRes = await supabase.from('games').select('*');
  if (gameRes.error) return { games: 0, hands: 0, error: gameRes.error.message };
  const mergedGames = mergeGames((gameRes.data || []).map(fromGameRow));

  const handRes = await supabase.from('hands').select('*');
  if (handRes.error) return { games: mergedGames, hands: 0, error: handRes.error.message };
  const mergedHands = mergeHands((handRes.data || []).map(fromHandRow).filter(Boolean));

  return { games: mergedGames, hands: mergedHands, error: null };
}

/* Pull before push, so anything this browser has never seen is folded in
   before its own state is sent back up as the record of what exists. */
export async function syncNow() {
  const { error } = await requireUser();
  if (error) return { pushed: null, pulled: null, error: error };
  const pulled = await pull();
  if (pulled.error) return { pushed: null, pulled: pulled, error: pulled.error };
  const pushed = await push();
  return { pushed: pushed, pulled: pulled, error: pushed.error };
}

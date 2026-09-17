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
// created_at (games) and started_at (hands) are NOT NULL columns, so a
// missing or falsy (e.g. 0) input must not collapse to null the way iso()
// does for the nullable ended_at columns. Fall back to "now" -- the record
// is being synced at this instant, so it is a reasonable stand-in for an
// unknown start time and keeps the row insertable rather than rejected.
const isoRequired = function (v) { return iso(v) || new Date().toISOString(); };
const ms = function (s) { return s ? new Date(s).getTime() : null; };

// supabase-js resolves { data, error } for an API-level failure but REJECTS
// the promise for a transport-level one (offline, DNS, CORS, an aborted
// request). Every direct call below is wrapped so that path still comes out
// the documented { games, hands, error } / { pushed, pulled, error } shape
// instead of an escaped exception -- see auth.js for the getUser() side of
// this, which push()/pull() reach through requireUser().
const NETWORK_ERROR = "Can't reach the server. Check your connection and try again.";

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
    started_at: isoRequired(hand.startedAt),
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
    created_at: isoRequired(game.createdAt),
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

// `presetUser` lets syncNow() resolve the user once and hand it down to
// pull()/push() instead of each re-validating the token with the auth
// server. Called with no argument, push() resolves its own user exactly as
// before, so it still works standalone.
export async function push(presetUser) {
  let user = presetUser;
  if (!user) {
    const required = await requireUser();
    if (required.error) return { games: 0, hands: 0, error: required.error };
    user = required.user;
  }

  const games = listGames();
  const hands = loadHands();
  let pushedGames = 0, pushedHands = 0;

  if (games.length) {
    const rows = games.map(function (g) { return toGameRow(g, user.id); });
    let res;
    try {
      res = await supabase.from('games').upsert(rows, { onConflict: 'user_id,id' });
    } catch (e) {
      return { games: 0, hands: 0, error: NETWORK_ERROR };
    }
    if (res.error) return { games: 0, hands: 0, error: res.error.message };
    pushedGames = rows.length;
  }

  if (hands.length) {
    const rows = hands.map(function (h) { return toHandRow(h, user.id); });
    // ignoreDuplicates: a recorded hand never changes, so re-sending one is a
    // no-op rather than an overwrite.
    let res;
    try {
      res = await supabase.from('hands')
        .upsert(rows, { onConflict: 'user_id,id', ignoreDuplicates: true });
    } catch (e) {
      return { games: pushedGames, hands: 0, error: NETWORK_ERROR };
    }
    if (res.error) return { games: pushedGames, hands: 0, error: res.error.message };
    pushedHands = rows.length;
  }

  return { games: pushedGames, hands: pushedHands, error: null };
}

// See push() above for `presetUser`.
export async function pull(presetUser) {
  // presetUser (from syncNow(), which has already resolved and checked it)
  // skips this re-check entirely. Called standalone, pull() still has to
  // confirm isConfigured/signed-in itself -- the resolved user is not needed
  // below (the queries are scoped by RLS, not by an id this function passes
  // along), only the guard is.
  if (!presetUser) {
    const required = await requireUser();
    if (required.error) return { games: 0, hands: 0, error: required.error };
  }

  let gameRes;
  try {
    gameRes = await supabase.from('games').select('*');
  } catch (e) {
    return { games: 0, hands: 0, error: NETWORK_ERROR };
  }
  if (gameRes.error) return { games: 0, hands: 0, error: gameRes.error.message };
  const mergedGames = mergeGames((gameRes.data || []).map(fromGameRow));

  let handRes;
  try {
    handRes = await supabase.from('hands').select('*');
  } catch (e) {
    return { games: mergedGames, hands: 0, error: NETWORK_ERROR };
  }
  if (handRes.error) return { games: mergedGames, hands: 0, error: handRes.error.message };
  const mergedHands = mergeHands((handRes.data || []).map(fromHandRow).filter(Boolean));

  return { games: mergedGames, hands: mergedHands, error: null };
}

/* Push before pull. Hands are immutable and deduped both ways (the server
   upserts with ignoreDuplicates, mergeHands keeps whatever id is already
   local), so sending what is here up first cannot lose anything. Pulling
   first used to be the actual bug: mergeHands appends the remote rows, sorts
   everyone by startedAt, and trims to MAX_HANDS by shifting off the oldest of
   the *combined* set -- which, right after a pull and before the push on the
   next line, can include hands that exist only on this device and have never
   reached the server. Push-then-pull is the standard offline-first order for
   exactly this reason: publish what only you have before you fold in what
   only the server has.

   A failed push does not skip the pull: a pull cannot damage the server, and
   there is no reason to also withhold whatever the cloud has just because the
   upload side hit a network error. The push error is still the one reported
   back, since it is the one that means something local may not be backed up
   yet -- a pull failing after a successful push is comparatively harmless. */
export async function syncNow() {
  const { user, error } = await requireUser();
  if (error) return { pushed: null, pulled: null, error: error };
  const pushed = await push(user);
  const pulled = await pull(user);
  return { pushed: pushed, pulled: pulled, error: pushed.error || pulled.error };
}

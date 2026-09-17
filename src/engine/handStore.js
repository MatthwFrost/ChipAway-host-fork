/* ============================================================
   HAND STORE — a bounded, quota-safe local archive of played hands.

   localStorage gives about 5MB and a recorded hand runs 1.5-3KB, so the cap is
   a real limit but a distant one. It is a ring buffer rather than unbounded
   growth because the failure mode of unbounded growth is a QuotaExceededError
   thrown in the middle of finishing a hand, and losing the hand you just played
   to a storage error is worse than losing the hand you played last month.

   Every write is best-effort. The session save at the end of concludeHand
   already swallows storage errors for the same reason: a browser in private
   mode with storage disabled should still deal cards.

   In sub-project 2 this module is where the Supabase sync sits: the same
   append/list API, backed by a `hands` table with an `auth.uid() = user_id`
   row-level policy, with localStorage kept as the offline buffer.
   ============================================================ */

import { HAND_SCHEMA_VERSION } from './handRecorder.js';

export const HANDS_KEY = 'chipaway.hands.v1';
export const MAX_HANDS = 500;

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch (e) {
    // Access itself throws in some privacy modes, before any read.
    return null;
  }
}

function readRaw() {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(HANDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // A record written by a newer or older schema is dropped rather than
    // guessed at. Silent partial reads are how a replayer ends up drawing a
    // hand that never happened.
    return parsed.filter(function (h) { return h && h.v === HAND_SCHEMA_VERSION && h.config && h.events; });
  } catch (e) {
    return [];
  }
}

function writeRaw(list) {
  const s = storage();
  if (!s) return false;
  let hands = list;
  // Evict oldest and retry rather than failing the write. Three attempts
  // covers a store that is full of something else, at which point we give up
  // quietly instead of looping.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      s.setItem(HANDS_KEY, JSON.stringify(hands));
      return true;
    } catch (e) {
      if (hands.length <= 1) return false;
      hands = hands.slice(Math.ceil(hands.length / 2));
    }
  }
  return false;
}

/* Newest last, matching the order they were played. */
export function loadHands() {
  return readRaw();
}

export function saveHand(hand) {
  if (!hand) return false;
  const hands = readRaw();
  hands.push(hand);
  while (hands.length > MAX_HANDS) hands.shift();
  return writeRaw(hands);
}

export function getHand(id) {
  const hands = readRaw();
  for (let i = 0; i < hands.length; i++) if (hands[i].id === id) return hands[i];
  return null;
}

export function clearHands() {
  const s = storage();
  if (!s) return;
  try { s.removeItem(HANDS_KEY); } catch (e) { /* nothing to do */ }
}

/* The list view needs a headline per hand and nothing else. Summarising here
   keeps the History screen from holding every event of every hand in memory
   just to render a list of rows. */
export function summarize(hand) {
  const hero = hand.config.seats.filter(function (s) { return s.isHero; })[0];
  const heroId = hero ? hero.id : hand.config.heroIndex;
  const holeCards = (hand.holeCards || {})[heroId] || [];
  const cost = (hand.decisions || []).reduce(function (a, d) { return a + Math.max(0, d.cost || 0); }, 0);
  const streets = (hand.events || []).filter(function (e) { return e.t === 'street'; });
  return {
    id: hand.id,
    gameId: hand.gameId || null,
    handNo: hand.handNo,
    startedAt: hand.startedAt,
    hole: holeCards,
    board: streets.length ? streets[streets.length - 1].cards : [],
    net: hand.result ? hand.result.net : 0,
    showdown: !!(hand.result && hand.result.showdown),
    folded: !!(hand.result && hand.result.heroFolded),
    cost: cost,
    decisions: (hand.decisions || []).length,
  };
}

/* Newest first, because the hand you most want to review is the one you just
   played. A gameId narrows the list to one sitting; omitting it spans them all.
   Hands outlive the game record they point at — clearing game history does not
   delete the hands, and a summary for a game that no longer exists is still a
   hand you played. */
export function listSummaries(gameId) {
  const all = loadHands().map(summarize).reverse();
  return gameId ? all.filter(function (s) { return s.gameId === gameId; }) : all;
}

/* Fold a batch of hands in from somewhere else (the cloud) without disturbing
   what is already here. Local wins on a collision: a recorded hand is
   immutable, so a difference means one copy is wrong, and the local one is the
   one this browser can definitely replay. Returns how many were added. */
export function mergeHands(list) {
  if (!Array.isArray(list) || !list.length) return 0;
  const hands = readRaw();
  const seen = {};
  hands.forEach(function (h) { seen[h.id] = true; });

  let added = 0;
  list.forEach(function (h) {
    if (!h || !h.id || seen[h.id]) return;
    // Match readRaw's acceptance check exactly: a hand that would be dropped
    // on the very next load must not be counted as merged here either.
    if (h.v !== HAND_SCHEMA_VERSION || !h.config || !h.events) return;
    hands.push(h);
    seen[h.id] = true;
    added += 1;
  });
  if (!added) return 0;

  hands.sort(function (a, b) { return (a.startedAt || 0) - (b.startedAt || 0); });
  while (hands.length > MAX_HANDS) hands.shift();
  if (!writeRaw(hands)) return 0;
  return added;
}

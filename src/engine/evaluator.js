/* ============================================================
   CARDS + HAND EVALUATOR

   Pure card primitives and the 5-card evaluator, lifted out of the
   game engine so hand-shape analysis and tests can use them directly.
   ============================================================ */

export const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS = ['s', 'h', 'd', 'c'];
export const PIPS = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAMES = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };

export const makeDeck = function () {
  const d = [];
  for (let r = 2; r <= 14; r++) for (let i = 0; i < 4; i++) d.push({ rank: r, suit: SUITS[i] });
  return d;
};
// `rng` defaults to Math.random so every existing caller is unchanged. The
// headless harness passes a seeded generator instead, which is what makes a
// 10,000-hand run reproducible.
export function shuffle(deck, rng) {
  const r = rng || Math.random;
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
  return d;
}
export const cardStr = function (c) { return RANK_CHARS[c.rank - 2] + c.suit; };
// A dense 0-51 index for a card, so the Monte Carlo loop can track which cards
// are already dealt in a typed array instead of a string-keyed object.
export const SUIT_IDX = { s: 0, h: 1, d: 2, c: 3 };
export const cardId = function (c) { return (c.rank - 2) * 4 + SUIT_IDX[c.suit]; };
export const DECK_BY_ID = (function () {
  const d = new Array(52);
  for (let r = 2; r <= 14; r++) for (let i = 0; i < 4; i++) d[(r - 2) * 4 + i] = { rank: r, suit: SUITS[i] };
  return d;
})();
export const cardTxt = function (c) { return RANK_CHARS[c.rank - 2] + PIPS[c.suit]; };

export function combos5(cards) {
  const out = [], n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) out.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  return out;
}
export function evaluate5(cards) {
  const ranks = cards.map(function (c) { return c.rank; }).sort(function (x, y) { return y - x; });
  const suits = cards.map(function (c) { return c.suit; });
  const isFlush = suits.every(function (s) { return s === suits[0]; });
  const counts = {}; for (let i = 0; i < ranks.length; i++) counts[ranks[i]] = (counts[ranks[i]] || 0) + 1;
  const groups = Object.keys(counts).map(function (k) { return { rank: +k, count: counts[k] }; }).sort(function (a, b) { return b.count - a.count || b.rank - a.rank; });
  const uniq = ranks.filter(function (v, i) { return ranks.indexOf(v) === i; });
  let sh = null;
  if (uniq.length === 5) { if (uniq[0] - uniq[4] === 4) sh = uniq[0]; else if (uniq.join(',') === '14,5,4,3,2') sh = 5; }
  if (sh && isFlush) return [8, sh];
  if (groups[0].count === 4) return [7, groups[0].rank, groups[1].rank];
  if (groups[0].count === 3 && groups[1].count === 2) return [6, groups[0].rank, groups[1].rank];
  if (isFlush) return [5].concat(ranks);
  if (sh) return [4, sh];
  if (groups[0].count === 3) return [3, groups[0].rank].concat(groups.slice(1).map(function (g) { return g.rank; }));
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pr = [groups[0].rank, groups[1].rank].sort(function (a, b) { return b - a; });
    return [2, pr[0], pr[1], groups[2].rank];
  }
  if (groups[0].count === 2) return [1, groups[0].rank].concat(groups.slice(1).map(function (g) { return g.rank; }));
  return [0].concat(ranks);
}
export function cmpScore(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) { const av = (a[i] === undefined ? -1 : a[i]), bv = (b[i] === undefined ? -1 : b[i]); if (av !== bv) return av - bv; }
  return 0;
}
// The original definition: try all 5-card subsets and keep the best. Correct,
// obvious, and far too slow to run ten thousand hands through — 21 subsets per
// call, each allocating half a dozen arrays and objects. Kept as the reference
// that evaluateBest is proved identical to in evaluator.test.js.
export function evaluateBestByCombos(cards) {
  if (cards.length < 5) return [-1];
  if (cards.length === 5) return evaluate5(cards);
  const cs = combos5(cards);
  let best = null;
  for (let i = 0; i < cs.length; i++) { const s = evaluate5(cs[i]); if (best === null || cmpScore(s, best) > 0) best = s; }
  return best;
}

const SUIT_LIST = ['s', 'h', 'd', 'c'];

// Highest card of a 5-in-a-row inside a rank bitmask, or 0. The ace is added
// back in at index 1 so the wheel (A-2-3-4-5) is found by the same loop.
function straightHigh(mask) {
  let m = mask;
  if (m & (1 << 14)) m |= (1 << 1);
  for (let hi = 14; hi >= 5; hi--) {
    const need = (1 << hi) | (1 << (hi - 1)) | (1 << (hi - 2)) | (1 << (hi - 3)) | (1 << (hi - 4));
    if ((m & need) === need) return hi;
  }
  return 0;
}

// Same answer as evaluateBestByCombos, in one pass over the cards instead of
// twenty-one passes over subsets. Emits byte-identical score arrays — the
// category, then exactly the tiebreakers the old code emitted, in order.
export function evaluateBest(cards) {
  const n = cards.length;
  if (n < 5) return [-1];

  const rc = new Uint8Array(15);
  const suitCount = { s: 0, h: 0, d: 0, c: 0 };
  const suitMask = { s: 0, h: 0, d: 0, c: 0 };
  let rankMask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    rc[c.rank]++;
    suitCount[c.suit]++;
    suitMask[c.suit] |= (1 << c.rank);
    rankMask |= (1 << c.rank);
  }

  let flushSuit = null;
  for (let i = 0; i < 4; i++) if (suitCount[SUIT_LIST[i]] >= 5) { flushSuit = SUIT_LIST[i]; break; }

  if (flushSuit !== null) {
    const sf = straightHigh(suitMask[flushSuit]);
    if (sf) return [8, sf];
  }

  const quads = [], trips = [], pairs = [];
  for (let r = 14; r >= 2; r--) {
    if (rc[r] === 4) quads.push(r);
    else if (rc[r] === 3) trips.push(r);
    else if (rc[r] === 2) pairs.push(r);
  }

  if (quads.length) {
    let k = 0;
    for (let r = 14; r >= 2; r--) if (r !== quads[0] && rc[r] > 0) { k = r; break; }
    return [7, quads[0], k];
  }

  if (trips.length && (trips.length > 1 || pairs.length)) {
    // Two trips play as the higher trips over the lower one as the pair.
    const second = trips.length > 1
      ? Math.max(trips[1], pairs.length ? pairs[0] : 0)
      : pairs[0];
    return [6, trips[0], second];
  }

  if (flushSuit !== null) {
    const out = [5];
    const m = suitMask[flushSuit];
    for (let r = 14; r >= 2 && out.length < 6; r--) if (m & (1 << r)) out.push(r);
    return out;
  }

  const sh = straightHigh(rankMask);
  if (sh) return [4, sh];

  if (trips.length) {
    const out = [3, trips[0]];
    for (let r = 14; r >= 2 && out.length < 4; r--) if (r !== trips[0] && rc[r] > 0) out.push(r);
    return out;
  }

  if (pairs.length >= 2) {
    let k = 0;
    for (let r = 14; r >= 2; r--) if (r !== pairs[0] && r !== pairs[1] && rc[r] > 0) { k = r; break; }
    return [2, pairs[0], pairs[1], k];
  }

  if (pairs.length === 1) {
    const out = [1, pairs[0]];
    for (let r = 14; r >= 2 && out.length < 5; r--) if (r !== pairs[0] && rc[r] > 0) out.push(r);
    return out;
  }

  const out = [0];
  for (let r = 14; r >= 2 && out.length < 6; r--) if (rc[r] > 0) out.push(r);
  return out;
}
export function scoreKey(s) { let k = 0; for (let i = 0; i < 6; i++) k = k * 15 + (s[i] === undefined ? 0 : s[i]); return k; }

export const HAND_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
export const handName = function (s) { return s[0] < 0 ? '—' : HAND_NAMES[s[0]]; };

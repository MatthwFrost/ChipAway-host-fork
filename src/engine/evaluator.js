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
export function shuffle(deck) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
  return d;
}
export const cardStr = function (c) { return RANK_CHARS[c.rank - 2] + c.suit; };
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
export function evaluateBest(cards) {
  if (cards.length < 5) return [-1];
  if (cards.length === 5) return evaluate5(cards);
  const cs = combos5(cards);
  let best = null;
  for (let i = 0; i < cs.length; i++) { const s = evaluate5(cs[i]); if (best === null || cmpScore(s, best) > 0) best = s; }
  return best;
}
export function scoreKey(s) { let k = 0; for (let i = 0; i < 6; i++) k = k * 15 + (s[i] === undefined ? 0 : s[i]); return k; }

export const HAND_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
export const handName = function (s) { return s[0] < 0 ? '—' : HAND_NAMES[s[0]]; };

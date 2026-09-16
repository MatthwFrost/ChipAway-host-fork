/* ============================================================
   EQUITY — range index, hand percentile and the Monte Carlo engine.

   Lifted out of the trainer closure unchanged so the headless harness runs the
   SAME code the app runs. Everything here is pure: board and range index are
   passed in rather than read off module state, and randomness is injectable.
   ============================================================ */

import { DECK_BY_ID, cardId, cardStr, cmpScore, evaluateBest, makeDeck, scoreKey, shuffle } from './evaluator.js';
import { BLUFF_TOP } from './opponentModel.js';

export function chenScore(h) {
  const a = h[0].rank >= h[1].rank ? h[0] : h[1];
  const b = h[0].rank >= h[1].rank ? h[1] : h[0];
  const val = function (r) { return r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2; };
  let s;
  if (a.rank === b.rank) { s = Math.max(5, val(a.rank) * 2) + 2; }   // pairs get set-mining credit
  else {
    s = val(a.rank);
    if (a.suit === b.suit) s += 2;
    const gap = a.rank - b.rank - 1;
    if (gap === 1) s -= 1; else if (gap === 2) s -= 2; else if (gap === 3) s -= 4; else if (gap >= 4) s -= 5;
    if (gap <= 1 && a.rank < 12) s += 1;
  }
  return Math.round(s * 100);
}

// Every hole-card combination that is still possible, sorted worst to best.
// Quantiles into this list are what "the top 15% of hands" means everywhere.
export function buildRangeIndex(board) {
  const used = {};
  for (let i = 0; i < board.length; i++) used[cardStr(board[i])] = 1;
  const avail = makeDeck().filter(function (c) { return !used[cardStr(c)]; });
  const list = [];
  for (let i = 0; i < avail.length; i++) {
    for (let j = i + 1; j < avail.length; j++) {
      const h = [avail[i], avail[j]];
      list.push({ h: h, s: board.length ? scoreKey(evaluateBest(h.concat(board))) : chenScore(h) });
    }
  }
  list.sort(function (x, y) { return x.s - y.s; });
  return list;
}

export function handPercentile(hole, board, rangeIndex) {
  const s = board.length ? scoreKey(evaluateBest(hole.concat(board))) : chenScore(hole);
  let lo = 0, hi = rangeIndex.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rangeIndex[mid].s < s) lo = mid + 1; else hi = mid; }
  return rangeIndex.length ? lo / rangeIndex.length : 0.5;
}

// Returns {h, source}. source:'range' = drawn from the player's true implied
// range; 'wide' = the narrow range was blocked out and we fell back to the
// whole index — "equity vs their range" degraded toward "equity vs random"
// for this trial. calcEquity aggregates this into degradedShare.
export function sampleFromRange(pl, blocked, rangeIndex, rng) {
  const N = rangeIndex.length;
  if (!N) return null;
  const useBluff = rng() < (pl.rBluff || 0);
  const lo = useBluff ? 0 : (pl.rLo || 0);
  const hi = useBluff ? BLUFF_TOP : 1;
  const a = Math.floor(lo * N), b = Math.max(a + 1, Math.floor(hi * N));
  for (let t = 0; t < 26; t++) {
    const e = rangeIndex[a + Math.floor(rng() * (b - a))];
    if (e && !blocked[cardStr(e.h[0])] && !blocked[cardStr(e.h[1])]) return { h: e.h, source: 'range' };
  }
  for (let t = 0; t < 40; t++) {
    const e = rangeIndex[Math.floor(rng() * N)];
    if (e && !blocked[cardStr(e.h[0])] && !blocked[cardStr(e.h[1])]) return { h: e.h, source: 'wide' };
  }
  return null;
}

export function calcEquity(hole, board, opponents, trials, useRanges, rangeIndex, rng) {
  const rand = rng || Math.random;
  const nOpp = opponents.length;
  if (nOpp <= 0) return { win: 100, tie: 0, lose: 0, equity: 100, se: 0, ok: true, degradedShare: 0 };

  // Dealt cards are tracked in a 52-byte typed array rather than a string-keyed
  // object, and each trial draws only the cards it needs by partial
  // Fisher-Yates instead of filtering and shuffling a fresh 45-card deck. Same
  // distribution — a uniform sample without replacement either way — at a small
  // fraction of the allocation.
  const baseBlocked = new Uint8Array(52);
  for (let i = 0; i < hole.length; i++) baseBlocked[cardId(hole[i])] = 1;
  for (let i = 0; i < board.length; i++) baseBlocked[cardId(board[i])] = 1;

  const avail = [];
  for (let id = 0; id < 52; id++) if (!baseBlocked[id]) avail.push(id);
  const boardNeeded = 5 - board.length;
  const pool = new Int32Array(avail.length);
  const blocked = new Uint8Array(52);
  // sampleFromRange still works in card objects and a string map, so a small
  // adapter keeps it unchanged rather than rewriting the range sampler too.
  const strBlocked = {};

  let win = 0, tie = 0, done = 0, equitySum = 0, degraded = 0;
  const full = board.slice();
  for (let t = 0; t < trials; t++) {
    blocked.set(baseBlocked);
    for (const k in strBlocked) delete strBlocked[k];
    for (let i = 0; i < hole.length; i++) strBlocked[cardStr(hole[i])] = 1;
    for (let i = 0; i < board.length; i++) strBlocked[cardStr(board[i])] = 1;

    for (let i = 0; i < avail.length; i++) pool[i] = avail[i];
    let end = avail.length;
    const draw = function () {
      while (end > 0) {
        const j = (rand() * end) | 0;
        const id = pool[j];
        pool[j] = pool[end - 1]; pool[end - 1] = id; end--;
        if (!blocked[id]) return id;
      }
      return -1;
    };

    const oppHands = []; let ok = true, anyDegraded = false;
    for (let o = 0; o < nOpp; o++) {
      let h = null;
      if (useRanges) {
        const sampled = sampleFromRange(opponents[o], strBlocked, rangeIndex, rand);
        if (sampled) { h = sampled.h; if (sampled.source === 'wide') anyDegraded = true; }
      }
      if (!h) {
        const a = draw(), b = draw();
        if (a < 0 || b < 0) { ok = false; break; }
        h = [DECK_BY_ID[a], DECK_BY_ID[b]];
        anyDegraded = true;
      }
      blocked[cardId(h[0])] = 1; blocked[cardId(h[1])] = 1;
      strBlocked[cardStr(h[0])] = 1; strBlocked[cardStr(h[1])] = 1;
      oppHands.push(h);
    }
    if (!ok) continue;

    full.length = board.length;
    let short = false;
    for (let i = 0; i < boardNeeded; i++) {
      const id = draw();
      if (id < 0) { short = true; break; }
      full.push(DECK_BY_ID[id]);
    }
    if (short) continue;

    const mine = evaluateBest(hole.concat(full));
    // Track how many opponents share the best OPPONENT score, so a multiway
    // tie can be split 1/k instead of always priced as half a win.
    let bo = null, tiedOpps = 0;
    for (let o = 0; o < oppHands.length; o++) {
      const s = evaluateBest(oppHands[o].concat(full));
      const cmp = bo === null ? 1 : cmpScore(s, bo);
      if (cmp > 0) { bo = s; tiedOpps = 1; }
      else if (cmp === 0) tiedOpps++;
    }
    const c = cmpScore(mine, bo);
    if (c > 0) { win++; equitySum += 1; }
    else if (c === 0) { tie++; equitySum += 1 / (tiedOpps + 1); }
    if (anyDegraded) degraded++;
    done++;
  }

  // A genuine 0% equity and "no trial could complete" must never be the same
  // number — the latter used to silently become the former and then flow into
  // EV and bot decisions as if hero were drawing dead.
  if (!done) return { win: 0, tie: 0, lose: 0, equity: null, se: null, ok: false, degradedShare: 1, reason: 'no-completed-trials' };
  const eqFrac = equitySum / done;
  return {
    win: 100 * win / done, tie: 100 * tie / done, lose: 100 * (done - win - tie) / done,
    equity: 100 * eqFrac,
    se: Math.sqrt(Math.max(0, eqFrac * (1 - eqFrac)) / done),
    ok: true,
    degradedShare: degraded / done,
  };
}

// How many of their combos your own cards remove.
export function blockerPct(hole, pl, rangeIndex) {
  const N = rangeIndex.length;
  if (!N) return 0;
  const a = Math.floor((pl.rLo || 0) * N);
  const held = {};
  for (let i = 0; i < hole.length; i++) held[cardStr(hole[i])] = 1;
  let tot = 0, blk = 0;
  for (let i = a; i < N; i++) {
    tot++;
    if (held[cardStr(rangeIndex[i].h[0])] || held[cardStr(rangeIndex[i].h[1])]) blk++;
  }
  return tot ? 100 * blk / tot : 0;
}

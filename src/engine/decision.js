/* ============================================================
   DECISION — pricing hero's options, and picking one.

   This is the coach's arithmetic: what each action is worth, and which one
   wins. Lifted out of the trainer closure so the 10,000-hand advice backtest
   drives the SAME recommendation the app shows. A backtest of a re-implemented
   coach would prove nothing about the coach that ships.

   Everything takes a `view` — a read-only description of the table:

     {players, heroIndex, board, street, pot, currentBet, minRaise,
      dealerIdx, bigBlind, streetRaises, rangeIndex, rng,
      calledTrials, equityTrials}

   `players` are the live player objects (stack, bet, folded, rLo, rBluff,
   profile, isHero). Nothing here mutates any of them.
   ============================================================ */

import { calcEquity } from './equity.js';
import { POS_MULT } from './botPolicy.js';
import { analyzeHandShape } from './handShape.js';
import { NEXT_STREET_BET, barrelValue, callFutureValue, streetsLeft } from './future.js';
import {
  continueThreshold, evBetSe, evCallSe, evOfBet, evOfCall, jointResponse,
  profileOf, responseTo, HERO_PROF,
} from './opponentModel.js';

const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

export function profOf(p) { return p.isHero ? HERO_PROF : profileOf(p.profile); }

export function posOf(view, i) {
  return (i - view.dealerIdx + view.players.length) % view.players.length;
}

export function modelCtx(view) {
  return {
    preflop: view.street === 0,
    bigBlind: view.bigBlind,
    currentBet: view.currentBet,
    heroState: view.players[view.heroIndex],
  };
}

// The same context, plus where THIS opponent is sitting and how big the field
// is. Preflop those two dominate how wide a player continues, and a model
// without them predicts one number for the button and the under-the-gun seat.
export function modelCtxFor(view, o) {
  const cx = modelCtx(view);
  const idx = view.players.indexOf(o);
  if (idx >= 0) cx.posMult = POS_MULT[posOf(view, idx)] || 1;
  cx.liveOpp = view.players.filter(function (p) { return !p.folded && p !== o; }).length;
  return cx;
}

export function respond(view, o, betSize, potSize) {
  return responseTo(o, profOf(o), betSize, potSize, modelCtxFor(view, o));
}

export function foldChance(view, o, betSize, potSize) {
  return respond(view, o, betSize, potSize).fold;
}

export function potBefore(view) {
  return view.pot + view.players.reduce(function (s, p) { return s + p.bet; }, 0);
}

function liveOpps(view) {
  return view.players.filter(function (p, i) { return !p.folded && i !== view.heroIndex; });
}

// postflop action order: SB, BB, UTG, MP, CO, BTN. The button (posOf 0) acts LAST.
export function heroActsLast(view) {
  const rank = function (i) { const q = posOf(view, i); return q === 0 ? 6 : q; };
  const myRank = rank(view.heroIndex);
  let last = true;
  view.players.forEach(function (p, i) {
    if (!p.folded && i !== view.heroIndex && rank(i) > myRank) last = false;
  });
  return last;
}

// Acting last is worth real money: you see their action before deciding on
// every later street. A single-street equity number cannot express that, so we
// credit it explicitly. ~3.5 points in position, less as the field grows.
export function positionalCredit(view) {
  const live = liveOpps(view);
  if (!live.length) return 0;
  const streetsLeft = Math.max(0, 3 - view.street);
  if (!streetsLeft) return 0;
  const base = heroActsLast(view) ? 0.035 : -0.015;
  return base * (streetsLeft / 3) / Math.max(1, live.length * 0.55);
}

// Measure against opponents who actually have chips in beyond the blinds.
// Counting players still to act as if they were all calling understates equity
// badly.
export function contestingOpps(view) {
  const live = liveOpps(view);
  if (!live.length) return live;
  if (view.currentBet <= 0) return live;
  const inFor = live.filter(function (p) { return p.bet >= view.currentBet - 0.01 || p.allIn; });
  const toAct = live.filter(function (p) { return inFor.indexOf(p) < 0; });
  // Players yet to act will mostly fold, but not all of them. Estimate how many
  // actually continue, and measure equity against that many. Equity and fold
  // probability must be computed over the SAME opponents or the two disagree.
  let expected = 0;
  const P = potBefore(view);
  const ref = Math.max(view.bigBlind, view.currentBet);
  toAct.forEach(function (o) { expected += (1 - foldChance(view, o, ref, P)); });
  const extra = toAct.slice(0, Math.max(0, Math.round(expected)));
  const set = inFor.concat(extra);
  return set.length ? set : live.slice(0, 1);
}

// The prose and the maths must count the same people.
export function fieldBreakdown(view) {
  const live = liveOpps(view);
  let expectedFolds = 0;
  if (view.currentBet > 0) {
    const inFor = live.filter(function (p) { return p.bet >= view.currentBet - 0.01 || p.allIn; });
    const P = potBefore(view);
    const ref = Math.max(view.bigBlind, view.currentBet);
    live.forEach(function (o) {
      if (inFor.indexOf(o) < 0) expectedFolds += foldChance(view, o, ref, P);
    });
  }
  return { live: live.length, contesting: contestingOpps(view).length, expectedFolds: expectedFolds };
}

export function heroEquityNow(view) {
  const hero = view.players[view.heroIndex];
  const opps = contestingOpps(view);
  if (!opps.length) return { e: 1, se: 0, degraded: false };
  const eq = calcEquity(hero.hole, view.board, opps, view.equityTrials || 520, true, view.rangeIndex, view.rng);
  // No completed trial is not the same fact as 0% equity. Fall back to a
  // neutral fair-share estimate with no uncertainty claim rather than letting a
  // fabricated 0 flow into EV.
  if (!eq.ok) return { e: 1 / (opps.length + 1), se: null, degraded: true };
  return {
    e: clamp(eq.equity / 100 + positionalCredit(view), 0, 1),
    se: eq.se,
    degraded: (eq.degradedShare || 0) > 0.02,
  };
}

// Equity against the hands that would actually call a bet of this size. A
// caller holds the top of their range, and almost never pure air, so this is
// lower than unconditional equity — and it falls further the bigger the bet.
export function equityIfCalled(view, hole, opps, betSize, potSize, trials) {
  const cx = modelCtx(view);
  const tightened = opps.map(function (o) {
    return {
      rLo: Math.max(o.rLo || 0, continueThreshold(o, profOf(o), betSize, potSize, cx)),
      rBluff: (o.rBluff || 0) * 0.30,
    };
  });
  return calcEquity(hole, view.board, tightened, trials, true, view.rangeIndex, view.rng);
}

// Rank the available actions honestly. Two rules beyond raw EV order:
//  a) options whose error bars overlap the leader's are indistinguishable;
//     among those, the one risking fewest chips is recommended.
//  b) fold is never recommended when checking is legal — checking weakly
//     dominates folding (you can always fold later for free).
export function rankOptions(opts) {
  if (!opts || !opts.length) return { ranked: [], recommended: null, band: [] };
  const ranked = opts.slice().sort(function (a, b) {
    const d = b.ev - a.ev;
    if (Math.abs(d) > 1e-9) return d;
    return (a.amount || 0) - (b.amount || 0);
  });
  const leader = ranked[0];
  const lse = leader.evSe || 0;
  const band = ranked.filter(function (o) {
    if (o === leader) return true;
    const ose = o.evSe || 0;
    const combined = Math.sqrt(lse * lse + ose * ose);
    return (leader.ev - o.ev) <= combined + 1e-9;
  });
  let recommended = leader;
  if (band.length > 1) {
    recommended = band.slice().sort(function (a, b) { return (a.amount || 0) - (b.amount || 0); })[0];
  }
  if (recommended.label === 'fold') {
    const check = ranked.filter(function (o) { return o.label === 'check'; })[0];
    if (check) recommended = check;
  }
  return { ranked: ranked, recommended: recommended, band: band };
}

const SIZES = [[0.33, '⅓ pot'], [0.5, '½ pot'], [0.75, '¾ pot'], [1, 'pot'], [1.5, '1.5× pot']];

// The range that would still be there on the next street, having called a bet
// of B now: the bottom is lifted to whatever it took to continue, and almost
// none of the air survives.
function rangeAfterCalling(view, o, B, P) {
  const cx = modelCtx(view);
  return {
    rLo: Math.max(o.rLo || 0, continueThreshold(o, profOf(o), B, P, cx)),
    rBluff: (o.rBluff || 0) * 0.30,
    profile: o.profile, isHero: o.isHero,
  };
}

// How the field that called a bet of B would answer a standard bet on the next
// street. Both numbers come from the same calibrated model the rest of the
// advice uses — no new constants, no second simulation.
function nextStreetResponse(view, ref, B, P) {
  const nextPot = P + 2 * B;
  const nextBet = NEXT_STREET_BET * nextPot;
  const next = { street: view.street + 1, players: view.players, heroIndex: view.heroIndex,
    board: view.board, pot: nextPot, currentBet: 0, minRaise: view.minRaise,
    dealerIdx: view.dealerIdx, bigBlind: view.bigBlind, rangeIndex: view.rangeIndex, rng: view.rng };
  const reads = ref.map(function (o) {
    return respond(next, rangeAfterCalling(view, o, B, P), nextBet, nextPot);
  });
  return jointResponse(reads);
}

export function snapshotSpot(view) {
  const h = view.players[view.heroIndex];
  // Hero's hand shape drives whether calling has implied odds or reverse
  // implied odds. Computed here so the app and the harness price it the same.
  const shape = (view.board.length >= 3 && h.hole && h.hole.length === 2)
    ? analyzeHandShape(h.hole, view.board) : null;
  const actsLast = heroActsLast(view);
  const BB = view.bigBlind;
  const P = potBefore(view);
  const C = Math.min(view.currentBet - h.bet, h.stack);
  const ref = contestingOpps(view);
  const eq = heroEquityNow(view);
  const e = eq.e;
  const opts = [];
  opts.push({ label: 'fold', ev: 0, amount: 0, evSe: 0 });
  if (C > 0) {
    // Calling does not end the hand. A draw gets paid again when it hits; a
    // bluff-catcher keeps paying to find out it is beaten.
    const after = ref.length ? nextStreetResponse(view, ref, C, P) : { call: 0, fold: 0 };
    const future = callFutureValue({
      shape: shape, e: e, pot: P, toCall: C, street: view.street,
      board: view.board, oppCall: after.call, actsLast: actsLast,
    });
    opts.push({
      label: 'call ' + C, ev: evOfCall(e, P, C) + future, amount: C,
      evSe: evCallSe(P, C, eq.se), future: future,
    });
  } else opts.push({ label: 'check', ev: 0, amount: 0, evSe: 0 });

  // Build the candidate sizes first, so conditional equity can be anchored at
  // the smallest and largest of them and interpolated in between — two Monte
  // Carlo runs instead of one per size.
  const sizes = [];
  SIZES.forEach(function (sz) {
    // A raise must reach at least currentBet + minRaise. Size the pot fraction
    // off the pot AFTER calling, which is how raise sizing actually works.
    let target;
    if (C > 0) target = Math.round(view.currentBet + sz[0] * (P + C));
    else target = Math.round(P * sz[0]);
    target = Math.max(target, view.currentBet + view.minRaise);
    target = Math.min(target, h.bet + h.stack);
    const B = target - h.bet;                       // chips hero actually adds
    if (B < BB || B > h.stack) return;
    if (opts.some(function (o) { return o.amount === B; })) return;
    if (sizes.some(function (x) { return x.B === B; })) return;
    sizes.push({ B: B, target: target, label: sz[1] });
  });

  if (sizes.length && ref.length) {
    const cx = modelCtx(view);
    const meanT = function (B) {
      let t = 0;
      ref.forEach(function (o) { t += continueThreshold(o, profOf(o), B, P, cx); });
      return t / ref.length;
    };
    const trials = view.calledTrials || 380;
    const lo = sizes[0], hi = sizes[sizes.length - 1];
    const eqLo = equityIfCalled(view, h.hole, ref, lo.B, P, trials);
    const eqHi = (sizes.length > 1) ? equityIfCalled(view, h.hole, ref, hi.B, P, trials) : eqLo;
    const tLo = meanT(lo.B), tHi = meanT(hi.B), tSpan = tHi - tLo;
    sizes.forEach(function (sz) {
      const resp = jointResponse(ref.map(function (o) { return respond(view, o, sz.B, P); }));
      // equity conditional on being called, interpolated by how much this size
      // narrows their continuing range
      let eCalled;
      if (!eqLo.ok || !eqHi.ok) eCalled = e;
      else {
        const w = (Math.abs(tSpan) < 1e-6) ? 0 : clamp((meanT(sz.B) - tLo) / tSpan, 0, 1);
        eCalled = clamp((eqLo.equity + (eqHi.equity - eqLo.equity) * w) / 100, 0, 1);
      }
      const allIn = (sz.B >= h.stack);
      // Being called is not the end of it: hero reaches the next street with
      // the initiative and another chance to fold them out.
      const after = nextStreetResponse(view, ref, sz.B, P);
      const barrel = allIn ? 0 : barrelValue({
        pot: P, bet: sz.B, street: view.street, nextFold: after.fold, actsLast: actsLast,
      });
      opts.push({
        label: allIn ? ('all in ' + sz.target) : ((C > 0 ? 'raise to ' : 'bet ') + sz.target + ' (' + sz.label + ')'),
        ev: evOfBet(eCalled, P, sz.B, resp) + resp.call * barrel, amount: sz.B, target: sz.target,
        fold: resp.fold, raise: resp.raise, n: ref.length, barrel: barrel,
        eCalled: eCalled, evSe: evBetSe(P, sz.B, resp, eqLo.ok ? eqLo.se : eq.se, eCalled),
      });
    });
  }
  const best = rankOptions(opts).recommended;
  return {
    street: view.street, equity: e, equitySe: eq.se, degraded: eq.degraded,
    pot: P, toCall: C, options: opts, best: best, shape: shape,
    streetsLeft: streetsLeft(view.street),
  };
}

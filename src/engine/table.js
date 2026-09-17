/* ============================================================
   TABLE — a headless, seeded, synchronous game of no-limit hold'em.

   The app's own loop is animation-driven (setTimeout, rendering, hero waiting
   on a click), so it cannot be run ten thousand times in a test. This is the
   same loop with the waiting taken out: same blinds, same action order, same
   raise legality, same street progression, same side pots.

   What matters is that it does NOT re-implement any decision. Bots act through
   botPolicy.js and hero (optionally) through decision.js — the exact modules
   the app uses. Only the plumbing is duplicated, and the plumbing is tested
   directly in table.test.js.
   ============================================================ */

import { cardStr, cmpScore, evaluateBest, makeDeck, shuffle } from './evaluator.js';
import { buildRangeIndex, calcEquity, handPercentile } from './equity.js';
import { POS_MULT, decidePostflop, decidePreflop } from './botPolicy.js';
import { afterAggro, afterCall, afterCheck, PROFILES, PROFILE_KEYS } from './opponentModel.js';
import * as D from './decision.js';
import { makeRng } from './rng.js';

export const SB = 10, BB = 20, START_STACK = 1000;
export const BOT_TRIALS = 170, HERO_EQUITY_TRIALS = 520, CALLED_TRIALS = 380;
export const STREETS = ['Preflop', 'Flop', 'Turn', 'River', 'Showdown'];

function makePlayer(i, profile, isHero) {
  return {
    id: i, name: isHero ? 'You' : 'Seat' + i, profile: profile, isHero: !!isHero,
    stack: START_STACK, hole: [], folded: false, allIn: false,
    bet: 0, committed: 0, acted: false, mayRaise: true, raises: 0,
    rLo: 0, rBluff: 0, score: null,
  };
}

/* ---- side pots and awards: the app's logic, unchanged ---- */

export function buildSidePots(players) {
  const contribs = players.filter(function (p) { return p.committed > 0; }).map(function (p) { return { p: p, c: p.committed }; });
  const live = players.filter(function (p) { return !p.folded; });
  // No pot layer can sit above the biggest commitment anyone still in the hand
  // has made. Chips put in above that line by players who then folded are dead
  // money: they belong to whoever wins, not to a layer of their own with nobody
  // eligible for it. Building those layers anyway is how a short all-in against
  // two bigger folds produced "pot layer 1 has no eligible player".
  const maxLive = live.reduce(function (m, p) { return Math.max(m, p.committed); }, 0);
  const lv = contribs.map(function (x) { return x.c; })
    .filter(function (v, i, a) { return a.indexOf(v) === i; })
    .filter(function (v) { return v <= maxLive; })
    .sort(function (a, b) { return a - b; });
  const pots = []; let prev = 0, assigned = 0;
  for (let i = 0; i < lv.length; i++) {
    const lvl = lv[i]; let amt = 0;
    contribs.forEach(function (x) { amt += Math.min(x.c, lvl) - Math.min(x.c, prev); });
    const elig = players.filter(function (p) { return !p.folded && p.committed >= lvl; });
    if (amt > 0) { pots.push({ amount: amt, eligible: elig }); assigned += amt; }
    prev = lvl;
  }
  const total = contribs.reduce(function (s, x) { return s + x.c; }, 0);
  const dead = total - assigned;
  if (dead > 0) {
    if (pots.length) pots[pots.length - 1].amount += dead;
    else pots.push({ amount: dead, eligible: live });
  }
  const merged = [];
  pots.forEach(function (p) {
    const last = merged[merged.length - 1];
    if (last && last.eligible.length === p.eligible.length && last.eligible.every(function (x, i) { return x === p.eligible[i]; })) last.amount += p.amount;
    else merged.push(p);
  });
  return merged;
}

export function computeResult(players, board) {
  const pots = buildSidePots(players);
  const awards = [];
  pots.forEach(function (pt, i) {
    const elig = pt.eligible;
    if (!elig.length) throw new Error('pot layer ' + i + ' has no eligible player');
    let best = null, winners = [];
    elig.forEach(function (p) {
      const s = board.length >= 5 ? evaluateBest(p.hole.concat(board)) : [-1];
      p.score = s;
      if (best === null || cmpScore(s, best) > 0) { best = s; winners = [p]; }
      else if (cmpScore(s, best) === 0) winners.push(p);
    });
    if (elig.length === 1) { best = [-1]; winners = [elig[0]]; }
    awards.push({ index: i, amount: pt.amount, winners: winners, best: best, contested: elig.length > 1 });
  });
  return awards;
}

/* ---- the table ---- */

export function createTable(opts) {
  const o = opts || {};
  const rng = o.rng || makeRng(o.seed === undefined ? 1 : o.seed);
  const seats = o.seats || ['nit', 'tag', 'lag', 'station', 'maniac'];
  const heroPolicy = o.heroPolicy || null;   // null => hero is dealt out of decisions and folds
  const onDecision = o.onDecision || null;   // observer, called for every action taken
  // A createHandRecorder(), or null. The headless loop records through exactly
  // the same module the app does, which is the point: what the tests verify is
  // then the same recorder that runs in the browser, not a stand-in for it.
  const recorder = o.recorder || null;
  let lastRecorded = null;

  const players = [makePlayer(0, null, true)];
  seats.forEach(function (key, i) { players.push(makePlayer(i + 1, key, false)); });

  const st = {
    players: players, board: [], deck: [], pot: 0, street: 0,
    currentBet: 0, minRaise: BB, dealerIdx: 0, streetRaises: 0,
    rangeIndex: [], handNo: 0, rng: rng, lastAggressor: -1,
  };

  const posOf = function (i) { return (i - st.dealerIdx + players.length) % players.length; };
  const posMult = function (i) { return POS_MULT[posOf(i)] || 1; };
  const potBefore = function () { return st.pot + players.reduce(function (s, p) { return s + p.bet; }, 0); };
  const liveCount = function () { return players.filter(function (p) { return !p.folded; }).length; };
  const profOf = function (p) { return PROFILES[p.profile]; };

  function view() {
    return {
      players: players, heroIndex: 0, board: st.board, street: st.street, pot: st.pot,
      currentBet: st.currentBet, minRaise: st.minRaise, dealerIdx: st.dealerIdx,
      bigBlind: BB, streetRaises: st.streetRaises, rangeIndex: st.rangeIndex, rng: rng,
      calledTrials: o.calledTrials || CALLED_TRIALS,
      equityTrials: o.equityTrials || HERO_EQUITY_TRIALS,
    };
  }

  function nextActive(from) {
    for (let k = 1; k <= players.length; k++) {
      const i = (from + k) % players.length;
      if (!players[i].folded && !players[i].allIn) return i;
    }
    return -1;
  }

  function roundComplete() {
    if (liveCount() <= 1) return true;
    const canAct = players.filter(function (p) { return !p.folded && !p.allIn; });
    if (canAct.length === 0) return true;
    return canAct.every(function (p) { return p.acted && p.bet === st.currentBet; });
  }

  function postBlind(i, amt) {
    const p = players[i], put = Math.min(amt, p.stack);
    p.stack -= put; p.bet += put; p.committed += put;
    if (p.stack === 0) p.allIn = true;
    return put;
  }

  function collectBets() {
    players.forEach(function (p) { st.pot += p.bet; p.bet = 0; p.acted = false; p.mayRaise = true; p.raises = 0; });
    st.currentBet = 0; st.minRaise = BB; st.streetRaises = 0;
  }

  // Exactly the app's applyBotRaise, minus badges and logging.
  function applyRaise(p, target) {
    const pb = potBefore();
    target = Math.max(target, st.currentBet + st.minRaise);
    target = Math.min(target, p.bet + p.stack);
    const put = target - p.bet;
    p.stack -= put; p.bet = target; p.committed += put;
    if (p.stack === 0) p.allIn = true;
    const rs = p.bet - st.currentBet;
    const isFullRaise = rs >= st.minRaise;
    if (isFullRaise) st.minRaise = rs;
    st.currentBet = Math.max(st.currentBet, p.bet);
    p.acted = true; p.mayRaise = false; p.raises++; st.streetRaises++;
    st.lastAggressor = players.indexOf(p);
    const next = afterAggro(p, p.isHero ? D.profOf(p) : profOf(p), put / Math.max(1, pb));
    p.rLo = next.rLo; p.rBluff = next.rBluff;
    players.forEach(function (x) {
      if (x !== p && !x.folded && !x.allIn) { x.acted = false; if (isFullRaise) x.mayRaise = true; }
    });
  }

  function applyCall(p, toCall) {
    p.stack -= toCall; p.bet += toCall; p.committed += toCall; p.acted = true;
    if (p.stack === 0) p.allIn = true;
    const next = afterCall(p, p.isHero ? D.profOf(p) : profOf(p));
    p.rLo = next.rLo; p.rBluff = next.rBluff;
  }

  function applyCheck(p) {
    p.acted = true;
    const next = afterCheck(p);
    p.rLo = next.rLo; p.rBluff = next.rBluff;
  }

  function applyFold(p) { p.folded = true; p.acted = true; }

  // Apply a {action, target} from any policy, and tell the observer about it.
  function apply(p, d, ctxInfo) {
    const toCall = Math.min(st.currentBet - p.bet, p.stack);
    // Captured before the action moves any money, so the recorder can store
    // the increment paid (`put`) alongside the resulting street total (`to`).
    const stackBefore = p.stack, potBeforeAct = potBefore();
    if (onDecision) {
      onDecision({
        player: p, street: st.street, streetName: STREETS[Math.min(st.street, 4)],
        action: d.action, target: d.target, toCall: toCall, pot: potBefore(),
        currentBet: st.currentBet, aggressor: st.lastAggressor >= 0 ? players[st.lastAggressor] : null,
        posMult: posMult(players.indexOf(p)),
        liveOpp: players.filter(function (x) { return !x.folded && x !== p; }).length,
        info: ctxInfo || null, handNo: st.handNo,
      });
    }
    if (d.action === 'raise' || d.action === 'bet') applyRaise(p, d.target);
    else if (d.action === 'call') applyCall(p, toCall);
    else if (d.action === 'check') applyCheck(p);
    else applyFold(p);
    if (recorder) {
      recorder.action({
        seat: p.id, street: st.street, action: d.action,
        put: stackBefore - p.stack, to: p.bet,
        potBefore: potBeforeAct, toCall: toCall, allIn: p.allIn,
      });
    }
  }

  function botAct(p) {
    const idx = players.indexOf(p);
    const toCall = Math.min(st.currentBet - p.bet, p.stack);
    const prof = profOf(p);
    if (st.street === 0) {
      const d = decidePreflop({
        prof: prof, pct: handPercentile(p.hole, st.board, st.rangeIndex),
        liveOpp: players.filter(function (x) { return !x.folded && x !== p; }).length,
        posMult: posMult(idx), pos: posOf(idx), toCall: toCall,
        currentBet: st.currentBet, minRaise: st.minRaise, bigBlind: BB,
        streetRaises: st.streetRaises, raises: p.raises, mayRaise: p.mayRaise, rng: rng,
      });
      return apply(p, d);
    }
    const contesting = players.filter(function (x) { return !x.folded && x !== p && (x.bet > 0 || x.allIn); });
    const liveOpp = players.filter(function (x) { return !x.folded && x !== p; });
    const refOpp = (toCall > 0 && contesting.length) ? contesting : liveOpp;
    const eq = calcEquity(p.hole, st.board, refOpp, o.botTrials || BOT_TRIALS, true, st.rangeIndex, rng);
    if (!eq.ok) return apply(p, { action: toCall > 0 ? 'fold' : 'check' });
    const d = decidePostflop({
      prof: prof, strength: eq.equity / 100, nRef: refOpp.length,
      toCall: toCall, potNow: potBefore(), currentBet: st.currentBet, bigBlind: BB,
      canRaise: p.raises < prof.maxRaises && st.streetRaises < 4 && p.mayRaise, rng: rng,
    });
    return apply(p, d, { strength: eq.equity / 100, nRef: refOpp.length });
  }

  function heroAct(p) {
    const toCall = Math.min(st.currentBet - p.bet, p.stack);
    if (!heroPolicy) return apply(p, { action: toCall > 0 ? 'fold' : 'check' });
    const v = view();
    const spot = D.snapshotSpot(v);
    const d = heroPolicy({ spot: spot, view: v, player: p, toCall: toCall, rng: rng, potBefore: potBefore() });
    return apply(p, d, { spot: spot });
  }

  function startHand() {
    st.handNo++;
    // Cards are dealt from their own per-hand generator when a dealSeed is
    // given. Without this, two hero policies diverge after their first
    // different decision and never see the same board again — which makes a
    // "paired" comparison of them no better than two unrelated runs, and is
    // exactly why the first backtest could not measure anything.
    const dealRng = (o.dealSeed === undefined) ? rng : makeRng(o.dealSeed + st.handNo * 2654435761);
    st.deck = shuffle(makeDeck(), dealRng);
    st.board = []; st.pot = 0; st.street = 0; st.currentBet = 0; st.minRaise = BB;
    st.streetRaises = 0; st.lastAggressor = -1;
    players.forEach(function (p) {
      p.hole = []; p.folded = false; p.allIn = false; p.bet = 0; p.committed = 0;
      p.acted = false; p.mayRaise = true; p.raises = 0; p.rLo = 0; p.rBluff = 0; p.score = null;
    });
    st.dealerIdx = (st.dealerIdx + 1) % players.length;
    st.rangeIndex = buildRangeIndex(st.board);
    let di = 0;
    for (let r = 0; r < 2; r++) players.forEach(function (p) { p.hole.push(st.deck[di++]); });
    st.deck = st.deck.slice(di);
    // Opened after the deal and before the blinds, so the recorded stacks are
    // the ones everyone sat down with this hand.
    if (recorder) {
      recorder.begin({
        handNo: st.handNo, players: players, dealerIdx: st.dealerIdx, heroIndex: 0,
        sb: SB, bb: BB, startStack: START_STACK,
      });
    }
    const sbIdx = (st.dealerIdx + 1) % players.length, bbIdx = (st.dealerIdx + 2) % players.length;
    const sbPut = postBlind(sbIdx, SB), bbPut = postBlind(bbIdx, BB);
    if (recorder) { recorder.blind(players[sbIdx].id, sbPut); recorder.blind(players[bbIdx].id, bbPut); }
    st.currentBet = BB;
    return nextActive(bbIdx);
  }

  function advanceStreet() {
    collectBets();
    st.street++;
    if (st.street >= 4 || liveCount() === 1) return false;
    if (st.street === 1) st.board.push(st.deck.pop(), st.deck.pop(), st.deck.pop());
    else st.board.push(st.deck.pop());
    st.rangeIndex = buildRangeIndex(st.board);
    players.forEach(function (p) { p.rLo *= 0.88; p.rBluff *= 0.80; });
    // Emitted after the range decay, so the snapshot is what everyone is
    // repping going INTO the new street rather than leaving the old one.
    if (recorder) recorder.street(st.street, st.board, players);
    return true;
  }

  // Play one hand to completion. Returns a summary including every player's
  // net chips for the hand.
  function playHand() {
    // Every hand is an independent sample at a fixed stack depth, which is how
    // a win rate is measured: reset everyone to the starting stack first.
    //
    // Without this, a winning policy's stack compounds while busted opponents
    // are topped back up to 1,000, so hero ends up hundreds of big blinds deep
    // against 50bb stacks and a single hand can swing an unbounded amount. The
    // first 10,000-hand backtest reported a standard deviation of 611bb per
    // hand on a table that only ever holds 300bb — which is what gave it away.
    //
    // Pass resetStacks:false to watch stacks actually move over a session.
    let toppedUp = 0;
    if (o.resetStacks === false) {
      players.forEach(function (p) {
        if (p.stack <= 0) { toppedUp += START_STACK - p.stack; p.stack = START_STACK; }
      });
    } else {
      players.forEach(function (p) { toppedUp += START_STACK - p.stack; p.stack = START_STACK; });
    }
    const before = players.map(function (p) { return p.stack; });
    let actingIdx = startHand();
    let guard = 0;
    for (; ;) {
      if (++guard > 5000) throw new Error('hand did not terminate');
      if (liveCount() === 1) break;
      if (roundComplete()) {
        if (!advanceStreet()) break;
        actingIdx = nextActive(st.dealerIdx);
        const canAct = players.filter(function (p) { return !p.folded && !p.allIn; });
        if (canAct.length <= 1) continue;
        continue;
      }
      const p = players[actingIdx];
      if (!p || p.folded || p.allIn) { actingIdx = nextActive(actingIdx); continue; }
      if (p.isHero) heroAct(p); else botAct(p);
      actingIdx = nextActive(actingIdx);
    }
    collectBets();
    if (recorder) recorder.collect();
    // Any street still to come is dealt out so an all-in resolves properly.
    // Recorded as real street events: to anyone replaying, a runout after an
    // all-in looks exactly like a street that nobody could bet on, which is
    // what it is.
    while (st.board.length < 5 && liveCount() > 1) {
      st.board.push(st.deck.pop());
      // Only on a complete street. Dealing a runout one card at a time is an
      // implementation detail; a replay showing a two-card flop is not a hand
      // that ever existed.
      if (recorder && st.board.length >= 3) recorder.street(st.board.length - 2, st.board, players);
    }
    const showdown = liveCount() > 1;
    if (recorder && showdown) {
      recorder.showdown(players.filter(function (p) { return !p.folded; }).map(function (p) {
        return { seat: p.id, hole: p.hole, handName: '' };
      }));
    }
    const awards = computeResult(players, st.board);
    awards.forEach(function (a) {
      const share = Math.floor(a.amount / a.winners.length);
      const rem = a.amount - share * a.winners.length;
      a.winners.forEach(function (w, i) {
        const got = share + (i === 0 ? rem : 0);
        w.stack += got;
        if (recorder) recorder.award(w.id, got);
      });
    });
    st.pot = 0;
    if (recorder) {
      lastRecorded = recorder.finish({
        net: players[0].stack - before[0],
        potFinal: awards.reduce(function (s, a) { return s + a.amount; }, 0),
        showdown: showdown,
        heroFolded: players[0].folded,
        winners: awards.length ? awards[0].winners.map(function (w) { return w.id; }) : [],
      });
    }
    return {
      handNo: st.handNo,
      net: players.map(function (p, i) { return p.stack - before[i]; }),
      toppedUp: toppedUp,
      board: st.board.slice(),
      showdown: liveCount() > 1,
    };
  }

  return {
    state: st, players: players, playHand: playHand, view: view,
    potBefore: potBefore, posOf: posOf, liveCount: liveCount,
    // The hand the last playHand() recorded, or null when no recorder is
    // attached. Lets a test play a hand and immediately replay it.
    lastHand: function () { return lastRecorded; },
  };
}

/* ---- hero policies ---- */

// Follow the coach: take whatever snapshotSpot ranks best. This is the exact
// object the app puts on screen as the recommendation.
export const coachPolicy = function (c) { return toAction(c.spot.best, c); };

export const alwaysCallPolicy = function (c) {
  return { action: c.toCall > 0 ? 'call' : 'check' };
};

export const alwaysFoldPolicy = function (c) {
  return { action: c.toCall > 0 ? 'fold' : 'check' };
};

// The worst realistic habit: call everything, raise nothing.
export const stationPolicy = alwaysCallPolicy;

// Pick uniformly among the options the coach priced, ignoring their EV.
export const randomPolicy = function (c) {
  const opts = c.spot.options;
  return toAction(opts[Math.floor(c.rng() * opts.length)], c);
};

// Competent baselines: play hero as one of the bot profiles, using the very
// same decision functions the seats use. These are the bar the coach has to
// clear — beating always-call proves little, beating a TAG or LAG bot is the
// question that matters.
export function profileBotPolicy(profileKey) {
  const prof = PROFILES[profileKey];
  return function (c) {
    const p = c.player;
    const v = c.view;
    const toCall = c.toCall;
    if (v.street === 0) {
      const idx = v.players.indexOf(p);
      const pos = (idx - v.dealerIdx + v.players.length) % v.players.length;
      return decidePreflop({
        prof: prof, pct: handPercentile(p.hole, v.board, v.rangeIndex),
        liveOpp: v.players.filter(function (x) { return !x.folded && x !== p; }).length,
        posMult: POS_MULT[pos] || 1, pos: pos,
        toCall: toCall, currentBet: v.currentBet, minRaise: v.minRaise, bigBlind: v.bigBlind,
        streetRaises: v.streetRaises || 0, raises: p.raises, mayRaise: p.mayRaise, rng: c.rng,
      });
    }
    const contesting = v.players.filter(function (x) { return !x.folded && x !== p && (x.bet > 0 || x.allIn); });
    const liveOpp = v.players.filter(function (x) { return !x.folded && x !== p; });
    const refOpp = (toCall > 0 && contesting.length) ? contesting : liveOpp;
    const eq = calcEquity(p.hole, v.board, refOpp, BOT_TRIALS, true, v.rangeIndex, c.rng);
    if (!eq.ok) return { action: toCall > 0 ? 'fold' : 'check' };
    return decidePostflop({
      prof: prof, strength: eq.equity / 100, nRef: refOpp.length,
      toCall: toCall, potNow: c.potBefore, currentBet: v.currentBet, bigBlind: v.bigBlind,
      canRaise: p.raises < prof.maxRaises && (v.streetRaises || 0) < 4 && p.mayRaise, rng: c.rng,
    });
  };
}

export const tagBotPolicy = profileBotPolicy('tag');
export const lagBotPolicy = profileBotPolicy('lag');
export const nitBotPolicy = profileBotPolicy('nit');

// Translate a priced option back into a table action.
function toAction(opt, c) {
  if (!opt) return { action: c.toCall > 0 ? 'fold' : 'check' };
  if (opt.label === 'fold') return { action: 'fold' };
  if (opt.label === 'check') return { action: 'check' };
  if (/^call/.test(opt.label)) return { action: 'call' };
  return { action: c.toCall > 0 ? 'raise' : 'bet', target: opt.target };
}

export const POLICIES = {
  coach: coachPolicy,
  'always-call': alwaysCallPolicy,
  'always-fold': alwaysFoldPolicy,
  random: randomPolicy,
  'tag-bot': tagBotPolicy,
  'lag-bot': lagBotPolicy,
  'nit-bot': nitBotPolicy,
};

export { PROFILE_KEYS, cardStr };

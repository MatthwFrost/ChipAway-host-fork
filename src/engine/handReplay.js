/* ============================================================
   HAND REPLAY — fold a recorded event log forward into table state.

   snapshotAt(hand, n) returns the table exactly as it stood after n events,
   in the same shape the renderer reads for a live hand. That is the whole
   trick: the renderer does not know or care whether it is drawing a hand being
   played or one being re-read, so there is one set of rendering code and it
   cannot drift.

   Replay is deliberately NOT "re-run the engine from a seed". A seed would be
   smaller, but it binds the stored hand to the engine version that made it —
   change the bot policy and every hand you saved last month replays as
   something you never actually played. The log says what happened.

   Pure: no DOM, no storage, no globals.
   ============================================================ */

import { RANK_CHARS, SUITS } from './evaluator.js';

const RANK_OF = {};
RANK_CHARS.forEach(function (ch, i) { RANK_OF[ch] = i + 2; });

export function parseCard(s) {
  const suit = s[s.length - 1];
  const rank = RANK_OF[s.slice(0, -1)];
  if (rank === undefined || SUITS.indexOf(suit) < 0) return null;
  return { rank: rank, suit: suit };
}
const parseCards = function (list) { return (list || []).map(parseCard).filter(Boolean); };

// Every event is one step, so the scrubber maps 1:1 onto "things that
// happened". Step 0 is the deal, before any money moves.
export function stepCount(hand) {
  return hand && hand.events ? hand.events.length : 0;
}

function freshPlayers(hand) {
  const hole = hand.holeCards || {};
  return hand.config.seats.map(function (s) {
    return {
      id: s.id, name: s.name, profile: s.profile, isHero: !!s.isHero,
      stack: s.stack, hole: [], folded: false, allIn: false,
      bet: 0, committed: 0, badge: '', badgeCls: '',
      rLo: 0, rBluff: 0,
    };
  });
}

const bySeat = function (players, seat) {
  for (let i = 0; i < players.length; i++) if (players[i].id === seat) return players[i];
  return null;
};

function clearBadges(players) {
  players.forEach(function (p) { p.badge = ''; p.badgeCls = ''; });
}

// Betting rounds end by sweeping everyone's street bet into the pot. The live
// engine calls this collectBets(); replay has to do the same or the pot on the
// turn reads as the pot on the flop.
function collect(state) {
  state.players.forEach(function (p) { state.pot += p.bet; p.bet = 0; });
  state.currentBet = 0;
}

function applyAction(state, ev) {
  const p = bySeat(state.players, ev.seat);
  if (!p) return;
  if (ev.action === 'fold') {
    p.folded = true;
    p.badge = 'fold'; p.badgeCls = 'b-fold';
    return;
  }
  if (ev.action === 'check') {
    p.badge = 'check'; p.badgeCls = 'b-passive';
    return;
  }
  p.stack -= ev.put;
  p.bet = ev.to;
  p.committed += ev.put;
  if (ev.allIn) p.allIn = true;
  if (ev.action === 'call') {
    p.badge = 'call ' + ev.put; p.badgeCls = 'b-passive';
  } else {
    state.currentBet = Math.max(state.currentBet, ev.to);
    p.badge = (ev.allIn ? 'all in ' : (ev.action === 'bet' ? 'bets ' : 'raise to ')) + ev.to;
    p.badgeCls = 'b-aggro';
  }
}

/* The table as it stood after `n` events (n = -1 is the deal with no cards
   out). The returned object carries every field the renderer reads, so it can
   be handed straight to paint(). */
export function snapshotAt(hand, n) {
  const state = {
    players: freshPlayers(hand),
    board: [], pot: 0, street: 0, currentBet: 0,
    dealerIdx: hand.config.dealerIdx,
    heroIndex: hand.config.heroIndex,
    handNo: hand.handNo,
    actingIdx: -1, villainIdx: -1,
    revealAll: false, handLive: true,
  };

  const events = hand.events || [];
  const upto = Math.max(-1, Math.min(n, events.length - 1));

  for (let i = 0; i <= upto; i++) {
    const ev = events[i];
    if (ev.t === 'deal') {
      state.players.forEach(function (p) {
        p.hole = parseCards((hand.holeCards || {})[p.id]);
      });
    } else if (ev.t === 'blind') {
      const p = bySeat(state.players, ev.seat);
      if (p) {
        p.stack -= ev.put; p.bet += ev.put; p.committed += ev.put;
        if (p.stack === 0) p.allIn = true;
        p.badge = (ev.put === hand.config.sb ? 'SB ' : 'BB ') + ev.put;
        p.badgeCls = 'b-blind';
        state.currentBet = Math.max(state.currentBet, p.bet);
      }
    } else if (ev.t === 'action') {
      applyAction(state, ev);
    } else if (ev.t === 'street') {
      collect(state);
      clearBadges(state.players);
      state.street = ev.street;
      state.board = parseCards(ev.cards);
    } else if (ev.t === 'ranges') {
      const seats = ev.seats || {};
      state.players.forEach(function (p) {
        const r = seats[p.id];
        if (r) { p.rLo = r.rLo; p.rBluff = r.rBluff; }
      });
    } else if (ev.t === 'collect') {
      collect(state);
      state.handLive = false;
    } else if (ev.t === 'showdown') {
      state.revealAll = true;
      state.handLive = false;
    } else if (ev.t === 'award') {
      const p = bySeat(state.players, ev.seat);
      if (p) p.stack += ev.amount;
      state.revealAll = true;
      state.handLive = false;
    }
  }

  // Whoever is about to act, so the live table's "acting" ring shows during
  // replay too. Only meaningful while betting is still open.
  if (state.handLive) {
    const next = nextToAct(hand, upto);
    if (next !== null) state.actingIdx = indexOfSeat(state.players, next);
  }
  return state;
}

function indexOfSeat(players, seat) {
  for (let i = 0; i < players.length; i++) if (players[i].id === seat) return i;
  return -1;
}

// The next action event after `upto`, which is exactly who the live table
// would have been waiting on at this point in the hand.
function nextToAct(hand, upto) {
  const events = hand.events || [];
  for (let i = upto + 1; i < events.length; i++) {
    if (events[i].t === 'action') return events[i].seat;
  }
  return null;
}

/* A one-line description of step n, for the replay scrubber's caption. Reads
   as the move list row it corresponds to, so the two agree. */
export function describeStep(hand, n) {
  const events = hand.events || [];
  if (n < 0 || n >= events.length) return '';
  const ev = events[n];
  const nameOf = function (seat) {
    const s = hand.config.seats.filter(function (x) { return x.id === seat; })[0];
    return s ? s.name : 'Seat' + seat;
  };
  if (ev.t === 'deal') return 'Cards are dealt';
  if (ev.t === 'blind') return nameOf(ev.seat) + ' posts ' + ev.put;
  if (ev.t === 'action') {
    if (ev.action === 'fold') return nameOf(ev.seat) + ' folds';
    if (ev.action === 'check') return nameOf(ev.seat) + ' checks';
    if (ev.action === 'call') return nameOf(ev.seat) + ' calls ' + ev.put;
    if (ev.allIn) return nameOf(ev.seat) + ' is all in for ' + ev.to;
    return nameOf(ev.seat) + (ev.action === 'bet' ? ' bets ' : ' raises to ') + ev.to;
  }
  if (ev.t === 'street') return STREET_NAMES[ev.street] + ' — ' + (ev.cards || []).join(' ');
  if (ev.t === 'ranges') return 'Ranges update';
  if (ev.t === 'collect') return 'Betting is done';
  if (ev.t === 'showdown') return 'Showdown';
  if (ev.t === 'award') return nameOf(ev.seat) + ' wins ' + ev.amount;
  return '';
}

const STREET_NAMES = ['Preflop', 'Flop', 'Turn', 'River'];

/* Steps worth stopping on when stepping with the arrow keys. `ranges` is real
   state but nothing visibly changes, so the scrubber skips over it rather than
   making the user press the key twice for one move. */
export function isVisibleStep(hand, n) {
  const ev = (hand.events || [])[n];
  return !!ev && ev.t !== 'ranges';
}

export function visibleSteps(hand) {
  const out = [];
  for (let i = 0; i < stepCount(hand); i++) if (isVisibleStep(hand, i)) out.push(i);
  return out;
}

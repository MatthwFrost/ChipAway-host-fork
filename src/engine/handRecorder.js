/* ============================================================
   HAND RECORDER — a structured, replayable log of one hand.

   The app already funnels every action through a single place (logMove in the
   trainer, apply() in table.js), and the move list it builds is an event stream
   wearing a costume: ordered, discrete, one row per thing that happened. The
   only problem is that it is HTML, so it is thrown away with the DOM.

   This records the same stream as data. Nothing here touches the DOM, reads a
   module global or calls a renderer, which is what lets the headless table run
   it ten thousand times in a test.

   What it deliberately also keeps is the RANGE SNAPSHOT per street. A hand
   history that says "Seat3 bets 120" is a generic hand history. This app is
   built on what that bet said about their range, so a replay without rLo and
   rBluff would lose the only part worth reviewing.
   ============================================================ */

import { cardStr } from './evaluator.js';

// Bumped when the shape below changes in a way old records cannot satisfy.
// handStore drops records it cannot read rather than guessing at a migration.
export const HAND_SCHEMA_VERSION = 1;

const cards = function (list) { return (list || []).map(cardStr); };

function seatSnapshot(players) {
  return players.map(function (p) {
    return {
      id: p.id, name: p.name, profile: p.profile || null,
      stack: p.stack, isHero: !!p.isHero,
    };
  });
}

function holeSnapshot(players) {
  const out = {};
  players.forEach(function (p) { out[p.id] = cards(p.hole); });
  return out;
}

function rangeSnapshot(players) {
  const out = {};
  players.forEach(function (p) {
    if (p.folded) return;
    out[p.id] = { rLo: +(p.rLo || 0).toFixed(4), rBluff: +(p.rBluff || 0).toFixed(4) };
  });
  return out;
}

let counter = 0;
function newId(handNo) {
  counter += 1;
  return 'h' + Date.now().toString(36) + '-' + handNo + '-' + counter.toString(36);
}

/* A recorder is per-table, not per-hand: begin() opens a new recording and
   finish() closes it and hands back the finished object. Calls that arrive
   while nothing is open are ignored rather than throwing, because a recorder
   must never be the reason a hand fails to play. */
export function createHandRecorder() {
  let hand = null;

  function push(ev) { if (hand) hand.events.push(ev); }

  return {
    isRecording: function () { return !!hand; },

    // `players` must be the live player objects, at the moment the hole cards
    // are dealt and the blinds are still to be posted.
    begin: function (opts) {
      const o = opts || {};
      hand = {
        v: HAND_SCHEMA_VERSION,
        id: newId(o.handNo || 0),
        // Which sitting this hand belongs to. games.js owns the game record;
        // this is the only link between the two, and it is the foreign key
        // the hands table will use once these sync to Postgres.
        gameId: o.gameId || null,
        handNo: o.handNo || 0,
        startedAt: o.startedAt || Date.now(),
        config: {
          sb: o.sb, bb: o.bb, startStack: o.startStack,
          dealerIdx: o.dealerIdx, heroIndex: o.heroIndex === undefined ? 0 : o.heroIndex,
          seats: seatSnapshot(o.players),
        },
        holeCards: holeSnapshot(o.players),
        events: [],
        decisions: [],
        result: null,
      };
      push({ t: 'deal', street: 0 });
      return hand.id;
    },

    blind: function (seat, put) { push({ t: 'blind', seat: seat, put: put }); },

    // `put` is chips leaving the stack; `to` is the player's total bet on this
    // street afterwards. Both are stored because a raise is quoted by its
    // target ("raises to 120") but paid by its increment, and deriving one
    // from the other at replay time needs state the event does not carry.
    action: function (o) {
      push({
        t: 'action', seat: o.seat, street: o.street, action: o.action,
        put: o.put || 0, to: o.to || 0,
        potBefore: o.potBefore || 0, toCall: o.toCall || 0,
        allIn: !!o.allIn,
      });
    },

    // Street 0 is emitted by begin() as the deal, so this is flop onwards.
    street: function (streetIndex, board, players) {
      push({ t: 'street', street: streetIndex, cards: cards(board) });
      if (players) push({ t: 'ranges', street: streetIndex, seats: rangeSnapshot(players) });
    },

    // Betting closed for the last time: the final street's bets go to the pot.
    collect: function () { push({ t: 'collect' }); },

    showdown: function (reveals) {
      push({
        t: 'showdown',
        reveals: (reveals || []).map(function (r) {
          return { seat: r.seat, hole: cards(r.hole), handName: r.handName || '' };
        }),
      });
    },

    award: function (seat, amount) { push({ t: 'award', seat: seat, amount: amount }); },

    // Returns the finished hand and closes the recording. Null if nothing was
    // open, so callers can persist unconditionally.
    finish: function (o) {
      if (!hand) return null;
      const done = hand;
      hand = null;
      const f = o || {};
      done.decisions = (f.decisions || []).map(function (d) {
        // The review markup in `detail` is regenerated HTML, not data, and is
        // by far the largest thing on a decision. Storing it would roughly
        // quadruple a hand for something the review can rebuild.
        return {
          street: d.street, streetName: d.streetName, taken: d.taken,
          evTaken: d.evTaken, cost: d.cost, equity: d.equity,
          pot: d.pot, toCall: d.toCall, nOpp: d.nOpp,
          bestLabel: d.best ? d.best.label : null,
          bestEv: d.best ? d.best.ev : null,
        };
      });
      done.result = {
        net: f.net || 0,
        potFinal: f.potFinal || 0,
        showdown: !!f.showdown,
        heroFolded: !!f.heroFolded,
        winners: f.winners || [],
      };
      done.endedAt = Date.now();
      return done;
    },

    // Abandon without emitting anything, for a hand that never completed.
    abort: function () { hand = null; },
  };
}

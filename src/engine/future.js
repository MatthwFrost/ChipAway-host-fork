/* ============================================================
   FUTURE VALUE — what happens after this street.

   The rest of the model prices a single street: EV(call) assumes the pot is
   won or lost now, EV(bet) assumes the hand ends when they call. Neither is
   true before the river, and the two errors point in opposite directions:

     implied odds          a draw that calls wins MORE than the pot when it hits,
                           because it gets paid again on a later street
     reverse implied odds  a weak made hand that calls loses MORE than the call,
                           because it keeps paying on later streets
     barrel value          a bet that gets called buys another chance to fold
                           them out next street, which the single-street figure
                           credits at zero

   Everything here is built from the calibrated response model — the chance they
   call a later bet, the chance they fold to one — rather than from invented
   constants. The four weights below scale those quantities; they are the only
   free numbers, and they are set by measuring bb/100 rather than by taste.
   ============================================================ */

import { outsToEquity, unseenCount } from './handShape.js';

const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

// Tunable weights. The harness swaps these to isolate each effect.
const DEFAULTS = {
  // Measured worth +37.6 bb/100 (±13.2, z = 2.9) over 40,000 hands pooled from
  // two seeds. Neither seed settled it alone.
  implied: 0.5,      // share of the extra bet a draw actually collects when it hits
  reverse: 0.45,     // share of the extra bet a weak made hand pays off when behind
  // MEASURED AT ZERO. Crediting a bet with next street's fold equity looks
  // obviously right and is not: `npm run sim:sweep --field=barrel` gave
  // 0 -> +148.8, 0.08 -> +116.9, 0.15 -> +113.4, 0.35 -> +111.4 bb/100, a
  // monotone decline. The term double-counts with the re-raise branch and makes
  // the coach over-bet, because the range that just CALLED is stronger than the
  // one that faced the first bet. Left in place, switchable, and off.
  barrel: 0,
  inPosition: 1.20,  // acting last: better implied odds, cheaper to get away
  outOfPosition: 0.85,
};
let W = Object.assign({}, DEFAULTS);

export function futureWeights() { return Object.assign({}, W); }
export function setFutureWeights(next) {
  const was = Object.assign({}, W);
  W = Object.assign({}, DEFAULTS, next || {});
  return was;
}
export function resetFutureWeights() { W = Object.assign({}, DEFAULTS); return W; }

// A typical bet on the next street, as a fraction of the pot that will be there.
export const NEXT_STREET_BET = 0.6;

// Streets still to be played after this one. Preflop 3, flop 2, turn 1, river 0.
export function streetsLeft(street) { return Math.max(0, 3 - street); }

/* ---- calling ---- */

// The correction to EV(call). Positive for draws that get paid when they hit,
// negative for hands that will have to keep paying to find out they are beaten.
//
//   shape      hero's hand shape (handShape.analyzeHandShape), may be null
//   e          hero's equity as already priced
//   pot        pot before the call, including the bet being faced
//   toCall     the call
//   oppCall    chance the opponent calls a bet of NEXT_STREET_BET next street
//   actsLast   whether hero has position
export function callFutureValue(opts) {
  const shape = opts.shape;
  const left = streetsLeft(opts.street);
  if (!shape || left <= 0) return 0;

  const nextPot = opts.pot + 2 * opts.toCall;
  const nextBet = NEXT_STREET_BET * nextPot;
  const posImplied = opts.actsLast ? W.inPosition : W.outOfPosition;
  const posReverse = opts.actsLast ? W.outOfPosition : W.inPosition;

  // Implied: only a hand that can improve collects anything extra, and only
  // when it actually improves. The chance of improving on the very next card is
  // the honest figure — value further out is already discounted by the fact
  // that it has to survive a street first.
  let implied = 0;
  if (shape.isDrawing && shape.outs > 0) {
    const unseen = unseenCount(opts.board || []);
    const pHit = outsToEquity(shape.outs, 1, Math.max(1, unseen));
    implied = pHit * clamp(opts.oppCall, 0, 1) * nextBet * W.implied * posImplied;
  } else if (shape.isMade) {
    // A strong made hand also gets paid again, just less often than it hits.
    // `isMade` in handShape means two pair or better, which is the right bar:
    // one pair is a bluff-catcher, not a hand that gets three streets of value.
    implied = 0.5 * clamp(opts.oppCall, 0, 1) * nextBet * W.implied * posImplied;
  }

  // Reverse implied: a bluff-catcher calling is buying the right to face
  // another bet. When it is behind — which is most of the time by definition —
  // that costs more than the call being priced.
  let reverse = 0;
  // NOT `shape.isMade && madeCategory <= 1` — handShape sets isMade only from
  // two pair up, so that condition can never be true and left this whole half
  // of the correction as dead code. A bluff-catcher is one pair or worse, with
  // no draw to fall back on.
  const weakMade = !shape.isDrawing && shape.madeCategory <= 1;
  if (weakMade || shape.bricked) {
    reverse = (1 - clamp(e0(opts.e), 0, 1)) * nextBet * W.reverse * posReverse;
  }

  // Never let the correction exceed what is actually at stake on later streets.
  return clamp(implied - reverse, -nextBet, nextBet);
}

function e0(e) { return (e === null || e === undefined || !isFinite(e)) ? 0 : e; }

/* ---- betting ---- */

// A bet that gets called is not the end of the hand. Hero arrives on the next
// street with the initiative and another chance to make them fold — value the
// single-street formula scores at exactly zero, which is why a model built on
// it under-bets.
//
//   nextFold  chance the (tightened) calling range folds to a bet of
//             NEXT_STREET_BET on the next street
export function barrelValue(opts) {
  const left = streetsLeft(opts.street);
  if (left <= 0) return 0;
  const nextPot = opts.pot + 2 * opts.bet;
  const pos = opts.actsLast ? W.inPosition : W.outOfPosition;
  return clamp(opts.nextFold, 0, 1) * nextPot * W.barrel * pos;
}

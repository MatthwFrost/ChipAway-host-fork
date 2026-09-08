/* ============================================================
   HAND SHAPE — have you got something, or are you drawing to it?

   Equity alone cannot tell those two apart. A flush draw with two
   overcards and a made top pair can show the same number, and they want
   opposite lines: the draw wants to bet (it wins now when they fold, and
   later when it hits), the made hand wants to get called.

   Outs are counted exactly rather than from a table: deal every unseen
   card and ask whether it turns this into a hand worth showing down.
   ============================================================ */

import { RANK_CHARS, SUIT_NAMES, cardStr, evaluateBest, makeDeck } from './evaluator';

const CAT = { HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5 };

// A hand you would be happy to show down unimproved.
const STRONG_FROM = CAT.TWO_PAIR;

function heldRanks(hole) { return hole.map(function (c) { return c.rank; }); }

// Does the current made hand actually use your cards, or is it all board?
function usesHoleCards(hole, board, score) {
  if (score[0] === CAT.PAIR) return heldRanks(hole).indexOf(score[1]) >= 0;
  if (score[0] === CAT.HIGH) return false;
  return true;
}

export function madeLabel(score, hole, board) {
  if (score[0] < 0) return 'nothing yet';
  if (score[0] >= CAT.TRIPS) return null;            // strong enough to speak for itself
  if (score[0] === CAT.TWO_PAIR) return 'two pair';
  if (score[0] === CAT.PAIR) {
    if (!usesHoleCards(hole, board, score)) return 'a pair on the board, which everyone shares';
    const top = Math.max.apply(null, board.map(function (c) { return c.rank; }));
    const hr = heldRanks(hole);
    if (hr[0] === hr[1] && hr[0] > top) return 'an overpair';
    if (score[1] >= top) return 'top pair';
    return 'a weak pair';
  }
  return 'no pair';
}

export function analyzeHandShape(hole, board) {
  const cardsToCome = Math.max(0, 5 - board.length);
  const score = evaluateBest(hole.concat(board));
  const made = score[0];
  const label = madeLabel(score, hole, board);
  const shape = {
    cardsToCome: cardsToCome,
    madeCategory: made,
    madeLabel: label,
    usesHoleCards: made >= 0 ? usesHoleCards(hole, board, score) : false,
    isMade: made >= STRONG_FROM,
    outs: 0,
    flushOuts: 0,
    straightOuts: 0,
    otherOuts: 0,
    flushSuit: null,
    isDrawing: false,
    bricked: false,
  };
  if (board.length < 3 || cardsToCome === 0) {
    shape.bricked = cardsToCome === 0 && made < STRONG_FROM;
    return shape;
  }

  // Count outs exactly: every unseen card that lifts this to a hand worth
  // showing down. A card that makes both a flush and a straight counts once.
  const seen = {};
  hole.concat(board).forEach(function (c) { seen[cardStr(c)] = 1; });
  const target = Math.max(STRONG_FROM, made + 1);
  makeDeck().forEach(function (c) {
    if (seen[cardStr(c)]) return;
    const after = evaluateBest(hole.concat(board, [c]));
    if (after[0] < target) return;
    shape.outs++;
    if (after[0] >= CAT.FLUSH) { shape.flushOuts++; shape.flushSuit = c.suit; }
    else if (after[0] === CAT.STRAIGHT) shape.straightOuts++;
    else shape.otherOuts++;
  });

  shape.isDrawing = made < STRONG_FROM && shape.outs >= 4;
  return shape;
}

// The rule of 4 and 2 is the version people memorise, but it overshoots badly
// once you have more than about eight outs — it would price a 20-out draw at
// 80% when the real number is 67%. Since the exact figure is one line of
// combinatorics, use it and leave the rule of thumb to the glossary.
export function outsToEquity(outs, cardsToCome, unseen) {
  if (!outs || !cardsToCome) return 0;
  const n = unseen || (cardsToCome >= 2 ? 47 : 46);
  if (outs >= n) return 1;
  if (cardsToCome === 1) return outs / n;
  const miss = ((n - outs) / n) * ((n - outs - 1) / (n - 1));   // both cards miss
  return 1 - miss;
}

// One sentence naming what you are actually holding.
export function describeShape(shape) {
  const parts = [];
  if (shape.isMade) return null;                      // made hands need no draw talk
  if (shape.flushOuts >= 7) parts.push(shape.flushOuts + ' cards make the flush');
  else if (shape.flushOuts > 0) parts.push(shape.flushOuts + ' make a flush');
  if (shape.straightOuts >= 6) parts.push(shape.straightOuts + ' make a straight (open-ended)');
  else if (shape.straightOuts > 0) parts.push(shape.straightOuts + ' make a straight');
  if (shape.otherOuts >= 3) parts.push(shape.otherOuts + ' pair you up into two pair or better');
  if (!parts.length) return null;
  return parts.join(', ');
}

// Unseen cards remaining from your point of view.
export function unseenCount(board) { return 52 - 2 - board.length; }

export function rankName(rank) { return RANK_CHARS[rank - 2]; }
export function suitName(suit) { return SUIT_NAMES[suit]; }

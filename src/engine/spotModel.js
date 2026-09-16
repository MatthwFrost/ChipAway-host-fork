/* ============================================================
   SPOT MODEL — the one place a spot is turned into numbers and reads.

   Every surface that says anything about the hand (the coach, the opponent
   tips, the fold-equity table, the reads panel, the hand review) is built from
   the object this file returns. Nothing downstream is allowed to re-derive a
   figure or re-decide a question such as "can I bluff here" — if two panels
   disagreed, it was because they each answered that question for themselves.

   The rule this file enforces:

     a fact is derived exactly once, banded exactly once, and every sentence
     that mentions it reads the same field.

   Formulas follow MATHS.md:
     required equity   e* = C / (P + C)        (§4, P already holds their bet)
     break-even bluff  f* = B / (P + B)        (§6)
     EV(call)          e·P − (1−e)·C           (§5)
     EV(bet)           f·P + c[e(P+B) − (1−e)B] + r(−B)
   ============================================================ */

import {
  BLUFF_TOP, breakEvenFold, evOfBet, evOfCall, jointResponse, requiredEquity,
} from './opponentModel.js';

export { BLUFF_TOP, breakEvenFold, evOfBet, evOfCall, requiredEquity };

const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

/* ---- formatting primitives ---- */

// Equity is shown as whole numbers everywhere. The Monte Carlo error bar is
// wider than a decimal point, so a decimal would be false precision.
export function pctWhole(fraction) {
  if (fraction === null || fraction === undefined || !isFinite(fraction)) return null;
  return Math.round(100 * fraction);
}

// 95% confidence half-width in percentage points, from the standard error of
// the estimate (MATHS.md §2: SE = sqrt(e(1-e)/n)).
export function ci95Points(se) {
  if (se === null || se === undefined || !isFinite(se)) return null;
  return Math.round(100 * 1.96 * se);
}

export function chips(n) { return Math.round(n).toString(); }

export function signed(n) {
  const r = Math.round(n);
  return (r >= 0 ? '+' : '') + r;
}

/* ---- the one fold ladder ----

   Three different thresholds used to live in three different functions: 0.18 /
   0.35 / 0.55 for the wording, 0.25 / 0.5 for the table read, 0.4 for the draw
   advice and 0.12 for the quick points. The same opponent could therefore be
   "folds often enough to bluff" in one sentence and "nobody here folds much"
   two lines below. There is now one ladder and every surface reads it.
   ---- */

export const BLUFFABLE_FLOOR = 0.35;   // below this, a bluff is not a plan
export const STICKY_CEILING = 0.18;    // below this, they are effectively unfoldable
export const JAM_RISK_FLOOR = 0.15;    // at or above this, expect to be played back at

const BANDS = [
  { key: 'often', min: 0.55, word: 'folds a lot', plural: 'fold a lot', bluffable: true },
  { key: 'enough', min: BLUFFABLE_FLOOR, word: 'folds often enough to bluff', plural: 'fold often enough to bluff', bluffable: true },
  { key: 'seldom', min: STICKY_CEILING, word: 'does not fold easily', plural: 'do not fold easily', bluffable: false },
  { key: 'never', min: -1, word: 'almost never folds', plural: 'almost never fold', bluffable: false },
];

export function foldBand(f) {
  const x = (f === null || f === undefined || !isFinite(f)) ? 0 : f;
  for (let i = 0; i < BANDS.length; i++) if (x >= BANDS[i].min) return BANDS[i];
  return BANDS[BANDS.length - 1];
}

export function foldinessWord(f) { return foldBand(f).word; }
export function foldinessWordPlural(f) { return foldBand(f).plural; }

/* ---- action families ---- */

// A different bet SIZE is not a different decision; a different family is.
export function actionFamily(label) {
  if (/^fold/.test(label)) return 'fold';
  if (/^check/.test(label)) return 'check';
  if (/^call/.test(label)) return 'call';
  return 'aggro';
}

/* ---- how clear-cut the pick actually is ---- */

// Some spots have exactly one answer and some are a coin flip between two
// reasonable lines. Saying both in the same confident voice is what makes a
// coach untrustworthy, so the gap to the best option from a DIFFERENT family is
// measured against both the Monte Carlo noise on the two EVs and a slice of the
// pot — "clear" then means clear in chips as well as statistically.
export function decisionClarity(options, recommended, pot) {
  const opts = options || [];
  if (!recommended || opts.length < 2) return { level: 'clear', alt: null, gap: 0, material: 0 };
  const fam = actionFamily(recommended.label);
  // Checking weakly dominates folding — you can always fold later, for free — so
  // whenever a check is on offer, folding is never the meaningful runner-up.
  const canCheck = opts.some(function (o) { return actionFamily(o.label) === 'check'; });
  let alt = null;
  opts.forEach(function (o) {
    if (o === recommended || actionFamily(o.label) === fam) return;
    if (canCheck && actionFamily(o.label) === 'fold') return;
    if (!alt || o.ev > alt.ev) alt = o;
  });
  if (!alt) return { level: 'clear', alt: null, gap: 0, material: 0 };
  const gap = recommended.ev - alt.ev;
  const se = Math.sqrt(Math.pow(recommended.evSe || 0, 2) + Math.pow(alt.evSe || 0, 2));
  const material = Math.max(se, Math.max(pot, 1) * 0.04);
  let level = 'solid';
  if (gap <= material * 0.5) level = 'toss-up';
  else if (gap <= material) level = 'marginal';
  else if (gap >= material * 3) level = 'clear';
  return { level: level, alt: alt, gap: gap, material: material };
}

/* ---- normalising what comes in ---- */

// An opponent read arrives either as a full response distribution (the trainer
// has one, because it prices the bots with the same function) or as a bare fold
// chance (older fixtures). A bare fold chance carries no information about
// re-raising, and is marked as such rather than being silently read as "they
// never raise".
function normaliseOpponent(o, refAmount, pot) {
  const resp = o.response
    ? o.response
    : { fold: o.foldChance || 0, call: 1 - (o.foldChance || 0), raise: 0 };
  const fold = clamp(resp.fold, 0, 1);
  const raise = clamp(resp.raise || 0, 0, 1 - fold);
  return {
    name: o.name,
    styleLabel: o.styleLabel || null,
    rangeTopPct: o.rangeTopPct,
    airPct: o.airPct || 0,
    fold: fold,
    call: clamp(1 - fold - raise, 0, 1),
    raise: raise,
    continue: 1 - fold,
    band: foldBand(fold),
    responseKnown: !!o.response,
    refAmount: refAmount,
    refPot: pot,
  };
}

/* ---- can a bluff work here? ----

   One question, answered once, in one place. It has two halves and they are
   different kinds of fact:

     the price    does the field fold more often than B/(P+B) needs?
     the person   is this a style that folds at all?

   A bluff needs both. Splitting them is what lets the advice say WHY a bluff is
   off rather than just asserting it, and it is what stops "they fold 73% of the
   time" from ever appearing above a table that says "do not bluff this player".
   ---- */
export function assessBluff(joint, refAmount, pot, opponents) {
  const be = breakEvenFold(refAmount, pot);
  const folds = joint.fold;
  const band = foldBand(folds);
  const pricePasses = folds >= be;
  const personPasses = band.bluffable;
  // Somebody who jams it back turns a bluff into a bluff you then have to fold,
  // which the break-even figure does not know about. One bet in seven coming
  // back at you is already enough to change the line, so the bar is set there
  // rather than at a round fifth.
  const jamRisk = joint.raise >= JAM_RISK_FLOOR;
  let blockedBy = null;
  if (!personPasses) blockedBy = 'stickiness';
  else if (!pricePasses) blockedBy = 'price';
  else if (jamRisk) blockedBy = 'reraise';
  const stickiest = (opponents || []).slice().sort(function (a, b) { return a.fold - b.fold; })[0] || null;
  return {
    folds: folds,
    raises: joint.raise,
    breakEven: be,
    headroom: folds - be,
    band: band,
    viable: pricePasses && personPasses && !jamRisk,
    pricePasses: pricePasses,
    personPasses: personPasses,
    jamRisk: jamRisk,
    blockedBy: blockedBy,
    anchor: stickiest,
    refAmount: refAmount,
  };
}

/* ---- how the table as a whole behaves ---- */
export function tableFoldRead(opponents) {
  const opps = opponents || [];
  if (!opps.length) return { kind: 'none', band: null };
  const sticky = opps.filter(function (o) { return o.fold < STICKY_CEILING; });
  const foldy = opps.filter(function (o) { return o.band.bluffable; });
  if (opps.length >= 2 && sticky.length >= 2) {
    return { kind: 'sticky', band: foldBand(sticky[1].fold), sticky: sticky };
  }
  if (opps.length >= 2 && foldy.length === opps.length) {
    return { kind: 'foldy', band: foldBand(foldy[0].fold), foldy: foldy };
  }
  if (opps.length === 1) return { kind: 'single', band: opps[0].band, who: opps[0] };
  return { kind: 'mixed', band: null };
}

/* ---- how to play this opponent ----

   Derived, not stored. A hand-written table of tips cannot know what size is on
   offer or how wide the player has actually got, so it went on saying "do not
   bluff — they call regardless" underneath a coach recommending a bluff. Every
   bullet here is a sentence about a number that also drives the recommendation.
   ---- */
export function counterPlan(opp, bluff, revealStyles, fieldSize) {
  if (!opp) return null;
  const fPct = Math.round(100 * opp.fold);
  const cPct = Math.round(100 * opp.call);
  const rPct = Math.round(100 * opp.raise);
  const be = breakEvenFold(bluff.refAmount, opp.refPot);
  const bePct = Math.round(100 * be);
  const air = Math.round(opp.airPct);
  const nField = fieldSize || 1;
  const bullets = [];

  // 1. bluffing. Three tests, in the order they can kill a bluff, and all three
  // are the same fields the recommendation reads:
  //   is this a style that folds at all;  does THIS player clear the price;
  //   does the whole field clear it once everyone has to fold at once.
  // A tip about one player must never promise something the field vetoes.
  if (!opp.band.bluffable) {
    bullets.push('They fold about ' + fPct + '% to this size where a bluff needs ' + bePct +
      '%. Do not bluff them — there is no size that gets through often enough.');
  } else if (opp.fold < be) {
    bullets.push('They fold about ' + fPct + '% to this size, short of the ' + bePct +
      '% it needs. Bluff only with a hand that can improve.');
  } else if (nField > 1 && !bluff.viable) {
    bullets.push('On their own they fold about ' + fPct + '% against the ' + bePct +
      '% a bluff needs. But you have to get through ' + nField + ' players at once, and the field only folds about ' +
      Math.round(100 * bluff.folds) + '% — so this is not the spot to try it.');
  } else if (opp.band.key === 'often' && bluff.viable) {
    bullets.push('They fold about ' + fPct + '% to this size, well clear of the ' + bePct +
      '% a bluff needs to pay for itself. Bluff them, and do not be shy about the size.');
  } else {
    bullets.push('They fold about ' + fPct + '% to this size against the ' + bePct +
      '% it needs — a bluff clears its bar, but not by much. Pick the ones with equity behind them.');
  }

  // 2. getting paid
  bullets.push(opp.call >= 0.45
    ? 'They call about ' + cPct + '% of the time, so value bet thin and size up. Chips come from their calls, not from folding them out.'
    : 'They only call about ' + cPct + '% of the time, so a big value bet prices out the worse hands you want in. Size down when you are ahead.');

  // 3. what to do when they bet
  bullets.push(air >= 25
    ? 'Roughly ' + air + '% of the range they are showing is air, so your bluff-catchers go up in value — call more than feels comfortable.'
    : 'Only about ' + air + '% of the range they are showing is air. When they commit, believe it.');

  // 4. what happens if you put money in
  bullets.push(opp.raise >= JAM_RISK_FLOOR
    ? 'They come back over the top about ' + rPct + '% of the time they continue, so a raise here often just buys you a decision you do not want. Check strong hands and let them barrel into you.'
    : 'They re-raise only about ' + rPct + '% of the time they continue, so a bet usually buys a clean answer rather than a war.');

  const head = (revealStyles && opp.styleLabel)
    ? opp.name + ' is a ' + opp.styleLabel.toLowerCase()
    : 'How to play ' + opp.name;
  return { head: head, bullets: bullets };
}

/* ---- the model ---- */

// spot: {
//   streetName, toCall, pot, rawEquity, rangeEquity, decisionEquity, equitySe,
//   degradedShare, trials, blockerPct, revealStyles,
//   opponents:[{name, styleLabel, rangeTopPct, airPct, response|foldChance}],
//   options:[{label, ev, amount, fold, raise, eCalled, evSe}],
//   recommended, villain, field, shape, position
// }
export function buildSpotModel(spot) {
  const P = spot.pot;
  const C = spot.toCall;
  const options = spot.options || [];

  let bestAggro = null;
  options.forEach(function (o) {
    if (o.fold !== undefined && (!bestAggro || o.ev > bestAggro.ev)) bestAggro = o;
  });
  const refAmount = bestAggro ? bestAggro.amount : Math.max(1, Math.round(P * 0.75));

  const opponents = (spot.opponents || []).map(function (o) {
    return normaliseOpponent(o, refAmount, P);
  });

  // The joint response over the whole field, from the per-player responses —
  // never a flat placeholder, and never a different product in a second place.
  const joint = jointResponse(opponents);

  // The figure a bet is actually judged on is the one attached to the option
  // being recommended, not the field-wide reference.
  const recFold = (bestAggro && bestAggro.fold !== undefined) ? bestAggro.fold : joint.fold;
  const recRaise = (bestAggro && bestAggro.raise !== undefined) ? bestAggro.raise : joint.raise;
  const bluff = assessBluff({ fold: recFold, raise: recRaise }, refAmount, P, opponents);

  const rec = spot.recommended || null;
  const clarity = decisionClarity(options, rec, P);
  const family = rec ? actionFamily(rec.label) : 'fold';

  const req = requiredEquity(C, P);
  const rangePct = pctWhole(spot.rangeEquity);
  const reqPct = pctWhole(req);

  // The equity the DECISION was made on: priced against those expected to keep
  // going, plus the credit for acting last. Quoting the headline figure instead
  // prints "you hold 4% where the price needs 8%" above a call.
  const decisionEquity = (spot.decisionEquity === null || spot.decisionEquity === undefined)
    ? spot.rangeEquity : spot.decisionEquity;

  let villain = null;
  if (spot.villain) {
    const byName = opponents.filter(function (o) { return o.name === spot.villain.name; })[0];
    villain = byName || normaliseOpponent(spot.villain, refAmount, P);
  } else if (opponents.length === 1) {
    villain = opponents[0];
  }

  const model = {
    streetName: spot.streetName,
    revealStyles: !!spot.revealStyles,
    price: {
      toCall: C,
      pot: P,
      potIfCall: P + C,
      required: req,
      requiredPct: reqPct,
    },
    equity: {
      raw: spot.rawEquity,
      range: spot.rangeEquity,
      decision: decisionEquity,
      se: spot.equitySe,
      rawPct: pctWhole(spot.rawEquity),
      rangePct: rangePct,
      decisionPct: pctWhole(decisionEquity),
      ciPoints: ci95Points(spot.equitySe),
      degradedShare: spot.degradedShare || 0,
      trials: spot.trials,
      margin: (rangePct === null || reqPct === null) ? null : rangePct - reqPct,
    },
    opponents: opponents,
    joint: joint,
    field: spot.field || null,
    options: options,
    recommended: rec,
    clarity: clarity,
    family: family,
    action: family === 'aggro' ? 'bet' : family,
    bestAggro: bestAggro,
    bluff: bluff,
    tableRead: tableFoldRead(opponents),
    villain: villain,
    blockerPct: spot.blockerPct || 0,
    shape: spot.shape || null,
    position: spot.position || null,
  };
  model.counter = counterPlan(villain, bluff, model.revealStyles, opponents.length);
  return model;
}

/* ---- is a bet carried by fold equity? ---- */

// Would this bet still be the best line if they never folded at all? If not,
// fold equity is what is carrying it, and that is the fact worth leading with.
// Closed form, so it costs nothing: no second simulation.
export function foldEquityDecisive(model) {
  const rec = model.recommended;
  const alt = model.clarity.alt;
  if (!rec || rec.fold === undefined) return false;
  if (rec.eCalled === undefined || rec.eCalled === null) return rec.fold >= 0.25;
  const P = model.price.pot, B = rec.amount, e = rec.eCalled;
  const evIfTheyNeverFolded = e * (P + B) - (1 - e) * B;
  return evIfTheyNeverFolded < (alt ? alt.ev : 0);
}

// Acting last is credited explicitly in the equity the options were priced on,
// so its contribution can be subtracted back out exactly: if taking it away
// flips the pick, position is the reason this works and deserves saying.
export function positionDecisive(model) {
  const rec = model.recommended;
  const alt = model.clarity.alt;
  const credit = model.position ? model.position.credit : 0;
  if (!credit || credit <= 0 || !rec) return false;
  // Only calls and bets are priced off equity, so only they carry the credit.
  if (actionFamily(rec.label) !== 'call') return false;
  const swing = credit * (model.price.pot + (model.price.toCall || 0));
  return (rec.ev - swing) < (alt ? alt.ev : 0);
}

/* ---- the invariants ----

   Machine-checkable statements of everything this module exists to guarantee.
   The advice tests run this over a large matrix of spots, so a contradiction
   has to be introduced deliberately rather than by accident.
   ---- */
export function checkModelConsistency(model) {
  const bad = [];
  const push = function (code, detail) { bad.push({ code: code, detail: detail }); };

  model.opponents.forEach(function (o) {
    const sum = o.fold + o.call + o.raise;
    if (Math.abs(sum - 1) > 1e-6) push('response-not-a-distribution', o.name + ' sums to ' + sum);
    if (o.fold < 0 || o.fold > 1) push('fold-out-of-range', o.name + ' ' + o.fold);
    if (o.band !== foldBand(o.fold)) push('band-mismatch', o.name);
  });

  if (model.opponents.length) {
    const maxFold = Math.max.apply(null, model.opponents.map(function (o) { return o.fold; }));
    if (model.joint.fold > maxFold + 1e-9) {
      push('joint-fold-exceeds-any-player', model.joint.fold + ' > ' + maxFold);
    }
  }

  // A bluff cannot be viable and blocked at the same time.
  if (model.bluff.viable && model.bluff.blockedBy) push('bluff-viable-and-blocked', model.bluff.blockedBy);
  if (!model.bluff.viable && !model.bluff.blockedBy) push('bluff-blocked-by-nothing', '');
  if (model.bluff.viable && !model.bluff.band.bluffable) push('bluff-viable-against-unbluffable-band', model.bluff.band.key);
  if (model.bluff.viable && model.bluff.headroom < 0) push('bluff-viable-below-break-even', String(model.bluff.headroom));

  // The counter tips and the bluff assessment are the same fact.
  if (model.counter && model.villain) {
    const saysNo = /Do not bluff/.test(model.counter.bullets.join(' '));
    if (saysNo && model.villain.band.bluffable) push('counter-says-no-bluff-against-bluffable-band', model.villain.name);
    if (!saysNo && !model.villain.band.bluffable) push('counter-silent-on-unbluffable-player', model.villain.name);
  }

  // The bet the advice is built around is priced at the same size the opponent
  // reads were taken at, so its fold rate and the field's must be the same
  // number. Two different answers to "how often does this get through" is the
  // shape of every contradiction this module exists to prevent.
  if (model.bestAggro && model.opponents.length && model.bestAggro.fold !== undefined) {
    if (Math.abs(model.bestAggro.fold - model.joint.fold) > 0.02) {
      push('option-fold-disagrees-with-field',
        'option ' + model.bestAggro.fold.toFixed(3) + ' vs field ' + model.joint.fold.toFixed(3));
    }
  }

  if (model.clarity.alt && model.clarity.level !== 'toss-up' && model.clarity.gap < -1e-9) {
    push('non-tossup-with-negative-gap', String(model.clarity.gap));
  }
  return bad;
}

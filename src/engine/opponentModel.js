/* ============================================================
   OPPONENT MODEL — the primitives every read is built from.

   Pure: no DOM, no module-level game state, no randomness. Everything the
   trainer, the coach and the opponent tips say about "what will they do if I
   bet" resolves to a call into this file, so the three can never disagree.

   The central object is a RESPONSE: given a profile, the range they have shown,
   and a bet of B into P, they either fold, call, or raise. Those three
   probabilities sum to 1 and are the only currency the rest of the app deals in.

     fold  they give up and you win P
     call  you go to showdown with e(called) equity for B more
     raise they put it back on you

   Modelling "not fold" as "call" is what made a re-raise look free against the
   players most likely to jam it straight back.
   ============================================================ */

const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

// Bluffs come from the bottom third of hands.
export const BLUFF_TOP = 0.34;

/* ---- profiles ----

   Three model-side fields beyond the betting model, each doubled for preflop
   (`*Pre`), all about what a player does when the money goes in against them
   rather than when they put it in. They were FITTED to the bots' actual
   behaviour by `npm run sim:tune` rather than guessed, which is why they are
   not round numbers:

     continueBias    how much of their range they keep BEYOND what the price
                     alone justifies, as used by the prediction model. It starts
                     life as a copy of callBuffer, but it is a separate field on
                     purpose: callBuffer drives what the bots actually DO, so
                     tuning it would move the ground truth the model is being
                     fitted to. Only this one is tuned.
     airPersistence  share of their pure air that keeps firing when raised. A
                     player who bluffs often is by definition willing to put
                     chips in without a hand, so their air does NOT surrender on
                     command. Treating it as if it did made the loosest,
                     most aggressive profiles read as the easiest to bluff.
     reRaise         share of their continuing hands that come back over the top
                     rather than flat-calling.
   ---- */
export const PROFILES = {
  nit: {
    label: 'Nit', openPct: 0.16, callPct: 0.14, threeBetPct: 0.035, limpPct: 0.03,
    raiseRel: 1.50, callBuffer: 0.09, bluffFreq: 0.05, sizing: 0.55, maxRaises: 2,
    sigRaise: 0.82, sigCall: 0.48, polar: 0.22, mixW: 0.030, mixR: 0.16,
    continueBias: -0.025, airPersistence: 0, reRaise: 0.24, sizeSlope: 0.125,
    continueBiasPre: 0.3, airPersistencePre: 0.1, reRaisePre: 0.78, sizeSlopePre: 0.15, posWeight: 0.8, note: 'folds a lot, only bets strong',
  },
  tag: {
    label: 'TAG', openPct: 0.25, callPct: 0.20, threeBetPct: 0.070, limpPct: 0.04,
    raiseRel: 1.22, callBuffer: 0.04, bluffFreq: 0.14, sizing: 0.65, maxRaises: 2,
    sigRaise: 0.70, sigCall: 0.40, polar: 0.55, mixW: 0.035, mixR: 0.18,
    continueBias: -0.1, airPersistence: 0, reRaise: 0.34, sizeSlope: 0.1,
    continueBiasPre: 0.225, airPersistencePre: 0.98, reRaisePre: 0.78, sizeSlopePre: 0.15, posWeight: 0.35, note: 'tight and aggressive',
  },
  lag: {
    label: 'LAG', openPct: 0.37, callPct: 0.30, threeBetPct: 0.120, limpPct: 0.07,
    raiseRel: 1.08, callBuffer: -0.03, bluffFreq: 0.22, sizing: 0.72, maxRaises: 3,
    sigRaise: 0.55, sigCall: 0.28, polar: 0.72, mixW: 0.045, mixR: 0.22,
    continueBias: -0.2, airPersistence: 0.386, reRaise: 0.32, sizeSlope: 0.1,
    continueBiasPre: 0.15, airPersistencePre: 0.98, reRaisePre: 0.78, sizeSlopePre: 0.15, posWeight: 0.55, note: 'wide, applies pressure',
  },
  station: {
    label: 'Station', openPct: 0.30, callPct: 0.58, threeBetPct: 0.020, limpPct: 0.34,
    raiseRel: 1.82, callBuffer: -0.17, bluffFreq: 0.02, sizing: 0.42, maxRaises: 1,
    sigRaise: 0.87, sigCall: 0.08, polar: 0.05, mixW: 0.040, mixR: 0.14,
    // A station rarely HAS air, so airPersistence is not identified by the data
    // for this profile and keeps its reasoned value: a station's air calls
    // rather than folds, because a station always puts the money in. reRaise
    // near zero is what the fit confirms — they continue by calling.
    continueBias: -0.55, airPersistence: 0.72, reRaise: 0.04, sizeSlope: 0.1,
    continueBiasPre: 0.1, airPersistencePre: 0.72, reRaisePre: 0.1, sizeSlopePre: 0.15, posWeight: 1.6, note: 'calls too much, rarely raises',
  },
  maniac: {
    label: 'Maniac', openPct: 0.56, callPct: 0.62, threeBetPct: 0.220, limpPct: 0.12,
    raiseRel: 0.95, callBuffer: -0.21, bluffFreq: 0.30, sizing: 0.80, maxRaises: 3,
    sigRaise: 0.33, sigCall: 0.06, polar: 0.85, mixW: 0.055, mixR: 0.26,
    continueBias: -0.5, airPersistence: 0.98, reRaise: 0.22, sizeSlope: 0.325,
    continueBiasPre: 0.05, airPersistencePre: 0.742, reRaisePre: 0.64, sizeSlopePre: 0.15, posWeight: 1.55, note: 'relentless, bluff-heavy',
  },
};

export const HERO_PROF = {
  label: 'You', sigRaise: 0.70, sigCall: 0.40, polar: 0.55, bluffFreq: 0.15,
  callBuffer: 0.04, continueBias: 0.04, airPersistence: 0.30, reRaise: 0.14,
};

export const PROFILE_KEYS = ['nit', 'tag', 'lag', 'station', 'maniac'];

/* HARNESS ONLY. Swap the model-side parameters so the same 10,000 hands can be
   replayed under an older parameter set and the difference attributed to the
   parameters rather than to anything else. Returns a restore function.
   Never call this from app code — the app reads one fixed model. */
const MODEL_FIELDS = [
  'continueBias', 'airPersistence', 'reRaise', 'sizeSlope', 'posWeight',
  'continueBiasPre', 'airPersistencePre', 'reRaisePre', 'sizeSlopePre',
];
export function overrideModelParams(spec) {
  const saved = {};
  Object.keys(spec).forEach(function (key) {
    const prof = PROFILES[key];
    if (!prof) return;
    saved[key] = {};
    MODEL_FIELDS.forEach(function (f) { saved[key][f] = prof[f]; });
    MODEL_FIELDS.forEach(function (f) {
      if (Object.prototype.hasOwnProperty.call(spec[key], f)) prof[f] = spec[key][f];
      else delete prof[f];
    });
  });
  return function restore() {
    Object.keys(saved).forEach(function (key) {
      MODEL_FIELDS.forEach(function (f) {
        if (saved[key][f] === undefined) delete PROFILES[key][f];
        else PROFILES[key][f] = saved[key][f];
      });
    });
  };
}

export function profileOf(key) {
  return PROFILES[key] || HERO_PROF;
}

/* ---- range narrowing: what an action tells everyone else ---- */

// A player carries {rLo, rBluff}: the quantile floor of their value range, and
// the share of that range which is pure air. These return the NEW state rather
// than mutating, so they can be reasoned about one action at a time.
export function afterAggro(state, prof, sizeRatio) {
  const sr = clamp(sizeRatio, 0.2, 1.6);
  const tighten = prof.sigRaise + 0.13 * (sr - 0.62);
  const pol = clamp(prof.polar * (0.55 + 0.62 * sr), 0, 0.92);
  const share = clamp(pol * prof.bluffFreq * 2.4, 0, 0.42);
  return {
    rLo: Math.max(state.rLo || 0, clamp(tighten, 0, 0.95)),
    rBluff: Math.max(state.rBluff || 0, share),
  };
}

export function afterCall(state, prof) {
  return {
    rLo: Math.max(state.rLo || 0, prof.sigCall),
    rBluff: (state.rBluff || 0) * 0.30,   // calling with pure air is rare
  };
}

export function afterCheck(state) {
  return { rLo: state.rLo || 0, rBluff: (state.rBluff || 0) * 0.65 };
}

// How wide the range they are representing is, as a percentage of all hands.
export function rangeWidth(state) {
  const lo = state.rLo || 0, bl = state.rBluff || 0;
  return (((1 - lo) * (1 - bl)) + BLUFF_TOP * bl) * 100;
}

/* ---- what hero's own bet represents ---- */

export function projectedHeroRep(heroState, B, P) {
  const sr = clamp(B / Math.max(1, P), 0.15, 3.0);
  const tighten = HERO_PROF.sigRaise + 0.13 * (sr - 0.62);
  const pol = clamp(HERO_PROF.polar * (0.55 + 0.62 * Math.min(sr, 2)), 0, 0.92);
  return {
    rLo: Math.max((heroState && heroState.rLo) || 0, clamp(tighten, 0, 0.93)),
    rBluff: Math.max((heroState && heroState.rBluff) || 0, clamp(pol * HERO_PROF.bluffFreq * 2.4, 0, 0.42)),
  };
}

/* ---- the continue threshold ---- */

/* Preflop and postflop are different games and the model gets them wrong in
   OPPOSITE directions, so each regime carries its own tuned parameters.
   Measured before tuning: preflop the model under-predicted folding by 16-27
   points, postflop it over-predicted by 15-31. A single shared knob cannot fix
   both and a fit over the two combined just splits the difference badly.

   Every *Pre field falls back to its postflop twin, so a profile that has not
   been split behaves exactly as before. */
function contBias(prof, preflop) {
  if (preflop && prof.continueBiasPre !== undefined) return prof.continueBiasPre;
  return prof.continueBias === undefined ? (prof.callBuffer || 0) : prof.continueBias;
}
function airPersist(prof, preflop) {
  if (preflop && prof.airPersistencePre !== undefined) return prof.airPersistencePre;
  return prof.airPersistence === undefined ? 0.30 : prof.airPersistence;
}
function reRaiseBase(prof, preflop) {
  if (preflop && prof.reRaisePre !== undefined) return prof.reRaisePre;
  return prof.reRaise === undefined ? 0.10 : prof.reRaise;
}
// How sharply the continue threshold moves with bet size. Positive means bigger
// bets fold out more, which is the textbook expectation and was hardcoded at
// 0.15. Postflop the table says otherwise for the tighter profiles: a player
// facing a big bet has usually already committed chips, so their range is
// strong and they call. Letting this go NEGATIVE is what allows the model to
// express that, and the fit is what decides which way it points.
// How strongly position and field size widen a player's continuing range.
// The bots scale their preflop calling range by posMult x fieldBoost directly
// (see decidePreflop), so a model with no positional term cannot describe them:
// a big blind defends far wider than an under-the-gun player and the model was
// predicting one number for both. 0 disables it, 1 applies it in full.
function posWeightOf(prof) {
  return prof.posWeight === undefined ? 0 : prof.posWeight;
}
function sizeSlopeOf(prof, preflop) {
  if (preflop && prof.sizeSlopePre !== undefined) return prof.sizeSlopePre;
  return prof.sizeSlope === undefined ? 0.15 : prof.sizeSlope;
}

// The quantile above which their VALUE hands keep playing. Everything from here
// up is the range a bet actually has to beat once it gets called.
export function continueThresholdPre(state, prof, betSize, ctx) {
  const facing = Math.max(ctx.bigBlind, ctx.currentBet || 0);
  const ratio = betSize / Math.max(1, facing);
  // Position and field size, exactly as decidePreflop scales them.
  const fieldBoost = clamp(1 + 0.30 * (4 - (ctx.liveOpp === undefined ? 4 : ctx.liveOpp)), 1, 2.1);
  const pm = Math.max(0.2, (ctx.posMult === undefined ? 1 : ctx.posMult) * fieldBoost);
  const posFactor = Math.pow(pm, posWeightOf(prof));
  // negative bias means they call more, so they keep more of their range
  const base = 0.62 * Math.pow(Math.max(1, ratio), -0.75) - contBias(prof, true) * 1.6;
  const keep = clamp(base * posFactor, 0.06, 0.98);
  const lo = state.rLo || 0, width = 1 - lo;
  if (width <= 0) return lo;
  const contin = Math.min(width, keep * width + 0.015);
  return clamp(1 - contin, 0, 0.995);
}

export function continueThresholdPost(state, prof, betSize, potSize, ctx) {
  const rep = projectedHeroRep(ctx.heroState, betSize, potSize);
  const need = betSize / (potSize + 2 * betSize);
  const s = rep.rBluff;
  const beatNeed = clamp((need - s) / Math.max(1e-6, 1 - s), 0, 1);
  const elastic = clamp(sizeSlopeOf(prof, false) * Math.log(1 + betSize / Math.max(1, potSize)), -0.40, 0.50);
  return clamp(rep.rLo + beatNeed * (1 - rep.rLo) * 0.55 + elastic + contBias(prof, false), 0, 0.995);
}

export function continueThreshold(state, prof, betSize, potSize, ctx) {
  return ctx.preflop
    ? continueThresholdPre(state, prof, betSize, ctx)
    : continueThresholdPost(state, prof, betSize, potSize, ctx);
}

/* ---- air ---- */

// Air is priced on APPETITE, not on card strength. The size still matters — a
// big raise folds out more air than a small one — but the floor is set by how
// willing this style is to keep bluffing, which is exactly the trait that made
// them show up with air in the first place.
export function airContinueRate(prof, betSize, potSize, preflop) {
  const persistence = airPersist(prof, !!preflop);
  const pressure = clamp(1 - 0.28 * Math.log(1 + betSize / Math.max(1, potSize)), 0.35, 1);
  return clamp(persistence * pressure, 0, 0.99);
}

/* ---- the response: fold / call / raise ---- */

const below = function (x, a, b) { return clamp((x - a) / Math.max(1e-6, b - a), 0, 1); };

// The share of everything they continue with that comes back over the top. Big
// bets get raised back less often in absolute terms, but a style that re-raises
// is a style that re-raises.
export function reRaiseShare(prof, betSize, potSize, preflop) {
  const base = reRaiseBase(prof, !!preflop);
  const pressure = clamp(1 - 0.22 * Math.log(1 + betSize / Math.max(1, potSize)), 0.45, 1);
  return clamp(base * pressure, 0, 0.8);
}

// Given a bet of B into P, what do they do? The three numbers sum to 1.
export function responseTo(state, prof, betSize, potSize, ctx) {
  const opts = ctx || {};
  const cx = {
    preflop: !!opts.preflop,
    bigBlind: opts.bigBlind || 20,
    currentBet: opts.currentBet || 0,
    heroState: opts.heroState || null,
    posMult: opts.posMult,
    liveOpp: opts.liveOpp,
  };
  const lo = state.rLo || 0;
  const bl = state.rBluff || 0;

  let valueFold;
  if (cx.preflop) {
    const width = 1 - lo;
    const contin = width <= 0 ? 0 : 1 - continueThresholdPre(state, prof, betSize, cx);
    valueFold = width <= 0 ? 0 : clamp(1 - contin / width, 0, 0.94);
  } else {
    valueFold = below(continueThresholdPost(state, prof, betSize, potSize, cx), lo, 1);
  }
  const airFold = 1 - airContinueRate(prof, betSize, potSize, cx.preflop);

  const fold = clamp((1 - bl) * valueFold + bl * airFold, 0, 0.98);
  const contin = 1 - fold;
  const raise = contin * reRaiseShare(prof, betSize, potSize, cx.preflop);
  return { fold: fold, call: contin - raise, raise: raise, continue: contin };
}

// Convenience for the many callers that only want the fold leg.
export function foldChance(state, prof, betSize, potSize, ctx) {
  return responseTo(state, prof, betSize, potSize, ctx).fold;
}

// Everyone folding is the product of each of them folding; anyone raising is
// one minus nobody raising. Both are needed to price a bet into a field.
export function jointResponse(reads) {
  if (!reads || !reads.length) return { fold: 0, call: 1, raise: 0, continue: 1 };
  let fold = 1, noRaise = 1;
  reads.forEach(function (r) {
    fold *= r.fold;
    noRaise *= (1 - r.raise);
  });
  const raise = 1 - noRaise;
  // A field cannot both all-fold and raise; the raise branch wins, since a raise
  // by anyone ends the "they all gave up" story.
  const capped = Math.min(fold, 1 - raise);
  return { fold: capped, call: Math.max(0, 1 - capped - raise), raise: raise, continue: 1 - capped };
}

/* ---- pricing ---- */

// P already holds the bet you are facing. Calling C wins P + C in total.
export function requiredEquity(toCall, potWithTheirBet) {
  if (toCall <= 0) return 0;
  const denom = potWithTheirBet + toCall;
  return denom > 0 ? toCall / denom : 0;
}

// A pure bluff of B into P breaks even when they fold this often.
export function breakEvenFold(bet, pot) {
  const denom = pot + bet;
  return denom > 0 ? bet / denom : 0;
}

export function evOfCall(e, P, C) { return e * P - (1 - e) * C; }

// EV of betting B into P against a response distribution. The raise branch is
// priced as hero forfeiting the B already put in — the conservative reading, and
// the one that stops a re-raise into a jamming opponent from looking free.
// A plain number is accepted for `resp` and read as "fold or call, never raise".
// A typical re-raise comes to about two and a half times the bet it is raising.
export const RERAISE_MULTIPLE = 2.5;
// A range that raises is stronger than one that merely calls, so hero's equity
// against it is lower. Applied to the already-conditional equity-if-called.
//
// Setting this to 0 makes the continue value worse than folding at every
// equity, which reproduces exactly the old "hero always folds to a re-raise"
// pricing — that is how the harness isolates this change from the others.
let raiseEquityFactor = 0.8;
export const RAISE_EQUITY_FACTOR = 0.8;
export function setRaiseEquityFactor(v) { const was = raiseEquityFactor; raiseEquityFactor = v; return was; }

// What the raise branch is actually worth. Hero is not obliged to fold to a
// re-raise — they still hold the option to continue, and take whichever is
// better. Pricing this branch as a flat forfeit of B was the conservative
// reading, and it is wrong in one direction: it makes every bet look worse than
// it is, which biases the coach away from aggression everywhere.
export function raiseBranchValue(e, P, B) {
  const R = RERAISE_MULTIPLE * B;
  const eVs = clamp((e === null || e === undefined ? 0 : e) * raiseEquityFactor, 0, 1);
  const evContinue = eVs * (P + R) - (1 - eVs) * R;
  return Math.max(-B, evContinue);
}

export function evOfBet(e, P, B, resp) {
  const r = (typeof resp === 'number') ? { fold: resp, call: 1 - resp, raise: 0 } : resp;
  return r.fold * P + r.call * (e * (P + B) - (1 - e) * B) + r.raise * raiseBranchValue(e, P, B);
}

export function evCallSe(P, C, eSe) { return (eSe == null) ? null : (P + C) * eSe; }

// The response estimate is the least reliable input in the model: a heuristic
// over a quantile range, not a measurement, and a bigger bet extrapolates it
// further from anything the opponent has actually shown.
export function foldSe(B, P) { return 0.03 + 0.03 * Math.min(2, B / Math.max(1, P)); }

export function evBetSe(P, B, resp, eSe, e) {
  const r = (typeof resp === 'number') ? { fold: resp, call: 1 - resp, raise: 0 } : resp;
  const fromE = (eSe == null) ? 0 : r.call * (P + 2 * B) * eSe;
  const called = (e == null) ? 0 : (e * (P + B) - (1 - e) * B);
  const fromF = Math.abs(P - called) * foldSe(B, P);
  const fromR = Math.abs(called + B) * foldSe(B, P) * r.raise;
  return Math.sqrt(fromE * fromE + fromF * fromF + fromR * fromR);
}

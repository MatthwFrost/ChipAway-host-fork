/* ============================================================
   BOT POLICY — what a bot does, as a pure function of the spot.

   Lifted out of the trainer closure without changing a single expression or
   the ORDER of random draws, so the app plays exactly as it did before. The
   point of the extraction is that the calibration harness can now ask the real
   decision function what it does, tens of thousands of times, headlessly.

   Each decide* returns a plain {action, target} and mutates nothing. The
   caller applies it — the app by animating it, the harness by just doing it.

   NOTE the short-circuit in the postflop check branch: `rng() < pBet ||
   rng() < bluff` draws ONCE when the first test passes. That is load-bearing
   for reproducibility and is preserved deliberately.
   ============================================================ */

const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
const sigmoid = function (x) { return 1 / (1 + Math.exp(-x)); };

export const POS_MULT = [1.35, 0.95, 1.12, 0.60, 0.78, 1.05];

// ctx: {prof, pct, liveOpp, posMult, pos, toCall, currentBet, minRaise,
//       bigBlind, streetRaises, raises, mayRaise, rng}
export function decidePreflop(ctx) {
  const prof = ctx.prof;
  const rng = ctx.rng;
  const BB = ctx.bigBlind;
  // as the field shrinks, both stealing and defending open up a lot
  const fieldBoost = clamp(1 + 0.30 * (4 - ctx.liveOpp), 1, 2.1);
  const pm = ctx.posMult * fieldBoost;
  const unopened = (ctx.streetRaises === 0);
  const w = prof.mixW;

  if (unopened) {
    const openThresh = 1 - clamp(prof.openPct * pm, 0.02, 0.94);
    if (ctx.raises < prof.maxRaises && rng() < sigmoid((ctx.pct - openThresh) / w)) {
      const open = Math.round(BB * (2.2 + rng() * 1.1));
      return { action: 'raise', target: Math.max(open, ctx.currentBet + ctx.minRaise) };
    }
    if (ctx.toCall <= 0) return { action: 'check' };
    // the small blind is getting 3:1 to complete, so it almost never folds a playable hand
    const oddsBoost = (ctx.pos === 1 && ctx.toCall < BB) ? 2.4 : 1;
    const limpThresh = 1 - clamp((prof.limpPct + prof.openPct * 0.6) * pm * oddsBoost, 0.02, 0.96);
    if (rng() < sigmoid((ctx.pct - limpThresh) / w)) return { action: 'call' };
    return { action: 'fold' };
  }

  const tbThresh = 1 - clamp(prof.threeBetPct * Math.max(1, fieldBoost * 0.8), 0.01, 0.6);
  if (ctx.raises < prof.maxRaises && ctx.streetRaises < 4 && ctx.mayRaise &&
      rng() < sigmoid((ctx.pct - tbThresh) / (w * 0.8))) {
    return { action: 'raise', target: Math.round(ctx.currentBet * (2.6 + rng() * 0.8)) };
  }
  if (ctx.toCall <= 0) return { action: 'check' };
  // the big blind already has money in, so it defends much wider
  const defBoost = (ctx.pos === 2) ? 1.4 : 1;
  const callThresh = 1 - clamp(prof.callPct * pm * defBoost, 0.02, 0.96);
  if (rng() < sigmoid((ctx.pct - callThresh) / w)) return { action: 'call' };
  return { action: 'fold' };
}

// ctx: {prof, strength, nRef, toCall, potNow, currentBet, bigBlind,
//       canRaise, rng}
export function decidePostflop(ctx) {
  const prof = ctx.prof;
  const rng = ctx.rng;
  const BB = ctx.bigBlind;
  const strength = ctx.strength;
  const nRef = Math.max(1, ctx.nRef);
  const fair = 1 / (nRef + 1), rel = strength / fair;
  const potOdds = ctx.toCall > 0 ? ctx.toCall / (ctx.potNow + ctx.toCall) : 0;
  const w = prof.mixR;
  let bluff = prof.bluffFreq / Math.max(1, nRef * 0.6);
  if (ctx.toCall > 0) bluff *= 0.4;
  const size = function (mult) { return Math.max(BB, Math.round(ctx.potNow * prof.sizing * mult)); };

  if (ctx.toCall <= 0) {
    const pBet = sigmoid((rel - prof.raiseRel) / w);
    if (ctx.canRaise && (rng() < pBet || rng() < bluff)) {
      const isBluff = strength < 0.35;
      return { action: 'bet', target: size(isBluff ? 1.15 : 0.85 + rng() * 0.4), isBluff: isBluff };
    }
    return { action: 'check' };
  }
  const pRaise = sigmoid((rel - prof.raiseRel) / w) * 0.65;
  if (ctx.canRaise && rng() < pRaise) {
    return { action: 'raise', target: Math.round(ctx.currentBet * (2.2 + rng() * 0.9)) };
  }
  // NOTE: this 0.055 is a hardcoded temperature where the betting branches use
  // prof.mixR. Preserved exactly as it was — the calibration harness measures
  // the consequence rather than the code quietly changing it.
  const pCall = sigmoid((strength - (potOdds + prof.callBuffer)) / 0.055);
  if (rng() < pCall) return { action: 'call' };
  if (ctx.canRaise && rng() < bluff * 0.5) return { action: 'raise', target: size(1.1) };
  return { action: 'fold' };
}

/* ============================================================
   COMPARE — did tuning the model actually help the advice?

   Runs the coach twice over the same hands: once with the parameters the model
   shipped with before it was fitted to the bots, once with the fitted ones.
   Identical deals, identical bots, identical everything but the model.

   Any other comparison is confounded. The bot baselines were improved at the
   same time as the model was tuned, so comparing "coach vs tag-bot before" with
   "coach vs tag-bot after" measures both changes at once and attributes them to
   neither.

     node src/harness/compare.js --hands=10000
   ============================================================ */

import { PROFILES, overrideModelParams, setRaiseEquityFactor } from '../engine/opponentModel.js';
import { setFutureWeights } from '../engine/future.js';
import { runBacktest } from './backtest.js';
import { runCalibration } from './calibration.js';

// The model as it stood before `npm run sim:tune` existed: one parameter set
// for both streets, hand-reasoned rather than fitted.
export const LEGACY_MODEL = {
  nit: { continueBias: 0.09, airPersistence: 0.10, reRaise: 0.06 },
  tag: { continueBias: 0.04, airPersistence: 0.30, reRaise: 0.14 },
  lag: { continueBias: -0.03, airPersistence: 0.55, reRaise: 0.24 },
  station: { continueBias: -0.17, airPersistence: 0.72, reRaise: 0.03 },
  maniac: { continueBias: -0.21, airPersistence: 0.80, reRaise: 0.42 },
};

// The first fit: separate preflop and postflop parameters, but fitted to the
// MARGINAL action mix rather than to the mix within each bet size, and with no
// size-slope freedom. Useful for isolating what the conditional refit bought.
export const MARGINAL_FIT_MODEL = {
  nit: { continueBias: 0, airPersistence: 0, reRaise: 0.26, continueBiasPre: 0.275, airPersistencePre: 0.1, reRaisePre: 0.48 },
  tag: { continueBias: -0.05, airPersistence: 0.475, reRaise: 0.36, continueBiasPre: 0.175, airPersistencePre: 0, reRaisePre: 0.62 },
  lag: { continueBias: -0.175, airPersistence: 0.564, reRaise: 0.36, continueBiasPre: 0.075, airPersistencePre: 0.594, reRaisePre: 0.64 },
  station: { continueBias: -0.525, airPersistence: 0.72, reRaise: 0.04, continueBiasPre: -0.025, airPersistencePre: 0.72, reRaisePre: 0.18 },
  maniac: { continueBias: -0.525, airPersistence: 0.772, reRaise: 0.22, continueBiasPre: -0.025, airPersistencePre: 0.98, reRaisePre: 0.6 },
};

// The conditional fit before a positional term existed in the preflop model.
// Isolates what adding position bought.
export const NO_POSITION_MODEL = {
  nit: { continueBias: -0.025, airPersistence: 0, reRaise: 0.24, sizeSlope: 0.125, continueBiasPre: 0.3, airPersistencePre: 0.1, reRaisePre: 0.78, sizeSlopePre: 0.15 },
  tag: { continueBias: -0.1, airPersistence: 0, reRaise: 0.34, sizeSlope: 0.1, continueBiasPre: 0.225, airPersistencePre: 0.98, reRaisePre: 0.78, sizeSlopePre: 0.15 },
  lag: { continueBias: -0.2, airPersistence: 0.386, reRaise: 0.32, sizeSlope: 0.1, continueBiasPre: 0.125, airPersistencePre: 0.98, reRaisePre: 0.78, sizeSlopePre: 0.15 },
  station: { continueBias: -0.55, airPersistence: 0.72, reRaise: 0.04, sizeSlope: 0.1, continueBiasPre: 0.05, airPersistencePre: 0.72, reRaisePre: 0.38, sizeSlopePre: 0.15 },
  maniac: { continueBias: -0.5, airPersistence: 0.98, reRaise: 0.22, sizeSlope: 0.325, continueBiasPre: -0.025, airPersistencePre: 0.98, reRaisePre: 0.66, sizeSlopePre: 0.15 },
};

// The parameters exactly as they are now, for isolating a non-parameter change.
export const CURRENT_MODEL = (function () {
  const out = {};
  Object.keys(PROFILES).forEach(function (k) {
    const p = PROFILES[k];
    out[k] = {
      continueBias: p.continueBias, airPersistence: p.airPersistence,
      reRaise: p.reRaise, sizeSlope: p.sizeSlope, posWeight: p.posWeight,
      continueBiasPre: p.continueBiasPre, airPersistencePre: p.airPersistencePre,
      reRaisePre: p.reRaisePre, sizeSlopePre: p.sizeSlopePre,
    };
  });
  return out;
})();
// Single-street pricing: no implied odds, no reverse implied odds, no barrel.
export const NO_FUTURE = { implied: 0, reverse: 0, barrel: 0 };
export const FUTURE_BASELINES = {
  none: NO_FUTURE,
  'no-implied': { implied: 0, reverse: 0 },
  'no-barrel': { barrel: 0 },
};

export const BASELINES = {
  legacy: LEGACY_MODEL,
  marginal: MARGINAL_FIT_MODEL,
  'no-position': NO_POSITION_MODEL,
  current: CURRENT_MODEL,
};

export function compare(options) {
  const o = options || {};
  const hands = o.hands || 10000;
  const seed = o.seed === undefined ? 20260916 : o.seed;
  const policies = o.policies || ['coach'];

  const tuned = {
    backtest: runBacktest({ hands: hands, seed: seed, policies: policies, keepPerHand: true }),
    calibration: runCalibration({ hands: Math.min(hands, 10000), seed: seed, postflopOnly: false }),
  };

  const restore = overrideModelParams(o.baseline || LEGACY_MODEL);
  // `raiseEquityFactor: 0` reproduces the old pricing where hero always folds
  // to a re-raise, so that change can be measured on its own.
  const restoreFactor = (o.baselineRaiseFactor === undefined)
    ? null : setRaiseEquityFactor(o.baselineRaiseFactor);
  // All-zero weights switch off implied odds, reverse implied odds and barrel
  // value at once, reproducing the single-street pricing exactly.
  const restoreFuture = o.baselineFuture ? setFutureWeights(o.baselineFuture) : null;
  let legacy;
  try {
    legacy = {
      backtest: runBacktest({ hands: hands, seed: seed, policies: policies, keepPerHand: true }),
      calibration: runCalibration({ hands: Math.min(hands, 10000), seed: seed, postflopOnly: false }),
    };
  } finally {
    restore();
    if (restoreFactor !== null) setRaiseEquityFactor(restoreFactor);
    if (restoreFuture) setFutureWeights(restoreFuture);
  }

  // Paired on hand index: both models saw the same deal for hand N, so the
  // difference is the model's doing and most of the card luck cancels.
  const paired = {};
  policies.forEach(function (name) {
    const a = tuned.backtest.results.filter(function (r) { return r.policy === name; })[0];
    const b = legacy.backtest.results.filter(function (r) { return r.policy === name; })[0];
    if (!a || !b) return;
    const n = Math.min(a.perHand.length, b.perHand.length);
    let sum = 0;
    const d = new Array(n);
    for (let i = 0; i < n; i++) { d[i] = a.perHand[i] - b.perHand[i]; sum += d[i]; }
    const mean = sum / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (d[i] - mean) * (d[i] - mean);
    const se = Math.sqrt(v / Math.max(1, n - 1)) / Math.sqrt(n);
    paired[name] = { bb100: 100 * mean / 20, bb100se: 100 * se / 20, z: se > 0 ? mean / se : 0, n: n };
  });
  [tuned, legacy].forEach(function (run) {
    run.backtest.results.forEach(function (r) { delete r.perHand; });
  });
  return { hands: hands, seed: seed, legacy: legacy, tuned: tuned, paired: paired };
}

export function formatCompare(c) {
  const get = function (run, name) {
    return run.backtest.results.filter(function (r) { return r.policy === name; })[0];
  };
  const lines = [];
  lines.push('');
  lines.push('  BEFORE / AFTER — the same ' + c.hands.toLocaleString() + ' hands, seed ' + c.seed + ',');
  lines.push('  identical bots and deals. The only thing that changes is the model.');
  lines.push('');
  lines.push('  CALIBRATION (total variation distance, lower is better)');
  lines.push('  ' + 'profile'.padEnd(10) + 'before'.padStart(9) + 'after'.padStart(9) + '   fold gap before / after');
  lines.push('  ' + '-'.repeat(62));
  ['nit', 'tag', 'lag', 'station', 'maniac'].forEach(function (k) {
    const b = c.legacy.calibration.profiles[k], a = c.tuned.calibration.profiles[k];
    if (!b || !a) return;
    lines.push('  ' + k.padEnd(10) +
      (100 * b.tvd).toFixed(1).padStart(9) + (100 * a.tvd).toFixed(1).padStart(9) +
      ('   ' + (b.error.fold >= 0 ? '+' : '') + (100 * b.error.fold).toFixed(1) +
        '  ->  ' + (a.error.fold >= 0 ? '+' : '') + (100 * a.error.fold).toFixed(1)).padStart(26));
  });
  lines.push('');
  lines.push('  ADVICE (bb/100, higher is better)');
  lines.push('  ' + 'policy'.padEnd(14) + 'before'.padStart(11) + 'after'.padStart(11) +
    'change'.padStart(11) + '± se'.padStart(10) + 'z'.padStart(7) + '   verdict');
  lines.push('  ' + '-'.repeat(78));
  c.tuned.backtest.results.forEach(function (r) {
    const b = get(c.legacy, r.policy);
    if (!b) return;
    const p = c.paired[r.policy];
    const verdict = !p ? '' : (Math.abs(p.z) < 2 ? 'not measurable'
      : (p.z > 0 ? 'tuning helped' : 'TUNING HURT'));
    lines.push('  ' + r.policy.padEnd(14) +
      b.bb100.toFixed(2).padStart(11) + r.bb100.toFixed(2).padStart(11) +
      (p ? ((p.bb100 >= 0 ? '+' : '') + p.bb100.toFixed(2)) : '—').padStart(11) +
      (p ? ('±' + p.bb100se.toFixed(2)) : '').padStart(10) +
      (p ? p.z.toFixed(1) : '').padStart(7) + '   ' + verdict);
  });
  lines.push('');
  return lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('compare.js')) {
  const argv = process.argv.slice(2);
  const arg = function (n, d) {
    const hit = argv.filter(function (a) { return a.indexOf('--' + n + '=') === 0; })[0];
    return hit === undefined ? d : hit.split('=')[1];
  };
  const c = compare({
    hands: parseInt(arg('hands', '10000'), 10),
    seed: parseInt(arg('seed', '20260916'), 10),
    policies: arg('policies', 'coach').split(','),
    baseline: BASELINES[arg('baseline', 'legacy')] || LEGACY_MODEL,
    baselineRaiseFactor: arg('raise-factor', undefined) === undefined
      ? undefined : parseFloat(arg('raise-factor', '0')),
    baselineFuture: FUTURE_BASELINES[arg('future', '')],
  });
  console.log(formatCompare(c));
}

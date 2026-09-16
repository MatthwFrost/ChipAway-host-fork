/* ============================================================
   TUNE — fit the prediction model to what the bots actually do.

   The calibration harness records every decision a bot made facing a bet. This
   re-scores those SAME recorded decisions under different model parameters, so
   a sweep of thousands of candidate settings costs no simulation at all — the
   expensive part happened once.

   Only model-side parameters are touched:

     continueBias     how much range they keep beyond what the price justifies
     airPersistence   share of their air that keeps firing
     reRaise          share of continues that come back over the top

   `callBuffer`, `sigRaise`, `polar`, `bluffFreq` and everything else the BOTS
   read are left alone. Tuning those would move the ground truth instead of
   fitting it, which is circular.

     node src/harness/tune.js --hands=20000
   ============================================================ */

import { PROFILES, PROFILE_KEYS, responseTo } from '../engine/opponentModel.js';
import { runCalibration } from './calibration.js';

// Expected TVD *within* bet-size buckets. Minimising the marginal TVD lets a
// model be right on average and wrong at every size — which is what a fit to
// the aggregate produced: TVD near 1 overall, but 8-18 points out inside the
// individual size buckets. This objective cannot be satisfied that way.
export function scoreConditional(records, prof) {
  const groups = {};
  for (let i = 0; i < records.length; i++) {
    const b = records[i].bucket || 'all';
    (groups[b] = groups[b] || []).push(records[i]);
  }
  let total = 0, n = 0, worst = 0;
  Object.keys(groups).forEach(function (b) {
    const g = groups[b];
    // Buckets too thin to measure are ignored rather than fitted to noise.
    if (g.length < 60) return;
    const s = scoreRecords(g, prof);
    total += s.tvd * g.length;
    n += g.length;
    if (s.tvd > worst) worst = s.tvd;
  });
  if (!n) return scoreRecords(records, prof);
  const overall = scoreRecords(records, prof);
  return { tvd: total / n, marginal: overall.tvd, worstBucket: worst, n: n };
}

// Total variation distance between predicted and actual action mixes over a
// set of recorded decisions, under a candidate parameter set.
export function scoreRecords(records, prof) {
  if (!records.length) return { tvd: 1, n: 0 };
  const pred = { fold: 0, call: 0, raise: 0 };
  const act = { fold: 0, call: 0, raise: 0 };
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const p = responseTo(r.state, prof, r.betSize, r.potSize, {
      preflop: r.preflop, bigBlind: 20, currentBet: r.currentBet, heroState: r.heroState,
      posMult: r.posMult, liveOpp: r.liveOpp,
    });
    pred.fold += p.fold; pred.call += p.call; pred.raise += p.raise;
    act[r.actual]++;
  }
  const n = records.length;
  const tvd = 0.5 * (Math.abs(pred.fold - act.fold) + Math.abs(pred.call - act.call) +
    Math.abs(pred.raise - act.raise)) / n;
  return {
    tvd: tvd, n: n,
    predicted: { fold: pred.fold / n, call: pred.call / n, raise: pred.raise / n },
    actual: { fold: act.fold / n, call: act.call / n, raise: act.raise / n },
  };
}

const GRIDS = {
  continueBias: { lo: -0.85, hi: 0.60, steps: 59 },
  airPersistence: { lo: 0.0, hi: 0.98, steps: 34 },
  reRaise: { lo: 0.0, hi: 0.78, steps: 40 },
  sizeSlope: { lo: -0.40, hi: 0.50, steps: 37 },
  posWeight: { lo: 0, hi: 1.6, steps: 33 },
};
const FIELDS = ['continueBias', 'airPersistence', 'reRaise', 'sizeSlope', 'posWeight'];

// A parameter only counts as fitted if moving it across its whole range
// actually changes the answer. A profile that holds no air tells you nothing
// about airPersistence, and a sweep left to its own devices will happily park
// such a parameter at a grid edge and report it as a finding.
const IDENTIFIABLE = 0.004;   // 0.4 points of TVD across the full range

function sweep(records, base, field) {
  const g = GRIDS[field];
  const at = function (v) {
    const cand = Object.assign({}, base);
    cand[field] = v;
    return scoreConditional(records, cand).tvd;
  };
  let best = { v: base[field], tvd: at(base[field]) };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < g.steps; i++) {
    const v = g.lo + (g.hi - g.lo) * (i / (g.steps - 1));
    const s = at(v);
    if (s < lo) lo = s;
    if (s > hi) hi = s;
    if (s < best.tvd - 1e-9) best = { v: v, tvd: s };
  }
  return { v: best.v, tvd: best.tvd, identified: (hi - lo) >= IDENTIFIABLE };
}

// Coordinate descent. Three parameters, one clear objective, and a surface
// smooth enough that repeated passes settle quickly.
export function fitProfile(records, startProf, passes) {
  const prof = Object.assign({}, startProf);
  const identified = {};
  for (let pass = 0; pass < (passes || 6); pass++) {
    let moved = false;
    FIELDS.forEach(function (f) {
      const b = sweep(records, prof, f);
      identified[f] = b.identified;
      if (!b.identified) return;          // leave it where it was
      if (Math.abs(b.v - prof[f]) > 1e-9) { prof[f] = b.v; moved = true; }
    });
    if (!moved) break;
  }
  return { prof: prof, score: scoreConditional(records, prof), identified: identified };
}

const round = function (x, dp) { const m = Math.pow(10, dp); return Math.round(x * m) / m; };

export function tune(options) {
  const o = options || {};
  const hands = o.hands || 20000;
  const seed = o.seed === undefined ? 20260916 : o.seed;

  // Record every decision once, preflop and postflop both.
  const run = runCalibration({ hands: hands, seed: seed, postflopOnly: false, collectRecords: true });

  const out = { hands: hands, seed: seed, profiles: {} };
  PROFILE_KEYS.forEach(function (key) {
    const all = run.records.filter(function (r) { return r.profile === key; });
    const entry = { n: all.length, regimes: {} };

    // Each regime is fitted on its own decisions. The preflop fields are
    // written as *Pre and read only when the model is asked about preflop.
    [['postflop', false], ['preflop', true]].forEach(function (pair) {
      const name = pair[0], isPre = pair[1];
      const recs = all.filter(function (r) { return r.preflop === isPre; });
      if (!recs.length) return;
      // The candidate always carries the regime's values in the BASE fields and
      // never the *Pre ones. Leaving continueBiasPre in place while sweeping
      // continueBias means the model keeps reading the field the sweep is not
      // touching, and every preflop parameter comes back "not identified".
      const start = Object.assign({}, PROFILES[key]);
      delete start.continueBiasPre;
      delete start.airPersistencePre;
      delete start.reRaisePre;
      delete start.sizeSlopePre;
      start.continueBias = contOf(PROFILES[key], isPre);
      start.airPersistence = airOf(PROFILES[key], isPre);
      start.reRaise = rrOf(PROFILES[key], isPre);
      start.sizeSlope = ssOf(PROFILES[key], isPre);
      start.posWeight = PROFILES[key].posWeight === undefined ? 0 : PROFILES[key].posWeight;
      const before = scoreConditional(recs, startFor(PROFILES[key], isPre));
      const fit = fitProfile(recs, start, o.passes || 6);
      entry.regimes[name] = {
        n: recs.length,
        before: before,
        after: scoreConditional(recs, asRegime(fit.prof, isPre)),
        identified: fit.identified,
        tuned: {
          continueBias: round(fit.prof.continueBias, 3),
          airPersistence: round(fit.prof.airPersistence, 3),
          reRaise: round(fit.prof.reRaise, 3),
          sizeSlope: round(fit.prof.sizeSlope, 3),
          posWeight: round(fit.prof.posWeight, 3),
        },
        was: {
          continueBias: round(contOf(PROFILES[key], isPre), 3),
          airPersistence: round(airOf(PROFILES[key], isPre), 3),
          reRaise: round(rrOf(PROFILES[key], isPre), 3),
          sizeSlope: round(ssOf(PROFILES[key], isPre), 3),
          posWeight: round(PROFILES[key].posWeight === undefined ? 0 : PROFILES[key].posWeight, 3),
        },
      };
    });
    out.profiles[key] = entry;
  });
  return out;
}

// Helpers mirroring opponentModel's pre/post fallback, so "before" is scored
// against exactly what the model would have used.
function contOf(p, pre) {
  if (pre && p.continueBiasPre !== undefined) return p.continueBiasPre;
  return p.continueBias === undefined ? (p.callBuffer || 0) : p.continueBias;
}
function airOf(p, pre) {
  if (pre && p.airPersistencePre !== undefined) return p.airPersistencePre;
  return p.airPersistence === undefined ? 0.30 : p.airPersistence;
}
function rrOf(p, pre) {
  if (pre && p.reRaisePre !== undefined) return p.reRaisePre;
  return p.reRaise === undefined ? 0.10 : p.reRaise;
}
function ssOf(p, pre) {
  if (pre && p.sizeSlopePre !== undefined) return p.sizeSlopePre;
  return p.sizeSlope === undefined ? 0.15 : p.sizeSlope;
}
// Present a candidate parameter set as the regime being fitted, so scoring a
// preflop fit does not accidentally read the postflop fields.
function asRegime(prof, isPre) {
  const c = Object.assign({}, prof);
  delete c.continueBiasPre;
  delete c.airPersistencePre;
  delete c.reRaisePre;
  delete c.sizeSlopePre;
  return c;
}
function startFor(p, isPre) {
  return {
    continueBias: contOf(p, isPre), airPersistence: airOf(p, isPre),
    reRaise: rrOf(p, isPre), sizeSlope: ssOf(p, isPre),
  };
}

export function formatTune(t) {
  const pc = function (x) { return (100 * x).toFixed(1).padStart(5); };
  const lines = [];
  lines.push('');
  lines.push('  PARAMETER FIT — ' + t.hands.toLocaleString() + ' hands, seed ' + t.seed);
  lines.push('  Model-side parameters only. callBuffer, sigRaise, polar and bluffFreq are');
  lines.push('  what the BOTS read and are left untouched — tuning those would move the');
  lines.push('  ground truth instead of fitting it.');
  ['postflop', 'preflop'].forEach(function (regime) {
    lines.push('');
    lines.push('  ' + regime.toUpperCase());
    lines.push('  ' + 'profile'.padEnd(9) + 'n'.padStart(7) + 'cTVD before'.padStart(13) + 'cTVD after'.padStart(12) +
      'worst'.padStart(8) + '   continueBias' + '     airPersistence' + '          reRaise' + '       sizeSlope' + '      posWeight');
    lines.push('  ' + '-'.repeat(132));
    PROFILE_KEYS.forEach(function (k) {
      const r = t.profiles[k] && t.profiles[k].regimes[regime];
      if (!r) return;
      const mark = function (f) { return r.identified[f] ? '' : '*'; };
      lines.push('  ' + k.padEnd(9) + String(r.n).padStart(7) +
        pc(r.before.tvd).padStart(13) + pc(r.after.tvd).padStart(12) +
        pc(r.after.worstBucket === undefined ? 0 : r.after.worstBucket).padStart(8) + '   ' +
        (String(r.was.continueBias) + '->' + r.tuned.continueBias + mark('continueBias')).padEnd(18) +
        (String(r.was.airPersistence) + '->' + r.tuned.airPersistence + mark('airPersistence')).padEnd(18) +
        (String(r.was.reRaise) + '->' + r.tuned.reRaise + mark('reRaise')).padEnd(17) +
        (String(r.was.sizeSlope) + '->' + r.tuned.sizeSlope + mark('sizeSlope')).padEnd(16) +
        (String(r.was.posWeight) + '->' + r.tuned.posWeight + mark('posWeight')));
    });
  });
  lines.push('');
  lines.push('  cTVD = expected TVD *within* bet-size buckets, which is the objective. "worst"');
  lines.push('  is the single worst bucket. A model can have near-zero marginal TVD while every');
  lines.push('  bucket is badly wrong, so the marginal figure is not what is minimised here.');
  lines.push('  * = not identified by the data (moving it across its whole range changes the');
  lines.push('    objective by under 0.4 points), so it was left alone rather than fitted to noise.');
  lines.push('');
  lines.push('  Values for PROFILES in src/engine/opponentModel.js:');
  lines.push('');
  PROFILE_KEYS.forEach(function (k) {
    const e = t.profiles[k];
    if (!e) return;
    const post = e.regimes.postflop, pre = e.regimes.preflop;
    lines.push('    ' + k + ':');
    if (post) {
      lines.push('      continueBias: ' + post.tuned.continueBias +
        ', airPersistence: ' + post.tuned.airPersistence + ', reRaise: ' + post.tuned.reRaise +
        ', sizeSlope: ' + post.tuned.sizeSlope + ',');
    }
    if (pre) {
      lines.push('      continueBiasPre: ' + pre.tuned.continueBias +
        ', airPersistencePre: ' + pre.tuned.airPersistence + ', reRaisePre: ' + pre.tuned.reRaise +
        ', sizeSlopePre: ' + pre.tuned.sizeSlope + ',');
      lines.push('      posWeight: ' + pre.tuned.posWeight + ',   // preflop only');
    }
  });
  lines.push('');
  return lines.join('\n');
}

// Run directly: node src/harness/tune.js --hands=20000
if (process.argv[1] && process.argv[1].endsWith('tune.js')) {
  const argv = process.argv.slice(2);
  const arg = function (n, d) {
    const hit = argv.filter(function (a) { return a.indexOf('--' + n + '=') === 0; })[0];
    return hit === undefined ? d : hit.split('=')[1];
  };
  const t = tune({ hands: parseInt(arg('hands', '20000'), 10), seed: parseInt(arg('seed', '20260916'), 10) });
  console.log(formatTune(t));
}

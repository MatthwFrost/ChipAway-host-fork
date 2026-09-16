/* ============================================================
   SWEEP — try several settings of a model coefficient over the same hands.

   compare.js answers "is A better than B". This answers "which value of this
   knob is best", which is what you want once a change has an obvious direction
   but no obvious magnitude. Every candidate plays the identical deals and is
   paired against the first, so the differences are the knob's doing.

     node src/harness/sweep.js --hands=5000 --field=barrel --values=0,0.1,0.2,0.35
   ============================================================ */

import { resetFutureWeights, setFutureWeights } from '../engine/future.js';
import { runBacktest } from './backtest.js';

const BB = 20;

export function sweep(options) {
  const o = options || {};
  const hands = o.hands || 5000;
  const seed = o.seed === undefined ? 20260916 : o.seed;
  const field = o.field || 'barrel';
  const values = o.values || [0, 0.1, 0.2, 0.35];
  const fixed = o.fixed || {};

  const runs = values.map(function (v) {
    const weights = Object.assign({}, fixed);
    weights[field] = v;
    const restore = setFutureWeights(weights);
    let out;
    try {
      out = runBacktest({ hands: hands, seed: seed, policies: ['coach'], keepPerHand: true });
    } finally {
      setFutureWeights(restore);
    }
    const r = out.results[0];
    return { value: v, bb100: r.bb100, perHand: r.perHand };
  });
  resetFutureWeights();

  // Paired against the first candidate, on the same hand indices.
  const ref = runs[0];
  runs.forEach(function (r) {
    if (r === ref) { r.vsRef = { bb100: 0, bb100se: 0, z: 0 }; return; }
    const n = Math.min(ref.perHand.length, r.perHand.length);
    let sum = 0;
    const d = new Array(n);
    for (let i = 0; i < n; i++) { d[i] = r.perHand[i] - ref.perHand[i]; sum += d[i]; }
    const mean = sum / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (d[i] - mean) * (d[i] - mean);
    const se = Math.sqrt(v / Math.max(1, n - 1)) / Math.sqrt(n);
    r.vsRef = { bb100: 100 * mean / BB, bb100se: 100 * se / BB, z: se > 0 ? mean / se : 0 };
  });
  runs.forEach(function (r) { delete r.perHand; });
  return { hands: hands, seed: seed, field: field, fixed: fixed, runs: runs };
}

export function formatSweep(s) {
  const lines = [];
  lines.push('');
  lines.push('  SWEEP — ' + s.field + ' over ' + s.hands.toLocaleString() + ' hands, seed ' + s.seed);
  const fixedKeys = Object.keys(s.fixed);
  if (fixedKeys.length) {
    lines.push('  holding ' + fixedKeys.map(function (k) { return k + '=' + s.fixed[k]; }).join(', '));
  }
  lines.push('');
  lines.push('  ' + s.field.padEnd(10) + 'bb/100'.padStart(11) + 'vs first'.padStart(12) + '± se'.padStart(10) + 'z'.padStart(7));
  lines.push('  ' + '-'.repeat(50));
  s.runs.forEach(function (r) {
    lines.push('  ' + String(r.value).padEnd(10) + r.bb100.toFixed(2).padStart(11) +
      ((r.vsRef.bb100 >= 0 ? '+' : '') + r.vsRef.bb100.toFixed(2)).padStart(12) +
      ('±' + r.vsRef.bb100se.toFixed(2)).padStart(10) + r.vsRef.z.toFixed(1).padStart(7));
  });
  const best = s.runs.slice().sort(function (a, b) { return b.bb100 - a.bb100; })[0];
  lines.push('');
  lines.push('  best on this sample: ' + s.field + ' = ' + best.value + ' at ' + best.bb100.toFixed(2) + ' bb/100');
  lines.push('  (differences under ~2 standard errors are not real; prefer the simpler value)');
  lines.push('');
  return lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('sweep.js')) {
  const argv = process.argv.slice(2);
  const arg = function (n, d) {
    const hit = argv.filter(function (a) { return a.indexOf('--' + n + '=') === 0; })[0];
    return hit === undefined ? d : hit.split('=')[1];
  };
  const fixed = {};
  (arg('fixed', '') || '').split(',').filter(Boolean).forEach(function (kv) {
    const bits = kv.split(':');
    fixed[bits[0]] = parseFloat(bits[1]);
  });
  const s = sweep({
    hands: parseInt(arg('hands', '5000'), 10),
    seed: parseInt(arg('seed', '20260916'), 10),
    field: arg('field', 'barrel'),
    values: arg('values', '0,0.1,0.2,0.35').split(',').map(parseFloat),
    fixed: fixed,
  });
  console.log(formatSweep(s));
}

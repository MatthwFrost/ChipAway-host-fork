#!/usr/bin/env node
/* ============================================================
   CLI entry point for both harnesses.

     npm run sim               both, 10,000 hands
     npm run sim:calibrate     calibration only
     npm run sim:backtest      backtest only
     npm run sim:tune          re-fit the model parameters to the bots

   Arguments (all optional, after a `--`):
     --hands=50000     how many hands to play
     --seed=7          change the deal
     --policies=a,b    which policies to compare
     --preflop         calibrate preflop decisions instead of postflop
     --all-streets     calibrate both
     --json            machine-readable output instead of tables
   ============================================================ */

import { formatCalibration, runCalibration } from './calibration.js';
import { formatBacktest, runBacktest } from './backtest.js';
import { formatTune, tune } from './tune.js';

const argv = process.argv.slice(2);
const arg = function (name, dflt) {
  const hit = argv.filter(function (a) { return a.indexOf('--' + name + '=') === 0; })[0];
  return hit === undefined ? dflt : hit.split('=').slice(1).join('=');
};
const has = function (name) { return argv.indexOf('--' + name) >= 0; };

const which = argv.filter(function (a) { return a.indexOf('--') !== 0; })[0] || 'all';
const hands = parseInt(arg('hands', '10000'), 10);
const seed = parseInt(arg('seed', '20260916'), 10);
const json = has('json');

if (!isFinite(hands) || hands < 1) {
  console.error('--hands must be a positive integer');
  process.exit(1);
}

const t0 = Date.now();
const output = {};

if (which === 'tune') {
  const t = tune({ hands: hands, seed: seed });
  output.tune = t;
  if (!json) console.log(formatTune(t));
}

if (which === 'all' || which === 'calibrate') {
  const r = runCalibration({
    hands: hands, seed: seed,
    postflopOnly: !(has('preflop') || has('all-streets')),
    preflopOnly: has('preflop'),
  });
  output.calibration = r;
  if (!json) console.log(formatCalibration(r));
}

if (which === 'all' || which === 'backtest') {
  const policies = arg('policies', '');
  const r = runBacktest({
    hands: hands, seed: seed,
    policies: policies ? policies.split(',') : undefined,
  });
  output.backtest = r;
  if (!json) console.log(formatBacktest(r));
}

if (json) console.log(JSON.stringify(output, null, 2));
else console.log('  done in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's\n');

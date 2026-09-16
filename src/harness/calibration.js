/* ============================================================
   CALIBRATION — does the model predict what the bots actually do?

   The app contains two independent claims about the same event:

     opponentModel.responseTo()  PREDICTS  fold / call / raise
     botPolicy.decidePostflop()  PERFORMS  fold / call / raise

   The coach's every number rests on the first. The game the player actually
   sits at is the second. If they disagree, the advice is describing a table
   that is not the one in front of them — and until now nothing checked.

   This plays N hands, and every time a bot faces a bet it records what the
   model said would happen alongside what happened. Bucketed by profile and by
   bet size, the two should line up.
   ============================================================ */

import { createTable } from '../engine/table.js';
import { PROFILES, responseTo } from '../engine/opponentModel.js';
import { makeRng } from '../engine/rng.js';

// Bet-size buckets, as a fraction of the pot being faced.
const SIZE_BUCKETS = [
  { key: 'tiny', lo: 0, hi: 0.35 },
  { key: 'small', lo: 0.35, hi: 0.6 },
  { key: 'medium', lo: 0.6, hi: 0.9 },
  { key: 'large', lo: 0.9, hi: 1.5 },
  { key: 'huge', lo: 1.5, hi: Infinity },
];

function bucketFor(ratio) {
  for (let i = 0; i < SIZE_BUCKETS.length; i++) {
    if (ratio >= SIZE_BUCKETS[i].lo && ratio < SIZE_BUCKETS[i].hi) return SIZE_BUCKETS[i].key;
  }
  return 'huge';
}

const emptyCell = function () {
  return { n: 0, actual: { fold: 0, call: 0, raise: 0 }, predicted: { fold: 0, call: 0, raise: 0 } };
};

export function runCalibration(options) {
  const o = options || {};
  const hands = o.hands || 10000;
  const seed = o.seed === undefined ? 20260916 : o.seed;
  const seats = o.seats || ['nit', 'tag', 'lag', 'station', 'maniac'];
  const postflopOnly = o.postflopOnly !== false;

  const cells = {};          // profile|regime|bucket -> cell
  const byProfile = {};      // profile -> cell
  const byStreet = {};       // 'preflop' | 'postflop' -> profile -> cell
  const records = [];        // raw decisions, for the parameter tuner
  let samples = 0;

  const key = function (prof, regime, bucket) { return prof + '|' + regime + '|' + bucket; };

  const onDecision = function (d) {
    const p = d.player;
    if (p.isHero || !p.profile) return;
    if (d.toCall <= 0) return;                 // only decisions facing a bet
    if (postflopOnly && d.street === 0) return;
    if (o.preflopOnly && d.street !== 0) return;

    const prof = PROFILES[p.profile];
    // `pot` is the pot INCLUDING the bet being faced, so the bet-to-pot ratio a
    // player is actually being offered is toCall over the pot before it.
    const ratio = d.toCall / Math.max(1, d.pot - d.toCall);
    const bucket = bucketFor(ratio);

    // The model's prediction for THIS player facing THIS bet. The aggressor's
    // shown range is handed in as the bettor's representation, which is what
    // continueThreshold expects.
    const pred = responseTo(p, prof, d.toCall, d.pot, {
      preflop: d.street === 0,
      bigBlind: 20,
      currentBet: d.currentBet,
      heroState: d.aggressor || { rLo: 0, rBluff: 0 },
      posMult: d.posMult,
      liveOpp: d.liveOpp,
    });

    const act = (d.action === 'bet' || d.action === 'raise') ? 'raise'
      : (d.action === 'call' ? 'call' : 'fold');

    const streetKey = d.street === 0 ? 'preflop' : 'postflop';
    const k = key(p.profile, streetKey, bucket);
    if (!cells[k]) cells[k] = emptyCell();
    if (!byProfile[p.profile]) byProfile[p.profile] = emptyCell();
    if (!byStreet[streetKey]) byStreet[streetKey] = {};
    if (!byStreet[streetKey][p.profile]) byStreet[streetKey][p.profile] = emptyCell();
    [cells[k], byProfile[p.profile], byStreet[streetKey][p.profile]].forEach(function (c) {
      c.n++;
      c.actual[act]++;
      c.predicted.fold += pred.fold;
      c.predicted.call += pred.call;
      c.predicted.raise += pred.raise;
    });
    samples++;

    // The tuner re-scores these same decisions under different model
    // parameters, so a parameter sweep costs no simulation at all. The range
    // state has to be snapshotted because the live objects keep mutating.
    if (o.collectRecords) {
      records.push({
        profile: p.profile,
        bucket: bucket,
        state: { rLo: p.rLo || 0, rBluff: p.rBluff || 0 },
        betSize: d.toCall, potSize: d.pot,
        preflop: d.street === 0, currentBet: d.currentBet,
        heroState: d.aggressor ? { rLo: d.aggressor.rLo || 0, rBluff: d.aggressor.rBluff || 0 } : { rLo: 0, rBluff: 0 },
        posMult: d.posMult, liveOpp: d.liveOpp,
        actual: act,
      });
    }
  };

  const table = createTable({
    rng: makeRng(seed), seats: seats, heroPolicy: null, onDecision: onDecision,
    botTrials: o.botTrials || 170,
  });

  for (let i = 0; i < hands; i++) table.playHand();

  const finish = function (c) {
    if (!c.n) return null;
    const a = { fold: c.actual.fold / c.n, call: c.actual.call / c.n, raise: c.actual.raise / c.n };
    const p = { fold: c.predicted.fold / c.n, call: c.predicted.call / c.n, raise: c.predicted.raise / c.n };
    return {
      n: c.n, actual: a, predicted: p,
      error: { fold: p.fold - a.fold, call: p.call - a.call, raise: p.raise - a.raise },
      // Total variation distance: half the sum of absolute differences. 0 = perfect,
      // 1 = the model and the table have nothing in common.
      tvd: 0.5 * (Math.abs(p.fold - a.fold) + Math.abs(p.call - a.call) + Math.abs(p.raise - a.raise)),
      // Binomial standard error on the actual fold rate, so a gap can be judged
      // against the noise in the measurement rather than eyeballed.
      se: Math.sqrt(Math.max(1e-9, a.fold * (1 - a.fold)) / c.n),
    };
  };

  const profiles = {};
  Object.keys(byProfile).forEach(function (k) { profiles[k] = finish(byProfile[k]); });
  const buckets = {};
  Object.keys(cells).forEach(function (k) { buckets[k] = finish(cells[k]); });

  // Expected TVD *within* bet-size buckets. A model can sit at a marginal TVD
  // near zero while being 15 points out at every individual size, and it is the
  // conditional figure that tracks whether the advice is any good — measured at
  // +50 bb/100 for the refit that improved this while making the marginal
  // number worse.
  Object.keys(profiles).forEach(function (k) {
    let tot = 0, n = 0, worst = 0;
    Object.keys(buckets).forEach(function (bk) {
      if (bk.indexOf(k + '|') !== 0) return;
      const c = buckets[bk];
      if (!c || c.n < 60) return;
      tot += c.tvd * c.n; n += c.n;
      if (c.tvd > worst) worst = c.tvd;
    });
    profiles[k].cTvd = n ? tot / n : profiles[k].tvd;
    profiles[k].worstBucket = worst;
  });

  const streets = {};
  Object.keys(byStreet).forEach(function (sk) {
    streets[sk] = {};
    Object.keys(byStreet[sk]).forEach(function (k) { streets[sk][k] = finish(byStreet[sk][k]); });
  });

  return {
    hands: hands, seed: seed, samples: samples,
    profiles: profiles, buckets: buckets, streets: streets,
    bucketKeys: SIZE_BUCKETS.map(function (b) { return b.key; }),
    seats: seats, records: records,
  };
}

/* ---- reporting ---- */

const pc = function (x) { return (100 * x).toFixed(1).padStart(5); };
const sgn = function (x) { return (x >= 0 ? '+' : '') + (100 * x).toFixed(1).padStart(5); };

export function formatCalibration(r) {
  const out = [];
  out.push('');
  out.push('  CALIBRATION — model prediction vs what the bots actually did');
  out.push('  ' + r.hands.toLocaleString() + ' hands · seed ' + r.seed + ' · ' + r.samples.toLocaleString() + ' decisions facing a bet');
  out.push('');
  out.push('  ' + 'profile'.padEnd(9) + 'n'.padStart(7) +
    '   fold: model / real  gap' + '   call: model / real  gap' + '   raise: model / real  gap' +
    '    TVD' + '   cTVD' + '  worst');
  out.push('  ' + '-'.repeat(124));
  const order = ['nit', 'tag', 'lag', 'station', 'maniac'];
  order.forEach(function (k) {
    const c = r.profiles[k];
    if (!c) return;
    out.push('  ' + k.padEnd(9) + String(c.n).padStart(7) +
      '      ' + pc(c.predicted.fold) + ' /' + pc(c.actual.fold) + ' ' + sgn(c.error.fold) +
      '      ' + pc(c.predicted.call) + ' /' + pc(c.actual.call) + ' ' + sgn(c.error.call) +
      '       ' + pc(c.predicted.raise) + ' /' + pc(c.actual.raise) + ' ' + sgn(c.error.raise) +
      '   ' + (100 * c.tvd).toFixed(1).padStart(5) +
      '  ' + (100 * (c.cTvd === undefined ? c.tvd : c.cTvd)).toFixed(1).padStart(5) +
      '  ' + (100 * (c.worstBucket || 0)).toFixed(1).padStart(5));
  });
  out.push('');
  const bucketTable = function (regime) {
    const rows = [];
    let any = false;
    order.forEach(function (k) {
      let line = '  ' + k.padEnd(9);
      r.bucketKeys.forEach(function (b) {
        const c = r.buckets[k + '|' + regime + '|' + b];
        if (c) any = true;
        line += c
          ? (pc(c.predicted.fold) + '/' + pc(c.actual.fold) + ' ' + sgn(c.error.fold) +
             ' n' + (c.n >= 1000 ? (c.n / 1000).toFixed(1) + 'k' : c.n)).padStart(29)
          : '—'.padStart(29);
      });
      rows.push(line);
    });
    if (!any) return [];
    return ['  By bet size, ' + regime + ' (fold rate — model / real / gap / n)',
      '  ' + 'profile'.padEnd(9) + r.bucketKeys.map(function (b) { return b.padStart(29); }).join(''),
      '  ' + '-'.repeat(9 + 29 * r.bucketKeys.length)].concat(rows).concat(['']);
  };
  bucketTable('postflop').forEach(function (l) { out.push(l); });
  bucketTable('preflop').forEach(function (l) { out.push(l); });
  if (r.streets && r.streets.preflop && r.streets.postflop) {
    out.push('  Preflop vs postflop (fold rate — model / real / gap)');
    out.push('  ' + 'profile'.padEnd(9) + 'preflop'.padStart(24) + 'postflop'.padStart(24));
    out.push('  ' + '-'.repeat(57));
    order.forEach(function (k) {
      const pre = r.streets.preflop[k], post = r.streets.postflop[k];
      out.push('  ' + k.padEnd(9) +
        (pre ? (pc(pre.predicted.fold) + '/' + pc(pre.actual.fold) + ' ' + sgn(pre.error.fold)) : '—').padStart(24) +
        (post ? (pc(post.predicted.fold) + '/' + pc(post.actual.fold) + ' ' + sgn(post.error.fold)) : '—').padStart(24));
    });
    out.push('');
  }
  out.push('  TVD is total variation distance: 0 = the model describes the table exactly,');
  out.push('  100 = it describes a different game. cTVD is the same thing measured WITHIN');
  out.push('  bet-size buckets and is the figure that tracks advice quality — a model can');
  out.push('  have a near-zero TVD while every bucket inside it is wrong. "worst" is the');
  out.push('  single worst bucket. Under ~10 on cTVD is a good model.');
  out.push('');
  return out.join('\n');
}

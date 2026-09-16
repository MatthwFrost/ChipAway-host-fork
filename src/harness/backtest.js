/* ============================================================
   BACKTEST — is following the coach actually worth chips?

   Every policy plays the SAME hands: same seed, same deck, same seats, same
   bot decisions. The only thing that changes is what hero does. That makes the
   comparison paired — the difference between two policies is the difference in
   their decisions, not in the cards they happened to be dealt.

   Result is in big blinds per 100 hands, the standard unit, with a standard
   error so "coach beats always-call" can be read as a real edge rather than a
   run of good luck.
   ============================================================ */

import { BB, POLICIES, createTable } from '../engine/table.js';
import { makeRng } from '../engine/rng.js';

export const DEFAULT_POLICIES = [
  'coach', 'tag-bot', 'lag-bot', 'nit-bot', 'always-call', 'random', 'always-fold',
];

function runOne(policyName, options) {
  const o = options;
  const policy = POLICIES[policyName];
  if (!policy) throw new Error('unknown policy: ' + policyName);

  // Every policy gets its own generator seeded identically, so hand N is dealt
  // from the same stream for all of them. They diverge only where hero's
  // choices differ, which is exactly the effect being measured.
  // Two independent streams. `dealSeed` fixes the cards, so hand N is the same
  // deal for every policy. `rng` drives decisions and Monte Carlo, and is
  // allowed to diverge — that divergence IS the thing being measured.
  const table = createTable({
    rng: makeRng(o.seed), dealSeed: o.seed, seats: o.seats, heroPolicy: policy,
    botTrials: o.botTrials, calledTrials: o.calledTrials, equityTrials: o.equityTrials,
  });

  let total = 0;
  const perHand = [];
  let vpip = 0, aggressive = 0, passive = 0, showdowns = 0, decisions = 0;

  for (let i = 0; i < o.hands; i++) {
    // playHand resets stacks and measures net against that baseline. Computing
    // it here instead telescopes across hands and sums to almost exactly zero,
    // which is how this bug announced itself.
    const r = table.playHand();
    total += r.net[0];
    perHand.push(r.net[0]);
    if (r.showdown) showdowns++;
  }

  const n = perHand.length;
  const mean = total / n;
  let varSum = 0;
  perHand.forEach(function (x) { varSum += (x - mean) * (x - mean); });
  const sd = Math.sqrt(varSum / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);

  return {
    policy: policyName,
    hands: n,
    totalChips: total,
    bb100: 100 * mean / BB,
    bb100se: 100 * se / BB,
    sdPerHand: sd / BB,
    showdownPct: 100 * showdowns / n,
    vpip: vpip, aggressive: aggressive, passive: passive, decisions: decisions,
    perHand: perHand,
  };
}

export function runBacktest(options) {
  const o = options || {};
  const cfg = {
    hands: o.hands || 10000,
    seed: o.seed === undefined ? 20260916 : o.seed,
    seats: o.seats || ['nit', 'tag', 'lag', 'station', 'maniac'],
    botTrials: o.botTrials || 170,
    calledTrials: o.calledTrials || 380,
    equityTrials: o.equityTrials || 520,
  };
  const names = o.policies || DEFAULT_POLICIES;
  const results = names.map(function (nm) { return runOne(nm, cfg); });

  // Paired comparison against the coach: same hand index, so the difference
  // cancels most of the card luck and the error bar shrinks a long way.
  const coach = results.filter(function (r) { return r.policy === 'coach'; })[0];
  if (coach) {
    results.forEach(function (r) {
      if (r === coach) { r.vsCoach = null; return; }
      const n = Math.min(coach.perHand.length, r.perHand.length);
      let sum = 0;
      const diffs = new Array(n);
      for (let i = 0; i < n; i++) { diffs[i] = coach.perHand[i] - r.perHand[i]; sum += diffs[i]; }
      const mean = sum / n;
      let v = 0;
      for (let i = 0; i < n; i++) v += (diffs[i] - mean) * (diffs[i] - mean);
      const se = Math.sqrt(v / Math.max(1, n - 1)) / Math.sqrt(n);
      r.vsCoach = {
        bb100: 100 * mean / BB,
        bb100se: 100 * se / BB,
        // How many standard errors the coach's edge is from zero.
        z: se > 0 ? mean / se : 0,
      };
    });
  }
  if (!o.keepPerHand) results.forEach(function (r) { delete r.perHand; });
  return { config: cfg, results: results };
}

/* ---- reporting ---- */

export function formatBacktest(out) {
  const c = out.config;
  const lines = [];
  lines.push('');
  lines.push('  ADVICE BACKTEST — every policy plays the same ' + c.hands.toLocaleString() + ' hands');
  lines.push('  seed ' + c.seed + ' · seats: ' + c.seats.join(', '));
  lines.push('');
  lines.push('  ' + 'policy'.padEnd(14) + 'bb/100'.padStart(10) + '± se'.padStart(9) +
    'total chips'.padStart(14) + 'sd/hand'.padStart(10) + 'showdown'.padStart(10));
  lines.push('  ' + '-'.repeat(67));
  out.results.slice().sort(function (a, b) { return b.bb100 - a.bb100; }).forEach(function (r) {
    lines.push('  ' + r.policy.padEnd(14) +
      r.bb100.toFixed(2).padStart(10) +
      ('±' + r.bb100se.toFixed(2)).padStart(9) +
      Math.round(r.totalChips).toLocaleString().padStart(14) +
      r.sdPerHand.toFixed(1).padStart(10) +
      (r.showdownPct.toFixed(1) + '%').padStart(10));
  });
  lines.push('');
  lines.push('  Coach vs each alternative, paired on the same hands');
  lines.push('  ' + 'alternative'.padEnd(14) + 'coach edge bb/100'.padStart(20) + '± se'.padStart(9) + 'z'.padStart(8) + '   verdict');
  lines.push('  ' + '-'.repeat(70));
  out.results.forEach(function (r) {
    if (!r.vsCoach) return;
    const z = r.vsCoach.z;
    const verdict = Math.abs(z) < 2 ? 'no clear difference'
      : (z > 0 ? 'coach wins' : 'COACH LOSES');
    lines.push('  ' + r.policy.padEnd(14) +
      r.vsCoach.bb100.toFixed(2).padStart(20) +
      ('±' + r.vsCoach.bb100se.toFixed(2)).padStart(9) +
      z.toFixed(1).padStart(8) + '   ' + verdict);
  });
  lines.push('');
  lines.push('  z is the paired edge in standard errors. |z| > 2 is a real difference,');
  lines.push('  |z| > 3 is a strong one. Poker variance is large — sd/hand above shows why');
  lines.push('  the unpaired error bars are so much wider than the paired ones.');
  lines.push('');
  return lines.join('\n');
}

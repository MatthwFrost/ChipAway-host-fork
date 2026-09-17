/* ============================================================
   LEAK — surface one thing, not twenty
   ============================================================
   Lifted out of initializePokerTrainer so the dashboard can show the same
   "Worth fixing" line the table does, computed over lifetime totals instead of
   the live game. It takes stats and evRecords as arguments rather than reading
   closure variables; two copies of these thresholds would drift apart.
   ============================================================ */

export function heroMetrics(stats) {
  const h = Math.max(1, stats.hands);
  return {
    vpip: 100 * stats.vpip / h,
    pfr: 100 * stats.pfr / h,
    af: stats.aggro / Math.max(1, stats.calls),
    wtsd: 100 * stats.wtsd / h,
    f3b: stats.f3bOpp ? 100 * stats.f3b / stats.f3bOpp : null,
    read: stats.guessTotal ? 100 * stats.guessRight / stats.guessTotal : null,
  };
}

export function findLeak(stats, evRecords) {
  if (!stats || stats.hands < 12) return '';
  const recs = evRecords || [];
  const m = heroMetrics(stats);
  const cand = [];
  if (stats.f3bOpp >= 4 && m.f3b !== null && m.f3b > 75)
    cand.push({ w: 3, t: 'You fold to 3-bets <b>' + m.f3b.toFixed(0) + '%</b> of the time. Above about 70% and observant players can 3-bet you relentlessly with anything.' });
  if (m.af < 0.6 && stats.calls >= 8)
    cand.push({ w: 4, t: 'Aggression factor <b>' + m.af.toFixed(2) + '</b> — you are calling far more than betting. Calling only wins when you have the best hand; betting can win either way.' });
  if (m.vpip > 55 && stats.hands >= 15)
    cand.push({ w: 3, t: 'You are playing <b>' + m.vpip.toFixed(0) + '%</b> of hands. Even the loosest winning regulars sit near 35% at 6-max.' });
  if (m.vpip < 14 && stats.hands >= 20)
    cand.push({ w: 2, t: 'You are playing just <b>' + m.vpip.toFixed(0) + '%</b> of hands. Folding this much means the blinds grind you down — look for steals in late position.' });
  if (m.vpip > 0 && (m.vpip - m.pfr) > 28 && stats.hands >= 15)
    cand.push({ w: 3, t: 'You enter <b>' + m.vpip.toFixed(0) + '%</b> of pots but raise only <b>' + m.pfr.toFixed(0) + '%</b>. That gap is limping and calling — it plays big pots out of position with weak ranges.' });
  if (stats.guessTotal >= 8 && m.read !== null && m.read < 35)
    cand.push({ w: 2, t: 'Your hand reads are landing <b>' + m.read.toFixed(0) + '%</b> of the time. Reveal the equity panel more often after acting, and check what their betting actually represented.' });
  if (recs.length >= 10) {
    const avg = recs.reduce(function (a, r) { return a + r.cost; }, 0) / recs.length;
    if (avg > 12) cand.push({ w: 5, t: 'You are leaking about <b>' + avg.toFixed(0) + '</b> chips of EV per hand. The decision review under each hand shows exactly where — most of it is usually one street.' });
  }
  if (!cand.length) return '';
  cand.sort(function (a, b) { return b.w - a.w; });
  return cand[0].t;
}

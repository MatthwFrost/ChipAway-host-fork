/* ============================================================
   RNG — a seeded generator, so a run can be reproduced exactly.

   The app passes nothing and gets Math.random. The harness passes a seed and
   gets the same 10,000 hands every time, which is the difference between
   "the numbers moved" and "the change moved the numbers".
   ============================================================ */

// mulberry32: small, fast, and good enough for simulation. Not cryptographic.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

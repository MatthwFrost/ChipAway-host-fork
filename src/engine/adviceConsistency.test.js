/* ============================================================
   ADVICE CONSISTENCY — the suite that exists because two panels once told
   the same player opposite things about the same opponent.

   These tests do not check that any particular sentence is correct. They check
   that no two sentences the app can produce, for the same spot, contradict each
   other. They work by sweeping a large matrix of spots, rendering EVERY surface
   (coach verdict, reason, points, prose, frequencies, maths, and the opponent
   tips), and asserting a list of properties that must hold across all of them.

   The failure mode being defended against is specific and was real:

     "Raise to 250. It works because they fold about 73% of the time here"
     sitting directly above
     "Against a maniac — do not bluff, they call or re-raise regardless."
   ============================================================ */

import { describe, expect, test } from 'vitest';
import { buildCoachAdvice } from './coach.js';
import { buildSpotModel, checkModelConsistency, foldBand, BLUFFABLE_FLOOR } from './spotModel.js';
import {
  PROFILES, PROFILE_KEYS, afterAggro, breakEvenFold, evOfBet, evOfCall,
  jointResponse, rangeWidth, responseTo,
} from './opponentModel.js';

const strip = (s) => String(s).replace(/<[^>]+>/g, '');

/* ---- the matrix ---------------------------------------------------------
   Every spot is built from real model output rather than from hand-written
   numbers, so the fixture can never describe a table that could not exist —
   which is how the old fixtures hid the contradiction in the first place.
   ---- */

const SHAPES = {
  none: null,
  draw: {
    isDrawing: true, outs: 9, equityFromOuts: 0.35, riverOnlyEquity: 0.19,
    cardsToCome: 2, description: 'a flush draw', madeCategory: 0, usesHoleCards: true,
  },
  bricked: { bricked: true, outs: 0, equityFromOuts: 0, madeCategory: 0 },
  pair: {
    isMade: true, madeCategory: 1, madeLabel: 'second pair', madeName: 'Pair',
    usesHoleCards: true, outs: 0, equityFromOuts: 0,
  },
  strong: {
    isMade: true, madeCategory: 3, madeLabel: 'a set', madeName: 'Three of a kind',
    usesHoleCards: true, outs: 0, equityFromOuts: 0,
  },
};

const POTS = [
  { pot: 120, toCall: 0 },
  { pot: 213, toCall: 96 },
  { pot: 400, toCall: 150 },
  { pot: 900, toCall: 600 },
];

const EQUITIES = [0.14, 0.31, 0.46, 0.62, 0.81];

// One opponent as they would look after making a standard bet of their own.
function opponentRead(key, refB, pot, ctx) {
  const state = afterAggro({ rLo: 0, rBluff: 0 }, PROFILES[key], PROFILES[key].sizing);
  return {
    name: 'Idris',
    styleLabel: PROFILES[key].label,
    rangeTopPct: rangeWidth(state),
    airPct: 100 * state.rBluff,
    response: responseTo(state, PROFILES[key], refB, pot, ctx),
    state,
  };
}

// Build a spot whose every number comes out of the model, for a given set of
// opponent profiles, pot shape, equity and hand shape.
function makeSpot(keys, potShape, equity, shapeKey, revealStyles) {
  const { pot, toCall } = potShape;
  const ctx = { preflop: false, bigBlind: 20, currentBet: toCall, heroState: { rLo: 0.35, rBluff: 0 } };
  const names = ['Idris', 'Kaz', 'Sofia', 'Bernard'];

  const sizes = [0.33, 0.5, 0.75, 1, 1.5];
  const options = [{ label: 'fold', ev: 0, amount: 0, evSe: 0 }];
  if (toCall > 0) {
    options.push({ label: 'call ' + toCall, ev: evOfCall(equity, pot, toCall), amount: toCall, evSe: 6 });
  } else {
    options.push({ label: 'check', ev: 0, amount: 0, evSe: 0 });
  }

  const states = keys.map((k) => afterAggro({ rLo: 0, rBluff: 0 }, PROFILES[k], PROFILES[k].sizing));
  const eCalled = Math.max(0, equity - 0.08);

  sizes.forEach((frac) => {
    const B = Math.round(toCall > 0 ? toCall + frac * (pot + toCall) : pot * frac);
    if (B < 20) return;
    const resp = jointResponse(states.map((st, i) => responseTo(st, PROFILES[keys[i]], B, pot, ctx)));
    options.push({
      label: (toCall > 0 ? 'raise to ' : 'bet ') + B + ' (' + frac + ' pot)',
      ev: evOfBet(eCalled, pot, B, resp),
      amount: B, fold: resp.fold, raise: resp.raise, eCalled, evSe: 14,
    });
  });

  // The recommendation is the highest EV, with the cheapest of a tied band
  // preferred — the same honest ranking the trainer uses.
  const ranked = options.slice().sort((a, b) => (b.ev - a.ev) || ((a.amount || 0) - (b.amount || 0)));
  let recommended = ranked[0];
  if (recommended.label === 'fold' && options.some((o) => o.label === 'check')) {
    recommended = options.find((o) => o.label === 'check');
  }

  // Opponent reads are taken at the size the advice is built around, which is
  // the best aggressive option. Anything else and the reads describe a
  // different bet from the one being recommended.
  let bestAggro = null;
  options.forEach((o) => { if (o.fold !== undefined && (!bestAggro || o.ev > bestAggro.ev)) bestAggro = o; });
  const refB = bestAggro ? bestAggro.amount : Math.max(20, Math.round(pot * 0.75));

  const opponents = keys.map((k, i) => {
    const read = opponentRead(k, refB, pot, ctx);
    read.name = names[i];
    return read;
  });

  return {
    streetName: 'Flop',
    toCall, pot,
    rawEquity: Math.min(0.95, equity + 0.06),
    rangeEquity: equity,
    decisionEquity: equity,
    equitySe: 0.016,
    degradedShare: 0,
    trials: 900,
    opponents,
    options,
    recommended,
    revealStyles,
    villain: opponents[0],
    field: { live: keys.length, contesting: keys.length, expectedFolds: 0 },
    blockerPct: 9,
    shape: SHAPES[shapeKey],
    position: { name: 'BTN', actsLast: true, preflop: false, credit: 0.035 },
  };
}

// The full sweep. Kept to single and two-handed fields across every profile,
// every pot shape, every equity and every hand shape.
function everySpot() {
  const out = [];
  const fields = [];
  PROFILE_KEYS.forEach((k) => fields.push([k]));
  PROFILE_KEYS.forEach((k) => fields.push([k, 'tag']));
  fields.push(['maniac', 'station']);
  fields.push(['nit', 'nit']);

  fields.forEach((keys) => {
    POTS.forEach((potShape) => {
      EQUITIES.forEach((equity) => {
        Object.keys(SHAPES).forEach((shapeKey) => {
          [false, true].forEach((reveal) => {
            out.push({
              label: keys.join('+') + ' pot' + potShape.pot + '/' + potShape.toCall +
                ' eq' + equity + ' ' + shapeKey + (reveal ? ' revealed' : ''),
              spot: makeSpot(keys, potShape, equity, shapeKey, reveal),
            });
          });
        });
      });
    });
  });
  return out;
}

const ALL = everySpot();

// Everything the player can read for a spot, as one flat string, plus the
// opponent tips that sit beside it.
function everythingSaid(spot) {
  const advice = buildCoachAdvice(spot);
  const model = advice.model;
  const coachText = [advice.verdict, advice.reason, ...advice.points, ...advice.lines, ...advice.maths].join(' ');
  const tips = model.counter ? [model.counter.head, ...model.counter.bullets].join(' ') : '';
  return { advice, model, coach: strip(coachText), tips: strip(tips), all: strip(coachText + ' ' + tips) };
}

describe('the sweep is real', () => {
  test('covers a few hundred distinct spots', () => {
    expect(ALL.length).toBeGreaterThan(300);
  });

  test('every spot produces advice without throwing', () => {
    ALL.forEach(({ label, spot }) => {
      expect(() => buildCoachAdvice(spot), label).not.toThrow();
    });
  });
});

describe('model invariants hold everywhere', () => {
  test('no spot in the matrix violates a single model invariant', () => {
    const broken = [];
    ALL.forEach(({ label, spot }) => {
      const violations = checkModelConsistency(buildSpotModel(spot));
      if (violations.length) broken.push(label + ' -> ' + violations.map((v) => v.code + '(' + v.detail + ')').join(', '));
    });
    expect(broken).toEqual([]);
  });
});

describe('the coach and the opponent tips never contradict each other', () => {
  // This is the exact failure the user hit: a recommendation sold on fold
  // equity sitting above a tip saying this player cannot be folded.
  test('a bet is never sold as a bluff while the tips say not to bluff', () => {
    const bad = [];
    ALL.forEach(({ label, spot }) => {
      const { all, tips } = everythingSaid(spot);
      const soldAsBluff = /It works because they fold about/.test(all) ||
        /profits without your hand ever having to win/.test(all);
      const tipsSayNo = /Do not bluff them/.test(tips);
      if (soldAsBluff && tipsSayNo) bad.push(label);
    });
    expect(bad).toEqual([]);
  });

  test('the tips never say to bluff a player the coach calls unbluffable', () => {
    const bad = [];
    ALL.forEach(({ label, spot }) => {
      const { all, tips } = everythingSaid(spot);
      const tipsSayBluff = /Bluff them, and do not be shy/.test(tips);
      const coachSaysNo = /a bluff is not advised here/.test(all) ||
        /nobody here folds much/.test(all) ||
        /do not fold often enough for any size/.test(all);
      if (tipsSayBluff && coachSaysNo) bad.push(label);
    });
    expect(bad).toEqual([]);
  });

  test('the draw advice and the bet advice agree on whether folds are available', () => {
    const bad = [];
    ALL.forEach(({ label, spot }) => {
      const { all } = everythingSaid(spot);
      const drawSaysReal = /bluff part of this bet is real/.test(all);
      const drawSaysNot = /they rarely fold, so almost all of this bet/.test(all);
      const betSaysNot = /a bluff is not advised here/.test(all) ||
        /This is not being recommended as a bluff/.test(all);
      const betSaysYes = /profits without your hand ever having to win/.test(all);
      if (drawSaysReal && betSaysNot) bad.push(label + ' (draw says yes, bet says no)');
      if (drawSaysNot && betSaysYes) bad.push(label + ' (draw says no, bet says yes)');
    });
    expect(bad).toEqual([]);
  });

  test('one fold percentage per spot — never two different ones for the same bet', () => {
    const bad = [];
    ALL.forEach(({ label, spot }) => {
      const { advice, model } = everythingSaid(spot);
      if (!model.bestAggro) return;
      const quoted = new Set();
      const text = strip([advice.reason, ...advice.points, ...advice.lines].join(' '));
      // Every "they fold about N%" style figure attached to the headline bet.
      const re = /fold(?:s)?(?: the field)? about (\d+)%/g;
      let m;
      while ((m = re.exec(text)) !== null) quoted.add(Number(m[1]));
      const expected = Math.round(100 * model.bluff.folds);
      quoted.forEach((q) => {
        if (q !== expected) bad.push(label + ': said ' + q + '%, model says ' + expected + '%');
      });
    });
    expect(bad).toEqual([]);
  });
});

describe('the bluff verdict is one decision, taken once', () => {
  test('a bluff is never called on when it does not clear its own price', () => {
    const bad = [];
    ALL.forEach(({ label, spot }) => {
      const { model } = everythingSaid(spot);
      if (model.bluff.viable && model.bluff.folds < model.bluff.breakEven) bad.push(label);
    });
    expect(bad).toEqual([]);
  });

  test('a bluff is never called on against a player in an unbluffable band', () => {
    const bad = [];
    ALL.forEach(({ label, spot }) => {
      const { model } = everythingSaid(spot);
      if (model.bluff.viable && model.bluff.folds < BLUFFABLE_FLOOR) bad.push(label);
    });
    expect(bad).toEqual([]);
  });

  test('when a bluff is off, the advice always says which of the three reasons it is', () => {
    ALL.forEach(({ label, spot }) => {
      const { model } = everythingSaid(spot);
      if (!model.bluff.viable) {
        expect(['price', 'stickiness', 'reraise'], label).toContain(model.bluff.blockedBy);
      }
    });
  });

  test('the maths panel states the same bluff verdict as the prose', () => {
    const bad = [];
    ALL.forEach(({ label, spot }) => {
      const { advice, model } = everythingSaid(spot);
      const line = advice.maths.find((m) => /^Bluff verdict/.test(strip(m)));
      if (!line) return;
      const saysOn = /a bluff is on/.test(strip(line));
      if (saysOn !== model.bluff.viable) bad.push(label);
    });
    expect(bad).toEqual([]);
  });
});

describe('bands are applied once, not re-derived per sentence', () => {
  test('the foldiness word always matches the band of the number quoted', () => {
    const bad = [];
    ALL.forEach(({ label, spot }) => {
      const { model, coach } = everythingSaid(spot);
      if (model.opponents.length !== 1) return;
      const o = model.opponents[0];
      // The single-opponent table read prints the band word verbatim.
      if (coach.includes(o.name + ' ' + o.band.word)) {
        expect(foldBand(o.fold).word, label).toBe(o.band.word);
      }
      // and must never print a different band's word for the same player
      ['folds a lot', 'folds often enough to bluff', 'does not fold easily', 'almost never folds']
        .filter((w) => w !== o.band.word)
        .forEach((w) => {
          if (coach.includes(o.name + ' ' + w)) bad.push(label + ': ' + o.name + ' ' + w);
        });
    });
    expect(bad).toEqual([]);
  });

  test('"nobody here folds much" only appears against an unbluffable read', () => {
    const bad = [];
    ALL.forEach(({ label, spot }) => {
      const { model, coach } = everythingSaid(spot);
      if (/nobody here folds much/.test(coach) && model.bluff.personPasses) bad.push(label);
    });
    expect(bad).toEqual([]);
  });
});

describe('the verdict, the reason and the numbers point the same way', () => {
  test('the headline action is always one of the options on offer', () => {
    ALL.forEach(({ label, spot }) => {
      const { advice, model } = everythingSaid(spot);
      const head = strip(advice.verdict).split(/[.,—]/)[0].trim().toLowerCase();
      const labels = model.options.map((o) => o.label.toLowerCase());
      expect(labels.some((l) => l === head || head.startsWith(l) || l.startsWith(head)), label + ': ' + head).toBe(true);
    });
  });

  test('a recommended bet never has its case made on folds it does not get', () => {
    const bad = [];
    ALL.forEach(({ label, spot }) => {
      const { advice, model } = everythingSaid(spot);
      if (model.family !== 'aggro') return;
      const reason = strip(advice.reason);
      if (/It works because they fold/.test(reason) && !model.bluff.viable) bad.push(label);
    });
    expect(bad).toEqual([]);
  });

  test('a recommended fold is never justified by equity that beats the price', () => {
    const bad = [];
    ALL.forEach(({ label, spot }) => {
      const { advice, model } = everythingSaid(spot);
      if (model.family !== 'fold' || model.price.toCall <= 0) return;
      if (model.clarity.level === 'toss-up') return;   // the trade-off sentence covers this
      if (model.equity.decisionPct > model.price.requiredPct + 2) {
        bad.push(label + ': folding on ' + model.equity.decisionPct + '% vs ' + model.price.requiredPct + '%');
      }
      expect(strip(advice.reason).length).toBeGreaterThan(0);
    });
    expect(bad).toEqual([]);
  });

  test('the recommended row is the one marked recommended in the frequency table', () => {
    ALL.forEach(({ label, spot }) => {
      const { advice, model } = everythingSaid(spot);
      const marked = advice.frequencies.filter((f) => f.recommended);
      expect(marked.length, label).toBe(1);
      expect(marked[0].label, label).toBe(model.recommended.label);
    });
  });

  test('every fold percentage in the frequency table matches its own option', () => {
    ALL.forEach(({ label, spot }) => {
      const { advice, model } = everythingSaid(spot);
      advice.frequencies.forEach((f) => {
        const opt = model.options.find((o) => o.label === f.label);
        if (opt && opt.fold !== undefined) {
          expect(f.fold, label + ' ' + f.label).toBe(Math.round(100 * opt.fold) + '%');
        }
      });
    });
  });
});

describe('hidden styles stay hidden', () => {
  test('no archetype is ever named while profiles are off', () => {
    const leaks = [];
    ALL.filter((c) => !c.spot.revealStyles).forEach(({ label, spot }) => {
      const { all } = everythingSaid(spot);
      if (/\bstation\b|\bmaniac\b|\bnit\b|\bTAG\b|\bLAG\b/i.test(all)) leaks.push(label);
    });
    expect(leaks).toEqual([]);
  });

  test('the style is named once profiles are on', () => {
    const { tips } = everythingSaid(makeSpot(['maniac'], POTS[1], 0.46, 'none', true));
    expect(tips).toMatch(/Idris is a maniac/);
  });
});

describe('the reported spot: Q8s on A-J-6, in position, raised into by a maniac', () => {
  // The spot as it actually appeared: pot 213 holding Idris's 96, hero on the
  // button with 46% range equity, and a half-pot raise to 250 on offer — the
  // size the coach recommended and attached "they fold 73% of the time" to.
  const P = 213, C = 96, B = 250, eq = 0.46;
  const ctx = { preflop: false, bigBlind: 20, currentBet: C, heroState: { rLo: 0.35, rBluff: 0 } };
  const idris = afterAggro({ rLo: 0, rBluff: 0 }, PROFILES.maniac, PROFILES.maniac.sizing);
  const resp = responseTo(idris, PROFILES.maniac, B, P, ctx);
  const eCalled = eq - 0.08;
  const raise = {
    label: 'raise to ' + B + ' (½ pot)', ev: evOfBet(eCalled, P, B, resp),
    amount: B, fold: resp.fold, raise: resp.raise, eCalled, evSe: 14,
  };
  const callOpt = { label: 'call ' + C, ev: evOfCall(eq, P, C), amount: C, evSe: 6 };
  const foldOpt = { label: 'fold', ev: 0, amount: 0, evSe: 0 };
  // Ranked, not asserted: when the coach recommended the raise this picked the
  // raise, and now that it does not, it picks the call.
  const ranked = [foldOpt, callOpt, raise].slice().sort((a, b) => (b.ev - a.ev) || (a.amount - b.amount));
  const spot = {
    streetName: 'Flop', toCall: C, pot: P,
    rawEquity: 0.43, rangeEquity: eq, decisionEquity: eq, equitySe: 0.016,
    degradedShare: 0, trials: 900,
    opponents: [{
      name: 'Idris', styleLabel: 'Maniac', rangeTopPct: rangeWidth(idris),
      airPct: 100 * idris.rBluff, response: resp,
    }],
    options: [foldOpt, callOpt, raise],
    recommended: ranked[0],
    revealStyles: false,
    villain: { name: 'Idris' },
    field: { live: 1, contesting: 1, expectedFolds: 0 },
    blockerPct: 9,
    shape: null,
    position: { name: 'BTN', actsLast: true, preflop: false, credit: 0.035 },
  };
  const said = everythingSaid(spot);

  test('the maniac is no longer read as folding three times in four', () => {
    expect(said.model.opponents[0].fold).toBeLessThan(0.55);
  });

  test('a raise is not sold as a bluff against a player who will not fold to one', () => {
    expect(said.model.bluff.viable).toBe(false);
    expect(said.coach).not.toMatch(/It works because they fold about/);
  });

  test('the chance of being played back at is stated rather than assumed to be zero', () => {
    expect(said.model.opponents[0].raise).toBeGreaterThan(0.1);
  });

  test('the opponent tips and the coach agree about bluffing', () => {
    // Once the model was fitted to the bots, the predicted fold rate here fell
    // to 19% and the tips reach the same conclusion the old hand-written table
    // asserted — except now it is derived from the table's own behaviour rather
    // than declared, and it agrees with the recommendation instead of
    // contradicting it.
    expect(said.tips).not.toMatch(/Bluff them, and do not be shy/);
    expect(said.tips).toMatch(/Do not bluff them/);
    expect(said.coach).not.toMatch(/profits without your hand ever having to win/);
    expect(said.model.bluff.blockedBy).toBe('stickiness');
  });

  test('the chance of being played back at is still quoted to the player', () => {
    expect(said.model.opponents[0].raise).toBeGreaterThan(0.1);
    expect(said.tips).toMatch(/re-raise|come back over the top/);
  });

  test('raising is no longer the recommendation — calling is', () => {
    // This is the spot that started all of this: the coach recommended a
    // half-pot raise on the strength of a 73% fold estimate against a maniac.
    // With the model calibrated, the raise is priced well below the call.
    const call = said.model.options.find((o) => /^call/.test(o.label));
    expect(said.model.bestAggro.ev).toBeLessThan(call.ev);
    expect(said.model.recommended.label).toMatch(/^call/);
  });

  test('the maniac is read as calling, which is what a maniac does', () => {
    expect(said.model.opponents[0].call).toBeGreaterThan(0.5);
  });
});

describe('regression: the shape of the original contradiction', () => {
  // A spot whose bet option claims a fold rate its opponents do not support.
  // The model must refuse it rather than letting two sentences disagree.
  test('an impossible spot is caught by the invariants, not rendered', () => {
    const base = makeSpot(['maniac'], POTS[1], 0.46, 'none', false);
    const rigged = {
      ...base,
      options: base.options.map((o) => (o.fold === undefined ? o : { ...o, fold: Math.min(0.98, o.fold + 0.25) })),
    };
    const violations = checkModelConsistency(buildSpotModel(rigged));
    expect(violations.map((v) => v.code)).toContain('option-fold-disagrees-with-field');
  });

  test('break-even is still B/(P+B) — the arithmetic was never the problem', () => {
    expect(Math.round(100 * breakEvenFold(250, 213))).toBe(54);
  });
});

/* ============================================================
   COACH — plain-language decision advice.

   Everything here is pure: no DOM, no module-level game state.
   The engine gathers a snapshot of the spot and hands it in, so the
   wording can be unit-tested without dealing a hand.

   Formulas follow MATHS.md:
     required equity   e* = C / (P + C)        (§4, P already holds their bet)
     break-even bluff  f* = B / (P + B)        (§6)
     EV(call)          e·P − (1−e)·C           (§5)
     EV(bet)           f·P + (1−f)[e(P+B) − (1−e)B]
   ============================================================ */

const b = function (x) { return '<b>' + x + '</b>'; };

/* ---- formatting ---- */

// Equity is shown as whole numbers everywhere. The Monte Carlo error bar is
// wider than a decimal point, so a decimal would be false precision.
export function pctWhole(fraction) {
  if (fraction === null || fraction === undefined || !isFinite(fraction)) return null;
  return Math.round(100 * fraction);
}

// 95% confidence half-width in percentage points, from the standard error of
// the estimate (MATHS.md §2: SE = sqrt(e(1-e)/n)).
export function ci95Points(se) {
  if (se === null || se === undefined || !isFinite(se)) return null;
  return Math.round(100 * 1.96 * se);
}

export function chips(n) {
  return Math.round(n).toString();
}

export function signed(n) {
  const r = Math.round(n);
  return (r >= 0 ? '+' : '') + r;
}

/* ---- pot odds anchor ---- */

// P is everything on the table before you act, which already includes the bet
// you are facing. Calling C wins P + C in total.
export function requiredEquity(toCall, potWithTheirBet) {
  if (toCall <= 0) return 0;
  const denom = potWithTheirBet + toCall;
  return denom > 0 ? toCall / denom : 0;
}

// A pure bluff of B into P breaks even when they fold this often.
export function breakEvenFold(bet, pot) {
  const denom = pot + bet;
  return denom > 0 ? bet / denom : 0;
}

/* ---- describing opponents without leaking their hidden style ---- */

// Styles are hidden on purpose: reading them is the game. So the coach talks
// about how likely someone is to fold, which is observable, and only names the
// archetype when the player has already turned styles on.
export function foldinessWord(f) {
  if (f >= 0.55) return 'folds a lot';
  if (f >= 0.35) return 'folds often enough to bluff';
  if (f >= 0.18) return 'does not fold easily';
  return 'almost never folds';
}

// The same read with a plural subject, for "two of the players left ...".
export function foldinessWordPlural(f) {
  if (f >= 0.55) return 'fold a lot';
  if (f >= 0.35) return 'fold often enough to bluff';
  if (f >= 0.18) return 'do not fold easily';
  return 'almost never fold';
}

export function describeVillain(v, revealStyles) {
  if (!v) return 'their range';
  if (revealStyles && v.styleLabel) {
    return v.name + "'s " + v.styleLabel.toLowerCase() + ' range';
  }
  // Nobody has committed yet, so there is no read to describe — say so in a
  // phrase that still slots into "...X pulls that down to Y%".
  if (v.rangeTopPct === null || v.rangeTopPct === undefined || v.rangeTopPct >= 92) {
    return 'the whole range ' + v.name + ' could still have';
  }
  return 'the top ' + b(Math.round(v.rangeTopPct) + '%') + ' of hands ' + v.name + ' is repping';
}

// One opponent's implied range, in a clause that slots into a list.
function oppRangePhrase(o, revealStyles) {
  const style = (revealStyles && o.styleLabel) ? ' (' + o.styleLabel + ')' : '';
  if (o.rangeTopPct === null || o.rangeTopPct === undefined || o.rangeTopPct >= 92) {
    return b(o.name) + style + ' has shown nothing yet';
  }
  const air = (o.airPct >= 3) ? ', ' + Math.round(o.airPct) + '% air' : '';
  return b(o.name) + style + ' top ' + Math.round(o.rangeTopPct) + '%' + air;
}

// Equity is computed against everyone still in, so the prose must not quietly
// describe the tightest player as if they were the table. Two regimes: a small
// field gets every range named, because three is still readable; a big field
// gets the tightest two named and SAYS that is what it is doing, so a loose
// player is never silently dropped from the story.
export function rangeAttribution(opponents, revealStyles) {
  const opps = opponents || [];
  if (opps.length < 2) return null;
  const sorted = opps.slice().sort(function (x, y) {
    return (x.rangeTopPct === null || x.rangeTopPct === undefined ? 100 : x.rangeTopPct) -
      (y.rangeTopPct === null || y.rangeTopPct === undefined ? 100 : y.rangeTopPct);
  });
  const phrase = function (o) { return oppRangePhrase(o, revealStyles); };
  if (opps.length <= 3) {
    return 'Each range you have to get through: ' + sorted.map(phrase).join('; ') + '.';
  }
  return b(opps.length + ' ranges') + ' to get through — the two tightest are ' +
    sorted.slice(0, 2).map(phrase).join(' and ') + '. The other ' + (opps.length - 2) +
    ' are wider and are in the equity figure, but not named here.';
}

// How many of the players yet to act are expected to fold before it comes back
// round. Returned as a range, because a fractional expectation is not a fact
// about any one player.
export function foldsExpectedPhrase(expected) {
  if (!isFinite(expected) || expected < 0.5) return null;
  const lo = Math.floor(expected), hi = Math.ceil(expected);
  if (lo === hi) return String(lo);
  if (lo === 0) return '1';
  return lo + '–' + hi;
}

// How the table as a whole behaves. Two players who never fold kill a bluff;
// two who fold a lot make one work.
export function tableFoldRead(opponents) {
  if (!opponents.length) return { kind: 'none', text: '' };
  const sticky = opponents.filter(function (o) { return o.foldChance < 0.25; });
  const foldy = opponents.filter(function (o) { return o.foldChance >= 0.5; });
  if (opponents.length >= 2 && sticky.length >= 2) {
    // Not "calling stations": a player who never folds because they raise back
    // is a different animal from one who never folds because they call, and the
    // styles are hidden anyway. Describe the behaviour, name nothing.
    return {
      kind: 'sticky',
      text: 'Two of the players left ' + foldinessWordPlural(sticky[1].foldChance) +
        ' — with that many hands unwilling to go anywhere, a bluff has nowhere to go.',
    };
  }
  if (opponents.length >= 2 && foldy.length === opponents.length) {
    return {
      kind: 'foldy',
      text: 'Everyone left ' + foldinessWord(foldy[0].foldChance) +
        ', so a bet can win this pot outright even when your hand cannot.',
    };
  }
  if (opponents.length === 1) {
    return {
      kind: 'single',
      text: opponents[0].name + ' ' + foldinessWord(opponents[0].foldChance) + '.',
    };
  }
  return {
    kind: 'mixed',
    text: 'The players left fold at different rates, so a bet has to get through all of them at once.',
  };
}

/* ---- position ---- */

// Where you sit changes the hand more than most beginners expect, so it gets
// said out loud every time rather than being folded into an equity number.
export function positionLine(pos) {
  if (!pos || !pos.name) return null;
  if (pos.preflop) {
    if (pos.name === 'UTG' || pos.name === 'MP') {
      return 'You are ' + b(pos.name) + ', first in with the whole table still to act behind you — that is the tightest seat at the table, so the hands you play from here have to be genuinely good.';
    }
    if (pos.name === 'BTN' || pos.name === 'CO') {
      return 'You are on the ' + b(pos.name) + ' and will act last on every street after this one. That is worth real money: play more hands from here than you would from anywhere else.';
    }
    return 'You are in the ' + b(pos.name) + '. You already have money in, so you can defend wider than the raw odds suggest — but you will be first to act for the rest of the hand, which cuts the other way.';
  }
  if (pos.actsLast) {
    return 'You act last on this street, so you see what everyone does before you commit. That is why you can call a little wider here than you could out of position — and why a free card is cheaper for you than for them.';
  }
  return 'You are first to act, so anything you check gives them the chance to bet you off the hand. Betting here buys the information you would otherwise have to pay for on the next street.';
}

/* ---- what you actually hold ---- */

// Equity cannot tell a made hand from a draw, and they want opposite lines.
export function shapeLines(shape, ctx) {
  if (!shape) return [];
  const out = [];
  const foldy = ctx && ctx.foldChance >= 0.4;

  if (shape.bricked) {
    out.push('Your draw missed. There is nothing here to show down, so calling cannot win — the only way this hand takes the pot now is if they fold to a bet.');
    out.push(foldy
      ? 'They do fold often enough that a bluff is the honest play, if you are going to play it at all. Give up or bet — do not call.'
      : 'They do not fold often enough for a bluff to get through, so the cheap answer is to give it up and keep the chips.');
    return out;
  }

  if (shape.isDrawing) {
    const desc = shape.description;
    const hasPair = shape.madeCategory >= 1 && shape.usesHoleCards;
    out.push(hasPair
      ? 'You have ' + b(shape.madeLabel) + ' and a draw on top of it' + (desc ? ': ' + desc + '.' : '.') +
        ' Most of that equity is in cards still to come, not in what you are holding now.'
      : 'You have ' + b('nothing made') + ' — this equity is a draw, not a hand' + (desc ? ': ' + desc + '.' : '.'));
    out.push('That is ' + b(shape.outs + ' outs') + ', which get there about ' + b(pctWhole(shape.equityFromOuts) + '%') +
      ' of the time by the river.' + (hasPair ? '' : ' Right now you beat nothing that is calling you.'));
    out.push('A draw plays better as a bet than as a call: betting wins the pot when they fold now, and again when you hit later. Calling only wins the second way.');
    out.push(foldy
      ? 'Against this table the first way is live too — they fold often enough that the bluff part of this bet is real, not just theory.'
      : 'Against this table, though, do not bank on the first way — they rarely fold, so almost all of this bet’s edge has to come from actually hitting your outs. That makes it a value-and-protection bet with a little bluff equity attached, not a real bluff.');
    if (shape.cardsToCome >= 2 && shape.riverOnlyEquity !== undefined) {
      out.push('Plan the next street now. If the turn bricks, the same outs are only worth ' +
        b(pctWhole(shape.riverOnlyEquity) + '%') + ' for the river alone — so decide now whether a missed turn means another bet or a cheap exit.');
    }
    return out;
  }

  if (shape.madeLabel && shape.madeCategory === 1) {
    out.push('You have ' + b(shape.madeLabel) + '. That is a bluff catcher: strong enough to beat a bluff, not strong enough to want a call from anything better.');
    out.push('So the question is not how good your hand is — it is how often this player bluffs. Everything hangs on that.');
    return out;
  }

  if (shape.isMade) {
    out.push('You have ' + b(shape.madeName ? shape.madeName.toLowerCase() : 'a made hand') +
      ' — a hand you are happy to show down. From here the job is getting paid, not getting there.');
  }
  return out;
}

/* ---- action families, and how clear-cut the pick actually is ---- */

// A different bet SIZE is not a different decision; a different family is.
function actionFamily(label) {
  if (/^fold/.test(label)) return 'fold';
  if (/^check/.test(label)) return 'check';
  if (/^call/.test(label)) return 'call';
  return 'aggro';
}

// Some spots have exactly one answer (2-7 into a big raise) and some are a coin
// flip between two reasonable lines. Saying both in the same confident voice is
// what makes a coach untrustworthy, so the gap to the best option from a
// DIFFERENT family is measured against both the Monte Carlo noise on the two EVs
// and a slice of the pot — "clear" then means clear in chips as well as
// statistically, and a toss-up is admitted as one.
export function decisionClarity(options, recommended, pot) {
  const opts = options || [];
  if (!recommended || opts.length < 2) return { level: 'clear', alt: null, gap: 0 };
  const fam = actionFamily(recommended.label);
  let alt = null;
  opts.forEach(function (o) {
    if (o === recommended || actionFamily(o.label) === fam) return;
    // Checking weakly dominates folding — you can always fold later, for free —
    // so a free check is never a genuine toss-up against a fold, even though
    // both price at exactly 0.
    if (fam === 'check' && actionFamily(o.label) === 'fold') return;
    if (!alt || o.ev > alt.ev) alt = o;
  });
  if (!alt) return { level: 'clear', alt: null, gap: 0 };
  const gap = recommended.ev - alt.ev;
  const se = Math.sqrt(Math.pow(recommended.evSe || 0, 2) + Math.pow(alt.evSe || 0, 2));
  const material = Math.max(se, Math.max(pot, 1) * 0.04);
  let level = 'solid';
  if (gap <= material * 0.5) level = 'toss-up';
  else if (gap <= material) level = 'marginal';
  else if (gap >= material * 3) level = 'clear';
  return { level: level, alt: alt, gap: gap, material: material };
}

// Which of two near-equal lines is the cheaper shot. The point is to hand over
// the trade-off, not to make the choice for them.
export function riskNote(rec, alt) {
  if (!rec || !alt) return null;
  const a = rec.amount || 0, c = alt.amount || 0;
  if (a === c) return null;
  const cheaper = a < c ? rec : alt;
  const dearer = a < c ? alt : rec;
  if ((cheaper.amount || 0) === 0) {
    return b(cheaper.label) + ' risks nothing, where ' + b(dearer.label) + ' puts ' +
      b(chips(dearer.amount || 0)) + ' at stake';
  }
  return b(cheaper.label) + ' risks ' + b(chips(Math.abs(c - a))) + ' fewer chips than ' + b(dearer.label);
}

/* ---- the coach ---- */

// spot: {
//   streetName, toCall, pot, rawEquity, rangeEquity, equitySe, degradedShare,
//   trials, opponents:[{name,foldChance,rangeTopPct,airPct,styleLabel}],
//   options:[{label,ev,amount,fold}], recommended, revealStyles, villain
// }
export function buildCoachAdvice(spot) {
  const C = spot.toCall;
  const P = spot.pot;
  const req = requiredEquity(C, P);
  const reqPct = pctWhole(req);
  const raw = pctWhole(spot.rawEquity);
  const adj = pctWhole(spot.rangeEquity);
  const ci = ci95Points(spot.equitySe);
  const opps = spot.opponents || [];
  const nOpp = opps.length;
  const lines = [];

  /* 1. the price */
  if (C > 0) {
    lines.push('To call ' + b(chips(C)) + ' here you could win ' + b(chips(P + C)) +
      ' in total, so you need ' + b(reqPct + '%') + ' equity just to break even.');
  } else {
    lines.push('Nobody has bet, so a check is free. The question is whether betting wins more than checking does.');
  }

  /* 2. raw vs range-adjusted equity */
  // Multiway, the adjusted figure is equity against EVERYONE still in, so it
  // must not be attributed to one player's range — naming only the tightest
  // silently wrote the loosest player out of the story.
  const villainPhrase = nOpp >= 2
    ? 'the combined range of the ' + nOpp + ' still in'
    : describeVillain(spot.villain, spot.revealStyles);
  if (adj !== null && raw !== null) {
    if (adj <= raw - 2) {
      lines.push('You hold ' + b(raw + '%') + ' against a random hand, but ' + villainPhrase +
        ' pulls that down to ' + b(adj + '%') + '.');
    } else if (adj >= raw + 2) {
      lines.push('You hold ' + b(raw + '%') + ' against a random hand, and ' + villainPhrase +
        ' actually lifts that to ' + b(adj + '%') + ' — their range contains hands you beat.');
    } else {
      lines.push('You hold ' + b(raw + '%') + ' against a random hand, and ' + villainPhrase +
        ' barely moves it — still about ' + b(adj + '%') + '.');
    }
  }

  /* 3. equity against the price */
  if (C > 0 && adj !== null) {
    const margin = adj - reqPct;
    const borderline = ci !== null && Math.abs(margin) <= ci;
    if (margin >= 4) {
      lines.push('That is ' + b(margin + ' points') + ' more than the price asks for, so calling makes money in the long run.');
    } else if (margin <= -4) {
      lines.push('That is ' + b(-margin + ' points') + ' short of the price, so calling loses money in the long run.');
    } else {
      lines.push('That is within a couple of points of the price — this call is close to break-even either way.');
    }
    if (borderline) {
      lines.push('The equity estimate carries about ' + b('±' + ci + ' points') +
        ', which is wider than the margin, so treat this one as genuinely close rather than clear-cut.');
    }
  }

  /* 3b. what you are actually holding */
  // The relevant read for "will fold equity carry this bet" is the joint chance
  // EVERYONE still in folds — the same multiplicative fold-equity math used for
  // bet sizing elsewhere (initializePokerTrainer.js foldChance product). A flat
  // placeholder here used to ignore who was actually at the table once there
  // were 2+ opponents, so two maniacs and two nits read identically.
  const jointFoldChance = opps.length
    ? opps.reduce(function (acc, o) { return acc * o.foldChance; }, 1)
    : 0.35;
  shapeLines(spot.shape, { foldChance: jointFoldChance })
    .forEach(function (l) { lines.push(l); });

  /* 4. multiway — and how much of that field is actually expected to stay */
  if (nOpp >= 2) {
    let crowd = b(nOpp + ' players') + ' are still in, and your hand has to beat all of them at once — ' +
      'that is why the same cards are worth less in a crowded pot than heads-up.';
    const field = spot.field;
    const expected = field ? foldsExpectedPhrase(field.expectedFolds) : null;
    if (expected) {
      crowd += ' On current reads about ' + b(expected) + ' of those still to act should fold before it comes back to you, ' +
        'so the EV figures are priced against the ' + b(String(field.contesting)) + ' expected to see it through.';
    }
    lines.push(crowd);
    const attribution = rangeAttribution(opps, spot.revealStyles);
    if (attribution) lines.push(attribution);
  }

  /* 5. fold equity — can a bet do work your hand cannot? */
  // Everything here is framed around whether aggression is the RECOMMENDED line.
  // Narrating a profitable-looking bluff and then recommending a check reads as
  // self-contradictory even when both halves are individually true.
  const rec = spot.recommended;
  const clarity = decisionClarity(spot.options, rec, P);
  const recIsAggro = !!(rec && actionFamily(rec.label) === 'aggro');
  const aggro = (spot.options || []).filter(function (o) { return o.fold !== undefined; });
  let bestAggro = null;
  aggro.forEach(function (o) { if (!bestAggro || o.ev > bestAggro.ev) bestAggro = o; });
  const read = tableFoldRead(opps);
  if (bestAggro) {
    const need = pctWhole(breakEvenFold(bestAggro.amount, P));
    const gets = pctWhole(bestAggro.fold);
    const eCalledPct = pctWhole(bestAggro.eCalled);
    if (nOpp >= 2) {
      lines.push('Raising is the tool that fixes a crowded pot: fold even one player out and both the price ' +
        'and the number of hands you have to beat come down.');
    }
    if (recIsAggro) {
      // Always say WHERE the edge comes from, so a bet is never recommended on
      // unexplained fold equity.
      if (gets >= need) {
        lines.push('A bet of ' + b(chips(bestAggro.amount)) + ' folds the field about ' + b(gets + '%') +
          ' of the time and only needs ' + b(need + '%') + ' to pay for itself, so it profits without your hand ever having to win.');
      } else {
        lines.push('This is not being recommended as a bluff: at ' + b(chips(bestAggro.amount)) +
          ' it needs ' + b(need + '%') + ' folds and gets about ' + b(gets + '%') + '.' +
          (eCalledPct === null ? ' The edge is in what happens when they call, not in them giving up.'
            : ' The edge is in what happens when they call — you hold ' + b(eCalledPct + '%') +
              ' against the range that continues against that size.'));
      }
    } else if (gets >= need) {
      // Betting genuinely clears its own bar, but is not the pick. Say both —
      // including the case where the bet leads on the point estimate and was
      // passed over because that estimate is the shakiest number in the model.
      const versus = ' (' + b(signed(rec.ev)) + ' against ' + b(signed(bestAggro.ev)) + ')';
      const head = 'A bet of ' + b(chips(bestAggro.amount)) + ' would fold the field about ' + b(gets + '%') +
        ' of the time against the ' + b(need + '%') + ' it needs, so it is a real option, not a mistake';
      if (bestAggro.ev > rec.ev) {
        lines.push(head + ' — it even shows the higher estimate' + versus + ', but the fold rate behind that ' +
          'number is a heuristic rather than a measurement, and it is extrapolated furthest at exactly this size. ' +
          b(rec.label) + ' gets to the same place for fewer chips.');
      } else if (clarity.level === 'toss-up' || clarity.level === 'marginal') {
        lines.push(head + ' — it is within touching distance of ' + b(rec.label) + versus +
          ', so take it if you would rather have the initiative.');
      } else {
        lines.push(head + ' — but ' + b(rec.label) + ' prices out better here' + versus + '.');
      }
    } else if (spot.rangeEquity < 0.45) {
      const rarely = gets < 3 ? 'they almost never fold' : 'they only fold about ' + b(gets + '%');
      lines.push('A bluff of ' + b(chips(bestAggro.amount)) + ' would need them to fold ' + b(need + '%') +
        ' of the time and ' + rarely + ', so a bluff is not advised here.');
    }
    if (!recIsAggro && spot.rangeEquity > 0.6 && gets >= 55 && !(spot.shape && spot.shape.isDrawing)) {
      lines.push('You are ahead often enough that folding them out costs you money — pick a size they can still call.');
    }
  }
  if (read.text) lines.push(read.text);

  /* 7. position */
  const posLine = positionLine(spot.position);
  if (posLine) lines.push(posLine);

  /* 6. verdict — pitched at the confidence the numbers actually support */
  const label = rec ? rec.label : 'fold';
  const fam = rec ? actionFamily(label) : 'fold';
  const action = fam === 'aggro' ? 'bet' : fam;
  const headline = b(label.charAt(0).toUpperCase() + label.slice(1));
  let core;
  if (fam === 'check') {
    core = spot.streetName === 'River'
      ? 'you get to see it through without paying for the privilege'
      : 'you keep the pot small and see the next card for nothing';
  } else if (fam === 'call') {
    core = 'your equity clears the price' +
      (bestAggro ? ', and raising folds out too much of what you already beat' : '');
  } else if (fam === 'aggro') {
    core = (bestAggro && pctWhole(bestAggro.fold) >= pctWhole(breakEvenFold(bestAggro.amount, P)))
      ? 'it wins two ways, when they fold and when you have the better hand'
      : 'not as a bluff, but because you are in good shape when they call';
  } else {
    core = C > 0 ? 'nothing here prices in' : 'nothing here is worth committing chips to';
  }

  let verdict;
  if (clarity.level === 'clear') {
    verdict = headline + ' — ' + core + '. Not close.';
  } else if (clarity.level === 'solid') {
    verdict = headline + ' looks best — ' + core + '.';
  } else if (clarity.level === 'marginal') {
    verdict = headline + ', just — ' + core + ', but ' + b(clarity.alt.label) +
      ' is inside the margin of error of it. A lean, not a rule.';
  } else {
    const risk = riskNote(rec, clarity.alt);
    const pair = ' (' + b(signed(rec.ev)) + ' against ' + b(signed(clarity.alt.ev)) + ')';
    if (clarity.gap < 0) {
      // The pick trails on the point estimate and was taken as the cheaper shot
      // at a statistically indistinguishable price. Saying "the same" here would
      // be contradicted by the two numbers right next to it.
      verdict = headline + ' is the cheaper shot. ' + b(clarity.alt.label) +
        ' shows the higher estimate' + pair + ', but ' +
        (Math.abs(clarity.gap) <= clarity.material
          ? 'the error bar on it is wider than that gap, so it is not a reliable edge'
          : 'it stakes far more to get there') +
        '.' + (risk ? ' ' + risk + '.' : '') + ' Take it only if you want the variance.';
    } else {
      verdict = 'Genuinely close: ' + headline + ' and ' + b(clarity.alt.label) +
        " are inside each other's margin of error" + pair + '.' +
        (risk ? ' ' + risk + '.' : '') +
        ' Either is defensible — this one is down to preference, not maths.';
    }
  }

  /* layer 2: frequencies */
  // An option is the same decision as the pick when the gap between them is
  // inside THEIR OWN combined error bar — measured per row, since a 1.5x-pot
  // bluff and a check carry wildly different uncertainty.
  const frequencies = (spot.options || []).slice().sort(function (x, y) { return y.ev - x.ev; })
    .map(function (o) {
      const se = rec ? Math.sqrt(Math.pow(rec.evSe || 0, 2) + Math.pow(o.evSe || 0, 2)) : 0;
      return {
        label: o.label,
        ev: signed(o.ev),
        fold: o.fold === undefined ? null : pctWhole(o.fold) + '%',
        recommended: o === rec,
        tied: !!(rec && o !== rec && Math.abs(o.ev - rec.ev) <= Math.max(se, 1)),
      };
    });

  /* layer 3: maths */
  const maths = [];
  if (C > 0) {
    maths.push('Pot odds: ' + chips(C) + ' to call into ' + chips(P) + ' → ' +
      chips(C) + '/(' + chips(P) + ' + ' + chips(C) + ') = ' + reqPct + '% required.');
    maths.push('EV(call) = e·P − (1−e)·C = ' +
      (spot.rangeEquity).toFixed(3) + '·' + chips(P) + ' − ' +
      (1 - spot.rangeEquity).toFixed(3) + '·' + chips(C) + ' = ' +
      signed(spot.rangeEquity * P - (1 - spot.rangeEquity) * C) + ' chips.');
  }
  if (bestAggro) {
    maths.push('EV(' + bestAggro.label + ') = f·P + (1−f)[e(P+B) − (1−e)B] = ' +
      signed(bestAggro.ev) + ' chips, with f = ' + pctWhole(bestAggro.fold) + '%.');
    maths.push('Break-even bluff frequency at that size: B/(P+B) = ' +
      pctWhole(breakEvenFold(bestAggro.amount, P)) + '%.');
  }
  if (adj !== null) {
    maths.push('Range-adjusted equity ' + adj + '%' + (ci === null ? '' : ' ±' + ci + ' points at 95% confidence') +
      (spot.trials ? ', from ' + spot.trials + ' simulated runouts.' : '.'));
  }

  return {
    action: action,
    clarity: clarity.level,
    verdict: verdict,
    lines: lines,
    frequencies: frequencies,
    maths: maths,
  };
}

/* ---- post-hand review: was the decision right, separately from what happened ---- */

// What kind of miss was it? A flat chip threshold treats "bet a third of the pot
// instead of a half" the same as "raise 27o instead of folding", which is both
// wrong and demoralising. Grade it against what was actually on offer, and
// separate a sizing tweak from taking the wrong line altogether. Action families
// are shared with the live coach, and defined above.
function sizeTag(label) {
  const m = label.match(/\(([^)]+)\)/);
  return m ? m[1] : null;
}
export function gradeDecision(d) {
  if (!d.best || d.cost <= 1) return 'none';
  // a miss only counts against the size of the decision it was part of
  const scale = Math.max(Math.abs(d.best.ev), d.pot * 0.05, 1);
  const rel = d.cost / scale;
  const sameFamily = actionFamily(d.taken) === actionFamily(d.best.label);
  if (rel < 0.06) return 'none';
  if (sameFamily) return rel < 0.35 ? 'sizing' : 'line';
  return rel < 0.2 ? 'close' : 'line';
}

// decisions: [{streetName, taken, evTaken, best:{label,ev,fold}, cost, equity, pot, toCall}]
// outcome:   {net, showdown, folded}
export function buildHandReview(decisions, outcome) {
  if (!decisions || !decisions.length) return null;
  const total = decisions.reduce(function (a, d) { return a + Math.max(0, d.cost); }, 0);
  let worst = decisions[0];
  let biggest = decisions[0];
  decisions.forEach(function (d) { if (d.pot > biggest.pot) biggest = d; });

  const RANK = { none: 0, sizing: 1, close: 2, line: 3 };
  decisions.forEach(function (d) { d.grade = gradeDecision(d); });
  let graded = decisions[0];
  decisions.forEach(function (d) {
    if (RANK[d.grade] > RANK[graded.grade] || (RANK[d.grade] === RANK[graded.grade] && d.cost > graded.cost)) graded = d;
  });
  worst = graded;
  const grade = graded.grade;
  const clean = grade === 'none';
  const net = outcome ? outcome.net : 0;
  const won = net > 0;
  const lines = [];

  const streetPhrase = function (name) {
    return name === 'Preflop' ? 'Preflop' : 'On the ' + name.toLowerCase();
  };

  // The decision half — always priced against the range, never against the cards.
  const priceLine = function (d) {
    const head = streetPhrase(d.streetName) + ', your line was ' + b(d.taken) + '.';
    if (d.toCall > 0) {
      const req = pctWhole(requiredEquity(d.toCall, d.pot));
      return head + ' The price asked for ' + b(req + '%') + ' and you held ' +
        b(pctWhole(d.equity) + '%') + ' against the range you faced.';
    }
    return head + ' You held ' + b(pctWhole(d.equity) + '%') +
      ' against the range you faced, with nothing to call.';
  };

  let verdict;
  if (clean && won) {
    verdict = 'Won it, and earned it.';
    lines.push('Every street you took the best line available against their range.');
    lines.push(priceLine(biggest));
    lines.push('The pot came to you as well, which is the easy version — the decisions would have been right either way.');
  } else if (clean && !won && outcome && outcome.folded) {
    verdict = 'You got out cheaply, and the decisions held up.';
    lines.push(priceLine(biggest));
    lines.push(net < 0
      ? 'You are down ' + b(chips(-net)) + ' chips on the hand, which is the blind you had already posted rather than anything the fold cost you. Folding early is how a losing hand stays cheap.'
      : 'Nothing left your stack. A hand you never had to play is a hand that cannot cost you.');
  } else if (clean && !won) {
    verdict = 'The decisions were right. The runout was not.';
    lines.push(priceLine(biggest));
    lines.push('That is a sound line that lost this time. ' +
      (net < 0 ? 'It cost ' + b(chips(-net)) + ' chips on this hand, ' : 'It did not pay off here, ') +
      'but against that range it makes money over a session. Play it the same way next time.');
  } else if (grade === 'sizing') {
    // Right idea, different number. That is a tuning note, not a mistake.
    const mine = sizeTag(worst.taken), theirs = sizeTag(worst.best.label);
    verdict = won
      ? 'Won it, and the line was right — only the size is worth a second look.'
      : 'The line was right. Only the size is worth a second look.';
    lines.push(priceLine(worst));
    lines.push('You had the right idea' + (mine && theirs ? ', and ' + b(theirs) + ' rather than ' + b(mine) + ' would have squeezed out' : ' — a slightly different size would have been worth') +
      ' about ' + b(chips(worst.cost)) + ' chips more. That is a tuning note on a line that was already correct, not a mistake.');
  } else if (grade === 'close') {
    verdict = won ? 'Won it, and it was close between two reasonable lines.' : 'A close one between two reasonable lines.';
    lines.push(priceLine(worst));
    lines.push('Against that range, ' + b(worst.best.label) + ' edges it at ' + b(signed(worst.best.ev)) +
      ' chips against your ' + b(signed(worst.evTaken)) + '. Close enough that both are defensible — mixing between them is what keeps you unreadable.');
  } else if (won) {
    verdict = 'You won it. There is still something here worth banking.';
    lines.push(priceLine(worst));
    lines.push('Against that range, ' + b(worst.best.label) + ' was worth about ' + b(signed(worst.best.ev)) +
      ' chips, against the ' + b(signed(worst.evTaken)) + ' your line was worth.');
    lines.push('The pot came your way this time, which is the best moment to notice it — nothing is at stake in fixing it now.');
  } else {
    verdict = 'One street is where this hand went.';
    lines.push(priceLine(worst));
    lines.push('Against that range, ' + b(worst.best.label) + ' was worth about ' + b(signed(worst.best.ev)) +
      ' chips, against the ' + b(signed(worst.evTaken)) + ' your line was worth — roughly ' +
      b(chips(worst.cost)) + ' chips of expected value.');
    lines.push('The rest of the swing was the cards. Fix the street, not the result.');
  }

  const frequencies = decisions.map(function (d) {
    return {
      street: d.streetName,
      taken: d.taken,
      ev: signed(d.evTaken),
      grade: d.grade,
      best: d.grade === 'none' ? null : d.best.label,
      bestEv: d.grade === 'none' ? null : signed(d.best.ev),
      fold: (d.best && d.best.fold !== undefined) ? pctWhole(d.best.fold) + '%' : null,
    };
  });

  const maths = decisions.map(function (d) {
    const req = d.toCall > 0 ? pctWhole(requiredEquity(d.toCall, d.pot)) + '% required' : 'nothing to call';
    return d.streetName + ': pot ' + chips(d.pot) + ', ' + req + ', equity ' + pctWhole(d.equity) +
      '%, your line ' + signed(d.evTaken) + ', best available ' + signed(d.best.ev) + '.';
  });
  maths.push('Total expected value given up this hand: ' + chips(total) + ' chips. ' +
    'Chips actually won or lost: ' + signed(net) + '. Those two numbers are not the same thing, and only the first one is your decision-making.');

  return { verdict: verdict, clean: clean, won: won, lines: lines, frequencies: frequencies, maths: maths };
}

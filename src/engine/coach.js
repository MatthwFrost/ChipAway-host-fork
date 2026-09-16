/* ============================================================
   COACH — plain-language decision advice.

   This file is PROSE ONLY. Every number, band and judgement it reads comes
   from spotModel.js, which derives each of them exactly once. Nothing here
   computes a fold percentage, decides whether a bluff is on, or re-bands a
   read: if a sentence needs a fact, it reads the field the model already
   settled, so no two sentences can disagree about it.

   Formulas live in spotModel.js and follow MATHS.md.
   ============================================================ */

import {
  actionFamily,
  breakEvenFold,
  buildSpotModel,
  chips,
  ci95Points,
  decisionClarity,
  foldBand,
  foldEquityDecisive,
  foldinessWord,
  foldinessWordPlural,
  pctWhole,
  positionDecisive,
  requiredEquity,
  signed,
} from './spotModel.js';

// Re-exported so callers have one import for "the coach", and so the older
// tests that reach for these keep pointing at the single implementation.
export {
  breakEvenFold, chips, ci95Points, decisionClarity, foldBand, foldinessWord,
  foldinessWordPlural, pctWhole, requiredEquity, signed,
};

const b = function (x) { return '<b>' + x + '</b>'; };

/* ---- describing opponents without leaking their hidden style ---- */

// Styles are hidden on purpose: reading them is the game. So the coach talks
// about how likely someone is to fold, which is observable, and only names the
// archetype when the player has already turned styles on.
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

// How the table as a whole behaves, in words. The read itself — who is sticky,
// who folds — was settled by the model; this only phrases it.
export function tableReadText(read) {
  if (!read || read.kind === 'none') return '';
  if (read.kind === 'sticky') {
    // Not "calling stations": a player who never folds because they raise back
    // is a different animal from one who never folds because they call, and the
    // styles are hidden anyway. Describe the behaviour, name nothing.
    return 'Two of the players left ' + foldinessWordPlural(read.sticky[1].fold) +
      ' — with that many hands unwilling to go anywhere, a bluff has nowhere to go.';
  }
  if (read.kind === 'foldy') {
    return 'Everyone left ' + foldinessWord(read.foldy[0].fold) +
      ', so a bet can win this pot outright even when your hand cannot.';
  }
  if (read.kind === 'single') {
    return read.who.name + ' ' + read.who.band.word + '.';
  }
  return 'The players left fold at different rates, so a bet has to get through all of them at once.';
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
// `bluffable` is the model's single verdict on whether a bluff is on here — the
// same field the recommendation and the opponent tips read.
export function shapeLines(shape, bluffable) {
  if (!shape) return [];
  const out = [];

  if (shape.bricked) {
    out.push('Your draw missed. There is nothing here to show down, so calling cannot win — the only way this hand takes the pot now is if they fold to a bet.');
    out.push(bluffable
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
    out.push(bluffable
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

/* ---- picking the one thing worth saying first ---- */

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

// Why the better-rated line was passed over. A bet and a call are passed over
// for different reasons, and saying "it leans on them folding" about a call is
// simply wrong.
function whyPassedOver(alt) {
  const family = alt ? actionFamily(alt.label) : 'aggro';
  if (family === 'aggro') return 'that leans on them folding, which is the hardest thing to call';
  if (family === 'call') return 'that edge is thin enough to disappear if your read is even slightly off';
  return 'that edge is too thin to count on';
}

// Why a different line still has something going for it, in one clause.
function meritClause(opt) {
  if (!opt) return null;
  const family = actionFamily(opt.label);
  if (family === 'aggro') return 'a bet can win it outright when they fold';
  if (family === 'call') return 'calling keeps their bluffs in';
  if (family === 'check') return 'checking keeps the pot small';
  return 'folding costs you nothing';
}

// The single sentence that says why this is the answer. Everything else is
// context and belongs behind the fold.
export function decisionReason(model) {
  const rec = model.recommended;
  const family = model.family;
  const price = 'You hold ' + b(model.equity.decisionPct + '%') + ' where the price needs ' +
    b(model.price.requiredPct + '%') + '.';

  if (family === 'aggro' && rec && rec.fold !== undefined) {
    const bluff = model.bluff;
    const gets = pctWhole(bluff.folds);
    const need = pctWhole(bluff.breakEven);
    const eC = pctWhole(rec.eCalled);
    // A bet is only ever SOLD as a bluff when the model says a bluff is actually
    // on. Leading with "they fold 73% of the time" while the read on this player
    // is "they never fold" was the contradiction; the gate is bluff.viable, the
    // same field the opponent tips read.
    if (bluff.viable && foldEquityDecisive(model)) {
      return 'It works because they fold about ' + b(gets + '%') + ' of the time here, and this size ' +
        (gets - need >= 5 ? 'only needs ' : 'needs ') + b(need + '%') + ' to pay for itself.';
    }
    if (eC === null) return 'It wins the pot often enough from here to be worth the chips.';
    // Not a bluff, so the case has to be made on what happens when they do not
    // fold — and if they are the sort to jam it back, that gets said, because it
    // is the risk the chips are actually exposed to.
    const jam = bluff.jamRisk
      ? ' Expect to get played back at about ' + b(pctWhole(bluff.raises) + '%') + ' of the time, so this is chips for information as much as for value.'
      : '';
    if (rec.amount < model.price.pot * 0.25) {
      return 'It only costs ' + b(chips(rec.amount)) + ' into a pot of ' + b(chips(model.price.pot)) +
        ' — cheap enough to be worth it on ' + b(eC + '%') + ' when they call.' + jam;
    }
    return 'It works even when they call: you hold ' + b(eC + '%') + ' against the hands that continue' +
      (bluff.viable && gets >= 15 ? ', and they fold about ' + b(gets + '%') + ' of the time on top of that' : '') +
      '.' + jam;
  }
  const positional = positionDecisive(model)
    ? ' Acting last from here is what tips it — out of position this is a fold.'
    : '';
  if (family === 'call') return price + positional;
  if (family === 'fold') return model.price.toCall > 0 ? price : 'Nothing here is worth putting chips in for.';
  return 'Nothing to call, so the next card is free.' + positional;
}

// At most two extra facts, each shown only when it is doing real work in this
// spot. Order is by how often the fact changes the decision.
export function quickPoints(model, ctx) {
  const opps = model.opponents;
  const shape = model.shape;
  const field = model.field;
  const candidates = [];

  if (shape) {
    if (shape.isDrawing && !ctx.reasonHasOuts) {
      candidates.push(shape.outs + ' outs — about ' + pctWhole(shape.equityFromOuts) + '% to get there by the river');
    } else if (shape.bricked) {
      candidates.push('your draw missed, so there is nothing to show down');
    } else if (shape.madeCategory === 1 && !shape.isDrawing) {
      candidates.push('a bluff-catcher: this hangs on how often they bluff, not on your pair');
    }
  }
  // Heads-up is the default mental model, so "2-way" is not news. A crowded pot
  // is, and so is a field that is about to thin out.
  const expected = field ? foldsExpectedPhrase(field.expectedFolds) : null;
  if (opps.length >= 3 || (opps.length >= 2 && expected)) {
    candidates.push(opps.length + '-way — you have to beat all of them' +
      (expected ? ', though about ' + expected + ' should fold before it gets back to you' : ''));
  }
  // The chance of being raised off the bet is a bigger fact than any range
  // description when it is real, so it goes above them.
  if (model.bluff.jamRisk && model.family === 'aggro') {
    candidates.push('they play back at this about ' + pctWhole(model.bluff.raises) +
      '% of the time — budget for a decision on the next street');
  }
  const tight = opps.filter(function (o) {
    return o.rangeTopPct !== null && o.rangeTopPct !== undefined && o.rangeTopPct <= 25;
  });
  if (tight.length === 1) {
    candidates.push(tight[0].name + ' is repping the top ' + Math.round(tight[0].rangeTopPct) + '% of hands');
  }
  const airy = opps.filter(function (o) { return o.airPct >= 25; });
  if (airy.length === 1) {
    candidates.push(airy[0].name + ' has plenty of air in that range — roughly ' + Math.round(airy[0].airPct) + '%');
  }
  if (opps.length && !model.bluff.personPasses) {
    candidates.push('nobody here folds much, so a bluff has nowhere to go');
  }
  if (model.blockerPct >= 25 && model.villain) {
    candidates.push('your cards block about ' + Math.round(model.blockerPct) + '% of ' + model.villain.name + "'s value combos");
  }
  if (model.equity.degradedShare > 0.02) {
    candidates.push('you hold so many of their likely cards that this read is a rough one');
  }
  return candidates.slice(0, 2);
}

/* ---- the coach ---- */

// Accepts the same flat spot the trainer has always passed. It is turned into a
// model exactly once, here, and every sentence below reads that model.
export function buildCoachAdvice(spot) {
  return adviceFromModel(buildSpotModel(spot));
}

export function adviceFromModel(model) {
  const C = model.price.toCall;
  const P = model.price.pot;
  const adj = model.equity.rangePct;
  const raw = model.equity.rawPct;
  const ci = model.equity.ciPoints;
  const opps = model.opponents;
  const nOpp = opps.length;
  const lines = [];

  /* 1. the price */
  if (C > 0) {
    lines.push('To call ' + b(chips(C)) + ' here you could win ' + b(chips(model.price.potIfCall)) +
      ' in total, so you need ' + b(model.price.requiredPct + '%') + ' equity just to break even.');
  } else {
    lines.push('Nobody has bet, so a check is free. The question is whether betting wins more than checking does.');
  }

  /* 2. raw vs range-adjusted equity */
  // Multiway, the adjusted figure is equity against EVERYONE still in, so it
  // must not be attributed to one player's range.
  const villainPhrase = nOpp >= 2
    ? 'the combined range of the ' + nOpp + ' still in'
    : describeVillain(model.villain, model.revealStyles);
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
    const margin = model.equity.margin;
    const borderline = ci !== null && Math.abs(margin) <= ci;
    if (margin >= 4) {
      lines.push('That is ' + b(margin + ' points') + ' more than the price asks for, so calling makes money in the long run.');
    } else if (margin <= -4) {
      lines.push('That is ' + b(-margin + ' points') + ' short of the price, so calling loses money in the long run.');
    } else {
      lines.push('That is within a couple of points of the price — this call is close to break-even either way.');
    }
    if (borderline) {
      lines.push('That gap is thin enough that it could fall either way on the day — treat this as a close call rather than a clear one.');
    }
  }

  /* 3b. what you are actually holding. The draw advice asks the model the same
     question the recommendation did, rather than re-testing a fold number
     against a threshold of its own. */
  shapeLines(model.shape, model.bluff.viable).forEach(function (l) { lines.push(l); });

  /* 4. multiway — and how much of that field is actually expected to stay */
  if (nOpp >= 2) {
    let crowd = b(nOpp + ' players') + ' are still in, and your hand has to beat all of them at once — ' +
      'that is why the same cards are worth less in a crowded pot than heads-up.';
    const field = model.field;
    const expected = field ? foldsExpectedPhrase(field.expectedFolds) : null;
    if (expected) {
      crowd += ' On current reads about ' + b(expected) + ' of those still to act should fold before it comes back to you, ' +
        'so the EV figures are priced against the ' + b(String(field.contesting)) + ' expected to see it through.';
    }
    lines.push(crowd);
    const attribution = rangeAttribution(opps, model.revealStyles);
    if (attribution) lines.push(attribution);
  }

  /* 5. fold equity — can a bet do work your hand cannot? */
  const rec = model.recommended;
  const clarity = model.clarity;
  const bestAggro = model.bestAggro;
  const bluff = model.bluff;
  const recIsAggro = model.family === 'aggro';
  if (bestAggro) {
    const need = pctWhole(bluff.breakEven);
    const gets = pctWhole(bluff.folds);
    const eCalledPct = pctWhole(bestAggro.eCalled);
    if (nOpp >= 2) {
      lines.push('Raising is the tool that fixes a crowded pot: fold even one player out and both the price ' +
        'and the number of hands you have to beat come down.');
    }
    if (recIsAggro) {
      // Always say WHERE the edge comes from, so a bet is never recommended on
      // unexplained fold equity — and never sold as a bluff the model has
      // already ruled out.
      if (bluff.viable) {
        lines.push('A bet of ' + b(chips(bestAggro.amount)) + ' folds the field about ' + b(gets + '%') +
          ' of the time and only needs ' + b(need + '%') + ' to pay for itself, so it profits without your hand ever having to win.');
      } else {
        const because = bluff.blockedBy === 'stickiness'
          ? ' They do not fold often enough for any size to get through — this is a bet for value, not to move them off anything.'
          : (bluff.blockedBy === 'reraise'
            ? ' They come back over the top about ' + b(pctWhole(bluff.raises) + '%') + ' of the time they continue, so the folds you do get are not the whole story.'
            : '');
        lines.push('This is not being recommended as a bluff: at ' + b(chips(bestAggro.amount)) +
          ' it needs ' + b(need + '%') + ' folds and gets about ' + b(gets + '%') + '.' + because +
          (eCalledPct === null ? ' The edge is in what happens when they call, not in them giving up.'
            : ' The edge is in what happens when they call — you hold ' + b(eCalledPct + '%') +
              ' against the range that continues against that size.'));
      }
    } else if (bluff.viable) {
      // Betting genuinely clears its own bar, but is not the pick. Say both.
      const versus = ' (' + b(signed(rec.ev)) + ' against ' + b(signed(bestAggro.ev)) + ')';
      const head = 'A bet of ' + b(chips(bestAggro.amount)) + ' would fold the field about ' + b(gets + '%') +
        ' of the time against the ' + b(need + '%') + ' it needs, so it is a real option, not a mistake';
      if (bestAggro.ev > rec.ev) {
        lines.push(head + ' — it even rates higher on paper' + versus + '. That rating rests on how often they ' +
          'give up, though, which is the hardest thing to judge about anyone, and a bet this size leans on it hardest. ' +
          b(rec.label) + ' gets to the same place for fewer chips.');
      } else if (clarity.level === 'toss-up' || clarity.level === 'marginal') {
        lines.push(head + ' — it rates about the same as ' + b(rec.label) + versus +
          ', so take it if you would rather have the initiative.');
      } else {
        lines.push(head + ' — but ' + b(rec.label) + ' prices out better here' + versus + '.');
      }
    } else if (model.equity.range < 0.45) {
      const rarely = gets < 3 ? 'they almost never fold' : 'they only fold about ' + b(gets + '%');
      lines.push('A bluff of ' + b(chips(bestAggro.amount)) + ' would need them to fold ' + b(need + '%') +
        ' of the time and ' + rarely + ', so a bluff is not advised here.');
    }
    if (!recIsAggro && model.equity.range > 0.6 && bluff.folds >= 0.55 && !(model.shape && model.shape.isDrawing)) {
      lines.push('You are ahead often enough that folding them out costs you money — pick a size they can still call.');
    }
  }
  const readText = tableReadText(model.tableRead);
  if (readText) lines.push(readText);

  /* 7. position */
  const posLine = positionLine(model.position);
  if (posLine) lines.push(posLine);

  /* 6. verdict — short, and pitched at how clear-cut this actually is. */
  const label = rec ? rec.label : 'fold';
  const headline = b(label.charAt(0).toUpperCase() + label.slice(1));
  const reason = decisionReason(model);

  let verdict;
  let extra = null;
  if (clarity.level === 'clear' || clarity.level === 'solid') {
    verdict = headline + '.';
  } else if (clarity.level === 'marginal') {
    verdict = headline + ', just — but ' + b(clarity.alt.label) +
      (actionFamily(clarity.alt.label) === 'fold'
        ? ' gives up very little here.'
        : ' also looks positive.');
  } else if (clarity.gap < 0) {
    // The pick trails on the raw number and was taken as the cheaper shot.
    verdict = headline + ' — the safer play.';
    const risk = riskNote(rec, clarity.alt);
    extra = b(clarity.alt.label) + ' rates higher on paper (' + b(signed(clarity.alt.ev)) +
      '), but ' + whyPassedOver(clarity.alt) +
      (risk ? ', and ' + risk : '') + '. Take it only if you fancy the gamble.';
  } else {
    verdict = headline + ' or ' + b(clarity.alt.label) + ' — your call.';
    const risk = riskNote(rec, clarity.alt);
    const merit = meritClause(clarity.alt);
    extra = 'Both rate about the same here (' + b(signed(rec.ev)) + ' against ' +
      b(signed(clarity.alt.ev)) + ').' + (risk ? ' ' + risk + ',' : '') +
      (merit ? ' but ' + merit + '.' : '');
  }

  /* layer 2: frequencies */
  // An option is the same decision as the pick when the gap between them is
  // inside THEIR OWN combined error bar.
  const frequencies = model.options.slice().sort(function (x, y) { return y.ev - x.ev; })
    .map(function (o) {
      const se = rec ? Math.sqrt(Math.pow(rec.evSe || 0, 2) + Math.pow(o.evSe || 0, 2)) : 0;
      return {
        label: o.label,
        ev: signed(o.ev),
        fold: o.fold === undefined ? null : pctWhole(o.fold) + '%',
        raise: (o.raise === undefined || o.raise === null) ? null : pctWhole(o.raise) + '%',
        recommended: o === rec,
        tied: !!(rec && o !== rec && Math.abs(o.ev - rec.ev) <= Math.max(se, 1)),
      };
    });

  /* layer 3: maths */
  const maths = [];
  if (C > 0) {
    maths.push('Pot odds: ' + chips(C) + ' to call into ' + chips(P) + ' → ' +
      chips(C) + '/(' + chips(P) + ' + ' + chips(C) + ') = ' + model.price.requiredPct + '% required.');
    maths.push('EV(call) = e·P − (1−e)·C = ' +
      model.equity.range.toFixed(3) + '·' + chips(P) + ' − ' +
      (1 - model.equity.range).toFixed(3) + '·' + chips(C) + ' = ' +
      signed(model.equity.range * P - (1 - model.equity.range) * C) + ' chips.');
  }
  if (bestAggro) {
    const r = bestAggro.raise || 0;
    maths.push('EV(' + bestAggro.label + ') = f·P + c[e(P+B) − (1−e)B] + r(−B) = ' +
      signed(bestAggro.ev) + ' chips, with f = ' + pctWhole(bestAggro.fold) + '%' +
      (r ? ', r = ' + pctWhole(r) + '%' : '') + '.');
    maths.push('Break-even bluff frequency at that size: B/(P+B) = ' + pctWhole(bluff.breakEven) + '%.');
    maths.push('Bluff verdict: folds ' + pctWhole(bluff.folds) + '% against ' + pctWhole(bluff.breakEven) +
      '% needed — ' + (bluff.viable ? 'a bluff is on.' : 'not a bluff (' + bluff.blockedBy + ').'));
  }
  if (adj !== null) {
    maths.push('Range-adjusted equity ' + adj + '%' + (ci === null ? '' : ', give or take ' + ci + ' points') +
      (model.equity.trials ? ', from ' + model.equity.trials + ' simulated runouts.' : '.'));
  }

  const points = quickPoints(model, { reasonHasOuts: /outs/.test(reason) });

  // When the pick trails on the raw number, the price sentence can read as a
  // flat contradiction of it ("you hold 16% where the price needs 14%" over a
  // fold). The trade-off sentence says everything that matters there.
  const trailing = clarity.level === 'toss-up' && clarity.gap < 0;

  return {
    action: model.action,
    clarity: clarity.level,
    verdict: verdict,
    reason: trailing ? extra : (extra ? reason + ' ' + extra : reason),
    points: points,
    lines: lines,
    frequencies: frequencies,
    maths: maths,
    model: model,
  };
}

/* ---- post-hand review: was the decision right, separately from what happened ---- */

// What kind of miss was it? A flat chip threshold treats "bet a third of the pot
// instead of a half" the same as "raise 27o instead of folding", which is both
// wrong and demoralising. Grade it against what was actually on offer, and
// separate a sizing tweak from taking the wrong line altogether.
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

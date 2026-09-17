# Coach nudge in the bubble, answers in the review

**Date:** 2026-09-17
**Status:** approved, ready to implement

## The problem

Pressing "Ask the coach" dumps seven things into a chat bubble: a verdict, a
confidence tag, a reason, bullet points, a range bar, a blocker line and three
collapsible sections. It is more than a bubble can hold and more than a player
can read mid-decision, and the bubble is the wrong surface for most of it.

## The change

Two moves, and they depend on each other.

1. **The bubble stops answering.** The "Ask the coach" button goes away
   entirely. The coach now speaks on its own, every time it is the hero's turn,
   and what it says is a **nudge**: a short prompt that points at the thing
   worth thinking about without naming the action to take.

2. **The answers move to the hand review.** Everything the bubble used to show —
   verdict, confidence, reason, points, range bar, blockers, action frequencies
   and the maths — appears in the review modal after the hand, split into one
   collapsible section per decision.

The pedagogy survives the loss of the button. The old design made you press a
button to avoid being spoon-fed; the new one never feeds you the answer live at
all, and pays out the full reasoning once the hand can no longer be influenced
by it.

## Design

### 1. `buildCoachNudge(model)` — new, in `coach.js`

A pure function over the same spot model `adviceFromModel` consumes, so the
nudge cannot drift out of step with the answer shown later. Returns a string of
one or two sentences.

**Invariant:** the nudge never names the recommended action and never states the
verdict. This is asserted in tests, not just intended.

Branches, in priority order:

| Condition | Nudge |
|---|---|
| Facing a bet (`toCall > 0`) | Price-first: *"The pot is asking you for **24%** to call. Do you beat that against the hands they would bet here?"* |
| Preflop, nothing to call | Position and shape: *"You are in the **cutoff** with 3 players left to act behind you. Is this a hand you want to play out of position?"* |
| Postflop, checked through | Initiative and texture: *"Nobody has claimed this pot. Does this board favour your range or theirs?"* |
| Nothing meaningful to ask (all-in, no options) | A `locked` quip — see below |

The fallback exists because a forced question on a spot with no decision reads
as hollow, and hollow coaching teaches players to ignore the coach.

### 1b. `coachQuip(kind, n)` — filling the silences

The bubble is never empty. When there is no question to ask it holds small talk
instead, in two registers: `idle` before a deal and between hands, `locked` when
the chips are already in and nothing is left to weigh.

Quips are indexed by hand number rather than drawn at random. A random draw
would re-roll every time a bot acted and leave the bubble flickering; keyed to
the hand, the line holds steady for the whole hand and changes with the next
one. The index is taken modulo the list length and guarded against a negative
or non-finite count, because a bubble that throws is worse than one that
repeats itself.

Quips are bound by the same rule as the nudge: they never name an action. This
is asserted across every quip in both registers.

### 1c. `coachReaction(kind, n)` — answering the move

Playing a move and being handed generic small talk reads as not being listened
to, so the bubble answers the move instead: one register per action family
(`fold`, `check`, `call`, `aggro` for bets and raises).

Reactions **may** name the action — it has already been played, so there is
nothing left to give away. They must never **grade** it. Whether the move was
right belongs to the review, and saying it in the bubble both pre-empts the
review and passes judgement before the runout is known. A test asserts no
reaction contains good/bad/nice/wrong/mistake/should/better/worse/correct.

### 1d. One painter for the bubble

The three states are decided in a single `paintBubble()` rather than by whoever
happens to call last:

1. hero is to act → the nudge
2. hero has just moved, hand still live → the reaction
3. otherwise → an idle quip

Splitting this across callers is exactly what produced the bug this section
fixes: `recordDecision()` set the reaction and `disableHeroControls()` painted
straight over it with small talk. `lastHeroAction` resets at hand start and on
every street change, since a reaction to last street's move is stale the moment
a new card lands.

### 2. The bubble slims down

`CoachPanel.jsx` becomes avatar + bubble + a single `#coachNudge` div. Removed
from the component: `#eqHidden`, `#btnRevealEq`, `#eqBody`, `#coachVerdict`,
`#coachConf`, `#coachReason`, `#coachPoints`, `#rangeBar`, `#eqSub`,
`#coachLines`, `#coachFreqBody`, `#coachMathsBody`, `#valueBet`.

In the engine: `showCoach()` and `hideCoach()` are replaced by `renderNudge()`
and `clearNudge()`. The five `hideCoach()` call sites become `clearNudge()`.
The `btnRevealEq` click listener is deleted. `enableHeroControls()` calls
`renderNudge()` after it snapshots the spot.

### 3. Capturing the advice at decision time

`recordDecision()` builds the full advice from the live spot and stores it on
the decision record, alongside the range-bar and blocker figures the bubble used
to render.

This has to happen at decision time. The spot model depends on which players are
still live and on range state that decays every street, so rebuilding the advice
at hand end from the stored scalars would quietly produce answers that were
never true.

Cost is negligible: `enableHeroControls()` already runs the Monte Carlo equity
sim via `renderEquityTab()`, so the advice build is string assembly over numbers
already paid for.

### 4. The review grows per-street sections

`renderHandReview()` keeps its top verdict and narrative lines unchanged — that
is `buildHandReview()`, which is well covered by existing tests. Below it, the
flat "Street by street" table and flat "Show the maths" section are **replaced**
by one collapsible per decision:

```
▾ Flop — you called 40   (−12 chips)
    Call — clear
    The price asked for 24%; you held 38%.
    • their range is wide here
    • you block their nut combos
    [range bar] [blocker line]
    ▸ Action frequencies   ▸ Show the maths
```

The frequency-table and maths-list markup builders move into shared helpers,
since the old bubble and the new review emit identical HTML for both.

## Tests

- `coach.test.js` gains coverage for `buildCoachNudge`: one case per branch, plus
  the invariant that the returned string never contains the recommended action
  label or the advice verdict.
- `App.smoke.test.jsx` currently drives the coach by clicking `#btnRevealEq` and
  asserting on six ids that this change removes. That block is rewritten to
  assert the nudge renders with no click, and that the post-hand review contains
  per-street coach detail.

## Files

`src/engine/coach.js`, `src/engine/coach.test.js`,
`src/components/CoachPanel.jsx`, `src/engine/initializePokerTrainer.js`,
`src/styles.css`, `src/App.smoke.test.jsx`.

## Out of scope

The equity tab, the range-guess panel and the session charts are untouched. The
`buildHandReview()` verdict logic is untouched.

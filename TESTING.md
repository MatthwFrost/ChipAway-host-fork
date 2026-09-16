# Testing ChipAway

Three layers, in increasing order of how long they take and how much they tell you.

| what | command | time | when to run |
|---|---|---|---|
| unit + consistency | `npm test` | ~40s | every change |
| calibration | `npm run sim:calibrate` | ~40s | changing profiles or the fold model |
| advice backtest | `npm run sim:backtest` | ~11 min | **changing anything in the coach** |
| both simulations | `npm run sim` | ~14 min | before a release |
| re-fit the model | `npm run sim:tune` | ~12 min | after changing bot behaviour |
| before/after A/B | `npm run sim:compare` | ~20 min | after changing the model |
| coefficient sweep | `npm run sim:sweep` | ~15 min | choosing a coefficient's value |

Everything is seeded. The same command gives the same numbers on any machine.

---

## 1. `npm test` — unit and consistency

249 tests. The ones worth knowing about:

- **`adviceConsistency.test.js`** sweeps 720 spots (every profile × field × pot
  shape × equity × hand shape × styles on/off), renders every surface the player
  can read, and asserts no two of them can contradict each other. This is the
  suite that exists because the coach once recommended a bluff underneath a tip
  saying "do not bluff this player".
- **`evaluator.test.js`** checks the fast hand evaluator against the original
  "try all 21 five-card subsets" definition on 300,000 random hands. The fast
  one replaced the slow one for speed; this is the proof they are the same.
- **`equity.test.js`** checks the Monte Carlo engine against exact enumeration
  on real board textures.
- **`table.test.js`** checks the headless game is legal poker: zero-sum, no
  negative stacks, correct side pots, reproducible from a seed.

---

## 2. `npm run sim:calibrate` — is the model telling the truth?

The app makes the same claim twice, in two places:

```
opponentModel.responseTo()   PREDICTS   fold / call / raise
botPolicy.decidePostflop()   PERFORMS   fold / call / raise
```

Every number the coach shows rests on the first. The game the player actually
sits at is the second. This plays 10,000 hands and records, for every decision a
bot makes facing a bet, what the model said would happen next to what did.

```bash
npm run sim:calibrate                 # 10,000 hands
node src/harness/run.js calibrate --hands=100000
node src/harness/run.js calibrate --hands=10000 --seed=42
```

### Reading the output

```
  profile        n   fold: model / real  gap   call: model / real  gap   raise: model / real  gap    TVD
  ------------------------------------------------------------------------------------------------------
  nit         1534       46.4 / 36.7 +  9.7       50.6 / 47.8 +  2.8         3.0 / 15.4 -12.5    12.5
  station     9274       42.1 / 12.2 + 29.9       56.2 / 84.5 -28.2         1.6 /  3.3  -1.7    29.9
```

- **n** — how many decisions went into the row. Under ~200 and the row is noise.
- **model / real** — predicted frequency, then what actually happened.
- **gap** — model minus reality, in percentage points. **Positive on `fold`
  means the coach believes it has more fold equity than it really has.**
- **TVD** — total variation distance, the single summary number. 0 means the
  model describes the table exactly; 100 means it describes a different game.
  **Under 10 is good. Over 20 means the advice is materially wrong.**

The second table breaks the fold rate down by bet size (bet ÷ pot before the
bet). Use it to find *where* a profile is mispredicted — a model that is right
for small bets and wrong for big ones has a sizing problem, not a range problem.

---

## 3. `npm run sim:backtest` — is the advice worth chips?

**This is the first place to look if you change the coach.**

Five hero policies each play the same 10,000 hands against the same five bots.
Only hero's decisions differ.

| policy | what it does |
|---|---|
| `coach` | takes whatever `decision.snapshotSpot()` ranks best — the exact recommendation the app puts on screen |
| `tag-bot` | plays hero as a competent TAG bot |
| `always-call` | calls or checks, never folds, never raises |
| `random` | picks uniformly among the options the coach priced, ignoring EV |
| `always-fold` | folds everything — the floor, loses exactly the blinds |

```bash
npm run sim:backtest                                    # 10,000 hands
node src/harness/run.js backtest --hands=50000
node src/harness/run.js backtest --hands=10000 --policies=coach,always-call
node src/harness/run.js backtest --hands=2000 --json    # machine-readable
```

### Reading the output

```
  policy            bb/100     ± se   total chips   sd/hand  showdown
  -------------------------------------------------------------------
  coach             138.43  ±201.59        16,611      49.4     75.8%

  alternative      coach edge bb/100     ± se       z   verdict
  ----------------------------------------------------------------------
  always-call                 117.47  ±301.54     0.4   no clear difference
```

- **bb/100** — big blinds won per hundred hands, the standard unit.
- **sd/hand** — standard deviation per hand, in big blinds. Expect 20-45. This
  game is high variance: 50bb stacks and five loose bots, so one won multiway
  all-in is worth up to +250bb. **A value above 250 is impossible and means the
  accounting is broken** — that is exactly how two bugs in the first runs were
  caught.
- **Every hand starts at a fixed 50bb stack.** Each hand is an independent
  sample, which is how a win rate is measured. Without the reset a winning
  policy compounds its stack, ends up hundreds of big blinds deep against 50bb
  opponents, and the variance becomes unbounded and meaningless. Pass
  `resetStacks: false` to `createTable` if you want to watch a session instead.
- **coach edge** — the paired difference. All policies are dealt **identical
  cards** for a given hand number (a separate RNG stream deals, so hero's
  choices cannot shift the deal), which removes most of the card luck.
- **z** — the paired edge in standard errors. **|z| < 2 means you have not
  measured anything.** |z| > 2 is a real difference, |z| > 3 is a strong one.

### If z is under 2, run more hands

The edge you are trying to detect is roughly `sd/hand × 100 / sqrt(hands)` in
bb/100. With sd ≈ 50bb, 10,000 hands resolves about ±50 bb/100. To halve that,
quadruple the hands.

---

## Arguments

Both harnesses take the same flags, after the subcommand:

| flag | default | meaning |
|---|---|---|
| `--hands=N` | `10000` | hands to play |
| `--seed=N` | `20260916` | change the deal and the decisions |
| `--policies=a,b,c` | all five | backtest only |
| `--json` | off | emit raw numbers instead of tables |

```bash
node src/harness/run.js all --hands=25000 --seed=7
```

---

## Architecture: why the harness measures the real thing

A simulation that re-implements the logic it is testing proves nothing. Nothing
in `src/harness/` contains a poker decision. The shared modules are:

```
opponentModel.js   ranges, fold/call/raise prediction, EV formulas
spotModel.js       one derivation of every number and every read
coach.js           prose only — computes nothing
botPolicy.js       what a bot does, as a pure function
decision.js        pricing hero's options and picking one  ← the coach
equity.js          range index + Monte Carlo
table.js           headless game loop (the ONLY duplicated thing: plumbing)
```

The app (`initializePokerTrainer.js`) and the harness both import the same
`botPolicy.js` and `decision.js`. When the backtest says "the coach made 138
bb/100", that is the coach that ships.

The one duplication is the betting loop itself — the app's is animation-driven
and cannot be run ten thousand times. `table.js` re-implements the plumbing
(blinds, action order, raise legality, side pots, street progression) and is
tested directly in `table.test.js`.

---

## Current results

Recorded at 10,000 hands, seed 20260916. Re-run after any model change.

### Calibration: two metrics, and the difference matters

| profile | TVD before | TVD now | cTVD now | worst bucket |
|---|---|---|---|---|
| nit | 12.5 | **4.4** | 7.8 | 22.3 |
| tag | 16.3 | **4.8** | 11.5 | 34.3 |
| lag | 18.1 | **5.3** | 13.0 | 48.6 |
| station | 29.9 | **4.9** | 7.6 | 16.1 |
| maniac | 29.2 | **2.0** | 9.4 | 24.2 |

**TVD** is the marginal action mix. **cTVD** is the same thing measured *within*
bet-size buckets. The distinction is not academic:

> Fitting to marginal TVD produced a beautiful headline (0.2–1.9) and **worse
> advice**. Refitting to conditional TVD made the headline *worse* (2–5) and the
> coach about **+50 bb/100 better**. A model can be perfect on average while
> being 15 points wrong at every individual bet size, and it is the conditional
> accuracy that drives decisions.

**Judge the model on cTVD and on bb/100, not on TVD.**

#### What was fixed, in order of what it bought

1. **Separate preflop and postflop parameters.** The two regimes were wrong in
   *opposite* directions — preflop under-predicting folds by 16–27 points,
   postflop over-predicting by 15–31. A single blended figure hid it completely.
2. **A conditional objective plus a fittable `sizeSlope`.** Worth about
   +50 bb/100 on its own.
3. **A positional term in the preflop model** (`posWeight`). The bots scale
   their preflop continuing range by `posMult × fieldBoost`, so a model without
   position was predicting one number for the button and for under the gun.
   This took station's worst preflop bucket from **57.3 to 16.1** and its cTVD
   from 22.3 to 10.4. The fit gave the loosest profiles the highest positional
   sensitivity (station 1.6, maniac 1.55, tag 0.35), which is a result rather
   than an instruction.
4. **The raise branch stopped assuming hero folds.** Not a calibration change at
   all — a decision-rule fix — and worth **+61.9 bb/100 on its own (z = 2.2)**.

#### What is still wrong

- `lag` and `tag` still carry cTVD of 13.0 and 11.5, with worst buckets near 48
  and 34. Both are preflop.
- Postflop, reality is **non-monotonic in bet size** — the fold rate peaks around
  half pot and *falls* for larger bets, because a player facing a big bet has
  usually already committed and holds a strong range. The model's size response
  is monotone and cannot represent that shape.

#### What was tuned, and what deliberately was not

Only the parameters **the prediction model reads**: `continueBias`,
`airPersistence`, `reRaise`, `sizeSlope`, `posWeight` and their `*Pre` twins.
`callBuffer`, `sigRaise`, `polar` and `bluffFreq` drive what the bots actually
*do*, so tuning those would move the ground truth instead of fitting it. The
tuner also refuses to fit a parameter the data cannot identify — a profile
holding no air says nothing about its `airPersistence` — and marks those `*`.

### Backtest: the coach now leads the field

10,000 hands, seed 20260916:

| policy | bb/100 | vs coach | z | verdict |
|---|---|---|---|---|
| **coach** | **+184.4** | — | — | — |
| lag-bot | +180.0 | +4.4 | 0.1 | level |
| tag-bot | +162.2 | +22.3 | 0.7 | level |
| nit-bot | +129.9 | +54.6 | 1.8 | level |
| always-fold | −24.7 | +209.1 | 6.6 | coach wins |
| always-call | −992.1 | +1176.5 | 30.0 | coach wins |
| random | −1079.5 | +1263.9 | 30.3 | coach wins |

The coach started this work **−112 bb/100 behind the TAG bot (z = −4.9)** and now
sits marginally ahead of every bot baseline, statistically level with the best of
them. It crushes the bad habits by margins no sample size could doubt.

**Sanity check to look for first:** `always-fold` should land at about
**−25 bb/100**. Six handed, the blinds cost (10 + 20) / 6 = 5 chips a hand,
which is 0.25bb, which is 25 bb/100. If that number is wrong, nothing else on
the page means anything.

### What each change was actually worth

Every figure below is a paired measurement on identical hands, isolated with
`npm run sim:compare` or `npm run sim:sweep`. This table is the point of the
whole harness: five plausible-sounding improvements, and they did not behave
remotely alike.

| change | bb/100 | z | kept? |
|---|---|---|---|
| Fit the model to the bots (marginal objective) | +64.3 | 2.2 | yes |
| Re-raise branch: hero keeps the option to continue | +61.9 | 2.2 | yes |
| Conditional objective + fittable `sizeSlope` | ≈ +50 | — | yes |
| Positional term in the preflop model | calibration only | — | yes |
| Implied + reverse implied odds | **+37.6** combined over 40k hands | **2.9** | yes |
| **Barrel value (multi-street fold equity)** | **−37.5** | −1.0 | **no** |

Two of those deserve spelling out.

**The barrel term was harmful, and it looked obviously right.** Crediting a bet
with next street's fold equity is standard poker reasoning. The sweep says
otherwise, monotonically:

```
barrel   0    -> +148.8 bb/100
         0.08 -> +116.9
         0.15 -> +113.4
         0.35 -> +111.4
```

It double-counts with the re-raise branch, and the range that just *called* a bet
is stronger than the one that faced it — so the next-street fold equity being
credited is not there. Defaulted to **0**, kept switchable.

**Implied odds had a bug that made half of it dead code.** `handShape` sets
`isMade` only from two pair upward, so a condition written as
`isMade && madeCategory <= 1` can never fire and the entire reverse-implied
branch never ran. The first measurement was of half a feature.

After the fix, measured on two independent seeds and combined by inverse
variance:

| sample | effect | ± se | z |
|---|---|---|---|
| 20,000 hands, seed 20260916 | +30.7 | ±18.8 | 1.6 |
| 20,000 hands, seed 777 | +44.2 | ±18.5 | 2.4 |
| **combined, 40,000 hands** | **+37.6** | **±13.2** | **2.9** |

Neither sample alone would have settled it — the first reads as "probably" and
the second as "just about". Replicating on a second seed and pooling is what
turned it into a result, and is the pattern to follow for anything in the
30-50 bb/100 range.

---

## `npm run sim:tune` — re-fitting the model

Records every decision the bots make once, then re-scores those same decisions
under thousands of candidate parameter sets. The sweep costs no simulation.

```bash
npm run sim:tune                              # 20,000 hands
node src/harness/tune.js --hands=40000
```

It prints the fitted values ready to paste into `PROFILES`, with `*` against any
parameter the data could not identify. **Run this after changing anything about
how the bots play** — the model is fitted to them, so if they move, it drifts.

## `npm run sim:compare` — did a model change help?

Replays the same hands under two model configurations, changing nothing else,
and reports the paired difference with an error bar.

```bash
node src/harness/compare.js --hands=20000                      # vs the original model
node src/harness/compare.js --hands=10000 --baseline=marginal   # vs the first fit
node src/harness/compare.js --hands=10000 --baseline=current --future=none
node src/harness/compare.js --hands=10000 --baseline=current --raise-factor=0
```

`--baseline` picks a stored parameter set (`legacy`, `marginal`, `no-position`,
`current`). `--future` and `--raise-factor` switch off individual non-parameter
changes so they can be measured alone.

## `npm run sim:sweep` — what value should this coefficient be?

```bash
node src/harness/sweep.js --hands=5000 --field=barrel --values=0,0.1,0.2,0.35
node src/harness/sweep.js --hands=5000 --field=implied --values=0,0.3,0.6 --fixed=barrel:0
```

Every candidate plays identical deals and is paired against the first.

---

## How much data do you need?

`sd/hand` is about 20–30bb, so the standard error on a paired comparison is
roughly `100 × sd / sqrt(hands)` bb/100:

| hands | ± se | can resolve (z=2) |
|---|---|---|
| 5,000 | ~37 | 75 bb/100 |
| 20,000 | ~19 | 38 bb/100 |
| 80,000 | ~9 | 19 bb/100 |

Two runs on **different seeds** can be pooled by inverse variance, which is
usually cheaper than one run of twice the length and gives a replication check
for free.

Most single model changes are worth 30–60 bb/100, so **5,000 hands cannot settle
anything** and 20,000 is the practical minimum for a real decision. Two of the
conclusions above were reversed by moving from 5,000 to 20,000 hands.

## Known remaining gaps

1. **The size response is monotone; reality is not.** Postflop the fold rate
   peaks near half pot and falls for bigger bets, because a player facing a large
   bet has usually already committed. A quadratic term in `ln(B/P)`, or per-bucket
   coefficients, would let the model fit the hump. This is the best remaining
   lead — it targets the largest measured residual (worst buckets 34–49 for tag
   and lag) and costs one parameter.
2. **Only five bet sizes are priced** (⅓, ½, ¾, pot, 1.5×). Adding ¼ and 2× is a
   fifteen-minute experiment; the gain is bounded by how flat EV is between
   adjacent sizes, which is usually very flat.
3. **No true multi-street planning.** The barrel experiment shows a naive version
   is worse than nothing; a real one needs a game tree, not a correction term.

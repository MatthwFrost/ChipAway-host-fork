# The maths behind ChipAway

Every number the app shows you, derived. Nothing here is a heuristic dressed up as a formula — where something *is* a heuristic (the range model, the profile parameters), it says so explicitly.

Notation used throughout:

| | |
|---|---|
| $P$ | the pot **before** the action under consideration |
| $B$ | size of a bet or raise |
| $C$ | amount you must call |
| $e$ | your equity — probability you win at showdown |
| $f$ | probability all opponents fold |

---

## 1. Hand evaluation

### Combinatorics

A 7-card holding (2 hole + 5 board) contains

$$\binom{7}{5} = 21$$

distinct 5-card hands. The evaluator generates all 21, scores each, and keeps the maximum. There are $\binom{52}{5} = 2{,}598{,}960$ distinct 5-card hands in total, and $\binom{52}{2} = 1326$ distinct starting hands — that 1326 is the size of the range space the app works in.

### Scoring

Each 5-card hand maps to a comparable vector

$$s = [\text{category}, t_1, t_2, \ldots]$$

where category runs 0 (high card) to 8 (straight flush), and the $t_i$ are tiebreakers in descending significance. Comparison is lexicographic: compare categories; if equal, compare $t_1$; and so on. This handles kickers correctly without special-casing — `A♠A♥K♦Q♣7♠` beats `A♦A♣K♠J♥9♦` because the vectors are $[1,14,13,12,7]$ vs $[1,14,13,11,9]$ and they first differ at the third element.

The wheel (A-2-3-4-5) is special-cased: the ace counts low, so the straight is scored as 5-high, not ace-high.

For fast range sorting, the vector is packed into a single integer via base-15 positional encoding:

$$k = \sum_{i=0}^{5} s_i \cdot 15^{5-i}$$

Base 15 because no component exceeds 14 (an ace). This makes range sorting a single numeric sort rather than 1326 vector comparisons.

---

## 2. Equity by Monte Carlo

### Why not exact enumeration

Exact multiway equity means enumerating every opponent holding against every runout. On the flop against 3 opponents that's

$$\binom{47}{2}\binom{45}{2}\binom{43}{2}\binom{41}{2} \approx 1.1 \times 10^{12}$$

which is not happening in a browser between clicks. So: sample.

### The estimator

Run $n$ independent trials. In each, deal opponents' hands and complete the board, then evaluate. Let $W$ be wins and $T$ ties. The estimate is

$$\hat{e} = \frac{W + T/2}{n}$$

Ties count as half because a split pot returns your stake and half the profit — for EV purposes a tie is worth exactly half a win.

### How wrong is it?

Each trial is a Bernoulli draw, so $\hat{e}$ has standard error

$$\mathrm{SE} = \sqrt{\frac{e(1-e)}{n}}$$

This is maximised at $e = 0.5$, giving the worst case for each sample size the app uses:

| Where | $n$ | SE (worst case) | 95% CI |
|---|---|---|---|
| Bot decisions | 170 | ±3.83 pp | ±7.5 pp |
| EV snapshot | 520 | ±2.19 pp | ±4.3 pp |
| Equity panel | 900 | ±1.67 pp | ±3.3 pp |
| Counterfactual runout | 2200 | ±1.07 pp | ±2.1 pp |

Error falls as $1/\sqrt{n}$, so halving the error costs 4× the compute. The bots deliberately run at low $n$: they're *supposed* to be uncertain, and the noise makes them less robotically consistent. The panel you read runs at higher $n$ because you'd notice a number jittering by 8 points.

Reading a panel figure of 34%: the true value is very likely between 31% and 37%. Don't treat the decimal as meaningful.

---

## 3. The range model

**This is the part that is a model, not a theorem.** Real ranges are sets of specific combos with weights. The app approximates them with a strength quantile plus a bluff band. Fast and useful, but an approximation, and it's the main thing that would change if the project went further.

### Representation

Each player carries two numbers:

- $r_{\text{lo}} \in [0,1]$ — the quantile floor of their **value** range. $r_{\text{lo}} = 0.85$ means "top 15% of hands on this board."
- $r_{\text{bluff}} \in [0,1]$ — the fraction of their range that is pure air.

All 1326 combos (minus board cards) are ranked by current strength, giving an ordered index. Sampling draws uniformly from $[r_{\text{lo}}, 1]$ with probability $1 - r_{\text{bluff}}$, and from $[0, 0.34]$ — the bottom third — with probability $r_{\text{bluff}}$.

The result is a **polarised** range: strong hands and air, few middling ones. This matters enormously. Against a purely linear range (top X% only) you should fold every bluff-catcher, because everything they can hold beats you. It's the bluff mass that makes calling correct, so a model without it teaches you to over-fold.

### Preflop strength: the Chen formula

Before a board exists there's no made-hand strength to rank by, so the app uses a modified [Chen formula](https://en.wikipedia.org/wiki/Poker_strategy):

1. **High card:** A = 10, K = 8, Q = 7, J = 6, else rank/2
2. **Pairs:** double the high-card value, minimum 5
3. **Suited:** +2
4. **Gap penalty:** 1 gap −1, 2 gaps −2, 3 gaps −4, 4+ gaps −5
5. **Connector bonus:** +1 if gap ≤ 1 and both cards below Q

The app adds **+2 to all pairs** beyond standard Chen. This is a deliberate correction for implied odds: 22 has poor raw equity but flops a set 11.76% of the time, and when it does it often wins a stack. Raw equity systematically undervalues small pairs, and without this correction the bots fold them — which was a real bug in an earlier version.

### Updating on action

When a player bets $B$ into $P$, everyone's read on them tightens:

$$r_{\text{lo}} \leftarrow \max\left(r_{\text{lo}},\ \sigma_{\text{raise}} + 0.13\left(\frac{B}{P} - 0.62\right)\right)$$

$\sigma_{\text{raise}}$ is per-profile: a nit's raise implies 0.82 (top 18%), a maniac's implies 0.33 (top 67%). The $B/P$ term is why **sizing carries information** — a 2×-pot bet narrows the range considerably more than a ⅓-pot stab.

Bluff share grows with sizing too, since big bets are more polarised:

$$r_{\text{bluff}} \leftarrow \text{clamp}\left(\pi \cdot (0.55 + 0.62 \tfrac{B}{P}) \cdot \phi \cdot 2.4,\ 0,\ 0.42\right)$$

where $\pi$ is the profile's polarisation tendency and $\phi$ its bluff frequency.

Each new street multiplies $r_{\text{lo}}$ by 0.88 and $r_{\text{bluff}}$ by 0.80 — a new card partially invalidates old reads. This is a crude stand-in for proper multi-street range tracking.

### Blockers

Cards you hold cannot be in their hand. Sampling rejects any combo containing a known card, so holding the A♠ genuinely removes every A♠-containing combo from their range. The panel reports the fraction removed:

$$\text{blocked} = \frac{|\{c \in R : c \cap H \neq \emptyset\}|}{|R|}$$

for value range $R$ and your hole cards $H$. Holding an ace on an ace-high board typically blocks 8–15% of a tight range — occasionally the difference between a call and a fold.

---

## 4. Pot odds

You face a bet of $B$ into a pot of $P$. The pot now holds $P + B$; calling costs $B$. You risk $B$ to win $P + B$, so you break even at

$$e^* = \frac{B}{P + 2B}$$

Equivalently, if $P_{\text{table}}$ is everything currently on the table (which already includes their bet) and $C$ is your call:

$$e^* = \frac{C}{P_{\text{table}} + C}$$

These are the same formula — the app uses the second because it's what's directly observable.

| Bet size | You need |
|---|---|
| ⅓ pot | 20.0% |
| ½ pot | 25.0% |
| ¾ pot | 30.0% |
| Pot | 33.3% |
| 1.5× pot | 37.5% |
| 2× pot | 40.0% |

Worth memorising. Note the concavity: doubling from pot to 2× pot only raises the requirement from 33% to 40%.

---

## 5. Expected value

### Folding

$$\mathrm{EV}_{\text{fold}} = 0$$

**By definition, and this is the conceptual keystone.** Chips already in the pot are not yours — they're the pot's. Folding neither gains nor loses relative to now. Every other option is measured against this zero. "But I've already put so much in" is the sunk-cost fallacy, and this equation is why it's a fallacy.

### Calling

$$\mathrm{EV}_{\text{call}} = e \cdot P - (1-e) \cdot C$$

When you win you collect the pot *that was already there* ($P$) — your own called chips come back, they aren't winnings. When you lose you're out $C$.

> This is where I originally got it wrong, writing $e(P+C) - (1-e)C$, which double-counts your own call as profit. The test that caught it: **a call at exactly pot odds must return EV 0.** The wrong formula returned +16.67 on a 50-into-100 call. Setting $e = e^*$ and solving confirms the corrected version gives exactly zero, as it must.

### Betting or raising

**Three** branches, not two. They fold, they call, or they come back over the top:

$$\mathrm{EV}_{\text{bet}} = \underbrace{f \cdot P}_{\text{they fold}} + \underbrace{c\Big[e(P+B) - (1-e)B\Big]}_{\text{they call}} + \underbrace{r \cdot (-B)}_{\text{they raise}}$$

with $f + c + r = 1$. The raise branch prices hero as folding to the re-raise and forfeiting the $B$ already committed — the conservative reading, and the honest one for a hand that raised without a plan for getting jammed on.

> The app originally modelled only two branches, treating everything that was not a fold as a call ($c = 1-f$, $r = 0$). That is fine against a passive opponent and badly wrong against an aggressive one: it prices a raise into the player most likely to blast it back as though the worst case were a flat call. It also made a re-raise look free precisely where it is most expensive. The bots have always had a re-raise branch (`postflopAct`'s `pRaise`), so the advice was pricing a different game from the one being simulated.

This decomposition is still the argument for aggression — **betting has two ways to win** (they fold, or you have the best hand) where calling has one — but the third branch is what stops that argument from running away with itself.

### Where $f$, $c$ and $r$ come from

Each opponent's range is uniform over $[\ell, 1]$ plus a bluff band over $[0, 0.34]$ of width $\beta$. Their value hands continue above a threshold $t$ set by the price, hero's represented range and their own `callBuffer`. Their **air** is priced separately, on appetite rather than on card strength:

$$\text{airContinue} = \text{airPersistence} \cdot \mathrm{clamp}\!\left(1 - 0.28\ln\!\left(1 + \tfrac{B}{P}\right),\ 0.35,\ 1\right)$$

$$f = (1-\beta)\,\Pr[\text{value folds}] + \beta\,(1 - \text{airContinue})$$

$$r = (1-f)\cdot\text{reRaiseShare}, \qquad c = 1 - f - r$$

> The bug this replaced: air was run through the same card-strength threshold as value hands. Since $t$ sits well above the top of the bluff band in almost every spot, **100% of a player's air folded to any bet**. The more a style bluffed, the more air it held, and therefore the easier it was to bluff — exactly backwards. A maniac who had raised showed 42% air and was scored as folding **73%** of the time to a half-pot re-raise, while a calling station scored **0%**. With air priced on appetite, the same maniac folds about 46% and the ordering follows stickiness (`callBuffer`) as it should.

### Decision cost

$$\text{cost} = \max\left(0,\ \max_i \mathrm{EV}_i - \mathrm{EV}_{\text{taken}}\right)$$

Summed over a session, this is chips lost to decision-making — independent of how cards actually fell. In testing, a player always taking the highest-EV line averages **5.4 chips/hand** (residual noise from bet-size step snapping), versus **348 chips/hand** for one acting at random. A 64× separation is what makes it a usable signal.

---

## 6. Fold equity

### Break-even bluff frequency

A pure bluff ($e = 0$) risking $B$ to win $P$:

$$\mathrm{EV} = fP - (1-f)B$$

Setting to zero:

$$f^* = \frac{B}{P + B}$$

### Minimum defence frequency

If they fold more than $f^*$, you profit **with any two cards**. So they must continue at least

$$\mathrm{MDF} = 1 - f^* = \frac{P}{P+B}$$

### Equilibrium bluff ratio

For a polarised bettor to make a bluff-catcher indifferent, the bluff share $\alpha$ of the betting range must satisfy $\alpha(P+B) - (1-\alpha)B = 0$:

$$\alpha = \frac{B}{P+2B}$$

Which is numerically the same as the required calling equity. That symmetry is not a coincidence — it's the indifference condition viewed from either side.

| Bet | Bluff needs folds > | Defender must continue ≥ | Bluffs should be |
|---|---|---|---|
| ⅓ pot | 25.0% | 75.0% | 20.0% |
| ½ pot | 33.3% | 66.7% | 25.0% |
| ¾ pot | 42.9% | 57.1% | 30.0% |
| Pot | 50.0% | 50.0% | 33.3% |
| 1.5× pot | 60.0% | 40.0% | 37.5% |
| 2× pot | 66.7% | 33.3% | 40.0% |

Break-even and MDF sum to exactly 100% by construction. (The ⅓-pot row uses exactly one third, not 0.33 — an earlier draft of this table used 0.33 and the verification script caught it.)

### Estimating $f$ from the range model

Given they hold a hand uniform on $[r_{\text{lo}}, 1]$ plus bluff mass on $[0, 0.34]$, and continue when their hand beats threshold $t$:

$$f = (1 - r_{\text{bluff}}) \cdot \frac{\text{clamp}(t, r_{\text{lo}}, 1) - r_{\text{lo}}}{1 - r_{\text{lo}}} + r_{\text{bluff}} \cdot \frac{\text{clamp}(t, 0, 0.34)}{0.34}$$

Their threshold accounts for **the range your bet represents**, not a random hand:

$$t = r_{\text{lo}}^{\text{you}} + \frac{e^* - s}{1 - s}\left(1 - r_{\text{lo}}^{\text{you}}\right) + \beta$$

where $s$ is your projected bluff share and $\beta$ their profile's call buffer (a nit +0.09, a station −0.17).

That correction matters. Modelling opponents as needing equity against a *random* hand returned 0% folds at every size — obviously wrong. They only need to beat your **value** hands; your air they beat automatically.

Result against a range at $r_{\text{lo}} = 0.45$, pot 100:

| | ½ pot | ¾ pot | Pot | 1.5× pot |
|---|---|---|---|---|
| **Nit** | 66% ✓ | 73% ✓ | 78% ✓ | 87% ✓ |
| **TAG** | 58% ✓ | 64% ✓ | 69% ✓ | 79% ✓ |
| **Station** | 21% ✗ | 28% ✗ | 33% ✗ | 42% ✗ |
| **Maniac** | 14% ✗ | 21% ✗ | 26% ✗ | 35% ✗ |

✓ = fold equity alone shows a profit. **Bluffing the nit prints at any size; bluffing the station never works at any size.** That's the single most valuable lesson in the app, and it's just this formula.

---

## 6b. Value extraction — getting paid with a strong hand

The fold-equity section asks "how often can I make them fold?" This asks the opposite: **how do I stop them folding?**

Set $e = 1$ (the nuts) in the betting equation:

$$\mathrm{EV}_{\text{bet}} = f \cdot P + (1-f)\big[1\cdot(P+B) - 0\big] = P + (1-f)B$$

The pot $P$ is yours either way, so the only thing you control is $(1-f)B$ — **the chance they call, times the amount they call for.** Betting more raises $B$ but also raises $f$. That product has an interior maximum, and finding it is the whole skill of value betting.

Differentiating, the optimum satisfies

$$\frac{d}{dB}\big[(1-f(B))B\big] = 0 \quad\Longrightarrow\quad 1 - f(B) = B\,f'(B)$$

Bet until the marginal chips gained equal the marginal chips lost to the extra folds you cause.

### Why the first implementation got this wrong

The original fold model clamped bet-size ratio at 1.6× pot, so every larger bet was treated identically. Fold probability plateaued near 74% and never approached 1:

| $B/P$ | 0.5 | 1 | 2 | 3 | 10 | 50 |
|---|---|---|---|---|---|---|
| modelled fold% | 38 | 55 | 72 | 74 | 77 | 78 |

With $f$ pinned, $(1-f)B \approx 0.26B$ grows without bound, so the model recommended shoving with every strong hand — the exact opposite of correct play, and precisely the mistake a human makes when they blast the nuts and win nothing.

### The fix: price elasticity

A larger bet should demand a stronger hand to continue. The continue threshold gains a term rising with size:

$$\varepsilon(B) = \text{clamp}\!\left(0.15\ln\!\left(1 + \frac{B}{P}\right),\ 0,\ 0.20\right)$$

$$t = r_{\text{lo}}^{\text{rep}} + 0.55\,\frac{e^*-s}{1-s}\left(1-r_{\text{lo}}^{\text{rep}}\right) + \varepsilon(B) + \beta$$

Logarithmic because price sensitivity has diminishing returns — the jump from ½-pot to pot changes behaviour far more than 3× pot to 3.5× pot, by which point they've folded everything that was folding.

### What it produces

Holding the nuts in a pot of 200, the extraction-maximising size now depends entirely on who you're facing:

| Opponent | Best size | They call | Extra won |
|---|---|---|---|
| TAG repping one pair | ⅔ pot | 40% | 53 |
| Calling station | 1.5× pot | 34% | 102 |
| Nit with a strong range | ½ pot | 97% | 97 |

This is the lesson your instinct already had: **against the player who will fold, bet less; against the player who cannot fold, bet more.** The nit case is the sharpest — their range is strong enough that they call a half-pot bet 97% of the time, so a moderate bet gets paid nearly always.

Note the tension with §6. Against a nit, bluffing is maximally profitable *and* value betting requires restraint. Same opponent, opposite adjustments, depending which side of the range you're on.

### Limits

Single-street only. It cannot plan "bet small on the turn to keep them in, then large on the river" — real multi-street extraction needs a game tree, not a per-street maximisation. It also has no model of the opponent *re-raising*, so slowplaying to induce a bluff is invisible to it.

---

## 7. Side pots

When players are all-in for different amounts, the pot splits by ascending commitment level. With commitments $c_1 \le c_2 \le \ldots \le c_n$, layer $k$ (between $c_{k-1}$ and $c_k$) contains

$$A_k = \sum_{i=1}^{n} \Big[\min(c_i, c_k) - \min(c_i, c_{k-1})\Big]$$

and is contestable only by non-folded players with $c_i \ge c_k$.

**Conservation:** $\sum_k A_k$ equals total chips committed, always — a telescoping sum. This is asserted after every hand in testing; across 130 simulated hands with 70 requiring side pots, every one balanced.

The construction handles the awkward cases automatically: a folded player's chips stay in the pot but they're excluded from eligibility, and an uncalled overbet forms a layer with exactly one eligible player, returning it to the bettor.

---

## 8. Mixed strategies

Real play randomises. Deterministic thresholds are exploitable, and — more relevant here — they're *memorisable*, so you'd learn the bots' cutoffs rather than transferable poker.

Every bot decision is a frequency drawn from a logistic curve:

$$p(\text{action}) = \sigma\left(\frac{x - \theta}{w}\right), \qquad \sigma(z) = \frac{1}{1+e^{-z}}$$

$x$ is hand strength (preflop percentile, or postflop equity ratio), $\theta$ the profile's threshold, $w$ the mixing width. Small $w$ → near-deterministic; large $w$ → loose and random. Widths differ by style ($w \approx 0.03$ for a nit, $0.055$ for a maniac) and preflop uses a much tighter band than postflop, because percentiles and equity ratios live on different scales.

At $x = \theta$ the action fires exactly 50% of the time. It takes roughly $\pm 2.2w$ to move from 10% to 90%.

### Postflop threshold

Comparison is against **fair share** rather than an absolute number, since equity requirements depend on field size:

$$\text{rel} = \frac{e}{1/(n+1)} = e(n+1)$$

for $n$ opponents. rel = 1 means exactly average; a profile's `raiseRel` of 1.30 means "raise at 30% above fair share." Without this, bots facing 5 opponents fold everything, because 17% average equity always looks terrible against pot odds — which was a real bug in v3.

### Position and field size

Opening ranges scale multiplicatively:

$$\text{open\%} \leftarrow \text{open\%} \times m_{\text{pos}} \times m_{\text{field}}$$

with $m_{\text{pos}}$ from 0.60 (UTG) to 1.35 (button), and

$$m_{\text{field}} = \text{clamp}(1 + 0.30(4 - n_{\text{live}}),\ 1,\ 2.1)$$

Two further corrections: the small blind gets 2.4× on completions (it's laying itself 3:1), and the big blind defends 1.4× wider (money already in). Without these, bots folded correct steals and correct defences — the bug that produced "folds A9s on the button."

---

## 9. Style classification

Your play is matched to the nearest archetype by normalised squared distance:

$$d = \left(\frac{v - v_k}{25}\right)^2 + \left(\frac{p - p_k}{20}\right)^2 + \left(\frac{a - a_k}{2}\right)^2$$

over VPIP $v$, PFR $p$, aggression factor $a$. Denominators are rough standard deviations across real player populations, putting the three axes on comparable footing — without them VPIP would dominate purely because it's numerically largest.

Reference signatures:

| | VPIP | PFR | AF |
|---|---|---|---|
| Nit | 12 | 9 | 1.0 |
| TAG | 22 | 18 | 2.5 |
| LAG | 34 | 26 | 3.0 |
| Station | 45 | 6 | 0.4 |
| Maniac | 58 | 38 | 5.0 |

Where the stats come from:

$$\text{VPIP} = \frac{\text{hands voluntarily entered}}{\text{hands}}, \quad \text{PFR} = \frac{\text{hands raised preflop}}{\text{hands}}, \quad \text{AF} = \frac{\text{bets} + \text{raises}}{\text{calls}}$$

VPIP − PFR is the **limp/call gap**, and a large one is a reliable leak indicator: entering pots passively, out of position, with weak ranges.

Requires 15+ hands. Below that the estimates are dominated by noise — VPIP over 10 hands has a standard error of roughly 15 percentage points, wide enough to span three archetypes.

---

## 10. Counterfactual runouts

When a hand ends without showdown, the app completes the board 2200 times from the actual known cards and computes each player's win share, splitting ties evenly:

$$w_i = \frac{1}{N}\sum_{t=1}^{N} \frac{\mathbb{1}[i \in \text{winners}(t)]}{|\text{winners}(t)|}$$

This is conditional on cards that were actually dealt, so it's much lower variance than a full equity calculation — the hole cards are fixed, only the runout varies. At 2200 trials the 95% CI is about ±2 points.

**It answers "was I ahead", not "should I have called."** A fold can be correct even when you'd have won: at the moment you folded you didn't know their cards, and against their whole range the call may still lose money. Results-oriented thinking is the most common trap in poker study, and this feature is deliberately labelled to avoid feeding it.

---

## 11. Drift detection

Compares your last 12 hands against your session baseline. Fires when

$$\mathrm{AF}_{\text{recent}} < 0.55\,\mathrm{AF}_{\text{session}} \quad\text{(with } \mathrm{AF}_{\text{session}} \ge 1.3\text{)}$$

or

$$\mathrm{VPIP}_{\text{recent}} > \mathrm{VPIP}_{\text{session}} + 18$$

Twelve hands is a small window, so this will occasionally fire on variance rather than genuine tilt. That's a deliberate trade: a false positive costs you a moment's reflection, a false negative costs you a session. Treat it as a prompt to check in, not a verdict.

---

## What's deliberately missing

**Board texture.** Bots evaluate their own hand but never ask whether a board favours their range or yours. On A-A-3 the preflop raiser holds far more aces than the caller, so they can profitably bet nearly their entire range — that's the actual mechanism behind continuation betting, and it isn't modelled. It's the largest remaining gap.

**Proper combo ranges.** A quantile is not a range. Because $r_{\text{lo}}$ is defined by made-hand strength on the current board, all preflop information is discarded the moment the flop lands. The fix is a weighted map over all 1326 combos with Bayesian updating:

$$w'(h) \propto w(h)\, P(\text{action} \mid h, \text{profile}, \text{board})$$

At ~1326 multiply-and-normalise operations per action, that's cheaper than the Monte Carlo already running. And it would subsume most of this document's approximations: polarisation, board texture, and blockers all fall out of it for free rather than needing separate machinery.

**Implied odds** beyond the pair correction. **Stack-to-pot ratio.** **ICM** (irrelevant for cash play, essential for tournaments).

---

*Corrections welcome — open an issue. Two errors in this document's formulas were caught by unit tests during development, so a third is not unlikely.*

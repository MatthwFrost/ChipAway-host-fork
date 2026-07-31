# ChipAway

**[▶ Play it](https://tommmmiller.github.io/ChipAway/)** — no install, no sign-up, runs entirely in your browser.

A 6-max no-limit hold'em trainer built around one idea: **you should be reading ranges, not hands.** Five opponent styles sit at the table with their identities hidden, and you work out who's who from how they play.

![Poker Trainer](preview.png)

## Why it isn't just another poker game

Most practice apps deal you cards and let you click buttons. This one models what the opponents could actually be holding.

**Range-aware equity.** Opponents aren't random hands — each carries a range implied by how they've acted, which tightens when they bet and widens as the board changes. The difference is not subtle:

| J♥Q♠ on an A♠A♥3♦ flop, opponent modelled as… | Your equity |
|---|---|
| A random hand (what most tools show you) | 52.3% |
| Someone who called earlier | 31.5% |
| A loose-aggressive player who bet | 24.2% |
| A tight player who bet big | **6.5%** |

Same cards, same board. Everything that changed is what you know about them.

**Polarised ranges.** Big bets aren't "top 15%" — they're the nuts plus bluffs, with medium hands checking. That's what makes bluff-catching possible.

**Fold-equity maths.** For every bet size: what you risk, the fold rate you need to break even, and the fold rate that opponent's range actually gives you.

| Pot of 100 | ½ pot | ¾ pot | pot | 1.5× pot |
|---|---|---|---|---|
| vs the nit | 66% ✓ | 73% ✓ | 78% ✓ | 87% ✓ |
| vs the calling station | 21% ✗ | 28% ✗ | 33% ✗ | 42% ✗ |

Bluffing the nit prints at any size. Bluffing the station never works at any size.

**Read scoring.** Before any cards turn over, you commit to what you think they have. Accuracy is tracked by street.

**A read on you.** VPIP, PFR, aggression factor and fold-to-3-bet, matched against the five archetypes to tell you which one *you* are playing like — plus an alert when your last dozen hands drift passive.

**Counterfactual runouts.** Folded and wondered? The board is completed 2,200 times with everyone's real cards to tell you whether you were ahead.

## Running it locally

Clone or download, then open `index.html`. That's it — no server, no build step, no dependencies. Double-click launchers for each platform are in [`local/`](local/).

## How it's built

One self-contained HTML file, roughly 1,400 lines, organised into numbered sections:

| | | | |
|---|---|---|---|
| 1 Card engine | 2 Hand evaluator | 3 Range model | 4 Equity |
| 5 Profiles | 6 Game state | 7 Rendering | 8 Equity panel |
| 9 Side pots | 10 Betting | 11 Bot decisions | 12 Guessing |
| 13 Stats & fold equity | 14 Wiring | | |

Hand evaluation checks all 21 five-card combinations from seven cards. Equity is Monte Carlo with opponents sampled from their implied ranges and your known cards blocked out. Side pots are built by ascending commitment level — verified across 130 simulated hands, every pot balancing against chips committed.

## Known limits

- **No board texture.** Bots evaluate their own hand but never ask whether a flop favours their range or yours. This is the biggest remaining gap.
- Ranges are strength quantiles rather than tracked combo sets, so preflop information is lost once the flop lands.
- Session stats reset on reload.

## Roadmap

- [ ] Board texture and range-versus-range advantage
- [ ] Weighted combo ranges with Bayesian updating (subsumes most of the above)
- [ ] 13×13 grid range painter for read training
- [ ] Bot profiles calibrated against real hand-history data
- [ ] Post-hand coaching commentary

## Feedback

Open an issue, or use the **Send feedback** panel at the bottom of the app.

## Licence

MIT — see [LICENSE](LICENSE).

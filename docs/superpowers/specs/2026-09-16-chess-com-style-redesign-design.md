# Chess.com-style visual redesign

## Goal

Reskin ChipAway's chrome (colors, typography, spacing, card treatment) to match
chess.com's visual language — using the "Play Bots" screenshot the user
supplied as ground truth — while leaving the poker-specific structure (6-max
table, action buttons, coach/equity logic) untouched. This is a visual
redesign, not a rebuild: no new features, no logic changes beyond one
mechanical, optional exception noted below.

## Non-goals

- No chess.com logos, wordmark, or literal asset copies — colors and layout
  patterns only (general design language, not protected expression).
- No new gameplay functionality (no resign/undo/hint icon row — no clean
  poker equivalent exists and it wasn't requested).
- No changes to game/decision logic in `src/engine/*` (coach, equity, spot
  model, decision code all untouched).
- No literal top/bottom 2-player bars — the existing 6-seat oval table stays;
  `EquityPanel` (already first in the sidebar) becomes the "win chance"
  element instead, per the user's direction.

## Approach

Because every existing rule in `src/styles.css` is already built on CSS
custom properties (`:root` variables), most of the reskin is achieved by
repointing a small set of variables rather than rewriting component CSS from
scratch. Structural changes are then layered on top for the handful of
components that need a genuinely different shape (equity bar, coach panel,
hand log) to read as "chess.com" rather than just "chess.com colors on the
old layout."

## Design tokens

Repoint existing `:root` variables in `src/styles.css`:

| Variable | Old | New | Used for |
|---|---|---|---|
| `--ink` | `#0A1210` | `#262421` | page background |
| `--ink-2` | `#10201C` | `#302E2B` | card/sidebar background |
| `--line` | `#223730` | `#4A4846` | borders |
| `--brass` | `#C9A227` | `#81B64C` | primary accent (buttons, active states, positive) |
| `--cream` | `#F4EFE3` | `#E9E9E8` | primary text |
| `--cream-dim` | `#C9C2B4` | `#B8B6B3` | secondary text |
| `--slate` | `#7C8C88` | `#8B8987` | tertiary text / labels |
| `--blood` | `#A63524` | `#D64F4F` | negative/fold accents |
| `--radius` | `14px` | `6px` | card corner radius (chess.com is much squarer) |

`--felt`/`--felt-lo` (table surface) are repointed to a flat chess.com green
(`#769656` dark / `#81B64C` accent) instead of the current radial-gradient
felt. `--rail`/`--rail-hi` (wood rail) are dropped — the table frame becomes
a flat dark panel using `--ink-2`, no gradient.

Typography: `Fraunces` (serif display font) is replaced by a bold sans
(system-ui/Inter) for headings — chess.com uses no serif anywhere.
`JetBrains Mono` stays, but scoped down to genuinely tabular numbers (stack
sizes, pot, hand-log rows) rather than every label, matching how chess.com
uses mono sparingly.

## Component changes

**Table** (`PokerTable.jsx` / `.table-outer`, `.felt` in `styles.css`) — flat
green playing surface, flat dark frame, no wood-rail gradient or radial
shading. Seat plates (`.seat-plate`) get the tighter `--radius` and flatter
card look.

**Equity → "win chance"** (`EquityPanel.jsx`) — the circular ring
(`.eq-ring`, `#eqRing`) is replaced by a bold flat percentage figure plus a
squared-off, taller win/tie/lose bar. This reuses the existing `mWin` /
`mTie` / `mLose` elements and the JS in `initializePokerTrainer.js`
(`renderEquityTab`, `clearEquityTab`) completely unchanged — restyle only,
via `.style.width`, same as today. (The alternative — a true vertical
eval-bar mounted beside the board — was offered and would need a ~3-line
change to swap `style.width` for `style.height` on those three elements; not
selected, going with the zero-engine-change horizontal version.)

**Coach panel** (`CoachPanel.jsx`) — wrapped in a chat-style treatment: small
avatar circle + speech-bubble container around the existing verdict/reason/
points markup. Same coach content and logic, new wrapper markup + CSS only.

**Hand log** (inside `SessionPanels.jsx`, `.log`) — restyled as a compact
list resembling chess.com's move list: tighter rows, monospace numbers,
subtle zebra striping. Same `#log` id and append logic in
`initializePokerTrainer.js` untouched.

**Settings modal** (`SettingsModal.jsx`, added in the prior session) — same
token-driven restyle (squarer corners, new panel colors), no functional
change.

**Buttons / action row** (`ActionPanel.jsx` and shared `button` styles) —
recolored to chess.com's green primary / flat secondary treatment, same
markup and click handlers.

## Files touched

- `src/styles.css` — token repoint + structural rules for table, equity bar,
  coach bubble, hand-log list, tightened radii throughout.
- `src/components/EquityPanel.jsx` — markup change (ring → flat bar/number),
  same element ids.
- `src/components/CoachPanel.jsx` — wrapper markup for avatar+bubble.
- `src/components/PokerTable.jsx` — no markup change expected; the flat
  frame is achieved by restyling the existing `.table-outer`/`.felt`
  elements in `styles.css`, not by adding wrapper divs.
- No changes to `src/engine/*.js` (game/decision logic) or to
  `initializePokerTrainer.js` beyond what's already described (none, in the
  selected option).

## Testing / verification

- `npx vitest run` — full suite must stay green (288 tests as of this
  session); none of them assert on CSS, but `EquityPanel`/`CoachPanel`
  markup changes must keep the same element ids the engine file queries via
  `getElementById`, or tests exercising those paths would fail loudly via
  runtime errors, not silently.
- Manual pass in the dev preview: deal a hand, confirm equity bar updates
  live, coach verdict renders in the new bubble style, hand log entries
  append correctly, settings modal still opens/closes and its contents
  (table setup, glossary, feedback form) still work as wired.

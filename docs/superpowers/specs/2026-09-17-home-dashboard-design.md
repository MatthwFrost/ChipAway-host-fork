# Home is the dashboard, the table is where you go to play

**Date:** 2026-09-17
**Status:** approved, ready to implement

## The problem

The app has one screen. You land on the table, and the table is all there is.
There is no record of anything you have played: `initializePokerTrainer` keeps a
single rolling session in `localStorage` under `chipaway.session.v1`, and the
only way to start fresh is "Reset all saved stats", which deletes that key and
reloads the page. Every session you have ever played has been overwritten by the
next one.

That makes two things impossible. You cannot look back at what you have played,
and you cannot deliberately start something new — you can only erase.

The left-hand rail already anticipates the fix. Its opening comment says every
row is a placeholder "for screens that don't exist", and `Play` carries a
hardcoded `is-active`. This spec builds the first of those screens.

## The change

Home becomes a dashboard. It shows your lifetime numbers, the coach's current
read on your game, whichever game is still live, and every game you have
finished. From there you resume, end, or start a new one. The table stops being
the app and becomes a place you go.

A **game** is one sitting at the table: created with a setup, played over many
hands, and ended explicitly. At most one game is live at a time.

---

## 1. Data model

### 1a. The store

One new key, `chipaway.games.v1`:

```js
{
  version: 1,
  liveId: 'g_1758112800000' | null,
  games: [ /* newest first */ ]
}
```

`liveId` is the single source of truth for which game is live. Deriving liveness
from `status` alone would allow two records to disagree; a pointer cannot.

### 1b. A game record

```js
{
  id:        'g_1758112800000',   // 'g_' + createdAt, unique per sitting
  createdAt: 1758112800000,
  endedAt:   null,                // stamped when the game ends
  status:    'live' | 'ended',
  setup:     { pace: '1.15', showdownGuess: false, rangeGuess: false,
               seats: ['tag','lag','nit','fish','tag','lag'] },
  net:       1240,
  state:     { stats, handLog, evRecords, matchResults, handNo }
}
```

`state` is byte-for-byte the payload `saveSession()` writes today. Keeping it
identical means persistence changes where it writes, not what it writes, and the
engine's load path needs no new parsing.

`net` is new. Nothing currently tracks a running chip total: `stats` has no such
field, and `matchResults` holds only the last five hands, shifting the older ones
out at line 806. Without `net` the dashboard could not state a game's result, so
it is accumulated alongside that push.

`setup.seats` stores opponent profile keys so a game's table composition is
reproducible, rather than re-randomised on every reload the way `randomSeats()`
does now.

### 1c. Migration

On first boot, if `chipaway.session.v1` exists and `chipaway.games.v1` does not,
wrap the legacy payload as a single live game (`createdAt` = now, `net` = 0,
default setup), then remove the old key. A player mid-session when this ships
keeps their stats and hand log instead of silently losing them.

`net` cannot be recovered for a migrated game — it was never recorded — so it
starts at 0 and counts from the next hand. The record carries `migrated: true`
so the dashboard can show "net from upgrade" rather than implying the figure
covers every hand.

---

## 2. `src/engine/games.js` — new module

Storage logic, no DOM, testable the way the rest of `src/engine/` is.

| Function | Behaviour |
|---|---|
| `loadStore()` | Reads and parses the key; returns an empty store on absent or corrupt JSON. |
| `saveStore(store)` | Writes it, swallowing quota errors the way `saveSession()` does. |
| `listGames()` | All games, newest `createdAt` first. |
| `getLiveGame()` | The record `liveId` points at, or `null`. |
| `createGame(setup)` | Ends the live game if there is one, appends a new live record, points `liveId` at it, returns it. |
| `endGame(id)` | Sets `status: 'ended'` and `endedAt`; clears `liveId` if it pointed there. |
| `updateLiveGame(patch)` | Shallow-merges into the live record. No-op if nothing is live. |
| `lifetimeStats(games)` | Aggregates across every game: hands, net, VPIP, PFR, WTSD, guess accuracy. |
| `migrateLegacySession()` | §1c. Idempotent. |
| `clearAllGames()` | Wipes the store. Backs the destructive control in §4d. |

Every function is total: corrupt or absent storage yields an empty store rather
than throwing. A dashboard that crashes on bad JSON is worse than one showing no
games, and `localStorage` is shared with whatever else the browser has put there.

`createGame` retiring the live game is what makes "at most one live game" an
invariant of the module rather than a rule callers must remember.

This module is the only thing that touches the key. The dashboard never reaches
into the engine and the engine never learns what a dashboard is; both talk to
`games.js`.

---

## 3. Engine changes

Deliberately small. `initializePokerTrainer` is a one-shot function — it opens
with `if(window.__chipAwayInitialized) return;`, holds all state in closure
variables, and binds every listener at the bottom against nodes that must
already exist. It cannot be torn down or re-initialised, so this design does not
ask it to be.

**§13i Persistence.** `saveSession()` calls `updateLiveGame({ state: {...}, net })`.
`loadSession()` reads `getLiveGame()?.state`. Both keep their existing
try/catch-and-continue shape.

**Net accumulation.** Where `matchResults.push(lastOutcome.net)` happens at line
805, also add to the running `net`.

**Setup at boot.** After `loadSession()`, apply the live game's `setup`: pace,
the two drill toggles, and `seatConfig` from `setup.seats` instead of
`randomSeats()`.

**Ending replaces resetting.** `resetSession()` becomes `endCurrentGame()`: stamp
the record ended, then reload. The reload is kept because the engine has no
other way to reach a clean state. The "Reset all saved stats" button in
`SessionPanels.jsx:15` is relabelled **End session** and rebound to it. Wiping
all history moves to the dashboard (§4d), where it is a deliberate act rather
than something you hit looking for a fresh game.

**`findLeak` moves out.** The dashboard shows the same "Worth fixing" line the
table does (§4b), so `findLeak` is extracted from `initializePokerTrainer` into
a module both can import, taking `stats` and `evRecords` as arguments instead of
reading closure variables. `renderLeak()` stays in the engine and calls it. Two
copies of the leak thresholds would drift apart.

Nothing else in the engine changes. It does not know which screen is showing.

---

## 4. Screens

### 4a. Navigation

`App` gains `const [screen, setScreen] = useState(...)`, defaulting to `'home'`.
Both screens stay mounted; a class on `.shell` decides which is visible.

This is the crux of the architecture. Unmounting `<PokerTable/>` would destroy
the nodes the engine holds by `id`, and the engine cannot be re-initialised to
rebuild them. Hiding with CSS means resume costs nothing and restores the exact
position, mid-hand included, because nothing was ever destroyed.

- **Resume** — flips `screen` to `'table'`. Instant, no reload.
- **New game** — `createGame(setup)`, then `location.reload()`. A reload is the
  only route to a clean engine, and is what the reset path already relied on.
- **End session** — `endGame(id)`, then reload to Home. Required even from the
  dashboard: the in-memory engine still holds the ended game's state, and a
  reload is what clears it.

After a reload, `App` opens on the table if a live game exists and the reload was
triggered by New game; otherwise on Home. This is carried in `sessionStorage` so
it does not survive a fresh visit.

### 4b. `HomeScreen.jsx`

Top to bottom:

1. **Lifetime stats strip** — hands, net chips, VPIP, PFR, WTSD, guess accuracy,
   from `lifetimeStats()`. Hidden entirely when no games exist; a row of zeroes
   is noise.
2. **Coach's leak** — the "Worth fixing" line `findLeak()` already produces,
   computed over lifetime aggregates. Hidden when it returns empty, exactly as
   `renderLeak()` hides it today. This needs `findLeak` extracted from
   `initializePokerTrainer` into a place both can import, or duplicated. Extract:
   two copies of leak thresholds would drift.
3. **Live game card** — setup summary, hands played, net, with **Resume** and
   **End session**. Absent when nothing is live.
4. **+ New game** — opens the setup dialog.
5. **Past games** — newest first: date, hands, net, colour-coded by sign. A
   row is not clickable in this version; per-game review is future work.

Empty state, when there are no games at all: the new-game button and a line
explaining what a game is.

### 4c. `NewGameModal.jsx`

Offers only what the engine can genuinely vary: pace, showdown guess, range
guess, and opponent seat styles (randomise / reveal). `SB`, `BB`, `START_STACK`
are constants at line 69 and the seat count is fixed by `SEAT_NAMES`, so the
dialog states `6-max · 10/20 · 1000 stacks` as a fact about the table rather
than offering controls that cannot work. Making those variable is separate work:
it reaches into blinds, side pots, position maths and the bot policy's position
multipliers.

The existing `TableSetup` component already renders these controls, but its
inputs are bound by `id` in the engine at boot. The dialog therefore gets its
own controls holding React state, and writes the result into `setup` on create.
`TableSetup` stays where it is for mid-game changes.

### 4d. `AppRail.jsx`

Gains a **Home** row above Play. `is-active` and `aria-current` become driven by
the current screen instead of hardcoded. The destructive **Clear all history**
control lives on Home behind a confirm, calling `clearAllGames()`.

---

## 5. Out of scope

**Mid-hand persistence.** A browser refresh mid-hand loses that hand, as it does
today — the saved state has no board, pot, or turn pointer. In-memory resume via
Home is unaffected, because nothing is unmounted. Fixing the refresh case means
snapshotting the full table on every action, a change to the engine's core loop
that is not worth coupling to this one.

**Per-game review.** Past games are a list, not a destination. Opening a finished
game to browse its hands is future work.

**Variable stakes and table size.** §4c.

---

## 6. Testing

**`games.test.js`** — against a fake `localStorage`:
- `createGame` retires the previous live game and repoints `liveId`
- `endGame` stamps `endedAt` and clears `liveId` only when it pointed there
- `migrateLegacySession` wraps a legacy payload and is idempotent on a second run
- corrupt JSON yields an empty store rather than throwing
- `lifetimeStats` aggregates hands, net and rates across several games

**`HomeScreen.test.jsx`** — three states render correctly: no games, a live game
plus past games, past games only. The leak line is absent when `findLeak`
returns empty.

**Existing suites** — the smoke tests assume the table is in the DOM at boot.
Under this design it still is, so they pass unchanged. `App.test.jsx` may need
the default screen accounted for.

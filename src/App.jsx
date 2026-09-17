import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { initializePokerTrainer } from './engine/initializePokerTrainer';
import { clearAllGames, createGame, defaultSetup, endGame, getLiveGame, listGames, migrateLegacySession } from './engine/games';
import { openOnReload, takeScreenIntent } from './engine/screen';
import { AppRail } from './components/AppRail';
import { PokerTable } from './components/PokerTable';
import { SidePanel } from './components/SidePanel';
import { SettingsModal } from './components/SettingsModal';
import { HomeScreen } from './components/HomeScreen';
import { HistoryPanel } from './components/HistoryPanel';

// Both screens stay mounted and a class decides which is visible. Unmounting
// the table would destroy the nodes initializePokerTrainer holds by id, and it
// cannot be re-initialised to rebuild them — it guards on
// window.__chipAwayInitialized and binds its listeners once. Hiding with CSS
// means coming back from the dashboard costs nothing and restores the exact
// position, mid-hand included, because nothing was ever torn down.

export function App() {
  // Settings is opened from a button in the Game moves heading, deep inside the
  // side panel, so the open flag has to live above both of them.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Read once, at first render, because takeScreenIntent consumes the intent —
  // it is for the reload that just happened, not for every render after it.
  const [screen, setScreen] = useState(() => takeScreenIntent() || 'home');
  // Migrate before the first read rather than in an effect after it, so a
  // player mid-session when games shipped sees their game immediately. It is
  // idempotent, so the engine calling it again at boot does nothing.
  // Read-once on purpose: every path that changes the list — new game, end
  // game, clear history — goes through a reload, because that is the only way
  // to get the engine to a clean state.
  const [games] = useState(() => {
    migrateLegacySession();
    return listGames();
  });
  const liveGame = games.find((g) => g.status === 'live') || null;

  // The engine's replay controller, captured at init so the history panel can
  // drive it to draw finished hands onto the live felt.
  //
  // A ref rather than state: the controller is created once and its identity
  // never changes, so storing it in state would mean a render whose only
  // purpose is to publish a value that was already there. It is read through a
  // stable getter so consumers cannot accidentally close over the null it
  // holds before the layout effect runs.
  const engineRef = useRef(null);
  const getEngine = useCallback(() => engineRef.current, []);

  useLayoutEffect(() => {
    engineRef.current = initializePokerTrainer();
  }, []);

  // A reload is the only route to a clean engine, and is what the old reset
  // path already relied on.
  const startGame = useCallback(() => {
    createGame(defaultSetup());
    openOnReload('table');
    location.reload();
  }, []);

  // Two jobs. Leaving History hands the felt back to the live table — that
  // belongs here rather than in the panel because the screen transition is this
  // component's to make, and the engine repaint is a side effect the panel
  // cannot do during its own render.
  //
  // And Play deals. Nothing is asked, because there is nothing worth asking:
  // the defaults are a playable table and every one of them can be changed from
  // Settings once you are sitting down.
  const navigate = useCallback((next) => {
    const engine = engineRef.current;
    if (next !== 'history' && engine && engine.isReplaying()) engine.exit();
    // Playing with no game running would deal hands nowhere — saveSession
    // writes through updateLiveGame, which is a no-op when nothing is live.
    if (next === 'table' && !liveGame) {
      startGame();
      return;
    }
    setScreen(next);
  }, [liveGame, startGame]);

  // The dashboard's own button. Starting a new game retires whatever is live,
  // so this is the one place a question is worth asking — and only once there
  // is progress to lose.
  const newGame = useCallback(() => {
    const played = liveGame && liveGame.state && liveGame.state.stats
      ? liveGame.state.stats.hands : 0;
    if (played > 0 && !window.confirm('End your game in progress and start a new one?')) return;
    startGame();
  }, [liveGame, startGame]);

  const endCurrentGame = useCallback(() => {
    const live = getLiveGame();
    if (live) endGame(live.id);
    // The in-memory engine still holds the game that was just ended, so this
    // has to reload even though we are already on the dashboard.
    openOnReload('home');
    location.reload();
  }, []);

  const clearHistory = useCallback(() => {
    if (!window.confirm('Delete every game you have played? This cannot be undone.')) return;
    clearAllGames();
    openOnReload('home');
    location.reload();
  }, []);

  return (
    <div className="shell" data-screen={screen}>
      <AppRail screen={screen} onNavigate={navigate} />

      <HomeScreen
        games={games}
        liveGame={liveGame}
        onNewGame={newGame}
        onResume={() => setScreen('table')}
        onEndGame={endCurrentGame}
        onClearHistory={clearHistory}
      />

      <main className="board-grid">
        <div className="table-col">
          <PokerTable />
        </div>
        <SidePanel onOpenSettings={() => setSettingsOpen(true)} />
        {/* Shares the felt with Play rather than drawing its own table: the
            engine renders a replayed hand through the same paint() the live
            hand uses. CSS decides which of the two panels is beside it. */}
        <HistoryPanel active={screen === 'history'} getApi={getEngine} />
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

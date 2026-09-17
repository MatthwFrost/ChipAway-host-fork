import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { initializePokerTrainer } from './engine/initializePokerTrainer';
import { clearAllGames, createGame, defaultSetup, endGame, getLiveGame, listGames, migrateLegacySession } from './engine/games';
import { openOnReload, takeScreenIntent } from './engine/screen';
import { AppRail } from './components/AppRail';
import { PokerTable } from './components/PokerTable';
import { SidePanel } from './components/SidePanel';
import { SettingsModal } from './components/SettingsModal';
import { HomeScreen } from './components/HomeScreen';
import { HistoryPanel } from './components/HistoryPanel';
import { getUser, isGuest, onAuthChange, signOut } from './engine/auth';
import { push, syncNow } from './engine/sync';
import { SignInScreen } from './components/SignInScreen';

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

  // 'checking' until the first getUser() resolves. Rendering the gate during
  // that window would flash a sign-in form at somebody who is already signed
  // in, on every single page load.
  const [authState, setAuthState] = useState('checking');
  const [user, setUser] = useState(null);
  const [guest, setGuest] = useState(() => isGuest());

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
  const engineInitedRef = useRef(false);
  const getEngine = useCallback(() => engineRef.current, []);

  // True while the sign-in gate (or its pre-first-check stub) is on screen
  // instead of the shell. The table DOM that initializePokerTrainer binds to
  // by id only exists once this is false, so the init effect below must not
  // run while it is true. Derived once here rather than re-checked in each
  // early return so the effect and the render path can never drift apart.
  const gated = !guest && (authState === 'checking' || !user);

  useLayoutEffect(() => {
    if (gated) return; // no table DOM yet -- initializing now would throw
    if (engineInitedRef.current) return; // already initialised, do not repeat
    engineInitedRef.current = true;
    engineRef.current = initializePokerTrainer();
  }, [gated]);

  useEffect(() => {
    let cancelled = false;
    getUser().then((u) => {
      if (cancelled) return;
      setUser(u);
      setAuthState('ready');
      // Pull anything played on another device, then push what is here. Only
      // for a real account -- a guest has nowhere to sync to.
      if (u) syncNow();
    });
    return () => { cancelled = true; };
  }, []);

  // Supabase refreshes tokens and can sign a session out from under us, so the
  // gate follows the client rather than the one-shot check above.
  useEffect(() => onAuthChange((u) => {
    setUser(u);
    setAuthState('ready');
  }), []);

  // The engine files each hand to localStorage synchronously and cannot await
  // a network call mid-hand. So the push rides along afterwards: whenever the
  // tab is hidden or closed, and once a minute while it is open. Losing a push
  // costs nothing -- the next one re-sends everything local that the server
  // does not already have.
  useEffect(() => {
    if (!user) return undefined;
    const onHide = () => { if (document.visibilityState === 'hidden') push(); };
    const timer = setInterval(push, 60000);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [user]);

  const doSignOut = useCallback(async () => {
    await signOut();
    setUser(null);
    setGuest(false);
    // A reload for the same reason every other state change reloads: the
    // engine holds the previous account's game in memory.
    openOnReload('home');
    location.reload();
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

  // A guest already opted out of an account, so there is nothing worth
  // waiting on the network for -- skip the checking gate below entirely.
  if (gated) {
    // Nothing at all until the first check resolves -- see the comment on
    // authState above.
    if (authState === 'checking') return <div className="shell" data-screen="home" />;

    return (
      <SignInScreen
        onSignedIn={(u) => { setUser(u); setAuthState('ready'); syncNow(); }}
        onGuest={() => setGuest(true)}
      />
    );
  }

  return (
    <div className="shell" data-screen={screen}>
      <AppRail screen={screen} onNavigate={navigate} user={user} onSignOut={doSignOut} />

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

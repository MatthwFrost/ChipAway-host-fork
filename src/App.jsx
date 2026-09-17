import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { initializePokerTrainer } from './engine/initializePokerTrainer';
import { clearAllGames, createGame, defaultSetup, endGame, getLiveGame, listGames, migrateLegacySession } from './engine/games';
import { clearHands } from './engine/handStore';
import { openOnReload, takeScreenIntent } from './engine/screen';
import { AppRail } from './components/AppRail';
import { PokerTable } from './components/PokerTable';
import { SidePanel } from './components/SidePanel';
import { SettingsModal } from './components/SettingsModal';
import { HomeScreen } from './components/HomeScreen';
import { HistoryPanel } from './components/HistoryPanel';
import { endGuest, getDisplayName, getUser, isGuest, onAuthChange, signOut } from './engine/auth';
import { push, syncNow } from './engine/sync';
import { SignInScreen } from './components/SignInScreen';

// Which account's rows are currently sitting in chipaway.games.v1 /
// chipaway.hands.v1. localStorage is one shared bucket regardless of who is
// signed in, so on a shared browser signing out of A and into B must not let
// syncNow() fold B's pull into rows still tagged as A's and then push them
// back up re-owned as B's -- RLS cannot catch that, because the client really
// is B at that point and really is asserting ownership. Absent means "this
// data belongs to nobody's account yet", which is also the guest state, so a
// guest who signs up keeps their local hands rather than losing them to a
// clear that only makes sense between two *different* accounts.
const LAST_USER_KEY = 'chipaway.lastUser';

function getLastUser() {
  try { return localStorage.getItem(LAST_USER_KEY); } catch (e) { return null; }
}

function setLastUser(id) {
  try { localStorage.setItem(LAST_USER_KEY, id); } catch (e) { /* private mode */ }
}

function clearLastUser() {
  try { localStorage.removeItem(LAST_USER_KEY); } catch (e) { /* private mode */ }
}

// Clears the local stores when, and only when, the account taking ownership
// of this browser is not the one that was here before. Must run before the
// first syncNow() for that user, or the pull/push it does will happily mix
// the previous account's rows into the new one's.
function clearIfDifferentAccount(userId) {
  const last = getLastUser();
  if (last && last !== userId) {
    clearAllGames();
    clearHands();
  }
  setLastUser(userId);
}

// games is read once at first render (see the comment on that useState
// below), so a sync that pulls in rows from another device is invisible
// until something reloads the page. Keyed on mergeGames'/mergeHands' ADDED
// counts specifically, not a "touched" count that includes updates:
// mergeGames re-applies the remote copy of every already-known ended game on
// every single pull, whether or not anything about it actually changed, so a
// count that included updates would be non-zero forever and this would
// reload in a loop. The added count cannot do that -- once a remote id has
// been folded in locally once, it is no longer "not held locally" on the
// next pull, so the count settles at 0 and the reload this triggers cannot
// re-trigger itself.
function reloadIfSyncedSomethingNew(result) {
  const pulled = result && result.pulled;
  if (!pulled) return;
  if ((pulled.games || 0) + (pulled.hands || 0) > 0) {
    openOnReload('home');
    location.reload();
  }
}

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
  // Starts null and upgrades once getDisplayName() resolves -- see the effect
  // below, keyed on userId. Never gates render: the rail shows user.email
  // immediately and swaps in the name when it arrives, rather than the rail
  // being blank or the shell waiting on a second network round trip.
  const [displayName, setDisplayName] = useState(null);

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

  // Whether a real (non-guest) user has ever been established this page load.
  // onAuthChange fires with no session on the ordinary signed-out first load
  // too, and that must not reload -- there is nothing to recover from yet.
  // Only losing a session that was actually there mid-play needs the reload
  // below, so this stays false until the first real user shows up.
  const hadUserRef = useRef(false);

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
      // getUser() revalidates over the wire and onAuthChange's INITIAL_SESSION
      // fires from local storage with no network call at all, so it typically
      // lands first. If it already established a real user, a null here is
      // not "signed out" -- it is a slow response landing after a faster,
      // already-authoritative one, or a transport failure that getUser()
      // (see auth.js) quietly turns into null. Either way, slamming the gate
      // shut on a player whose session the subscription already confirmed is
      // wrong; only a genuine first-load null (hadUserRef still false) may
      // set the gated state.
      if (!u && hadUserRef.current) return;
      // Before the first sync, make sure the stores about to be pulled into
      // and pushed from actually belong to this account -- see
      // clearIfDifferentAccount above.
      if (u) { clearIfDifferentAccount(u.id); hadUserRef.current = true; }
      setUser(u);
      setAuthState('ready');
      // Push what is here, then pull anything played on another device. Only
      // for a real account -- a guest has nowhere to sync to.
      if (u) syncNow().then(reloadIfSyncedSomethingNew);
    });
    return () => { cancelled = true; };
  }, []);

  // Supabase refreshes tokens and can sign a session out from under us, so the
  // gate follows the client rather than the one-shot check above. Losing a
  // session that was actually established mid-play (revoked elsewhere, a
  // refresh-token failure, sign-out in another tab) cannot be handled by
  // re-rendering the gate in place: the table DOM initializePokerTrainer bound
  // to by id is still there, and there is no route back to a live engine
  // without a reload -- the init effect above short-circuits on
  // engineInitedRef, and initializePokerTrainer itself guards on
  // window.__chipAwayInitialized. So this follows the same rule every other
  // state change in this file does: when in doubt, reload. The initial
  // signed-out load also arrives here with u === null and must NOT reload --
  // hadUserRef distinguishes "never had a session" from "just lost one".
  useEffect(() => onAuthChange((u) => {
    if (!u && hadUserRef.current) {
      openOnReload('home');
      location.reload();
      return;
    }
    if (u) { clearIfDifferentAccount(u.id); hadUserRef.current = true; }
    setUser(u);
    setAuthState('ready');
  }), []);

  // The engine files each hand to localStorage synchronously and cannot await
  // a network call mid-hand. So the push rides along afterwards: whenever the
  // tab is hidden or closed, and once a minute while it is open. Losing a push
  // costs nothing -- the next one re-sends everything local that the server
  // does not already have.
  // Keyed on the id, not the user object: Supabase hands back a new object on
  // every token refresh, and keying the effect below on the object itself
  // would tear this interval down and restart it every time -- losing up to
  // 60 seconds of the push cadence for no reason, since the id (and therefore
  // whether a background push should be running at all) has not changed.
  const userId = user ? user.id : null;

  // A guest has no profile row -- guarded by userId, same as the push
  // interval below, so this never fires for one. No reset-to-null on change
  // is needed: every path that swaps one real account for another (sign-out,
  // a lost session) already goes through location.reload() elsewhere in this
  // file, so userId only ever moves from null to a real id once per page
  // load, and displayName's initial state is already null for that gap.
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    getDisplayName().then((name) => { if (!cancelled) setDisplayName(name); });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const onHide = () => { if (document.visibilityState === 'hidden') push(); };
    const timer = setInterval(push, 60000);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [userId]);

  const doSignOut = useCallback(async () => {
    // One last upload before the session that authorises it goes away, so the
    // last minute of play is not stranded here only to be wiped by the clear
    // below. Must run before signOut(), not after -- push() resolves the
    // current user through getUser(), which would come back empty the moment
    // the session is gone. Awaited unconditionally rather than fired and
    // forgotten: push() already resolves to an { error } shape instead of
    // throwing on a network failure, so awaiting it cannot turn into an
    // unhandled rejection, and it is bounded by whatever timeout the
    // underlying fetch has -- the same exposure the once-a-minute background
    // push already carries. Losing the last few hands to a clear that ran
    // ahead of the upload is worse than a sign-out that takes a moment
    // longer.
    await push();
    await signOut();
    // Otherwise the next account to sign into this browser inherits this
    // one's games and hands the moment syncNow() runs -- see
    // clearIfDifferentAccount above for the sign-in side of this.
    clearAllGames();
    clearHands();
    clearLastUser();
    setUser(null);
    setGuest(false);
    // A reload for the same reason every other state change reloads: the
    // engine holds the previous account's game in memory.
    openOnReload('home');
    location.reload();
  }, []);

  // "Skip for now" would otherwise be a one-way door: nothing else clears
  // chipaway.guest, so a guest had no way back to the sign-in screen short of
  // devtools. Local games and hands are left alone -- they are unowned data
  // (see the comment on LAST_USER_KEY above), so if this player goes on to
  // sign in or sign up, clearIfDifferentAccount keeps them rather than
  // wiping them. A reload for the same reason every other state change here
  // reloads: the engine and the gate/shell decision both need to start clean.
  const leaveGuest = useCallback(() => {
    endGuest();
    setGuest(false);
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
        onSignedIn={(u) => {
          clearIfDifferentAccount(u.id);
          hadUserRef.current = true;
          setUser(u);
          setAuthState('ready');
          syncNow().then(reloadIfSyncedSomethingNew);
        }}
        onGuest={() => setGuest(true)}
      />
    );
  }

  return (
    <div className="shell" data-screen={screen}>
      <AppRail screen={screen} onNavigate={navigate} user={user} displayName={displayName} onSignOut={doSignOut} onLeaveGuest={leaveGuest} />

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

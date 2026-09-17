import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('./engine/auth.js', () => ({
  getUser: vi.fn(),
  getDisplayName: vi.fn(async () => null),
  isGuest: vi.fn(() => false),
  onAuthChange: vi.fn(() => () => {}),
  signOut: vi.fn(async () => ({ error: null })),
  signIn: vi.fn(),
  signUp: vi.fn(),
  continueAsGuest: vi.fn(),
  endGuest: vi.fn(),
}));
vi.mock('./engine/sync.js', () => ({
  syncNow: vi.fn(async () => ({ pushed: null, pulled: null, error: null })),
  push: vi.fn(async () => ({ games: 0, hands: 0, error: null })),
}));
// The engine paints into DOM nodes this test does not care about, and
// initialises once per page. Stubbing it keeps the gate test about the gate.
// A vi.fn() so tests can assert on call counts -- that is the whole point of
// this file's regression coverage: the engine must not be initialised while
// the gate is showing, and must be initialised exactly once once it is past.
vi.mock('./engine/initializePokerTrainer', () => ({
  initializePokerTrainer: vi.fn(() => ({
    canReplay: () => true, isReplaying: () => false, enter: () => true,
    stepCount: () => 0, visibleSteps: () => [], show: () => {}, exit: () => {},
  })),
}));

const auth = await import('./engine/auth.js');
const sync = await import('./engine/sync.js');
const { initializePokerTrainer } = await import('./engine/initializePokerTrainer');
const { App } = await import('./App');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.isGuest.mockReturnValue(false);
  // clearAllMocks() resets call history but not a mockReturnValue/
  // mockImplementation set by an individual test -- without resetting this
  // here too, the pending-promise mock the "upgrades to the display name"
  // test below installs would otherwise leak into every test that runs
  // after it and never explicitly sets its own.
  auth.getDisplayName.mockResolvedValue(null);
});

describe('auth gate', () => {
  test('shows the sign-in screen when nobody is signed in', async () => {
    auth.getUser.mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  test('shows the app when a user is signed in', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    render(<App />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  test('the guest bypass gets past the gate without a user', async () => {
    auth.getUser.mockResolvedValue(null);
    auth.isGuest.mockReturnValue(true);
    render(<App />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
  });

  test('syncs once after a signed-in boot', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    render(<App />);
    await waitFor(() => expect(sync.syncNow).toHaveBeenCalledTimes(1));
  });

  test('does not sync for a guest', async () => {
    auth.getUser.mockResolvedValue(null);
    auth.isGuest.mockReturnValue(true);
    render(<App />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
    expect(sync.syncNow).not.toHaveBeenCalled();
  });

  test('shows the signed-in email in the rail', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'matty@example.com' });
    render(<App />);
    expect(await screen.findByText('matty@example.com')).toBeInTheDocument();
  });

  test('shows the email immediately, then upgrades to the display name once it loads', async () => {
    let resolveName;
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'matty@example.com' });
    auth.getDisplayName.mockReturnValue(new Promise((resolve) => { resolveName = resolve; }));
    render(<App />);

    expect(await screen.findByText('matty@example.com')).toBeInTheDocument();

    await act(async () => { resolveName('Matty'); });

    expect(screen.getByText('Matty')).toBeInTheDocument();
    expect(screen.queryByText('matty@example.com')).not.toBeInTheDocument();
  });

  test('does not fetch a display name for a guest', async () => {
    auth.getUser.mockResolvedValue(null);
    auth.isGuest.mockReturnValue(true);
    render(<App />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
    expect(auth.getDisplayName).not.toHaveBeenCalled();
  });

  // jsdom reports visibilityState 'visible' and will not change it, so a bare
  // dispatchEvent leaves the listener's own `=== 'hidden'` check false and the
  // assertion passes no matter what the effect does. Forcing the property is
  // what makes these two tests able to fail.
  function hideTab() {
    const own = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    if (own) Object.defineProperty(document, 'visibilityState', own);
    else delete document.visibilityState;
  }

  test('does not start the background push for a guest', async () => {
    auth.getUser.mockResolvedValue(null);
    auth.isGuest.mockReturnValue(true);
    render(<App />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
    hideTab();
    expect(sync.push).not.toHaveBeenCalled();
  });

  // The positive half. Without it, deleting the whole effect would still leave
  // the guest test green -- "never pushes" is trivially satisfied by never
  // pushing at all.
  test('pushes when the tab is hidden for a signed-in player', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    render(<App />);
    // Waiting for the absence of the Sign in button would pass against the
    // pre-check stub, which has no button either -- wait for the signed-in
    // rail instead, which only appears once user state has actually landed.
    await screen.findByText('a@b.com');
    hideTab();
    await waitFor(() => expect(sync.push).toHaveBeenCalled());
  });
});

// Regression coverage for the defect where the engine initialised against DOM
// that the gate had not rendered yet: initializePokerTrainer must never run
// while the gate (or the pre-first-check stub) is showing, must run exactly
// once the shell is actually on screen, and must never run twice.
describe('auth gate defers engine init until the shell renders', () => {
  test('does not initialize the engine while the sign-in gate is showing', async () => {
    auth.getUser.mockResolvedValue(null);
    render(<App />);
    await screen.findByRole('button', { name: 'Sign in' });
    expect(initializePokerTrainer).not.toHaveBeenCalled();
  });

  test('initializes the engine once past the gate via the guest bypass', async () => {
    auth.getUser.mockResolvedValue(null);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /play as a guest/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
    await waitFor(() => expect(initializePokerTrainer).toHaveBeenCalledTimes(1));
  });

  test('initializes the engine once past the gate via sign-in', async () => {
    auth.getUser.mockResolvedValue(null);
    auth.signIn.mockResolvedValue({ user: { id: 'u1', email: 'a@b.com' }, error: null });
    render(<App />);
    await screen.findByRole('button', { name: 'Sign in' });
    expect(initializePokerTrainer).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
    await waitFor(() => expect(initializePokerTrainer).toHaveBeenCalledTimes(1));
  });

  test('does not initialize the engine twice for a signed-in boot', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument());
    await waitFor(() => expect(initializePokerTrainer).toHaveBeenCalledTimes(1));
  });
});

// Critical 1: on a shared browser, signing out of one account and into another
// must not let the second account's syncNow() fold the first account's rows
// (still sitting under the one shared localStorage key) into its own, and
// then push them back up re-owned as its own. RLS cannot catch this -- the
// client really is the second account at that point.
describe('local data ownership across accounts (Critical 1)', () => {
  let reload;

  beforeEach(() => {
    reload = vi.fn();
    // jsdom's location.reload is not writable, so the whole object is replaced.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
  });

  function seedLocalData() {
    localStorage.setItem('chipaway.games.v1', JSON.stringify({
      version: 1, liveId: null, games: [{ id: 'g1', createdAt: 1, status: 'ended', setup: {}, net: 0, state: {} }],
    }));
    localStorage.setItem('chipaway.hands.v1', JSON.stringify([{ id: 'h1', v: 1 }]));
  }

  test('sign-out pushes once more, then clears games and hands from localStorage', async () => {
    seedLocalData();
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    render(<App />);
    await screen.findByText('a@b.com');

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    // The push must have happened before signOut() tore down the session it
    // needs to resolve a user.
    expect(sync.push).toHaveBeenCalled();
    expect(localStorage.getItem('chipaway.games.v1')).toBeNull();
    expect(localStorage.getItem('chipaway.hands.v1')).toBeNull();
    expect(localStorage.getItem('chipaway.lastUser')).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  test('signing into a different account clears the previous account\'s local data first', async () => {
    localStorage.setItem('chipaway.lastUser', 'u1');
    seedLocalData();
    auth.getUser.mockResolvedValue({ id: 'u2', email: 'b@b.com' });

    render(<App />);
    await screen.findByText('b@b.com');

    expect(localStorage.getItem('chipaway.games.v1')).toBeNull();
    expect(localStorage.getItem('chipaway.hands.v1')).toBeNull();
    expect(localStorage.getItem('chipaway.lastUser')).toBe('u2');
  });

  test('a guest who signs into an account (no marker yet) keeps their local hands', async () => {
    // No chipaway.lastUser key at all -- this data belongs to nobody's
    // account yet, which is exactly the guest-adopts-an-account case.
    seedLocalData();
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });

    render(<App />);
    await screen.findByText('a@b.com');

    expect(localStorage.getItem('chipaway.games.v1')).not.toBeNull();
    expect(localStorage.getItem('chipaway.hands.v1')).not.toBeNull();
    expect(localStorage.getItem('chipaway.lastUser')).toBe('u1');
  });
});

// Critical 3: losing a session mid-play (a revoked session, a refresh-token
// failure, sign-out in another tab) must reload rather than re-render the
// gate in place -- the table DOM initializePokerTrainer bound to by id is
// still there, and there is no route back to a live engine without a reload.
describe('reload on mid-session loss (Critical 3)', () => {
  let reload;

  beforeEach(() => {
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
  });

  test('reloads when a session is lost after a user had been established', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    render(<App />);
    await screen.findByText('a@b.com');

    const onChange = auth.onAuthChange.mock.calls[0][0];
    act(() => { onChange(null); });

    expect(reload).toHaveBeenCalled();
  });

  test('does not reload on the ordinary signed-out first load', async () => {
    auth.getUser.mockResolvedValue(null);
    render(<App />);
    await screen.findByRole('button', { name: 'Sign in' });

    const onChange = auth.onAuthChange.mock.calls[0][0];
    act(() => { onChange(null); });

    expect(reload).not.toHaveBeenCalled();
    // Still gated on the sign-in screen rather than stuck on a blank shell.
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});

// Important 4: `games` is read once at first render, so a sync that pulls in
// rows from another browser is invisible until something reloads the page.
// The reload has to be keyed on a count that genuinely cannot be non-zero on
// a no-op re-pull, or it loops forever -- see the comment on
// reloadIfSyncedSomethingNew in App.jsx and on mergeGames in games.js for why
// "touched" (which includes routine updates to already-known ended games)
// was rejected in favour of "added".
describe('reload after a sync pulls in something new (Important 4)', () => {
  let reload;

  beforeEach(() => {
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
  });

  test('reloads once the boot sync pulls in a game or hand not held locally', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    sync.syncNow.mockResolvedValue({ pushed: { games: 0, hands: 0, error: null }, pulled: { games: 1, hands: 0, error: null }, error: null });
    render(<App />);
    await screen.findByText('a@b.com');
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  test('does not reload when the sync pulls in nothing new', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    sync.syncNow.mockResolvedValue({ pushed: { games: 0, hands: 0, error: null }, pulled: { games: 0, hands: 0, error: null }, error: null });
    render(<App />);
    await screen.findByText('a@b.com');
    // A tick for the syncNow().then(...) microtask to have had every chance
    // to run before asserting its absence.
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
  });

  test('reloads once syncing in from the sign-in gate pulls in something new', async () => {
    auth.getUser.mockResolvedValue(null);
    auth.signIn.mockResolvedValue({ user: { id: 'u1', email: 'a@b.com' }, error: null });
    sync.syncNow.mockResolvedValue({ pushed: { games: 0, hands: 0, error: null }, pulled: { games: 0, hands: 1, error: null }, error: null });
    render(<App />);
    await screen.findByRole('button', { name: 'Sign in' });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  test('a merge that keeps returning non-zero on every pull (an update, not an add) would loop -- pulled.games/hands must not carry that', async () => {
    // Regression guard for the trap called out in the review: if syncNow's
    // pulled counts included routine updates to already-known rows (as
    // mergeGames' old "touched" return did), this boot sync would reload,
    // the fresh boot would sync again, get the same non-zero "touched" count
    // back, and reload again forever. Asserting a single reload call proves
    // this test setup -- and by extension the real mergeGames "added" count
    // it stands in for -- does not do that.
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    sync.syncNow.mockResolvedValue({ pushed: { games: 0, hands: 0, error: null }, pulled: { games: 1, hands: 0, error: null }, error: null });
    render(<App />);
    await screen.findByText('a@b.com');
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

// Important 6: getUser() revalidates over the wire and can resolve after
// onAuthChange's INITIAL_SESSION has already established a user from local
// storage with no network call. auth.js's getUser() also turns any transport
// failure into a plain null (see auth.js), so a late resolution here must not
// be treated as "signed out" once a real session is already established.
describe('a late getUser() null does not clear an already-established user (Important 6)', () => {
  test('does not sign the player out when onAuthChange establishes a user before getUser() resolves', async () => {
    let resolveGetUser;
    auth.getUser.mockImplementation(() => new Promise((resolve) => { resolveGetUser = resolve; }));
    render(<App />);

    // onAuthChange's subscription callback fires first, as it does for real
    // (INITIAL_SESSION comes from local storage, no network round trip).
    const onChange = auth.onAuthChange.mock.calls[0][0];
    act(() => { onChange({ id: 'u1', email: 'a@b.com' }); });
    await screen.findByText('a@b.com');

    // The slower, network-revalidating getUser() now resolves null -- a
    // transport failure or a slow response landing after the fact.
    await act(async () => { resolveGetUser(null); });

    // Still signed in: a null from getUser() must not overwrite a user the
    // subscription already established.
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  test('a genuinely signed-out player still reaches the gate', async () => {
    auth.getUser.mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});

// Important 5: "Skip for now" disabled the profile button along with
// everything else it does, leaving a guest no way back to the sign-in screen
// short of devtools.
describe('a guest has a route back to the sign-in screen (Important 5)', () => {
  let reload;

  beforeEach(() => {
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
  });

  test('the profile button is enabled for a guest and drops the guest flag', async () => {
    auth.getUser.mockResolvedValue(null);
    auth.isGuest.mockReturnValue(true);
    render(<App />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());

    const profileButton = screen.getByRole('button', { name: /sign in or create an account/i });
    expect(profileButton).toBeEnabled();

    fireEvent.click(profileButton);

    expect(auth.endGuest).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('./engine/auth.js', () => ({
  getUser: vi.fn(),
  isGuest: vi.fn(() => false),
  onAuthChange: vi.fn(() => () => {}),
  signOut: vi.fn(async () => ({ error: null })),
  signIn: vi.fn(),
  signUp: vi.fn(),
  continueAsGuest: vi.fn(),
}));
vi.mock('./engine/sync.js', () => ({
  syncNow: vi.fn(async () => ({ pushed: null, pulled: null, error: null })),
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

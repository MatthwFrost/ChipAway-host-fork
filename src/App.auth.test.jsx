import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('./engine/auth.js', () => ({
  getUser: vi.fn(),
  isGuest: vi.fn(() => false),
  onAuthChange: vi.fn(() => () => {}),
  signOut: vi.fn(async () => ({ error: null })),
}));
vi.mock('./engine/sync.js', () => ({
  syncNow: vi.fn(async () => ({ pushed: null, pulled: null, error: null })),
}));
// The engine paints into DOM nodes this test does not care about, and
// initialises once per page. Stubbing it keeps the gate test about the gate.
vi.mock('./engine/initializePokerTrainer', () => ({
  initializePokerTrainer: () => ({
    canReplay: () => true, isReplaying: () => false, enter: () => true,
    stepCount: () => 0, visibleSteps: () => [], show: () => {}, exit: () => {},
  }),
}));

const auth = await import('./engine/auth.js');
const sync = await import('./engine/sync.js');
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

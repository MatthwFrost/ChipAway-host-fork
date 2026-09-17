import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Same stubs as App.auth.test.jsx: this file is about who gets the Dev notes
// row and what the shell does when they press it, not about auth or the engine.
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
vi.mock('./engine/initializePokerTrainer', () => ({
  initializePokerTrainer: vi.fn(() => ({
    canReplay: () => true, isReplaying: () => false, enter: () => true,
    stepCount: () => 0, visibleSteps: () => [], show: () => {}, exit: () => {},
  })),
}));
// The real isAdmin is kept -- the email list IS the thing under test here --
// but the network half is stubbed so no test touches the project.
const loadNotes = vi.fn(async () => ({ body: '# Notes', updatedAt: 'T1', updatedEmail: 'tom0706@outlook.com', error: null }));
vi.mock('./engine/devNotes', async (importOriginal) => ({
  ...(await importOriginal()),
  loadNotes: (...a) => loadNotes(...a),
  saveNotes: vi.fn(async () => ({ ok: true, conflict: false, updatedAt: 'T2', updatedEmail: 'x', error: null })),
}));

const auth = await import('./engine/auth.js');
const { App } = await import('./App');

const rail = async () => within(await screen.findByRole('navigation', { name: 'Main' }));
const shell = () => document.querySelector('.shell').dataset.screen;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  auth.isGuest.mockReturnValue(false);
  auth.getDisplayName.mockResolvedValue(null);
});

describe('who sees the dev notes', () => {
  test('an admin gets the row', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'matthwfrost@gmail.com' });
    render(<App />);
    expect(await (await rail()).findByText('Dev notes')).toBeInTheDocument();
  });

  test('the other admin gets it too, whatever case they signed up in', async () => {
    auth.getUser.mockResolvedValue({ id: 'u2', email: 'Tom0706@outlook.com' });
    render(<App />);
    expect(await (await rail()).findByText('Dev notes')).toBeInTheDocument();
  });

  test('an ordinary player does not, and the screen is not even mounted for them', async () => {
    auth.getUser.mockResolvedValue({ id: 'u3', email: 'player@example.com' });
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByText('Dev notes')).not.toBeInTheDocument();
    expect(document.querySelector('.dev-notes')).toBeNull();
    // Not merely hidden: nothing was fetched either.
    expect(loadNotes).not.toHaveBeenCalled();
  });

  test('a guest does not', async () => {
    auth.isGuest.mockReturnValue(true);
    auth.getUser.mockResolvedValue(null);
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByText('Dev notes')).not.toBeInTheDocument();
  });
});

describe('opening the page', () => {
  test('switches the shell to the notes screen and loads the doc', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'matthwfrost@gmail.com' });
    render(<App />);
    const row = await (await rail()).findByText('Dev notes');

    expect(loadNotes).not.toHaveBeenCalled(); // not until it is opened
    fireEvent.click(row.closest('button'));

    expect(shell()).toBe('notes');
    await waitFor(() => expect(loadNotes).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'Notes' })).toBeInTheDocument();
  });

  test('leaves the table and the dashboard behind, and comes back to them intact', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'matthwfrost@gmail.com' });
    render(<App />);
    const r = await rail();
    fireEvent.click((await r.findByText('Dev notes')).closest('button'));
    expect(shell()).toBe('notes');

    fireEvent.click(r.getByText('Home').closest('button'));
    expect(shell()).toBe('home');
  });
});

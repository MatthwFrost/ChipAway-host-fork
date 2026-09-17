import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The client is mocked wholesale: these tests are about the wrapper's contract
// -- friendly errors, guest flag, unsubscribe -- not about supabase-js.
const mockAuth = {
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
};

vi.mock('./supabaseClient.js', () => ({
  supabase: { auth: mockAuth },
  isConfigured: true,
  SUPABASE_URL: 'https://example.supabase.co',
}));

let auth;
beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  auth = await import('./auth.js');
});
afterEach(() => { vi.resetModules(); });

describe('sign in', () => {
  test('returns the user on success', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } }, error: null });
    const res = await auth.signIn('a@b.com', 'pw');
    expect(res.user.id).toBe('u1');
    expect(res.error).toBeNull();
  });

  test('turns a bad-credentials error into something a person can read', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });
    const res = await auth.signIn('a@b.com', 'wrong');
    expect(res.user).toBeNull();
    expect(res.error).toBe('That email and password do not match.');
  });

  test('refuses an empty email or password without calling the network', async () => {
    const res = await auth.signIn('', '');
    expect(res.error).toBe('Enter your email and password.');
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  test('turns a rejected (transport-level) call into a readable error instead of throwing', async () => {
    mockAuth.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await auth.signIn('a@b.com', 'pw');
    expect(res.user).toBeNull();
    expect(res.error).toBe("Can't reach the server. Check your connection and try again.");
  });

  test('clears a stale guest flag on success, so it cannot wave the player past the gate later', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } }, error: null });
    auth.continueAsGuest();
    await auth.signIn('a@b.com', 'pw');
    expect(auth.isGuest()).toBe(false);
  });

  test('leaves the guest flag alone on a failed sign-in', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });
    auth.continueAsGuest();
    await auth.signIn('a@b.com', 'wrong');
    expect(auth.isGuest()).toBe(true);
  });
});

describe('sign up', () => {
  test('flags when a confirmation email is required', async () => {
    // Supabase returns a user with no session when confirmations are on.
    mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'u2' }, session: null }, error: null });
    const res = await auth.signUp('a@b.com', 'password123');
    expect(res.needsConfirmation).toBe(true);
    expect(res.error).toBeNull();
  });

  test('does not flag confirmation when a session comes back', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'u2' }, session: { access_token: 't' } }, error: null });
    const res = await auth.signUp('a@b.com', 'password123');
    expect(res.needsConfirmation).toBe(false);
  });

  test('rejects a short password before calling the network', async () => {
    const res = await auth.signUp('a@b.com', 'short');
    expect(res.error).toBe('Use a password of at least 8 characters.');
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });

  test('turns a rejected (transport-level) call into a readable error instead of throwing', async () => {
    mockAuth.signUp.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await auth.signUp('a@b.com', 'password123');
    expect(res.user).toBeNull();
    expect(res.error).toBe("Can't reach the server. Check your connection and try again.");
    expect(res.needsConfirmation).toBe(false);
  });

  test('clears a stale guest flag when a session comes back immediately', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'u2' }, session: { access_token: 't' } }, error: null });
    auth.continueAsGuest();
    await auth.signUp('a@b.com', 'password123');
    expect(auth.isGuest()).toBe(false);
  });

  test('leaves the guest flag alone when confirmation is still pending -- there is no session yet', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'u2' }, session: null }, error: null });
    auth.continueAsGuest();
    const res = await auth.signUp('a@b.com', 'password123');
    expect(res.needsConfirmation).toBe(true);
    expect(auth.isGuest()).toBe(true);
  });
});

describe('guest mode', () => {
  test('is off by default, on after continueAsGuest, off after endGuest', () => {
    expect(auth.isGuest()).toBe(false);
    auth.continueAsGuest();
    expect(auth.isGuest()).toBe(true);
    auth.endGuest();
    expect(auth.isGuest()).toBe(false);
  });
});

describe('onAuthChange', () => {
  test('passes the user through and returns a working unsubscribe', () => {
    const unsubscribe = vi.fn();
    let handler = null;
    mockAuth.onAuthStateChange.mockImplementation((cb) => {
      handler = cb;
      return { data: { subscription: { unsubscribe } } };
    });
    const seen = [];
    const off = auth.onAuthChange((u) => seen.push(u));

    handler('SIGNED_IN', { user: { id: 'u1' } });
    handler('SIGNED_OUT', null);
    expect(seen).toEqual([{ id: 'u1' }, null]);

    off();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe('sign out', () => {
  test('clears the guest flag too, so the gate is not bypassed afterwards', async () => {
    mockAuth.signOut.mockResolvedValue({ error: null });
    auth.continueAsGuest();
    await auth.signOut();
    expect(auth.isGuest()).toBe(false);
  });

  test('turns a rejected (transport-level) call into a readable error instead of throwing', async () => {
    mockAuth.signOut.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await auth.signOut();
    expect(res.error).toBe("Can't reach the server. Check your connection and try again.");
  });
});

describe('getUser', () => {
  test('returns null rather than throwing when the call is rejected (transport-level)', async () => {
    mockAuth.getUser.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await auth.getUser();
    expect(res).toBeNull();
  });
});

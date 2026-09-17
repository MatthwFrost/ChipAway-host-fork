import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Companion to auth.test.js, which hardcodes isConfigured: true at module
// level (vi.mock is hoisted, so that value cannot vary per describe within
// one file). This file exercises the opposite: no Supabase env vars set, so
// supabaseClient.js exports supabase === null and isConfigured === false.
// Every auth.js function must still return its documented no-backend value
// without throwing and without touching the (null) supabase client.
const mockAuth = {
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
};

vi.mock('./supabaseClient.js', () => ({
  supabase: null,
  isConfigured: false,
  SUPABASE_URL: undefined,
}));

let auth;
beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  auth = await import('./auth.js');
});
afterEach(() => { vi.resetModules(); });

describe('when Supabase is not configured', () => {
  test('signIn returns the no-backend message without touching the client', async () => {
    const res = await auth.signIn('a@b.com', 'pw');
    expect(res).toEqual({ user: null, error: 'Accounts are not set up in this build. Play as a guest instead.' });
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  test('signUp returns the no-backend message without touching the client', async () => {
    const res = await auth.signUp('a@b.com', 'password123');
    expect(res).toEqual({
      user: null,
      error: 'Accounts are not set up in this build. Play as a guest instead.',
      needsConfirmation: false,
    });
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });

  test('signOut still clears the guest flag and returns a null error', async () => {
    auth.continueAsGuest();
    const res = await auth.signOut();
    expect(res).toEqual({ error: null });
    expect(auth.isGuest()).toBe(false);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  test('getUser returns null without touching the client', async () => {
    const res = await auth.getUser();
    expect(res).toBeNull();
    expect(mockAuth.getUser).not.toHaveBeenCalled();
  });

  test('onAuthChange returns a no-op unsubscribe safe to call from a React effect cleanup', () => {
    const off = auth.onAuthChange(() => {});
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
    expect(mockAuth.onAuthStateChange).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Companion to auth.test.js, which hardcodes isConfigured: true at module
// level (vi.mock is hoisted, so that value cannot vary per describe within
// one file). This file exercises the opposite: no Supabase env vars set, so
// supabaseClient.js exports supabase === null and isConfigured === false.
// Every auth.js function must still return its documented no-backend value
// without throwing and without touching the (null) supabase client.
//
// "without touching the client" needs no spy to assert: supabase IS null here,
// so any auth.js path that reached for supabase.auth.* would raise a TypeError
// and fail the test outright. A mock client would be a weaker check, not a
// stronger one -- it would let such a path succeed silently.
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
  });

  test('signUp returns the no-backend message without touching the client', async () => {
    const res = await auth.signUp('a@b.com', 'password123', 'Ada');
    expect(res).toEqual({
      user: null,
      error: 'Accounts are not set up in this build. Play as a guest instead.',
      needsConfirmation: false,
    });
  });

  test('signOut still clears the guest flag and returns a null error', async () => {
    auth.continueAsGuest();
    const res = await auth.signOut();
    expect(res).toEqual({ error: null });
    expect(auth.isGuest()).toBe(false);
  });

  test('getUser returns null without touching the client', async () => {
    const res = await auth.getUser();
    expect(res).toBeNull();
  });

  test('getDisplayName returns null without touching the client', async () => {
    const res = await auth.getDisplayName();
    expect(res).toBeNull();
  });

  test('onAuthChange returns a no-op unsubscribe safe to call from a React effect cleanup', () => {
    const off = auth.onAuthChange(() => {});
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
});

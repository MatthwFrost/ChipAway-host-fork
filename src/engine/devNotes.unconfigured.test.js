import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Companion to devNotes.test.js, which hardcodes isConfigured: true at module
// level -- vi.mock is hoisted, so that value cannot vary per describe within
// one file, and un-mocking it mid-file would point the remaining tests at the
// real project. This file exercises the opposite: no Supabase env vars, so
// supabaseClient.js exports supabase === null.
//
// supabase IS null here, so any path that reached for supabase.from() would
// raise a TypeError and fail outright. That is a stronger check than a mock
// client, which would let such a path pass silently.
vi.mock('./supabaseClient.js', () => ({
  supabase: null,
  isConfigured: false,
  SUPABASE_URL: undefined,
}));

let devNotes;
beforeEach(async () => {
  vi.clearAllMocks();
  devNotes = await import('./devNotes.js');
});
afterEach(() => { vi.resetModules(); });

describe('when Supabase is not configured', () => {
  test('loadNotes reports the missing backend without touching the client', async () => {
    const res = await devNotes.loadNotes();
    expect(res.body).toBeNull();
    expect(res.error).toMatch(/not set up in this build/i);
  });

  test('saveNotes reports the missing backend without touching the client', async () => {
    const res = await devNotes.saveNotes('# New', 'T1');
    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(false);
    expect(res.error).toMatch(/not set up in this build/i);
  });

  test('isAdmin still answers, since it never needed the network', () => {
    expect(devNotes.isAdmin({ email: 'matthwfrost@gmail.com' })).toBe(true);
    expect(devNotes.isAdmin({ email: 'nobody@example.com' })).toBe(false);
  });
});

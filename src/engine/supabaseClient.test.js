import { afterEach, describe, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  return import('./supabaseClient.js');
}

describe('supabase client', () => {
  test('is unconfigured when env vars are absent', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const mod = await load();
    expect(mod.isConfigured).toBe(false);
    // Null rather than a broken client: the app must still deal cards with no
    // backend configured, and a half-built client would throw on first use.
    expect(mod.supabase).toBeNull();
  });

  test('builds a client when both env vars are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-value');
    const mod = await load();
    expect(mod.isConfigured).toBe(true);
    expect(mod.supabase).not.toBeNull();
    expect(typeof mod.supabase.auth.signInWithPassword).toBe('function');
  });

  test('is unconfigured if only one env var is set', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const mod = await load();
    expect(mod.isConfigured).toBe(false);
  });
});

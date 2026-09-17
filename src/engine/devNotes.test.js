import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mocked wholesale, same as auth.test.js: these tests are about the wrapper's
// contract -- the {..., error} shape, the conflict signal, the guards -- not
// about supabase-js or about RLS, which is the database's job to enforce and
// 0003_dev_notes.sql's job to get right.
//
// The builder mirrors postgrest's chaining: every link returns the next one,
// and the terminal call resolves whatever the test queued.
const result = { select: null, update: null };

function chain(terminal) {
  const link = {
    eq: () => link,
    select: () => link,
    maybeSingle: () => Promise.resolve(result.select),
    then: (...a) => Promise.resolve(terminal()).then(...a),
  };
  return link;
}

const from = vi.fn(() => ({
  select: () => chain(() => result.select),
  update: () => chain(() => result.update),
}));

vi.mock('./supabaseClient.js', () => ({
  supabase: { from: (...a) => from(...a) },
  isConfigured: true,
  SUPABASE_URL: 'https://example.supabase.co',
}));

let devNotes;
beforeEach(async () => {
  vi.clearAllMocks();
  result.select = { data: null, error: null };
  result.update = { data: [], error: null };
  devNotes = await import('./devNotes.js');
});
afterEach(() => { vi.resetModules(); });

describe('isAdmin', () => {
  test('recognises both admins', () => {
    expect(devNotes.isAdmin({ email: 'matthwfrost@gmail.com' })).toBe(true);
    expect(devNotes.isAdmin({ email: 'Tom0706@outlook.com' })).toBe(true);
  });

  test('is case and whitespace insensitive, because the email on a JWT is whatever was typed at sign-up', () => {
    expect(devNotes.isAdmin({ email: '  MATTHWFROST@Gmail.com ' })).toBe(true);
  });

  test('turns away everybody else, including guests and the half-loaded user', () => {
    expect(devNotes.isAdmin({ email: 'someone@else.com' })).toBe(false);
    expect(devNotes.isAdmin(null)).toBe(false);
    expect(devNotes.isAdmin(undefined)).toBe(false);
    expect(devNotes.isAdmin({})).toBe(false);
    expect(devNotes.isAdmin({ email: null })).toBe(false);
  });

  test('does not match an address that merely contains an admin one', () => {
    expect(devNotes.isAdmin({ email: 'matthwfrost@gmail.com.evil.com' })).toBe(false);
    expect(devNotes.isAdmin({ email: 'xmatthwfrost@gmail.com' })).toBe(false);
  });
});

describe('loadNotes', () => {
  test('returns the doc', async () => {
    result.select = { data: { body: '# Hi', updated_at: '2026-09-17T10:00:00.123456+00:00', updated_email: 'a@b.com' }, error: null };
    const res = await devNotes.loadNotes();
    expect(res.body).toBe('# Hi');
    expect(res.updatedAt).toBe('2026-09-17T10:00:00.123456+00:00');
    expect(res.updatedEmail).toBe('a@b.com');
    expect(res.error).toBeNull();
  });

  test('reads no row as no access, which is what RLS returns to a non-admin', async () => {
    result.select = { data: null, error: null };
    const res = await devNotes.loadNotes();
    expect(res.error).toBe(devNotes.NO_ACCESS);
    expect(res.body).toBeNull();
  });

  test('survives a transport failure instead of rejecting', async () => {
    from.mockImplementationOnce(() => { throw new Error('offline'); });
    const res = await devNotes.loadNotes();
    expect(res.error).toMatch(/connection/i);
  });

  // The no-backend case lives in devNotes.unconfigured.test.js, for the reason
  // given at the top of that file: vi.mock is hoisted, so isConfigured cannot
  // vary within one file -- and doUnmock'ing it here would hand every later
  // import in this file the real client, pointed at the real project.
});

describe('saveNotes', () => {
  test('saves and hands back the new timestamp', async () => {
    result.update = { data: [{ updated_at: 'T2', updated_email: 'a@b.com' }], error: null };
    const res = await devNotes.saveNotes('# New', 'T1');
    expect(res.ok).toBe(true);
    expect(res.conflict).toBe(false);
    expect(res.updatedAt).toBe('T2');
    expect(res.error).toBeNull();
  });

  test('reports a conflict when the match on updated_at finds no row', async () => {
    // Nobody else editing looks identical to no rows returned, which is
    // exactly the point: the database decides, not a read-then-write race.
    result.update = { data: [], error: null };
    const res = await devNotes.saveNotes('# New', 'stale');
    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(true);
    expect(res.error).toMatch(/since you opened/i);
  });

  test('a database error is not a conflict', async () => {
    result.update = { data: null, error: { message: 'permission denied' } };
    const res = await devNotes.saveNotes('# New', 'T1');
    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(false);
    expect(res.error).toBe('permission denied');
  });

  test('survives a transport failure instead of rejecting', async () => {
    from.mockImplementationOnce(() => { throw new Error('offline'); });
    const res = await devNotes.saveNotes('# New', 'T1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/connection/i);
  });

  test('refuses to save without the timestamp it loaded, rather than clobbering the doc', async () => {
    const res = await devNotes.saveNotes('# New', null);
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

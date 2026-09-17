/* ============================================================
   DEV NOTES — the shared change list the two admins keep.

   One row in public.dev_notes, holding one markdown document. Everything here
   follows the shape auth.js established: every call comes back as a plain
   object with a readable error string, never a rejected promise, because a
   transport failure is not the user's fault and should not crash a screen.

   The email list below is NOT what keeps this private. It ships in the browser
   bundle like everything else on a static site, and all it decides is whether
   the nav row is drawn. The lock is private.is_admin() in
   supabase/migrations/0003_dev_notes.sql -- a non-admin who calls the endpoint
   by hand gets zero rows back, which is what NO_ACCESS below reports.
   ============================================================ */

import { isConfigured, supabase } from './supabaseClient.js';

export const ADMIN_EMAILS = ['matthwfrost@gmail.com', 'tom0706@outlook.com'];

const NO_BACKEND = 'Accounts are not set up in this build, so there are no notes to load.';
const NETWORK_ERROR = "Can't reach the server. Check your connection and try again.";
export const NO_ACCESS = 'This page is for admins only.';
export const CONFLICT = 'Someone else saved changes since you opened this. Reload to see them — your text is kept below.';

// Pure, so the rail and the screen can both ask without either of them
// holding the list. Trimmed and lowercased because an address is
// case-insensitive in practice and Supabase stores whatever was typed at
// sign-up; compared whole, never with includes() on the string, so
// "matthwfrost@gmail.com.example.com" is not an admin.
export function isAdmin(user) {
  const email = user && typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  return email !== '' && ADMIN_EMAILS.includes(email);
}

export async function loadNotes() {
  if (!isConfigured) return { body: null, updatedAt: null, updatedEmail: null, error: NO_BACKEND };
  try {
    const { data, error } = await supabase
      .from('dev_notes')
      .select('body, updated_at, updated_email')
      .eq('id', 1)
      .maybeSingle();
    if (error) return { body: null, updatedAt: null, updatedEmail: null, error: error.message || NO_ACCESS };
    // RLS does not raise for a row you cannot see -- it filters it out, so a
    // non-admin's read succeeds and returns nothing. Absent row and absent
    // permission are the same answer over the wire, and mean the same thing
    // to the person looking at the screen.
    if (!data) return { body: null, updatedAt: null, updatedEmail: null, error: NO_ACCESS };
    return {
      body: data.body || '',
      // Deliberately kept as the string Postgres sent. Parsing it into a Date
      // and re-serialising rounds off the microseconds, and the equality
      // match in saveNotes would then never find the row again.
      updatedAt: data.updated_at,
      updatedEmail: data.updated_email || null,
      error: null,
    };
  } catch (e) {
    return { body: null, updatedAt: null, updatedEmail: null, error: NETWORK_ERROR };
  }
}

// expectedUpdatedAt is the value loadNotes() handed over. Matching on it is
// what makes this safe for two people at once: the filter and the write are
// one statement, so there is no gap between checking and writing for the other
// admin to slip through. No rows updated means the doc moved under us.
export async function saveNotes(body, expectedUpdatedAt) {
  if (!isConfigured) return { ok: false, conflict: false, updatedAt: null, updatedEmail: null, error: NO_BACKEND };
  // Without a token there is no safe update to make. Saving anyway would mean
  // writing over a document we never successfully read.
  if (!expectedUpdatedAt) {
    return { ok: false, conflict: false, updatedAt: null, updatedEmail: null, error: 'Reload the page before saving.' };
  }
  try {
    const { data, error } = await supabase
      .from('dev_notes')
      .update({ body })
      .eq('id', 1)
      .eq('updated_at', expectedUpdatedAt)
      .select('updated_at, updated_email');
    if (error) return { ok: false, conflict: false, updatedAt: null, updatedEmail: null, error: error.message || 'Could not save.' };
    const row = data && data[0];
    if (!row) return { ok: false, conflict: true, updatedAt: null, updatedEmail: null, error: CONFLICT };
    return { ok: true, conflict: false, updatedAt: row.updated_at, updatedEmail: row.updated_email || null, error: null };
  } catch (e) {
    return { ok: false, conflict: false, updatedAt: null, updatedEmail: null, error: NETWORK_ERROR };
  }
}

/* ============================================================
   AUTH — sign in, sign out, and the guest escape hatch.

   A thin wrapper over supabase-js, for two reasons. First, every call site
   gets the same {user, error} shape with an error string a player can read --
   "Invalid login credentials" is a protocol message, not a sentence. Second,
   the rest of the app never imports supabase-js directly, so guest mode and
   the unconfigured case are handled in exactly one place.
   ============================================================ */

import { isConfigured, supabase } from './supabaseClient.js';

export const GUEST_KEY = 'chipaway.guest';

const NO_BACKEND = 'Accounts are not set up in this build. Play as a guest instead.';

// Supabase's messages are aimed at developers. These are aimed at a player.
const FRIENDLY = {
  'Invalid login credentials': 'That email and password do not match.',
  'Email not confirmed': 'Check your email and confirm the address first.',
  'User already registered': 'That email already has an account. Sign in instead.',
};

function friendly(error) {
  if (!error) return null;
  return FRIENDLY[error.message] || error.message || 'Something went wrong. Try again.';
}

/* ---- guest ---- */

export function isGuest() {
  try { return localStorage.getItem(GUEST_KEY) === '1'; } catch (e) { return false; }
}

export function continueAsGuest() {
  try { localStorage.setItem(GUEST_KEY, '1'); } catch (e) { /* private mode */ }
}

export function endGuest() {
  try { localStorage.removeItem(GUEST_KEY); } catch (e) { /* private mode */ }
}

/* ---- account ---- */

export async function signIn(email, password) {
  if (!email || !password) return { user: null, error: 'Enter your email and password.' };
  if (!isConfigured) return { user: null, error: NO_BACKEND };
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return { user: error ? null : (data && data.user) || null, error: friendly(error) };
}

export async function signUp(email, password) {
  if (!email || !password) return { user: null, error: 'Enter your email and password.', needsConfirmation: false };
  // Checked here rather than left to the server so the player is told before
  // a round trip, and in the same words every time.
  if (password.length < 8) {
    return { user: null, error: 'Use a password of at least 8 characters.', needsConfirmation: false };
  }
  if (!isConfigured) return { user: null, error: NO_BACKEND, needsConfirmation: false };
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
  // A user with no session means Supabase is waiting on a confirmation email.
  const needsConfirmation = Boolean(!error && data && data.user && !data.session);
  return { user: error ? null : (data && data.user) || null, error: friendly(error), needsConfirmation };
}

export async function signOut() {
  // Cleared first: if the network call fails, the player must not be left
  // holding a guest flag that quietly waves them past the gate.
  endGuest();
  if (!isConfigured) return { error: null };
  const { error } = await supabase.auth.signOut();
  return { error: friendly(error) };
}

export async function getUser() {
  if (!isConfigured) return null;
  // getUser(), not getSession(): getSession trusts whatever is in storage,
  // while getUser revalidates the token with the server.
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return (data && data.user) || null;
}

// Returns an unsubscribe function. Callers are React effects, which need a
// cleanup they can return directly.
export function onAuthChange(cb) {
  if (!isConfigured) return function () {};
  const { data } = supabase.auth.onAuthStateChange(function (_event, session) {
    cb(session ? session.user : null);
  });
  return function () {
    if (data && data.subscription) data.subscription.unsubscribe();
  };
}

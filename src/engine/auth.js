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

// supabase-js resolves with { data, error } for an API-level failure (bad
// password, expired token, ...) but REJECTS the promise for a transport-level
// one -- offline, DNS failure, CORS, an aborted request. That rejection must
// still come out the same { user, error } / { error } door as everything
// else, so every call below is wrapped and the reject path is given its own
// message: unlike a bad password, this is not the player's fault.
const NETWORK_ERROR = "Can't reach the server. Check your connection and try again.";

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
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    const user = error ? null : (data && data.user) || null;
    // A stale guest flag must not survive a real sign-in: skipping the gate
    // for the wrong reason once the session it was standing in for is gone
    // (expired, revoked elsewhere) is exactly the failure this closes.
    if (user) endGuest();
    return { user: user, error: friendly(error) };
  } catch (e) {
    return { user: null, error: NETWORK_ERROR };
  }
}

export async function signUp(email, password) {
  if (!email || !password) return { user: null, error: 'Enter your email and password.', needsConfirmation: false };
  // Checked here rather than left to the server so the player is told before
  // a round trip, and in the same words every time.
  if (password.length < 8) {
    return { user: null, error: 'Use a password of at least 8 characters.', needsConfirmation: false };
  }
  if (!isConfigured) return { user: null, error: NO_BACKEND, needsConfirmation: false };
  try {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    // A user with no session means Supabase is waiting on a confirmation email.
    const needsConfirmation = Boolean(!error && data && data.user && !data.session);
    const user = error ? null : (data && data.user) || null;
    // Only clear the guest flag once there is an actual session to replace it
    // with. needsConfirmation means signUp succeeded but nobody is signed in
    // yet -- dropping the guest bypass here, before the player has finished
    // confirming, would strand them at the gate with no session and no guest
    // escape hatch until they check their email.
    if (user && !needsConfirmation) endGuest();
    return { user: user, error: friendly(error), needsConfirmation };
  } catch (e) {
    return { user: null, error: NETWORK_ERROR, needsConfirmation: false };
  }
}

export async function signOut() {
  // Cleared first: if the network call fails, the player must not be left
  // holding a guest flag that quietly waves them past the gate.
  endGuest();
  if (!isConfigured) return { error: null };
  try {
    const { error } = await supabase.auth.signOut();
    return { error: friendly(error) };
  } catch (e) {
    return { error: NETWORK_ERROR };
  }
}

export async function getUser() {
  if (!isConfigured) return null;
  try {
    // getUser(), not getSession(): getSession trusts whatever is in storage,
    // while getUser revalidates the token with the server.
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return (data && data.user) || null;
  } catch (e) {
    return null;
  }
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

import { useCallback, useState } from 'react';
import { continueAsGuest, signIn, signUp } from '../engine/auth.js';

/* ============================================================
   SIGN IN — the gate, and the way around it.

   The bypass is deliberate and load-bearing. ChipAway's pitch has always been
   "no install, no sign-up, runs entirely in your browser", and a gate with no
   way past it would break that on the first visit. It is also what makes the
   app testable without a backend.
   ============================================================ */

export function SignInScreen({ onSignedIn, onGuest }) {
  const [mode, setMode] = useState('signin');   // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const creating = mode === 'signup';

  const submit = useCallback(async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = creating ? await signUp(email, password) : await signIn(email, password);
      if (res.error) { setError(res.error); return; }
      if (creating && res.needsConfirmation) {
        setNotice('Check your email and click the link to finish creating your account.');
        return;
      }
      if (res.user) {
        onSignedIn(res.user);
      } else {
        // Neither an error nor a user: should not happen given auth.js's
        // contract, but a form that just sits there with the button re-enabled
        // and no feedback reads as broken. Reuse the same generic message the
        // catch block below already shows for the equivalent "something came
        // back that was not supposed to" case.
        setError('Something went wrong. Try again.');
      }
    } catch (e) {
      // Belt and braces: auth.js already catches transport failures and
      // returns them as res.error above, but if a future caller ever throws
      // instead, the player still sees something rather than a frozen form.
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }, [creating, email, password, onSignedIn]);

  const skip = useCallback(() => {
    continueAsGuest();
    onGuest();
  }, [onGuest]);

  return (
    <main className="signin-screen">
      <div className="signin-card">
        <h1 className="signin-title">ChipAway</h1>
        <p className="signin-sub">
          {creating
            ? 'An account keeps your games and every hand you play, on any device.'
            : 'Sign in to pick up your games and hand history where you left off.'}
        </p>

        <form className="signin-form" onSubmit={submit}>
          <label className="signin-label" htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            className="signin-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label className="signin-label" htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            className="signin-input"
            type="password"
            autoComplete={creating ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error ? <p className="signin-error" role="alert">{error}</p> : null}
          {notice ? <p className="signin-notice" role="status">{notice}</p> : null}

          <button className="signin-submit" type="submit" disabled={busy}>
            {busy
              ? (creating ? 'Creating account…' : 'Signing in…')
              : (creating ? 'Create account' : 'Sign in')}
          </button>
        </form>

        <button
          type="button"
          className="signin-switch"
          onClick={() => { setMode(creating ? 'signin' : 'signup'); setError(null); setNotice(null); }}
        >
          {creating ? 'Already have an account? Sign in' : 'No account? Create one'}
        </button>

        {/* The escape hatch. Everything works without an account; only the
            syncing across devices does not. */}
        <button type="button" className="signin-skip" onClick={skip}>
          Skip for now — play as a guest
        </button>
      </div>
    </main>
  );
}

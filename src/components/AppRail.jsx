// The global left-hand rail: what you'd see on any screen of the app, not just
// the table. It sits outside .board-grid so the table/side-panel split below is
// free to collapse on narrow screens without the rail moving with it.
//
// Home and Play are real screens now, and the profile row at the foot shows
// whoever is signed in (or that nobody is, for a guest). For a signed-in
// player it signs them out; for a guest it is the only route back to the
// sign-in screen -- "Skip for now" is otherwise a one-way door.

import { avatarInitial, profileLabel } from './profileLabel';

export function AppRail({ screen = 'table', onNavigate = () => {}, user = null, displayName = null, onSignOut = () => {}, onLeaveGuest = () => {}, admin = false }) {
  // Shared with the table's player bar so the two identities cannot drift --
  // see profileLabel.js.
  const label = profileLabel(user, displayName);
  return (
    <nav className="app-rail" aria-label="Main">
      <div className="app-rail-brand">
        <h1 className="app-rail-title">ChipAway</h1>
        {/* The collapsed rail has no room for the wordmark, and an empty brand
            row would leave a gap where the logo ought to be. CSS swaps this
            monogram in at the same width the labels drop. */}
        <span className="app-rail-short" aria-hidden="true">CA</span>
      </div>

      {/* Which row is marked follows the screen, the way chess.com's nav marks
          its active section. */}
      <div className="app-rail-nav">
        <button
          type="button"
          className={`rail-btn rail-home${screen === 'home' ? ' is-active' : ''}`}
          aria-current={screen === 'home' ? 'page' : undefined}
          onClick={() => onNavigate('home')}
        >
          {/* One card, face-up, inked with a house — the same plate the Play fan
              is built from, so the three marks read as one set. The ink is a
              solid silhouette rather than an outline: next to a pip as heavy as
              ♠ a hairline stroke reads as a smudge, not an icon. Drawn rather
              than typed for the same reason the suits below are — ⌂ and ↺ are
              missing or badly proportioned in plenty of UI fonts. */}
          <span className="rail-mark" aria-hidden="true">
            <span className="rail-card is-solo">
              <svg className="rail-ink" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.2 1.5 11.8H4.4V21H9.6V15.3H14.4V21H19.6V11.8H22.5Z" />
              </svg>
            </span>
          </span>
          <span className="rail-label">Home</span>
        </button>

        <button
          type="button"
          className={`rail-btn rail-play${screen === 'table' ? ' is-active' : ''}`}
          aria-current={screen === 'table' ? 'page' : undefined}
          onClick={() => onNavigate('table')}
        >
          {/* Two cards fanned face-up, built from the same face as the cards on
              the table rather than a suit emoji — emoji suits render in colour
              on some platforms and ignore the red/black we set. */}
          <span className="rail-mark" aria-hidden="true">
            <span className="rail-card is-back">♠</span>
            <span className="rail-card is-front is-red">♥</span>
          </span>
          <span className="rail-label">Play</span>
        </button>

        <button
          type="button"
          className={`rail-btn rail-history${screen === 'history' ? ' is-active' : ''}`}
          aria-current={screen === 'history' ? 'page' : undefined}
          onClick={() => onNavigate('history')}
        >
          {/* The same card as Home, inked with a rewind — what the screen does
              to a hand you've already played. A rewind rather than the usual
              circular history arrow: an arc thin enough to curve is illegible
              at 13px, where two solid triangles hold their shape. */}
          <span className="rail-mark" aria-hidden="true">
            <span className="rail-card is-solo">
              <svg className="rail-ink" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.5 5.5V18.5L2.5 12Z" />
                <path d="M21.5 5.5V18.5L12.5 12Z" />
              </svg>
            </span>
          </span>
          <span className="rail-label">History</span>
        </button>

        {/* Admins only, and only cosmetically so: this decides whether the row
            is drawn, nothing more. What actually keeps the notes private is
            the RLS policy in 0003_dev_notes.sql -- a non-admin who calls the
            endpoint directly gets no rows back. See devNotes.js. */}
        {admin && (
          <button
            type="button"
            className={`rail-btn rail-notes${screen === 'notes' ? ' is-active' : ''}`}
            aria-current={screen === 'notes' ? 'page' : undefined}
            onClick={() => onNavigate('notes')}
          >
            {/* The same card again, inked with a tick — a list of things to
                change, and what you do to them. */}
            <span className="rail-mark" aria-hidden="true">
              <span className="rail-card is-solo">
                <svg className="rail-ink" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9.4 19.6 1.8 12l3-3 4.6 4.6L19.2 4.2l3 3Z" />
                </svg>
              </span>
            </span>
            <span className="rail-label">Dev notes</span>
          </button>
        )}
      </div>

      {/* margin-top:auto pins this to the floor of the rail, whatever grows
          above it. Guests get the same row, saying what they are missing --
          and clicking it is their route back to the sign-in screen, since
          "Skip for now" would otherwise be a one-way door. */}
      <button type="button" className="rail-profile" onClick={user ? onSignOut : onLeaveGuest}>
        <span className="rail-avatar" aria-hidden="true">
          {avatarInitial(label)}
        </span>
        <span className="rail-profile-text">
          <span className="rail-profile-name">{label}</span>
          <span className="rail-profile-meta">{user ? 'Sign out' : 'Sign in or create an account'}</span>
        </span>
      </button>
    </nav>
  );
}

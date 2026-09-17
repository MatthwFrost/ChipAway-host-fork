/* The one place that decides what a player is called on screen.

   Two widgets show the player's identity -- the nav rail and the table's
   player bar -- and they must agree. Deriving the label in each of them is how
   you end up with an avatar reading "S" next to a name reading "Matty Frost".

   The fallback chain is ordered by what arrives first: the email is on the
   user object from the very first render, while display_name needs a round
   trip to the profiles table, so the email is what fills the gap rather than a
   blank or a spinner. */

export function profileLabel(user, displayName) {
  if (!user) return 'Guest';
  const named = (displayName || '').trim();
  return named || user.email || 'Guest';
}

// Avatars show one character. Guests get 'G', and so does anything that trims
// away to nothing -- an empty avatar looks broken, a letter never does.
export function avatarInitial(label) {
  const first = (label || '').trim().charAt(0);
  return first ? first.toUpperCase() : 'G';
}

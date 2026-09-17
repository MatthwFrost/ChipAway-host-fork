/* ============================================================
   SCREEN INTENT — which screen the next page load opens on
   ============================================================
   Starting a new game and ending one both go through a reload, because the
   engine can only reach a clean state on a fresh page. That reload has to land
   somewhere specific: on the table for a new game, on the dashboard for an
   ended one.

   sessionStorage rather than the URL, so the intent survives the reload but not
   a fresh visit — opening the app in a new tab should always land on Home.
   ============================================================ */

export const SCREEN_KEY = 'chipaway.screen';

export function openOnReload(screen) {
  try {
    sessionStorage.setItem(SCREEN_KEY, screen);
  } catch (e) { /* private mode, disabled storage */ }
}

// Reading consumes it: an intent is for one reload, not for every render after.
export function takeScreenIntent() {
  try {
    const v = sessionStorage.getItem(SCREEN_KEY);
    sessionStorage.removeItem(SCREEN_KEY);
    return v === 'table' || v === 'home' ? v : null;
  } catch (e) {
    return null;
  }
}

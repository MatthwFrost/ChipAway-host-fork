/* ============================================================
   SUPABASE CLIENT

   ChipAway is a static site on GitHub Pages: there is no server to keep a
   secret on, so the browser talks to Postgres directly. The anon key below is
   public by design and ships in the bundle. What stops one player reading
   another's hands is not this key -- it is the Row Level Security policies in
   supabase/migrations/0001_accounts.sql. The schema IS the security.

   Exports null rather than a half-built client when the env is missing. The
   app has to run with no backend at all (guest mode, and every test run), and
   a client pointed at nowhere would throw on first use instead of letting
   callers check isConfigured and take the local path.
   ============================================================ */

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const SUPABASE_URL = url;
export const isConfigured = Boolean(url && anonKey);

export const supabase = isConfigured
  ? createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The app is served from a single page with no auth callback route, so
      // there is never a token in the URL to detect.
      detectSessionInUrl: false,
    },
  })
  : null;

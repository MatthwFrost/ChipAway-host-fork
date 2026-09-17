# Accounts setup

ChipAway signs players in with Supabase. The client is configured by two
environment variables, both of which are public and ship in the browser
bundle — Row Level Security, not secrecy, is what protects the data.

## Local development

    cp .env.example .env.local

Fill in `VITE_SUPABASE_ANON_KEY` from the Supabase dashboard:
**Project Settings → API keys → anon / publishable**.

Project: **ChipAway**, ref `dqrxbdbrogxsapnxsyzt`, region `eu-central-1`.
API URL: `https://dqrxbdbrogxsapnxsyzt.supabase.co`

Without these the app still runs — it falls through to guest mode and stores
everything in localStorage, exactly as it did before accounts existed.

## Deployment

GitHub Pages builds via `.github/workflows/deploy-pages.yml`. Add both values
as repository secrets under **Settings → Secrets and variables → Actions**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Email confirmation

By default Supabase emails a confirmation link on sign-up, and the app says so
rather than pretending the account is ready. To skip it while testing, turn off
**Authentication → Sign In / Providers → Email → Confirm email** in the
dashboard.

## Never commit

The service-role key. It bypasses every RLS policy. It has no business in a
client bundle and nothing in this app needs it.

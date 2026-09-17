# ChipAway Accounts (Supabase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a ChipAway player sign in with email and password, and have their games and recorded hands persist to Supabase and follow them to another browser.

**Architecture:** ChipAway is a static site with no backend, so the browser talks to Postgres directly through `supabase-js` and Row Level Security is the entire authorization boundary. localStorage stays the write path during play — the engine is never made async — and a separate sync layer pushes finished records up and pulls them down at sign-in. A sign-in screen gates the app, with a guest bypass that keeps the current local-only experience working.

**Tech Stack:** React 19, Vite 8, Vitest 4, `@supabase/supabase-js` v2, Supabase Postgres (project `dqrxbdbrogxsapnxsyzt`, eu-central-1).

## Global Constraints

- **Supabase project is `dqrxbdbrogxsapnxsyzt`** (name: ChipAway, region: eu-central-1). Never create a new project. A second Supabase MCP server exists locally pinned to `olwbscbwksaelkwxcjqi` — that is a different project and must not be touched. **Before any schema work, run `list_projects` and confirm which project the tools resolve to.**
- **API URL:** `https://dqrxbdbrogxsapnxsyzt.supabase.co`
- Auth is **email + password only**. Do not add OAuth providers.
- The anon/publishable key ships in the client bundle and is public by design. **Never** put a service-role key in client code, `.env`, or the repo.
- Every table carries `user_id uuid` and RLS policies keyed on `auth.uid() = user_id`. A table without RLS enabled is a defect, not a TODO.
- The app must still run with **no** Supabase env vars set — guest mode is the fallback, not a crash.
- The engine (`src/engine/initializePokerTrainer.js`) stays synchronous. No `await` is added to the hand loop.
- Node 22. Run `npm run lint` and `npx vitest run` before every commit; both must be clean.
- Deployment is GitHub Pages via `.github/workflows/deploy-pages.yml`, which runs `npm run lint && npm test && npm run build`.

## Prior Work (already on disk — do not rebuild)

Sub-project 1 shipped hand recording and replay. These modules exist and are tested:

| Module | Exports you will use |
|---|---|
| `src/engine/games.js` | `GAMES_KEY`, `listGames()`, `getLiveGame()`, `createGame(setup)`, `endGame(id)`, `updateLiveGame(patch)`, `loadStore()`, `saveStore(store)`, `clearAllGames()`, `lifetimeStats(games)` |
| `src/engine/handStore.js` | `HANDS_KEY`, `MAX_HANDS`, `loadHands()`, `saveHand(hand)`, `getHand(id)`, `clearHands()`, `summarize(hand)`, `listSummaries(gameId)` |
| `src/engine/handRecorder.js` | `HAND_SCHEMA_VERSION` (currently `1`), `createHandRecorder()` |
| `src/engine/handReplay.js` | `snapshotAt(hand, n)`, `stepCount(hand)`, `describeStep(hand, n)`, `visibleSteps(hand)`, `parseCard(s)` |

A recorded hand has this shape. The `hands` table stores it whole in a `jsonb` column:

```js
{
  v: 1, id: 'h<base36>-<handNo>-<n>', gameId: 'g_1758...' | null,
  handNo: 42, startedAt: 1758067200000, endedAt: 1758067260000,
  config: { sb, bb, startStack, dealerIdx, heroIndex,
            seats: [{ id, name, profile, stack, isHero }] },
  holeCards: { 0: ['As','Kd'], ... },
  events: [ /* deal | blind | action | street | ranges | collect | showdown | award */ ],
  decisions: [ { street, streetName, taken, evTaken, cost, equity, pot, toCall, nOpp, bestLabel, bestEv } ],
  result: { net, potFinal, showdown, heroFolded, winners: [seatId] }
}
```

A game record (`games.js`) has this shape:

```js
{ id: 'g_1758...', createdAt: 1758067200000, endedAt: null, status: 'live'|'ended',
  setup: { pace, showdownGuess, rangeGuess, seats }, net: 0, migrated: false,
  state: { stats: {...}, handLog: [], evRecords: [], matchResults: [], handNo: 0 } }
```

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/supabaseClient.js` | **Create.** Builds the client from env; exports `null` when unconfigured. |
| `supabase/migrations/0001_accounts.sql` | **Create.** Schema, indexes, RLS policies, signup trigger. |
| `src/engine/auth.js` | **Create.** Sign up / in / out, current user, auth change subscription, guest flag. |
| `src/engine/sync.js` | **Create.** Push local games+hands up, pull remote down, merge. |
| `src/components/SignInScreen.jsx` | **Create.** Email/password form plus the guest bypass button. |
| `src/engine/games.js` | **Modify.** Add `mergeGames(list)`. |
| `src/engine/handStore.js` | **Modify.** Add `mergeHands(list)`. |
| `src/App.jsx` | **Modify.** Gate on auth state; sync after sign-in. |
| `src/components/AppRail.jsx` | **Modify.** Wire the existing `rail-profile` button to real identity + sign out. |
| `.env.example`, `.gitignore`, `.github/workflows/deploy-pages.yml` | **Modify/create.** Env plumbing for local dev and CI. |

---

### Task 1: Supabase client from environment

**Files:**
- Create: `src/engine/supabaseClient.js`
- Create: `src/engine/supabaseClient.test.js`
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `package.json` (dependency)

**Interfaces:**
- Consumes: nothing.
- Produces: `supabase` (a `SupabaseClient` or `null`), `isConfigured: boolean`, `SUPABASE_URL: string|undefined`.

- [ ] **Step 1: Install the client library**

```bash
npm install @supabase/supabase-js@^2
```

- [ ] **Step 2: Create `.env.example` and ignore real env files**

Create `.env.example`:

```
# Copy to .env.local and fill in. Both are PUBLIC values that ship in the
# browser bundle -- the anon key is meant to be public, and Row Level Security
# is what actually protects the data. Never put a service-role key here.
VITE_SUPABASE_URL=https://dqrxbdbrogxsapnxsyzt.supabase.co
VITE_SUPABASE_ANON_KEY=
```

Append to `.gitignore`:

```
.env
.env.local
```

- [ ] **Step 3: Write the failing test**

Create `src/engine/supabaseClient.test.js`:

```js
import { afterEach, describe, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  return import('./supabaseClient.js');
}

describe('supabase client', () => {
  test('is unconfigured when env vars are absent', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const mod = await load();
    expect(mod.isConfigured).toBe(false);
    // Null rather than a broken client: the app must still deal cards with no
    // backend configured, and a half-built client would throw on first use.
    expect(mod.supabase).toBeNull();
  });

  test('builds a client when both env vars are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-value');
    const mod = await load();
    expect(mod.isConfigured).toBe(true);
    expect(mod.supabase).not.toBeNull();
    expect(typeof mod.supabase.auth.signInWithPassword).toBe('function');
  });

  test('is unconfigured if only one env var is set', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const mod = await load();
    expect(mod.isConfigured).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test and watch it fail**

Run: `npx vitest run src/engine/supabaseClient.test.js`
Expected: FAIL — `Failed to resolve import "./supabaseClient.js"`.

- [ ] **Step 5: Write the implementation**

Create `src/engine/supabaseClient.js`:

```js
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
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `npx vitest run src/engine/supabaseClient.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 7: Verify nothing else broke**

Run: `npm run lint && npx vitest run`
Expected: lint silent; all tests pass (384 existing + 3 new = 387).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example \
        src/engine/supabaseClient.js src/engine/supabaseClient.test.js
git commit -m "feat: add Supabase client built from public env vars"
```

---

### Task 2: Database schema and RLS policies

**Files:**
- Create: `supabase/migrations/0001_accounts.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `public.profiles`, `public.games`, `public.hands`. Column names are used verbatim by Task 5.

- [ ] **Step 1: Confirm you are pointed at the right project**

Call the Supabase MCP tool `list_projects`. Confirm a project with ref `dqrxbdbrogxsapnxsyzt` named ChipAway in `eu-central-1` is present, and that it is the one subsequent calls target.

Expected: the ref appears in the output. **If the tools resolve to `olwbscbwksaelkwxcjqi`, STOP** — that is a different project. Ask the user before going further.

- [ ] **Step 2: Inspect what already exists**

Call `list_tables` for schema `public` on project `dqrxbdbrogxsapnxsyzt`.

Expected: empty, or no tables named `profiles`, `games`, `hands`. If any exist, stop and ask — this plan assumes a clean schema.

- [ ] **Step 3: Write the migration file**

Create `supabase/migrations/0001_accounts.sql`:

```sql
-- ChipAway accounts: profiles, games, hands.
--
-- Client-generated ids ('g_1758...', 'h...') are only unique within one
-- player, so every primary key is (user_id, id). That also means a row can
-- never be addressed without its owner, which makes the RLS policies below a
-- second lock rather than the only one.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now()
);

create table if not exists public.games (
  id         text        not null,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null,
  ended_at   timestamptz,
  status     text        not null check (status in ('live', 'ended')),
  setup      jsonb       not null default '{}'::jsonb,
  net        integer     not null default 0,
  migrated   boolean     not null default false,
  -- The engine's per-game counters (stats, handLog, evRecords, matchResults,
  -- handNo), stored whole. They are read and written as one blob by the app
  -- and never queried field by field.
  state      jsonb       not null default '{}'::jsonb,
  synced_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.hands (
  id             text        not null,
  user_id        uuid        not null references auth.users (id) on delete cascade,
  -- Deliberately NOT a foreign key to games. A hand outlives the game record
  -- it points at: clearing game history must not delete the hands, and a hand
  -- dealt before any game was created carries null.
  game_id        text,
  hand_no        integer     not null,
  started_at     timestamptz not null,
  ended_at       timestamptz,
  schema_version integer     not null,
  -- Denormalised out of `record` so the history list can be built with one
  -- query instead of parsing every event log it returns.
  net            integer     not null default 0,
  showdown       boolean     not null default false,
  hero_folded    boolean     not null default false,
  ev_cost        numeric     not null default 0,
  record         jsonb       not null,
  synced_at      timestamptz not null default now(),
  primary key (user_id, id)
);

-- Newest-first history, per player. Matches listSummaries()' ordering.
create index if not exists hands_user_started_idx
  on public.hands (user_id, started_at desc);
create index if not exists hands_user_game_idx
  on public.hands (user_id, game_id);
create index if not exists games_user_created_idx
  on public.games (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.games    enable row level security;
alter table public.hands    enable row level security;

-- One policy per operation rather than a single `for all`: it makes the
-- insert case explicit, which is the one that needs a with-check clause to
-- stop a client writing a row owned by somebody else.
create policy "profiles are self-service" on public.profiles
  for select using ((select auth.uid()) = id);
create policy "profiles insert self" on public.profiles
  for insert with check ((select auth.uid()) = id);
create policy "profiles update self" on public.profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "games select own" on public.games
  for select using ((select auth.uid()) = user_id);
create policy "games insert own" on public.games
  for insert with check ((select auth.uid()) = user_id);
create policy "games update own" on public.games
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "games delete own" on public.games
  for delete using ((select auth.uid()) = user_id);

create policy "hands select own" on public.hands
  for select using ((select auth.uid()) = user_id);
create policy "hands insert own" on public.hands
  for insert with check ((select auth.uid()) = user_id);
create policy "hands update own" on public.hands
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "hands delete own" on public.hands
  for delete using ((select auth.uid()) = user_id);

-- A profile row for every new signup. security definer because the trigger
-- runs before the new user has a session of their own to insert with; the
-- empty search_path stops a mutable-search-path privilege escalation.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 4: Apply the migration**

Call the Supabase MCP tool `apply_migration` against project `dqrxbdbrogxsapnxsyzt` with name `accounts` and the full SQL above.

Expected: success, no error.

- [ ] **Step 5: Verify the tables and RLS landed**

Call `list_tables` for schema `public`.
Expected: `profiles`, `games`, `hands` present, each reporting RLS enabled.

Then call `execute_sql` with:

```sql
select tablename, count(*) as policies
from pg_policies
where schemaname = 'public'
group by tablename
order by tablename;
```

Expected: `games` = 4, `hands` = 4, `profiles` = 3.

- [ ] **Step 6: Check the security advisors**

Call `get_advisors` with type `security` for the project.

Expected: no ERROR-level findings against `public.profiles`, `public.games` or `public.hands`. If any appear, fix them in the migration and re-apply before continuing.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0001_accounts.sql
git commit -m "feat: add accounts schema with row level security"
```

---

### Task 3: Auth module

**Files:**
- Create: `src/engine/auth.js`
- Create: `src/engine/auth.test.js`

**Interfaces:**
- Consumes: `supabase`, `isConfigured` from `src/engine/supabaseClient.js`.
- Produces:
  - `signUp(email, password) -> Promise<{ user: object|null, error: string|null, needsConfirmation: boolean }>`
  - `signIn(email, password) -> Promise<{ user: object|null, error: string|null }>`
  - `signOut() -> Promise<{ error: string|null }>`
  - `getUser() -> Promise<object|null>`
  - `onAuthChange(cb) -> () => void` (returns an unsubscribe function; `cb` receives `user|null`)
  - `isGuest() -> boolean`, `continueAsGuest() -> void`, `endGuest() -> void`
  - `GUEST_KEY: string`

- [ ] **Step 1: Write the failing test**

Create `src/engine/auth.test.js`:

```js
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The client is mocked wholesale: these tests are about the wrapper's contract
// -- friendly errors, guest flag, unsubscribe -- not about supabase-js.
const mockAuth = {
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
};

vi.mock('./supabaseClient.js', () => ({
  supabase: { auth: mockAuth },
  isConfigured: true,
  SUPABASE_URL: 'https://example.supabase.co',
}));

let auth;
beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  auth = await import('./auth.js');
});
afterEach(() => { vi.resetModules(); });

describe('sign in', () => {
  test('returns the user on success', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } }, error: null });
    const res = await auth.signIn('a@b.com', 'pw');
    expect(res.user.id).toBe('u1');
    expect(res.error).toBeNull();
  });

  test('turns a bad-credentials error into something a person can read', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });
    const res = await auth.signIn('a@b.com', 'wrong');
    expect(res.user).toBeNull();
    expect(res.error).toBe('That email and password do not match.');
  });

  test('refuses an empty email or password without calling the network', async () => {
    const res = await auth.signIn('', '');
    expect(res.error).toBe('Enter your email and password.');
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe('sign up', () => {
  test('flags when a confirmation email is required', async () => {
    // Supabase returns a user with no session when confirmations are on.
    mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'u2' }, session: null }, error: null });
    const res = await auth.signUp('a@b.com', 'password123');
    expect(res.needsConfirmation).toBe(true);
    expect(res.error).toBeNull();
  });

  test('does not flag confirmation when a session comes back', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'u2' }, session: { access_token: 't' } }, error: null });
    const res = await auth.signUp('a@b.com', 'password123');
    expect(res.needsConfirmation).toBe(false);
  });

  test('rejects a short password before calling the network', async () => {
    const res = await auth.signUp('a@b.com', 'short');
    expect(res.error).toBe('Use a password of at least 8 characters.');
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });
});

describe('guest mode', () => {
  test('is off by default, on after continueAsGuest, off after endGuest', () => {
    expect(auth.isGuest()).toBe(false);
    auth.continueAsGuest();
    expect(auth.isGuest()).toBe(true);
    auth.endGuest();
    expect(auth.isGuest()).toBe(false);
  });
});

describe('onAuthChange', () => {
  test('passes the user through and returns a working unsubscribe', () => {
    const unsubscribe = vi.fn();
    let handler = null;
    mockAuth.onAuthStateChange.mockImplementation((cb) => {
      handler = cb;
      return { data: { subscription: { unsubscribe } } };
    });
    const seen = [];
    const off = auth.onAuthChange((u) => seen.push(u));

    handler('SIGNED_IN', { user: { id: 'u1' } });
    handler('SIGNED_OUT', null);
    expect(seen).toEqual([{ id: 'u1' }, null]);

    off();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe('sign out', () => {
  test('clears the guest flag too, so the gate is not bypassed afterwards', async () => {
    mockAuth.signOut.mockResolvedValue({ error: null });
    auth.continueAsGuest();
    await auth.signOut();
    expect(auth.isGuest()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/engine/auth.test.js`
Expected: FAIL — `Failed to resolve import "./auth.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/engine/auth.js`:

```js
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
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/engine/auth.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/auth.js src/engine/auth.test.js
git commit -m "feat: add auth wrapper with guest mode and readable errors"
```

---

### Task 4: Merge helpers on the local stores

**Files:**
- Modify: `src/engine/handStore.js`
- Modify: `src/engine/games.js`
- Create: `src/engine/merge.test.js`

**Interfaces:**
- Consumes: existing exports of both stores.
- Produces: `mergeHands(list) -> number` (count added), `mergeGames(list) -> number` (count added or updated). Both are used by Task 5.

- [ ] **Step 1: Write the failing test**

Create `src/engine/merge.test.js`:

```js
import { beforeEach, describe, expect, test } from 'vitest';
import { clearHands, loadHands, mergeHands, saveHand } from './handStore.js';
import { clearAllGames, listGames, loadStore, mergeGames, saveStore } from './games.js';
import { HAND_SCHEMA_VERSION } from './handRecorder.js';

function hand(n, over) {
  return Object.assign({
    v: HAND_SCHEMA_VERSION, id: 'hand-' + n, gameId: 'g_1', handNo: n,
    startedAt: 1700000000000 + n,
    config: { sb: 10, bb: 20, startStack: 1000, dealerIdx: 0, heroIndex: 0, seats: [] },
    holeCards: {}, events: [], decisions: [],
    result: { net: 0, potFinal: 0, showdown: false, heroFolded: false, winners: [] },
  }, over || {});
}

function game(id, over) {
  return Object.assign({
    id: id, createdAt: 1700000000000, endedAt: null, status: 'ended',
    setup: {}, net: 0, state: {},
  }, over || {});
}

describe('mergeHands', () => {
  beforeEach(() => { clearHands(); });

  test('adds hands that are not held locally', () => {
    saveHand(hand(1));
    expect(mergeHands([hand(2), hand(3)])).toBe(2);
    expect(loadHands().map((h) => h.handNo)).toEqual([1, 2, 3]);
  });

  test('never duplicates a hand already held', () => {
    saveHand(hand(1));
    expect(mergeHands([hand(1)])).toBe(0);
    expect(loadHands()).toHaveLength(1);
  });

  test('keeps the local copy of a hand that exists on both sides', () => {
    // Hands are immutable once recorded, so a disagreement means one side is
    // corrupt. Preferring the local copy keeps replay working offline.
    saveHand(hand(1, { handNo: 1, result: { net: 500 } }));
    mergeHands([hand(1, { handNo: 1, result: { net: -999 } })]);
    expect(loadHands()[0].result.net).toBe(500);
  });

  test('orders the merged result oldest first', () => {
    mergeHands([hand(3), hand(1), hand(2)]);
    expect(loadHands().map((h) => h.handNo)).toEqual([1, 2, 3]);
  });
});

describe('mergeGames', () => {
  beforeEach(() => { clearAllGames(); });

  test('adds games that are not held locally', () => {
    expect(mergeGames([game('g_1'), game('g_2')])).toBe(2);
    expect(listGames().map((g) => g.id).sort()).toEqual(['g_1', 'g_2']);
  });

  test('leaves the live game alone', () => {
    // The live game is being played right now; a remote copy is by definition
    // staler than what is in front of the player.
    saveStore({ version: 1, liveId: 'g_1', games: [game('g_1', { status: 'live', net: 250 })] });
    mergeGames([game('g_1', { status: 'ended', net: 0 })]);
    const local = listGames().find((g) => g.id === 'g_1');
    expect(local.status).toBe('live');
    expect(local.net).toBe(250);
  });

  test('takes the remote copy of an ended game', () => {
    saveStore({ version: 1, liveId: null, games: [game('g_1', { net: 10 })] });
    mergeGames([game('g_1', { net: 99 })]);
    expect(listGames().find((g) => g.id === 'g_1').net).toBe(99);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/engine/merge.test.js`
Expected: FAIL — `mergeHands is not a function`.

- [ ] **Step 3: Add `mergeHands` to `src/engine/handStore.js`**

Append to the file:

```js
/* Fold a batch of hands in from somewhere else (the cloud) without disturbing
   what is already here. Local wins on a collision: a recorded hand is
   immutable, so a difference means one copy is wrong, and the local one is the
   one this browser can definitely replay. Returns how many were added. */
export function mergeHands(list) {
  if (!Array.isArray(list) || !list.length) return 0;
  const hands = readRaw();
  const seen = {};
  hands.forEach(function (h) { seen[h.id] = true; });

  let added = 0;
  list.forEach(function (h) {
    if (!h || !h.id || seen[h.id]) return;
    if (h.v !== HAND_SCHEMA_VERSION) return;
    hands.push(h);
    seen[h.id] = true;
    added += 1;
  });
  if (!added) return 0;

  hands.sort(function (a, b) { return (a.startedAt || 0) - (b.startedAt || 0); });
  while (hands.length > MAX_HANDS) hands.shift();
  writeRaw(hands);
  return added;
}
```

- [ ] **Step 4: Add `mergeGames` to `src/engine/games.js`**

Append to the file:

```js
/* Fold a batch of games in from the cloud. The LIVE game is never overwritten
   -- it is the sitting in front of the player right now, so any remote copy of
   it is by definition staler. Ended games take the remote version, which is
   what makes a game finished on another machine show up here. Returns how many
   rows were added or updated. */
export function mergeGames(list) {
  if (!Array.isArray(list) || !list.length) return 0;
  const store = loadStore();
  const byId = {};
  store.games.forEach(function (g) { byId[g.id] = g; });

  let touched = 0;
  list.forEach((remote) => {
    if (!remote || !remote.id) return;
    if (remote.id === store.liveId) return;
    const local = byId[remote.id];
    if (!local) {
      store.games.push(remote);
      byId[remote.id] = remote;
      touched += 1;
      return;
    }
    Object.assign(local, remote);
    touched += 1;
  });
  if (touched) saveStore(store);
  return touched;
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run src/engine/merge.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 6: Verify nothing else broke**

Run: `npm run lint && npx vitest run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/engine/handStore.js src/engine/games.js src/engine/merge.test.js
git commit -m "feat: add merge helpers for folding remote records into local stores"
```

---

### Task 5: Sync layer

**Files:**
- Create: `src/engine/sync.js`
- Create: `src/engine/sync.test.js`

**Interfaces:**
- Consumes: `supabase`, `isConfigured`; `listGames`, `mergeGames` from `games.js`; `loadHands`, `mergeHands`, `summarize` from `handStore.js`; `getUser` from `auth.js`.
- Produces:
  - `toGameRow(game, userId) -> object`
  - `toHandRow(hand, userId) -> object`
  - `fromGameRow(row) -> object`
  - `fromHandRow(row) -> object`
  - `push() -> Promise<{ games: number, hands: number, error: string|null }>`
  - `pull() -> Promise<{ games: number, hands: number, error: string|null }>`
  - `syncNow() -> Promise<{ pushed: object, pulled: object, error: string|null }>`

- [ ] **Step 1: Write the failing test**

Create `src/engine/sync.test.js`:

```js
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { HAND_SCHEMA_VERSION } from './handRecorder.js';

const upsert = vi.fn();
const select = vi.fn();
const from = vi.fn(() => ({ upsert, select }));

vi.mock('./supabaseClient.js', () => ({
  supabase: { from: (...a) => from(...a) },
  isConfigured: true,
  SUPABASE_URL: 'https://example.supabase.co',
}));
vi.mock('./auth.js', () => ({ getUser: vi.fn(async () => ({ id: 'user-1' })) }));

let sync;
beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  upsert.mockResolvedValue({ error: null });
  select.mockResolvedValue({ data: [], error: null });
  sync = await import('./sync.js');
});

const HAND = {
  v: HAND_SCHEMA_VERSION, id: 'hand-1', gameId: 'g_1', handNo: 7,
  startedAt: 1700000000000, endedAt: 1700000060000,
  config: { sb: 10, bb: 20, startStack: 1000, dealerIdx: 0, heroIndex: 0, seats: [{ id: 0, isHero: true, stack: 1000 }] },
  holeCards: { 0: ['As', 'Kd'] }, events: [], decisions: [{ cost: 12 }],
  result: { net: -40, potFinal: 120, showdown: true, heroFolded: false, winners: [1] },
};

const GAME = {
  id: 'g_1', createdAt: 1700000000000, endedAt: null, status: 'live',
  setup: { pace: '1.15' }, net: 30, state: { handNo: 7 },
};

describe('row mapping', () => {
  test('a hand row carries the summary columns and the whole record', () => {
    const row = sync.toHandRow(HAND, 'user-1');
    expect(row.id).toBe('hand-1');
    expect(row.user_id).toBe('user-1');
    expect(row.game_id).toBe('g_1');
    expect(row.hand_no).toBe(7);
    expect(row.schema_version).toBe(HAND_SCHEMA_VERSION);
    expect(row.net).toBe(-40);
    expect(row.showdown).toBe(true);
    expect(row.ev_cost).toBe(12);
    // Timestamps go up as ISO strings; Postgres timestamptz will not take a
    // JavaScript epoch integer.
    expect(row.started_at).toBe(new Date(1700000000000).toISOString());
    expect(row.record).toEqual(HAND);
  });

  test('a hand row survives a null gameId', () => {
    expect(sync.toHandRow({ ...HAND, gameId: null }, 'u').game_id).toBeNull();
  });

  test('a game row maps status and jsonb blobs', () => {
    const row = sync.toGameRow(GAME, 'user-1');
    expect(row.id).toBe('g_1');
    expect(row.user_id).toBe('user-1');
    expect(row.status).toBe('live');
    expect(row.net).toBe(30);
    expect(row.setup).toEqual({ pace: '1.15' });
    expect(row.state).toEqual({ handNo: 7 });
    expect(row.ended_at).toBeNull();
  });

  test('round-trips a hand back out of a row unchanged', () => {
    expect(sync.fromHandRow(sync.toHandRow(HAND, 'user-1'))).toEqual(HAND);
  });

  test('round-trips a game back out of a row unchanged', () => {
    const back = sync.fromGameRow(sync.toGameRow(GAME, 'user-1'));
    expect(back.id).toBe(GAME.id);
    expect(back.createdAt).toBe(GAME.createdAt);
    expect(back.endedAt).toBeNull();
    expect(back.status).toBe('live');
    expect(back.net).toBe(30);
    expect(back.setup).toEqual(GAME.setup);
    expect(back.state).toEqual(GAME.state);
  });
});

describe('push', () => {
  test('sends nothing and reports zero when there is nothing local', async () => {
    const res = await sync.push();
    expect(res).toEqual({ games: 0, hands: 0, error: null });
    expect(upsert).not.toHaveBeenCalled();
  });

  test('upserts local games and hands', async () => {
    localStorage.setItem('chipaway.games.v1', JSON.stringify({ version: 1, liveId: 'g_1', games: [GAME] }));
    localStorage.setItem('chipaway.hands.v1', JSON.stringify([HAND]));
    const res = await sync.push();
    expect(res.error).toBeNull();
    expect(res.games).toBe(1);
    expect(res.hands).toBe(1);
    expect(from).toHaveBeenCalledWith('games');
    expect(from).toHaveBeenCalledWith('hands');
  });

  test('reports the error rather than throwing when a write is rejected', async () => {
    localStorage.setItem('chipaway.hands.v1', JSON.stringify([HAND]));
    upsert.mockResolvedValue({ error: { message: 'permission denied' } });
    const res = await sync.push();
    expect(res.error).toBe('permission denied');
  });
});

describe('pull', () => {
  test('merges remote rows into the local stores', async () => {
    select.mockImplementation(() => Promise.resolve({
      data: [sync.toHandRow(HAND, 'user-1')], error: null,
    }));
    const res = await sync.pull();
    expect(res.error).toBeNull();
    expect(res.hands).toBeGreaterThanOrEqual(1);
  });

  test('reports a read error rather than throwing', async () => {
    select.mockResolvedValue({ data: null, error: { message: 'jwt expired' } });
    const res = await sync.pull();
    expect(res.error).toBe('jwt expired');
  });
});

describe('syncNow', () => {
  test('refuses politely when nobody is signed in', async () => {
    const auth = await import('./auth.js');
    auth.getUser.mockResolvedValue(null);
    const res = await sync.syncNow();
    expect(res.error).toBe('Not signed in.');
    expect(upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/engine/sync.test.js`
Expected: FAIL — `Failed to resolve import "./sync.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/engine/sync.js`:

```js
/* ============================================================
   SYNC — carrying games and hands between this browser and Postgres.

   Offline-first, deliberately. localStorage stays the write path while a hand
   is being played: the engine is synchronous, a hand can finish while the
   network is down, and a save that can fail is not something the end of a hand
   can cope with. Sync is a separate pass that runs at sign-in and after a hand
   is filed.

   Conflict policy, in one line each:
     hands  -- immutable once recorded, so first writer wins and duplicates are
               ignored on both sides.
     games  -- the LIVE game is authoritative locally (it is being played right
               now); ended games take whichever copy the cloud holds.
   ============================================================ */

import { isConfigured, supabase } from './supabaseClient.js';
import { getUser } from './auth.js';
import { listGames, mergeGames } from './games.js';
import { loadHands, mergeHands } from './handStore.js';

const iso = function (ms) { return ms ? new Date(ms).toISOString() : null; };
const ms = function (s) { return s ? new Date(s).getTime() : null; };

const evCostOf = function (hand) {
  return (hand.decisions || []).reduce(function (a, d) { return a + Math.max(0, d.cost || 0); }, 0);
};

/* ---- row mapping ---- */

export function toHandRow(hand, userId) {
  const result = hand.result || {};
  return {
    id: hand.id,
    user_id: userId,
    game_id: hand.gameId || null,
    hand_no: hand.handNo || 0,
    started_at: iso(hand.startedAt),
    ended_at: iso(hand.endedAt),
    schema_version: hand.v,
    net: result.net || 0,
    showdown: !!result.showdown,
    hero_folded: !!result.heroFolded,
    ev_cost: evCostOf(hand),
    record: hand,
  };
}

// The whole hand lives in `record`; the columns are a denormalised index for
// listing. So reading one back is just handing `record` over.
export function fromHandRow(row) { return row.record; }

export function toGameRow(game, userId) {
  return {
    id: game.id,
    user_id: userId,
    created_at: iso(game.createdAt),
    ended_at: iso(game.endedAt),
    status: game.status === 'live' ? 'live' : 'ended',
    setup: game.setup || {},
    net: game.net || 0,
    migrated: !!game.migrated,
    state: game.state || {},
  };
}

export function fromGameRow(row) {
  return {
    id: row.id,
    createdAt: ms(row.created_at),
    endedAt: ms(row.ended_at),
    status: row.status,
    setup: row.setup || {},
    net: row.net || 0,
    migrated: !!row.migrated,
    state: row.state || {},
  };
}

/* ---- transfer ---- */

async function requireUser() {
  if (!isConfigured) return { user: null, error: 'Accounts are not set up in this build.' };
  const user = await getUser();
  if (!user) return { user: null, error: 'Not signed in.' };
  return { user: user, error: null };
}

export async function push() {
  const { user, error } = await requireUser();
  if (error) return { games: 0, hands: 0, error: error };

  const games = listGames();
  const hands = loadHands();
  let pushedGames = 0, pushedHands = 0;

  if (games.length) {
    const rows = games.map(function (g) { return toGameRow(g, user.id); });
    const res = await supabase.from('games').upsert(rows, { onConflict: 'user_id,id' });
    if (res.error) return { games: 0, hands: 0, error: res.error.message };
    pushedGames = rows.length;
  }

  if (hands.length) {
    const rows = hands.map(function (h) { return toHandRow(h, user.id); });
    // ignoreDuplicates: a recorded hand never changes, so re-sending one is a
    // no-op rather than an overwrite.
    const res = await supabase.from('hands')
      .upsert(rows, { onConflict: 'user_id,id', ignoreDuplicates: true });
    if (res.error) return { games: pushedGames, hands: 0, error: res.error.message };
    pushedHands = rows.length;
  }

  return { games: pushedGames, hands: pushedHands, error: null };
}

export async function pull() {
  const { error } = await requireUser();
  if (error) return { games: 0, hands: 0, error: error };

  const gameRes = await supabase.from('games').select('*');
  if (gameRes.error) return { games: 0, hands: 0, error: gameRes.error.message };
  const mergedGames = mergeGames((gameRes.data || []).map(fromGameRow));

  const handRes = await supabase.from('hands').select('*');
  if (handRes.error) return { games: mergedGames, hands: 0, error: handRes.error.message };
  const mergedHands = mergeHands((handRes.data || []).map(fromHandRow).filter(Boolean));

  return { games: mergedGames, hands: mergedHands, error: null };
}

/* Pull before push, so anything this browser has never seen is folded in
   before its own state is sent back up as the record of what exists. */
export async function syncNow() {
  const { error } = await requireUser();
  if (error) return { pushed: null, pulled: null, error: error };
  const pulled = await pull();
  if (pulled.error) return { pushed: null, pulled: pulled, error: pulled.error };
  const pushed = await push();
  return { pushed: pushed, pulled: pulled, error: pushed.error };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/engine/sync.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/sync.js src/engine/sync.test.js
git commit -m "feat: add offline-first sync for games and hands"
```

---

### Task 6: Sign-in screen with guest bypass

**Files:**
- Create: `src/components/SignInScreen.jsx`
- Create: `src/components/SignInScreen.test.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `signIn`, `signUp`, `continueAsGuest` from `src/engine/auth.js`.
- Produces: `<SignInScreen onSignedIn={(user) => void} onGuest={() => void} />`.

> **Workspace warning:** `src/styles.css` is frequently open in the user's editor and edits to it have been silently reverted before. After writing CSS, verify it landed with `grep -c "signin-" src/styles.css` before claiming the task is done.

- [ ] **Step 1: Write the failing test**

Create `src/components/SignInScreen.test.jsx`:

```jsx
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SignInScreen } from './SignInScreen';

vi.mock('../engine/auth.js', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  continueAsGuest: vi.fn(),
}));
const auth = await import('../engine/auth.js');

beforeEach(() => { vi.clearAllMocks(); });

function fill(email, password) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('SignInScreen', () => {
  test('signs in and reports the user upward', async () => {
    auth.signIn.mockResolvedValue({ user: { id: 'u1' }, error: null });
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} onGuest={() => {}} />);
    fill('a@b.com', 'password123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ id: 'u1' }));
  });

  test('shows the error and stays put when sign-in fails', async () => {
    auth.signIn.mockResolvedValue({ user: null, error: 'That email and password do not match.' });
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} onGuest={() => {}} />);
    fill('a@b.com', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('That email and password do not match.');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  test('switches to create-account mode and calls signUp', async () => {
    auth.signUp.mockResolvedValue({ user: { id: 'u2' }, error: null, needsConfirmation: false });
    render(<SignInScreen onSignedIn={() => {}} onGuest={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Create one/ }));
    fill('new@b.com', 'password123');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledWith('new@b.com', 'password123'));
  });

  test('tells the player to confirm their email when required', async () => {
    auth.signUp.mockResolvedValue({ user: { id: 'u2' }, error: null, needsConfirmation: true });
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} onGuest={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Create one/ }));
    fill('new@b.com', 'password123');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText(/Check your email/);
    // Not signed in yet -- there is no session until the link is clicked.
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  test('the bypass marks guest mode and reports upward', () => {
    const onGuest = vi.fn();
    render(<SignInScreen onSignedIn={() => {}} onGuest={onGuest} />);
    fireEvent.click(screen.getByRole('button', { name: /Skip for now/ }));
    expect(auth.continueAsGuest).toHaveBeenCalled();
    expect(onGuest).toHaveBeenCalled();
  });

  test('disables the submit button while the request is in flight', async () => {
    let resolve;
    auth.signIn.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<SignInScreen onSignedIn={() => {}} onGuest={() => {}} />);
    fill('a@b.com', 'password123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Signing in/ })).toBeDisabled());
    resolve({ user: { id: 'u1' }, error: null });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/components/SignInScreen.test.jsx`
Expected: FAIL — cannot resolve `./SignInScreen`.

- [ ] **Step 3: Write the component**

Create `src/components/SignInScreen.jsx`:

```jsx
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
      if (res.user) onSignedIn(res.user);
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
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/components/SignInScreen.test.jsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the styles**

Append to `src/styles.css`:

```css
/* ============================================================
   SIGN IN — the gate shown before any screen when nobody is signed in and
   guest mode has not been chosen. Its own full-bleed layout rather than a
   modal: there is nothing behind it to look at yet. */
.signin-screen {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--dark-ink)
}

.signin-card {
  width: 100%;
  max-width: 340px;
  padding: 26px;
  border-radius: var(--radius);
  background: var(--ink);
  box-shadow: var(--shadow-standard)
}

.signin-title {
  margin: 0 0 4px;
  font-size: 26px;
  color: var(--cream)
}

.signin-sub {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--cream-dim)
}

.signin-form {
  display: flex;
  flex-direction: column
}

.signin-label {
  margin-bottom: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--cream-dim)
}

.signin-input {
  margin-bottom: 13px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--ink-2);
  color: var(--cream);
  font: inherit
}

.signin-input:focus {
  outline: 2px solid var(--brass);
  outline-offset: 1px
}

.signin-submit {
  padding: 10px;
  border: 0;
  border-radius: 5px;
  background: var(--brass);
  color: #14200a;
  font: inherit;
  font-weight: 700;
  cursor: pointer
}

.signin-submit:disabled {
  opacity: .6;
  cursor: default
}

.signin-error {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--blood)
}

.signin-notice {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--brass)
}

.signin-switch,
.signin-skip {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 7px;
  border: 0;
  background: none;
  color: var(--cream-dim);
  font: inherit;
  font-size: 12px;
  cursor: pointer
}

.signin-switch:hover,
.signin-skip:hover {
  color: var(--cream)
}

.signin-skip {
  margin-top: 4px;
  border-top: 1px solid var(--line);
  padding-top: 12px
}
```

- [ ] **Step 6: Verify the CSS actually landed on disk**

Run: `grep -c "signin-" src/styles.css`
Expected: a number of 20 or more. **If it is 0, the edit was reverted by the editor — reapply it before continuing.**

- [ ] **Step 7: Commit**

```bash
git add src/components/SignInScreen.jsx src/components/SignInScreen.test.jsx src/styles.css
git commit -m "feat: add sign-in screen with guest bypass"
```

---

### Task 7: Gate the app and sync on sign-in

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/AppRail.jsx`
- Create: `src/App.auth.test.jsx`

**Interfaces:**
- Consumes: `SignInScreen`; `getUser`, `isGuest`, `onAuthChange`, `signOut` from `auth.js`; `syncNow` from `sync.js`.
- Produces: no new exports. `AppRail` gains props `user` (object|null) and `onSignOut` (function).

> **Context for this task:** `App.jsx` already renders `HomeScreen`, `PokerTable`, `SidePanel` and `HistoryPanel`, keeps them all mounted, and switches between them with `data-screen` on `.shell`. Every mutation path (`startGame`, `endCurrentGame`, `clearHistory`) goes through `location.reload()` because the engine can only reach a clean state on a fresh page. Do not change that. `AppRail` already has a `rail-profile` button with a hardcoded name.

- [ ] **Step 1: Write the failing test**

Create `src/App.auth.test.jsx`:

```jsx
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('./engine/auth.js', () => ({
  getUser: vi.fn(),
  isGuest: vi.fn(() => false),
  onAuthChange: vi.fn(() => () => {}),
  signOut: vi.fn(async () => ({ error: null })),
}));
vi.mock('./engine/sync.js', () => ({
  syncNow: vi.fn(async () => ({ pushed: null, pulled: null, error: null })),
}));
// The engine paints into DOM nodes this test does not care about, and
// initialises once per page. Stubbing it keeps the gate test about the gate.
vi.mock('./engine/initializePokerTrainer', () => ({
  initializePokerTrainer: () => ({
    canReplay: () => true, isReplaying: () => false, enter: () => true,
    stepCount: () => 0, visibleSteps: () => [], show: () => {}, exit: () => {},
  }),
}));

const auth = await import('./engine/auth.js');
const sync = await import('./engine/sync.js');
const { App } = await import('./App');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.isGuest.mockReturnValue(false);
});

describe('auth gate', () => {
  test('shows the sign-in screen when nobody is signed in', async () => {
    auth.getUser.mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  test('shows the app when a user is signed in', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    render(<App />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  test('the guest bypass gets past the gate without a user', async () => {
    auth.getUser.mockResolvedValue(null);
    auth.isGuest.mockReturnValue(true);
    render(<App />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
  });

  test('syncs once after a signed-in boot', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    render(<App />);
    await waitFor(() => expect(sync.syncNow).toHaveBeenCalledTimes(1));
  });

  test('does not sync for a guest', async () => {
    auth.getUser.mockResolvedValue(null);
    auth.isGuest.mockReturnValue(true);
    render(<App />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
    expect(sync.syncNow).not.toHaveBeenCalled();
  });

  test('shows the signed-in email in the rail', async () => {
    auth.getUser.mockResolvedValue({ id: 'u1', email: 'matty@example.com' });
    render(<App />);
    expect(await screen.findByText('matty@example.com')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/App.auth.test.jsx`
Expected: FAIL — the sign-in button is never found, because `App` renders the table unconditionally.

- [ ] **Step 3: Add the gate to `src/App.jsx`**

`App.jsx` already imports from React. **Edit that existing line** to add `useEffect` — do not add a second `react` import:

```jsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
```

Then add these three new import lines below the existing ones:

```jsx
import { getUser, isGuest, onAuthChange, signOut } from './engine/auth';
import { syncNow } from './engine/sync';
import { SignInScreen } from './components/SignInScreen';
```

Add this state inside `App()`, directly below the `const [newGameOpen, setNewGameOpen] = useState(false);` line:

```jsx
  // 'checking' until the first getUser() resolves. Rendering the gate during
  // that window would flash a sign-in form at somebody who is already signed
  // in, on every single page load.
  const [authState, setAuthState] = useState('checking');
  const [user, setUser] = useState(null);
  const [guest, setGuest] = useState(() => isGuest());
```

Add these effects below the existing `useLayoutEffect`:

```jsx
  useEffect(() => {
    let cancelled = false;
    getUser().then((u) => {
      if (cancelled) return;
      setUser(u);
      setAuthState('ready');
      // Pull anything played on another device, then push what is here. Only
      // for a real account -- a guest has nowhere to sync to.
      if (u) syncNow();
    });
    return () => { cancelled = true; };
  }, []);

  // Supabase refreshes tokens and can sign a session out from under us, so the
  // gate follows the client rather than the one-shot check above.
  useEffect(() => onAuthChange((u) => {
    setUser(u);
    setAuthState('ready');
  }), []);

  const doSignOut = useCallback(async () => {
    await signOut();
    setUser(null);
    setGuest(false);
    // A reload for the same reason every other state change reloads: the
    // engine holds the previous account's game in memory.
    openOnReload('home');
    location.reload();
  }, []);
```

Then replace the `return (` block's opening so the gate renders first. Insert this immediately before the existing `return (`:

```jsx
  // Nothing at all until the first check resolves -- see the comment on
  // authState above.
  if (authState === 'checking') return <div className="shell" data-screen="home" />;

  if (!user && !guest) {
    return (
      <SignInScreen
        onSignedIn={(u) => { setUser(u); setAuthState('ready'); syncNow(); }}
        onGuest={() => setGuest(true)}
      />
    );
  }
```

Finally, pass the identity to the rail — replace the existing `<AppRail ... />` line with:

```jsx
      <AppRail screen={screen} onNavigate={navigate} user={user} onSignOut={doSignOut} />
```

- [ ] **Step 4: Wire the rail's profile button in `src/components/AppRail.jsx`**

Change the signature:

```jsx
export function AppRail({ screen = 'table', onNavigate = () => {}, user = null, onSignOut = () => {} }) {
```

Replace the existing `rail-profile` button with:

```jsx
      {/* margin-top:auto pins this to the floor of the rail, whatever grows
          above it. Guests get the same row, saying what they are missing. */}
      <button type="button" className="rail-profile" onClick={onSignOut} disabled={!user}>
        <span className="rail-avatar" aria-hidden="true">
          {user && user.email ? user.email[0].toUpperCase() : 'G'}
        </span>
        <span className="rail-profile-text">
          <span className="rail-profile-name">{user && user.email ? user.email : 'Guest'}</span>
          <span className="rail-profile-meta">{user ? 'Sign out' : 'Not signed in'}</span>
        </span>
      </button>
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run src/App.auth.test.jsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Check the older App tests still pass**

Run: `npx vitest run src/App.test.jsx src/App.smoke.test.jsx src/App.history.test.jsx`
Expected: PASS.

If they now fail because the gate hides the table, add this line to the top of each failing file's setup (they run without a Supabase config, so guest mode is the right default for them):

```js
beforeAll(() => { localStorage.setItem('chipaway.guest', '1'); });
```

- [ ] **Step 7: Full verification**

Run: `npm run lint && npx vitest run && npm run build`
Expected: lint silent, all tests pass, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/components/AppRail.jsx src/App.auth.test.jsx \
        src/App.test.jsx src/App.smoke.test.jsx src/App.history.test.jsx
git commit -m "feat: gate the app on auth with a guest bypass, sync on sign-in"
```

---

### Task 8: Sync each finished hand, and deploy config

**Files:**
- Modify: `src/App.jsx`
- Modify: `.github/workflows/deploy-pages.yml`
- Create: `docs/accounts-setup.md`

**Interfaces:**
- Consumes: `push` from `sync.js`.
- Produces: nothing new.

- [ ] **Step 1: Push after each hand is filed**

The engine files a hand synchronously via `saveHand()` at the end of `concludeHand`. Rather than making the engine async, `App` listens for the browser's own idle moments. Add to `src/App.jsx`, below the other effects:

```jsx
  // The engine files each hand to localStorage synchronously and cannot await
  // a network call mid-hand. So the push rides along afterwards: whenever the
  // tab is hidden or closed, and once a minute while it is open. Losing a push
  // costs nothing -- the next one re-sends everything local that the server
  // does not already have.
  useEffect(() => {
    if (!user) return undefined;
    const onHide = () => { if (document.visibilityState === 'hidden') push(); };
    const timer = setInterval(push, 60000);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [user]);
```

Add `push` to the sync import:

```jsx
import { push, syncNow } from './engine/sync';
```

- [ ] **Step 2: Verify it does not fire for guests**

Add to `src/App.auth.test.jsx`:

```jsx
test('does not start the background push for a guest', async () => {
  auth.getUser.mockResolvedValue(null);
  auth.isGuest.mockReturnValue(true);
  const sync2 = await import('./engine/sync.js');
  render(<App />);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
  document.dispatchEvent(new Event('visibilitychange'));
  expect(sync2.push).not.toHaveBeenCalled();
});
```

And extend the sync mock at the top of that file:

```jsx
vi.mock('./engine/sync.js', () => ({
  syncNow: vi.fn(async () => ({ pushed: null, pulled: null, error: null })),
  push: vi.fn(async () => ({ games: 0, hands: 0, error: null })),
}));
```

Run: `npx vitest run src/App.auth.test.jsx`
Expected: PASS, 7 tests.

- [ ] **Step 3: Give CI the env vars**

In `.github/workflows/deploy-pages.yml`, replace the `- run: npm run build` line with:

```yaml
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
```

- [ ] **Step 4: Write the setup note**

Create `docs/accounts-setup.md`:

```markdown
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
```

- [ ] **Step 5: Full verification**

Run: `npm run lint && npx vitest run && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/App.auth.test.jsx .github/workflows/deploy-pages.yml docs/accounts-setup.md
git commit -m "feat: push hands in the background and document accounts setup"
```

---

## Manual verification (after Task 8)

The automated tests never touch the network. These steps do, and they are the
only way to know RLS actually works.

- [ ] Put a real anon key in `.env.local`, run `npm run dev`.
- [ ] Create an account. Confirm the email if Supabase asks.
- [ ] Play two hands. Check the History screen lists them.
- [ ] In the Supabase dashboard, run:
      `select id, hand_no, net from public.hands order by started_at desc limit 5;`
      Both hands should be there with a `user_id` matching your account.
- [ ] Sign out, create a **second** account, and run the same query.
      Expected: **zero rows.** If the first account's hands are visible, RLS is
      not doing its job — stop and fix the policies before going further.
- [ ] Sign back in as the first account in a different browser. The two hands
      and the game should appear in History.
- [ ] Reload with `.env.local` renamed away. The app should fall through to
      guest mode and still deal cards.

## Out of scope

Deliberately not in this plan: password reset, OAuth providers, migrating a
guest's local hands into a newly created account, realtime subscriptions, and
per-game hand filtering in the History screen. Each is its own piece of work.

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

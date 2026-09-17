-- Dev notes: one shared markdown doc the two of us keep a change list in.
--
-- Unlike games and hands, this is not per-player data -- it is a single
-- document with two authors, so there is no user_id to scope rows by and the
-- (user_id, id) primary key pattern the rest of the schema uses does not
-- apply. What takes its place is is_admin() below: the row is readable and
-- writable by an allow-list of email addresses and by nobody else.
--
-- The page that renders this ships the same email list in the browser bundle,
-- but only to decide whether to draw the nav row. Hiding a button is not
-- security -- this file is. Anyone can call the REST endpoint with the public
-- anon key; only these two get a row back.

create table if not exists public.dev_notes (
  -- There is one doc, forever. A check constraint rather than a convention
  -- the client has to remember, so a second row cannot be created by a bug,
  -- by the dashboard, or by a future migration that forgets.
  id            smallint    primary key default 1 check (id = 1),
  body          text        not null default '',
  -- Doubles as the optimistic-concurrency token. The client sends back the
  -- value it loaded and the update matches on it, so two admins editing at
  -- once cannot silently overwrite each other -- see the trigger below.
  updated_at    timestamptz not null default now(),
  -- Denormalised so "last saved by ..." needs no join to auth.users, which
  -- the anon role cannot select from anyway.
  updated_by    uuid references auth.users (id) on delete set null,
  updated_email text
);

insert into public.dev_notes (id, body)
values (1, E'# Dev notes\n\nThings that should change, so we are reviewing from the same list.\n\n- [ ] First item\n')
on conflict (id) do nothing;

-- Membership lives in one function so the two policies below cannot drift
-- apart, and so adding a third admin is a one-line migration rather than an
-- edit in several places.
--
-- In `private`, not `public`: PostgREST exposes every function in an exposed
-- schema as an RPC endpoint, and a security definer function reachable at
-- /rest/v1/rpc/ is what the database linter's 0028/0029 warnings are about.
-- Nothing here is callable from the API now, while the policies below can
-- still call it -- policy expressions are evaluated with the querying role's
-- privileges, which is why anon and authenticated need USAGE on the schema.
-- Without that grant a non-admin's read fails with "permission denied for
-- schema private" instead of quietly returning no rows.
--
-- security definer with an empty search_path for the same reason
-- handle_new_user() in 0001 has one: it stops a caller putting their own
-- schema ahead of pg_catalog and redefining what the body resolves to.
-- stable, not volatile, so the planner calls it once per statement instead of
-- once per row.
--
-- The email comes off the verified JWT, not from a client-supplied argument.
create schema if not exists private;
grant usage on schema private to anon, authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
    in ('matthwfrost@gmail.com', 'tom0706@outlook.com');
$$;

alter table public.dev_notes enable row level security;

-- Only select and update. The absence of an insert or a delete policy is
-- deliberate and is itself the lock: the single row is seeded by this
-- migration, and no client has any business creating a second one or removing
-- the only one. RLS denies what no policy allows.
create policy "dev notes admin read" on public.dev_notes
  for select using (private.is_admin());
create policy "dev notes admin write" on public.dev_notes
  for update using (private.is_admin()) with check (private.is_admin());

-- Stamped server-side, never by the client. If the client set updated_at it
-- would be setting its own concurrency token, and could hold a stale one
-- forever; and a wrong clock on one laptop would reorder the history.
create or replace function public.touch_dev_notes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  new.updated_email := (select auth.jwt() ->> 'email');
  return new;
end;
$$;

drop trigger if exists dev_notes_touch on public.dev_notes;
create trigger dev_notes_touch
  before update on public.dev_notes
  for each row execute function public.touch_dev_notes();

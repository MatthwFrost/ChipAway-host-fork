-- Let the name a player typed on the sign-up form win over the email prefix.
--
-- supabase-js puts options.data from signUp() into auth.users.raw_user_meta_data,
-- so it is already on the NEW row by the time this trigger fires -- no second
-- round trip from the client, and no window where the profile exists without a
-- name. nullif(...,'') so a whitespace-only name falls through to the old
-- behaviour rather than writing an empty string.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

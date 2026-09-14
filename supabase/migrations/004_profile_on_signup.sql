-- Stage 3: insert a profiles row when a user signs up.
--
-- profiles has default-deny RLS and no INSERT policy for any JWT role
-- (writes were reserved for this trigger / service_role). The function is
-- SECURITY DEFINER so the insert is not evaluated as the signing-up user;
-- a SECURITY INVOKER trigger would hit the same wall the app does.
--
-- New accounts are always role = canvasser, active = true. There is no
-- signup path to office or admin. full_name is copied from
-- auth.users.raw_user_meta_data (set by signUp options.data).
--
-- No new table, so no new RLS policies. Existing profiles grants stand.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    'canvasser',
    true
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'SECURITY DEFINER. Inserts profiles on auth.users insert. Defaults role=canvasser, active=true. Reads full_name from raw_user_meta_data.';

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

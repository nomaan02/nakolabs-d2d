-- 029_admin_canvasser_accounts.sql
-- UI-10 Session F5f (2026-10-09). Owner decision A35 (2026-10-06): Settings
-- lists canvasser accounts and switches them on and off. Owner 2026-10-09:
-- in F5, as the last session, human-gated.
--
--   * admin_set_canvasser_active(p_profile_id, p_active): admin only. Sets
--     profiles.active for a CANVASSER account and returns the new value.
--     Admin and office accounts are refused, so an admin can never lock
--     themselves (or the office) out from this screen.
--
-- profiles has no UPDATE policy and keeps none: this function is the only
-- way the app changes `active`. An inactive account already can't sign in
-- (middleware) and reads nothing (app_role() is null for it), and its
-- history stays. No table, column, view or policy changes.

create or replace function public.admin_set_canvasser_active(p_profile_id uuid, p_active boolean)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_role text;
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'Only an admin can switch accounts on or off.' using errcode = '42501', hint = 'not_admin';
  end if;
  if p_profile_id is null or p_active is null then
    raise exception 'An account and on or off are both needed.' using errcode = '22023', hint = 'missing_argument';
  end if;

  select p.role into v_role
    from public.profiles p
   where p.id = p_profile_id
     for update;
  if not found then
    raise exception 'That account does not exist.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v_role is distinct from 'canvasser' then
    raise exception 'Only canvasser accounts can be switched here.' using errcode = '42501', hint = 'not_canvasser';
  end if;

  update public.profiles
     set active = p_active
   where id = p_profile_id;

  return p_active;
end;
$function$;

comment on function public.admin_set_canvasser_active(uuid, boolean) is
  'UI-10 F5f (owner A35). Admin only. Switches a canvasser account on or off (profiles.active). Refuses admin and office accounts.';

revoke all on function public.admin_set_canvasser_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_canvasser_active(uuid, boolean) to authenticated;

-- 028_exceptions_logging.sql
-- UI-8 Session D1a (2026-10-06). Owner decisions H4, H7 (2026-10-03) as
-- amended by U8-1..U8-4 (2026-10-06). Exceptions-only logging ("Mode B").
--
--   * knock_events.origin: 'tap' (the canvasser pressed a button for this
--     door) or 'inferred' (the phone filled it as Not In between two tapped
--     logs). Every existing row is 'tap'. An inferred row is always Not In.
--   * logging_default(): the org default logging mode for every signed-in
--     user. app_settings itself stays admin only.
--   * set_logging_default(): admin only. Stores {"default_mode": ...} under
--     app_settings key 'logging'.
-- No change to RLS policies, v_latest_knock or any other table.

-- 1. Where a knock came from --------------------------------------------------
alter table public.knock_events
  add column origin text not null default 'tap'
    constraint knock_events_origin_check check (origin in ('tap', 'inferred'));

alter table public.knock_events
  add constraint knock_events_inferred_is_no_answer
    check (origin = 'tap' or outcome = 'no_answer');

comment on column public.knock_events.origin is
  'UI-8 (owner H4, U8-1..U8-3, 2026-10-06). tap = the canvasser logged this door. inferred = filled as Not In between two tapped logs in exceptions-only mode.';

-- Canvasser inserts use column-level grants (003_core.sql), so the new column
-- needs its own. The app sends it only for inferred rows.
grant insert (origin) on public.knock_events to authenticated;

-- 2. The org default, readable by every signed-in user -------------------------
create or replace function public.logging_default()
 returns text
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select coalesce(
    (select case s.value ->> 'default_mode' when 'exceptions' then 'exceptions' end
       from public.app_settings s
      where s.key = 'logging'),
    'every_door'
  );
$function$;

comment on function public.logging_default() is
  'UI-8 (owner U8-4). Org default logging mode: every_door (default) or exceptions. Each phone can override it in the You tab.';

revoke all on function public.logging_default() from public, anon;
grant execute on function public.logging_default() to authenticated;

-- 3. Admin sets the default --------------------------------------------------
create or replace function public.set_logging_default(p_mode text)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'Only an admin can change the logging default' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('every_door', 'exceptions') then
    raise exception 'Unknown logging mode %', coalesce(p_mode, 'null') using errcode = '22023';
  end if;

  insert into public.app_settings (key, value, updated_at, updated_by)
  values ('logging', jsonb_build_object('default_mode', p_mode), now(), (select auth.uid()))
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  return p_mode;
end;
$function$;

comment on function public.set_logging_default(text) is
  'UI-8 (owner U8-4). Admin only. Sets app_settings key logging to {"default_mode": every_door | exceptions}.';

revoke all on function public.set_logging_default(text) from public, anon;
grant execute on function public.set_logging_default(text) to authenticated;

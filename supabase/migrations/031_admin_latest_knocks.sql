-- 031_admin_latest_knocks.sql
-- UI-10 Session F6d (2026-10-10). FU-1 (2026-10-08), owner 2026-10-10: in F6.
--
--   admin_latest_knocks(p_from, p_to, p_canvasser_id, p_assignment_ids):
--   the latest outcome per door per visit (the same rows as v_latest_knock:
--   DISTINCT ON (assignment_id, uprn) ORDER BY occurred_at DESC, synced_at
--   DESC), keeping only rows whose latest knock is in [p_from, p_to), by
--   that canvasser and on those visits when given. Unlike filtering the
--   view, the window narrows the doors BEFORE the DISTINCT ON, so Calendar,
--   Coverage and Team no longer sort every knock on every page.
--   Admin only, SECURITY INVOKER (RLS still applies). Claude checked on
--   2026-10-10 that its body returns exactly the view's rows for all time,
--   a month, one person, a window + person and a list of visits.
-- No table, view or policy changes.

create or replace function public.admin_latest_knocks(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_canvasser_id uuid default null,
  p_assignment_ids uuid[] default null
)
 returns table (assignment_id uuid, uprn bigint, outcome text, canvasser_id uuid, occurred_at timestamptz)
 language plpgsql
 stable
 security invoker
 set search_path to ''
as $function$
#variable_conflict use_column
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'Only an admin can read every knock.' using errcode = '42501', hint = 'not_admin';
  end if;

  return query
  with pairs as (
    select distinct k.assignment_id, k.uprn
      from public.knock_events k
     where (p_from is null or k.occurred_at >= p_from)
       and (p_to is null or k.occurred_at < p_to)
       and (p_canvasser_id is null or k.canvasser_id = p_canvasser_id)
       and (p_assignment_ids is null or k.assignment_id = any (p_assignment_ids))
  ), latest as (
    select distinct on (k.assignment_id, k.uprn)
           k.assignment_id, k.uprn, k.outcome, k.canvasser_id, k.occurred_at
      from public.knock_events k
      join pairs p on p.assignment_id = k.assignment_id and p.uprn = k.uprn
     order by k.assignment_id, k.uprn, k.occurred_at desc, k.synced_at desc
  )
  select l.assignment_id, l.uprn, l.outcome, l.canvasser_id, l.occurred_at
    from latest l
   where (p_from is null or l.occurred_at >= p_from)
     and (p_to is null or l.occurred_at < p_to)
     and (p_canvasser_id is null or l.canvasser_id = p_canvasser_id)
   order by l.assignment_id, l.uprn;
end;
$function$;

comment on function public.admin_latest_knocks(timestamptz, timestamptz, uuid, uuid[]) is
  'UI-10 F6d (FU-1). Admin only. v_latest_knock rows narrowed by time window, canvasser and visits before the DISTINCT ON.';

revoke all on function public.admin_latest_knocks(timestamptz, timestamptz, uuid, uuid[]) from public, anon;
grant execute on function public.admin_latest_knocks(timestamptz, timestamptz, uuid, uuid[]) to authenticated;

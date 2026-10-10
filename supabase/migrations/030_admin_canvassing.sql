-- 030_admin_canvassing.sql
-- UI-10 Session F6c (2026-10-10). Owner decisions A12 and A30 (2026-10-01,
-- 2026-10-06): one account can be admin AND canvasser, and the admin can
-- open /field ("Go canvassing"). Owner 2026-10-10: the admin is always
-- pickable for a team; FU-2 and FU-3 are folded in here.
--
--   1. RLS: the admin may log their own knocks, leads and rented/council
--      answers on a visit they are a member of (the same checks as a
--      canvasser). Admin already reads everything.
--   2. leads_guard_status: an admin creates a lead like a canvasser, as
--      'pending' only (settling stays with the office; admin has no UPDATE
--      policy on leads).
--   3. allocate_prop and assignment_member_add accept an active admin as a
--      team member as well as an active canvasser. Only the one role check
--      in each function changes; the rest of each function is re-created
--      exactly as it is stored today.
--   4. FU-2: assignment_remove refuses to delete a visit once its day has
--      come (London date). It is ended instead (owner 2026-10-08).
--   5. FU-3: assignments.started_at = the time of the visit's first knock,
--      set by a trigger on knock_events (no change to the field write
--      path), with a one-off backfill for visits already knocked.
-- No table or column changes. Office still never canvasses.

-- 1. RLS ----------------------------------------------------------------------
alter policy knock_events_insert_canvasser on public.knock_events
  with check (
    ((select public.app_role()) in ('canvasser', 'admin'))
    and (canvasser_id = (select auth.uid()))
    and public.is_assignment_member(assignment_id)
  );

alter policy leads_insert_canvasser on public.leads
  with check (
    ((select public.app_role()) in ('canvasser', 'admin'))
    and (canvasser_id = (select auth.uid()))
    and exists (
      select 1
        from public.knock_events k
       where k.id = leads.knock_event_id
         and k.canvasser_id = (select auth.uid())
    )
  );

alter policy property_observations_insert_canvasser on public.property_observations
  with check (
    ((select public.app_role()) in ('canvasser', 'admin'))
    and (canvasser_id = (select auth.uid()))
  );

-- 2. Lead status guard ----------------------------------------------------------
create or replace function public.leads_guard_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- UI-10 F6c: an admin logging in /field is held to the canvasser rule.
  if public.app_role() in ('canvasser', 'admin') then
    if tg_op = 'INSERT' and new.status <> 'pending' then
      raise exception 'Canvassers cannot set lead status'
        using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      raise exception 'Canvassers cannot change lead status'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$function$;

-- 3. Team members may be an admin ---------------------------------------------------
do $migration$
declare
  v_find constant text := $s$and p.role = 'canvasser'$s$;
  v_with constant text := $s$and p.role in ('canvasser', 'admin')$s$;
  v_fn regprocedure;
  v_def text;
  v_count int;
begin
  foreach v_fn in array array[
    'public.allocate_prop(uuid, date, uuid[])'::regprocedure,
    'public.assignment_member_add(uuid, uuid)'::regprocedure
  ] loop
    v_def := pg_get_functiondef(v_fn);
    v_count := (length(v_def) - length(replace(v_def, v_find, ''))) / length(v_find);
    if v_count <> 1 then
      raise exception '% has % role checks, expected 1', v_fn, v_count;
    end if;
    execute replace(v_def, v_find, v_with);
  end loop;
end;
$migration$;

-- 4. FU-2: a visit whose day has come is never deleted --------------------------------
create or replace function public.assignment_remove(p_assignment_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_a      public.assignments%rowtype;
  v_knocks int;
  v_total  int;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can remove an assignment.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  select a.* into v_a
  from public.assignments a
  where a.id = p_assignment_id
  for update;

  if not found then
    raise exception 'That assignment does not exist.'
      using errcode = '22023', hint = 'missing_assignment';
  end if;

  if v_a.closed_at is not null then
    raise exception 'That assignment is already closed.'
      using errcode = '22023', hint = 'already_closed';
  end if;

  -- UI-10 F6c (FU-2; owner 2026-10-08): once a visit's day has come it is
  -- ended, never deleted. A phone may still hold knocks that have not synced.
  if v_a.work_date <= (timezone('Europe/London', now()))::date then
    raise exception 'This visit''s day has come, so it can''t be deleted. End it instead.'
      using errcode = '22023', hint = 'visit_day_reached';
  end if;

  v_total := cardinality(v_a.uprn_snapshot);

  select count(*) into v_knocks
  from public.knock_events k
  where k.assignment_id = p_assignment_id;

  if v_knocks = 0 then
    -- Cascades to assignment_members and route_steps.
    delete from public.assignments where id = p_assignment_id;
    return jsonb_build_object(
      'action', 'deleted',
      'worked', 0,
      'total', v_total,
      'counts_for_rotation', null
    );
  end if;

  return public.assignment_close_early(p_assignment_id);
end;
$function$;

-- 5. FU-3: started_at = the first knock --------------------------------------------------
create or replace function public.knock_events_mark_started()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  update public.assignments a
     set started_at = new.occurred_at
   where a.id = new.assignment_id
     and (a.started_at is null or a.started_at > new.occurred_at);
  return null;
end;
$function$;

comment on function public.knock_events_mark_started() is
  'UI-10 F6c (FU-3). After each knock insert: assignments.started_at becomes the earliest knock time on that visit. Knocks synced late (offline) can only move it earlier.';

revoke all on function public.knock_events_mark_started() from public, anon, authenticated;

drop trigger if exists knock_events_mark_started on public.knock_events;
create trigger knock_events_mark_started
  after insert on public.knock_events
  for each row execute function public.knock_events_mark_started();

-- One-off backfill: every visit already knocked starts at its first knock.
update public.assignments a
   set started_at = k.first_at
  from (
    select assignment_id, min(occurred_at) as first_at
      from public.knock_events
     group by assignment_id
  ) k
 where a.id = k.assignment_id
   and (a.started_at is null or a.started_at > k.first_at);

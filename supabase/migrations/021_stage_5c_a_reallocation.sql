-- Stage 5c-a: allocation removal and mid-shift reallocation (backend only).
--
-- Early end on assignments (closed_reason, counts_for_rotation), left_at on
-- members, a generic admin-only app_settings table, and two admin RPCs.
-- allocate_prop gains a same-date double-booking guard and a rotation-aware
-- visit_number. todays_assignment hides a closed assignment and a member who
-- has left.
--
-- Re-created functions are copied from the live definitions (which match
-- 020, 010 and 003 apart from line endings). The only body changes are the
-- ones named below. is_assignment_member, route_steps, knock_events and
-- migrations 001–020 are not modified.
--
-- 012 lesson: every function below revokes execute from public, anon,
-- authenticated and service_role, then grants execute to authenticated.
-- The trigger function is not granted a new firing condition. The existing
-- trigger stays BEFORE INSERT OR UPDATE OF assignment_id, so setting
-- left_at does not run the cap check.

-- ---------------------------------------------------------------------------
-- 1. assignments — early end
-- ---------------------------------------------------------------------------

alter table public.assignments
  add column closed_reason text
    check (closed_reason is null or closed_reason = 'reallocated'),
  add column counts_for_rotation boolean not null default true;

comment on column public.assignments.closed_at is
  'When set, the assignment has ended. Stage 5c-a sets it for an early end '
  '(reallocation). Stage 12b will extend this for a normal close.';

comment on column public.assignments.closed_reason is
  'Why closed_at was set. Stage 5c-a writes only reallocated. Null while the '
  'assignment is open. Stage 12b will extend the allowed values.';

comment on column public.assignments.counts_for_rotation is
  'Whether this assignment advances the next visit_number. False when an '
  'early end worked at or under the rotation threshold. True by default, '
  'including while the assignment is still open.';

-- ---------------------------------------------------------------------------
-- 2. assignment_members — a canvasser who has left
-- ---------------------------------------------------------------------------

alter table public.assignment_members
  add column left_at timestamptz;

comment on column public.assignment_members.left_at is
  'When this canvasser left the assignment. Null while they are an active '
  'member. A left member does not count toward the team of three and is '
  'omitted from todays_assignment. Knock events already logged are kept.';

-- ---------------------------------------------------------------------------
-- 3. app_settings — generic admin key/value store
-- ---------------------------------------------------------------------------

create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

comment on table public.app_settings is
  'Generic key/value settings. Stage 5c-a seeds rotation.visit_threshold_pct. '
  'Stage 15 scoring weights will go here too. Admin only.';

create index app_settings_updated_by_idx on public.app_settings (updated_by);

alter table public.app_settings enable row level security;

revoke all on table public.app_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.app_settings to authenticated;

create policy app_settings_select_admin
  on public.app_settings for select to authenticated
  using ((select public.app_role()) = 'admin');

create policy app_settings_insert_admin
  on public.app_settings for insert to authenticated
  with check ((select public.app_role()) = 'admin');

create policy app_settings_update_admin
  on public.app_settings for update to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy app_settings_delete_admin
  on public.app_settings for delete to authenticated
  using ((select public.app_role()) = 'admin');

insert into public.app_settings (key, value)
values ('rotation', '{"visit_threshold_pct": 50}'::jsonb);

-- ---------------------------------------------------------------------------
-- 4. Team cap counts active members only
-- ---------------------------------------------------------------------------
-- The trigger itself is unchanged: BEFORE INSERT OR UPDATE OF assignment_id.
-- An update that only sets left_at does not fire it.

create or replace function public.assignment_members_max_three()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform 1 from public.assignments where id = new.assignment_id for update;

  select count(*) into n
  from public.assignment_members
  where assignment_id = new.assignment_id
    and left_at is null;

  if n >= 3 then
    raise exception 'A team is one to three canvassers'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.assignment_members_max_three()
  from public, anon, authenticated, service_role;
grant execute on function public.assignment_members_max_three() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. assignment_close_early — shared early-end path
-- ---------------------------------------------------------------------------
-- Safe to call on its own. A caller that already holds the assignment lock
-- re-acquires it in this same transaction.

create or replace function public.assignment_close_early(
  p_assignment_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_a          public.assignments%rowtype;
  v_worked     int;
  v_total      int;
  v_percent    numeric;
  v_setting    jsonb;
  v_raw        jsonb;
  v_num        numeric;
  v_threshold  numeric := 50;
  v_source     text := 'default';
  v_counts     boolean;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can close an assignment early.'
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

  -- Doors outside the frozen snapshot cannot push the share over 100%.
  select count(distinct k.uprn) into v_worked
  from public.knock_events k
  where k.assignment_id = p_assignment_id
    and k.uprn = any (v_a.uprn_snapshot);

  v_total := cardinality(v_a.uprn_snapshot);
  if v_total = 0 then
    v_percent := 0;
  else
    v_percent := (v_worked * 100.0) / v_total;
  end if;

  -- Read fresh on every call. A value is used only when it is a JSON number
  -- from 0 to 100 inclusive. Anything else — missing row, missing key,
  -- null, a string (including "abc" and "30"), out of range, or another
  -- JSON type — falls back to 50 and does not raise. The cast happens only
  -- after the type check.
  select s.value into v_setting
  from public.app_settings s
  where s.key = 'rotation';

  v_raw := v_setting -> 'visit_threshold_pct';
  if jsonb_typeof(v_raw) = 'number' then
    v_num := v_raw::numeric;
    if v_num >= 0 and v_num <= 100 then
      v_threshold := v_num;
      v_source := 'setting';
    end if;
  end if;

  -- Strictly greater: exactly the threshold does not count.
  v_counts := v_percent > v_threshold;

  update public.assignments
     set closed_at = now(),
         closed_reason = 'reallocated',
         counts_for_rotation = v_counts
   where id = p_assignment_id;

  return jsonb_build_object(
    'action', 'closed',
    'worked', v_worked,
    'total', v_total,
    'percent_worked', v_percent,
    'threshold_pct', v_threshold,
    'threshold_source', v_source,
    'counts_for_rotation', v_counts
  );
end;
$$;

comment on function public.assignment_close_early(uuid) is
  'Stage 5c-a. Ends an assignment early: sets closed_at, closed_reason '
  'reallocated, and counts_for_rotation from the share of snapshot doors '
  'knocked against app_settings rotation.visit_threshold_pct (default 50, '
  'and 50 for any unusable value). Strictly above the threshold counts. '
  'Admin only. SECURITY INVOKER. Takes its own row lock. 22023 with hint '
  'missing_assignment or already_closed, 42501 hint not_admin.';

revoke all on function public.assignment_close_early(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assignment_close_early(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. assignment_remove — delete when unworked, otherwise end early
-- ---------------------------------------------------------------------------

create or replace function public.assignment_remove(
  p_assignment_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
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

  v_total := cardinality(v_a.uprn_snapshot);

  select count(*) into v_knocks
  from public.knock_events k
  where k.assignment_id = p_assignment_id;

  if v_knocks = 0 then
    -- Cascades to assignment_members and route_steps. A knock logged
    -- offline and synced later will fail the knock_events foreign key.
    -- Kept as specified; recorded as a 5c-b follow-up.
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
$$;

comment on function public.assignment_remove(uuid) is
  'Stage 5c-a. With no knock_events, deletes the assignment (members and '
  'route_steps cascade). Otherwise closes it early via assignment_close_early. '
  'Admin only. SECURITY INVOKER. 22023 hint missing_assignment or '
  'already_closed, 42501 hint not_admin.';

revoke all on function public.assignment_remove(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assignment_remove(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. assignment_member_remove — mark left; close when nobody remains
-- ---------------------------------------------------------------------------

create or replace function public.assignment_member_remove(
  p_assignment_id uuid,
  p_canvasser_id  uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_a         public.assignments%rowtype;
  v_left      timestamptz;
  v_remaining int;
  v_close     jsonb;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can remove a canvasser from an assignment.'
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

  select m.left_at
    into v_left
  from public.assignment_members m
  where m.assignment_id = p_assignment_id
    and m.canvasser_id = p_canvasser_id;

  if not found then
    raise exception 'That canvasser is not on this assignment.'
      using errcode = '22023', hint = 'not_member';
  end if;

  if v_left is not null then
    raise exception 'That canvasser has already left this assignment.'
      using errcode = '22023', hint = 'already_left';
  end if;

  update public.assignment_members
     set left_at = now()
   where assignment_id = p_assignment_id
     and canvasser_id = p_canvasser_id;

  select count(*) into v_remaining
  from public.assignment_members m
  where m.assignment_id = p_assignment_id
    and m.left_at is null;

  if v_remaining = 0 then
    v_close := public.assignment_close_early(p_assignment_id);
    return jsonb_build_object(
      'action', 'left',
      'remaining_active', v_remaining,
      'assignment_closed', true,
      'close', v_close
    );
  end if;

  return jsonb_build_object(
    'action', 'left',
    'remaining_active', v_remaining,
    'assignment_closed', false,
    'close', null
  );
end;
$$;

comment on function public.assignment_member_remove(uuid, uuid) is
  'Stage 5c-a. Sets assignment_members.left_at. Does not touch knock_events. '
  'When no active member remains, closes the assignment via '
  'assignment_close_early (never deletes it). Admin only. SECURITY INVOKER. '
  '22023 hint missing_assignment, already_closed, not_member or already_left; '
  '42501 hint not_admin.';

revoke all on function public.assignment_member_remove(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assignment_member_remove(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. allocate_prop — double-booking guard and rotation-aware visit_number
-- ---------------------------------------------------------------------------

create or replace function public.allocate_prop(
  territory_id uuid,
  work_date date,
  canvasser_ids uuid[]
)
returns table (
  id uuid,
  visit_number int,
  entry_vertex_index int,
  sweep_direction text,
  slot text,
  knockable_doors int
)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_geom geometry(Polygon, 4326);
  v_prior int;
  v_archived timestamptz;
  v_ring geometry;
  v_vertex_count int;
  v_n int;
  v_entry int;
  v_dir text;
  v_slot text;
  v_centroid geometry;
  v_entry_pt geometry;
  v_entry_az double precision;
  v_snapshot bigint[];
  v_assignment_id uuid;
  v_member uuid;
  v_unique int;
  v_ok int;
  v_booked_name text;
  v_constraint text;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can allocate a prop.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  if allocate_prop.territory_id is null then
    raise exception 'Pick a prop to allocate.'
      using errcode = '22023', hint = 'missing_territory';
  end if;

  if allocate_prop.work_date is null then
    raise exception 'Pick a date for this allocation.'
      using errcode = '22023', hint = 'missing_date';
  end if;

  -- At least one member. Stage 2's trigger only rejects a fourth; an empty
  -- call would otherwise insert an assignment with no team.
  if canvasser_ids is null or cardinality(canvasser_ids) = 0 then
    raise exception 'Pick at least one canvasser.'
      using errcode = '22023', hint = 'empty_team';
  end if;

  if exists (select 1 from unnest(canvasser_ids) u(member_id) where u.member_id is null) then
    raise exception 'Every team member must be a real canvasser.'
      using errcode = '22023', hint = 'not_canvasser';
  end if;

  -- The row lock stays: it serialises concurrent allocations of one prop,
  -- which is what makes the count below stable.
  select t.geom, t.archived_at
    into v_geom, v_archived
  from public.territories t
  where t.id = allocate_prop.territory_id
  for update;

  if not found then
    raise exception 'That prop does not exist.'
      using errcode = '22023', hint = 'missing_territory';
  end if;

  if v_archived is not null then
    raise exception 'That prop has been archived.'
      using errcode = '22023', hint = 'archived_prop';
  end if;

  select count(*) into v_unique
  from (select distinct u from unnest(canvasser_ids) u) s;

  select count(*) into v_ok
  from public.profiles p
  where p.id in (select distinct u from unnest(canvasser_ids) u)
    and p.role = 'canvasser'
    and p.active;

  if v_ok is distinct from v_unique then
    raise exception 'Every team member must be an active canvasser.'
      using errcode = '22023', hint = 'not_canvasser';
  end if;

  -- 5c-a. Refuse a canvasser who already has an open membership
  -- (left_at is null, assignment not closed) on this work_date for a
  -- different prop. The territories lock above does not cover that other
  -- prop, so two admins allocating the same canvasser to two props at the
  -- same instant can both pass. Recorded, not fixed.
  select coalesce(p.full_name, 'A canvasser')
    into v_booked_name
  from unnest(canvasser_ids) with ordinality as u(member_id, ord)
  join public.profiles p on p.id = u.member_id
  join public.assignment_members m
    on m.canvasser_id = u.member_id
   and m.left_at is null
  join public.assignments a on a.id = m.assignment_id
  where a.work_date = allocate_prop.work_date
    and a.closed_at is null
    and a.territory_id is distinct from allocate_prop.territory_id
  order by u.ord
  limit 1;

  if v_booked_name is not null then
    raise exception '% is already allocated to a prop on that date.', v_booked_name
      using errcode = '22023', hint = 'canvasser_double_booked';
  end if;

  v_ring := st_exteriorring(v_geom);
  -- Closing vertex duplicates the first; rotation walks the distinct corners.
  v_vertex_count := st_npoints(v_ring) - 1;
  if v_vertex_count < 3 then
    raise exception 'That prop polygon has too few vertices to rotate around.'
      using errcode = '22023', hint = 'degenerate_polygon';
  end if;

  -- R2 (2026-09-22), amended 5c-a (2026-09-26). visit_number is 1 + the
  -- highest visit_number on this prop that counts for rotation, under the
  -- row lock above. An early end at or under the threshold does not count,
  -- so the next allocation reuses that number. territories.visit_count is
  -- NOT read. entry_vertex_index and sweep_direction are still written
  -- (NOT NULL) but are legacy; the route now comes from a saved variant.
  select coalesce(max(a.visit_number), 0) into v_prior
  from public.assignments a
  where a.territory_id = allocate_prop.territory_id
    and a.counts_for_rotation;

  v_n := v_prior + 1;
  v_entry := v_n % v_vertex_count;
  v_dir := case when v_n % 2 = 0 then 'cw' else 'ccw' end;
  v_slot := (array['early', 'mid', 'late']::text[])[(v_n % 3) + 1];

  v_centroid := st_centroid(v_geom);
  v_entry_pt := st_pointn(v_ring, v_entry + 1);
  v_entry_az := coalesce(st_azimuth(v_centroid, v_entry_pt), 0);

  -- interim geometric ordering, replaced by assignment_route_freeze when a
  -- saved variant is copied onto this assignment
  -- mod() has no float8 overload; wrap via numeric.
  select coalesce(
    array_agg(ordered.uprn order by ordered.sweep_key, ordered.uprn),
    '{}'::bigint[]
  )
  into v_snapshot
  from (
    select
      p.uprn,
      mod(
        (
          case
            when v_dir = 'cw' then
              coalesce(st_azimuth(v_centroid, p.geom), 0) - v_entry_az
            else
              v_entry_az - coalesce(st_azimuth(v_centroid, p.geom), 0)
          end + 4 * pi()
        )::numeric,
        (2 * pi())::numeric
      ) as sweep_key
    from public.properties p
    where st_within(p.geom, v_geom)
      and not p.is_nccz
  ) ordered;

  if cardinality(v_snapshot) = 0 then
    raise exception 'This prop has no knockable doors to allocate.'
      using errcode = '22023', hint = 'no_knockable_doors';
  end if;

  insert into public.assignments (
    territory_id,
    work_date,
    visit_number,
    entry_vertex_index,
    sweep_direction,
    slot,
    uprn_snapshot,
    created_by
  ) values (
    allocate_prop.territory_id,
    allocate_prop.work_date,
    v_n,
    v_entry,
    v_dir,
    v_slot,
    v_snapshot,
    auth.uid()
  )
  returning assignments.id into v_assignment_id;

  -- No pre-check of length. A fourth id hits assignment_members_max_three
  -- and the exception handler below turns it into a clean message; the
  -- assignment row rolls back with it.
  foreach v_member in array canvasser_ids loop
    insert into public.assignment_members (assignment_id, canvasser_id)
    values (v_assignment_id, v_member);
  end loop;

  return query
    select
      v_assignment_id,
      v_n,
      v_entry,
      v_dir,
      v_slot,
      cardinality(v_snapshot);
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'assignments_territory_id_work_date_key' then
      raise exception 'This prop is already allocated on that date.'
        using errcode = '23505', hint = 'already_allocated';
    elsif v_constraint = 'assignment_members_pkey' then
      raise exception 'The same canvasser cannot be on a team twice.'
        using errcode = '23505', hint = 'duplicate_member';
    else
      raise;
    end if;
  when foreign_key_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'assignment_members_canvasser_id_fkey' then
      raise exception 'Every team member must be an active canvasser.'
        using errcode = '23503', hint = 'not_canvasser';
    else
      raise;
    end if;
  when check_violation then
    -- Stage 2 trigger: assignment_members_max_three. Not a table CHECK.
    if sqlerrm like '%one to three%' then
      raise exception 'A team is one to three canvassers.'
        using errcode = '23514', hint = 'team_too_large';
    else
      raise;
    end if;
end;
$$;

comment on function public.allocate_prop(uuid, date, uuid[]) is
  'Stage 5, amended 5b-R2 and 5c-a. Allocates a prop to a team of 1–3 '
  'canvassers for one date. visit_number = 1 + the highest visit_number on '
  'this prop with counts_for_rotation, under the territories row lock '
  '(territories.visit_count is not read). Refuses a canvasser who already '
  'has an open assignment on that date on another prop (hint '
  'canvasser_double_booked). Freezes knockable UPRNs with the interim '
  'geometric sweep — replaced by assignment_route_freeze when a saved '
  'variant is copied on — and writes assignments plus assignment_members in '
  'one function. Admin only. Raises SQLSTATE 22023 / 23505 / 23514 with a '
  'hint token for bad input, 42501 for a non-admin caller.';

revoke all on function public.allocate_prop(uuid, date, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.allocate_prop(uuid, date, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. todays_assignment — hide closed assignments and members who have left
-- ---------------------------------------------------------------------------

create or replace function public.todays_assignment()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_assignment public.assignments%rowtype;
  v_territory_name text;
  v_territory_geom geometry(Polygon, 4326);
  v_entry_pt geometry;
  v_az double precision;
  v_octant int;
  v_compass text;
  v_doors jsonb;
begin
  select a.*
    into v_assignment
  from public.assignments a
  inner join public.assignment_members m
    on m.assignment_id = a.id
   and m.canvasser_id = (select auth.uid())
  where a.work_date = (timezone('Europe/London', now()))::date
    and a.closed_at is null
    and m.left_at is null
  order by a.created_at
  limit 1;

  if not found then
    return null;
  end if;

  select t.name, t.geom
    into v_territory_name, v_territory_geom
  from public.territories t
  where t.id = v_assignment.territory_id;

  -- Identical to allocate_prop in 009:
  --   coalesce(st_azimuth(st_centroid(geom), st_pointn(ring, entry + 1)), 0)
  v_entry_pt := st_pointn(
    st_exteriorring(v_territory_geom),
    v_assignment.entry_vertex_index + 1
  );
  v_az := coalesce(st_azimuth(st_centroid(v_territory_geom), v_entry_pt), 0);

  -- Eight-point compass, north-based clockwise (ST_Azimuth's convention).
  -- Each octant is 45°, centred on the named bearing. floor so the
  -- 22.5° boundaries do not depend on round-half-even of float8.
  v_octant := mod(floor((degrees(v_az) + 360.0 + 22.5) / 45.0)::int, 8);
  v_compass := (array[
    'north',
    'north-east',
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west'
  ])[v_octant + 1];

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'id', p.uprn,
        'geometry', st_asgeojson(p.geom, 7)::jsonb,
        'properties', jsonb_build_object(
          'uprn', p.uprn,
          'sequence', snap.ord - 1
        )
      )
      order by snap.ord
    ),
    '[]'::jsonb
  )
  into v_doors
  from unnest(v_assignment.uprn_snapshot) with ordinality as snap(uprn, ord)
  inner join public.properties p on p.uprn = snap.uprn;

  return jsonb_build_object(
    'assignment_id', v_assignment.id,
    'territory_id', v_assignment.territory_id,
    'territory_name', v_territory_name,
    'work_date', v_assignment.work_date,
    'visit_number', v_assignment.visit_number,
    'sweep_direction', v_assignment.sweep_direction,
    'slot', v_assignment.slot,
    'entry_vertex_index', v_assignment.entry_vertex_index,
    'entry_compass', v_compass,
    'door_count', cardinality(v_assignment.uprn_snapshot),
    'doors', jsonb_build_object(
      'type', 'FeatureCollection',
      'features', v_doors
    )
  );
end;
$$;

comment on function public.todays_assignment() is
  'Stage 6, amended 5c-a. Today''s assignment for the signed-in canvasser '
  'as one jsonb document: header (visit_number, sweep_direction, slot, '
  'door_count, entry_compass from the Stage 5 centroid→entry-vertex azimuth) '
  'plus uprn_snapshot joined to properties.geom in snapshot order. Skips a '
  'closed assignment and a membership with left_at set. Returns JSON null '
  'when the caller has no open assignment_members row for Europe/London '
  'today. SECURITY INVOKER; EXECUTE for authenticated; no app_role() gate.';

revoke all on function public.todays_assignment()
  from public, anon, authenticated, service_role;
grant execute on function public.todays_assignment() to authenticated;

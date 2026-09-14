-- Stage 5 follow-up: 008's interim sweep used mod(float8, float8), which
-- Postgres does not have (mod() is integer/numeric only). 008 is already
-- applied, so this replaces allocate_prop with the same body and a numeric
-- cast. Privileges are restated so CREATE OR REPLACE cannot widen them.

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
  v_visit_count int;
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

  select t.geom, t.visit_count, t.archived_at
    into v_geom, v_visit_count, v_archived
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

  v_ring := st_exteriorring(v_geom);
  -- Closing vertex duplicates the first; rotation walks the distinct corners.
  v_vertex_count := st_npoints(v_ring) - 1;
  if v_vertex_count < 3 then
    raise exception 'That prop polygon has too few vertices to rotate around.'
      using errcode = '22023', hint = 'degenerate_polygon';
  end if;

  -- Read only. Stage 12b increments territories.visit_count on assignment close.
  v_n := v_visit_count + 1;
  v_entry := v_n % v_vertex_count;
  v_dir := case when v_n % 2 = 0 then 'cw' else 'ccw' end;
  v_slot := (array['early', 'mid', 'late']::text[])[(v_n % 3) + 1];

  v_centroid := st_centroid(v_geom);
  v_entry_pt := st_pointn(v_ring, v_entry + 1);
  v_entry_az := coalesce(st_azimuth(v_centroid, v_entry_pt), 0);

  -- interim geometric ordering, replaced by Stage 5b's route traversal
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
  'Stage 5. Allocates a prop to a team of 1–3 canvassers for one date. '
  'Computes rotation from territories.visit_count (read only), freezes '
  'knockable UPRNs with the interim geometric sweep, and writes assignments '
  'plus assignment_members in one function so a partial failure cannot leave '
  'a team-less allocation. Admin only. Raises SQLSTATE 22023 / 23505 / 23514 '
  'with a hint token for bad input, 42501 for a non-admin caller.';

revoke all on function public.allocate_prop(uuid, date, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.allocate_prop(uuid, date, uuid[]) to authenticated;

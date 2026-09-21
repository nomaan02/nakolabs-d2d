-- Stage 5b: route generation.
--
-- Design decisions are in docs/ROUTE-DESIGN.md. Read that first.
--
-- Two phases, split deliberately:
--   Phase 1 (here)  route_clipped_subgraph(assignment) — the READ. Returns the
--                   road_nodes / road_segments with at least half their length
--                   inside the prop polygon, plus the snapshot doors and the
--                   polygon ring, as one jsonb document. Every array is
--                   ORDER BY id / uprn / ring path: unordered SQL output is
--                   the likeliest source of non-determinism in this stage.
--   Phase 2 (TS)    lib/geo/route-*.ts — the traversal, in TypeScript, under
--                   the admin's session. pgRouting is not installed and must
--                   not be added; the clipped graph is small (Northville: 127
--                   segments, 112 nodes).
--   Phase 3 (here)  route_commit(...) — the WRITE. One transaction: replaces
--                   route_steps, sets route_geom / route_length_m /
--                   uprn_snapshot / route_stranded_count. Re-checks the
--                   freeze (zero knock_events) inside the same transaction.
--
-- allocate_prop (008/009) is NOT modified. It still writes the interim
-- angular snapshot with route_geom null; the generator runs afterwards and
-- fails open. "Is this route-derived?" is a per-assignment fact:
-- route_geom is not null.
--
-- Both functions are SECURITY INVOKER. RLS on assignments, territories,
-- road_*, properties, knock_events and route_steps governs every read and
-- write. Nothing here runs as the service role.
--
-- 012 lesson: revoke defaults from public, anon AND authenticated explicitly.

-- ---------------------------------------------------------------------------
-- 1. route_steps — exactly the brief's DDL
-- ---------------------------------------------------------------------------

create table public.route_steps (
  id            bigserial primary key,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  step_index    int not null,
  segment_id    bigint references public.road_segments(id),
  street_name   text,
  instruction   text not null,
  is_spur       boolean not null default false,
  cumulative_m  numeric not null,
  geom          geometry(LineString,4326) not null,
  unique (assignment_id, step_index)
);

create index route_steps_geom_idx    on public.route_steps using gist (geom);
create index route_steps_segment_idx on public.route_steps (segment_id);

comment on table public.route_steps is
  'Stage 5b. One row per leg of a generated route, in walking order. '
  'segment_id is null on transfers (component joins and backtracks). '
  'cumulative_m is metres from the route start to the END of this step, so '
  'assignments.route_length_m = max(cumulative_m). Replaced wholesale by '
  'route_commit; never edited row by row. Instruction vocabulary is fixed: '
  'see docs/ROUTE-DESIGN.md.';

-- ---------------------------------------------------------------------------
-- 2. Stranded-door flag on assignments
-- ---------------------------------------------------------------------------
-- A UPRN more than 40 m from every clipped segment has no honest route
-- position. It is never dropped: it is moved to the END of uprn_snapshot.
-- This count says how many trailing entries that is. 0 when route_geom is
-- null. A count, not a second UPRN array, so it cannot drift from the
-- snapshot.

alter table public.assignments
  add column route_stranded_count integer not null default 0
    check (route_stranded_count >= 0);

comment on column public.assignments.route_stranded_count is
  'Stage 5b. The last route_stranded_count entries of uprn_snapshot lie more '
  'than 40 m from every clipped road segment and have no route position. '
  'They keep route order among themselves. 0 when route_geom is null.';

-- ---------------------------------------------------------------------------
-- 3. RLS on route_steps
-- ---------------------------------------------------------------------------

alter table public.route_steps enable row level security;

revoke all on table public.route_steps from public, anon, authenticated;
-- Admin writes go through route_commit (SECURITY INVOKER), which needs
-- INSERT + DELETE on the table and USAGE on the bigserial sequence. No
-- UPDATE: steps are replaced, never edited.
grant select, insert, delete on table public.route_steps to authenticated;

revoke all on sequence public.route_steps_id_seq from public, anon, authenticated;
grant usage on sequence public.route_steps_id_seq to authenticated;

create policy route_steps_select_admin
  on public.route_steps for select to authenticated
  using ((select public.app_role()) = 'admin');

-- Same shape as "canvasser reads team knocks" (014): a member reads every
-- step of an assignment they are on. Initplan form for auth.uid().
create policy "canvasser reads team route steps"
  on public.route_steps for select to authenticated
  using (
    exists (
      select 1 from public.assignment_members am
      where am.assignment_id = route_steps.assignment_id
        and am.canvasser_id  = (select auth.uid())
    )
  );

create policy route_steps_insert_admin
  on public.route_steps for insert to authenticated
  with check ((select public.app_role()) = 'admin');

create policy route_steps_delete_admin
  on public.route_steps for delete to authenticated
  using ((select public.app_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- 4. Phase 1: the clipped subgraph for an assignment (READ)
-- ---------------------------------------------------------------------------
-- Takes an assignment id, not a raw polygon, so RLS on assignments decides
-- what resolves and the doors come from the FROZEN uprn_snapshot rather than
-- whatever the polygon currently contains. Returns null when the assignment
-- is missing or hidden.
--
-- The 50% rule: keep a segment when at least half of its length_m lies inside
-- the polygon. Length is measured on geography (metres), the same way Stage
-- 1b measured length_m.

create or replace function public.route_clipped_subgraph(p_assignment_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_a      public.assignments%rowtype;
  v_geom   geometry(Polygon, 4326);
  v_ring   geometry;
  v_knocks integer;
  v_out    jsonb;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can generate a route.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  select a.* into v_a
  from public.assignments a
  where a.id = p_assignment_id;

  if not found then
    return null;
  end if;

  select t.geom into v_geom
  from public.territories t
  where t.id = v_a.territory_id;

  if v_geom is null then
    return null;
  end if;

  v_ring := st_exteriorring(v_geom);

  -- Admin RLS on knock_events sees every row, so this is the full count.
  -- route_commit counts again inside the write transaction.
  select count(*) into v_knocks
  from public.knock_events k
  where k.assignment_id = p_assignment_id;

  with clipped as (
    select s.id, s.osm_way_id, s.from_node, s.to_node, s.name, s.highway,
           s.length_m, s.geom
    from public.road_segments s
    where s.geom && v_geom
      and st_length(st_intersection(s.geom, v_geom)::geography)
            >= 0.5 * s.length_m
  )
  select jsonb_build_object(
    'assignment_id',      v_a.id,
    'territory_id',       v_a.territory_id,
    'visit_number',       v_a.visit_number,
    'entry_vertex_index', v_a.entry_vertex_index,
    'sweep_direction',    v_a.sweep_direction,
    'knock_count',        v_knocks,
    'has_route',          v_a.route_geom is not null,
    'snapshot_count',     cardinality(v_a.uprn_snapshot),
    'centroid',           jsonb_build_array(
                            st_x(st_centroid(v_geom)), st_y(st_centroid(v_geom))),
    -- Distinct corners in ring order; ring[i] is st_pointn(ring, i + 1),
    -- the same vertex allocate_prop (009) used for entry_vertex_index.
    'ring', (
      select jsonb_agg(jsonb_build_array(st_x(d.geom), st_y(d.geom))
                       order by d.path[1])
      from st_dumppoints(v_ring) d
      where d.path[1] < st_npoints(v_ring)
    ),
    'nodes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', n.id, 'lon', st_x(n.geom), 'lat', st_y(n.geom))
               order by n.id), '[]'::jsonb)
      from public.road_nodes n
      where n.id in (select c.from_node from clipped c
                     union
                     select c.to_node from clipped c)
    ),
    'segments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id',         c.id,
               'osm_way_id', c.osm_way_id,
               'from_node',  c.from_node,
               'to_node',    c.to_node,
               'name',       c.name,
               'highway',    c.highway,
               'length_m',   c.length_m,
               'coords',     st_asgeojson(c.geom)::jsonb -> 'coordinates')
               order by c.id), '[]'::jsonb)
      from clipped c
    ),
    'doors', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'uprn', p.uprn, 'lon', st_x(p.geom), 'lat', st_y(p.geom))
               order by p.uprn), '[]'::jsonb)
      from public.properties p
      where p.uprn = any(v_a.uprn_snapshot)
    )
  )
  into v_out;

  return v_out;
end;
$$;

comment on function public.route_clipped_subgraph(uuid) is
  'Stage 5b, phase 1. The clipped road subgraph for an assignment: '
  'road_segments with at least half their length_m inside the prop polygon, '
  'their endpoint road_nodes, the frozen snapshot doors with coordinates, '
  'the polygon ring corners, the centroid and the rotation header. Every '
  'array is ordered (id / uprn / ring path). Admin only. SECURITY INVOKER; '
  'null when the assignment is missing or hidden by RLS.';

-- ---------------------------------------------------------------------------
-- 5. Phase 3: commit a generated route (WRITE)
-- ---------------------------------------------------------------------------
-- p_steps: jsonb array of
--   { step_index, segment_id|null, street_name|null, instruction, is_spur,
--     cumulative_m, wkt }            -- wkt is LINESTRING(lon lat, ...)
-- p_snapshot: the reordered uprn_snapshot. Must be the same multiset as the
--   frozen one — every door exactly once, none added, none dropped.
-- p_stranded_count: how many trailing entries of p_snapshot are off-route.
--
-- Refuses when the assignment has any knock_events (the freeze principle).
-- Everything or nothing: a failure anywhere leaves the assignment exactly as
-- allocate_prop made it.

create or replace function public.route_commit(
  p_assignment_id  uuid,
  p_steps          jsonb,
  p_route_wkt      text,
  p_route_length_m numeric,
  p_snapshot       bigint[],
  p_stranded_count integer
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_a          public.assignments%rowtype;
  v_knocks     integer;
  v_old_sorted bigint[];
  v_new_sorted bigint[];
  v_distinct   integer;
  v_route      geometry;
  v_n_steps    integer;
  v_min_index  integer;
  v_max_index  integer;
  v_n_index    integer;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can generate a route.'
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

  -- The freeze principle. Checked here, inside the write transaction, so a
  -- knock that arrives between the read phase and this call still wins.
  select count(*) into v_knocks
  from public.knock_events k
  where k.assignment_id = p_assignment_id;

  if v_knocks > 0 then
    raise exception
      'This assignment has already been worked (% knocks logged). Its door order is frozen.',
      v_knocks
      using hint = 'frozen';
  end if;

  if p_snapshot is null
     or cardinality(p_snapshot) <> cardinality(v_a.uprn_snapshot) then
    raise exception 'The route must order exactly the frozen doors, no more and no fewer.'
      using errcode = '22023', hint = 'snapshot_mismatch';
  end if;

  select array_agg(u order by u) into v_old_sorted from unnest(v_a.uprn_snapshot) u;
  select array_agg(u order by u) into v_new_sorted from unnest(p_snapshot) u;
  select count(distinct u) into v_distinct from unnest(p_snapshot) u;

  if v_old_sorted is distinct from v_new_sorted then
    raise exception 'The route must order exactly the frozen doors, no more and no fewer.'
      using errcode = '22023', hint = 'snapshot_mismatch';
  end if;

  if v_distinct <> cardinality(p_snapshot) then
    raise exception 'A door appears more than once in the route order.'
      using errcode = '22023', hint = 'duplicate_uprn';
  end if;

  if p_stranded_count is null
     or p_stranded_count < 0
     or p_stranded_count > cardinality(p_snapshot) then
    raise exception 'Stranded door count is out of range.'
      using errcode = '22023', hint = 'bad_stranded_count';
  end if;

  if p_route_wkt is null then
    raise exception 'The route has no geometry.'
      using errcode = '22023', hint = 'bad_route';
  end if;

  v_route := st_geomfromtext(p_route_wkt, 4326);

  if v_route is null
     or geometrytype(v_route) <> 'LINESTRING'
     or st_npoints(v_route) < 2
     or not st_isvalid(v_route) then
    raise exception 'The route geometry is not a valid line.'
      using errcode = '22023', hint = 'bad_route';
  end if;

  if p_route_length_m is null or p_route_length_m <= 0 then
    raise exception 'The route has no length.'
      using errcode = '22023', hint = 'bad_route';
  end if;

  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'The route has no steps.'
      using errcode = '22023', hint = 'bad_steps';
  end if;

  select count(*),
         count(distinct (s->>'step_index')::int),
         min((s->>'step_index')::int),
         max((s->>'step_index')::int)
    into v_n_steps, v_n_index, v_min_index, v_max_index
  from jsonb_array_elements(p_steps) s;

  if v_n_steps = 0
     or v_n_index <> v_n_steps
     or v_min_index <> 0
     or v_max_index <> v_n_steps - 1 then
    raise exception 'Route steps must be numbered 0 to n-1 with no gaps.'
      using errcode = '22023', hint = 'bad_steps';
  end if;

  -- Replace, never edit. A re-run on an unworked assignment is idempotent.
  delete from public.route_steps where assignment_id = p_assignment_id;

  insert into public.route_steps (
    assignment_id, step_index, segment_id, street_name, instruction,
    is_spur, cumulative_m, geom
  )
  select
    p_assignment_id,
    (s->>'step_index')::int,
    nullif(s->>'segment_id', '')::bigint,
    nullif(s->>'street_name', ''),
    s->>'instruction',
    coalesce((s->>'is_spur')::boolean, false),
    (s->>'cumulative_m')::numeric,
    st_geomfromtext(s->>'wkt', 4326)
  from jsonb_array_elements(p_steps) s;

  update public.assignments
     set route_geom           = v_route,
         route_length_m       = p_route_length_m,
         uprn_snapshot        = p_snapshot,
         route_stranded_count = p_stranded_count
   where id = p_assignment_id;

  return jsonb_build_object(
    'assignment_id',  p_assignment_id,
    'steps',          v_n_steps,
    'route_length_m', p_route_length_m,
    'doors',          cardinality(p_snapshot),
    'stranded_count', p_stranded_count
  );
end;
$$;

comment on function public.route_commit(uuid, jsonb, text, numeric, bigint[], integer) is
  'Stage 5b, phase 3. Writes a generated route in one transaction: replaces '
  'route_steps, sets assignments.route_geom, route_length_m, the reordered '
  'uprn_snapshot and route_stranded_count. Refuses (hint frozen) when the '
  'assignment has any knock_events. Verifies the new snapshot is the same '
  'multiset as the frozen one. Admin only. SECURITY INVOKER. Raises 22023 '
  'with a hint token for bad input, 42501 for a non-admin caller.';

-- ---------------------------------------------------------------------------
-- 6. Function ACLs — same shape as allocate_prop (009)
-- ---------------------------------------------------------------------------

revoke all on function public.route_clipped_subgraph(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.route_clipped_subgraph(uuid) to authenticated;

revoke all on function public.route_commit(uuid, jsonb, text, numeric, bigint[], integer)
  from public, anon, authenticated, service_role;
grant execute on function public.route_commit(uuid, jsonb, text, numeric, bigint[], integer)
  to authenticated;

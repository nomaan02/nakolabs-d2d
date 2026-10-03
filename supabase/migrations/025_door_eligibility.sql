-- 025_door_eligibility.sql
-- UI-5 Session A1 (2026-10-03). Owner decision H1 (field test, 2026-10-03).
--
-- A door is NOT knockable when:
--   * it is inside a No Cold Calling Zone (is_nccz, loaded 2026-10-03), or
--   * its building holds 3 or more units. "Units" = the larger of:
--       units_at_point   - UPRNs at exactly the same OS Open UPRN point
--       units_at_address - addresses sharing house number (or building name),
--                          street and postcode in property_addresses
--     Two-flat conversions stay knockable. EPC property_type is NOT used.
--
-- ONE definition, in ONE place: properties.is_knockable (generated column).
-- Every read path reads it. No TypeScript copy of the rule may exist.
--
-- Nothing is deleted. Old knocks and old snapshots are untouched.
-- Saved route variants (territory_routes) built before this migration still
-- contain non-knockable doors; allocate_prop now snapshots knockable doors
-- only, so those variants will refuse to freeze ("snapshot_mismatch") until
-- each prop's routes are regenerated (UI-5 Session A2).

-- 1. Columns ---------------------------------------------------------------

alter table public.properties
  add column units_at_point   integer not null default 1,
  add column units_at_address integer not null default 1,
  add column is_multi_unit boolean
    generated always as (greatest(units_at_point, units_at_address) >= 3) stored,
  add column is_knockable boolean
    generated always as (not is_nccz and greatest(units_at_point, units_at_address) < 3) stored;

comment on column public.properties.units_at_point is
  'UI-5 A1. UPRNs sharing this exact OS point. Written only by refresh_door_eligibility().';
comment on column public.properties.units_at_address is
  'UI-5 A1. Addresses sharing house number (or building name), street and postcode. 1 when no address. Written only by refresh_door_eligibility().';
comment on column public.properties.is_multi_unit is
  'UI-5 A1 (owner H1). Building holds 3+ units. Generated.';
comment on column public.properties.is_knockable is
  'UI-5 A1 (owner H1). THE eligibility rule: not NCCZ and not multi-unit. Generated. Every read path uses this column.';

-- 2. Refresh function (ingest only) ----------------------------------------

create or replace function public.refresh_door_eligibility()
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_changed integer;
begin
  with pt as (
    select p.uprn, count(*) over (partition by p.geom)::integer as n
    from public.properties p
  ),
  ak as (
    select a.uprn,
           lower(btrim(coalesce(nullif(btrim(a.house_number), ''), a.building_name))) as k_number,
           lower(btrim(a.street_name)) as k_street,
           upper(replace(a.postcode, ' ', '')) as k_postcode
    from public.property_addresses a
  ),
  ad as (
    select ak.uprn,
           case
             when ak.k_number is null or ak.k_number = ''
               or ak.k_street is null or ak.k_street = ''
               or ak.k_postcode is null or ak.k_postcode = ''
             then 1
             else count(*) over (partition by ak.k_number, ak.k_street, ak.k_postcode)::integer
           end as n
    from ak
  ),
  x as (
    select pt.uprn, pt.n as np, coalesce(ad.n, 1) as na
    from pt
    left join ad on ad.uprn = pt.uprn
  )
  update public.properties p
     set units_at_point   = x.np,
         units_at_address = x.na
    from x
   where p.uprn = x.uprn
     and (p.units_at_point, p.units_at_address) is distinct from (x.np, x.na);

  get diagnostics v_changed = row_count;

  return (
    select jsonb_build_object(
      'changed',    v_changed,
      'total',      count(*),
      'multi_unit', count(*) filter (where p.is_multi_unit),
      'nccz',       count(*) filter (where p.is_nccz),
      'knockable',  count(*) filter (where p.is_knockable)
    )
    from public.properties p
  );
end;
$function$;

comment on function public.refresh_door_eligibility() is
  'UI-5 A1. Recomputes units_at_point / units_at_address for every property. Run after any UPRN or address ingest. Service role only.';

revoke all on function public.refresh_door_eligibility() from public, anon, authenticated;

-- One-off backfill.
select public.refresh_door_eligibility();

-- 3. Read paths switch to is_knockable -------------------------------------

-- 3a. count_knockable: same signature and columns. "excluded" now means
--     "not knockable" (NCCZ or multi-unit).
create or replace function public.count_knockable(poly geometry)
 returns table(total integer, knockable integer, excluded integer)
 language plpgsql
 stable
 set search_path to 'public'
as $function$
begin
  perform public.assert_prop_polygon(poly);

  return query
    select count(*)::int,
           count(*) filter (where p.is_knockable)::int,
           count(*) filter (where not p.is_knockable)::int
    from public.properties p
    where st_within(p.geom, poly);
end;
$function$;

-- 3b. properties_in_polygon: two extra feature properties. Nothing removed.
create or replace function public.properties_in_polygon(poly geometry, cap integer default 3000)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
  doors jsonb;
begin
  perform public.assert_prop_polygon(poly);

  if cap is null or cap < 1 or cap > 10000 then
    raise exception 'The dot limit must be between 1 and 10000.'
      using errcode = '22023',
            hint = 'cap_out_of_range',
            detail = format('Received %s.', coalesce(cap::text, 'null'));
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'type', 'Feature',
               'id', d.uprn,
               'geometry', st_asgeojson(d.geom, 7)::jsonb,
               'properties', jsonb_build_object(
                 'uprn', d.uprn,
                 'is_nccz', d.is_nccz,
                 'is_multi_unit', d.is_multi_unit,
                 'is_knockable', d.is_knockable
               )
             )
             order by d.uprn
           ),
           '[]'::jsonb
         )
  into doors
  from (
    -- Same ST_Within predicate as count_knockable, so an untruncated feature
    -- count equals count_knockable.total. Ordered by uprn so a truncated set
    -- is the same set on every call.
    select p.uprn, p.geom, p.is_nccz, p.is_multi_unit, p.is_knockable
    from public.properties p
    where st_within(p.geom, poly)
    order by p.uprn
    limit cap
  ) d;

  return jsonb_build_object('type', 'FeatureCollection', 'features', doors);
end;
$function$;

-- 3c. route_walk_inputs: route generation sees knockable doors only.
create or replace function public.route_walk_inputs(p_territory_id uuid)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_t    public.territories%rowtype;
  v_ring geometry;
  v_out  jsonb;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can generate a route.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  select t.* into v_t
  from public.territories t
  where t.id = p_territory_id;

  if not found or v_t.geom is null then
    return null;
  end if;

  v_ring := st_exteriorring(v_t.geom);

  with buffer as (
    select s.id, s.osm_way_id, s.from_node, s.to_node, s.name, s.highway,
           s.length_m, s.geom
    from public.road_segments s
    where s.geom && st_expand(v_t.geom, 0.006)
      and st_dwithin(s.geom::geography, v_t.geom::geography, 250)
  )
  select jsonb_build_object(
    'territory_id', v_t.id,
    'name',         v_t.name,
    'buffer_m',     250,
    'centroid',     jsonb_build_array(
                      st_x(st_centroid(v_t.geom)), st_y(st_centroid(v_t.geom))),
    -- Distinct corners in ring order; ring[i] is st_pointn(ring, i + 1).
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
      where n.id in (select b.from_node from buffer b
                     union
                     select b.to_node from buffer b)
    ),
    'segments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id',         b.id,
               'osm_way_id', b.osm_way_id,
               'from_node',  b.from_node,
               'to_node',    b.to_node,
               'name',       b.name,
               'highway',    b.highway,
               'length_m',   b.length_m,
               'coords',     st_asgeojson(b.geom)::jsonb -> 'coordinates')
               order by b.id), '[]'::jsonb)
      from buffer b
    ),
    'doors', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'uprn', p.uprn, 'lon', st_x(p.geom), 'lat', st_y(p.geom))
               order by p.uprn), '[]'::jsonb)
      from public.properties p
      where p.geom && v_t.geom
        and st_within(p.geom, v_t.geom)
        and p.is_knockable
    )
  )
  into v_out;

  return v_out;
end;
$function$;

-- 3d. todays_assignment: each door gets a 'knockable' flag. The snapshot,
--     'sequence' and 'door_count' are UNCHANGED, so today's field client
--     keeps working. Session A2 makes the client hide knockable = false
--     (owner H2). The original sequence index is kept on purpose: it is
--     what knock_events.sequence_position records.
create or replace function public.todays_assignment()
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
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
          'sequence', snap.ord - 1,
          'knockable', p.is_knockable
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
$function$;

-- 3e. allocate_prop: the snapshot takes knockable doors only. Exactly one
--     line changes ("and not p.is_nccz" -> "and p.is_knockable"); the rest
--     of the 021 definition, its comment and its grants are kept. The
--     guard refuses to run if the live body is not the one expected.
do $$
declare
  v_def text;
  v_hits integer;
begin
  v_def := pg_get_functiondef('public.allocate_prop(uuid, date, uuid[])'::regprocedure);
  v_hits := (length(v_def) - length(replace(v_def, 'and not p.is_nccz', '')))
            / length('and not p.is_nccz');
  if v_hits <> 1 then
    raise exception 'allocate_prop: expected exactly one "and not p.is_nccz", found %', v_hits;
  end if;
  execute replace(v_def, 'and not p.is_nccz', 'and p.is_knockable');
end
$$;

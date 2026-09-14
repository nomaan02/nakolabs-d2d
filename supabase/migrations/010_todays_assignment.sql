-- Stage 6: today's assignment for the signed-in canvasser.
--
-- One function, one jsonb document. The field app caches that document in
-- Dexie; it never caches the raw uprn_snapshot array. Header fields plus
-- the snapshot joined to properties.geom, in snapshot order, as a GeoJSON
-- FeatureCollection ready for a MapLibre source.
--
-- "Today" is the calendar date in Europe/London, not the session TimeZone
-- (hosted Postgres is UTC).
--
-- No row when the caller has no assignment_members row for today. That is
-- the honest empty result — the UI shows an empty state, not an error.
--
-- No new table, so no new RLS. SECURITY INVOKER: existing policies on
-- assignments / assignment_members / territories / properties still apply.
-- Canvasser sees only their own, admin sees all rows they would already
-- see (and still only get a payload here if they are a member), office
-- sees none. EXECUTE is granted to authenticated with no app_role() gate
-- in the body — this is a read, and RLS already scopes it.
--
-- Compass direction uses the same centroid → entry-vertex ST_Azimuth as
-- allocate_prop (009). Do not invent a second bearing.

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
  'Stage 6. Today''s assignment for the signed-in canvasser as one jsonb '
  'document: header (visit_number, sweep_direction, slot, door_count, '
  'entry_compass from the Stage 5 centroid→entry-vertex azimuth) plus '
  'uprn_snapshot joined to properties.geom in snapshot order. Returns JSON '
  'null when the caller has no assignment_members row for Europe/London '
  'today. SECURITY INVOKER; EXECUTE for authenticated; no app_role() gate.';

revoke all on function public.todays_assignment()
  from public, anon, authenticated, service_role;
grant execute on function public.todays_assignment() to authenticated;

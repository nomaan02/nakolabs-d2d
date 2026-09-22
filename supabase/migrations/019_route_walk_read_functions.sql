-- Stage 5b, routing pivot (2026-09-22), part R1: the READ for the walking-
-- pattern generator in lib/geo/walk/. Design: docs/ROUTE-DESIGN-v2.md.
--
-- One function, read-only, no table change, no write. Nothing here stores a
-- route; storage and allocation are R2.
--
-- route_walk_inputs(territory) returns, as one jsonb document:
--   * the prop ring (distinct corners in ring order) and centroid,
--   * every road_segments row within 250 m (geography) of the polygon — the
--     BUFFER graph, not a clip. Street selection is door-driven in TypeScript;
--     every other buffer road is available for walking between areas so
--     transfers follow real streets instead of straight lines,
--   * the endpoint road_nodes of those segments,
--   * every knockable door: properties inside the polygon and not in a No
--     Cold Calling Zone — the same definition as count_knockable (005).
-- Every array is ORDER BY id / uprn / ring path. Unordered SQL output is the
-- likeliest source of non-determinism in this stage.
--
-- The 250 m buffer is fixed here on purpose (no parameter): widening it
-- changes which transfers exist and therefore the route, so it has the same
-- "never tune" status as the 40 m snap in TypeScript.
--
-- Spatial filter: the && bbox pre-filter uses road_segments_geom_idx; the
-- geography ST_DWithin is the exact test. road_segments is never read
-- without a spatial filter.
--
-- SECURITY INVOKER: RLS on territories, road_nodes, road_segments and
-- properties governs the reads. Admin only, checked in the body via
-- app_role(), because every logged-in user is the same Postgres role.
-- 012 lesson: revoke defaults from public, anon, authenticated AND
-- service_role explicitly.

create or replace function public.route_walk_inputs(p_territory_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
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
        and not p.is_nccz
    )
  )
  into v_out;

  return v_out;
end;
$$;

comment on function public.route_walk_inputs(uuid) is
  'Stage 5b routing pivot, R1. Inputs for the walking-pattern route generator '
  '(lib/geo/walk/): the prop ring and centroid, every road segment within '
  '250 m of the polygon (the buffer graph, not a clip), their endpoint nodes, '
  'and every knockable door (inside the polygon, not NCCZ). Every array is '
  'ordered (id / uprn / ring path). Read-only; stores nothing. Admin only; '
  'SECURITY INVOKER so RLS governs every read; null when the territory is '
  'missing or hidden.';

revoke all on function public.route_walk_inputs(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.route_walk_inputs(uuid) to authenticated;

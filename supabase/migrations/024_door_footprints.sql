-- UI item 2 (2026-10-01, owner F4): building outlines from OpenStreetMap
-- and per-door slices for colouring buildings by outcome.
-- Reference data: SELECT for authenticated, no write policy. The ingest
-- uses the service role.

create table public.building_footprints (
  osm_id     bigint primary key,
  geom       geometry(Polygon, 4326) not null,
  height_m   real not null,
  building   text,
  fetched_at timestamptz not null default now()
);
create index building_footprints_geom_gist on public.building_footprints using gist (geom);
alter table public.building_footprints enable row level security;
create policy building_footprints_select on public.building_footprints
  for select to authenticated using (true);

create table public.door_footprints (
  uprn              bigint primary key references public.properties(uprn) on delete cascade,
  osm_id            bigint not null references public.building_footprints(osm_id) on delete cascade,
  geom              geometry(MultiPolygon, 4326) not null,
  shared            boolean not null,
  doors_at_position integer not null,
  height_m          real not null,
  computed_at       timestamptz not null default now()
);
create index door_footprints_geom_gist on public.door_footprints using gist (geom);
create index door_footprints_osm_id_idx on public.door_footprints (osm_id);
alter table public.door_footprints enable row level security;
create policy door_footprints_select on public.door_footprints
  for select to authenticated using (true);

-- Ingest upsert, same pattern as upsert_road_nodes / upsert_road_segments.
-- p_rows: [{ "osm_id": 1, "geom": <GeoJSON Polygon>, "height_m": 7, "building": "house" }]
-- Invalid polygons are skipped; the script reports sent minus written.
create or replace function public.upsert_building_footprints(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  n integer;
begin
  insert into public.building_footprints (osm_id, geom, height_m, building, fetched_at)
  select (r->>'osm_id')::bigint,
         ST_SetSRID(ST_GeomFromGeoJSON((r->'geom')::text), 4326),
         (r->>'height_m')::real,
         r->>'building',
         now()
  from jsonb_array_elements(p_rows) as r
  where ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON((r->'geom')::text), 4326))
  on conflict (osm_id) do update
    set geom = excluded.geom,
        height_m = excluded.height_m,
        building = excluded.building,
        fetched_at = excluded.fetched_at;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.upsert_building_footprints(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_building_footprints(jsonb) to service_role;

-- Rebuild the slices for every property inside one territory.
-- A door belongs to the building that contains it, or else the nearest one
-- within 3 m. Doors at the same position (0.5 m grid) share one slice
-- (flats: shared = true). A building with 2+ positions is cut by the
-- Voronoi cells of those positions (terraces). Service role only.
create or replace function public.rebuild_door_footprints(p_territory uuid)
returns integer
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  n integer;
begin
  delete from public.door_footprints df
  using public.properties p, public.territories t
  where t.id = p_territory and df.uprn = p.uprn and ST_Intersects(t.geom, p.geom);

  with doors as (
    select p.uprn, ST_Transform(p.geom, 27700) as g
    from public.properties p
    join public.territories t on t.id = p_territory
    where ST_Intersects(t.geom, p.geom)
  ),
  b as (
    select bf.osm_id, bf.height_m, ST_Transform(bf.geom, 27700) as g
    from public.building_footprints bf
    join public.territories t on t.id = p_territory
    where ST_DWithin(t.geom, bf.geom, 0.001)
  ),
  hit as (
    select d.uprn, d.g, x.osm_id
    from doors d
    cross join lateral (
      select b.osm_id from b
      where ST_DWithin(b.g, d.g, 3)
      order by ST_Distance(b.g, d.g), b.osm_id
      limit 1
    ) x
  ),
  positions as (
    select osm_id, ST_SnapToGrid(g, 0.5) as pos, array_agg(uprn order by uprn) as uprns
    from hit
    group by osm_id, ST_SnapToGrid(g, 0.5)
  ),
  counts as (
    select osm_id, count(*) as npos from positions group by osm_id
  ),
  vor as (
    select p.osm_id,
           (ST_Dump(ST_VoronoiPolygons(ST_Collect(p.pos), 0,
              ST_Expand(ST_Envelope(ST_Collect(p.pos)), 100)))).geom as cell
    from positions p
    join counts c using (osm_id)
    where c.npos > 1
    group by p.osm_id
  ),
  cells as (
    select p.osm_id, p.uprns,
           case when c.npos = 1 then b.g else ST_Intersection(b.g, v.cell) end as geom
    from positions p
    join counts c using (osm_id)
    join b using (osm_id)
    left join vor v on v.osm_id = p.osm_id and c.npos > 1 and ST_Contains(v.cell, p.pos)
  )
  insert into public.door_footprints (uprn, osm_id, geom, shared, doors_at_position, height_m)
  select u.uprn, c.osm_id,
         ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Transform(c.geom, 4326)), 3)),
         cardinality(c.uprns) > 1, cardinality(c.uprns), b.height_m
  from cells c
  join b using (osm_id)
  cross join lateral unnest(c.uprns) as u(uprn)
  where c.geom is not null and not ST_IsEmpty(c.geom);

  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.rebuild_door_footprints(uuid) from public, anon, authenticated;
grant execute on function public.rebuild_door_footprints(uuid) to service_role;

-- The field client's read: one feature per distinct slice for an
-- assignment's doors. RLS on assignments decides who can call it usefully.
-- fid = the uprn for a single-door slice, or -(osm_id * 1000 + n) for a
-- shared one, so promoteId gives a stable feature-state id.
create or replace function public.assignment_door_footprints(p_assignment uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with a as (
    select uprn_snapshot from public.assignments where id = p_assignment
  ),
  slices as (
    select df.osm_id, df.shared, df.height_m, any_value(df.geom) as geom,
           array_agg(df.uprn order by df.uprn) as uprns
    from public.door_footprints df, a
    where df.uprn = any (a.uprn_snapshot)
    group by df.osm_id, df.shared, df.height_m, ST_AsBinary(df.geom)
  ),
  numbered as (
    select s.*, row_number() over (partition by s.osm_id order by s.uprns[1]) as k
    from slices s
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(n.geom, 7)::jsonb,
      'properties', jsonb_build_object(
        'fid', case when n.shared then -(n.osm_id * 1000 + n.k) else n.uprns[1] end,
        'uprn', case when n.shared then null else n.uprns[1] end,
        'shared', n.shared,
        'doors', cardinality(n.uprns),
        'height_m', n.height_m
      )
    )), '[]'::jsonb)
  )
  from numbered n;
$$;
grant execute on function public.assignment_door_footprints(uuid) to authenticated;

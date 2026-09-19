-- Stage 1b: OSM road network. Node/edge topology for Stage 5b traversal.
--
-- An OSM way is a polyline through many nodes; it is NOT a segment.
-- Ingest splits each way at junction nodes (nodes in two or more ways,
-- plus every way's first and last node). Each run between consecutive
-- junctions is one road_segments row whose geom is the full polyline.
--
-- length_m is metres: ST_Length(geom::geography). ST_Length on a 4326
-- geometry returns degrees and would silently poison Stage 5b.
--
-- Reference data, same shape as properties / nccz_zones: SELECT for
-- authenticated, no anon, no write policy. Ingest uses the service role,
-- which bypasses RLS; a write policy would be a false sense of control.
--
-- 012 lesson: revoke defaults from anon and authenticated EXPLICITLY.
-- Revoking from public alone is not enough on Supabase.

create table public.road_nodes (
  id      bigint primary key,          -- OSM node id
  geom    geometry(Point,4326) not null
);
create index road_nodes_geom_idx on public.road_nodes using gist (geom);

create table public.road_segments (
  id           bigserial primary key,
  osm_way_id   bigint not null,
  from_node    bigint not null references public.road_nodes(id),
  to_node      bigint not null references public.road_nodes(id),
  name         text,
  highway      text not null,
  length_m     numeric not null,
  geom         geometry(LineString,4326) not null
);
create index road_segments_geom_idx on public.road_segments using gist (geom);
create index road_segments_nodes_idx on public.road_segments (from_node, to_node);

-- Natural identity of a split segment. Lets ingest upsert rather than
-- duplicate, and lets a later pedestrian/footway pass share the table.
create unique index road_segments_osm_endpoints_uidx
  on public.road_segments (osm_way_id, from_node, to_node);

alter table public.road_nodes    enable row level security;
alter table public.road_segments enable row level security;

revoke all on table public.road_nodes    from public, anon, authenticated;
revoke all on table public.road_segments from public, anon, authenticated;
grant select on table public.road_nodes    to authenticated;
grant select on table public.road_segments to authenticated;

revoke all on sequence public.road_segments_id_seq
  from public, anon, authenticated;

create policy road_nodes_select_authenticated
  on public.road_nodes for select to authenticated
  using (true);

create policy road_segments_select_authenticated
  on public.road_segments for select to authenticated
  using (true);

-- Bulk upsert from ingest-roads.ts. Coordinates must already be EPSG:4326.
create or replace function public.upsert_road_nodes(p_rows jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.road_nodes (id, geom)
  select
    (r->>'id')::bigint,
    st_setsrid(
      st_makepoint((r->>'lon')::double precision, (r->>'lat')::double precision),
      4326
    )
  from jsonb_array_elements(p_rows) as r
  on conflict (id) do update
    set geom = excluded.geom;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- Segment rows carry the full polyline as coords [[lon,lat], ...].
-- length_m is computed here from geography so the client cannot pass degrees.
create or replace function public.upsert_road_segments(p_rows jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.road_segments (
    osm_way_id, from_node, to_node, name, highway, length_m, geom
  )
  select
    (r->>'osm_way_id')::bigint,
    (r->>'from_node')::bigint,
    (r->>'to_node')::bigint,
    nullif(r->>'name', ''),
    r->>'highway',
    st_length(g::geography)::numeric,
    g
  from jsonb_array_elements(p_rows) as r
  cross join lateral (
    select st_setsrid(
      st_makeline(
        array(
          select st_makepoint(
            (c->>0)::double precision,
            (c->>1)::double precision
          )
          from jsonb_array_elements(r->'coords') as c
        )
      ),
      4326
    ) as g
  ) as built
  where g is not null
    and st_npoints(g) >= 2
    and st_length(g::geography) > 0
  on conflict (osm_way_id, from_node, to_node) do update
    set name     = excluded.name,
        highway  = excluded.highway,
        length_m = excluded.length_m,
        geom     = excluded.geom;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.upsert_road_nodes(jsonb)
  from public, anon, authenticated;
revoke all on function public.upsert_road_segments(jsonb)
  from public, anon, authenticated;

grant execute on function public.upsert_road_nodes(jsonb) to service_role;
grant execute on function public.upsert_road_segments(jsonb) to service_role;

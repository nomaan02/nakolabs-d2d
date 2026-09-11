-- Stage 1: address backbone (OS Open UPRN) and NCCZ polygons.
-- is_nccz is flagged at ingest time, not at query time.

create table properties (
  uprn       bigint primary key,
  geom       geometry(Point,4326) not null,
  postcode   text,
  is_nccz    boolean not null default false,
  created_at timestamptz not null default now()
);
create index properties_geom_idx on properties using gist (geom);

create table nccz_zones (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  geom       geometry(Polygon,4326) not null,
  source     text,
  created_at timestamptz not null default now()
);
create index nccz_zones_geom_idx on nccz_zones using gist (geom);

alter table properties enable row level security;
alter table nccz_zones enable row level security;

-- Default deny. Role policies wait until Stage 2 (profiles.role).
-- The ingest scripts use the service role, which bypasses RLS.

-- Bulk upsert from ingest-uprn.ts. Coordinates must already be EPSG:4326.
create or replace function upsert_properties(p_rows jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  insert into properties (uprn, geom, postcode)
  select
    (r->>'uprn')::bigint,
    st_setsrid(
      st_makepoint((r->>'lon')::double precision, (r->>'lat')::double precision),
      4326
    ),
    nullif(r->>'postcode', '')
  from jsonb_array_elements(p_rows) as r
  on conflict (uprn) do update
    set geom = excluded.geom,
        postcode = excluded.postcode;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- Insert one NCCZ polygon. Caller reprojects to 4326 before invoking.
create or replace function insert_nccz_zone(
  p_name text,
  p_geojson jsonb,
  p_source text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_id uuid;
  g geometry;
begin
  g := st_setsrid(st_geomfromgeojson(p_geojson::text), 4326);

  if not st_isvalid(g) then
    g := st_makevalid(g);
  end if;

  if geometrytype(g) is distinct from 'POLYGON' then
    raise exception 'nccz_zones.geom requires Polygon, got %', geometrytype(g);
  end if;

  insert into nccz_zones (name, geom, source)
  values (p_name, g::geometry(Polygon, 4326), p_source)
  returning id into new_id;

  return new_id;
end;
$$;

-- Recompute is_nccz from current nccz_zones. Run at the end of every ingest.
create or replace function apply_nccz_flags()
returns integer
language plpgsql
set search_path = public
as $$
declare
  flagged integer;
begin
  update properties
  set is_nccz = false
  where is_nccz is distinct from false;

  update properties p
  set is_nccz = true
  from nccz_zones z
  where st_covers(z.geom, p.geom);

  select count(*)::integer into flagged from properties where is_nccz;
  return flagged;
end;
$$;

revoke all on function upsert_properties(jsonb) from public;
revoke all on function insert_nccz_zone(text, jsonb, text) from public;
revoke all on function apply_nccz_flags() from public;

grant execute on function upsert_properties(jsonb) to service_role;
grant execute on function insert_nccz_zone(text, jsonb, text) to service_role;
grant execute on function apply_nccz_flags() to service_role;

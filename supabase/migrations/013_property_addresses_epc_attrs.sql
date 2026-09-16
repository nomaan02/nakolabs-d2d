-- Stage 1c follow-up: carry EPC property_type and uprn_source onto
-- property_addresses. Display metadata only — UPRN remains the door identity.
-- Do not denormalise house_number / street_name / building_name / sub_building
-- onto properties, knock_events, leads, or uprn_snapshot.
-- 011 and 012 are applied and must not be edited.

alter table public.property_addresses
  add column if not exists property_type text,
  add column if not exists uprn_source text;

comment on column public.property_addresses.property_type is
  'EPC property_type at ingest (House, Flat, Maisonette, Bungalow, Park home). Display metadata only.';
comment on column public.property_addresses.uprn_source is
  'EPC uprn_source at ingest (Address Matched, Energy Assessor). Not a door identity.';

alter table public.property_addresses enable row level security;

-- Recreate upsert to write the new columns and to let a same-source re-run
-- replace its own rows (a parser fix may lower confidence). A later pass
-- with a different source still cannot overwrite a higher-confidence earlier
-- pass (exact > inferred > spatial_approx > street_only).

create or replace function public.upsert_property_addresses(p_rows jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.property_addresses (
    uprn,
    house_number,
    building_name,
    sub_building,
    street_name,
    postcode,
    source,
    match_confidence,
    property_type,
    uprn_source
  )
  select
    (r->>'uprn')::bigint,
    nullif(r->>'house_number', ''),
    nullif(r->>'building_name', ''),
    nullif(r->>'sub_building', ''),
    nullif(r->>'street_name', ''),
    nullif(r->>'postcode', ''),
    r->>'source',
    r->>'match_confidence',
    nullif(r->>'property_type', ''),
    nullif(r->>'uprn_source', '')
  from jsonb_array_elements(p_rows) as r
  inner join public.properties p
    on p.uprn = (r->>'uprn')::bigint
  on conflict (uprn) do update
    set
      house_number     = excluded.house_number,
      building_name    = excluded.building_name,
      sub_building     = excluded.sub_building,
      street_name      = excluded.street_name,
      postcode         = excluded.postcode,
      source           = excluded.source,
      match_confidence = excluded.match_confidence,
      property_type    = excluded.property_type,
      uprn_source      = excluded.uprn_source,
      updated_at       = now()
    where
      public.property_addresses.source = excluded.source
      or (
        case public.property_addresses.match_confidence
          when 'exact' then 4
          when 'inferred' then 3
          when 'spatial_approx' then 2
          when 'street_only' then 1
          else 0
        end
        <=
        case excluded.match_confidence
          when 'exact' then 4
          when 'inferred' then 3
          when 'spatial_approx' then 2
          when 'street_only' then 1
          else 0
        end
      );

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.upsert_property_addresses(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_property_addresses(jsonb) to service_role;

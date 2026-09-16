-- Stage 1c: address labels. Display text only — UPRN remains the door identity.
-- Never denormalise these columns onto properties, knock_events, leads, or
-- uprn_snapshot. Ingest is server-side on the service role; it does not go
-- through lib/sync/queue.ts (that rule governs field writes only).

create table public.property_addresses (
  uprn             bigint primary key references public.properties(uprn),
  house_number     text,          -- '9', '15', '14A', '14-16'
  building_name    text,          -- 'Creswicke House', 'St. Giles Court'
  sub_building     text,          -- 'Studio C3', 'Flat 1'
  street_name      text,          -- case-normalised
  postcode         text,          -- ONLY populated postcode in the system.
                                  -- properties.postcode exists from Stage 1 and is
                                  -- NULL for every row. Never read it. Do not backfill.
  source           text not null
    check (source in ('epc','osm','linked_ids','land_registry')),
  match_confidence text not null
    check (match_confidence in
           ('exact','inferred','spatial_approx','street_only')),
  updated_at       timestamptz not null default now()
);

create index property_addresses_street_idx
  on public.property_addresses (street_name);
create index property_addresses_postcode_idx
  on public.property_addresses (postcode);

alter table public.property_addresses enable row level security;

revoke all on public.property_addresses from anon, authenticated;
grant select on public.property_addresses to authenticated;

-- Reference data, same shape as properties: SELECT for authenticated, no
-- write policy. Ingest uses the service role, which bypasses RLS.
create policy property_addresses_select_authenticated
  on public.property_addresses for select to authenticated
  using (true);

-- Confidence order: exact > inferred > spatial_approx > street_only.
-- Later ingest passes must not overwrite a higher-confidence earlier pass.
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
    match_confidence
  )
  select
    (r->>'uprn')::bigint,
    nullif(r->>'house_number', ''),
    nullif(r->>'building_name', ''),
    nullif(r->>'sub_building', ''),
    nullif(r->>'street_name', ''),
    nullif(r->>'postcode', ''),
    r->>'source',
    r->>'match_confidence'
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
      updated_at       = now()
    where
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
      end;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- Keyset page of property UPRNs as a single JSON array so PostgREST max-rows
-- cannot truncate it. Service-role ingest only.
create or replace function public.list_property_uprns(
  p_after bigint default 0,
  p_limit integer default 20000
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(q.uprn order by q.uprn), '[]'::jsonb)
  from (
    select p.uprn
    from public.properties p
    where p.uprn > p_after
    order by p.uprn
    limit least(greatest(coalesce(p_limit, 20000), 1), 20000)
  ) q;
$$;

revoke all on function public.upsert_property_addresses(jsonb) from public;
revoke all on function public.list_property_uprns(bigint, integer) from public;

grant execute on function public.upsert_property_addresses(jsonb) to service_role;
grant execute on function public.list_property_uprns(bigint, integer) to service_role;

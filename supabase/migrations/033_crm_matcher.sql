-- 033_crm_matcher.sql
-- CRM-1 Session B (2026-10-10). Owner decisions 2026-10-10: CRM leads are
-- placed on the map door by door where possible; if the exact address is not
-- in our address table, the lead lands between its same-side neighbours
-- ("23 between 21 and 25"), and snaps to a door only when that is safe.
--
--   crm_norm_street(text)  street text -> comparison key (lower case, no
--                          punctuation, common abbreviations expanded).
--   crm_match_batch(jsonb) one call per batch of CRM leads. Input: an array of
--                          {crm_id, postcode, number, suffix, street}. Returns
--                          one row per input: crm_id, uprn, lon, lat, tier.
--                          Reads property_addresses + properties only. Writes
--                          nothing. Service role only.
--   crm_sync_runs.rows_skipped  leads skipped for an unreadable timestamp.
--
-- Tiers, first hit wins:
--   exact          postcode + house number (incl. letter) in property_addresses;
--                  else street + district + house number (postcode typo)
--   snapped        interpolated point whose nearest door is unlabelled, within
--                  10 m, and at least 2 m nearer than the next door (never for
--                  a lettered number such as 23A, which is often a separate door)
--   interpolated   point between the nearest same-side labelled numbers on the
--                  same street and district, gap of 20 numbers or less
--   street_nearest only one side found (within 6 numbers): that neighbour's point
--   outside_area   postcode district not in our address table
--   unmatched      everything else (no postcode, no number, street not found)
--
-- Claude's leave-one-out test on 1,500 real labelled addresses (2026-10-10,
-- SELECT only): 79% interpolate, median error 1.9 m, 90th percentile 12.7 m;
-- with the 10 m / 2 m snap rule 753 snapped, 720 to the right door (96%).

create or replace function public.crm_norm_street(p text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $$
  select nullif(
    trim(regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p, '')), '[.,''’`]', '', 'g'),
        '^st\s+', 'saint ', 'g'),
        '\s+rd$', ' road'),
        '\s+st$', ' street'),
        '\s+ave?$', ' avenue'),
        '\s+cl$', ' close'),
        '\s+cres$', ' crescent'),
        '\s+dr$', ' drive'),
        '\s+gdns$', ' gardens'),
        '\s+(ln)$', ' lane'),
        '\s+(pl)$', ' place'),
        '\s+(terr?)$', ' terrace'),
      '\s+', ' ', 'g')),
    '');
$$;

comment on function public.crm_norm_street(text) is
  'CRM-1 B. Street comparison key for CRM matching. Immutable; used by an index on property_addresses.';

create index if not exists property_addresses_crm_street_idx
  on public.property_addresses (public.crm_norm_street(street_name), split_part(postcode, ' ', 1));

create or replace function public.crm_match_batch(p_rows jsonb)
returns table (crm_id text, uprn bigint, lon double precision, lat double precision, tier text)
language sql
stable
security invoker
set search_path to ''
as $$
  with input as (
    select r.crm_id,
           nullif(upper(trim(r.postcode)), '')                       as postcode,
           split_part(nullif(upper(trim(r.postcode)), ''), ' ', 1)   as district,
           r.number,
           upper(coalesce(r.suffix, ''))                             as suffix,
           public.crm_norm_street(r.street)                          as street
      from jsonb_to_recordset(p_rows)
           as r(crm_id text, postcode text, number int, suffix text, street text)
  ),
  loaded as (
    select distinct split_part(pa.postcode, ' ', 1) as district
      from public.property_addresses pa
     where pa.postcode is not null
  ),
  exact_pc as (
    select i.crm_id,
           (select pa.uprn
              from public.property_addresses pa
             where pa.postcode = i.postcode
               and upper(pa.house_number) = i.number::text || i.suffix
             order by (pa.sub_building is null) desc, pa.uprn
             limit 1) as uprn
      from input i
     where i.postcode is not null and i.number is not null
  ),
  exact_st as (
    select i.crm_id,
           (select pa.uprn
              from public.property_addresses pa
             where public.crm_norm_street(pa.street_name) = i.street
               and split_part(pa.postcode, ' ', 1) = i.district
               and upper(pa.house_number) = i.number::text || i.suffix
             order by (pa.sub_building is null) desc, pa.uprn
             limit 1) as uprn
      from input i
     where i.street is not null and i.number is not null and i.district is not null
  ),
  neighbours as (
    select i.crm_id, i.number,
           lo.n as lo_n, lo.geom as lo_g,
           hi.n as hi_n, hi.geom as hi_g
      from input i
      left join lateral (
        select (case when pa.house_number ~ '^[0-9]{1,4}$' then pa.house_number::int end) as n, p.geom
          from public.property_addresses pa
          join public.properties p on p.uprn = pa.uprn
         where public.crm_norm_street(pa.street_name) = i.street
           and split_part(pa.postcode, ' ', 1) = i.district
           and (case when pa.house_number ~ '^[0-9]{1,4}$' then pa.house_number::int end) < i.number
           and (case when pa.house_number ~ '^[0-9]{1,4}$' then pa.house_number::int end) % 2 = i.number % 2
         order by 1 desc, pa.uprn
         limit 1) lo on true
      left join lateral (
        select (case when pa.house_number ~ '^[0-9]{1,4}$' then pa.house_number::int end) as n, p.geom
          from public.property_addresses pa
          join public.properties p on p.uprn = pa.uprn
         where public.crm_norm_street(pa.street_name) = i.street
           and split_part(pa.postcode, ' ', 1) = i.district
           and (case when pa.house_number ~ '^[0-9]{1,4}$' then pa.house_number::int end) > i.number
           and (case when pa.house_number ~ '^[0-9]{1,4}$' then pa.house_number::int end) % 2 = i.number % 2
         order by 1 asc, pa.uprn
         limit 1) hi on true
     where i.street is not null and i.number is not null and i.district is not null
  ),
  interp as (
    select nb.crm_id,
           public.st_lineinterpolatepoint(
             public.st_makeline(nb.lo_g, nb.hi_g),
             (nb.number - nb.lo_n)::double precision / (nb.hi_n - nb.lo_n)) as pt
      from neighbours nb
     where nb.lo_g is not null and nb.hi_g is not null and nb.hi_n - nb.lo_n <= 20
  ),
  snap as (
    select it.crm_id, it.pt, k.uprns, k.dists, k.labelled
      from interp it
      cross join lateral (
        select array_agg(z.uprn order by z.d) as uprns,
               array_agg(z.d order by z.d) as dists,
               array_agg(z.labelled order by z.d) as labelled
          from (
            select p.uprn,
                   public.st_distance(p.geom::public.geography, it.pt::public.geography) as d,
                   exists (select 1 from public.property_addresses q where q.uprn = p.uprn) as labelled
              from public.properties p
             order by p.geom operator(public.<->) it.pt
             limit 2) z) k
  ),
  one_side as (
    select nb.crm_id,
           case
             when nb.lo_g is not null and (nb.hi_g is null or nb.number - nb.lo_n <= nb.hi_n - nb.number)
                  and nb.number - nb.lo_n <= 6 then nb.lo_g
             when nb.hi_g is not null and nb.hi_n - nb.number <= 6 then nb.hi_g
           end as pt
      from neighbours nb
     where not (nb.lo_g is not null and nb.hi_g is not null and nb.hi_n - nb.lo_n <= 20)
  ),
  decided as (
    select i.crm_id,
           coalesce(e1.uprn, e2.uprn) as exact_uprn,
           s.pt as interp_pt,
           case when s.dists[1] <= 10
                 and i.suffix = ''
                 and not s.labelled[1]
                 and (s.dists[2] is null or s.dists[2] - s.dists[1] >= 2)
                then s.uprns[1] end as snap_uprn,
           o.pt as near_pt,
           (i.district is not null and i.district not in (select l.district from loaded l)) as outside
      from input i
      left join exact_pc e1 on e1.crm_id = i.crm_id
      left join exact_st e2 on e2.crm_id = i.crm_id
      left join snap s on s.crm_id = i.crm_id
      left join one_side o on o.crm_id = i.crm_id
  )
  select d.crm_id,
         coalesce(d.exact_uprn, d.snap_uprn) as uprn,
         public.st_x(coalesce(pe.geom, ps.geom, d.interp_pt, d.near_pt)) as lon,
         public.st_y(coalesce(pe.geom, ps.geom, d.interp_pt, d.near_pt)) as lat,
         case
           when d.exact_uprn is not null then 'exact'
           when d.snap_uprn is not null then 'snapped'
           when d.interp_pt is not null then 'interpolated'
           when d.near_pt is not null then 'street_nearest'
           when d.outside then 'outside_area'
           else 'unmatched'
         end as tier
    from decided d
    left join public.properties pe on pe.uprn = d.exact_uprn
    left join public.properties ps on ps.uprn = d.snap_uprn and d.exact_uprn is null;
$$;

comment on function public.crm_match_batch(jsonb) is
  'CRM-1 B. Places a batch of CRM leads: exact | snapped | interpolated | street_nearest | outside_area | unmatched. Reads only. Service role only.';

alter table public.crm_sync_runs add column if not exists rows_skipped int;
comment on column public.crm_sync_runs.rows_skipped is
  'CRM-1 B. CRM leads skipped because a created/modified time could not be read; the rest of the run carries on.';
comment on table public.crm_sync_runs is
  'CRM-1. One row per CRM pull. A failed run records error and does not move the cursor (max_modified_seen); '
  'rows already written by it are re-checked by the next run, which is idempotent.';

revoke all on function public.crm_match_batch(jsonb) from public, anon, authenticated;
grant execute on function public.crm_match_batch(jsonb) to service_role;

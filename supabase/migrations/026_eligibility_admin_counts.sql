-- 026_eligibility_admin_counts.sql
-- UI-5 Session A3a (2026-10-04). Owner decisions H1, H2 (2026-10-03).
-- Admin numbers follow properties.is_knockable (migration 025):
--   * count_door_eligibility(poly): total / knockable / flats / NCCZ for the
--     draw page. count_knockable is unchanged.
--   * nccz_zones_geojson(): the 26 zone outlines for the draw page.
--   * v_prop_completion: "knockable" and "remaining" count knockable doors
--     only, so a flat is never "left to do".
--   * coverage_map_payload / admin_dashboard: per-prop "knockable" counts
--     knockable doors only. Coverage dots = knockable doors plus any door that
--     already has a knock (history stays visible).
-- No table, no row, no RLS change. Grants are kept by CREATE OR REPLACE.

-- 1. Draw-page breakdown. total = knockable + multi_unit + nccz.
create or replace function public.count_door_eligibility(poly geometry)
 returns table(total integer, knockable integer, multi_unit integer, nccz integer)
 language plpgsql
 stable
 set search_path to 'public'
as $function$
begin
  perform public.assert_prop_polygon(poly);

  return query
    select count(*)::int,
           count(*) filter (where p.is_knockable)::int,
           count(*) filter (where p.is_multi_unit and not p.is_nccz)::int,
           count(*) filter (where p.is_nccz)::int
    from public.properties p
    where st_within(p.geom, poly);
end;
$function$;

comment on function public.count_door_eligibility(geometry) is
  'UI-5 A3a. Doors in a drawn prop: total, knockable, flats (3+ units, outside NCCZ), NCCZ. total = knockable + multi_unit + nccz.';

revoke all on function public.count_door_eligibility(geometry) from public, anon;
grant execute on function public.count_door_eligibility(geometry) to authenticated;

-- 2. Zone outlines (26 rows; nccz_zones already has a SELECT policy for authenticated).
create or replace function public.nccz_zones_geojson()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'geometry', st_asgeojson(z.geom, 6)::jsonb,
        'properties', jsonb_build_object('name', z.name)
      ) order by z.name
    ), '[]'::jsonb)
  )
  from public.nccz_zones z;
$function$;

comment on function public.nccz_zones_geojson() is
  'UI-5 A3a. Every No Cold Calling Zone outline as a GeoJSON FeatureCollection, for admin maps.';

revoke all on function public.nccz_zones_geojson() from public, anon;
grant execute on function public.nccz_zones_geojson() to authenticated;

-- 3. Prop completion: knockable doors only. Same columns, same order, same
--    types as 016. security_invoker kept.
create or replace view public.v_prop_completion
with (security_invoker = true) as
select
  a.id as assignment_id,
  a.territory_id,
  t.name as territory_name,
  a.visit_number,
  a.work_date,
  k.knockable,
  count(ke.uprn)::integer as worked,
  (count(ke.uprn) filter (where ke.outcome <> all (array['no_answer'::text, 'inaccessible'::text])))::integer as answered,
  (k.knockable - (count(ke.uprn) filter (where kp.is_knockable))::integer) as remaining
from public.assignments a
join public.territories t on t.id = a.territory_id
cross join lateral (
  select count(*)::integer as knockable
  from unnest(a.uprn_snapshot) as s(uprn)
  join public.properties sp on sp.uprn = s.uprn
  where sp.is_knockable
) k
left join public.v_latest_knock ke on ke.assignment_id = a.id
left join public.properties kp on kp.uprn = ke.uprn
group by a.id, a.territory_id, t.name, a.visit_number, a.work_date, k.knockable;

-- 4. coverage_map_payload and admin_dashboard: guarded in-place edits of the
--    live bodies (keeps their comments and grants). Each pattern must match
--    exactly the expected number of times, or the migration aborts.
do $$
declare
  v_def text;
  v_new text;
  -- per-prop "knockable": distinct snapshot doors that are knockable
  c_old constant text := 'select distinct unnest\(a\.uprn_snapshot\) as uprn(\s+)from public\.assignments a(\s+)where a\.territory_id = t\.id';
  c_new constant text := 'select distinct u.uprn\1from public.assignments a\1cross join lateral unnest(a.uprn_snapshot) as u(uprn)\1join public.properties kp on kp.uprn = u.uprn and kp.is_knockable\2where a.territory_id = t.id';
  -- coverage dots: knockable, or already knocked
  d_old constant text := 'join public\.properties p on p\.uprn = s\.uprn(\s+)order by s\.uprn, s\.created_at desc';
  d_new constant text := 'join public.properties p on p.uprn = s.uprn\1where p.is_knockable\1   or exists (select 1 from public.knock_events kk where kk.uprn = s.uprn)\1order by s.uprn, s.created_at desc';
begin
  -- coverage_map_payload: 1 knockable count + 1 doors filter
  v_def := pg_get_functiondef('public.coverage_map_payload()'::regprocedure);
  if regexp_count(v_def, c_old) <> 1 or regexp_count(v_def, d_old) <> 1 then
    raise exception 'coverage_map_payload: expected 1 + 1 matches, found % + %',
      regexp_count(v_def, c_old), regexp_count(v_def, d_old);
  end if;
  v_new := regexp_replace(v_def, c_old, c_new);
  v_new := regexp_replace(v_new, d_old, d_new);
  execute v_new;

  -- admin_dashboard: 1 knockable count
  v_def := pg_get_functiondef('public.admin_dashboard(integer)'::regprocedure);
  if regexp_count(v_def, c_old) <> 1 then
    raise exception 'admin_dashboard: expected 1 match, found %', regexp_count(v_def, c_old);
  end if;
  execute regexp_replace(v_def, c_old, c_new);
end
$$;

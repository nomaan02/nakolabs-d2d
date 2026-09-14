-- Stage 4 fix: properties_in_polygon returns one GeoJSON document, not rows.
--
-- Why this migration exists. The row-returning version added in 006 could
-- never honour a cap above 1000: PostgREST's `db-max-rows` is 1000 on this
-- project and it is a hard ceiling, not a default page size — a request with
-- `Range: 0-2999` still came back with 1000 rows and `content-range:
-- 0-999/2353`. So a 2,353-door prop drew 1,000 dots while the count said
-- 2,353, and the only thing standing between that and a silently wrong map was
-- the client noticing the mismatch.
--
-- Two ways out. Raise `db-max-rows` in the project's API settings, which
-- widens the payload ceiling for every table and function in the project and
-- lives in dashboard config that no migration can reproduce. Or return a
-- single value, which the row ceiling does not apply to. This takes the second.
--
-- The document is a FeatureCollection ready for a MapLibre GeoJSON source, so
-- the client does no assembly and no WKB decoding. Coordinates are trimmed to
-- 7 decimal places, about a centimetre, which is well past what a door dot
-- needs and keeps a 3,000-door payload near 250 kB.
--
-- The cap still bounds the drawing, never the counting: count_knockable is the
-- authoritative number and does not truncate. The caller compares the feature
-- count with it and tells the admin when the map is showing fewer.

drop function if exists public.properties_in_polygon(geometry, int);

create function public.properties_in_polygon(
  poly geometry,
  cap  int default 3000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
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
               'properties', jsonb_build_object('uprn', d.uprn, 'is_nccz', d.is_nccz)
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
    select p.uprn, p.geom, p.is_nccz
    from public.properties p
    where st_within(p.geom, poly)
    order by p.uprn
    limit cap
  ) d;

  return jsonb_build_object('type', 'FeatureCollection', 'features', doors);
end;
$$;

comment on function public.properties_in_polygon(geometry, int) is
  'Stage 4. The doors inside a prop as a GeoJSON FeatureCollection for the '
  'admin map, each feature carrying uprn and is_nccz. Truncates at `cap` '
  'features; count_knockable is the authoritative count and never truncates. '
  'Returns jsonb rather than rows because PostgREST caps row-returning '
  'functions at 1000. Admin only, SECURITY INVOKER.';

revoke all on function public.properties_in_polygon(geometry, int)
  from public, anon, authenticated, service_role;
grant execute on function public.properties_in_polygon(geometry, int) to authenticated;

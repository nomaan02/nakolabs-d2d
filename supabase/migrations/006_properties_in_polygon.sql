-- Stage 4: door dots for a drawn prop.
--
-- The admin map draws the doors it just counted. The count still comes only
-- from count_knockable — this function feeds a MapLibre GeoJSON source and is
-- never summed to produce a number, which is why it is allowed to truncate.
--
-- 005 is already applied, so the shared validation is introduced here and
-- count_knockable is replaced to call it. The checks now live in exactly one
-- place: two RPCs that disagree about what a valid prop is would be worse than
-- either of them being wrong.
--
-- Same privilege pattern as 003 and 005: default EXECUTE revoked, then granted
-- only to `authenticated`, with the admin check in the body because every
-- logged-in user shares that one Postgres role. Both functions are SECURITY
-- INVOKER, so `properties` RLS applies to the caller.

-- ---------------------------------------------------------------------------
-- 1. Shared guard
-- ---------------------------------------------------------------------------

-- Raises if the caller is not an admin, or if `poly` is not something a prop
-- can be. SQLSTATE class 22 becomes HTTP 400 through PostgREST and 42501
-- becomes 403, so bad input is never a 500. `hint` is a stable token for the
-- client to switch on; `message` is the British English string shown to the
-- admin.
create or replace function public.assert_prop_polygon(poly geometry)
returns void
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can work with props.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  if poly is null then
    raise exception 'Draw a polygon first.'
      using errcode = '22023', hint = 'missing_polygon';
  end if;

  if geometrytype(poly) is distinct from 'POLYGON' then
    raise exception 'A prop must be a single polygon.'
      using errcode = '22023',
            hint = 'geometry_type',
            detail = format('Received %s.', coalesce(geometrytype(poly), 'no geometry type'));
  end if;

  if st_srid(poly) <> 4326 then
    raise exception 'A prop polygon must use SRID 4326.'
      using errcode = '22023',
            hint = 'srid',
            detail = format('Received SRID %s.', st_srid(poly));
  end if;

  if st_isempty(poly) then
    raise exception 'That polygon is empty.'
      using errcode = '22023', hint = 'empty_polygon';
  end if;

  -- Terra Draw does not guarantee a valid ring, so validate here rather than
  -- trusting the client. A self-intersecting polygon parses as WKT perfectly
  -- well, and ST_Within against one is meaningless at best.
  if not st_isvalid(poly) then
    raise exception 'That polygon crosses itself. Redraw the boundary without crossing lines.'
      using errcode = '22023',
            hint = 'invalid_geometry',
            detail = st_isvalidreason(poly);
  end if;
end;
$$;

comment on function public.assert_prop_polygon(geometry) is
  'Stage 4. Admin-and-geometry guard shared by count_knockable and '
  'properties_in_polygon. Raises 42501 (hint not_admin) or 22023 with a hint '
  'token; returns void when the polygon is usable as a prop.';

revoke all on function public.assert_prop_polygon(geometry)
  from public, anon, authenticated, service_role;
grant execute on function public.assert_prop_polygon(geometry) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. count_knockable, now using the shared guard
-- ---------------------------------------------------------------------------

create or replace function public.count_knockable(poly geometry)
returns table (total int, knockable int, excluded int)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  perform public.assert_prop_polygon(poly);

  return query
    select count(*)::int,
           count(*) filter (where not p.is_nccz)::int,
           count(*) filter (where p.is_nccz)::int
    from public.properties p
    where st_within(p.geom, poly);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. properties_in_polygon — dots for the map
-- ---------------------------------------------------------------------------

-- Longitude and latitude are returned as numbers rather than `geom` because
-- PostgREST serialises a geometry column as hex EWKB, which the client would
-- have to decode before MapLibre could use it. These two columns are the
-- GeoJSON coordinate pair already.
--
-- `cap` bounds the payload, not the prop: a prop over the cap is still a valid
-- prop with a real count, and the UI says how many of the doors it is showing.
-- Ordered by uprn so a truncated set is the same set every time.
create or replace function public.properties_in_polygon(
  poly geometry,
  cap  int default 3000
)
returns table (uprn bigint, lon double precision, lat double precision, is_nccz boolean)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  perform public.assert_prop_polygon(poly);

  if cap is null or cap < 1 or cap > 10000 then
    raise exception 'The dot limit must be between 1 and 10000.'
      using errcode = '22023',
            hint = 'cap_out_of_range',
            detail = format('Received %s.', coalesce(cap::text, 'null'));
  end if;

  return query
    select p.uprn,
           st_x(p.geom)::double precision,
           st_y(p.geom)::double precision,
           p.is_nccz
    from public.properties p
    where st_within(p.geom, poly)
    order by p.uprn
    limit cap;
end;
$$;

comment on function public.properties_in_polygon(geometry, int) is
  'Stage 4. The doors inside a prop, for the admin map''s GeoJSON source. '
  'Truncates at `cap` rows; the authoritative count is count_knockable, which '
  'never truncates. Same ST_Within predicate as the count, so an untruncated '
  'row count equals count_knockable.total. Admin only, SECURITY INVOKER.';

revoke all on function public.properties_in_polygon(geometry, int)
  from public, anon, authenticated, service_role;
grant execute on function public.properties_in_polygon(geometry, int) to authenticated;

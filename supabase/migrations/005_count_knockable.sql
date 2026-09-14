-- Stage 4: knockable door count for a drawn prop polygon.
--
-- Counting happens in Postgres. The client never fetches properties to count
-- them: there are 424,952 rows and a prop is a spatial subset of them.
--
-- No new table, so no new RLS. The function is SECURITY INVOKER on purpose —
-- it reads public.properties as the calling user, so the Stage 2 RLS policy on
-- that table still applies. A SECURITY DEFINER version would silently bypass
-- it and hide a real bug.
--
-- Privilege decision (following 003): the default PUBLIC/EXECUTE grant is
-- revoked and re-granted narrowly. Prop drawing is an admin task, but every
-- logged-in user is the same Postgres role (`authenticated`), so the grant
-- cannot express "admin". EXECUTE goes to `authenticated` and the business
-- role is checked in the body via app_role(). anon, PUBLIC and service_role
-- get nothing: there is no server-side caller in this stage, and a service
-- role call has no auth.uid() to check a role against. A later stage that
-- needs one grants it explicitly in its own migration.
--
-- Errors are structured so the client can show them. SQLSTATE class 22
-- becomes HTTP 400 and 42501 becomes HTTP 403 through PostgREST, so a bad
-- polygon is never a 500. `hint` carries a stable machine-readable token;
-- `message` is the British English string shown to the admin.

create or replace function public.count_knockable(poly geometry)
returns table (total int, knockable int, excluded int)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can count the doors in a prop.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  if poly is null then
    raise exception 'Draw a polygon before counting doors.'
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
  -- well and would otherwise return a meaningless count.
  if not st_isvalid(poly) then
    raise exception 'That polygon crosses itself. Redraw the boundary without crossing lines.'
      using errcode = '22023',
            hint = 'invalid_geometry',
            detail = st_isvalidreason(poly);
  end if;

  return query
    select count(*)::int,
           count(*) filter (where not p.is_nccz)::int,
           count(*) filter (where p.is_nccz)::int
    from public.properties p
    where st_within(p.geom, poly);
end;
$$;

comment on function public.count_knockable(geometry) is
  'Stage 4. Counts UPRNs inside a prop polygon: total, knockable (not in a No '
  'Cold Calling Zone) and excluded (in one). SECURITY INVOKER so properties '
  'RLS applies. Admin only, enforced in the body. Raises SQLSTATE 22023 with '
  'a hint token for bad input and 42501 for a non-admin caller.';

revoke all on function public.count_knockable(geometry)
  from public, anon, authenticated, service_role;
grant execute on function public.count_knockable(geometry) to authenticated;

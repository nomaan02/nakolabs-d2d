-- 027_live_positions.sql
-- UI-7 Session C3a (2026-10-04). Owner decisions H3, H5, U7-1..U7-5.
-- See docs/D2D-Build-Brief.md: invariant 7, Section 8 and Stage 16
-- amendments dated 2026-10-04.
--
-- Live position, CURRENT ONLY:
--   * live_positions: ONE row per canvasser, updated in place. There is no
--     history table and there must never be one. Nulled when the visit
--     closes, when the canvasser leaves it, and when the canvasser taps Stop.
--   * report_position(): the ONLY way a position reaches the database. Writes
--     the partner scalar (assignment_members.route_position_m) and the admin
--     row together, then returns the teammates' scalars.
--   * stop_sharing_position(): nulls both for the caller.
--   * admin_live_positions(): admin-only read for the dashboard panel.
--   * Triggers null both when an assignment closes or a member leaves.
-- No change to any existing table's columns. No change to knock_events.

-- 1. The table ---------------------------------------------------------------
create table public.live_positions (
  canvasser_id  uuid primary key references public.profiles (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete cascade,
  lat           double precision,
  lon           double precision,
  accuracy_m    real,
  heading_deg   real,
  reported_at   timestamptz,
  constraint live_positions_lat_range check (lat is null or lat between -90 and 90),
  constraint live_positions_lon_range check (lon is null or lon between -180 and 180),
  constraint live_positions_heading_range check (heading_deg is null or (heading_deg >= 0 and heading_deg < 360)),
  constraint live_positions_accuracy_range check (accuracy_m is null or accuracy_m >= 0),
  constraint live_positions_all_or_nothing check (
    (lat is null) = (lon is null) and (lat is null) = (reported_at is null)
  )
);

comment on table public.live_positions is
  'UI-7 (owner H5, 2026-10-04). Current position only: one row per canvasser, updated in place, nulled at close / leave / Stop. Never add a history table.';

create index live_positions_assignment_id_idx on public.live_positions (assignment_id);

alter table public.live_positions enable row level security;

-- Admins read every row; a canvasser reads only their own. No write policies:
-- writes go only through the security-definer functions below.
create policy live_positions_select_admin on public.live_positions
  for select to authenticated
  using ((select public.app_role()) = 'admin');

create policy live_positions_select_own on public.live_positions
  for select to authenticated
  using (canvasser_id = (select auth.uid()));

revoke all on public.live_positions from public, anon, authenticated;
grant select on public.live_positions to authenticated;

-- 2. report_position ---------------------------------------------------------
-- Optional arguments default to null so the generated TypeScript marks them
-- optional: the client omits p_route_position_m when off the route.
create or replace function public.report_position(
  p_assignment_id    uuid,
  p_lat              double precision,
  p_lon              double precision,
  p_route_position_m numeric default null,
  p_accuracy_m       real default null,
  p_heading_deg      real default null
)
 returns table (canvasser_id uuid, route_position_m numeric, route_position_at timestamptz)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_len numeric;
begin
  if v_uid is null then
    raise exception 'Sign in to share your position.'
      using errcode = '42501', hint = 'no_session';
  end if;

  select a.route_length_m into v_len
  from public.assignments a
  join public.assignment_members m on m.assignment_id = a.id
  where a.id = p_assignment_id
    and m.canvasser_id = v_uid
    and m.left_at is null
    and a.closed_at is null
    and a.work_date = (now() at time zone 'Europe/London')::date;

  if not found then
    raise exception 'That visit is not open for you today.'
      using errcode = '42501', hint = 'not_on_open_assignment';
  end if;

  if (p_lat is null) <> (p_lon is null) then
    raise exception 'A position needs both latitude and longitude.'
      using errcode = '22023', hint = 'half_position';
  end if;

  if p_route_position_m is not null
     and (p_route_position_m < 0 or (v_len is not null and p_route_position_m > v_len + 100)) then
    raise exception 'That route position is outside this route.'
      using errcode = '22023', hint = 'bad_route_position';
  end if;

  -- Partner scalar (Stage 16). Null means off the route.
  update public.assignment_members m
     set route_position_m  = round(p_route_position_m, 1),
         route_position_at = case when p_route_position_m is null then null else now() end
   where m.assignment_id = p_assignment_id
     and m.canvasser_id = v_uid;

  -- Admin position (H5): one row per canvasser, overwritten. Never appended.
  if p_lat is null then
    update public.live_positions l
       set assignment_id = p_assignment_id,
           lat = null, lon = null, accuracy_m = null, heading_deg = null, reported_at = null
     where l.canvasser_id = v_uid;
  else
    insert into public.live_positions as l
      (canvasser_id, assignment_id, lat, lon, accuracy_m, heading_deg, reported_at)
    values
      (v_uid, p_assignment_id, p_lat, p_lon, p_accuracy_m, p_heading_deg, now())
    on conflict on constraint live_positions_pkey do update
      set assignment_id = excluded.assignment_id,
          lat           = excluded.lat,
          lon           = excluded.lon,
          accuracy_m    = excluded.accuracy_m,
          heading_deg   = excluded.heading_deg,
          reported_at   = excluded.reported_at;
  end if;

  return query
    select m.canvasser_id, m.route_position_m, m.route_position_at
    from public.assignment_members m
    where m.assignment_id = p_assignment_id
      and m.canvasser_id <> v_uid
      and m.left_at is null;
end;
$function$;

comment on function public.report_position(uuid, double precision, double precision, numeric, real, real) is
  'UI-7 C3a. The only way a position reaches the database. Updates the caller''s partner scalar and admin row in place, returns teammates'' scalars. Today''s open visit only.';

revoke all on function public.report_position(uuid, double precision, double precision, numeric, real, real) from public, anon;
grant execute on function public.report_position(uuid, double precision, double precision, numeric, real, real) to authenticated;

-- 3. stop_sharing_position ---------------------------------------------------
create or replace function public.stop_sharing_position(p_assignment_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501', hint = 'no_session';
  end if;

  update public.assignment_members m
     set route_position_m = null, route_position_at = null
   where m.assignment_id = p_assignment_id
     and m.canvasser_id = v_uid;

  update public.live_positions l
     set lat = null, lon = null, accuracy_m = null, heading_deg = null, reported_at = null
   where l.canvasser_id = v_uid;
end;
$function$;

comment on function public.stop_sharing_position(uuid) is
  'UI-7 C3a. Stop: nulls the caller''s partner scalar on this visit and their admin row.';

revoke all on function public.stop_sharing_position(uuid) from public, anon;
grant execute on function public.stop_sharing_position(uuid) to authenticated;

-- 4. admin_live_positions ----------------------------------------------------
create or replace function public.admin_live_positions()
 returns table (
   canvasser_id     uuid,
   first_name       text,
   assignment_id    uuid,
   territory_name   text,
   lat              double precision,
   lon              double precision,
   accuracy_m       real,
   heading_deg      real,
   reported_at      timestamptz,
   route_position_m numeric,
   route_length_m   numeric
 )
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can see live positions.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  return query
    select l.canvasser_id,
           coalesce(nullif(split_part(trim(p.full_name), ' ', 1), ''), 'Canvasser'),
           l.assignment_id,
           t.name,
           l.lat,
           l.lon,
           l.accuracy_m,
           l.heading_deg,
           l.reported_at,
           m.route_position_m,
           a.route_length_m
    from public.live_positions l
    join public.profiles p on p.id = l.canvasser_id
    join public.assignments a on a.id = l.assignment_id
    join public.territories t on t.id = a.territory_id
    left join public.assignment_members m
      on m.assignment_id = l.assignment_id and m.canvasser_id = l.canvasser_id
    where l.reported_at is not null
      and a.closed_at is null
      and a.work_date = (now() at time zone 'Europe/London')::date
    order by l.reported_at desc;
end;
$function$;

comment on function public.admin_live_positions() is
  'UI-7 C3a. Admin only. Today''s open visits: current position per canvasser (first name only), plus the route scalar.';

revoke all on function public.admin_live_positions() from public, anon;
grant execute on function public.admin_live_positions() to authenticated;

-- 5. Cleared at close / leave ------------------------------------------------
create or replace function public.clear_positions_on_close()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update public.assignment_members m
     set route_position_m = null, route_position_at = null
   where m.assignment_id = new.id;

  update public.live_positions l
     set lat = null, lon = null, accuracy_m = null, heading_deg = null, reported_at = null
   where l.assignment_id = new.id;

  return new;
end;
$function$;

create trigger assignments_clear_positions_on_close
  after update of closed_at on public.assignments
  for each row
  when (old.closed_at is null and new.closed_at is not null)
  execute function public.clear_positions_on_close();

create or replace function public.clear_position_on_leave()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  new.route_position_m := null;
  new.route_position_at := null;

  update public.live_positions l
     set lat = null, lon = null, accuracy_m = null, heading_deg = null, reported_at = null
   where l.canvasser_id = new.canvasser_id
     and l.assignment_id = new.assignment_id;

  return new;
end;
$function$;

create trigger assignment_members_clear_position_on_leave
  before update of left_at on public.assignment_members
  for each row
  when (old.left_at is null and new.left_at is not null)
  execute function public.clear_position_on_leave();

revoke all on function public.clear_positions_on_close() from public, anon, authenticated;
revoke all on function public.clear_position_on_leave() from public, anon, authenticated;

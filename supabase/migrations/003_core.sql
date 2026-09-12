-- Stage 2: core schema and RLS.
--
-- Seven tables: profiles, territories, assignments, assignment_members,
-- knock_events, leads, property_observations. RLS enabled on all, default
-- deny, explicit policies per role. SELECT policies added for the two Stage 1
-- tables (properties, nccz_zones) now that authenticated users exist.
--
-- Role model: every logged-in user is the Postgres role `authenticated`.
-- Their business role (admin | office | canvasser) lives in profiles.role and
-- is read through app_role(). RLS decides WHICH ROWS a role may touch;
-- table/column GRANTs decide WHICH COLUMNS. Column restrictions cannot be
-- expressed in RLS, so leads.status is protected by a column grant first and
-- a trigger second.
--
-- Cloud default privileges grant ALL on new public tables to anon,
-- authenticated and service_role. Every table below therefore revokes from
-- anon and authenticated BEFORE granting back the minimum. service_role keeps
-- its default ALL and bypasses RLS; it is server-only.
--
-- Coverage is derived from knock_events. There is no coverage table.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  role       text not null check (role in ('admin','office','canvasser')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.territories (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  geom            geometry(Polygon,4326) not null,
  visit_count     int not null default 0,
  last_visited_at timestamptz,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create index territories_geom_idx on public.territories using gist (geom);

create table public.assignments (
  id                 uuid primary key default gen_random_uuid(),
  territory_id       uuid not null references public.territories(id),
  work_date          date not null,
  visit_number       int  not null,
  entry_vertex_index int  not null,
  sweep_direction    text not null check (sweep_direction in ('cw','ccw')),
  slot               text not null check (slot in ('early','mid','late')),
  uprn_snapshot      bigint[] not null,
  route_geom         geometry(LineString,4326),
  route_length_m     numeric,
  started_at         timestamptz,
  closed_at          timestamptz,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  unique (territory_id, work_date)
);
create index assignments_route_geom_idx on public.assignments using gist (route_geom);
create index assignments_work_date_idx  on public.assignments (work_date);

create table public.assignment_members (
  assignment_id     uuid not null references public.assignments(id) on delete cascade,
  canvasser_id      uuid not null references public.profiles(id),
  route_position_m  numeric,
  route_position_at timestamptz,
  primary key (assignment_id, canvasser_id)
);
create index assignment_members_canvasser_idx on public.assignment_members (canvasser_id);
-- trigger below: reject a fourth member. A team is 1 to 3 canvassers.
-- Teams bunny-hop: everyone works the same side, same route, leapfrogging
-- door to door. There is no side split and no per-canvasser door allocation.
-- See Stage 5b.
-- route_position_m is CURRENT position only. Overwritten, never appended.
-- See Stage 16.

create table public.knock_events (
  id                uuid primary key default gen_random_uuid(),
  client_event_id   text unique not null,
  assignment_id     uuid not null references public.assignments(id),
  canvasser_id      uuid not null references public.profiles(id),
  uprn              bigint not null references public.properties(uprn),
  outcome           text not null check (outcome in
                      ('answered','no_answer','refused','not_interested',
                       'lead','callback','do_not_call','inaccessible')),
  sequence_position int,
  occurred_at       timestamptz not null,
  synced_at         timestamptz not null default now()
);
create index knock_events_assignment_idx on public.knock_events (assignment_id);
create index knock_events_uprn_idx       on public.knock_events (uprn);
create index knock_events_canvasser_idx  on public.knock_events (canvasser_id);

create table public.leads (
  id                 uuid primary key default gen_random_uuid(),
  client_event_id    text unique not null,
  knock_event_id     uuid not null references public.knock_events(id),
  uprn               bigint not null references public.properties(uprn),
  canvasser_id       uuid not null references public.profiles(id),
  booked_for         timestamptz,
  is_immediate       boolean not null default false,
  status             text not null default 'pending'
                       check (status in ('pending','re_app','sale','pm',
                                         'blowout','utc','btc','cancelled')),
  status_set_at      timestamptz,
  status_set_by      uuid references public.profiles(id),
  crm_ref            text unique,
  crm_last_synced_at timestamptz,
  notes              text,
  unique (knock_event_id)
);
create index leads_canvasser_idx on public.leads (canvasser_id);
create index leads_uprn_idx      on public.leads (uprn);
create index leads_status_idx    on public.leads (status);
-- non-terminal statuses: 'pending', 're_app'
comment on column public.leads.client_event_id is
  'Idempotency key generated on device. One door-visit action produces one '
  'client_event_id; when the outcome is lead, the same id is used for the '
  'knock_events row and this leads row. Re-sync is a no-op (Stage 8).';

create table public.property_observations (
  id              uuid primary key default gen_random_uuid(),
  client_event_id text unique not null,
  uprn            bigint not null references public.properties(uprn),
  canvasser_id    uuid not null references public.profiles(id),
  tenure          text check (tenure in ('rented','council','student','owner','unknown')),
  observed_at     timestamptz not null
);
create index property_observations_uprn_idx      on public.property_observations (uprn);
create index property_observations_canvasser_idx on public.property_observations (canvasser_id);

-- ---------------------------------------------------------------------------
-- 2. Helper functions (security definer, execute for authenticated only)
-- ---------------------------------------------------------------------------

-- Business role of the calling user, or null if no active profile.
-- Security definer so policies on profiles can call it without recursion.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.active;
$$;

-- True if the calling user is a member of the given assignment.
-- Security definer breaks the assignments <-> assignment_members policy loop.
create or replace function public.is_assignment_member(a uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assignment_members m
    where m.assignment_id = a
      and m.canvasser_id = auth.uid()
  );
$$;

revoke all on function public.app_role() from public, anon, authenticated;
revoke all on function public.is_assignment_member(uuid) from public, anon, authenticated;
grant execute on function public.app_role() to authenticated;
grant execute on function public.is_assignment_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Trigger functions
-- ---------------------------------------------------------------------------

-- A team is 1 to 3 canvassers. Locks the parent assignment row so two
-- concurrent inserts cannot both pass the count. Security definer so the
-- count sees every member regardless of the caller's RLS view.
create or replace function public.assignment_members_max_three()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform 1 from public.assignments where id = new.assignment_id for update;

  select count(*) into n
  from public.assignment_members
  where assignment_id = new.assignment_id;

  if n >= 3 then
    raise exception 'A team is one to three canvassers'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger assignment_members_max_three
  before insert or update of assignment_id on public.assignment_members
  for each row execute function public.assignment_members_max_three();

-- Backstop for leads.status. The column grant below already stops a
-- canvasser writing status; this trigger holds if a later policy or grant
-- widens by mistake. No-op for service role / postgres (no auth.uid()).
create or replace function public.leads_guard_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.app_role() = 'canvasser' then
    if tg_op = 'INSERT' and new.status <> 'pending' then
      raise exception 'Canvassers cannot set lead status'
        using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      raise exception 'Canvassers cannot change lead status'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger leads_guard_status
  before insert or update of status on public.leads
  for each row execute function public.leads_guard_status();

revoke all on function public.assignment_members_max_three() from public, anon, authenticated;
revoke all on function public.leads_guard_status() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS enable
-- ---------------------------------------------------------------------------

alter table public.profiles              enable row level security;
alter table public.territories           enable row level security;
alter table public.assignments           enable row level security;
alter table public.assignment_members    enable row level security;
alter table public.knock_events          enable row level security;
alter table public.leads                 enable row level security;
alter table public.property_observations enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Grants: revoke defaults first, then grant the minimum
-- ---------------------------------------------------------------------------

-- Stage 1 tables: read for any logged-in user, nothing for anon, no writes
-- from any JWT role (ingest uses service_role).
revoke all on public.properties from anon, authenticated;
revoke all on public.nccz_zones from anon, authenticated;
grant select on public.properties to authenticated;
grant select on public.nccz_zones to authenticated;

revoke all on public.profiles              from anon, authenticated;
revoke all on public.territories           from anon, authenticated;
revoke all on public.assignments           from anon, authenticated;
revoke all on public.assignment_members    from anon, authenticated;
revoke all on public.knock_events          from anon, authenticated;
revoke all on public.leads                 from anon, authenticated;
revoke all on public.property_observations from anon, authenticated;

-- profiles: read only. Writes come from the Stage 3 auth trigger / service role.
grant select on public.profiles to authenticated;

-- territories, assignments, assignment_members: admin writes (row-filtered
-- by RLS), everyone else read as RLS allows.
grant select, insert, update, delete on public.territories        to authenticated;
grant select, insert, update, delete on public.assignments        to authenticated;
grant select, insert, update, delete on public.assignment_members to authenticated;

-- knock_events: immutable event log. Insert and read only.
grant select, insert on public.knock_events to authenticated;

-- leads: canvasser-supplied columns on insert; office-settable columns on
-- update; nothing else. status is NOT insertable, so it takes the default
-- 'pending'. No delete for any JWT role.
grant select on public.leads to authenticated;
grant insert (id, client_event_id, knock_event_id, uprn, canvasser_id,
              booked_for, is_immediate, notes)
  on public.leads to authenticated;
grant update (status, status_set_at, status_set_by, booked_for)
  on public.leads to authenticated;

-- property_observations: insert and read only.
grant select, insert on public.property_observations to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Policies (default deny; only these exist)
-- ---------------------------------------------------------------------------

-- properties / nccz_zones: any logged-in user reads.
create policy properties_select_authenticated
  on public.properties for select to authenticated
  using (true);

create policy nccz_zones_select_authenticated
  on public.nccz_zones for select to authenticated
  using (true);

-- profiles: own row; admin reads all.
create policy profiles_select_own
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_admin
  on public.profiles for select to authenticated
  using ((select public.app_role()) = 'admin');

-- territories: any active profile reads; admin writes.
create policy territories_select_active
  on public.territories for select to authenticated
  using ((select public.app_role()) is not null);

create policy territories_insert_admin
  on public.territories for insert to authenticated
  with check ((select public.app_role()) = 'admin');

create policy territories_update_admin
  on public.territories for update to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy territories_delete_admin
  on public.territories for delete to authenticated
  using ((select public.app_role()) = 'admin');

-- assignments: admin all; canvasser reads assignments they belong to.
create policy assignments_all_admin
  on public.assignments for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy assignments_select_member
  on public.assignments for select to authenticated
  using (public.is_assignment_member(id));

-- assignment_members: admin all; a member reads every row of their own
-- assignment (their teammates too, needed for partner position later).
create policy assignment_members_all_admin
  on public.assignment_members for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy assignment_members_select_member
  on public.assignment_members for select to authenticated
  using (public.is_assignment_member(assignment_id));

-- knock_events: canvasser inserts as themselves against an assignment they
-- belong to; reads own. Admin reads all. No update, no delete.
create policy knock_events_insert_canvasser
  on public.knock_events for insert to authenticated
  with check (
    (select public.app_role()) = 'canvasser'
    and canvasser_id = (select auth.uid())
    and public.is_assignment_member(assignment_id)
  );

create policy knock_events_select_own
  on public.knock_events for select to authenticated
  using (canvasser_id = (select auth.uid()));

create policy knock_events_select_admin
  on public.knock_events for select to authenticated
  using ((select public.app_role()) = 'admin');

-- leads: canvasser inserts as themselves against their own knock event and
-- reads own; office and admin read all; office updates (columns limited by
-- grant above). No delete.
create policy leads_insert_canvasser
  on public.leads for insert to authenticated
  with check (
    (select public.app_role()) = 'canvasser'
    and canvasser_id = (select auth.uid())
    and exists (
      select 1 from public.knock_events k
      where k.id = knock_event_id
        and k.canvasser_id = (select auth.uid())
    )
  );

create policy leads_select_own
  on public.leads for select to authenticated
  using (canvasser_id = (select auth.uid()));

create policy leads_select_office_admin
  on public.leads for select to authenticated
  using ((select public.app_role()) in ('office','admin'));

create policy leads_update_office
  on public.leads for update to authenticated
  using ((select public.app_role()) = 'office')
  with check ((select public.app_role()) = 'office');

-- property_observations: canvasser inserts as themselves; admin reads all.
create policy property_observations_insert_canvasser
  on public.property_observations for insert to authenticated
  with check (
    (select public.app_role()) = 'canvasser'
    and canvasser_id = (select auth.uid())
  );

create policy property_observations_select_admin
  on public.property_observations for select to authenticated
  using ((select public.app_role()) = 'admin');

-- Stage 8a: knock logger schema.
--
-- Pre-flight (recorded in docs/BUILD-LOG.md): knock_events = 0 rows,
-- property_observations = 0 rows. Constraint names read from pg_constraint,
-- not assumed:
--   knock_events_outcome_check
--   property_observations_tenure_check
--
-- No address column is added to properties, knock_events, leads or
-- uprn_snapshot. Address text lives in property_addresses (Stage 1c) and, at
-- the highest confidence tier, in address_observations (this migration).
-- No log_knock_outcome RPC: the Stage 7 queue already sends knock → lead →
-- observation with client-generated row ids and 23505-as-duplicate replay.

-- ---------------------------------------------------------------------------
-- 1. Outcome and tenure values gain 'no_opportunity'
-- ---------------------------------------------------------------------------

alter table public.knock_events drop constraint knock_events_outcome_check;
alter table public.knock_events add constraint knock_events_outcome_check
  check (outcome in (
    'answered','no_answer','refused','not_interested',
    'lead','callback','do_not_call','inaccessible',
    'no_opportunity'
  ));

alter table public.property_observations drop constraint property_observations_tenure_check;
alter table public.property_observations add constraint property_observations_tenure_check
  check (tenure in (
    'rented','council','student','owner','unknown','no_opportunity'
  ));

-- ---------------------------------------------------------------------------
-- 2. Notes on the knock
-- ---------------------------------------------------------------------------

alter table public.knock_events add column notes text;
alter table public.knock_events add constraint knock_events_notes_len
  check (notes is null or length(notes) <= 280);

-- ---------------------------------------------------------------------------
-- 3. Team read policy on knock_events
-- ---------------------------------------------------------------------------
-- Permissive policies combine with OR: this ADDS to knock_events_select_own
-- and knock_events_select_admin (003). A canvasser now reads every knock on
-- an assignment they are a member of, so a duo/trio agrees on which doors
-- are done. Insert policy unchanged: still own canvasser_id only.

create policy "canvasser reads team knocks"
  on public.knock_events for select to authenticated
  using (
    exists (
      select 1 from public.assignment_members am
      where am.assignment_id = knock_events.assignment_id
        and am.canvasser_id  = (select auth.uid())
    )
  );

-- The PK is (assignment_id, canvasser_id). A composite index is only usable
-- when its LEADING column is in the predicate, and the policy above filters
-- on canvasser_id alone. 003_core.sql already created this index; IF NOT
-- EXISTS keeps the migration honest about that rather than failing.
create index if not exists assignment_members_canvasser_idx
  on public.assignment_members (canvasser_id);

-- Latest-wins resolution (v_latest_knock below). Filter columns first, sort
-- column last.
create index knock_events_latest_idx
  on public.knock_events (assignment_id, uprn, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 4. Canvasser-supplied house numbers
-- ---------------------------------------------------------------------------
-- Invariant 3: a number read off a real door outranks all public data.
-- Invariant 5 (second narrowing): the number is typed against an ALREADY
-- SELECTED UPRN. It describes the door; it never selects it.

create table public.address_observations (
  id              uuid primary key default gen_random_uuid(),
  client_event_id text unique not null,
  uprn            bigint not null references public.properties(uprn),
  canvasser_id    uuid not null references public.profiles(id),
  house_number    text not null,
  observed_at     timestamptz not null,
  constraint address_observations_number_len
    check (length(house_number) between 1 and 12)
);

create index address_observations_uprn_idx
  on public.address_observations (uprn, observed_at desc);

alter table public.address_observations enable row level security;

-- Cloud default privileges grant ALL to anon and authenticated on new
-- tables. Revoke first, then grant the minimum: read + insert. No update,
-- no delete — corrections are new rows, newest wins (v_door_label).
revoke all on public.address_observations from anon, authenticated;
grant select, insert on public.address_observations to authenticated;

-- The whole team must see corrections or they will disagree about door
-- numbers, which is why SELECT is open to authenticated rather than scoped.
create policy "authenticated read labels"
  on public.address_observations for select to authenticated
  using (true);

create policy "canvasser writes own observations"
  on public.address_observations for insert to authenticated
  with check (canvasser_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Derived leads.is_immediate
-- ---------------------------------------------------------------------------
-- Never trusted from the client. now() cannot be used — an offline lead syncs
-- hours later — so the knock's occurred_at is the reference day.
-- security definer because the office role may not read knock_events.

create or replace function public.leads_set_is_immediate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_occurred timestamptz;
begin
  if new.booked_for is null then
    new.is_immediate := false;
    return new;
  end if;

  select occurred_at into v_occurred
  from public.knock_events where id = new.knock_event_id;

  -- Europe/London, not UTC. A 23:30 BST booking is tomorrow in UTC and would
  -- silently stop being an immediate.
  new.is_immediate :=
    (new.booked_for at time zone 'Europe/London')::date
      = (coalesce(v_occurred, new.booked_for) at time zone 'Europe/London')::date;

  return new;
end;
$$;

revoke all on function public.leads_set_is_immediate()
  from public, anon, authenticated;

create trigger leads_is_immediate_biu
  before insert or update of booked_for on public.leads
  for each row execute function public.leads_set_is_immediate();

-- ---------------------------------------------------------------------------
-- 6. Views. security_invoker is mandatory.
-- ---------------------------------------------------------------------------
-- A Postgres view runs with its OWNER's privileges by default, which would
-- silently bypass RLS on every table it reads.

-- Latest-wins resolution. Written here, reused by Stage 9. One rule, one place.
create or replace view public.v_latest_knock with (security_invoker = true) as
select distinct on (ke.assignment_id, ke.uprn)
       ke.assignment_id, ke.uprn, ke.outcome, ke.canvasser_id,
       ke.occurred_at, ke.notes
from public.knock_events ke
order by ke.assignment_id, ke.uprn,
         ke.occurred_at desc,   -- latest wins
         ke.synced_at   desc;   -- tie-break: device clocks drift

-- Display label per door. Canvasser observation (newest) beats public data.
-- sub_building is deliberately absent — admin-only, never reaches /field.
create or replace view public.v_door_label with (security_invoker = true) as
select
  p.uprn,
  coalesce(ao.house_number, pa.house_number) as house_number,
  pa.building_name,
  pa.street_name,
  (ao.uprn is not null)                      as canvasser_supplied
from public.properties p
left join public.property_addresses pa on pa.uprn = p.uprn
left join lateral (
  select house_number, uprn
  from public.address_observations
  where uprn = p.uprn
  order by observed_at desc
  limit 1
) ao on true;

-- Default privileges grant SELECT on new views to anon as well. The views
-- are security_invoker so anon would be stopped by the base tables anyway;
-- revoke regardless so the surface is explicit.
revoke all on public.v_latest_knock from anon, authenticated;
revoke all on public.v_door_label   from anon, authenticated;
grant select on public.v_latest_knock to authenticated;
grant select on public.v_door_label   to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Address fetch RPC
-- ---------------------------------------------------------------------------
-- PostgREST puts .in() filters in the query string; 2,000 UPRNs is roughly
-- 20 KB of URL. The client sends an assignment id and never a UPRN list.
-- SECURITY INVOKER: RLS on assignments scopes which assignment ids resolve.

create or replace function public.addresses_for_assignment(p_assignment_id uuid)
returns table (uprn bigint, house_number text, building_name text,
               street_name text)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select dl.uprn, dl.house_number, dl.building_name, dl.street_name
  from public.assignments a
  join public.v_door_label dl on dl.uprn = any(a.uprn_snapshot)
  where a.id = p_assignment_id;
$$;

-- Supabase default privileges grant EXECUTE to anon and authenticated
-- explicitly, so revoking from public alone is not enough (see 012).
revoke all on function public.addresses_for_assignment(uuid)
  from public, anon, authenticated, service_role;
grant  execute on function public.addresses_for_assignment(uuid) to authenticated;

comment on function public.addresses_for_assignment(uuid) is
  'Stage 8a. Display labels (house_number, building_name, street_name) for '
  'every UPRN in an assignment''s uprn_snapshot, resolved through '
  'v_door_label. No sub_building. SECURITY INVOKER; EXECUTE for '
  'authenticated; RLS on assignments decides which ids resolve.';

-- 040_manual_routes.sql
-- RT-1 (owner 2026-10-13): manual route drawing, offered next to the
-- automatic routes. Plan: project doc claude/plan-manual-routes-2026-10-13.md.
--
-- The admin draws the walk door by door. lib/geo/walk/manual.ts turns the
-- drawing into the same WalkVariant document the automatic generator makes,
-- saved as two variants, manual (as drawn) and manual_reversed. Freeze,
-- route_steps, the field walkline and the Logger order are unchanged.
--
--   1. territories.route_mode: 'auto' (default) or 'manual'.
--   2. territory_manual_routes: the drawing itself (chain = drawn order,
--      left_out = doors left out on purpose) and its status. 'ready' when
--      every current door of the prop is in chain or left_out;
--      'needs_finishing' when the shape has new doors (owner O7).
--   3. variant_key checks on territory_routes and assignments accept
--      manual and manual_reversed.
--   4. assignments.uprn_allocated: the doors allocated to the visit.
--      Backfilled from uprn_snapshot; a trigger fills it on insert, so
--      allocate_prop is untouched. Freeze checks against it, so a visit can
--      switch between manual (fewer doors, owner O6) and automatic routes.
--   5. territory_routes_save: body only. Keeps the manual rows.
--   6. territory_manual_route_save(territory, chain, left_out, variants):
--      new. Replaces the manual pair, records the drawing, sets
--      route_mode = 'manual'.
--   7. territory_route_mode_set(territory, mode): new.
--   8. assignment_route_freeze: body only. Default key follows route_mode
--      (manual / manual_reversed by visit parity when the manual route is
--      ready); manual variants may order a subset of the allocated doors.
--
-- Every function is SECURITY INVOKER (RLS governs every read and write).
-- Same signatures for 5 and 8, so create or replace keeps their grants.
-- Owner runs this in the Supabase SQL editor. Data write: section 4
-- backfills uprn_allocated on every existing assignment.

-- ---------------------------------------------------------------------------
-- 1. territories.route_mode
-- ---------------------------------------------------------------------------

alter table public.territories
  add column route_mode text not null default 'auto'
    check (route_mode in ('auto', 'manual'));

comment on column public.territories.route_mode is
  'RT (2026-10-13). auto: visits rotate best / best_reversed. manual: '
  'visits rotate manual / manual_reversed while the manual route is ready; '
  'set by territory_manual_route_save and territory_route_mode_set.';

-- ---------------------------------------------------------------------------
-- 2. territory_manual_routes — the drawing
-- ---------------------------------------------------------------------------

create table public.territory_manual_routes (
  territory_id uuid primary key references public.territories(id) on delete cascade,
  chain        bigint[] not null check (cardinality(chain) >= 1),
  left_out     bigint[] not null default '{}',
  status       text not null check (status in ('ready', 'needs_finishing')),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id)
);

comment on table public.territory_manual_routes is
  'RT (2026-10-13). One manual route per prop, as drawn. chain: UPRNs in '
  'walking order (the manual variant''s door_order). left_out: doors the '
  'admin left out on purpose (never knocked on this prop''s visits). '
  'status: ready, or needs_finishing when the prop has doors in neither '
  'list. Written only through territory_manual_route_save. Admin only.';

alter table public.territory_manual_routes enable row level security;

revoke all on table public.territory_manual_routes from public, anon, authenticated;
grant select, insert, update, delete on table public.territory_manual_routes to authenticated;

create policy territory_manual_routes_select_admin
  on public.territory_manual_routes for select to authenticated
  using ((select public.app_role()) = 'admin');
create policy territory_manual_routes_insert_admin
  on public.territory_manual_routes for insert to authenticated
  with check ((select public.app_role()) = 'admin');
create policy territory_manual_routes_update_admin
  on public.territory_manual_routes for update to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');
create policy territory_manual_routes_delete_admin
  on public.territory_manual_routes for delete to authenticated
  using ((select public.app_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- 3. variant keys: manual and manual_reversed
-- ---------------------------------------------------------------------------

alter table public.territory_routes
  drop constraint territory_routes_variant_key_check;
alter table public.territory_routes
  add constraint territory_routes_variant_key_check
  check (variant_key ~ '^(best|best_reversed|alt_[1-9][0-9]*|manual|manual_reversed)$');

alter table public.assignments
  drop constraint assignments_route_variant_key_check;
alter table public.assignments
  add constraint assignments_route_variant_key_check
  check (route_variant_key ~ '^(best|best_reversed|alt_[1-9][0-9]*|manual|manual_reversed)$');

-- ---------------------------------------------------------------------------
-- 4. assignments.uprn_allocated
-- ---------------------------------------------------------------------------

alter table public.assignments
  add column uprn_allocated bigint[];

comment on column public.assignments.uprn_allocated is
  'RT (2026-10-13). The doors allocated to this visit (allocate_prop''s '
  'snapshot), kept when a manual route shrinks uprn_snapshot. Set on insert '
  'by assignments_fill_uprn_allocated; assignment_route_freeze checks '
  'variants against it.';

update public.assignments
   set uprn_allocated = uprn_snapshot
 where uprn_allocated is null;

create or replace function public.assignments_fill_uprn_allocated()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.uprn_allocated := coalesce(new.uprn_allocated, new.uprn_snapshot);
  return new;
end;
$$;

revoke all on function public.assignments_fill_uprn_allocated()
  from public, anon, authenticated, service_role;

create trigger assignments_fill_uprn_allocated
  before insert on public.assignments
  for each row execute function public.assignments_fill_uprn_allocated();

-- ---------------------------------------------------------------------------
-- 5. territory_routes_save — body only: keeps manual rows
-- ---------------------------------------------------------------------------

create or replace function public.territory_routes_save(
  p_territory_id uuid,
  p_variants     jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_t         public.territories%rowtype;
  v_n         integer;
  v_keys      integer;
  v_v         jsonb;
  v_key       text;
  v_hand      text;
  v_doors     bigint[];
  v_distinct  integer;
  v_stranded  integer;
  v_n_steps   integer;
  v_bad       text;
  v_route_id  uuid;
  v_inserted  integer;
  v_total     integer := 0;
  v_saved     text[]  := '{}';
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can save routes.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  -- Same lock allocate_prop takes: saves serialise with each other and with
  -- allocations of this prop.
  select t.* into v_t
  from public.territories t
  where t.id = p_territory_id
  for update;

  if not found then
    raise exception 'That prop does not exist.'
      using errcode = '22023', hint = 'missing_territory';
  end if;

  if p_variants is null
     or jsonb_typeof(p_variants) <> 'array'
     or jsonb_array_length(p_variants) = 0 then
    raise exception 'There are no route variants to save.'
      using errcode = '22023', hint = 'no_variants';
  end if;

  select count(*), count(distinct v->>'key')
    into v_n, v_keys
  from jsonb_array_elements(p_variants) v;

  if v_keys <> v_n then
    raise exception 'Route variant keys must be unique.'
      using errcode = '22023', hint = 'bad_variant';
  end if;

  if not exists (select 1 from jsonb_array_elements(p_variants) v where v->>'key' = 'best')
     or not exists (select 1 from jsonb_array_elements(p_variants) v where v->>'key' = 'best_reversed') then
    raise exception 'A saved route set needs both best and best_reversed.'
      using errcode = '22023', hint = 'bad_variant';
  end if;

  -- Replace, never edit. The cascade removes the old steps. Assignments
  -- frozen from the old rows keep their copy; only route_source_id nulls.
  -- RT (2026-10-13): a manual route is not part of the automatic set and
  -- survives a regeneration.
  delete from public.territory_routes
  where territory_id = p_territory_id
    and variant_key not in ('manual', 'manual_reversed');

  for v_v in select v from jsonb_array_elements(p_variants) v loop
    v_key  := v_v->>'key';
    v_hand := v_v->>'hand';

    if v_key is null or v_key !~ '^(best|best_reversed|alt_[1-9][0-9]*)$' then
      raise exception 'Route variant key "%" is not recognised.', coalesce(v_key, '')
        using errcode = '22023', hint = 'bad_variant';
    end if;

    if v_hand is null or v_hand not in ('left', 'right') then
      raise exception 'Route variant % has no hand.', v_key
        using errcode = '22023', hint = 'bad_variant';
    end if;

    if jsonb_typeof(v_v->'door_order') is distinct from 'array'
       or jsonb_array_length(v_v->'door_order') = 0 then
      raise exception 'Route variant % has no doors.', v_key
        using errcode = '22023', hint = 'bad_variant';
    end if;

    select array_agg(d.val::bigint order by d.ord), count(distinct d.val)
      into v_doors, v_distinct
    from jsonb_array_elements_text(v_v->'door_order') with ordinality d(val, ord);

    if v_distinct <> cardinality(v_doors) then
      raise exception 'A door appears more than once in route variant %.', v_key
        using errcode = '22023', hint = 'duplicate_uprn';
    end if;

    v_stranded := coalesce((v_v->>'stranded_count')::integer, 0);
    if v_stranded < 0 or v_stranded > cardinality(v_doors) then
      raise exception 'Stranded door count is out of range on route variant %.', v_key
        using errcode = '22023', hint = 'bad_stranded_count';
    end if;

    if jsonb_typeof(v_v->'steps') is distinct from 'array'
       or jsonb_array_length(v_v->'steps') = 0 then
      raise exception 'Route variant % has no steps.', v_key
        using errcode = '22023', hint = 'bad_steps';
    end if;

    -- One validation pass over the steps before any geometry is built, so a
    -- malformed step reports itself instead of a PostGIS parse error.
    select 'step ' || (s.ord - 1)::text || ': ' ||
           case
             when coalesce(s.val->>'kind', '') not in ('work', 'cross', 'walk') then 'kind'
             when coalesce(s.val->>'side', '') not in ('left', 'right') then 'side'
             when coalesce(s.val->>'instruction', '') = '' then 'instruction'
             when jsonb_typeof(s.val->'centreline') is distinct from 'array'
                  or jsonb_array_length(s.val->'centreline') < 2 then 'centreline'
             when jsonb_typeof(s.val->'walkline') is distinct from 'array'
                  or jsonb_array_length(s.val->'walkline') < 2 then 'walkline'
             when (s.val->>'length_m') is null or (s.val->>'length_m')::numeric < 0 then 'length_m'
             when (s.val->>'from_node') is null or (s.val->>'to_node') is null then 'nodes'
             when ((s.val->>'first_seq') is null) <> ((s.val->>'last_seq') is null) then 'door range'
             when (s.val->>'first_seq') is not null
                  and ((s.val->>'first_seq')::integer < 0
                       or (s.val->>'last_seq')::integer >= cardinality(v_doors)
                       or (s.val->>'first_seq')::integer > (s.val->>'last_seq')::integer) then 'door range'
             when (s.val->>'first_seq') is not null and s.val->>'kind' <> 'work' then 'door range off a work step'
           end
      into v_bad
    from jsonb_array_elements(v_v->'steps') with ordinality s(val, ord)
    where coalesce(s.val->>'kind', '') not in ('work', 'cross', 'walk')
       or coalesce(s.val->>'side', '') not in ('left', 'right')
       or coalesce(s.val->>'instruction', '') = ''
       or jsonb_typeof(s.val->'centreline') is distinct from 'array'
       or jsonb_array_length(s.val->'centreline') < 2
       or jsonb_typeof(s.val->'walkline') is distinct from 'array'
       or jsonb_array_length(s.val->'walkline') < 2
       or (s.val->>'length_m') is null
       or (s.val->>'length_m')::numeric < 0
       or (s.val->>'from_node') is null
       or (s.val->>'to_node') is null
       or ((s.val->>'first_seq') is null) <> ((s.val->>'last_seq') is null)
       or ((s.val->>'first_seq') is not null
           and ((s.val->>'first_seq')::integer < 0
                or (s.val->>'last_seq')::integer >= cardinality(v_doors)
                or (s.val->>'first_seq')::integer > (s.val->>'last_seq')::integer
                or s.val->>'kind' <> 'work'))
    order by s.ord
    limit 1;

    if v_bad is not null then
      raise exception 'Route variant % has a malformed step (%).', v_key, v_bad
        using errcode = '22023', hint = 'bad_steps';
    end if;

    insert into public.territory_routes (
      territory_id, variant_key, hand,
      start_node_id, end_node_id, start_geom, end_geom,
      total_m, working_m, non_working_m, return_m, rank_cost_m, end_to_start_m,
      stranded_count, straight_transfers, door_order, warnings, generated_by
    ) values (
      p_territory_id, v_key, v_hand,
      (v_v->'start'->>'node_id')::bigint,
      (v_v->'end'->>'node_id')::bigint,
      st_setsrid(st_makepoint((v_v->'start'->>'lon')::float8, (v_v->'start'->>'lat')::float8), 4326),
      st_setsrid(st_makepoint((v_v->'end'->>'lon')::float8,   (v_v->'end'->>'lat')::float8),   4326),
      (v_v->>'total_m')::numeric,
      (v_v->>'working_m')::numeric,
      (v_v->>'non_working_m')::numeric,
      coalesce((v_v->>'return_m')::numeric, 0),
      (v_v->>'rank_cost_m')::numeric,
      (v_v->>'end_to_start_m')::numeric,
      v_stranded,
      coalesce((v_v->>'straight_transfers')::integer, 0),
      v_doors,
      coalesce(array(select jsonb_array_elements_text(v_v->'warnings')), '{}'::text[]),
      auth.uid()
    )
    returning id into v_route_id;

    insert into public.territory_route_steps (
      route_id, step_index, kind, segment_id, street_name, side,
      from_node, to_node, centreline, walkline,
      first_seq, last_seq, instruction, is_dead_end, length_m
    )
    select
      v_route_id,
      (s.ord - 1)::integer,
      s.val->>'kind',
      nullif(s.val->>'segment_id', '')::bigint,
      nullif(s.val->>'street_name', ''),
      s.val->>'side',
      (s.val->>'from_node')::bigint,
      (s.val->>'to_node')::bigint,
      st_setsrid(st_geomfromgeojson(
        jsonb_build_object('type', 'LineString', 'coordinates', s.val->'centreline')::text), 4326),
      st_setsrid(st_geomfromgeojson(
        jsonb_build_object('type', 'LineString', 'coordinates', s.val->'walkline')::text), 4326),
      nullif(s.val->>'first_seq', '')::integer,
      nullif(s.val->>'last_seq', '')::integer,
      s.val->>'instruction',
      coalesce((s.val->>'is_dead_end')::boolean, false),
      (s.val->>'length_m')::numeric
    from jsonb_array_elements(v_v->'steps') with ordinality s(val, ord);

    get diagnostics v_inserted = row_count;
    v_total := v_total + v_inserted;
    v_saved := v_saved || v_key;
  end loop;

  return jsonb_build_object(
    'territory_id', p_territory_id,
    'variants',     v_n,
    'steps',        v_total,
    'keys',         to_jsonb(v_saved)
  );
end;
$$;

comment on function public.territory_routes_save(uuid, jsonb) is
  'Stage 5b-R2, RT (2026-10-13). Replaces a prop''s automatic variant set in '
  'one transaction: deletes the prop''s territory_routes rows except manual '
  'and manual_reversed (cascading to their steps; frozen assignments keep '
  'their copy and drop only route_source_id), then inserts each variant and '
  'its steps. Requires best and best_reversed; refuses manual keys. Admin '
  'only. SECURITY INVOKER. Raises 22023 with a hint token for bad input, '
  '42501 for a non-admin caller.';

-- ---------------------------------------------------------------------------
-- 6. territory_manual_route_save — the drawing and its two variants
-- ---------------------------------------------------------------------------
-- p_chain: UPRNs in drawn order. p_left_out: UPRNs left out on purpose.
-- p_variants: jsonb array of exactly two WalkVariant documents, keys
--   manual (door_order = p_chain) and manual_reversed (door_order = p_chain
--   reversed), each stranded_count 0. Same document shape as
--   territory_routes_save; the same step checks run on each.
-- Every UPRN in p_chain and p_left_out must be a current knockable door of
-- the prop (route_walk_inputs' set; the client prunes removed doors first).

create or replace function public.territory_manual_route_save(
  p_territory_id uuid,
  p_chain        bigint[],
  p_left_out     bigint[],
  p_variants     jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_t         public.territories%rowtype;
  v_left_out  bigint[] := coalesce(p_left_out, '{}'::bigint[]);
  v_reversed  bigint[];
  v_current   bigint[];
  v_unknown   integer;
  v_new       integer;
  v_status    text;
  v_n         integer;
  v_keys      integer;
  v_v         jsonb;
  v_key       text;
  v_hand      text;
  v_doors     bigint[];
  v_distinct  integer;
  v_stranded  integer;
  v_n_steps   integer;
  v_bad       text;
  v_route_id  uuid;
  v_inserted  integer;
  v_total     integer := 0;
  v_saved     text[]  := '{}';
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can save routes.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  -- Same lock as allocate_prop and territory_routes_save.
  select t.* into v_t
  from public.territories t
  where t.id = p_territory_id
  for update;

  if not found then
    raise exception 'That prop does not exist.'
      using errcode = '22023', hint = 'missing_territory';
  end if;

  if p_chain is null or cardinality(p_chain) = 0 then
    raise exception 'The drawn route has no doors.'
      using errcode = '22023', hint = 'no_doors';
  end if;

  if (select count(distinct u) from unnest(p_chain) u) <> cardinality(p_chain)
     or (select count(distinct u) from unnest(v_left_out) u) <> cardinality(v_left_out) then
    raise exception 'A door appears more than once in the drawing.'
      using errcode = '22023', hint = 'duplicate_uprn';
  end if;

  if p_chain && v_left_out then
    raise exception 'A door cannot be both on the route and left out.'
      using errcode = '22023', hint = 'bad_chain';
  end if;

  -- The prop's doors now: route_walk_inputs' set (025), which is also what
  -- allocate_prop snapshots.
  select coalesce(array_agg(p.uprn order by p.uprn), '{}'::bigint[])
    into v_current
  from public.properties p
  where p.geom && v_t.geom
    and st_within(p.geom, v_t.geom)
    and p.is_knockable;

  select count(*) into v_unknown
  from unnest(p_chain || v_left_out) u
  where not (u = any (v_current));

  if v_unknown > 0 then
    raise exception '% door(s) in the drawing are no longer in this prop. Reload the drawing.', v_unknown
      using errcode = '22023', hint = 'unknown_door';
  end if;

  select count(*) into v_new
  from unnest(v_current) u
  where not (u = any (p_chain || v_left_out));

  v_status := case when v_new = 0 then 'ready' else 'needs_finishing' end;

  select array_agg(u order by ord desc) into v_reversed
  from unnest(p_chain) with ordinality c(u, ord);

  if p_variants is null
     or jsonb_typeof(p_variants) <> 'array'
     or jsonb_array_length(p_variants) <> 2 then
    raise exception 'A manual route is saved as exactly two variants.'
      using errcode = '22023', hint = 'bad_variant';
  end if;

  select count(*), count(distinct v->>'key')
    into v_n, v_keys
  from jsonb_array_elements(p_variants) v;

  if v_keys <> v_n then
    raise exception 'Route variant keys must be unique.'
      using errcode = '22023', hint = 'bad_variant';
  end if;

  -- Replace the manual pair only. Automatic variants are untouched.
  delete from public.territory_routes
  where territory_id = p_territory_id
    and variant_key in ('manual', 'manual_reversed');

  for v_v in select v from jsonb_array_elements(p_variants) v loop
    v_key  := v_v->>'key';
    v_hand := v_v->>'hand';

    if v_key is null or v_key not in ('manual', 'manual_reversed') then
      raise exception 'Route variant key "%" is not a manual route.', coalesce(v_key, '')
        using errcode = '22023', hint = 'bad_variant';
    end if;

    if v_hand is null or v_hand not in ('left', 'right') then
      raise exception 'Route variant % has no hand.', v_key
        using errcode = '22023', hint = 'bad_variant';
    end if;

    if jsonb_typeof(v_v->'door_order') is distinct from 'array'
       or jsonb_array_length(v_v->'door_order') = 0 then
      raise exception 'Route variant % has no doors.', v_key
        using errcode = '22023', hint = 'bad_variant';
    end if;

    select array_agg(d.val::bigint order by d.ord), count(distinct d.val)
      into v_doors, v_distinct
    from jsonb_array_elements_text(v_v->'door_order') with ordinality d(val, ord);

    if v_distinct <> cardinality(v_doors) then
      raise exception 'A door appears more than once in route variant %.', v_key
        using errcode = '22023', hint = 'duplicate_uprn';
    end if;

    -- The drawn order is the door order: manual as drawn, manual_reversed
    -- backwards. Nothing is stranded; doors left out are not on the route.
    if v_doors is distinct from (case when v_key = 'manual' then p_chain else v_reversed end) then
      raise exception 'Route variant % does not follow the drawn order.', v_key
        using errcode = '22023', hint = 'bad_variant';
    end if;

    v_stranded := coalesce((v_v->>'stranded_count')::integer, 0);
    if v_stranded <> 0 then
      raise exception 'A manual route has no stranded doors (route variant %).', v_key
        using errcode = '22023', hint = 'bad_stranded_count';
    end if;

    if jsonb_typeof(v_v->'steps') is distinct from 'array'
       or jsonb_array_length(v_v->'steps') = 0 then
      raise exception 'Route variant % has no steps.', v_key
        using errcode = '22023', hint = 'bad_steps';
    end if;

    -- One validation pass over the steps before any geometry is built, so a
    -- malformed step reports itself instead of a PostGIS parse error.
    select 'step ' || (s.ord - 1)::text || ': ' ||
           case
             when coalesce(s.val->>'kind', '') not in ('work', 'cross', 'walk') then 'kind'
             when coalesce(s.val->>'side', '') not in ('left', 'right') then 'side'
             when coalesce(s.val->>'instruction', '') = '' then 'instruction'
             when jsonb_typeof(s.val->'centreline') is distinct from 'array'
                  or jsonb_array_length(s.val->'centreline') < 2 then 'centreline'
             when jsonb_typeof(s.val->'walkline') is distinct from 'array'
                  or jsonb_array_length(s.val->'walkline') < 2 then 'walkline'
             when (s.val->>'length_m') is null or (s.val->>'length_m')::numeric < 0 then 'length_m'
             when (s.val->>'from_node') is null or (s.val->>'to_node') is null then 'nodes'
             when ((s.val->>'first_seq') is null) <> ((s.val->>'last_seq') is null) then 'door range'
             when (s.val->>'first_seq') is not null
                  and ((s.val->>'first_seq')::integer < 0
                       or (s.val->>'last_seq')::integer >= cardinality(v_doors)
                       or (s.val->>'first_seq')::integer > (s.val->>'last_seq')::integer) then 'door range'
             when (s.val->>'first_seq') is not null and s.val->>'kind' <> 'work' then 'door range off a work step'
           end
      into v_bad
    from jsonb_array_elements(v_v->'steps') with ordinality s(val, ord)
    where coalesce(s.val->>'kind', '') not in ('work', 'cross', 'walk')
       or coalesce(s.val->>'side', '') not in ('left', 'right')
       or coalesce(s.val->>'instruction', '') = ''
       or jsonb_typeof(s.val->'centreline') is distinct from 'array'
       or jsonb_array_length(s.val->'centreline') < 2
       or jsonb_typeof(s.val->'walkline') is distinct from 'array'
       or jsonb_array_length(s.val->'walkline') < 2
       or (s.val->>'length_m') is null
       or (s.val->>'length_m')::numeric < 0
       or (s.val->>'from_node') is null
       or (s.val->>'to_node') is null
       or ((s.val->>'first_seq') is null) <> ((s.val->>'last_seq') is null)
       or ((s.val->>'first_seq') is not null
           and ((s.val->>'first_seq')::integer < 0
                or (s.val->>'last_seq')::integer >= cardinality(v_doors)
                or (s.val->>'first_seq')::integer > (s.val->>'last_seq')::integer
                or s.val->>'kind' <> 'work'))
    order by s.ord
    limit 1;

    if v_bad is not null then
      raise exception 'Route variant % has a malformed step (%).', v_key, v_bad
        using errcode = '22023', hint = 'bad_steps';
    end if;

    insert into public.territory_routes (
      territory_id, variant_key, hand,
      start_node_id, end_node_id, start_geom, end_geom,
      total_m, working_m, non_working_m, return_m, rank_cost_m, end_to_start_m,
      stranded_count, straight_transfers, door_order, warnings, generated_by
    ) values (
      p_territory_id, v_key, v_hand,
      (v_v->'start'->>'node_id')::bigint,
      (v_v->'end'->>'node_id')::bigint,
      st_setsrid(st_makepoint((v_v->'start'->>'lon')::float8, (v_v->'start'->>'lat')::float8), 4326),
      st_setsrid(st_makepoint((v_v->'end'->>'lon')::float8,   (v_v->'end'->>'lat')::float8),   4326),
      (v_v->>'total_m')::numeric,
      (v_v->>'working_m')::numeric,
      (v_v->>'non_working_m')::numeric,
      coalesce((v_v->>'return_m')::numeric, 0),
      (v_v->>'rank_cost_m')::numeric,
      (v_v->>'end_to_start_m')::numeric,
      v_stranded,
      coalesce((v_v->>'straight_transfers')::integer, 0),
      v_doors,
      coalesce(array(select jsonb_array_elements_text(v_v->'warnings')), '{}'::text[]),
      auth.uid()
    )
    returning id into v_route_id;

    insert into public.territory_route_steps (
      route_id, step_index, kind, segment_id, street_name, side,
      from_node, to_node, centreline, walkline,
      first_seq, last_seq, instruction, is_dead_end, length_m
    )
    select
      v_route_id,
      (s.ord - 1)::integer,
      s.val->>'kind',
      nullif(s.val->>'segment_id', '')::bigint,
      nullif(s.val->>'street_name', ''),
      s.val->>'side',
      (s.val->>'from_node')::bigint,
      (s.val->>'to_node')::bigint,
      st_setsrid(st_geomfromgeojson(
        jsonb_build_object('type', 'LineString', 'coordinates', s.val->'centreline')::text), 4326),
      st_setsrid(st_geomfromgeojson(
        jsonb_build_object('type', 'LineString', 'coordinates', s.val->'walkline')::text), 4326),
      nullif(s.val->>'first_seq', '')::integer,
      nullif(s.val->>'last_seq', '')::integer,
      s.val->>'instruction',
      coalesce((s.val->>'is_dead_end')::boolean, false),
      (s.val->>'length_m')::numeric
    from jsonb_array_elements(v_v->'steps') with ordinality s(val, ord);

    get diagnostics v_inserted = row_count;
    v_total := v_total + v_inserted;
    v_saved := v_saved || v_key;
  end loop;

  insert into public.territory_manual_routes as m (
    territory_id, chain, left_out, status, updated_at, updated_by
  ) values (
    p_territory_id, p_chain, v_left_out, v_status, now(), auth.uid()
  )
  on conflict (territory_id) do update
     set chain      = excluded.chain,
         left_out   = excluded.left_out,
         status     = excluded.status,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by;

  update public.territories
     set route_mode = 'manual'
   where id = p_territory_id;

  return jsonb_build_object(
    'territory_id', p_territory_id,
    'status',       v_status,
    'doors',        cardinality(p_chain),
    'left_out',     cardinality(v_left_out),
    'new_doors',    v_new,
    'steps',        v_total,
    'keys',         to_jsonb(v_saved)
  );
end;
$$;

comment on function public.territory_manual_route_save(uuid, bigint[], bigint[], jsonb) is
  'RT (2026-10-13). Saves a prop''s manual route: replaces its manual and '
  'manual_reversed variants (steps checked as territory_routes_save does; '
  'door_order must be the chain and its reverse; nothing stranded), records '
  'the drawing in territory_manual_routes with status ready or '
  'needs_finishing, and sets route_mode = manual. Every UPRN must be a '
  'current knockable door of the prop (hint unknown_door). Admin only. '
  'SECURITY INVOKER. 22023 with a hint token for bad input, 42501 for a '
  'non-admin caller.';

revoke all on function public.territory_manual_route_save(uuid, bigint[], bigint[], jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.territory_manual_route_save(uuid, bigint[], bigint[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. territory_route_mode_set — automatic or manual
-- ---------------------------------------------------------------------------

create or replace function public.territory_route_mode_set(
  p_territory_id uuid,
  p_mode         text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_t       public.territories%rowtype;
  v_status  text;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can change a prop''s routes.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  if p_mode is null or p_mode not in ('auto', 'manual') then
    raise exception 'Route mode "%" is not recognised.', coalesce(p_mode, '')
      using errcode = '22023', hint = 'bad_mode';
  end if;

  select t.* into v_t
  from public.territories t
  where t.id = p_territory_id
  for update;

  if not found then
    raise exception 'That prop does not exist.'
      using errcode = '22023', hint = 'missing_territory';
  end if;

  select m.status into v_status
  from public.territory_manual_routes m
  where m.territory_id = p_territory_id;

  if p_mode = 'manual' and v_status is null then
    raise exception 'This prop has no drawn route yet.'
      using errcode = '22023', hint = 'no_manual_route';
  end if;

  update public.territories
     set route_mode = p_mode
   where id = p_territory_id;

  return jsonb_build_object(
    'territory_id',  p_territory_id,
    'route_mode',    p_mode,
    'manual_status', v_status
  );
end;
$$;

comment on function public.territory_route_mode_set(uuid, text) is
  'RT (2026-10-13). Sets territories.route_mode to auto or manual. manual '
  'needs a drawn route (hint no_manual_route); one that needs finishing is '
  'allowed, and freeze falls back to best / best_reversed until it is '
  'saved again. Does not re-freeze visits. Admin only. SECURITY INVOKER.';

revoke all on function public.territory_route_mode_set(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.territory_route_mode_set(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. assignment_route_freeze — body only: manual keys, allocated door set
-- ---------------------------------------------------------------------------

create or replace function public.assignment_route_freeze(
  p_assignment_id uuid,
  p_variant_key   text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_a          public.assignments%rowtype;
  v_r          public.territory_routes%rowtype;
  v_key        text;
  v_knocks     integer;
  v_old_sorted bigint[];
  v_new_sorted bigint[];
  v_distinct   integer;
  v_n_steps    integer;
  v_min_index  integer;
  v_max_index  integer;
  v_missing    integer;
  v_route      geometry;
  v_length     numeric;
  v_mode       text;
  v_mstatus    text;
  v_allocated  bigint[];
  v_manual     boolean;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can freeze a route.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  select a.* into v_a
  from public.assignments a
  where a.id = p_assignment_id
  for update;

  if not found then
    raise exception 'That assignment does not exist.'
      using errcode = '22023', hint = 'missing_assignment';
  end if;

  -- The freeze principle, inside the write transaction, exactly as
  -- route_commit: a knock that lands before this lock wins.
  select count(*) into v_knocks
  from public.knock_events k
  where k.assignment_id = p_assignment_id;

  if v_knocks > 0 then
    raise exception
      'This assignment has already been worked (% knocks logged). Its door order is frozen.',
      v_knocks
      using hint = 'frozen';
  end if;

  -- Rotation by variant (brief, Stage 5 note 2026-09-22): odd visits walk
  -- best, even visits walk it backwards. An explicit key overrides.
  -- RT (owner 2026-10-13): a prop in manual mode with a finished manual
  -- route rotates manual / manual_reversed the same way. A manual route
  -- that needs finishing (the shape changed) falls back to best /
  -- best_reversed until the admin saves it again.
  select t.route_mode, m.status
    into v_mode, v_mstatus
  from public.territories t
  left join public.territory_manual_routes m on m.territory_id = t.id
  where t.id = v_a.territory_id;

  v_key := coalesce(
    nullif(btrim(p_variant_key), ''),
    case
      when v_mode = 'manual' and v_mstatus = 'ready' then
        case when v_a.visit_number % 2 = 1 then 'manual' else 'manual_reversed' end
      when v_a.visit_number % 2 = 1 then 'best'
      else 'best_reversed'
    end
  );

  if v_key !~ '^(best|best_reversed|alt_[1-9][0-9]*|manual|manual_reversed)$' then
    raise exception 'Route variant "%" is not recognised.', v_key
      using errcode = '22023', hint = 'bad_variant';
  end if;

  select r.* into v_r
  from public.territory_routes r
  where r.territory_id = v_a.territory_id
    and r.variant_key  = v_key;

  if not found then
    raise exception 'No saved route "%" exists for this prop. Generate and save its routes first.', v_key
      using errcode = '22023', hint = 'missing_variant';
  end if;

  -- Door set (RT, owner 2026-10-13). Checked against the doors allocated
  -- to the visit (uprn_allocated), not uprn_snapshot, which a manual route
  -- shrinks. Automatic variants order exactly the allocated doors. Manual
  -- variants order a subset of them: doors left out on purpose are not on
  -- the visit at all.
  v_allocated := coalesce(v_a.uprn_allocated, v_a.uprn_snapshot);
  v_manual := v_key in ('manual', 'manual_reversed');

  if v_r.door_order is null or cardinality(v_r.door_order) = 0 then
    raise exception 'The route has no doors.'
      using errcode = '22023', hint = 'snapshot_mismatch';
  end if;

  select count(distinct u) into v_distinct from unnest(v_r.door_order) u;

  if v_manual then
    if not (v_r.door_order <@ v_allocated) then
      raise exception 'The drawn route has doors this visit was not allocated. Save the route again, then re-freeze.'
        using errcode = '22023', hint = 'snapshot_mismatch';
    end if;
  else
    if cardinality(v_r.door_order) <> cardinality(v_allocated) then
      raise exception 'The route must order exactly the frozen doors, no more and no fewer.'
        using errcode = '22023', hint = 'snapshot_mismatch';
    end if;

    select array_agg(u order by u) into v_old_sorted from unnest(v_allocated) u;
    select array_agg(u order by u) into v_new_sorted from unnest(v_r.door_order) u;

    if v_old_sorted is distinct from v_new_sorted then
      raise exception 'The route must order exactly the frozen doors, no more and no fewer.'
        using errcode = '22023', hint = 'snapshot_mismatch';
    end if;
  end if;

  if v_distinct <> cardinality(v_r.door_order) then
    raise exception 'A door appears more than once in the route order.'
      using errcode = '22023', hint = 'duplicate_uprn';
  end if;

  if v_r.stranded_count < 0 or v_r.stranded_count > cardinality(v_r.door_order) then
    raise exception 'Stranded door count is out of range.'
      using errcode = '22023', hint = 'bad_stranded_count';
  end if;

  select count(*), min(s.step_index), max(s.step_index)
    into v_n_steps, v_min_index, v_max_index
  from public.territory_route_steps s
  where s.route_id = v_r.id;

  if v_n_steps = 0
     or v_min_index <> 0
     or v_max_index <> v_n_steps - 1 then
    raise exception 'Route steps must be numbered 0 to n-1 with no gaps.'
      using errcode = '22023', hint = 'bad_steps';
  end if;

  -- route_steps.segment_id has a foreign key; territory_route_steps does
  -- not. Refuse a variant whose roads have been re-ingested since it was
  -- saved rather than letting the copy fail half-way with a raw FK error.
  select count(*) into v_missing
  from public.territory_route_steps s
  where s.route_id = v_r.id
    and s.segment_id is not null
    and not exists (select 1 from public.road_segments g where g.id = s.segment_id);

  if v_missing > 0 then
    raise exception
      'This saved route refers to % road segments that no longer exist. Regenerate the prop''s routes.',
      v_missing
      using errcode = '22023', hint = 'stale_variant';
  end if;

  -- One line through every centreline point in walking order. Kinds and
  -- sides live on the steps; this is what the 5b-b field cache draws and
  -- what makes "route-derived" true for the assignment.
  select st_removerepeatedpoints(st_makeline(array_agg(d.geom order by s.step_index, d.path[1])))
    into v_route
  from public.territory_route_steps s
  cross join lateral st_dumppoints(s.centreline) d
  where s.route_id = v_r.id;

  select sum(s.length_m) into v_length
  from public.territory_route_steps s
  where s.route_id = v_r.id;

  if v_route is null
     or geometrytype(v_route) <> 'LINESTRING'
     or st_npoints(v_route) < 2 then
    raise exception 'The route geometry is not a valid line.'
      using errcode = '22023', hint = 'bad_route';
  end if;

  if v_length is null or v_length <= 0 then
    raise exception 'The route has no length.'
      using errcode = '22023', hint = 'bad_route';
  end if;

  -- Replace, never edit. A re-freeze on an unworked assignment is idempotent
  -- for the same key and a clean swap for a different one.
  delete from public.route_steps where assignment_id = p_assignment_id;

  insert into public.route_steps (
    assignment_id, step_index, segment_id, street_name, instruction,
    is_spur, cumulative_m, geom,
    kind, side, walk_geom, first_seq, last_seq, is_dead_end
  )
  select
    p_assignment_id,
    s.step_index,
    s.segment_id,
    s.street_name,
    s.instruction,
    (s.kind = 'work' and s.is_dead_end),
    sum(s.length_m) over (order by s.step_index
                          rows between unbounded preceding and current row),
    s.centreline,
    s.kind,
    s.side,
    s.walkline,
    s.first_seq,
    s.last_seq,
    s.is_dead_end
  from public.territory_route_steps s
  where s.route_id = v_r.id;

  update public.assignments
     set route_geom           = v_route,
         route_length_m       = v_length,
         uprn_snapshot        = v_r.door_order,
         uprn_allocated       = v_allocated,
         route_stranded_count = v_r.stranded_count,
         route_variant_key    = v_key,
         route_source_id      = v_r.id
   where id = p_assignment_id;

  return jsonb_build_object(
    'assignment_id',  p_assignment_id,
    'variant_key',    v_key,
    'hand',           v_r.hand,
    'route_id',       v_r.id,
    'steps',          v_n_steps,
    'route_length_m', v_length,
    'doors',          cardinality(v_r.door_order),
    'stranded_count', v_r.stranded_count
  );
end;
$$;

comment on function public.assignment_route_freeze(uuid, text) is
  'Stage 5b-R2, RT (2026-10-13). Copies one saved variant of the '
  'assignment''s prop onto the assignment in one transaction: replaces '
  'route_steps, sets route_geom, route_length_m, uprn_snapshot (the '
  'variant''s door_order), uprn_allocated, route_stranded_count, '
  'route_variant_key and route_source_id. Refuses (hint frozen) when the '
  'assignment has any knock_events. Automatic variants must order exactly '
  'the allocated doors; manual variants a subset of them (hint '
  'snapshot_mismatch). Refuses a variant whose road segments no longer exist '
  '(hint stale_variant). variant_key null: a manual prop with a ready manual '
  'route takes manual on odd visit_number, manual_reversed on even; '
  'otherwise best / best_reversed. Admin only. SECURITY INVOKER. 22023 with '
  'a hint token for bad input, 42501 for a non-admin caller.';

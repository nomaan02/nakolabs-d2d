-- Stage 5b, routing pivot (2026-09-22), part R2: route storage, freeze on
-- allocation, visit numbering from history.
--
-- Design: docs/ROUTE-DESIGN-v2.md (g.3, g.4) and the brief's 2026-09-22
-- notes under Stages 5 and 5b. R1 (migration 019, lib/geo/walk/) produces
-- WalkVariant documents and stores nothing. This migration stores them.
--
--   1. territory_routes / territory_route_steps — every variant the
--      generator produces for a PROP (best, best_reversed, alt_1..K) and its
--      steps. Saved from the prop; regenerable; admin only.
--   2. route_steps gains the per-step facts of the new shape: kind, side,
--      walk_geom, first_seq, last_seq, is_dead_end. is_spur and geom STAY:
--      the 5b-a rows frozen on Bishopston / Clifton / Southville /
--      Northville / redland still read them. New rows derive
--      is_spur = (kind = 'work' and is_dead_end) and keep cumulative_m as
--      the running sum of length_m, so every existing reader keeps working.
--   3. assignments gains route_variant_key and route_source_id, both
--      nullable: 5b-a assignments keep neither.
--   4. territory_routes_save(territory, variants) — delete-and-replace a
--      prop's whole variant set in one transaction.
--   5. assignment_route_freeze(assignment, variant_key) — copies one saved
--      variant onto an assignment. Same discipline as route_commit (018):
--      admin only, row lock, refuses any assignment with knock_events,
--      door-set equality against the frozen uprn_snapshot, delete-then-
--      insert into route_steps, one transaction. variant_key omitted →
--      by visit_number parity: odd → best, even → best_reversed.
--   6. allocate_prop: visit_number = 1 + the prop's existing assignments,
--      counted inside the existing territories row lock. Nothing ever
--      incremented territories.visit_count (redland: two live allocations,
--      both visit 1), and that column keeps its Stage 12b meaning — closed
--      visits — which is a different quantity.
--   7. route_steps: office SELECT, which was missing. Target shape is admin
--      write, office read, canvasser own-assignment read.
--
-- Nothing here reads or writes migration 018's functions. route_commit and
-- route_clipped_subgraph are left as they are.
--
-- Every function is SECURITY INVOKER: RLS governs every read and write, and
-- nothing runs as the service role. 012 lesson: revoke defaults from public,
-- anon, authenticated AND service_role explicitly.

-- ---------------------------------------------------------------------------
-- 1. territory_routes — one row per prop per variant
-- ---------------------------------------------------------------------------

create table public.territory_routes (
  id                 uuid primary key default gen_random_uuid(),
  territory_id       uuid not null references public.territories(id) on delete cascade,
  variant_key        text not null
                     check (variant_key ~ '^(best|best_reversed|alt_[1-9][0-9]*)$'),
  hand               text not null check (hand in ('left', 'right')),
  start_node_id      bigint not null,
  end_node_id        bigint not null,
  start_geom         geometry(Point, 4326) not null,
  end_geom           geometry(Point, 4326) not null,
  total_m            numeric not null check (total_m >= 0),
  working_m          numeric not null check (working_m >= 0),
  non_working_m      numeric not null check (non_working_m >= 0),
  return_m           numeric not null default 0 check (return_m >= 0),
  rank_cost_m        numeric not null check (rank_cost_m >= 0),
  end_to_start_m     numeric not null check (end_to_start_m >= 0),
  stranded_count     integer not null check (stranded_count >= 0),
  straight_transfers integer not null default 0 check (straight_transfers >= 0),
  door_order         bigint[] not null,
  warnings           text[] not null default '{}',
  generated_by       uuid references public.profiles(id),
  generated_at       timestamptz not null default now(),
  unique (territory_id, variant_key)
);

-- The unique index leads with territory_id and serves the join; GiST on
-- every geometry column per the database rules.
create index territory_routes_start_geom_idx on public.territory_routes using gist (start_geom);
create index territory_routes_end_geom_idx   on public.territory_routes using gist (end_geom);

comment on table public.territory_routes is
  'Stage 5b-R2. One saved route variant of a prop (best, best_reversed, '
  'alt_1..K), as produced by lib/geo/walk/. Belongs to the PROP: '
  'regenerable, previewed from the draw page, and COPIED onto an assignment '
  'by assignment_route_freeze, where it freezes. Replaced wholesale by '
  'territory_routes_save; never edited row by row. door_order is every '
  'knockable UPRN exactly once; the last stranded_count are off-route.';

comment on column public.territory_routes.rank_cost_m is
  'What ranked the candidate: every non-working metre including the return '
  'leg. Geometric only. Never pace, doors per hour or knock_events.';

-- ---------------------------------------------------------------------------
-- 2. territory_route_steps — the steps of one variant, in walking order
-- ---------------------------------------------------------------------------

create table public.territory_route_steps (
  id           bigserial primary key,
  route_id     uuid not null references public.territory_routes(id) on delete cascade,
  step_index   integer not null check (step_index >= 0),
  kind         text not null check (kind in ('work', 'cross', 'walk')),
  -- road_segments.id. Deliberately NO foreign key: a prop's variants are
  -- regenerable, and a road re-ingest must not be blocked by them the way
  -- route_steps_segment_id_fkey already blocks it (Stage 1b patch, 177 ways
  -- left in place). assignment_route_freeze checks the ids still exist
  -- before copying, and refuses a stale variant.
  segment_id   bigint,
  street_name  text,
  side         text not null check (side in ('left', 'right')),
  from_node    bigint not null,
  to_node      bigint not null,
  centreline   geometry(LineString, 4326) not null,
  walkline     geometry(LineString, 4326) not null,
  first_seq    integer check (first_seq >= 0),
  last_seq     integer check (last_seq >= 0),
  instruction  text not null,
  is_dead_end  boolean not null default false,
  length_m     numeric not null check (length_m >= 0),
  unique (route_id, step_index),
  check ((first_seq is null) = (last_seq is null)),
  check (first_seq is null or first_seq <= last_seq),
  check (kind = 'work' or first_seq is null)
);

create index territory_route_steps_segment_idx    on public.territory_route_steps (segment_id);
create index territory_route_steps_centreline_idx on public.territory_route_steps using gist (centreline);
create index territory_route_steps_walkline_idx   on public.territory_route_steps using gist (walkline);

comment on table public.territory_route_steps is
  'Stage 5b-R2. One step of a saved variant. kind: work (knocking the side '
  'on the hand), cross (pavement to pavement at the end of a street), walk '
  '(non-working). centreline is the road in walking direction; walkline is '
  'the same line offset onto the pavement being walked. first_seq / '
  'last_seq are 0-based positions in territory_routes.door_order, null off '
  'work steps. Field names match lib/geo/walk/types.ts WalkStep.';

-- ---------------------------------------------------------------------------
-- 3. route_steps — the new per-step facts, alongside the 5b-a columns
-- ---------------------------------------------------------------------------

alter table public.route_steps
  add column kind        text check (kind in ('work', 'cross', 'walk')),
  add column side        text check (side in ('left', 'right')),
  add column walk_geom   geometry(LineString, 4326),
  add column first_seq   integer check (first_seq >= 0),
  add column last_seq    integer check (last_seq >= 0),
  add column is_dead_end boolean not null default false;

create index route_steps_walk_geom_idx on public.route_steps using gist (walk_geom);

comment on column public.route_steps.kind is
  'Stage 5b-R2. work | cross | walk. Null on rows frozen by route_commit (5b-a).';
comment on column public.route_steps.side is
  'Stage 5b-R2. Side of the direction of travel being knocked. Null on 5b-a rows.';
comment on column public.route_steps.walk_geom is
  'Stage 5b-R2. The walkline: geom offset onto the pavement being walked. '
  'Null on 5b-a rows, which drew geom on the road centre.';
comment on column public.route_steps.is_spur is
  'Stage 5b. On 5b-a rows: a cul-de-sac traversed in and back out. On R2 '
  'rows: derived as (kind = ''work'' and is_dead_end). Kept so the field '
  'display of 5b-b keeps reading every row.';

-- ---------------------------------------------------------------------------
-- 4. assignments — which variant was frozen, and from which saved row
-- ---------------------------------------------------------------------------

alter table public.assignments
  add column route_variant_key text
    check (route_variant_key ~ '^(best|best_reversed|alt_[1-9][0-9]*)$'),
  add column route_source_id   uuid references public.territory_routes(id) on delete set null;

create index assignments_route_source_idx on public.assignments (route_source_id);

comment on column public.assignments.route_variant_key is
  'Stage 5b-R2. The saved variant this assignment walks. Null on assignments '
  'routed by route_commit (5b-a) or not routed at all.';
comment on column public.assignments.route_source_id is
  'Stage 5b-R2. The territory_routes row the route was copied from. Set to '
  'null when the prop''s variants are regenerated; the frozen copy in '
  'route_steps and uprn_snapshot is untouched by that.';

-- ---------------------------------------------------------------------------
-- 5. RLS — admin only on both new tables; office read on route_steps
-- ---------------------------------------------------------------------------

alter table public.territory_routes      enable row level security;
alter table public.territory_route_steps enable row level security;

revoke all on table public.territory_routes      from public, anon, authenticated;
revoke all on table public.territory_route_steps from public, anon, authenticated;
-- Writes go through territory_routes_save (SECURITY INVOKER): INSERT and
-- DELETE, never UPDATE — a variant set is replaced, not edited.
grant select, insert, delete on table public.territory_routes      to authenticated;
grant select, insert, delete on table public.territory_route_steps to authenticated;

revoke all on sequence public.territory_route_steps_id_seq from public, anon, authenticated;
grant usage on sequence public.territory_route_steps_id_seq to authenticated;

create policy territory_routes_select_admin
  on public.territory_routes for select to authenticated
  using ((select public.app_role()) = 'admin');
create policy territory_routes_insert_admin
  on public.territory_routes for insert to authenticated
  with check ((select public.app_role()) = 'admin');
create policy territory_routes_delete_admin
  on public.territory_routes for delete to authenticated
  using ((select public.app_role()) = 'admin');

create policy territory_route_steps_select_admin
  on public.territory_route_steps for select to authenticated
  using ((select public.app_role()) = 'admin');
create policy territory_route_steps_insert_admin
  on public.territory_route_steps for insert to authenticated
  with check ((select public.app_role()) = 'admin');
create policy territory_route_steps_delete_admin
  on public.territory_route_steps for delete to authenticated
  using ((select public.app_role()) = 'admin');

-- Office reads frozen routes (same as it reads assignments for settlement).
-- No office policy on territory_routes: a prop's candidate set is admin
-- planning material.
create policy route_steps_select_office
  on public.route_steps for select to authenticated
  using ((select public.app_role()) = 'office');

-- ---------------------------------------------------------------------------
-- 6. territory_routes_save — delete-and-replace a prop's variant set
-- ---------------------------------------------------------------------------
-- p_variants: jsonb array of WalkVariant (lib/geo/walk/types.ts), each
--   { key, hand, start:{node_id,lon,lat}, end:{...}, total_m, working_m,
--     non_working_m, return_m, rank_cost_m, end_to_start_m, stranded_count,
--     straight_transfers, door_order:[uprn...], warnings:[...],
--     steps:[{ kind, segment_id, street_name, side, from_node, to_node,
--              centreline:[[lon,lat]...], walkline:[...], first_seq,
--              last_seq, instruction, is_dead_end, length_m }] }
-- Unknown keys (tree, candidates) are ignored. Steps are stored in array
-- order; step_index is their position.

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
  delete from public.territory_routes where territory_id = p_territory_id;

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
  'Stage 5b-R2. Replaces a prop''s whole saved variant set in one '
  'transaction: deletes every territory_routes row for the prop (cascading '
  'to its steps; frozen assignments keep their copy and drop only '
  'route_source_id), then inserts each variant and its steps. Requires best '
  'and best_reversed. Admin only. SECURITY INVOKER. Raises 22023 with a hint '
  'token for bad input, 42501 for a non-admin caller.';

revoke all on function public.territory_routes_save(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.territory_routes_save(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. assignment_route_freeze — copy one saved variant onto an assignment
-- ---------------------------------------------------------------------------
-- Mirrors route_commit (018) check for check: admin, row lock, zero
-- knock_events, door-set equality with the frozen snapshot, duplicate and
-- stranded-count checks, contiguous step numbering, valid line, then
-- delete-and-insert route_steps and one UPDATE of assignments. Adds one
-- check route_commit did not need: every segment_id still exists, because
-- a saved variant can outlive a road re-ingest.

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
  v_key := coalesce(
    nullif(btrim(p_variant_key), ''),
    case when v_a.visit_number % 2 = 1 then 'best' else 'best_reversed' end
  );

  if v_key !~ '^(best|best_reversed|alt_[1-9][0-9]*)$' then
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

  -- Door-set equality: the variant must order exactly the frozen doors.
  if v_r.door_order is null
     or cardinality(v_r.door_order) <> cardinality(v_a.uprn_snapshot) then
    raise exception 'The route must order exactly the frozen doors, no more and no fewer.'
      using errcode = '22023', hint = 'snapshot_mismatch';
  end if;

  select array_agg(u order by u) into v_old_sorted from unnest(v_a.uprn_snapshot) u;
  select array_agg(u order by u) into v_new_sorted from unnest(v_r.door_order) u;
  select count(distinct u) into v_distinct from unnest(v_r.door_order) u;

  if v_old_sorted is distinct from v_new_sorted then
    raise exception 'The route must order exactly the frozen doors, no more and no fewer.'
      using errcode = '22023', hint = 'snapshot_mismatch';
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
  'Stage 5b-R2. Copies one saved variant of the assignment''s prop onto the '
  'assignment in one transaction: replaces route_steps, sets route_geom, '
  'route_length_m, uprn_snapshot (the variant''s door_order), '
  'route_stranded_count, route_variant_key and route_source_id. Refuses '
  '(hint frozen) when the assignment has any knock_events; verifies the '
  'variant orders exactly the frozen doors (hint snapshot_mismatch); refuses '
  'a variant whose road segments no longer exist (hint stale_variant). '
  'variant_key null → best on odd visit_number, best_reversed on even. Admin '
  'only. SECURITY INVOKER. 22023 with a hint token for bad input, 42501 for '
  'a non-admin caller.';

revoke all on function public.assignment_route_freeze(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.assignment_route_freeze(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. allocate_prop — visit_number from assignment history
-- ---------------------------------------------------------------------------
-- Same signature, same return type, same body as 009 except the one block
-- marked R2. visit_count is no longer read here at all.

create or replace function public.allocate_prop(
  territory_id uuid,
  work_date date,
  canvasser_ids uuid[]
)
returns table (
  id uuid,
  visit_number int,
  entry_vertex_index int,
  sweep_direction text,
  slot text,
  knockable_doors int
)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_geom geometry(Polygon, 4326);
  v_prior int;
  v_archived timestamptz;
  v_ring geometry;
  v_vertex_count int;
  v_n int;
  v_entry int;
  v_dir text;
  v_slot text;
  v_centroid geometry;
  v_entry_pt geometry;
  v_entry_az double precision;
  v_snapshot bigint[];
  v_assignment_id uuid;
  v_member uuid;
  v_unique int;
  v_ok int;
  v_constraint text;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can allocate a prop.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  if allocate_prop.territory_id is null then
    raise exception 'Pick a prop to allocate.'
      using errcode = '22023', hint = 'missing_territory';
  end if;

  if allocate_prop.work_date is null then
    raise exception 'Pick a date for this allocation.'
      using errcode = '22023', hint = 'missing_date';
  end if;

  -- At least one member. Stage 2's trigger only rejects a fourth; an empty
  -- call would otherwise insert an assignment with no team.
  if canvasser_ids is null or cardinality(canvasser_ids) = 0 then
    raise exception 'Pick at least one canvasser.'
      using errcode = '22023', hint = 'empty_team';
  end if;

  if exists (select 1 from unnest(canvasser_ids) u(member_id) where u.member_id is null) then
    raise exception 'Every team member must be a real canvasser.'
      using errcode = '22023', hint = 'not_canvasser';
  end if;

  -- The row lock stays: it serialises concurrent allocations of one prop,
  -- which is what makes the count below stable.
  select t.geom, t.archived_at
    into v_geom, v_archived
  from public.territories t
  where t.id = allocate_prop.territory_id
  for update;

  if not found then
    raise exception 'That prop does not exist.'
      using errcode = '22023', hint = 'missing_territory';
  end if;

  if v_archived is not null then
    raise exception 'That prop has been archived.'
      using errcode = '22023', hint = 'archived_prop';
  end if;

  select count(*) into v_unique
  from (select distinct u from unnest(canvasser_ids) u) s;

  select count(*) into v_ok
  from public.profiles p
  where p.id in (select distinct u from unnest(canvasser_ids) u)
    and p.role = 'canvasser'
    and p.active;

  if v_ok is distinct from v_unique then
    raise exception 'Every team member must be an active canvasser.'
      using errcode = '22023', hint = 'not_canvasser';
  end if;

  v_ring := st_exteriorring(v_geom);
  -- Closing vertex duplicates the first; rotation walks the distinct corners.
  v_vertex_count := st_npoints(v_ring) - 1;
  if v_vertex_count < 3 then
    raise exception 'That prop polygon has too few vertices to rotate around.'
      using errcode = '22023', hint = 'degenerate_polygon';
  end if;

  -- R2 (2026-09-22). visit_number is the allocation ordinal from history:
  -- 1 + this prop's existing assignments, counted under the row lock above.
  -- territories.visit_count is NOT read: nothing increments it before Stage
  -- 12b, and when Stage 12b does it will mean closed visits, a different
  -- quantity. entry_vertex_index and sweep_direction are still written
  -- (NOT NULL) but are legacy; the route now comes from a saved variant.
  select count(*) into v_prior
  from public.assignments a
  where a.territory_id = allocate_prop.territory_id;

  v_n := v_prior + 1;
  v_entry := v_n % v_vertex_count;
  v_dir := case when v_n % 2 = 0 then 'cw' else 'ccw' end;
  v_slot := (array['early', 'mid', 'late']::text[])[(v_n % 3) + 1];

  v_centroid := st_centroid(v_geom);
  v_entry_pt := st_pointn(v_ring, v_entry + 1);
  v_entry_az := coalesce(st_azimuth(v_centroid, v_entry_pt), 0);

  -- interim geometric ordering, replaced by assignment_route_freeze when a
  -- saved variant is copied onto this assignment
  -- mod() has no float8 overload; wrap via numeric.
  select coalesce(
    array_agg(ordered.uprn order by ordered.sweep_key, ordered.uprn),
    '{}'::bigint[]
  )
  into v_snapshot
  from (
    select
      p.uprn,
      mod(
        (
          case
            when v_dir = 'cw' then
              coalesce(st_azimuth(v_centroid, p.geom), 0) - v_entry_az
            else
              v_entry_az - coalesce(st_azimuth(v_centroid, p.geom), 0)
          end + 4 * pi()
        )::numeric,
        (2 * pi())::numeric
      ) as sweep_key
    from public.properties p
    where st_within(p.geom, v_geom)
      and not p.is_nccz
  ) ordered;

  if cardinality(v_snapshot) = 0 then
    raise exception 'This prop has no knockable doors to allocate.'
      using errcode = '22023', hint = 'no_knockable_doors';
  end if;

  insert into public.assignments (
    territory_id,
    work_date,
    visit_number,
    entry_vertex_index,
    sweep_direction,
    slot,
    uprn_snapshot,
    created_by
  ) values (
    allocate_prop.territory_id,
    allocate_prop.work_date,
    v_n,
    v_entry,
    v_dir,
    v_slot,
    v_snapshot,
    auth.uid()
  )
  returning assignments.id into v_assignment_id;

  -- No pre-check of length. A fourth id hits assignment_members_max_three
  -- and the exception handler below turns it into a clean message; the
  -- assignment row rolls back with it.
  foreach v_member in array canvasser_ids loop
    insert into public.assignment_members (assignment_id, canvasser_id)
    values (v_assignment_id, v_member);
  end loop;

  return query
    select
      v_assignment_id,
      v_n,
      v_entry,
      v_dir,
      v_slot,
      cardinality(v_snapshot);
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'assignments_territory_id_work_date_key' then
      raise exception 'This prop is already allocated on that date.'
        using errcode = '23505', hint = 'already_allocated';
    elsif v_constraint = 'assignment_members_pkey' then
      raise exception 'The same canvasser cannot be on a team twice.'
        using errcode = '23505', hint = 'duplicate_member';
    else
      raise;
    end if;
  when foreign_key_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'assignment_members_canvasser_id_fkey' then
      raise exception 'Every team member must be an active canvasser.'
        using errcode = '23503', hint = 'not_canvasser';
    else
      raise;
    end if;
  when check_violation then
    -- Stage 2 trigger: assignment_members_max_three. Not a table CHECK.
    if sqlerrm like '%one to three%' then
      raise exception 'A team is one to three canvassers.'
        using errcode = '23514', hint = 'team_too_large';
    else
      raise;
    end if;
end;
$$;

comment on function public.allocate_prop(uuid, date, uuid[]) is
  'Stage 5, amended 5b-R2. Allocates a prop to a team of 1–3 canvassers for '
  'one date. visit_number = 1 + the prop''s existing assignments, counted '
  'under the territories row lock (territories.visit_count is not read). '
  'Freezes knockable UPRNs with the interim geometric sweep — replaced by '
  'assignment_route_freeze when a saved variant is copied on — and writes '
  'assignments plus assignment_members in one function. Admin only. Raises '
  'SQLSTATE 22023 / 23505 / 23514 with a hint token for bad input, 42501 '
  'for a non-admin caller.';

revoke all on function public.allocate_prop(uuid, date, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.allocate_prop(uuid, date, uuid[]) to authenticated;

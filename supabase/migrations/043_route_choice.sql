-- 043_route_choice.sql
-- RT-START P1 (owner 2026-10-19). The route a visit walks can be chosen per
-- visit, before its first knock, by an admin or by a canvasser on the visit.
--
--   1. assignments.route_choice / route_chosen_by / route_chosen_at: the
--      saved route someone chose for THIS visit. Null = the default by turns
--      (odd visits Route A, even Route B; a fitting drawn route the same way).
--   2. assignment_route_freeze (same signature, now SECURITY DEFINER):
--      - an explicit key records the choice on the visit (the default key
--        itself clears it: back to the default);
--      - no key keeps a recorded choice while the very route it froze is
--        still saved (same territory_routes row), so re-freezing upcoming
--        visits after a drawing is saved no longer resets a choice; a choice
--        whose route was regenerated or no longer fits is cleared and the
--        visit goes back to the default;
--      - a canvasser on the visit may call it with an explicit key, for an
--        open visit dated today (London). Admins as before.
--   3. assignment_route_options(assignment): the visit's saved routes with
--      length, start point and start street, which one is the default, the
--      current one and the recorded choice. Admin, or a canvasser on the visit.
--
-- The next visit to the prop has no choice of its own, so it is back on the
-- default (owner 2026-10-19). No existing row is changed. Owner runs this in
-- the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- 1. assignments: the recorded choice
-- ---------------------------------------------------------------------------

alter table public.assignments
  add column route_choice    text,
  add column route_chosen_by uuid references public.profiles(id),
  add column route_chosen_at timestamptz;

alter table public.assignments
  add constraint assignments_route_choice_check
  check (route_choice ~ '^(best|best_reversed|alt_[1-9][0-9]*|manual|manual_reversed)$');

comment on column public.assignments.route_choice is
  'RT-START (2026-10-19). The saved route variant someone chose for this '
  'visit (assignment_route_freeze with an explicit key). Null: the default '
  'by turns. Kept on a re-freeze only while the same territory_routes row is '
  'still saved (route_source_id); cleared otherwise.';
comment on column public.assignments.route_chosen_by is
  'RT-START. Who chose route_choice (an admin or a canvasser on the visit).';
comment on column public.assignments.route_chosen_at is
  'RT-START. When route_choice was last set or cleared.';

-- ---------------------------------------------------------------------------
-- 2. assignment_route_freeze
-- ---------------------------------------------------------------------------

create or replace function public.assignment_route_freeze(
  p_assignment_id uuid,
  p_variant_key   text default null
)
returns jsonb
language plpgsql
volatile
security definer
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
  v_mchain     bigint[];
  v_mleft      bigint[];
  v_fits       boolean;
  v_allocated  bigint[];
  v_manual     boolean;
  v_role       text;
  v_explicit   text;
  v_member     boolean;
  v_choice_ok  boolean := false;
  v_record     boolean := false;
  v_clear      boolean := false;
  v_default    text;
begin
  v_role     := public.app_role();
  v_explicit := nullif(btrim(p_variant_key), '');

  -- RT-START (owner 2026-10-19): a canvasser on the visit may choose one of
  -- its saved routes. Only with an explicit key; the default re-freeze stays
  -- an admin action.
  if v_role is distinct from 'admin' then
    select exists (
      select 1
      from public.assignment_members m
      where m.assignment_id = p_assignment_id
        and m.canvasser_id  = auth.uid()
        and m.left_at is null
    ) into v_member;

    if v_role is distinct from 'canvasser' or not v_member or v_explicit is null then
      raise exception 'Only an admin, or a canvasser on this visit, can change its route.'
        using errcode = '42501', hint = 'not_admin';
    end if;
  end if;

  select a.* into v_a
  from public.assignments a
  where a.id = p_assignment_id
  for update;

  if not found then
    raise exception 'That assignment does not exist.'
      using errcode = '22023', hint = 'missing_assignment';
  end if;

  if v_role is distinct from 'admin' then
    if v_a.closed_at is not null then
      raise exception 'This visit has ended, so its route can''t change.'
        using errcode = '22023', hint = 'closed';
    end if;
    if v_a.work_date <> (now() at time zone 'Europe/London')::date then
      raise exception 'Only today''s visit can change its route from the phone.'
        using errcode = '22023', hint = 'not_today';
    end if;
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
  -- RT (owner 2026-10-13): a prop in manual mode rotates manual /
  -- manual_reversed the same way, but only while the drawing fits THIS
  -- visit (RT-1b, 041): every drawn door was allocated to it, and every
  -- allocated door is either drawn or left out on purpose. Otherwise (the
  -- shape or the door eligibility changed since the drawing was saved) the
  -- visit falls back to best / best_reversed until the admin saves the
  -- drawing again. Worked out here, from the visit's own doors, never from
  -- a stored status.
  v_allocated := coalesce(v_a.uprn_allocated, v_a.uprn_snapshot);

  select t.route_mode, m.chain, m.left_out
    into v_mode, v_mchain, v_mleft
  from public.territories t
  left join public.territory_manual_routes m on m.territory_id = t.id
  where t.id = v_a.territory_id;

  v_fits := v_mchain is not null
            and v_mchain <@ v_allocated
            and v_allocated <@ (v_mchain || coalesce(v_mleft, '{}'::bigint[]));

  v_default := case
    when v_mode = 'manual' and v_fits then
      case when v_a.visit_number % 2 = 1 then 'manual' else 'manual_reversed' end
    when v_a.visit_number % 2 = 1 then 'best'
    else 'best_reversed'
  end;

  -- RT-START (owner 2026-10-19): an explicit key is recorded as this visit's
  -- choice; picking the default itself means "back to the default" and
  -- clears any choice. With no key, a recorded choice is kept while the
  -- route it froze is still saved unchanged (same row id); otherwise it is
  -- cleared and the default applies.
  if v_explicit is not null then
    v_key := v_explicit;
    if v_explicit = v_default then
      v_clear := v_a.route_choice is not null;
    else
      v_record := true;
    end if;
  else
    if v_a.route_choice is not null then
      select exists (
        select 1
        from public.territory_routes r
        where r.territory_id = v_a.territory_id
          and r.variant_key  = v_a.route_choice
          and r.id           = v_a.route_source_id
      ) into v_choice_ok;

      if v_choice_ok and v_a.route_choice in ('manual', 'manual_reversed') and not v_fits then
        v_choice_ok := false;
      end if;

      if v_choice_ok then
        v_key := v_a.route_choice;
      else
        v_clear := true;
      end if;
    end if;

    if v_key is null then
      v_key := v_default;
    end if;
  end if;

  if v_key !~ '^(best|best_reversed|alt_[1-9][0-9]*|manual|manual_reversed)$' then
    raise exception 'Route variant "%" is not recognised.', v_key
      using errcode = '22023', hint = 'bad_variant';
  end if;

  -- An explicit manual key gets the same test: a drawing that does not fit
  -- would silently drop doors from the visit.
  v_manual := v_key in ('manual', 'manual_reversed');
  if v_manual and not v_fits then
    raise exception 'The drawn route does not match this visit''s doors. Finish the drawing and save it, then try again.'
      using errcode = '22023', hint = 'manual_unfinished';
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
         route_source_id      = v_r.id,
         route_choice         = case when v_record then v_key
                                     when v_clear  then null
                                     else route_choice end,
         route_chosen_by      = case when v_record then auth.uid()
                                     when v_clear  then null
                                     else route_chosen_by end,
         route_chosen_at      = case when v_record or v_clear then now()
                                     else route_chosen_at end
   where id = p_assignment_id;

  return jsonb_build_object(
    'assignment_id',  p_assignment_id,
    'variant_key',    v_key,
    'hand',           v_r.hand,
    'route_id',       v_r.id,
    'steps',          v_n_steps,
    'route_length_m', v_length,
    'doors',          cardinality(v_r.door_order),
    'stranded_count', v_r.stranded_count,
    'chosen',         v_record or (v_choice_ok and not v_clear),
    'choice_cleared', v_clear
  );
end;
$$;

comment on function public.assignment_route_freeze(uuid, text) is
  'Stage 5b-R2, RT (2026-10-13), RT-1b (041), RT-START (043). Copies one '
  'saved variant of the assignment''s prop onto the assignment in one '
  'transaction: replaces route_steps, sets route_geom, route_length_m, '
  'uprn_snapshot (the variant''s door_order), uprn_allocated, '
  'route_stranded_count, route_variant_key and route_source_id. Refuses '
  '(hint frozen) when the assignment has any knock_events. Automatic '
  'variants must order exactly the allocated doors; manual variants a subset '
  'of them (hint snapshot_mismatch). Refuses a variant whose road segments no '
  'longer exist (hint stale_variant). An explicit variant_key is recorded as '
  'the visit''s route_choice (the default key itself clears it). variant_key null: a recorded choice whose route '
  'row is still saved (same id) is kept; otherwise it is cleared and the '
  'default applies: a manual prop whose drawing fits the visit takes manual '
  'on odd visit_number, manual_reversed on even; otherwise best / '
  'best_reversed. An explicit manual key that does not fit is refused (hint '
  'manual_unfinished). Admin, or a canvasser on the visit with an explicit '
  'key for an open visit dated today (hints closed, not_today). SECURITY '
  'DEFINER with its own checks. 22023 with a hint token for bad input, 42501 '
  'for any other caller.';

revoke all on function public.assignment_route_freeze(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.assignment_route_freeze(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. assignment_route_options
-- ---------------------------------------------------------------------------

create or replace function public.assignment_route_options(p_assignment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_a         public.assignments%rowtype;
  v_role      text;
  v_allocated bigint[];
  v_sorted    bigint[];
  v_mode      text;
  v_mchain    bigint[];
  v_mleft     bigint[];
  v_fits      boolean;
  v_default   text;
  v_knocks    integer;
  v_routes    jsonb;
  v_by        text;
  v_order     bigint;
begin
  v_role := public.app_role();

  select a.* into v_a
  from public.assignments a
  where a.id = p_assignment_id;

  if not found then
    raise exception 'That assignment does not exist.'
      using errcode = '22023', hint = 'missing_assignment';
  end if;

  if v_role is distinct from 'admin'
     and not exists (
       select 1
       from public.assignment_members m
       where m.assignment_id = p_assignment_id
         and m.canvasser_id  = auth.uid()
         and m.left_at is null
     ) then
    raise exception 'Only an admin, or a canvasser on this visit, can see its routes.'
      using errcode = '42501', hint = 'not_admin';
  end if;

  v_allocated := coalesce(v_a.uprn_allocated, v_a.uprn_snapshot);
  select array_agg(u order by u) into v_sorted from unnest(v_allocated) u;

  select t.route_mode, m.chain, m.left_out
    into v_mode, v_mchain, v_mleft
  from public.territories t
  left join public.territory_manual_routes m on m.territory_id = t.id
  where t.id = v_a.territory_id;

  v_fits := v_mchain is not null
            and v_mchain <@ v_allocated
            and v_allocated <@ (v_mchain || coalesce(v_mleft, '{}'::bigint[]));

  v_default := case
    when v_mode = 'manual' and v_fits then
      case when v_a.visit_number % 2 = 1 then 'manual' else 'manual_reversed' end
    when v_a.visit_number % 2 = 1 then 'best'
    else 'best_reversed'
  end;

  select count(*) into v_knocks
  from public.knock_events k
  where k.assignment_id = p_assignment_id;

  select coalesce(jsonb_agg(x.item order by x.rank, x.variant_key), '[]'::jsonb)
    into v_routes
  from (
    select
      r.variant_key,
      case r.variant_key
        when 'best'            then 0
        when 'best_reversed'   then 1
        when 'manual'          then 2
        when 'manual_reversed' then 3
        else 100 + coalesce(substring(r.variant_key from '^alt_([0-9]+)$')::integer, 900)
      end as rank,
      jsonb_build_object(
        'key',          r.variant_key,
        'total_m',      r.total_m,
        'hand',         r.hand,
        'start_lon',    st_x(r.start_geom),
        'start_lat',    st_y(r.start_geom),
        'start_street', (
          select s.street_name
          from public.territory_route_steps s
          where s.route_id = r.id
            and s.street_name is not null
            and btrim(s.street_name) <> ''
          order by s.step_index
          limit 1
        ),
        'usable', case
          when r.variant_key in ('manual', 'manual_reversed') then
            coalesce(v_fits, false) and r.door_order <@ v_allocated
          else
            (select array_agg(u order by u) from unnest(r.door_order) u) is not distinct from v_sorted
        end
      ) as item
    from public.territory_routes r
    where r.territory_id = v_a.territory_id
  ) x;

  -- The door order the visit walks, as one number the phone can work out
  -- from the doors it loaded (lib/geo/walk/route-options.ts orderCheckOf):
  -- sum of (uprn mod 1000003) x position (1-based), mod 2147483647, over the
  -- same doors todays_assignment sends (snapshot doors with a properties
  -- row). A phone whose number differs is walking an old order and reloads.
  select coalesce(sum((t.u % 1000003) * t.o) % 2147483647, 0)
    into v_order
  from unnest(v_a.uprn_snapshot) with ordinality t(u, o)
  join public.properties p on p.uprn = t.u;

  select nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '')
    into v_by
  from public.profiles p
  where p.id = v_a.route_chosen_by;

  return jsonb_build_object(
    'assignment_id', v_a.id,
    'visit_number',  v_a.visit_number,
    'work_date',     v_a.work_date,
    'closed',        v_a.closed_at is not null,
    'knocks',        v_knocks,
    'current_key',   v_a.route_variant_key,
    'default_key',   v_default,
    'choice',        v_a.route_choice,
    'chosen_by',     v_by,
    'chosen_at',     v_a.route_chosen_at,
    'source_id',     v_a.route_source_id,
    'order_check',   v_order,
    'routes',        v_routes
  );
end;
$$;

comment on function public.assignment_route_options(uuid) is
  'RT-START (043). The saved routes a visit can walk: key, total_m, hand, '
  'start point (start_lon / start_lat of the walk''s first node), the first '
  'street name, and usable (an automatic route orders exactly the visit''s '
  'allocated doors; a drawn one fits them). Plus the default key by turns, '
  'the current key, the recorded choice (with the chooser''s first name), '
  'the knock count and order_check (a number for the frozen door order). Admin, or a canvasser on the visit. SECURITY DEFINER '
  'with its own check. 42501 for any other caller.';

revoke all on function public.assignment_route_options(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assignment_route_options(uuid) to authenticated;

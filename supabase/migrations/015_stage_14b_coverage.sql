-- Stage 14b: coverage map and admin dashboard (read-only, derived).
--
-- Coverage is computed on read from v_latest_knock against assignment
-- snapshots. There is no coverage table and no materialised summary.
-- Archived props (territories.archived_at is not null) are excluded.
--
-- Canonical answered rule (outcome-mapping skill / Stage 8b amendment):
--   answered := outcome NOT IN ('no_answer','inaccessible')
-- Contact, Lead and Rented/Council all mean somebody came to the door.
-- Do not count only outcome = 'answered'.
--
-- No new tables, so no new RLS policies. Both the view and the RPCs are
-- SECURITY INVOKER: a view otherwise runs with its owner's privileges and
-- silently bypasses RLS. EXECUTE is authenticated-only; each RPC checks
-- app_role() = 'admin' so canvasser/office JWTs cannot pull the payload.

-- ---------------------------------------------------------------------------
-- Latest knock per UPRN across visits of live props.
-- v_latest_knock already collapses corrections on one assignment.
-- This collapses across assignments so a door hit on two visits shows the
-- newer outcome. Not a coverage table — derived on every read.
-- ---------------------------------------------------------------------------

create or replace view public.v_coverage_latest
with (security_invoker = true) as
select distinct on (ke.uprn)
  ke.uprn,
  ke.outcome,
  ke.occurred_at,
  ke.assignment_id,
  a.territory_id,
  a.work_date,
  a.slot
from public.v_latest_knock ke
join public.assignments a on a.id = ke.assignment_id
join public.territories t on t.id = a.territory_id
where t.archived_at is null
order by ke.uprn, ke.occurred_at desc, ke.assignment_id desc;

comment on view public.v_coverage_latest is
  'Stage 14b. Latest knock per UPRN across visits of live (non-archived) '
  'props, resolved through v_latest_knock. Derived; not a coverage table.';

revoke all on public.v_coverage_latest from anon, authenticated;
grant select on public.v_coverage_latest to authenticated;

-- ---------------------------------------------------------------------------
-- Coverage map payload: doors GeoJSON + outcomes for feature-state +
-- per-prop three-number coverage. Outcome is NEVER a feature property —
-- the client paints MapLibre feature-state. jsonb so PostgREST's 1000-row
-- cap cannot truncate a 2,000-door prop.
-- ---------------------------------------------------------------------------

create or replace function public.coverage_map_payload()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  doors jsonb;
  outcomes jsonb;
  props jsonb;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Coverage is an admin view.'
      using errcode = '42501',
            hint = 'not_admin';
  end if;

  -- Snapshot doors of live, allocated props. Distinct UPRN; if a door sits
  -- in two props (should not), the newer territory wins.
  with snap as (
    select
      t.id as territory_id,
      t.name as territory_name,
      t.created_at,
      unnest(a.uprn_snapshot) as uprn
    from public.territories t
    join public.assignments a on a.territory_id = t.id
    where t.archived_at is null
  ),
  doors_src as (
    select distinct on (s.uprn)
      s.uprn,
      s.territory_id,
      s.territory_name,
      p.geom
    from snap s
    join public.properties p on p.uprn = s.uprn
    order by s.uprn, s.created_at desc
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'type', 'Feature',
               'id', d.uprn,
               'geometry', st_asgeojson(d.geom, 7)::jsonb,
               'properties', jsonb_build_object(
                 'uprn', d.uprn,
                 'territory_id', d.territory_id,
                 'territory_name', d.territory_name,
                 'house_number', dl.house_number,
                 'building_name', dl.building_name,
                 'street_name', dl.street_name
               )
             )
             order by d.uprn
           ),
           '[]'::jsonb
         )
  into doors
  from doors_src d
  left join public.v_door_label dl on dl.uprn = d.uprn;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'uprn', c.uprn,
               'outcome', c.outcome
             )
             order by c.uprn
           ),
           '[]'::jsonb
         )
  into outcomes
  from public.v_coverage_latest c;

  -- Three numbers per prop, never a single percentage: worked, answered,
  -- remaining. Answered uses the canonical rule. Demo props sort first.
  select coalesce(
           jsonb_agg(p.obj order by p.demo desc, p.name),
           '[]'::jsonb
         )
  into props
  from (
    select
      t.name,
      (t.name like 'DEMO - %') as demo,
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'geometry', st_asgeojson(t.geom, 5)::jsonb,
        'knockable', (
          select count(*)::int
          from (
            select distinct unnest(a.uprn_snapshot) as uprn
            from public.assignments a
            where a.territory_id = t.id
          ) s
        ),
        'worked', (
          select count(*)::int
          from public.v_coverage_latest c
          where c.territory_id = t.id
        ),
        'answered', (
          select count(*)::int
          from public.v_coverage_latest c
          where c.territory_id = t.id
            and c.outcome not in ('no_answer', 'inaccessible')
        )
      ) as obj
    from public.territories t
    where t.archived_at is null
      and exists (
        select 1 from public.assignments a where a.territory_id = t.id
      )
  ) p;

  return jsonb_build_object(
    'doors', jsonb_build_object(
      'type', 'FeatureCollection',
      'features', coalesce(doors, '[]'::jsonb)
    ),
    'outcomes', coalesce(outcomes, '[]'::jsonb),
    'props', coalesce(props, '[]'::jsonb)
  );
end;
$$;

comment on function public.coverage_map_payload() is
  'Stage 14b. Admin coverage map payload: snapshot doors as GeoJSON '
  '(no outcome property), latest outcomes for feature-state, per-prop '
  'worked/answered/remaining. Archived props excluded. SECURITY INVOKER.';

revoke all on function public.coverage_map_payload()
  from public, anon, authenticated, service_role;
grant execute on function public.coverage_map_payload() to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard aggregates. Same answered rule. Same archived filter.
-- Lead panel joins knock_events only to reach the assignment (and so the
-- prop) for the archived filter — it counts leads.status, not knock outcome.
-- ---------------------------------------------------------------------------

create or replace function public.admin_dashboard(p_stale_weeks int default 4)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  weeks int;
  london_today date;
  payload jsonb;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'The dashboard is an admin view.'
      using errcode = '42501',
            hint = 'not_admin';
  end if;

  if p_stale_weeks is null or p_stale_weeks < 1 or p_stale_weeks > 52 then
    raise exception 'Weeks without a visit must be between 1 and 52.'
      using errcode = '22023',
            hint = 'stale_weeks_out_of_range',
            detail = format('Received %s.', coalesce(p_stale_weeks::text, 'null'));
  end if;

  weeks := p_stale_weeks;
  london_today := (timezone('Europe/London', now()))::date;

  select jsonb_build_object(
    'as_of', london_today,
    'stale_weeks', weeks,
    'answered_sql', 'outcome not in (''no_answer'',''inaccessible'')',
    'coverage', (
      select coalesce(jsonb_agg(p.obj order by p.demo desc, p.name), '[]'::jsonb)
      from (
        select
          t.name,
          (t.name like 'DEMO - %') as demo,
          jsonb_build_object(
            'territory_id', t.id,
            'name', t.name,
            'knockable', (
              select count(*)::int
              from (
                select distinct unnest(a.uprn_snapshot) as uprn
                from public.assignments a
                where a.territory_id = t.id
              ) s
            ),
            'worked', (
              select count(*)::int
              from public.v_coverage_latest c
              where c.territory_id = t.id
            ),
            'answered', (
              select count(*)::int
              from public.v_coverage_latest c
              where c.territory_id = t.id
                and c.outcome not in ('no_answer', 'inaccessible')
            )
          ) as obj
        from public.territories t
        where t.archived_at is null
          and exists (
            select 1 from public.assignments a where a.territory_id = t.id
          )
      ) p
    ),
    'worked_per_week', (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'territory_id', x.territory_id,
                   'name', x.name,
                   'iso_week', x.iso_week,
                   'week_start', x.week_start,
                   'worked', x.worked
                 )
                 order by x.week_start, x.name
               ),
               '[]'::jsonb
             )
      from (
        select
          t.id as territory_id,
          t.name,
          to_char(a.work_date, 'IYYY-"W"IW') as iso_week,
          (date_trunc('week', a.work_date::timestamp))::date as week_start,
          count(ke.uprn)::int as worked
        from public.assignments a
        join public.territories t on t.id = a.territory_id
        left join public.v_latest_knock ke on ke.assignment_id = a.id
        where t.archived_at is null
        group by t.id, t.name, to_char(a.work_date, 'IYYY-"W"IW'),
                 (date_trunc('week', a.work_date::timestamp))::date
      ) x
    ),
    'answer_by_slot', (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'slot', s.slot,
                   'worked', coalesce(x.worked, 0),
                   'answered', coalesce(x.answered, 0)
                 )
                 order by array_position(array['early','mid','late'], s.slot)
               ),
               '[]'::jsonb
             )
      from (values ('early'), ('mid'), ('late')) as s(slot)
      left join (
        select
          a.slot,
          count(ke.uprn)::int as worked,
          count(ke.uprn) filter (
            where ke.outcome not in ('no_answer', 'inaccessible')
          )::int as answered
        from public.assignments a
        join public.territories t on t.id = a.territory_id
        join public.v_latest_knock ke on ke.assignment_id = a.id
        where t.archived_at is null
        group by a.slot
      ) x on x.slot = s.slot
    ),
    'lead_outcomes', (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'status', s.status,
                   'n', coalesce(x.n, 0)
                 )
                 order by array_position(
                   array['sale','pm','blowout','utc','btc'],
                   s.status
                 )
               ),
               '[]'::jsonb
             )
      from (values ('sale'), ('pm'), ('blowout'), ('utc'), ('btc')) as s(status)
      left join (
        -- knock_events is joined for assignment identity so archived props
        -- can be excluded. The count is leads.status, not knock outcome.
        select l.status, count(*)::int as n
        from public.leads l
        join public.knock_events k on k.id = l.knock_event_id
        join public.assignments a on a.id = k.assignment_id
        join public.territories t on t.id = a.territory_id
        where t.archived_at is null
          and l.status in ('sale', 'pm', 'blowout', 'utc', 'btc')
        group by l.status
      ) x on x.status = s.status
    ),
    'props_last_visit', (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'territory_id', y.territory_id,
                   'name', y.name,
                   'last_visited', y.last_visited,
                   'stale', y.stale
                 )
                 order by y.stale desc, y.last_visited nulls first, y.name
               ),
               '[]'::jsonb
             )
      from (
        select
          t.id as territory_id,
          t.name,
          max(a.work_date) as last_visited,
          (
            max(a.work_date) is null
            or max(a.work_date) < (london_today - (weeks * 7))
          ) as stale
        from public.territories t
        left join public.assignments a on a.territory_id = t.id
        where t.archived_at is null
        group by t.id, t.name
      ) y
    )
  ) into payload;

  return payload;
end;
$$;

comment on function public.admin_dashboard(int) is
  'Stage 14b. Admin dashboard: doors worked per prop per week, answer rate '
  'by slot (answered := outcome NOT IN (''no_answer'',''inaccessible'')), '
  'lead outcomes sale/PM/blowout/UTC/BTC, props not visited in N weeks. '
  'Archived props excluded. SECURITY INVOKER.';

revoke all on function public.admin_dashboard(int)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_dashboard(int) to authenticated;

-- Stage 9: prop completion (read-only, derived).
--
-- Coverage is computed on read. There is no coverage table and no stored
-- counts. This view answers "how much of this assignment have we worked
-- through" from knocks, not from GPS.
--
-- Join v_latest_knock, never knock_events. Latest-outcome-wins already lives
-- in that view (Stage 8a). A second DISTINCT ON here would double-count a
-- corrected door if it were written against raw events, and would duplicate
-- the rule if written against the view.
--
-- Canonical answered rule (identical to Stage 14b / v_coverage_latest):
--   answered := outcome NOT IN ('no_answer','inaccessible')
-- Contact, Lead and Rented/Council all mean somebody came to the door.
-- Do not count only outcome = 'answered'.
--
-- Three numbers, never a percentage: worked, answered, remaining
-- (knockable − worked). The original brief also selected leads_raised; that
-- is a quality count and is deliberately omitted so /field cannot read it
-- off this view.
--
-- SECURITY INVOKER is mandatory. A Postgres view otherwise runs with its
-- owner's privileges and would silently bypass RLS on knock_events.
-- No new tables, so no new RLS policies. Grants match v_latest_knock:
-- authenticated SELECT; anon none.

create or replace view public.v_prop_completion
with (security_invoker = true) as
select
  a.id                                              as assignment_id,
  a.territory_id,
  t.name                                            as territory_name,
  a.visit_number,
  a.work_date,
  cardinality(a.uprn_snapshot)::int                 as knockable,
  count(ke.uprn)::int                               as worked,
  count(ke.uprn) filter (
    where ke.outcome not in ('no_answer', 'inaccessible')
  )::int                                            as answered,
  (
    cardinality(a.uprn_snapshot)::int
    - count(ke.uprn)::int
  )                                                 as remaining
from public.assignments a
join public.territories t on t.id = a.territory_id
left join public.v_latest_knock ke on ke.assignment_id = a.id
group by a.id, a.territory_id, t.name, a.visit_number, a.work_date;

comment on view public.v_prop_completion is
  'Stage 9. Per-assignment completion: knockable, worked, answered, remaining. '
  'Joins v_latest_knock (latest-outcome-wins). Answered := outcome NOT IN '
  '(''no_answer'',''inaccessible'') — identical to Stage 14b. Derived; not a '
  'coverage table. SECURITY INVOKER.';

revoke all on public.v_prop_completion from anon, authenticated;
grant select on public.v_prop_completion to authenticated;

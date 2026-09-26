-- Stage 5c-b: add a canvasser to an open assignment.
--
-- assignment_member_add is admin-only and takes the same assignment row
-- lock as assignment_member_remove. It does not modify assignment_remove,
-- assignment_member_remove, assignment_close_early, todays_assignment or
-- allocate_prop.
--
-- The team-cap trigger is BEFORE INSERT OR UPDATE OF assignment_id, so
-- clearing left_at does not run it. This function counts active members
-- (left_at is null) itself before the insert and before the clear.

create or replace function public.assignment_member_add(
  p_assignment_id uuid,
  p_canvasser_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_a       public.assignments%rowtype;
  v_left    timestamptz;
  v_found   boolean;
  v_active  int;
  v_name    text;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only an admin can add a canvasser to an assignment.'
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

  if v_a.closed_at is not null then
    raise exception 'That assignment is already closed.'
      using errcode = '22023', hint = 'already_closed';
  end if;

  -- No row leaves v_name null. A matching row always yields a name, because
  -- coalesce replaces a null full_name.
  select coalesce(p.full_name, 'A canvasser')
    into v_name
  from public.profiles p
  where p.id = p_canvasser_id
    and p.role = 'canvasser'
    and p.active;

  if v_name is null then
    raise exception 'That canvasser is not an active canvasser.'
      using errcode = '22023', hint = 'not_canvasser';
  end if;

  -- Same rule as allocate_prop: active member (left_at is null) of a
  -- different assignment that is still open on this work_date. The lock
  -- above is this assignment only, so two admins adding the same canvasser
  -- to two props at the same instant can both pass. Same recorded race as
  -- allocate_prop; not fixed here.
  if exists (
    select 1
    from public.assignment_members m
    join public.assignments a on a.id = m.assignment_id
    where m.canvasser_id = p_canvasser_id
      and m.left_at is null
      and a.work_date = v_a.work_date
      and a.closed_at is null
      and a.id is distinct from p_assignment_id
  ) then
    raise exception '% is already allocated to a prop on that date.', v_name
      using errcode = '22023', hint = 'canvasser_double_booked';
  end if;

  select exists (
    select 1
    from public.assignment_members m
    where m.assignment_id = p_assignment_id
      and m.canvasser_id = p_canvasser_id
  ) into v_found;

  select m.left_at
    into v_left
  from public.assignment_members m
  where m.assignment_id = p_assignment_id
    and m.canvasser_id = p_canvasser_id;

  -- Already active is an error, not a no-op. The add control only lists
  -- people who are not active members. A second add is a double submit or
  -- a stale screen, and reporting success would claim someone was added.
  if v_found and v_left is null then
    raise exception 'That canvasser is already on this assignment.'
      using errcode = '22023', hint = 'already_member';
  end if;

  -- Count before the write. Applies to a brand-new insert and to clearing
  -- left_at. Do not rely on assignment_members_max_three for the clear:
  -- that trigger does not fire when only left_at changes.
  select count(*)::int into v_active
  from public.assignment_members m
  where m.assignment_id = p_assignment_id
    and m.left_at is null;

  if v_active >= 3 then
    raise exception 'A team is one to three canvassers.'
      using errcode = '23514', hint = 'team_too_large';
  end if;

  if v_found then
    update public.assignment_members
       set left_at = null
     where assignment_id = p_assignment_id
       and canvasser_id = p_canvasser_id;
  else
    insert into public.assignment_members (assignment_id, canvasser_id)
    values (p_assignment_id, p_canvasser_id);
  end if;

  select count(*)::int into v_active
  from public.assignment_members m
  where m.assignment_id = p_assignment_id
    and m.left_at is null;

  return jsonb_build_object(
    'action', case when v_found then 'readded' else 'added' end,
    'active_members', v_active
  );
exception
  when unique_violation then
    raise exception 'That canvasser is already on this assignment.'
      using errcode = '23505', hint = 'already_member';
  when check_violation then
    if sqlerrm like '%one to three%' then
      raise exception 'A team is one to three canvassers.'
        using errcode = '23514', hint = 'team_too_large';
    else
      raise;
    end if;
end;
$$;

comment on function public.assignment_member_add(uuid, uuid) is
  'Stage 5c-b. Inserts an assignment_members row, or clears left_at when '
  'the canvasser has already left. Refuses a fourth active member by its '
  'own count (the cap trigger does not see a left_at update), a canvasser '
  'who is not active, a closed assignment, and a same-date double booking '
  'on another open assignment. Already-active is an error (already_member), '
  'not a no-op. Admin only. SECURITY INVOKER. 22023 hint missing_assignment, '
  'already_closed, not_canvasser, canvasser_double_booked or already_member; '
  '23514 hint team_too_large; 42501 hint not_admin.';

revoke all on function public.assignment_member_add(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assignment_member_add(uuid, uuid) to authenticated;

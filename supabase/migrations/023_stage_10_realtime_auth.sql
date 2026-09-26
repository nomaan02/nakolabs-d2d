-- Stage 10: private Realtime broadcasts for door claims.
--
-- Claims are ephemeral. This migration does not create a table, and it does
-- not write assignment_members.route_position_m or route_position_at.
--
-- realtime.messages already has row level security enabled. Do not ALTER it.
-- The postgres role does not own that table, so ENABLE ROW LEVEL SECURITY
-- fails with 42501 and aborts every policy after it.
--
-- Topic shape: assignment:<assignment uuid>, lowercase, as uuid::text emits.
-- Broadcast only. A canvasser with left_at set is no longer on the team and
-- cannot join. Public (non-private) channels are a project setting, not SQL;
-- clients must pass config.private = true or Realtime rejects the join once
-- public access is off.

create policy "assignment members receive broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.assignment_members m
    where m.canvasser_id = (select auth.uid())
      and m.left_at is null
      and (select realtime.topic()) = ('assignment:' || m.assignment_id::text)
  )
);

create policy "assignment members send broadcasts"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.assignment_members m
    where m.canvasser_id = (select auth.uid())
      and m.left_at is null
      and (select realtime.topic()) = ('assignment:' || m.assignment_id::text)
  )
);

-- Teammate lines need a name. assignment_members is already readable by the
-- team; profiles were own-row and admin only, so a canvasser could not see
-- "Leon". Active teammates on a shared assignment can read each other's row.
create policy profiles_select_teammate
  on public.profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.assignment_members mine
      join public.assignment_members theirs
        on theirs.assignment_id = mine.assignment_id
       and theirs.left_at is null
      where mine.canvasser_id = (select auth.uid())
        and mine.left_at is null
        and theirs.canvasser_id = profiles.id
    )
  );

# Brief amendments — Stage 8 redesign (dated 2026-09-17)

Apply these to `docs/D2D-Build-Brief.md` exactly as written.

**Convention reminder:** completed stages get dated notes appended, never body
rewrites. Stage 8 is NOT completed, so its body is replaced in full.

---

## A. Section 3 — Invariant 2, append this note

> **Amended 2026-09-17.** The rule is about *quality* signals, not all persistent
> state. Two categories now split:
>
> **Permitted in `/field`** — property-level **eligibility** facts, which may
> persist across visits: NCCZ exclusion, `do_not_call`, and a `no_opportunity`
> observation. These describe whether a door can be worked at all, the same
> category as NCCZ. They cannot be cherry-picked, because a canvasser gains
> nothing by skipping a door that was never sellable.
>
> **Still banned in `/field`** — quality signals from past visits: previous
> answer rates, lead rates, conversion, scores, rankings, or any Stage 15
> output. Admin only, unchanged.
>
> **Also permitted** — outcome colour on doors logged **within the current
> assignment**, since the door is already worked and cannot be skipped. Carrying
> a previous visit's outcome colour onto a new visit's map is banned; that is
> straightforward cherry-picking fuel.
>
> Colour is never the sole carrier of meaning. Every coloured state pairs with
> an icon or fill shape.

---

## B. Section 3 — Invariant 5, append this second note

> **Amended 2026-09-17 (second narrowing).** A canvasser may type a **house
> number only**, against a UPRN that has **already been selected** by tapping a
> dot or advancing the logger cursor. It is stored in `address_observations` as
> a canvasser observation and used as a display label. Invariant 3 applies: a
> number read off a real door outranks all public data.
>
> The test: *does the typed text select the door, or describe an already-selected
> door?* The first is banned. The second is invariant 3 working as intended.
>
> Still banned, unchanged: address search, autocomplete, street or postcode
> entry, any free text used to *locate* a property, and any address field on
> `knock_events`, `leads` or `uprn_snapshot`.

---

## C. Section 6, Stage 2 — append this dated note

> **Amended 2026-09-17 (Stage 8 redesign).** Additive schema changes, all in new
> numbered migrations. `003_core.sql` is untouched.
>
> - `knock_events.outcome` CHECK gains `'no_opportunity'` — the blanket
>   "we cannot do the job here" outcome (rented, council, HMO). Made while
>   `knock_events` held zero rows; impossible to do cheaply afterwards.
> - `property_observations.tenure` CHECK gains `'no_opportunity'`.
> - `knock_events.notes text` with a 280-character CHECK.
> - New table `address_observations` — canvasser-supplied house numbers.
> - New SELECT policy on `knock_events`: a canvasser reads knocks on any
>   assignment they are a member of, not only their own rows. Without it a
>   teammate's knocks vanish on reload and bunny-hopping breaks.
> - New trigger `leads_set_is_immediate` — `is_immediate` is derived
>   server-side from `booked_for` vs the knock's `occurred_at`, compared in
>   `Europe/London`. It is never sent by the client.
> - New views `v_latest_knock` and `v_door_label`, both
>   `with (security_invoker = true)`.
>
> **Admin still has no override on `leads.status`.** Unchanged.

---

## D. Section 6, Stage 6 — append this dated note

> **Amended 2026-09-17.** `/field` becomes a four-tab shell: Map, Logger, Leads,
> Profile. Stage 6's map view becomes the Map tab, unchanged in substance. The
> tabs are real routes under a shared `app/(field)/layout.tsx` holding the sync
> provider, the undo toast and the tab bar, so Dexie is read once rather than
> per tab.
>
> Stage 6's tap-accuracy risk is downgraded from blocking to secondary: the
> Logger tab's sequence cursor is now the primary logging path, and map-tap is
> the secondary path and the recovery route when the sequence and the street
> disagree.

---

## E. Section 6, Stage 7 — append this dated note

> **Verified 2026-09-17.** The queue shipped to the **full** Section 6
> specification, not the Track A "-lite" cut. Confirmed present:
> per-assignment ordering via `seq`-sorted groups, exponential backoff
> (`lib/sync/backoff.ts`), error classification (`lib/sync/classify.ts`) into
> ok / duplicate / permanent / auth / retryable, permanent failures parked as
> `failed` and surfaced with retry and discard in
> `components/field/sync-status.tsx`, Web Lock cross-tab exclusivity, and
> client-generated row ids (`newRowId`). The Track B "harden 7 to full" item is
> closed.
>
> **Amended 2026-09-17 (undo window).** The outbox gains a fourth status,
> `held_undo`, and a plain `eligible_at` field. A newly logged op is written as
> `held_undo` and is therefore invisible to `flush()`, which selects only
> `pending`. A timer promotes it to `pending` after 60 seconds. Undo before that
> deletes the row — nothing ever reaches Postgres. A sweep on app start promotes
> any `held_undo` row whose `eligible_at` has passed, so a force-quit inside the
> window cannot strand a write.
>
> `hasPending()` counts `held_undo` as unsynced work.
>
> This is not a second sync path. It is a delay on eligibility inside the one
> queue.

---

## F. Section 6, Stage 1c — append this dated note

> **Amended 2026-09-17.** `address_observations` becomes the highest-confidence
> address tier, above `property_addresses.source='epc'`. Resolution is the view
> `v_door_label`: the latest canvasser observation wins, the ingest row is the
> fallback. This is invariant 3 expressed in SQL.
>
> `property_addresses` remains ingest-owned. Canvasser input never writes to it,
> so the no-overwrite rule across ingest passes is unaffected.
>
> The reserved `'inferred'` interpolation pass stays reserved and stays blocked
> on Stage 1b. Side-of-street cannot be determined without road geometry, and
> the interim angular ordering is not street order, so "between two anchors" has
> no meaning yet. Canvasser-supplied numbers make that pass **more** accurate
> when it eventually runs, by adding `exact` anchors.

---

## G. Section 6, Stage 8 — REPLACE THE WHOLE BODY with the following

### Stage 8 — Knock logger

**Split into 8a (schema) and 8b (UI).** Stage 8 grew from "a sheet that calls
the queue" into six migrations, a new table, an RLS policy change, two CHECK
constraint changes and two views. That is Stage 2-class work and is routed like
it. See Section 10.

---

#### What this stage is

A **sequence cursor** is the primary logging surface. The canvasser sees one
door at a time — its position in the walk, its house number, a mini map — and
five outcome buttons. One tap logs it and advances. No confirmation step.

Map-tap logging remains, as the secondary path and the recovery route.

`/field` becomes four tabs: **Map · Logger · Leads · Profile**.

---

#### 8a — Schema

All migrations take the **next free numbers** read from
`supabase/migrations/`. Never assume a number.

**Pre-flight, and it gates everything else.** Run in the SQL editor and record
both results:

```sql
select count(*) from knock_events;            -- must be 0
select count(*) from property_observations;   -- must be 0
```

If either is non-zero, **stop and report**. The CHECK constraint changes below
are cheap only while the tables are empty.

Look the constraint names up rather than guessing them — Postgres auto-names
these:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid in ('knock_events'::regclass,
                   'property_observations'::regclass)
  and contype = 'c';
```

**Outcome and tenure values:**

```sql
alter table knock_events drop constraint <name from the query above>;
alter table knock_events add constraint knock_events_outcome_check
  check (outcome in (
    'answered','no_answer','refused','not_interested',
    'lead','callback','do_not_call','inaccessible',
    'no_opportunity'
  ));

alter table property_observations drop constraint <name from the query above>;
alter table property_observations add constraint property_observations_tenure_check
  check (tenure in (
    'rented','council','student','owner','unknown','no_opportunity'
  ));
```

**Notes on the knock:**

```sql
alter table knock_events add column notes text;
alter table knock_events add constraint knock_events_notes_len
  check (notes is null or length(notes) <= 280);
```

**Team read policy.** Postgres combines permissive policies with OR, so this
adds to the existing read-own policy rather than replacing it:

```sql
create policy "canvasser reads team knocks"
on knock_events for select to authenticated
using (
  exists (
    select 1 from assignment_members am
    where am.assignment_id = knock_events.assignment_id
      and am.canvasser_id  = auth.uid()
  )
);

-- The PK is (assignment_id, canvasser_id). A composite index is only usable
-- when its LEADING column is in the predicate, and this policy filters on
-- canvasser_id alone. Without this index every field read is a seq scan.
create index assignment_members_canvasser_idx
  on assignment_members (canvasser_id);

-- Latest-wins resolution. Filter columns first, sort column last.
create index knock_events_latest_idx
  on knock_events (assignment_id, uprn, occurred_at desc);
```

**Canvasser-supplied house numbers:**

```sql
create table address_observations (
  id              uuid primary key default gen_random_uuid(),
  client_event_id text unique not null,
  uprn            bigint not null references properties(uprn),
  canvasser_id    uuid not null references profiles(id),
  house_number    text not null,
  observed_at     timestamptz not null,
  constraint address_observations_number_len
    check (length(house_number) between 1 and 12)
);

create index address_observations_uprn_idx
  on address_observations (uprn, observed_at desc);

alter table address_observations enable row level security;

create policy "authenticated read labels"
  on address_observations for select to authenticated using (true);

create policy "canvasser writes own observations"
  on address_observations for insert to authenticated
  with check (canvasser_id = auth.uid());
```

The whole team must see corrections or they will disagree about door numbers,
which is why SELECT is open to `authenticated` rather than scoped.

**Derived `is_immediate`.** Never sent by the client. `now()` cannot be used —
an offline lead syncs hours later:

```sql
create or replace function leads_set_is_immediate()
returns trigger
language plpgsql
security definer                    -- office may not read knock_events
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
  from knock_events where id = new.knock_event_id;

  -- Europe/London, not UTC. A 23:30 BST booking is tomorrow in UTC and would
  -- silently stop being an immediate.
  new.is_immediate :=
    (new.booked_for at time zone 'Europe/London')::date
      = (coalesce(v_occurred, new.booked_for) at time zone 'Europe/London')::date;

  return new;
end;
$$;

create trigger leads_is_immediate_biu
before insert or update of booked_for on leads
for each row execute function leads_set_is_immediate();
```

**Views. `security_invoker` is mandatory.** A Postgres view runs with its
*owner's* privileges by default, which silently bypasses RLS on every table it
reads:

```sql
create or replace view v_latest_knock with (security_invoker = true) as
select distinct on (ke.assignment_id, ke.uprn)
       ke.assignment_id, ke.uprn, ke.outcome, ke.canvasser_id,
       ke.occurred_at, ke.notes
from knock_events ke
order by ke.assignment_id, ke.uprn,
         ke.occurred_at desc,   -- latest wins
         ke.synced_at   desc;   -- tie-break: device clocks drift

create or replace view v_door_label with (security_invoker = true) as
select
  p.uprn,
  coalesce(ao.house_number, pa.house_number) as house_number,
  pa.building_name,
  pa.street_name,
  (ao.uprn is not null)                      as canvasser_supplied
from properties p
left join property_addresses pa on pa.uprn = p.uprn
left join lateral (
  select house_number, uprn
  from address_observations
  where uprn = p.uprn
  order by observed_at desc
  limit 1
) ao on true;
```

`v_latest_knock` is written here and **reused by Stage 9**. One resolution
rule, one place.

**Address fetch RPC.** PostgREST puts `.in()` filters in the query string;
2,000 UPRNs is roughly 20 KB of URL, past what most proxies accept. This also
means the client never sends a UPRN list at all:

```sql
create or replace function addresses_for_assignment(p_assignment_id uuid)
returns table (uprn bigint, house_number text, building_name text,
               street_name text)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select dl.uprn, dl.house_number, dl.building_name, dl.street_name
  from assignments a
  join v_door_label dl on dl.uprn = any(a.uprn_snapshot)
  where a.id = p_assignment_id;
$$;

-- Supabase grants EXECUTE to PUBLIC by default. Same discipline as Stage 4.
revoke execute on function addresses_for_assignment(uuid) from public;
grant  execute on function addresses_for_assignment(uuid) to authenticated;
```

`sub_building` is deliberately absent — admin-only, never reaches `/field`.

**No `log_knock_outcome` RPC.** Considered and rejected on evidence. The Stage 7
queue already sends knock → lead → observation sequentially with
client-generated row ids and 23505-as-duplicate replay, which self-heals a
partial failure. Rewriting the hardest module in the build to gain atomicity it
already achieves by replay is the wrong risk.

**8a acceptance:**

- [ ] Both pre-flight counts were 0 and are recorded in `docs/BUILD-LOG.md`.
- [ ] Constraint names were read from `pg_constraint`, not assumed.
- [ ] `'no_opportunity'` inserts succeed on both tables; an invalid value fails.
- [ ] A canvasser JWT reads a teammate's knock on a shared assignment.
- [ ] A canvasser JWT cannot read a knock on an assignment they are not a member of.
- [ ] A canvasser JWT still cannot update `leads.status`.
- [ ] `address_observations`: canvasser inserts own, cannot insert as another
      `canvasser_id`, can read all.
- [ ] A lead booked for the knock's own day gets `is_immediate = true`; next week
      gets `false`; a client-sent `is_immediate` is overridden by the trigger.
- [ ] A 23:30 booking on the knock's own day is still `is_immediate = true`
      (Europe/London, not UTC).
- [ ] Both views report `security_invoker` on; a canvasser reading
      `v_latest_knock` sees only permitted rows.
- [ ] `v_latest_knock` returns exactly one row per (assignment, uprn) after three
      knocks on the same door, and it is the newest.
- [ ] `addresses_for_assignment` tested under a real canvasser JWT, not as
      `postgres` or `service_role`; returns no `sub_building`.
- [ ] `lib/supabase/types.ts` regenerated and compiles.
- [ ] Every table still reports `rowsecurity = true`.

---

#### 8b — The logger

**Tabs.** `app/(field)/layout.tsx` holds the sync provider, the undo toast and
the tab bar. Four routes: Map, Logger, Leads, Profile.

**Logger screen:**

```
┌───────────────────────────┐
│  Door 24 of 214           │  sequence position, always present
│                           │
│        ╔═══════╗          │
│        ║  38   ║  ✎       │  v_door_label, tap to type the real number
│        ╚═══════╝          │
│      Small Street         │
│                           │
│   [ mini map · 120px ]    │  confirms the right house; collapsible
├───────────────────────────┤
│  ⋯  Other           56px  │
│  ★  Lead            72px  │  green
│  ⌂  Rented/Council  72px  │  red
│  ☺  Contact         80px  │  blue
│  ○  No Answer       96px  │  neutral
│  ── 16px safe gap ──      │
├───────────────────────────┤
│ Map  Logger  Leads  Prof  │
└───────────────────────────┘
```

**Button order is frequency-driven, and it is not a style choice.** No answer is
roughly six taps in ten and sits lowest and largest, where a one-handed thumb
rests. Lead is buffered from Contact by Rented/Council because a lead is the one
outcome a canvasser **cannot** undo once flushed — only the office can cancel
one. Lead's harder reach is deliberate: the canvasser has just had a
conversation, is stationary, and a two-second reach guards against a mis-tap.

**Outcome mapping — canonical:**

| Button | `knock_events.outcome` | Also writes |
|---|---|---|
| Lead | `lead` | `leads` row |
| Contact | `answered` | — |
| No Answer | `no_answer` | — |
| Rented/Council | `no_opportunity` | `property_observations`, `tenure='no_opportunity'` |
| Other → | `refused` · `do_not_call` · `inaccessible` · `callback` | — |

`do_not_call` lives under Other as a real enum value and is **never** recorded
as free text. It is the one outcome with a compliance consequence and must stay
queryable.

**Interaction rules:**

- One tap logs. No confirmation step.
- 400 ms input lock after each log — a double tap in the rain must not log two doors.
- `navigator.vibrate(40)` on log.
- Undo toast, 60 s countdown, single target, minimum 44 px, above the tab bar.
- The cursor is **manual**. It advances on log but never auto-jumps to "next
  unlogged" — that is Stage 10's claim mechanism and would send a whole team to
  the same door.
- Free scroll and a Skip action. The canvasser can move anywhere in the
  sequence without logging.
- Already-logged doors show their logged outcome inline, so the sequence is
  self-correcting on sight.
- Back returns to the previous door. A correction is a **new** knock event with
  a **new** `client_event_id`; `v_latest_knock` resolves it. Nothing is ever
  updated or deleted server-side — canvassers have no UPDATE or DELETE grant.

**Out-of-order banner.** Until Stage 5b, `uprn_snapshot` is the interim angular
sweep from the prop centroid, so numbers run 14, 2, 40, 8 on screen. Show a
one-line notice — *"Door order follows the interim sweep, not the street"* —
gated on `SEQUENCE_IS_ROUTE_DERIVED`, so 5b removes it by flipping one flag.

**Door label and the ✎ affordance.** The ladder is Stage 6's, with the sequence
as the always-present counter:

`"38"` → `"St. Giles Court"` → `"—"`, with `Small Street` beneath when known.

A missing label is the normal case for roughly 69% of doors. Never "Unknown",
never an error state. Tapping ✎ opens a **numeric-only** field pre-selecting the
already-chosen UPRN, writing one `address_observations` row through the queue as
its own op type. It is not an address search, an autocomplete, or a way to find
a door.

**Notes about door.** A `maxlength` of 280, enforced again by the CHECK.
Placeholder: *"e.g. side gate, dog, back extension"*. A visible line reading
**"Do not record names or contact details."** Notes are never parsed, never
searchable, and never used as identity.

Prefer structured chips — `Dog · Side entrance · Scaffolding · Empty` —
appended to the notes text. They are faster to tap and structurally cannot hold
personal data. Section 9's IP argument rests on this database holding
essentially no company data; a notes field full of names and numbers destroys
it.

**Lead follow-up.** Appointment time via quick chips — *Today PM · Tomorrow AM ·
Pick…* — because an iOS `datetime-local` picker is slow on a doorstep.
`is_immediate` is derived by the trigger and shown read-only as a confirmation.
A dismissed lead sheet keeps its draft, including its `client_event_id`, which
is generated once at the Lead tap and reused on submit.

**Queue integration.** Extend `lib/sync/ops.ts` and the existing `KnockEventOp`
payload with `notes` and `tenure`. Add `AddressObservationOp` as a separate op
type — a number correction is independent of an outcome log. Register both in
`validateOp`. Do not create a parallel op system and do not add a second
transport.

**Dexie.** Bump the version to add the `addresses` store keyed on `uprn`. Read
the current version from the code; never assume it. Do **not** alter the
snapshot store's record shape — field devices have populated caches. An absent
or empty `addresses` store means labels do not render and everything else works
unchanged: fail open.

The `held_undo` status and `eligible_at` need no version bump — `status` is
already indexed and `eligible_at` is not queried by index.

**Map tab.** Dot colour follows the amended invariant 2: neutral unlogged,
neutral logged no-answer, green lead, blue contact, red no-opportunity. Icon or
fill shape always accompanies colour. Colour reflects the **current assignment
only**.

**Attribution.** `components/field/field-map.tsx` and
`components/admin/prop-drawer.tsx` gain the MHCLG/EPC line alongside the
existing block.

**Leads tab.** Read-only, this canvasser, today, chronological. **Never
aggregated by street or prop** — a per-street lead count is a cherry-picking
signal and breaches invariant 2.

**Profile tab.** Name, role, sign out, and the queue depth plus last-sync time
that Stage 7 exposes and currently has nowhere to live.

**No `navigator.geolocation` anywhere in Stage 8.** Not for auto-advance, not to
centre the mini map, not "just to help". Zero occurrences, grepped. Auto-advance
from position is Stage 16 and carries the whole Section 8 compliance weight.

**Seams.** `docs/STAGE-8-SEAMS.md` is created this stage and every row is
satisfied. See Section 6, Stages 5b and 16.

**8b acceptance:**

- [ ] Logging a knock offline, then reconnecting, produces exactly one row.
- [ ] A logged door visibly changes state immediately, before sync.
- [ ] `lead` produces one `knock_events` row and one `leads` row sharing ONE
      `client_event_id`, generated once at the Lead tap. Replaying the same id
      after a partial failure completes cleanly with no duplicate knock.
- [ ] Rented/Council produces one `knock_events` row with
      `outcome='no_opportunity'` and one `property_observations` row with
      `tenure='no_opportunity'`, sharing one `client_event_id`.
- [ ] Every write goes through `lib/sync/queue.ts`. Grep `components/` and
      `app/(field)/` for `supabase.from(` and `supabase.rpc(` — zero results
      outside a read path.
- [ ] Undo within 60 s leaves **zero** rows in Postgres — verified by querying,
      not by the UI.
- [ ] Force-quitting inside the undo window and reopening promotes the row and
      it syncs. Nothing is stranded.
- [ ] Logging the same door twice leaves two `knock_events` rows and exactly one
      `v_latest_knock` row, showing the newer outcome.
- [ ] A 400 ms double tap logs one door, not two.
- [ ] Typing a house number writes one `address_observations` row and the label
      updates from `v_door_label` on next read.
- [ ] A door with no label renders cleanly with the ✎ affordance — never
      "Unknown", never an error.
- [ ] `grep -r "navigator.geolocation"` over the repo returns zero results.
- [ ] Every row of `docs/STAGE-8-SEAMS.md` is ticked.
- [ ] Numbers appearing out of sequence is EXPECTED and the banner explains it.
      The snapshot ordering is untouched.
- [ ] Tested on a real phone, one-handed, at arm's length.

---

## H. Section 6, Stage 5b — append this seam contract

> **Seam contract added 2026-09-17.** Stage 8 ships these as named modules
> returning safe defaults. Stage 5b swaps the source and touches nothing else.
>
> | Seam | Stage 8 | 5b swaps to |
> |---|---|---|
> | `lib/field/sequence.ts` → `getSequence()` | `uprn_snapshot` order | route-derived order |
> | `lib/field/sequence.ts` → `SEQUENCE_IS_ROUTE_DERIVED` | `false` | `true` |
> | map layer id `route-line` | registered, renders nothing | `route_geom` |
> | `getCurrentStreetLabel()` | street from `v_door_label` | `route_steps.street_name` |
> | header instruction slot | renders nothing | spur / crossing text |
> | out-of-order banner | shown while the flag is `false` | auto-hides |

---

## I. Section 6, Stage 16 — append this seam contract

> **Seam contract added 2026-09-17.**
>
> | Seam | Stage 8 | 16 swaps to |
> |---|---|---|
> | `lib/field/position.ts` → `getRoutePosition()` | returns `null` | snapped scalar |
> | logger auto-advance | disabled while null | enabled on opt-in |
> | `positionEnabled` | client-side, default `false` | per-assignment opt-in |
> | map layer id `you-are-here` | registered, hidden | live marker |
>
> Stage 8 contains **zero** `navigator.geolocation` calls. The first one in the
> repo belongs to Stage 16.

---

## J. Section 6, Stage 9 — edit in place

Replace the `v_prop_completion` definition's `knock_events` join with
`v_latest_knock`, and add:

> **Amended 2026-09-17.** Latest-outcome-wins is now the resolution rule, so
> completion counts read `v_latest_knock`, not `knock_events` directly. Counting
> raw events would double-count a corrected door. The view is
> `security_invoker`, defined in Stage 8a, and is the single place the rule
> lives.

---

## K. Section 6, Stage 10 — append this note

> **Amended 2026-09-17.** Re-scoped. The next-door display is no longer built
> from scratch — Stage 8's Logger tab already renders one door at a time. Stage
> 10 adds the claim broadcast, teammate lines, and auto-advance to the next
> *unclaimed* door, wrapping `lib/field/cursor.ts`. Stage 8's cursor is manual
> precisely so a whole team does not advance onto the same door before claims
> exist.

---

## L. Section 7 — build order

```
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 1c → 8a → 8b → 14 → [gate] → 15
```

> **Note 2026-09-17.** Stage 8 is split. 8a is schema only and is routed like
> Stage 2. Track B's "harden Stage 7 to full" is closed — the queue already
> shipped to the full specification.

---

## M. Section 10 — model routing table

Replace the Stage 8 row with:

| Stage | Model | Why |
|---|---|---|
| **8a Knock schema** | **Frontier**, highest reasoning setting | Irreversible CHECK changes on empty tables, RLS policy, `security_invoker` views, a `security definer` trigger. Stage 2-class. |
| 8b Knock logger | Grok 4.6 | Sits on a proven queue; UI-heavy and well specified |

---

## N. Section 12 — Track A day plan

> **Amended 2026-09-17.** Day 4 now carries 6 · 7 · 1c · 8a · 8b and will run
> long. If it does, cut in this order: Profile tab to a stub (queue depth moves
> into the Map tab header), then Leads tab to a stub, then the mini map, then
> structured note chips. Do **not** cut the undo window, the team read policy,
> or `v_latest_knock` — each is load-bearing for correctness rather than polish.

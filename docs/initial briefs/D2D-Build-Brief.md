# D2D Canvassing Platform — Full Build Brief

**Repo:** `nakolabs-d2d` (empty, fresh)
**Build type:** ground-up. No prior code is carried over.
**Stages:** 0 → 14, plus 15 and 16 which are gated.
**Estimated:** ~28 hours of agent sessions.

> **Two tracks.** Track A is a demo cut for this week — see Section 12. Track B is everything else, afterwards. Every Track A stage is a genuine subset of the full stage, not a throwaway prototype. Nothing built in Track A gets binned.

---

## 0. Instructions for the coding agent

Read this section first. It governs everything below.

**Nothing exists yet.** There is no prior codebase, no prior schema, no prior migrations. Do not look for them, do not attempt to migrate from anything. The repo contains a `.env.local` and nothing else.

**One stage per session.** Do not begin the next stage. Do not scaffold ahead "to save time later" — it creates files the next session then has to reconcile.

**Every stage ends with its acceptance checklist run and reported line by line.** A stage is not complete because the build passes.

**Migrations are append-only.** One numbered SQL file per stage in `supabase/migrations/`. Never edit a migration that has been applied.

**One sync path only.** All offline writes go through the queue module built in Stage 8. If you find yourself writing a second sync implementation in a later stage, stop — you have misread the codebase.

**RLS on every table. Default deny.** No exceptions, including tables only admins touch.

**PostGIS types are fixed:** `geometry(Point,4326)` and `geometry(Polygon,4326)` throughout. Cast to `::geography` only for distance calculations. Do not mix the two as column types.

**No new dependency** without stating the reason and the alternative rejected. Prefer what is already in `package.json`.

**British English** in all user-visible strings.

**Never add scoring, ranking, colour-coding or any quality signal to the canvasser field view.** This is architectural, not stylistic. See Section 3, rule 2.

---

## 1. What this is

A canvassing management platform for a Bristol home-improvements company.

It exists to answer one question no one there can currently answer:

> *"We knocked Bishopston six weeks ago. Which doors are left, and when were they last hit?"*

Everything in this build serves that sentence. If a feature does not help answer it, it is not in scope.

**Three user roles:**

- **admin** — draws props, allocates them, sees everything
- **office** — manages same-day appointment slots and settles lead outcomes
- **canvasser** — works an allocated prop, logs knocks

---

## 2. Glossary

All terms below are resolved. There is nothing left to infer.

| Term | Meaning |
|---|---|
| **prop** | One polygon drawn around an area. One prop = one polygon = one team for one day. |
| **team** | One or two canvassers. Props are allocated to teams of 1s or 2s at the start of the day. |
| **duo** | A team of two. |
| **knockable door** | A UPRN inside the prop polygon, excluding No Cold Calling Zone properties. |
| **lead** | A knock outcome where the householder agreed to a sales appointment. |
| **immediate** | An appointment booked for the same day. |
| **confirmed** | A lead the office has verified by phone. |
| **sale** | Sales rep attended the lead and closed on the day. |
| **PM** | *Pitch & Miss.* Rep attended but did not close. |
| **blowout** | Not sat, no pitch — usually a cancellation of some kind. The rep never got in front of the customer. |
| **re-app** | Rescheduled appointment. **Non-terminal** — the lead returns to the pipeline with a new date. |
| **UTC** | *Unable To Contact.* Office could not reach the lead. |
| **BTC** | *Back To Canvasser.* Lead returned to the canvasser. |

**Consequence for the data model:** because one prop is one polygon for one team for one day, the allocation *is* the shift. There is no separate shift entity. `assignments` carries the date, the team, the rotation state and the frozen snapshot.

**Consequence for the intelligence layer:** lead *quality* is measurable, not just lead volume. A prop producing ten leads that all go UTC is worse than a prop producing four leads with two sales. The recommender in Stage 15 scores on sale rate, not lead count.

The six outcomes diagnose different problems and must not be collapsed into "converted / didn't":

- **UTC** — the contact details coming off that prop are bad. A canvasser-quality problem, not an area problem.
- **blowout** — the lead agreed at the door but never sat. Soft commitment; often a pitch problem.
- **PM** — a real appointment that did not close. The area produces genuine interest but the wrong fit.
- **re-app** — friction in scheduling, not in interest. Counts as still-live, never as a failure.

**Lead status is a lifecycle, not a label.** `pending` and `re_app` are non-terminal. `sale`, `pm`, `blowout`, `utc`, `btc` and `cancelled` are terminal. A visit's outcome data is only usable by the recommender once no non-terminal leads remain against it.

---

## 3. Architectural invariants

Seven rules. Every one of them exists because breaking it costs more later.

1. **Coverage is derived, never stored.** This is a rule about *where the truth lives*, not about whether coverage is a feature — it is the headline feature. Coverage is computed on read from `knock_events` against the assignment snapshot. There is no `coverage` table holding a second copy. A second copy has to be kept in sync from every write path (live knock, delayed offline sync, corrected outcome, deleted event), one path eventually gets missed, and the two disagree with no way to tell which is right. A view cannot drift.

2. **No scoring in the field view.** Canvassers who can see which doors score well will cherry-pick them, and the coverage data stops meaning anything. Admins see intelligence. Canvassers see the sequence.

3. **Canvasser observations outrank all public data.** Highest confidence tier.

4. **Offline-first and idempotent.** Every write carries a `client_event_id`. Re-syncing the same event twice must be a no-op.

5. **A door's identity is its UPRN dot on the map.** There is no address text, no house number, no autocomplete. Tapping the dot is the interaction.

6. **Routes are deterministic, not optimal.** The route a prop gets is generated by a fixed rule and is reproducible from the visit number. It is not solved for shortest or best — that needs calibration data that does not exist, and it would destroy the property that makes routes useful, which is comparability across visits. See Stages 1b and 5b.

7. **Position is a scalar, never a coordinate.** Location may be used to place a canvasser on their route. The raw fix is snapped to the route line on the device and discarded there; only the distance along the route is transmitted. No coordinate history is ever stored, and no view renders a movement trail. See Stage 16 and Section 8.

---

## 4. Prerequisites

Complete all of these before Stage 0.

**Accounts:**

- Supabase project (free tier is fine)
- MapTiler account — free tier, 100k loads, no card
- Vercel account, linked to the GitHub repo

**`.env.local` in the repo root:**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_MAPTILER_KEY=
```

The service role key is server-side only. It must never appear in a `NEXT_PUBLIC_` variable or reach the client bundle. Stage 0 verifies this.

**Data downloads:** exact sources, URLs and file locations are in **Section 13**. Read it before Stage 1. One of the three has a lead time measured in days, not minutes — deal with it first.

**Known operational gotcha:** Supabase free projects pause after seven days of inactivity. Add a keepalive GitHub Action cron on day one, before you forget and lose a demo to it.

---

## 5. `AGENTS.md` — create this before Stage 0

Cursor's own Next.js evaluations show a large gap for its in-house models between running with and without an `AGENTS.md` present. This file is the highest-leverage thirty minutes in the whole build. Put it in the repo root.

```markdown
# nakolabs-d2d

Canvassing management platform. Next.js 15 App Router, TypeScript, Tailwind,
Supabase (Postgres + PostGIS + Auth), MapLibre GL JS, MapTiler tiles,
Terra Draw, Dexie, Vercel.

## Hard rules

- Coverage is DERIVED from knock events. Never create a coverage table.
- No scoring, ranking or colour-coding in any `/field` route. Admin only.
- All offline writes go through `lib/sync/queue.ts`. Never write a second sync path.
- Every table has RLS enabled with default-deny policies.
- PostGIS columns are `geometry(Point,4326)` / `geometry(Polygon,4326)`.
  Cast `::geography` for distances only.
- Every client-originated write carries a `client_event_id` (uuid v4, generated
  on device). Re-sync must be idempotent.
- Service role key is server-only. Never in a `NEXT_PUBLIC_` var.
- British English in user-facing strings.

## Structure

app/(admin)   — prop drawing, allocation, coverage, dashboard
app/(office)  — appointment slots, lead outcome settlement
app/(field)   — canvasser view; offline-capable
lib/supabase  — client + server factories, generated types
lib/sync      — Dexie queue, the only write path from the field
lib/geo       — PostGIS RPC wrappers, rotation maths
supabase/migrations — append-only, numbered

## Vocabulary

prop = one polygon = one team for one day (table: `territories`)
team = 1 or 2 canvassers (tables: `assignments` + `assignment_members`)
lead outcomes: sale | pm (pitch & miss) | utc (unable to contact) | btc (back to canvasser)

## Conventions

- Server Components by default. `"use client"` only where hooks or maps require it.
- Supabase types generated to `lib/supabase/types.ts`; regenerate after every migration.
- No component library. Tailwind only.
- Field UI targets one-handed phone use: minimum 44px tap targets, bottom-anchored actions.
```

---

## 6. The stages

Each stage is one Cursor session. The **prompt** block is paste-ready.

---

### Stage 0 — Scaffold, env verification, deploy skeleton

**Why deploy on day one:** iOS blocks geolocation and several PWA behaviours on non-HTTPS origins. Discovering that in week three is expensive.

**Build:** `create-next-app` with TypeScript, Tailwind, App Router. Supabase client and server factories. A `/health` route that confirms all four env vars resolve and the Supabase connection succeeds. Push to GitHub, connect Vercel, deploy.

**Acceptance:**
- [ ] `/health` returns green for all four env vars on the deployed Vercel URL.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` does not appear anywhere in the client bundle (grep the build output).
- [ ] Keepalive GitHub Action committed and its first run succeeded.

> **Prompt:** Implement Stage 0 of D2D-Build-Brief.md. Scaffold the Next.js 15 app, Supabase factories, `/health` check, and the Supabase keepalive Action. Do not create any schema. Run the acceptance checklist and report each item.

---

### Stage 1 — Data ingest

**Build:** a Node script under `scripts/` that loads OS Open UPRN (Bristol subset) and NCCZ polygons into Postgres. Idempotent — re-running updates rather than duplicates. Flags `is_nccz` by spatial containment at ingest time, not at query time.

```sql
-- 001_extensions.sql
create extension if not exists postgis;
create extension if not exists pgcrypto;

-- 002_properties.sql
create table properties (
  uprn       bigint primary key,
  geom       geometry(Point,4326) not null,
  postcode   text,
  is_nccz    boolean not null default false,
  created_at timestamptz not null default now()
);
create index properties_geom_idx on properties using gist (geom);

create table nccz_zones (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  geom       geometry(Polygon,4326) not null,
  source     text,
  created_at timestamptz not null default now()
);
create index nccz_zones_geom_idx on nccz_zones using gist (geom);
```

**Two data notes before you start.**

*Projection.* Bristol's NCCZ dataset is published in EPSG:27700 (British National Grid). Reproject to 4326 at ingest. Do not store 27700 coordinates and convert at query time.

*Availability — confirmed, and it is the longest lead time in the project.* The Bristol NCCZ dataset is listed on data.gov.uk but **has no download link at all**; the page states there are no links to the data. Getting it means emailing the council. See Section 13 — do that before anything else.

**Do not let it block Stage 1.** Build the ingest path, load `nccz_zones` with two or three hand-drawn polygons, carry on. The real boundaries drop in later as a data load with no code change. Say plainly in the demo that the zones are placeholders — the automatic exclusion mechanism is the point, and that demos fine.

**Acceptance:**
- [ ] Bristol UPRN count is within a plausible range and spot-checked against a known postcode.
- [ ] All geometries are stored in 4326 regardless of source projection.
- [ ] Re-running the script changes no row counts.
- [ ] At least one property correctly flags `is_nccz = true`, verified by eye on a map.
- [ ] Every geometry is valid (`ST_IsValid`) and in SRID 4326.

---

### Stage 1b — Road network ingest

**Why this exists:** OS Open UPRN gives points, not streets. You cannot draw a route along roads you do not have. This is the data dependency the route layer re-introduces.

**Use OSM, not OS Open Roads.** Same Overpass pipeline as Stage 11, ODbL rather than an OS licence application, and it carries the turn topology OS Open Roads does not. Attribution required.

```
[out:json][timeout:180];
way["highway"~"^(residential|living_street|unclassified|tertiary|secondary|service|pedestrian|footway)$"]({{bbox}});
(._;>;);
out body;
```

Build a proper node/edge topology, not a bag of linestrings. The traversal in Stage 5b needs to know which segments meet at which junction.

```sql
create table road_nodes (
  id      bigint primary key,          -- OSM node id
  geom    geometry(Point,4326) not null
);
create index road_nodes_geom_idx on road_nodes using gist (geom);

create table road_segments (
  id           bigserial primary key,
  osm_way_id   bigint not null,
  from_node    bigint not null references road_nodes(id),
  to_node      bigint not null references road_nodes(id),
  name         text,
  highway      text not null,
  length_m     numeric not null,
  geom         geometry(LineString,4326) not null
);
create index road_segments_geom_idx on road_segments using gist (geom);
create index road_segments_nodes_idx on road_segments (from_node, to_node);
```

A useful side effect: `road_segments.name` gives street-name resolution for free, which was the original reason OS Open Roads and the DEL application existed. Both stay cancelled.

**Acceptance:**
- [ ] Junction nodes are shared between segments — a T junction resolves to one node referenced by three segments, not three coincident nodes.
- [ ] Re-running the ingest is idempotent.
- [ ] Every segment has a valid geometry and a non-zero length.
- [ ] OSM attribution visible wherever the route is drawn.

---

### Stage 2 — Full schema and RLS

**This is the highest-stakes stage in the build.** A schema mistake propagates into every subsequent stage. Use the strongest model available (Section 10).

```sql
-- 003_core.sql

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  role       text not null check (role in ('admin','office','canvasser')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table territories (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  geom            geometry(Polygon,4326) not null,
  visit_count     int not null default 0,
  last_visited_at timestamptz,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create index territories_geom_idx on territories using gist (geom);

create table assignments (
  id                 uuid primary key default gen_random_uuid(),
  territory_id       uuid not null references territories(id),
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
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  unique (territory_id, work_date)
);

create table assignment_members (
  assignment_id     uuid not null references assignments(id) on delete cascade,
  canvasser_id      uuid not null references profiles(id),
  route_position_m  numeric,
  route_position_at timestamptz,
  primary key (assignment_id, canvasser_id)
);
-- trigger: reject a third member. A team is 1 or 2.
-- Duos bunny-hop: both work the same side, same route, leapfrogging door to door.
-- There is no side split and no per-canvasser door allocation. See Stage 5b.
-- route_position_m is CURRENT position only. Overwritten, never appended. See Stage 16.

create table knock_events (
  id                uuid primary key default gen_random_uuid(),
  client_event_id   text unique not null,
  assignment_id     uuid not null references assignments(id),
  canvasser_id      uuid not null references profiles(id),
  uprn              bigint not null references properties(uprn),
  outcome           text not null check (outcome in
                      ('answered','no_answer','refused','not_interested',
                       'lead','callback','do_not_call','inaccessible')),
  sequence_position int,
  occurred_at       timestamptz not null,
  synced_at         timestamptz not null default now()
);
create index knock_events_assignment_idx on knock_events (assignment_id);
create index knock_events_uprn_idx on knock_events (uprn);

create table leads (
  id             uuid primary key default gen_random_uuid(),
  knock_event_id uuid not null references knock_events(id),
  uprn           bigint not null references properties(uprn),
  canvasser_id   uuid not null references profiles(id),
  booked_for     timestamptz,
  is_immediate   boolean not null default false,
  status         text not null default 'pending'
                   check (status in ('pending','re_app','sale','pm',
                                     'blowout','utc','btc','cancelled')),
  status_set_at  timestamptz,
  status_set_by  uuid references profiles(id),
  crm_ref        text unique,
  crm_last_synced_at timestamptz,
  notes          text
);
-- non-terminal statuses: 'pending', 're_app'

create table property_observations (
  id              uuid primary key default gen_random_uuid(),
  client_event_id text unique not null,
  uprn            bigint not null references properties(uprn),
  canvasser_id    uuid not null references profiles(id),
  tenure          text check (tenure in ('rented','council','student','owner','unknown')),
  observed_at     timestamptz not null
);
```

**RLS shape:**

- `profiles` — read own row; admin reads all.
- `territories` — admin write, all roles read.
- `assignments` / `assignment_members` — admin writes; a canvasser reads only rows where they are a member.
- `knock_events` — canvasser inserts only against an assignment they belong to; reads only their own. Admin reads all.
- `leads` — canvasser inserts and reads own; office and the service role update `status`, `status_set_at`, `status_set_by`, `booked_for` only. A canvasser must not be able to set their own lead to `sale`.
- `property_observations` — canvasser inserts; admin reads all.

**Acceptance:**
- [ ] Every table reports `rowsecurity = true`.
- [ ] A canvasser JWT cannot read another canvasser's knock events — tested, not assumed.
- [ ] A canvasser JWT cannot update `leads.status`.
- [ ] A lead moved to `re_app` remains visible in the pending pipeline.
- [ ] Inserting a third `assignment_members` row fails.
- [ ] `lib/supabase/types.ts` regenerated and compiles.

---

### Stage 3 — Auth and role routing

**Build:** Supabase Auth, email/password. Trigger creating a `profiles` row on signup, defaulting to `canvasser`. Three route groups with middleware enforcement. Login redirects by role: admin → `/admin`, office → `/office`, canvasser → `/field`.

**Acceptance:**
- [ ] Each role lands on its own route group and cannot reach the other two.
- [ ] Enforcement is server-side; removing the client guard does not grant access.
- [ ] Signed-out access to any protected route redirects to login.

---

### Stage 4 — Prop drawing and door count

**Build:** admin map with MapLibre + MapTiler + Terra Draw polygon tool. On save, an RPC returns the knockable count.

```sql
create or replace function count_knockable(poly geometry)
returns table (total int, knockable int, excluded int)
language sql stable as $$
  select count(*)::int,
         count(*) filter (where not is_nccz)::int,
         count(*) filter (where is_nccz)::int
  from properties where ST_Within(geom, poly);
$$;
```

Counting happens in Postgres. Never fetch points to the client to count them.

**Turf size warning.** Canvassing practice across the political field-organising world converges on walk lists of roughly 40–150 doors, sized to a one-to-two-hour shift, and on not letting a turf straddle a main road. Show a soft warning above 150 knockable doors and when the polygon crosses an A-road. A warning, not a block — the admin knows things the polygon does not.

**Acceptance:**
- [ ] Drawing a polygon around a known street returns a count matching a manual check.
- [ ] A 300-door polygon triggers the size warning without preventing save.
- [ ] NCCZ properties appear in `excluded`, never in `knockable`.
- [ ] A self-intersecting polygon is rejected with a clear message, not a 500.
- [ ] A prop covering ~2,000 doors counts in under a second.

---

### Stage 5 — Allocation and rotation

**Why rotation:** returning to a prop and starting at the same corner at the same time of day means the same households are always missed. Rotation fixes this deterministically, with no calibration data required.

**Rule (deterministic — no randomness anywhere):**

```
n = territories.visit_count + 1
entry_vertex_index = n % (vertex count of the prop polygon)
sweep_direction    = (n % 2 == 0) ? 'cw' : 'ccw'
slot               = ['early','mid','late'][n % 3]
```

**Build:** admin picks a prop, a date, and one or two canvassers. On save, compute rotation, freeze `uprn_snapshot` (knockable UPRNs ordered by the sweep from the entry vertex), write `assignments` and `assignment_members`.

The snapshot is frozen at allocation. If the prop polygon is edited later, the already-allocated day is unaffected.

**Acceptance:**
- [ ] Allocating the same prop three times yields three different entry vertices and alternating directions.
- [ ] Rotation is reproducible: the same `visit_number` always gives the same entry vertex.
- [ ] `uprn_snapshot` excludes NCCZ and is ordered, not arbitrary.
- [ ] Two allocations for the same prop on the same date are rejected by the unique constraint.
- [ ] Editing the prop polygon does not alter an existing snapshot.

---

### Stage 5b — Route generation

**What this solves.** Standing on a prop with a partner, looking at a map, agreeing who goes where. That conversation costs ten or fifteen minutes of a shift and it happens every single time. A route that is already drawn when you press start removes the decision entirely.

**It is not an optimisation problem.** Do not reach for a solver. The requirement is a route that is *deterministic, reproducible, and follows sensible canvassing convention*. Consistency is the point — it is what makes visit 4 comparable to visit 1.

**Algorithm — greedy serpentine traversal:**

1. Clip the road graph to the prop polygon. Keep segments with at least half their length inside.
2. Entry node = the graph node nearest to polygon vertex `entry_vertex_index` (from Stage 5's rotation).
3. From the current node, choose the next unvisited edge by bearing relative to the arrival bearing: `sweep_direction = 'cw'` takes the leftmost available turn, `'ccw'` the rightmost. Deterministic tie-break on ascending `osm_way_id`.
4. When the current node has no unvisited edges, backtrack along the shortest path to the nearest node that does.
5. Cul-de-sacs are traversed as spurs — in and back out — and flagged as such in the route steps so the UI can say so rather than leaving someone wondering.
6. Terminate when every edge is visited, or at twice the clipped network's total length as a safety bound.

**Duos bunny-hop. Do not design around anything else.**

The team's method is that both canvassers work the same side of the road on the same route, leapfrogging each other door to door. This is fixed. It is not a thing the software gets to improve on — a tool that requires changing how a team already knocks does not get adopted, it gets abandoned in week two.

So there is **no side split and no per-canvasser door allocation**. One route, one order, both people on it.

What that does change is what the field app owes them. With a duo hopping along one sequence, the only question that matters at any moment is *which door is next and unclaimed*. That is the thinking the app removes.

**Door claiming (ephemeral, no table):**

```ts
// broadcast on channel assignment:{assignment_id}
{ type: 'claim' | 'release' | 'knocked',
  canvasser_id: string, uprn: number, sequence_position: number, at: string }
```

- Opening a door's outcome sheet broadcasts a `claim`. Logging broadcasts `knocked`. Backing out broadcasts `release`.
- Claims expire client-side after three minutes. A partner who walks off mid-claim must not lock a door forever.
- **Next door** = the lowest `sequence_position` in the snapshot that is neither knocked nor currently claimed by the partner. Shown large at the top of the field view with a Take button.
- Persisted truth is still `knock_events`. Claims are transport only and are never written to the database.
- Both offline at once can produce two knocks on one UPRN. Coverage counts distinct UPRNs so nothing breaks, but flag it on resync so they know.

**The route still covers both sides of every street.** Each road segment is traversed twice — once working the properties on each side — so the serpentine runs out along one side and back along the other. Crossing instructions therefore apply to everyone, duo and solo alike, which matches the existing rule of working one side and crossing back at a junction.

The left/right cross product is still computed, but it is used to decide *which pass a UPRN belongs to* during route construction. It is not used to divide a team.

**Snapshot ordering now comes from the route.** Each UPRN snaps to its nearest segment and is ordered by distance along the generated route. This replaces the vague "ordered by sweep from the entry vertex" — the walking order and the drawn line are now the same object, which is what makes `sequence_position` mean something.

**Rotation now does what it was supposed to.** A different entry node produces a genuinely different traversal, which produces a different door order, which means a different part of the prop gets worked at a given hour. That was the intent of rotational starting points and it did not previously have a mechanism behind it.

```sql
create table route_steps (
  id            bigserial primary key,
  assignment_id uuid not null references assignments(id) on delete cascade,
  step_index    int not null,
  segment_id    bigint references road_segments(id),
  street_name   text,
  instruction   text not null,
  is_spur       boolean not null default false,
  cumulative_m  numeric not null,
  geom          geometry(LineString,4326) not null,
  unique (assignment_id, step_index)
);
```

`instruction` is plain text, generated at build time, British English: *"Elm Road — continue to the end"*, *"Left into Ashley Grove"*, *"Spur — Priory Close, return the way you came"*, *"Cross to the far side and work back"*.

**Acceptance:**
- [ ] The same prop and the same `visit_number` always generate an identical route. Run it three times and diff the geometry.
- [ ] A different `visit_number` produces a materially different traversal, not the same route reversed.
- [ ] Every knockable UPRN in the snapshot lies within 40m of the route line.
- [ ] `uprn_snapshot` order matches distance along `route_geom`.
- [ ] A prop containing a cul-de-sac produces a spur step, and the route does not dead-end there.
- [ ] Every UPRN is assigned to exactly one pass, and no property appears twice in the snapshot.
- [ ] A street with properties on both sides is traversed twice in the route, not once.
- [ ] Route generation for a 200-door prop completes in under five seconds.

---

### Stage 6 — Field prop view and offline cache

**Build:** canvasser opens `/field`, sees today's prop. Dots on the map in walking order, plus a list view. On open, the full snapshot is written to Dexie. The app must be fully usable in airplane mode from that point.

Header line: *"Visit 3 · starting Elm Road end · anticlockwise · 214 doors"*.

**Acceptance:**
- [ ] Load the prop, enable airplane mode, force-quit, reopen — the prop renders from Dexie.
- [ ] Dot order matches `uprn_snapshot` order.
- [ ] **Tap accuracy test on a real phone, on a real terraced street, at zoom 19.** Bristol terraces put dots a few metres apart. If tapping the right door is unreliable, stop and redesign the target size before building Stage 8 on top of it.

---

### Stage 7 — Sync queue

**Build this as a standalone module before anything writes through it.** It is the hardest correctness problem in the build and the one most likely to be silently wrong.

`lib/sync/queue.ts`:

- Dexie table of pending writes, each with `client_event_id` (uuid v4, generated on device)
- Flush on reconnect, on app focus, and on a timer
- Exponential backoff on failure
- Server-side idempotency via the unique constraint on `client_event_id` — a duplicate insert is caught and treated as success, not an error
- Ordering preserved per assignment
- Queue depth and last-sync time exposed to the UI

**Acceptance:**
- [ ] 50 queued events flush without loss.
- [ ] Killing the app mid-flush and reopening produces no duplicates and no losses.
- [ ] Deliberately replaying the same `client_event_id` twice results in one row.
- [ ] Server rejection with a 4xx does not retry forever; it surfaces to the user.
- [ ] Queue survives a browser restart.

---

### Stage 8 — Knock logger

**Build:** tap a dot → outcome sheet → write via the Stage 7 queue. Eight outcomes from the schema. Choosing `lead` opens a short follow-up: appointment time, and an *immediate* toggle.

Outcome buttons are large, bottom-anchored, one-handed. This is used standing on a doorstep in the rain.

`sequence_position` is set from the dot's index in the snapshot.

**Acceptance:**
- [ ] Logging a knock offline then reconnecting produces exactly one row.
- [ ] A logged door visibly changes state immediately, before sync.
- [ ] `lead` creates one `knock_events` row and one `leads` row, atomically.
- [ ] Every write goes through `lib/sync/queue.ts` — no direct Supabase calls in field components.

---

### Stage 9 — Prop completion

**This answers "how much of this prop have we worked through" — from knock events, not from GPS.** A location trace shows someone stood near a door. A knock event shows they knocked it.

```sql
create or replace view v_prop_completion as
select
  a.id as assignment_id,
  a.territory_id,
  a.visit_number,
  cardinality(a.uprn_snapshot)                                    as knockable,
  count(distinct ke.uprn)                                         as worked,
  count(distinct ke.uprn) filter (where ke.outcome = 'answered')   as answered,
  count(distinct ke.uprn) filter (where ke.outcome = 'lead')       as leads_raised
from assignments a
left join knock_events ke on ke.assignment_id = a.id
group by a.id;
```

**Report three numbers, never one percentage.** "62% complete" hides the difference between a prop that was half-walked and one where half the doors did not answer — and those two call for opposite decisions next time. Show *worked*, *answered*, *doors remaining*.

**Acceptance:**
- [ ] Numbers reconcile against a hand-counted test prop.
- [ ] A duplicate re-sync does not inflate `worked`.
- [ ] Canvasser sees only their own current prop; admin sees all.

---

### Stage 10 — Next door and partner position

**Bunny-hopping changes what this feature is.** Two people leapfrogging along one sequence are, by definition, always within a door or two of each other. "Leon is 60m ahead" is useless information. The question worth answering is *which door do I take next*.

**Primary display — the next door.** The lowest `sequence_position` in the snapshot that is neither knocked nor claimed by the partner. Rendered large at the top of the field view, with the street name and a Take button. Tapping Take claims it and opens the outcome sheet.

This is the feature. Everything else on this screen is secondary to it.

**Secondary display — where the partner is.** One line: `Leon · on #16`. Sourced from the partner's active claim, or their last knock if they have no claim open. If Stage 16 is active and neither is available (start of shift, nothing knocked yet), fall back to the nearest sequence position to their `route_position_m`.

That last case is the one that matters at the drop-off. Before either of you has knocked anything, the app can still say who is starting where.

**Transport:** Supabase Realtime broadcast on `assignment:{assignment_id}`. Ephemeral. The only durable position is the overwritable column on `assignment_members`.

**Offline:** next-door is computed from the local Dexie snapshot and works with no signal — it simply loses partner claims and may occasionally suggest a door the partner has just taken. Show partner data greyed with its age. Never render a stale claim as live.

**Acceptance:**
- [ ] Two sessions on the same assignment never show the same next door while both are connected.
- [ ] A claim left open for over three minutes expires and the door returns to the pool.
- [ ] Next door is correct offline, computed from Dexie alone.
- [ ] With Stage 16 off and nothing yet knocked, the partner line shows an honest empty state rather than a guess.
- [ ] Solo assignments hide the partner line and keep the next-door display.

**Deferred:** the lock-screen widget needs a native shell. Bundle it with any future Capacitor work.

---

### Stage 11 — Amenity cache (toilet locator)

**Why:** small feature, disproportionate field value, and it signals the product was built by someone who does the job. That matters if this is ever pitched.

**Source:** OpenStreetMap via Overpass. **ODbL — attribution required.** Show "Map data © OpenStreetMap contributors" in the panel.

**Ingest, never runtime.** Overpass is called by a script and a monthly GitHub Action, not by the app.

```
[out:json][timeout:90];
(
  node["amenity"="toilets"]({{bbox}});
  way ["amenity"="toilets"]({{bbox}});
  node["amenity"~"^(pub|cafe|fast_food|library|community_centre)$"]({{bbox}});
  node["shop"="supermarket"]({{bbox}});
);
out center tags;
```

```sql
create table amenities (
  id             bigserial primary key,
  osm_id         text unique not null,
  kind           text not null,
  name           text,
  geom           geometry(Point,4326) not null,
  opening_hours  text,
  wheelchair     text,
  fee            boolean,
  access         text,
  last_refreshed timestamptz not null default now()
);
create index amenities_geom_idx on amenities using gist (geom);
```

Amenities within the prop bbox + 300m are cached into Dexie alongside the snapshot. Distances are computed from the last logged knock, **not** from live GPS.

**Acceptance:**
- [ ] Ingest is idempotent on re-run (`osm_id` conflict → update).
- [ ] List renders in airplane mode.
- [ ] No `navigator.geolocation` call anywhere in this feature.
- [ ] OSM attribution visible.

---

### Stage 12 — CRM outcome sync and visit history

Two halves, both about closing the loop.

#### 12a — CRM outcome sync

The CRM exposes an API key from its dashboard settings tab, so this is technically unblocked. **Pull-only, scheduled, and minimised.**

*Data minimisation is the design constraint, not a nicety.* The case for this software being your own IP rests on it being built on public data rather than company data. Pulling a status enum against a lead row you already own keeps almost nothing of theirs in your database. Pulling names, numbers, addresses or notes does not. Take the reference and the status. Nothing else.

```sql
create table crm_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  rows_seen      int,
  rows_updated   int,
  rows_unmatched int,
  error          text
);

create table crm_status_map (
  crm_value   text primary key,
  lead_status text not null
);
```

**Build:** a server-only route hit by a daily Vercel Cron. It reads the CRM's lead export, matches on `leads.crm_ref`, and updates `status`, `status_set_at`, `booked_for`.

**Rules:**

1. **Server-only key.** `CRM_API_KEY` is never a `NEXT_PUBLIC_` variable and never reaches the client bundle.
2. **Mapping is data, not code.** CRM status strings live in `crm_status_map`. They will change, and a redeploy should not be needed when they do.
3. **Unmatched is reported, never guessed.** A CRM row that matches no lead, or a status string absent from the map, increments `rows_unmatched` and is surfaced. Never coerce it to the nearest-looking status.
4. **`re_app` is not an ending.** It updates `booked_for` and leaves the lead non-terminal.
5. **Idempotent.** Running the sync twice on the same export changes nothing the second time.
6. **Manual fallback stays.** `/office` keeps a settlement screen for leads with no `crm_ref` and for days the sync fails. Do not delete it once the sync works.

**Acceptance:**
- [ ] Running the sync twice produces zero changes on the second run.
- [ ] Inspecting a synced `leads` row shows no CRM field beyond the ref and the status — no name, number, address or note.
- [ ] An unknown CRM status string increments `rows_unmatched` and appears in the run log.
- [ ] `re_app` updates `booked_for` and the lead stays in the pending pipeline.
- [ ] `CRM_API_KEY` is absent from the client bundle (grep the build output).
- [ ] A failed run writes an `error` and does not partially apply.

#### 12b — Visit snapshot

On closing an assignment, write one immutable row.

```sql
create table territory_visits (
  id                  uuid primary key default gen_random_uuid(),
  territory_id        uuid not null references territories(id),
  assignment_id       uuid not null references assignments(id) unique,
  visit_number        int  not null,
  slot                text not null,
  opened_at           timestamptz not null,
  closed_at           timestamptz not null,
  knockable           int not null,
  worked              int not null,
  answered            int not null,
  leads_raised        int not null,
  leads_sale          int not null default 0,
  leads_pm            int not null default 0,
  leads_blowout       int not null default 0,
  leads_utc           int not null default 0,
  leads_btc           int not null default 0,
  outcomes_settled_at timestamptz
);
```

Coverage counts are written at close. Lead outcome counts fill in as the sync settles them. `outcomes_settled_at` is set when no lead against that assignment remains `pending` or `re_app`. Stage 15 uses only rows where it is non-null.

Historic aggregates must never be recomputed from live data. Outcomes get amended, and the recommender needs a stable series.

**Acceptance:**
- [ ] Closing an assignment writes exactly one `territory_visits` row and increments `territories.visit_count` once, including after an offline period.
- [ ] Editing a knock outcome afterwards does not alter the stored coverage counts.
- [ ] A lead sitting at `re_app` prevents `outcomes_settled_at` from being set.
- [ ] Settling the last non-terminal lead sets it.

---

### Stage 13 — Immediates board

**Why:** canvassers on shift need to know which same-day slots are free. The original idea was to surface this by reading WhatsApp, which is not buildable — see Section 9. This is the same need, solved properly.

```sql
create table appointment_slots (
  id         uuid primary key default gen_random_uuid(),
  slot_date  date not null,
  slot_time  time not null,
  status     text not null default 'free' check (status in ('free','held','booked')),
  held_by    uuid references profiles(id),
  held_until timestamptz,
  lead_id    uuid references leads(id),
  notes      text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
```

Office creates and closes slots. Canvassers read, and can place a ten-minute auto-expiring hold while closing at the door. Supabase Realtime on the table — a stale board is worse than no board.

**Acceptance:**
- [ ] Two canvassers cannot hold the same slot; the second attempt fails cleanly with a clear message.
- [ ] Expired holds return to `free` automatically.
- [ ] An office change reaches a field device within two seconds.
- [ ] Offline greys the board with a timestamp and blocks holds.

**Process dependency:** this only works if the office maintains it. Confirm they will before building, or it ships dead.

---

### Stage 14 — Coverage map, dashboard, seed and polish

**Coverage map:** the fog-lift. Knocked doors reveal; unworked doors stay dim. MapLibre feature-state driven from knock events. This is the moment the demo lands.

**Dashboard:** doors worked per prop per week, answer rate by slot, lead outcomes broken down by sale / PM / UTC / BTC, props not visited in over N weeks.

**Seed:** a script generating a realistic demo dataset — three props, two weeks of history, plausible outcome distribution. Run the demo from seeded data, never from an empty database.

**Acceptance:**
- [ ] Full demo run end to end, timed, twice. The second run is the one that finds the break.
- [ ] Coverage map renders 2,000 dots without stutter on a mid-range phone.
- [ ] Seed script is repeatable from empty.

---

### Stage 15 — Prop recommender (gated)

**Do not build until** `territory_visits` holds at least eight rows with `outcomes_settled_at` set, across at least four distinct props. Below that threshold the engine has nothing to learn from and would output a confident-looking number built on noise.

**Below the gate, the UI shows "Insufficient visit history" — not a placeholder score.**

**Inputs:**

- days since last visit
- completion of last visit — unfinished props rank high
- **sale rate** — `leads_sale ÷ worked`, the primary quality signal
- PM rate — real appointments that do not close; a different problem from UTC and worth separating
- blowout rate — leads that never sat; a soft-commitment signal, usually a pitch problem rather than an area one
- UTC rate — a high rate suggests bad contact data coming off that prop, not a bad area
- answer rate by slot — which time bucket actually gets doors open
- visit count — diminishing returns on repeat visits

**Scoring:** weighted sum, weights in a config table, not hard-coded. Start equal and calibrate against real outcomes. The weights are what gets tuned; make them trivially editable.

**Visibility:** admin only. Never the field view — invariant 2.

**Acceptance:**
- [ ] Gate enforced; synthetic data below threshold produces the insufficient-history state.
- [ ] Changing a weight in config changes the ranking with no redeploy.
- [ ] Score is reproducible from a fixed dataset.
- [ ] Feature flag off leaves no trace in the field bundle.

**Note on why this stage matters commercially:** coverage tracking is table stakes — Badger Maps and SPOTIO both do it. Saturation-aware re-canvass scheduling scored on lead quality is what neither does. If this platform is ever licensed, Stages 5 and 15 are what is being licensed. Everything else is the price of entry.

---

### Stage 16 — Route position

**This replaces the location-pings design entirely.** No breadcrumb table, no coordinate history, no trail.

**The mechanism:**

1. The device takes a position fix.
2. The device snaps it to `route_geom` and computes distance along the line.
3. **The device discards the coordinate.** It is never transmitted and never stored.
4. Only `route_position_m` — a single number — is sent, and it overwrites the previous value.

What this gives you: a "you are here" marker on the drawn route, partner position before either canvasser has knocked anything, and live progress along the prop. What it does not give anyone, including you, is a record of where a person has been. There is nothing to reconstruct a movement trail from, because the only thing stored is a distance along a line that both canvassers are already walking together.

This is the least intrusive means of getting the outcome, which is the standard Section 8 describes. It is still location processing and Section 8 still applies — but the thing that made the original design uncomfortable, a retained history of an individual's movements, does not exist here.

```sql
-- no new tables. Stage 2 already added:
--   assignment_members.route_position_m   numeric
--   assignment_members.route_position_at  timestamptz
-- Current position only. Overwritten on every update, never appended.
```

**Hard requirements:**

1. **Snapping happens on-device.** No raw coordinate is included in any network request from the field app. This is the requirement the whole design rests on.
2. **Opt-in per assignment**, defaulting to off. Without it, Stage 10 falls back to knock-derived position and nothing breaks.
3. **Coarse interval.** One fix per 60 seconds while the app is foregrounded. No background collection.
4. **Visible while active.** Persistent indicator whenever fixes are being taken.
5. **No history, anywhere.** The column is `update`d, never `insert`ed. If an agent proposes an append-only positions table "for debugging", reject it.
6. **Cleared at close.** Closing the assignment nulls both columns.
7. **Off the route means off.** A fix more than 100m from the route line is discarded rather than snapped — someone on a break is not on the route.

**Acceptance:**
- [ ] Inspect every network payload from the field app: no latitude or longitude appears in any of them.
- [ ] No table grows a row when position updates. Row count is constant.
- [ ] With the toggle off, Stage 10 works from knock data with no error state.
- [ ] Closing an assignment nulls the position columns.
- [ ] A simulated fix 300m from the route is rejected, not snapped to the nearest point.

---

## 7. Build order

```
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → [gate] → 15
```

**Track A (this week):** `0, 1, 2, 3-lite, 4, 5, 6, 7-lite, 8, 14`. Full day-by-day in Section 12.

**Track B (after):** the route layer first — `1b, 5b, 16` — since it is the thing that removes friction on an actual shift. Then `9, 10, 11, 12, 13`, then hardening `3` and `7` to their full specifications, then the Stage 15 gate.

---

## 8. The location question

The design in Stage 16 exists because of what follows. Read it before proposing anything that stores coordinates.

**Reason 1 — data protection.** The ICO's guidance on monitoring workers (October 2023) applies to any relationship where an individual carries out work for an organisation, whatever that relationship is called — self-employed status does not remove it. On consent specifically, the guidance notes it is considerably harder to demonstrate genuine consent within a working relationship because of the imbalance of power, and points to legitimate interests as the basis more likely to apply, subject to an assessment weighing the worker's rights against the business need. Two practical consequences: high-risk monitoring requires a DPIA, and data collected must be made available to a worker who submits a subject access request.

*Source: ICO, Employment practices and data protection: monitoring workers, 3 October 2023.*

The guidance repeatedly asks for a clearly defined purpose achieved by the **least intrusive means**. Stage 16 is built to that standard deliberately: the purpose is placing someone on a route they are already walking, and the least intrusive means of achieving it is a distance along that line rather than a position on the earth. A subject access request against Stage 16 returns one number that is already visible to the person's own partner.

**Reason 2 — employment status.** Untouched by consent, because the counterparty is not the canvassers. Control is a core test of employment status, and continuous location monitoring of nominally self-employed workers is evidence of control. A tribunal or HMRC is not bound by what the canvassers agreed to.

This is also why Stage 16 is opt-in per assignment with a working fallback. A feature that degrades gracefully when someone declines is a navigation aid. One that stops the shift working is a condition of engagement, and that is the thing that looks like control.

**Reason 3 — if this is ever licensed.** Consent obtained from this team is worth nothing in another company's deployment. A product that derives position from work performed and discards coordinates inherits no compliance baggage. One that ships a breadcrumb table inherits all of it, from every buyer.

None of this is legal advice. It is the reasoning behind the constraint, and it is worth twenty minutes with a solicitor before anyone proposes relaxing it.

**The line that must not move:** raw coordinates do not leave the device. Everything else in Stage 16 is a parameter. That one is the design.

## 9. Parked — and what unblocks each

### CRM API linkage — no longer parked

Moved to Stage 12a. The key is available from the CRM dashboard, so the technical blocker is gone.

**The commercial one is not, and it is worth one paragraph of attention.** An API key being reachable from a settings tab is not the same as being authorised to pipe that data into software you intend to own. The protection is the design, not a conversation: because Stage 12a stores only a reference and a status enum against leads you generated yourself, essentially no company data lands in your database, and there is nothing meaningful to hand back under a data return clause. Keep it that way. The moment someone suggests pulling customer names or numbers across "since we're already connected", that protection is gone.

Worth a short email confirming the integration is fine, before the demo rather than after.

### WhatsApp message highlighting

**Not buildable as described.** There is no legitimate programmatic read access to personal WhatsApp messages. The Business API only covers messages sent to a business number you control; anything else means unofficial clients, which breach the terms of service and get numbers banned. Stage 13 addresses the actual need.

### Route creation — no longer parked

Moved to Stages 1b and 5b. The earlier objection was aimed at route *optimisation* — solving for the shortest or most productive path, which does need calibration data that does not exist. Generating a consistent, conventional route and drawing it on a map is a different and much easier problem, and consistency is worth more here than optimality anyway.

**Route optimisation itself stays parked.** Unblocks when Stage 12 has produced enough visit data to establish real walking pace and doors-per-hour. Until then, deterministic beats clever.

### Two-turn greyed-out nav view

**Deferred, low return.** The ordered dot sequence from Stage 6 already says where to go next. A bespoke nav view is a significant build for a marginal gain, and the kind of feature that eats a weekend and gets switched off in week two.

**Revisit when:** a canvasser has used the dot sequence in the field for a fortnight and can say specifically what it fails at.

---

## 10. Model routing

Cursor runs two usage pools. The **Cursor Models pool** (Grok 4.6, Grok 4.5, Composer 2.5) is included generously with the plan. The **Other Models pool** (Anthropic, OpenAI, Google) bills at published API rates and is the one that empties.

Two facts that should drive every choice here:

**The `AGENTS.md` file is worth more than the model upgrade.** Cursor's published Next.js evaluations show a large gap for its in-house models between running with and without one. Section 5 exists for this reason. Write it before Stage 0.

**Plan expensive, execute cheap.** Planning output is small; implementation output is large. Running a frontier model in Ask or Plan mode to produce the plan, then executing it with an in-pool model, costs a fraction of running the frontier model through the whole session and loses very little.

| Stage | Model | Why |
|---|---|---|
| 0 Scaffold | Composer 2.5 | Mechanical, well-specified |
| 1 Data ingest | Grok 4.6 | Messy CSV edge cases |
| **2 Schema and RLS** | **Frontier** | A mistake here propagates into every later stage |
| 3 Auth | Grok 4.6 | Standard, but security-adjacent |
| 4 Prop drawing | Grok 4.6 | PostGIS plus map interaction |
| 5 Allocation | Grok 4.6 | Rotation maths is fiddly but specified |
| 6 Field view | Grok 4.6 | Map plus offline cache |
| **7 Sync queue** | **Frontier** | Hardest correctness problem in the build |
| 8 Knock logger | Grok 4.6 | Sits on the Stage 7 module |
| 9 Completion | Composer 2.5 | SQL view, fully specified above |
| 10 Partner progress | Grok 4.6 | Realtime plumbing |
| 11 Amenities | Composer 2.5 | Script plus list UI |
| 12a CRM sync | Grok 4.6 | Scheduled job, mapping table, idempotency |
| 12b Visit history | Grok 4.6 | Lifecycle logic, ordering matters |
| 13 Immediates board | Grok 4.6 | Concurrency on slot holds |
| 14 Map, dashboard, seed | Composer 2.5 → Grok 4.6 | Seed cheap, coverage map with the better model |
| 15 Recommender | Frontier for design, Grok 4.6 to build | Scoring design benefits from the stronger reasoner |

**Also reach for a frontier model when:**

- Grok has looped twice on the same bug. A second model breaks the loop more often than a third attempt by the first does.
- Reviewing RLS policies before anyone real touches the system.
- Reviewing the sync queue after Stage 8, once there is real usage of it.

That is roughly three or four sessions of the seventeen on the metered pool. Everything else runs in-pool.

**Settings:**

- Avoid the **Fast** model variants. They cost roughly double for latency you do not need on a solo build.
- **Auto / Cursor Router** is fine for small fixes. Pick the model explicitly for a whole stage.
- **Bugbot** bills per review run on every commit push. On a solo build, leave it off until near the demo, then turn it on for one pass.
- Check the picker for the current top-tier options. The most expensive model listed is not the right default — reserve it for Stages 2 and 7 and for breaking loops.

---

## 11. How to run a session

**Per stage:**

1. Start a **new chat**. Do not continue the previous stage's thread — stale context is the main cause of an agent editing files it should not.
2. Confirm `AGENTS.md` is in context.
3. Paste: *"Implement Stage N of D2D-Build-Brief.md. Read Sections 0, 2 and 3 first. Do not begin Stage N+1. Run the acceptance checklist at the end and report each item individually."*
4. Let it finish. Do not interrupt mid-stage to add scope.
5. Run the acceptance checklist yourself. The agent reporting a pass is not a pass.
6. Commit with the stage number in the message: `stage-07: offline sync queue`.

**When a stage fails acceptance:** fix it in the same session. Do not carry a failing checklist into the next stage — every later stage assumes the earlier ones hold.

**Keep both documents in the repo:** `AGENTS.md` at the root, this brief at `docs/D2D-Build-Brief.md`. Reference it by path in every prompt.

---

## 12. Track A — the demo week

Full build is ~28 hours. You have days, not weeks, and shifts in between. So this is the cut.

**What survives the cut:** the sentence in Section 1, demonstrated live. Draw a prop, allocate it, walk it on a phone, watch the map fill in, look at the numbers.

**What gets cut, and honestly:** intelligence, CRM sync, the immediates board, partner progress, toilets. None of it is needed to prove the thing that has no existing answer.

### Day plan

| Day | Stages | Hours |
|---|---|---|
| 0 | Send the NCCZ email (Section 13). Two minutes, longest lead time in the project. | — |
| 1 | 0 Scaffold + deploy · 1 Data ingest | ~4 |
| 2 | 2 Schema and RLS · 3-lite Auth | ~4 |
| 3 | 4 Prop drawing · 5 Allocation and rotation | ~4 |
| 4 | 6 Field view · 7-lite Sync · 8 Knock logger | ~5 |
| 5 | 14 Coverage map, dashboard, seed · two timed dry runs | ~3 |

### The two "-lite" stages, scoped precisely

**Stage 3-lite — auth.** Three seeded users, one per role, created directly in Supabase. Login and role routing only.
*Deferred to Track B:* signup flow, password reset, email verification, user management UI.

**Stage 7-lite — sync queue.** Dexie table, `client_event_id` on every write, unique constraint server-side, flush on reconnect and on app focus.
*Deferred to Track B:* exponential backoff, guaranteed per-assignment ordering, partial-flush recovery, queue-depth UI.

Both are real subsets. The Track B work extends them; it does not replace them. Do not let an agent "simplify" by writing a direct Supabase call in a field component — that is the one shortcut that costs you the rebuild.

### If a day runs long

Cut in this order: the dashboard in Stage 14 (keep the coverage map — that is the moment that lands), then rotation in Stage 5 (allocate with a fixed entry vertex and add rotation later).

### If a day runs short

Add **Stage 9** first. It is one SQL view and three numbers, and those three numbers are what turn "here's a map" into "here's what it tells you". **Stage 11** second — it takes an afternoon and it is the detail that says a canvasser built this.

### On adding the route layer to the demo

Tempting, and it is the most persuasive thing in the whole product — *press start, the route is already drawn*. But `1b` plus `5b` is realistically six to eight hours, which is a whole extra day this week does not have.

If you decide to reach for it anyway, build `1b` and `5b` and **stop there**. A drawn route with no positioning is roughly two-thirds of the value: it removes the ten-minute conversation about who goes where, which is the friction that actually costs shifts. Stage 16's "you are here" is polish on top of that, and it is the part that carries the compliance weight. Do not bolt it on in a rush the night before.

### Demo-day rules

**Run from seeded data, and say so.** Two weeks of plausible history makes the coverage map mean something. Pretending it is real history does not survive one question.

**Two timed dry runs, not one.** The second run finds the break. Do them the night before, not the morning of.

**Deploy is live from day 1.** Demo from the Vercel URL on your actual phone, not from localhost. iOS blocks geolocation on non-HTTPS origins and you do not want to learn that in the room.

**Turn Bugbot on for one pass** the night before, then off again.

### Model routing for a compressed week

The routing table in Section 10 still holds, with one change of emphasis: a week-long deadline makes it tempting to put a frontier model on everything. Resist it, with two exceptions.

**Stage 2 (schema)** — irreversible, and every later stage sits on it.

**Stage 7-lite (sync)** — a sync bug that surfaces mid-demo is the worst possible failure, and it will look like the app losing knocks.

Everything else runs on Grok 4.6 in-pool, with Composer 2.5 for Stage 0 and the Stage 14 seed script. Two frontier sessions across the week is a small metered spend; frontier on all ten is not.

**Where the week most likely goes wrong,** in order: Stage 1 data ingest (large CSV, projection mismatch, NCCZ availability), then Stage 6's tap-accuracy test on real terraces. Both are on the critical path and neither is a coding problem — do not let an agent grind on them for two hours before you look yourself.

---

## 13. Data sources — exact downloads and where they go

Three datasets. One of them has a lead time of days. Start with that one.

### Folder layout

```
nakolabs-d2d/
├── .env.local
├── AGENTS.md
├── .gitignore                 ← must contain /data
├── data/
│   ├── raw/                   ← downloads land here, untouched
│   │   ├── osopenuprn_<epoch>.csv
│   │   ├── bristol-nccz.<gpkg|shp|geojson>
│   │   └── bristol-roads.osm.json
│   └── README.md              ← what each file is, source URL, date downloaded
├── scripts/
│   ├── ingest-uprn.ts
│   ├── ingest-nccz.ts
│   └── ingest-roads.ts
├── supabase/migrations/
└── docs/D2D-Build-Brief.md
```

**Add `/data` to `.gitignore` before you download anything.** The OS Open UPRN file covers all of Great Britain and committing it will make the repo unusable. Keep `data/README.md` tracked so future-you knows what was downloaded and when.

---

### 1. Bristol No Cold Calling Zones — do this first

**Dataset page:** https://www.data.gov.uk/dataset/c77760b7-da51-4f34-832e-349ed2148d58/no-cold-calling-zones2

**There is no download link.** The page's data links section says so explicitly. Publisher is Bristol City Council, originating data from Avon and Somerset Police, and the only route to the file is asking.

**Do this today:**

Email **gis_supportteam@bristol.gov.uk** — the enquiries contact on the dataset page. Ask for the No Cold Calling Zones dataset as GeoJSON or Shapefile, and mention the Harvest GUID `30dc06c6-da98-48c6-8f4a-cf5deabb903b` so they know exactly which one you mean. Say what it is for.

**If nothing comes back within a week:** FOI request via https://www.whatdotheyknow.com/body/bristol_city_council. Slower but it has a statutory clock on it.

**Meanwhile:** Avon and Somerset Constabulary is credited as the source of the attribute information, so their site may carry a published list of zone streets. A hand-drawn polygon per named zone is a perfectly good stopgap and loads through the same ingest path.

**Projection:** EPSG:27700 (British National Grid). Reproject to 4326 at ingest.

**Licence:** Open Government Licence v3.0. Attribution required, including the OS Crown copyright line the dataset carries.

**Save to:** `data/raw/bristol-nccz.<ext>`

---

### 2. OS Open UPRN — the address backbone

**Download page:** https://osdatahub.os.uk/downloads/open/OpenUPRN

**Account:** free OS Data Hub account needed. Sign up at https://osdatahub.os.uk/plans and choose the **OS OpenData Plan** — free to anyone, commercial use included.

**Format:** take **CSV**. The file gives `UPRN`, eastings/northings in EPSG:27700, and `LATITUDE` / `LONGITUDE` in EPSG:4326. Use the lat/long columns; you do not need to reproject.

**It is the whole of Great Britain** — roughly 40 million addressable locations. Do not attempt to load it all. Filter by bounding box in `ingest-uprn.ts` and stream the CSV rather than reading it into memory.

Starting bounding box for Bristol, to be tuned once you can see the points on a map:

```
lon  -2.72  to  -2.45
lat  51.38  to  51.54
```

Sanity check after ingest: Bristol should come out in the low-to-mid hundreds of thousands of UPRNs. If you get tens of thousands the box is too tight; if you get millions it is far too wide.

**Refresh cadence:** updated every six weeks in line with AddressBase epochs. Once is enough for now.

**Licence:** Open Government Licence v3.0. Attribution required.

**Save to:** `data/raw/osopenuprn_<epoch>.csv`

---

### 3. OSM road network — needed for Stages 1b and 5b only

Not needed for Track A. Skip this section until you build the route layer.

**Preferred — Overpass API.** Same pipeline as the Stage 11 amenity ingest, no extra toolchain, and small enough for one city.

Endpoint: `https://overpass-api.de/api/interpreter` — POST the query from Stage 1b, save the JSON response straight to disk.

```bash
curl -s -X POST https://overpass-api.de/api/interpreter \
  --data-urlencode "data@scripts/queries/bristol-roads.overpassql" \
  -o data/raw/bristol-roads.osm.json
```

Run it **once**, from a script, and commit nothing but the query. Overpass is a shared volunteer resource — never call it from the application, and do not loop it.

**Fallback — Geofabrik**, if Overpass times out or you want the whole county offline. Browse https://download.geofabrik.de/ → Europe → United Kingdom → England, and take the Bristol extract from the index page. The path pattern is `europe/united-kingdom/england/<county>-latest.osm.pbf`, but pick the link off the index rather than guessing the filename. A `.pbf` needs `osmium` or `osm2pgsql` to read, which is why Overpass is the recommendation.

**Licence:** ODbL. "Map data © OpenStreetMap contributors" must appear wherever the route or the amenity list is rendered.

**Save to:** `data/raw/bristol-roads.osm.json`

---

### Attribution block

All three licences require credit. Put one line in the app footer and in any exported view, and do not let a later stage quietly drop it:

> Contains OS data © Crown copyright and database right 2026. Contains public sector information licensed under the Open Government Licence v3.0. Map data © OpenStreetMap contributors.
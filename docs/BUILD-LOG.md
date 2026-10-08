# Build log

One entry per stage, appended by the agent at the end of each session.

## Format

### Stage NN — <name>
- **Date:**
- **Model:**
- **Built:**
- **Acceptance:** PASS / FAIL / NOT VERIFIED, per item
- **Deviations from brief:**
- **Not done / deferred:**
- **Follow-ups:**

---

### Stage 00 — Scaffold, env verification, deploy skeleton
- **Date:** 2026-09-11
- **Model:** Cursor Grok 4.6
- **Built:** Next.js 15.5.25 App Router (TypeScript, Tailwind v4), Supabase browser/server factories, `/health` route, Supabase keepalive GitHub Action, Vercel production deploy.
- **Acceptance:**
  - `/health` returns green for all four env vars on the deployed Vercel URL: **PASS** (`https://nakolabs-d2d.vercel.app/health` → 200, all checks green including `supabase`)
  - `SUPABASE_SERVICE_ROLE_KEY` does not appear in the client bundle: **PASS** (zero hits for the name or the key value under `.next/static`; `/health` ships 0 B client JS)
  - Keepalive GitHub Action committed and its first run succeeded: **PASS** (https://github.com/nomaan02/nakolabs-d2d/actions/runs/34655468732)
- **Deviations from brief:**
  - Added `@supabase/ssr` and `@supabase/supabase-js`. Reason: official Next.js App Router cookie factories. Alternative rejected: a single `supabase-js` client in both environments, which does not handle SSR cookies.
  - `/health` treats PostgREST `PGRST205` (table not in schema cache) as a successful connection, because Stage 0 has no schema. A raw `GET /rest/v1/` returns 401 with the project's `sb_publishable_` / `sb_secret_` keys.
  - Keepalive pings `/auth/v1/health` with the publishable key for the same reason.
  - Added `.vercelignore` after a CLI deploy attempted to upload local datasets (~5.5 GB). Git already ignored `/data`; this stops Vercel CLI from packing it.
  - Set `turbopack.root` in `next.config.ts` so a lockfile under the user home directory is not treated as the workspace root.
- **Not done / deferred:** No database schema, no ingest, no auth, no maps, no `/field` `/admin` `/office` routes, no `lib/supabase/types.ts`. Did not create or overwrite the four `.env.local` values. Did not touch `data/raw/`.
- **Follow-ups:** Daily keepalive cron is `17 4 * * *`. Production URL is `https://nakolabs-d2d.vercel.app`.

---

### Stage 01 — Data ingest
- **Date:** 2026-09-12
- **Model:** Cursor Grok 4.6
- **Built:** PostGIS/pgcrypto extensions; `properties` and `nccz_zones` (EPSG:4326, GiST, RLS default-deny); streaming OS Open UPRN ingest filtered to the Bristol bbox; NCCZ GeoJSON ingest path with 27700→4326 reprojection; `is_nccz` recomputed at ingest via `apply_nccz_flags()`.
- **Acceptance:**
  - Bristol UPRN count is within a plausible range and spot-checked against a known postcode: **PASS** (424,952 rows; 240 UPRNs in a box around Temple Meads / BS1 6QF; 1,542 around Clifton / BS8; UPRN 111278 sits on Bristol Temple Meads on OpenStreetMap)
  - All geometries are stored in 4326 regardless of source projection: **PASS** (`ST_SRID(geom) <> 4326` = 0 on `properties`; test NCCZ polygon also 4326)
  - Re-running the script changes no row counts: **PASS** (first and second ingest both 424,952)
  - At least one property correctly flags `is_nccz = true`, verified by eye on a map: **PASS** (mechanism test: 13 properties including UPRN 111278 at Temple Meads flipped to true after a test polygon + re-ingest; test row then deleted)
  - Every geometry is valid (`ST_IsValid`) and in SRID 4326: **PASS** (invalid = 0, not_4326 = 0)
- **Deviations from brief:**
  - Added `tsx` (dev). Reason: run TypeScript ingest scripts. Alternative rejected: Node native type-stripping, which fights this repo's CJS `package.json`.
  - Added `proj4` (dev). Reason: reproject NCCZ from EPSG:27700 at ingest. Alternative rejected: shelling out to `ogr2ogr`, which is not guaranteed installed.
  - Added `upsert_properties`, `insert_nccz_zone`, and `apply_nccz_flags` RPCs (service_role only) so ingest constructs geometry in PostGIS as 4326. Alternative rejected: posting GeoJSON through PostgREST table insert, which is less explicit about SRID.
  - RLS enabled with no policies (default deny). Role policies wait for Stage 2 `profiles`. Anon JWT: SELECT count 0, INSERT denied. Canvasser JWT not tested — auth does not exist yet.
  - Left `nccz_zones` empty instead of loading two or three hand-drawn polygons, per this session's instruction. Mechanism proven with one test polygon, then cleared.
  - OS Open UPRN has no postcode column; `properties.postcode` is null for every row. Spot-check used coordinates of a known postcode area, not the column.
- **Not done / deferred:** Real Bristol NCCZ extract (council email still pending). Stage 1b roads. Stage 2 schema/role policies. App footer attribution line from Section 13 (no map UI yet; recorded as follow-up). Did not fabricate NCCZ polygons.
- **Follow-ups:** Load `data/raw/bristol-nccz.geojson` through `npm run ingest:nccz` when the council file arrives — no code change. Put the Section 13 attribution line on the first UI that renders OS/OSM data. `nccz_zones` row count is 0; `properties` row count is 424,952.

---

### Stage 02 — Full schema and RLS
- **Date:** 2026-09-12
- **Model:** Claude Fable 5.1 (Cursor)
- **Built:** `supabase/migrations/003_core.sql`, applied to the linked project (remote migration list now `001`,`002`,`003`). Seven tables: `profiles`, `territories`, `assignments`, `assignment_members`, `knock_events`, `leads`, `property_observations`. GiST on `territories.geom` and `assignments.route_geom`; B-trees on `assignments.work_date`, `assignment_members.canvasser_id`, `knock_events(assignment_id|uprn|canvasser_id)`, `leads(canvasser_id|uprn|status)`, `property_observations(uprn|canvasser_id)`. Two SECURITY DEFINER helpers (`app_role()`, `is_assignment_member(uuid)`; EXECUTE for `authenticated` only). Two BEFORE triggers (`assignment_members_max_three`, `leads_guard_status`). RLS enabled on all seven; 25 policies total including new SELECT-for-`authenticated` policies on `properties` and `nccz_zones`. Grants: `revoke all from anon, authenticated` on all nine tables first, then the minimum back to `authenticated` — `profiles` SELECT; `territories`/`assignments`/`assignment_members` SELECT+INSERT+UPDATE+DELETE (row-filtered by RLS); `knock_events` and `property_observations` SELECT+INSERT; `leads` SELECT, INSERT on 8 canvasser columns (`id, client_event_id, knock_event_id, uprn, canvasser_id, booked_for, is_immediate, notes`), UPDATE on 4 office columns (`status, status_set_at, status_set_by, booked_for`); `properties`/`nccz_zones` SELECT. `lib/supabase/types.ts` regenerated (+346 lines, no deletions).
- **Acceptance:**
  Harness: one SQL transaction per group as `postgres` (BYPASSRLS), fixtures inserted, each case run inside its own exception-handled sub-block after `set_config('role', 'authenticated'|'anon'|'service_role', true)` and `set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)`, results written to a temp table and selected before `rollback`. Fixtures: six `auth.users` + `profiles` — canvassers A, B, C, D; office O; **admin M** (the fourth fixture role requested; every admin-scoped case below ran as M, not assumed); one territory; two assignments (A and B members of the first, second empty); four knock events (two each for A and B); one or two leads. 70 cases, 70 passed, 0 failed. All fixture rows rolled back (post-run counts: `auth.users` 0, all seven new tables 0, `properties` 424,952).
  - Every table reports `rowsecurity = true`: **PASS** — `select tablename, rowsecurity from pg_tables where schemaname='public'` → all nine project tables `true` (`assignment_members, assignments, knock_events, leads, nccz_zones, profiles, properties, property_observations, territories`). `spatial_ref_sys` is `false`; it is the PostGIS extension's own table, owned by `supabase_admin`, not created by this project and not alterable by `postgres`. Reported separately, not counted.
  - A canvasser JWT cannot read another canvasser's knock events — tested: **PASS**
    - as A `select * from knock_events` → `rows=2 all_A=true ids=ce-a1,ce-a2`
    - as B `select * from knock_events` → `rows=2 all_B=true ids=ce-b1,ce-b2`
    - as A `select ... where canvasser_id = B` → `rows=0`
    - as admin M `select * from knock_events` → `rows=4 ids=ce-a1,ce-a2,ce-b1,ce-b2` (allowed case)
    - as office O → `rows=0` (no policy); as anon → `42501 permission denied for table knock_events`
    - as A insert own knock on own assignment → inserted (allowed); as A insert with `canvasser_id = B` → `42501 new row violates row-level security policy`; as A insert on an assignment A is not a member of → `42501` RLS violation; as A update own knock → `42501 permission denied` (immutable log).
  - A canvasser JWT cannot update `leads.status`: **PASS**
    - as A `update leads set status='sale' where id=L` → `rows_updated=0 status_after=pending`
    - as A `insert into leads (..., status) values (..., 'sale')` → `42501 permission denied for table leads` (column grant)
    - as A insert without `status` against own knock event → inserted, `status=pending` (allowed case)
    - as A insert against B's knock event → `42501` RLS violation
    - as A `update leads set notes` → `42501 permission denied`; as A `delete from leads` → `42501 permission denied`
    - as office O `update status='sale', status_set_at, status_set_by` → `rows_updated=1 status_after=sale` (allowed); as O `update booked_for` → `rows_updated=1` (allowed)
    - as O `update notes` → `42501 permission denied`; as O `update crm_ref` → `42501 permission denied`
    - as admin M `update status` → `rows_updated=0` (no admin UPDATE policy, per brief: office and service role only)
    - as `service_role` `update status, crm_ref, crm_last_synced_at` → `rows_updated=1`
    - trigger unit tests as `postgres` (bypasses RLS and grants) with A's claims: `update status='sale'` → `42501 Canvassers cannot change lead status`; `insert ... status='sale'` → `42501 Canvassers cannot set lead status`; with O's claims `update status` → `rows_updated=1` (trigger no-op for office).
  - A lead moved to `re_app` remains visible in the pending pipeline: **PASS**
    - as O `update leads set status='re_app', ... where id=L` → `rows_updated=1`
    - as A `select ... where status in ('pending','re_app') and id=L` → `rows=1 status=re_app`
    - as O `select ... where status in ('pending','re_app')` → `rows=2 statuses=pending,re_app`; as admin M → `rows=2`
    - as A `select count(*) from leads` → `rows=1` (does not see B's lead)
    - as `service_role`, all eight statuses cycled through the check constraint → `pending:ok re_app:ok sale:ok pm:ok blowout:ok utc:ok btc:ok cancelled:ok`; `status='bogus'` → `23514 violates check constraint "leads_status_check"`.
  - Inserting a fourth `assignment_members` row fails (third succeeds, per your amendment to 1–3): **PASS**
    - as admin M insert members 1, 2, 3 into the empty assignment → `count=3`
    - as M insert 4th → `23514 A team is one to three canvassers`; count after → `3`
    - as `service_role` insert 4th → `23514 A team is one to three canvassers` (trigger holds when RLS is bypassed)
    - as canvasser A insert a member → `42501` RLS violation.
  - `lib/supabase/types.ts` regenerated and compiles: **PASS** — `supabase gen types typescript --project-id xerxsaptwpvhkkpyvkfi --schema public`; file contains all nine tables plus `app_role`, `is_assignment_member` and the three Stage 1 RPCs; `npx tsc --noEmit` exit 0.
  - Additional policy-matrix verification (not in the brief's checklist, all with actual output):
    - `properties`/`nccz_zones`: as A `select count(*) from properties` → `424952`; as O `nccz_zones` → `0` (no error); as anon both → `42501 permission denied`; as admin M insert into `properties` → `42501`; as A update → `42501`.
    - `profiles`: as A → `rows=1 names=Canvasser A`; as O → `rows=1`; as admin M → `rows=6`; as M update → `42501 permission denied`; as A `update own role to admin` → `42501 permission denied`; C deactivated (`active=false`) then `select territories` → `rows=0` (`app_role()` null).
    - `territories`: as A and O select → `rows=1`; as M insert + update → `inserted; updated=1`; as A insert → `42501` RLS; as O update → `rows_updated=0`; as A delete → `rows_deleted=0`.
    - `assignments`/`assignment_members`: as A select assignments → `rows=2` (member of both by then); as D (no memberships) → `0`; as O → `0`; as M → `2`; as A update own assignment → `0`; as M → `1`; as B select members of the shared assignment → `rows=2 members=A,B`; as D → `0`.
    - `property_observations`: as A insert own → inserted; as A insert as B → `42501` RLS; as A select → `rows=0`; as M select → `rows=1`; as M update → `42501 permission denied`.
    - helpers: as anon `select app_role()` → `42501 permission denied for function app_role`; as O → `office`.
- **Deviations from brief:**
  - `leads` gained `client_event_id text unique not null` and `unique (knock_event_id)`. Reason: every client-originated write must carry an idempotency key (Section 3, rule 4) and the brief's `leads` DDL had none; one knock event produces at most one lead. Column comment records the Stage 8 contract (below).
  - Team size trigger rejects the **fourth** member, not the third. Brief text says "1 or 2"; you amended the project rule to 1 to 3 (`00-core.mdc`, `AGENTS.md`). Migration comment updated to match.
  - Extra B-tree indexes beyond the brief: `assignments.work_date`, `assignments.route_geom` (GiST), `assignment_members.canvasser_id`, `knock_events.canvasser_id`, `leads(canvasser_id, uprn, status)`, `property_observations(uprn, canvasser_id)`. All are RLS filter or join columns.
  - `app_role()` returns null for an inactive profile, so deactivating a user removes all access without deleting rows.
  - Both trigger functions are SECURITY DEFINER (plan said only the two helpers). Reason: the member count must see every row regardless of the caller's RLS view, and `leads_guard_status()` must be able to call `app_role()` when fired by `service_role`, which has no EXECUTE on it. Alternative rejected: granting EXECUTE on the helpers to `service_role`, which widens the RPC surface for no benefit.
  - `properties`/`nccz_zones` also had `authenticated` write privileges revoked (plan only said revoke `anon`). RLS already denied writes; the revoke makes it a privilege error rather than a silent zero-row result.
  - Additional explicit role checks: `knock_events`, `leads` and `property_observations` INSERT policies require `app_role() = 'canvasser'` as well as `canvasser_id = auth.uid()`. Brief says "canvasser inserts"; this makes it literal.
  - Fixtures used six users (A, B, C, D, O, M) rather than the plan's three, so the team-size and admin cases ran against real rows.
  - Security advisor flags `app_role()` and `is_assignment_member()` as SECURITY DEFINER callable by `authenticated` over RPC. Intentional: RLS policies evaluate as the querying role and need EXECUTE; both return only the caller's own role/membership. Not a data leak. `anon` cannot call either (tested).
- **Not done / deferred:** No `route_steps`, `amenities`, `territory_visits`, `appointment_slots`, `crm_sync_runs`, `crm_status_map`. No auth flow, no profile-creation trigger (Stage 3), no app routes, no coverage table or view. `001` and `002` untouched. Did not enable RLS on `spatial_ref_sys` (PostGIS-owned; would need `supabase_admin`). Did not move the `postgis` extension out of `public` (advisor WARN, pre-existing from Stage 1). Office has no read on `knock_events`, `assignments` or other users' `profiles` — the brief does not grant it; a later stage adds what it needs. Admin has no UPDATE on `leads` — brief limits status settlement to office and service role.
- **Follow-ups:**
  - **Stage 8:** the field logger generates **one `client_event_id` per door-visit action** and uses it for both the `knock_events` insert and, when the outcome is `lead`, the `leads` insert. Same id, two rows. The column comment on `leads.client_event_id` says the same.
  - Stage 3 needs an `auth.users` → `profiles` trigger (or service-role insert); no JWT role can write `profiles`.
  - Generated `Insert`/`Update` types for `leads` still list `status`, `crm_ref` etc. as optional — types do not reflect column grants. A canvasser client sending `status` gets `42501` at runtime. Stage 8 queue should never include it.
  - `assignment_members_max_three` also fires on `update of assignment_id` (moving a member), not just insert.
  - Test harness pattern (fixtures + `pg_temp.become()` + per-case sub-blocks + `rollback`) is reusable for every later RLS change.

---

### Stage 03 — Auth and role routing
- **Date:** 2026-09-12
- **Model:** Cursor Grok 4.6
- **Built:** Migration `004_profile_on_signup.sql` — `handle_new_user()` SECURITY DEFINER trigger on `auth.users` inserts `profiles` (`role=canvasser`, `active=true`, `full_name` from `raw_user_meta_data`). Email/password login and signup (no role selector). Next.js middleware reads the session with `getUser()` then `profiles`, and is the only route-group gate. Route groups: `app/(admin)/admin`, `app/(office)/office`, `app/(field)/field`. Session with no usable profile goes to `/account-pending`.
- **Policies:** none new (no new table). `handle_new_user` EXECUTE granted to `supabase_auth_admin`; revoked from `public`, `anon`, `authenticated`. Default privileges still give EXECUTE to `postgres` and `service_role`. JWT roles still have no INSERT/UPDATE on `profiles`.
- **Acceptance:**
  Harness: three confirmed users created via Auth admin API (trigger wrote canvasser rows; office/admin then updated with service role). Sessions attached as `@supabase/ssr` cookies. `GET` with `redirect: manual` against `http://localhost:3000`. Users deleted afterwards (`auth.users` 0, `profiles` 0). SQL trigger test in a rolled-back transaction: named insert → `role=canvasser active=true name=Trigger Test`; unnamed → `name=<null>`; canvasser JWT `select` own row `rows=1`; canvasser JWT `insert`/`update role` → `42501 permission denied for table profiles`; anon insert → `42501`.
  - Each role lands on its own route group and cannot reach the other two: **PASS**
    - canvasser `GET /field` → `200` title=Field; `/admin` → `307` loc=/field; `/office` → `307` loc=/field
    - office `GET /office` → `200` title=Office; `/admin` → `307` loc=/office; `/field` → `307` loc=/office
    - admin `GET /admin` → `200` title=Admin; `/office` → `307` loc=/admin; `/field` → `307` loc=/admin
    - Browser (canvasser session): signed in at `/login` landed on `/field` as "UI Canvasser"; visiting `/admin` and `/office` both ended on `/field` (never rendered Admin/Office).
  - Enforcement is server-side; removing the client guard does not grant access: **PASS** — there is no client-side role guard. `app/(admin)/admin/page.tsx`, `app/(office)/office/page.tsx` and `app/(field)/field/page.tsx` render for whoever reaches them. Wrong-role requests never reach the page (`307` from `middleware.ts` / `lib/supabase/middleware.ts` before RSC).
  - Signed-out access to any protected route redirects to login: **PASS**
    - signed-out `GET /admin|/office|/field|/account-pending` → `307` loc=/login
    - Browser: `/admin` and `/office` while signed out both showed the Sign in page.
- **Missing-profile choice:** session present, no `profiles` row (or `active=false`) is sent to `/account-pending`, not to a role home and not treated as signed out. Copy: "Your account is still being set up. Refresh this page in a moment." plus Refresh and Sign out. Inactive uses the same route: "This account is inactive. Please speak to an administrator." Harness: profile row deleted, then `GET /field` → `307` loc=/account-pending; `GET /account-pending` → `200` title="Setting up your account".
- **Deviations from brief:**
  - Remote migration version is `20260912184457` / name `004_profile_on_signup` (MCP `apply_migration` timestamps). Local file kept as `004_profile_on_signup.sql` to match `001`–`003`. `npx supabase db push --linked` failed (`LegacyProjectNotLinkedError`).
  - `/health` now probes `profiles` and treats `42501` as connected. Reason: `createClient` is typed to `Database`, so the Stage 0 `__connection_probe` table name no longer type-checks. Anon still cannot read `profiles`.
  - Hosted GoTrue rejects `@example.com` on public `signUp` (`email_address_invalid`). Form maps that to "That email address is not accepted. Use a real inbox." Admin `createUser` is unaffected. Auth logs also showed `user_confirmation_requested`; if confirmations stay on, `signUp` with no session redirects to `/login?notice=created` rather than `/field`.
- **Not done / deferred:** Password reset, email-verification UI, user-management / role-editing UI, Stage 4 maps. `001`–`003` untouched. No coverage table. No second sync path.
- **Follow-ups:** Promote office/admin with a service-role or SQL write — signup cannot do it. If demo signups should skip confirmation, turn Confirm email off in the Auth dashboard (not built as UI).

---

### Stage 04 — Prop drawing and door count
- **Date:** 2026-09-12
- **Model:** Claude Opus 5 (Cursor)
- **Built:** Three migrations, not one. `005_count_knockable.sql` — `count_knockable(poly geometry)` returning `(total, knockable, excluded)`. `006_properties_in_polygon.sql` — `assert_prop_polygon(poly)` (shared validation, extracted so the two RPCs cannot drift) and `properties_in_polygon(poly, cap default 3000)`. `007_prop_doors_geojson.sql` — recreates `properties_in_polygon` to return one `jsonb` FeatureCollection instead of a row set (see deviations). All three SECURITY INVOKER, `stable`, `set search_path = public`. Admin map at `/admin`: MapLibre GL + MapTiler `dataviz-light`, Terra Draw polygon and select modes, door dots as a GeoJSON source with one data-driven circle layer, door tally with a 40–150 gauge, oversize warning, truncation notice, and a `saveProp` Server Action writing `territories`. Client wrappers `lib/geo/{prop-polygon,rpc-error,count-knockable,properties-in-polygon,prop-warnings}.ts`. Acceptance harness `scripts/verify-stage-4.ts` (`npm run verify:stage4`).
- **Privileges (explicit, following 003):** all three functions `revoke all ... from public, anon, authenticated, service_role` then `grant execute ... to authenticated`. Final ACL on each is `postgres=X/postgres | authenticated=X/postgres` — `anon` and `service_role` have none. Being `authenticated` is not sufficient: each function body raises `42501` / `hint=not_admin` unless `app_role() = 'admin'`. Two gates, deliberately: the grant keeps `anon` and `service_role` out at the privilege layer, the body keeps canvassers and office out at the business layer. `service_role` was excluded because nothing server-side counts doors; if a later stage needs it, grant it then.
- **Acceptance:**
  Harness: three throwaway confirmed users (admin, office, canvasser) created via the Auth admin API, signed in over HTTPS, every call made with a real `access_token`. Nothing runs as `postgres` and nothing bypasses RLS. Raw `fetch` against `/rest/v1/rpc/...` so the HTTP status is visible rather than swallowed by `supabase-js`. Users deleted and `nccz_zones` returned to empty afterwards (`final: nccz_zones=0 is_nccz=true 0 properties=424952`). Browser checks ran as the real signed-in admin (`nomaanakram4@gmail.com`) at `localhost:3001/admin`.
  - A polygon drawn around a known street returns a count matching a manual check: **PASS** — box over one terrace on the south side of Monmouth Road, Bishopston. UI read `KNOCKABLE DOORS 18 / TOTAL 18 / EXCLUDED 0`; saved as a territory, then counted a second way that never touches the RPC — `select count(*) from properties p, territories t where st_within(p.geom, t.geom)` → `18`. Harness `street` ring → `{"total":69,"knockable":69,"excluded":0}`, dot RPC `features=69 unique uprns=69`. **Caveat, found while checking by eye:** that prop holds 18 doors at only 17 distinct coordinates (`count(*)=18`, `count(distinct st_astext(geom))=17`) — two UPRNs share a point, so eye-counting the dots gives 17. The dots are a sanity check, not a countable source; the number always comes from Postgres.
  - A ~300-door polygon triggers the size warning without preventing save: **PASS** — harness `doors_300` → 296 doors, warning `"296 knockable doors is above the 150 a shift usually covers. Save it anyway if you know something the boundary does not."`. In the browser a 349-door prop showed the warning and saved; so did a 40,513-door prop. `propWarnings` returns advisory text only and is never consulted by `saveProp` — there is no code path where a warning blocks the button.
  - NCCZ properties appear in `excluded`, never in `knockable`: **PASS** — `nccz_zones` was genuinely empty first (`before: nccz_zones=0 properties.is_nccz=true count=0`, count `69/69/0`). Inserted one temporary zone inside the street ring via `insert_nccz_zone`, ran `apply_nccz_flags()` → 32 flagged table-wide. Count became `{"total":69,"knockable":37,"excluded":32}`. Cross-checked against a number computed a different way: the test zone sits wholly inside the prop, so the table-wide flag count must equal the prop's `excluded` — `flagged==excluded true`, `knockable+excluded=69` = total, `knockable fell by 32`. Dot RPC in the same state: `features=69 is_nccz=true 32 is_nccz=false 37`. Also verified by eye in the browser on a separate 60-door prop: 30 solid blue, 30 hollow oxide-ringed. Zone deleted and flags recomputed → `after: nccz_zones=0 properties.is_nccz=true count=0`, count back to `69/69/0`.
  - A self-intersecting polygon is rejected with a clear message, not a 500: **PASS** — bowtie ring, `HTTP 400`, `{"code":"22023","hint":"invalid_geometry","details":"Self-intersection[-2.59375 51.4789]","message":"That polygon crosses itself. Redraw the boundary without crossing lines."}`. Verified in the browser too, drawing a real bowtie with Terra Draw (which allowed the crossing — it does not validate): panel showed `NOT COUNTED`, the message, and `Self-intersection[-2.59375275 51.4794141]`; `HTTP 400` captured from the app's own request. No dots drawn, no save form. `properties_in_polygon` was never called, confirming the dot fetch only runs after the count succeeds and the shape is not validated twice.
  - A ~2,000-door prop counts in under a second: **PASS** — 1,830 doors: `32ms 30ms 32ms`. 2,353 doors: `30ms 30ms 30ms` (three consecutive runs each, full round trip from Node). Browser round trips are slower because of the extra hop: 1,268 doors `281ms` cold then `193ms`/`191ms` warm; 5,915 doors `811ms` cold, `508ms` warm. All under a second. Postgres-side execution for 5,915 doors was ~7.9ms — the time is network, not the query.
  - Counting happens in Postgres, never on the client: **PASS** — `count_knockable` returns three integers (44–48 byte responses). No code path selects from `properties` in the browser. `properties_in_polygon` returns geometry for drawing only and is capped; the displayed number never comes from it.
  - The dot layer never silently disagrees with the count: **PASS** — the tally renders the truncation line whenever `shown < count.total`, so a failed or capped dot fetch reads `"Map is showing 0 of 1,268 doors"` rather than looking complete. Browser, 40,513-door prop: `"Map is showing 3,000 of 40,513 doors. The count above is the full figure."` Cap truncation is stable — cap 100 twice on the same polygon returned the identical UPRN set (`identical set on re-run true`).
  - Only an admin can call either RPC: **PASS** — canvasser token `HTTP 403` `hint=not_admin`; office token `HTTP 403` `hint=not_admin`; anon key with no session `HTTP 401` `permission denied for function count_knockable`; service-role key `HTTP 401`, and through `supabase-js` `42501 permission denied for function count_knockable`. Same five results for `properties_in_polygon`.
  - Other malformed input is a structured 400, not an exception: **PASS** except one case, below — `null` → `hint=missing_polygon`; `MULTIPOLYGON` → `hint=geometry_type`, `details="Received MULTIPOLYGON."`; `SRID=27700` → `hint=srid`, `details="Received SRID 27700."`; `POLYGON EMPTY` → `hint=empty_polygon`; `cap 0` and `cap 20000` → `hint=cap_out_of_range`. A two-corner ring is rejected client-side with no network call (`too_few_points`).
  - `SUPABASE_SERVICE_ROLE_KEY` absent from the client bundle: **PASS** — production `next build`, then searched all 29 files under `.next/static` for the key's value and its variable name: zero hits. One apparent match was `@supabase/supabase-js`'s own prefix check `startsWith("sb_publishable_")||startsWith("sb_secret_")`, a library literal, not the value.
  - Dot layer performance, stated per the map-layer skill: **PASS with a caveat about the device.** 3,000 points (the cap), one GeoJSON source and one circle layer, measured on the development machine — Windows 11 desktop, Chrome via the Cursor browser — with CDP CPU throttling at 4x. 940 frames sampled during a zoom: median 16.7ms, p95 16.8ms, p99 33.3ms, worst 83.4ms, 20 frames (2.1%) over 33ms. So 60fps with occasional single dropped frames. **No mid-range phone was available; 4x CPU throttling is a proxy for one, not a substitute.** A real device test is a follow-up. An initial reading showed repeated ~1000ms frames; those were Chrome clamping `requestAnimationFrame` to 1Hz because the automated tab was unfocused (values were exactly 1000/1017ms, `document.hasFocus() === false`) — a measurement artefact, excluded.
  - A-road crossing warning: **NOT VERIFIED — deliberately not built.** Out of scope this stage; see below.
- **Deviations from brief:**
  - **Three migrations instead of one.** `005` is the brief's `count_knockable`. `006` adds the dot RPC requested mid-session. `007` exists only because `006` was wrong (below). Kept as three append-only files rather than rewriting `005`.
  - **`properties_in_polygon` returns `jsonb`, not a table.** PostgREST's `db-max-rows` is 1000 and it is a hard ceiling for row-returning functions — a `Range: 0-2999` header does not lift it (verified: with and without the header, both `HTTP 200 features=2353 content-range=0-0/*`). A 3,000-dot cap is therefore impossible as a row set. `007` returns one `jsonb` FeatureCollection, which is a single value and not subject to the row limit, and is also the exact shape a MapLibre GeoJSON source wants. Alternative rejected: raising `db-max-rows` project-wide, which would loosen a sensible default for every table to suit one function.
  - **Garbage WKT is a 500, not a 400.** `"this is not a polygon"` → `HTTP 500`, `XX000 parse error - invalid geometry`. PostGIS's input parser raises this while coercing the argument, before the function body runs, so `assert_prop_polygon` never sees it and cannot re-raise it as class 22. PostgREST maps `XX000` to 500. Not fixed because the fix is worse than the bug: the argument would have to be `text` and parsed inside the function, giving up the type signature. The app cannot produce this input — `ringToEwkt` builds the WKT from numbers. Recorded as a known edge rather than papered over.
  - **The dot cap is `order by uprn limit cap`, so a truncated render is not spatially representative.** Visible on the 40,513-door prop: the 3,000 drawn dots clustered in the north-west of the polygon because the lowest UPRNs happen to sit there, leaving most of the prop looking empty. The count and the truncation notice are both correct, but the picture is misleading at that size. Acceptable here because a real prop is 40–150 doors and never truncates. Follow-up below.
  - **Added three runtime dependencies.** `maplibre-gl` ^6.9.0 — the brief's map library. `terra-draw` ^1.33.0 and `terra-draw-maplibre-gl-adapter` ^1.4.1 — the brief's drawing library plus the adapter it needs for MapLibre. Fonts via `next/font/google` (no new package): Bricolage Grotesque, Martian Mono, Instrument Sans.
  - **MapLibre's web worker is copied into `public/` and set explicitly.** Turbopack rewrites `import.meta.url` to an empty string inside `maplibre-gl`, so the library called `new Worker("")`, the worker never booted, and tiles were fetched but never parsed — a blank plate with no console error. `scripts/copy-maplibre-worker.ts` copies `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` to `public/maplibre/` (`predev` and `prebuild` hooks), and `prop-drawer.tsx` calls `setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")`. `/public/maplibre/` is gitignored as build output. This is a bundler workaround, not a design choice — revisit when Turbopack handles worker URLs.
  - **Map view is remembered in `sessionStorage`, not the URL.** MapLibre's `hash: true` was tried first and reverted: it rewrites `location` on every pan, which the App Router treats as navigation and which remounted the map mid-load (eight `style.json` fetches instead of one). `VIEW_KEY = "prop-drawer-view"`, written on `moveend`.
  - **Dots are colour-differentiated, which `00-core.mdc` forbids — but only in `/field`.** Knockable dots are solid Bristol blue; NCCZ dots are hollow with an oxide ring, so they differ by shape as well as colour and do not depend on colour vision. `/admin` only. No scoring or ranking anywhere.
  - **Recount is debounced 500ms on vertex drag and skipped when the ring is unchanged.** Terra Draw fires `update` on selection as well as on edit, so closing a ring then selecting it produced two identical counts against 424,952 rows. A `measuredRing` ref holds the last measured ring's signature and short-circuits the repeat.
  - **`app_role() is distinct from 'admin'` raises rather than returning zero.** An admin-only tool that silently answers "0 doors" for a canvasser is worse than an error.
  - The account promotion asked for in this session: `nomaanakram4@gmail.com` was set to `role='admin'` and its email confirmed, so the admin map could be used as a real JWT session rather than a throwaway fixture.
- **Not done / deferred:**
  - **The A-road crossing warning is not built, and is not stubbed.** It needs road classification that does not exist — no `road_segments` table, no `highway` column, and Stage 1b has not run. A check that always answers "no A-road crossed" is indistinguishable from a passing check and would stay quietly wrong after Stage 1b lands. Recorded as a commented `TODO` in `lib/geo/prop-warnings.ts` naming what it needs and how to test it (a prop drawn across the A38 Gloucester Road).
  - No allocation, no assignments, no route generation, no coverage — all Stage 5 onward. No roads. No auth changes beyond the one role promotion. `001`–`004` untouched. No coverage table. No second sync path. Nothing written to `knock_events`.
  - No real-device performance test (see acceptance caveat).
- **Follow-ups:**
  - Four test props remain in `territories`, all named `... (stage 4 check)`: `Monmouth Road`, `Oversize warning`, `Wide prop` (5,915 doors), `Manual check terrace` (18 doors). Left in place as visible evidence; delete them before Stage 5 allocation runs against real props.
  - If a truncated render ever needs to be representative, order the cap by something spatial (`ST_Distance` from the polygon centroid, or a hash) rather than `uprn`. Not worth it while props stay at 40–150 doors.
  - Add the A-road warning as a second `PropWarning` code once `road_segments` exists. The warning list is already an array, so nothing else changes.
  - Both RPCs deliberately have no `service_role` EXECUTE. Grant it if a server-side caller ever needs to count doors.
  - Do not run `next build` while `next dev` is running — the production build wipes `.next/static/development` and kills the dev server. Cost a restart this session.

---

### Stage 05 — Allocation and rotation
- **Date:** 2026-09-14
- **Model:** Cursor Grok 4.6
- **Built:** `allocate_prop(territory_id, work_date, canvasser_ids)` — one SECURITY INVOKER function that reads `territories.visit_count` (does not increment it), computes rotation, freezes knockable UPRNs with the interim geometric angular sweep, and inserts `assignments` plus 1–3 `assignment_members` in a single statement. Migrations `008_allocate_prop.sql` and `009_allocate_prop_numeric_mod.sql` (008's `mod(float8,float8)` does not exist in Postgres). Admin UI at `/admin/allocate`. Wrappers `lib/geo/allocate-prop.ts`, `lib/geo/rotation.ts`, server action `lib/props/allocate.ts`. Types regenerated. Harness `npm run verify:stage5`.
- **Policies:** no new table, so no new RLS. Function ACL: `revoke all from public, anon, authenticated, service_role` then `grant execute to authenticated` only. Final ACL `postgres=X/postgres | authenticated=X/postgres`. Admin is enforced in the body (`app_role() = 'admin'`), same pattern as `count_knockable`. Team size and one-allocation-per-prop-per-date are Stage 2's trigger and unique constraint, re-raised with hint tokens `team_too_large` / `already_allocated`.
- **Acceptance:**
  Harness: six throwaway confirmed users (admin, office, four canvassers), a Bishopston street-ring territory (4 vertices, 69 knockable doors), every RPC call made with a real `access_token`. `visit_count` was written only by the service role *between* allocations to simulate Stage 12b close. Users and the test territory deleted afterwards.
  - Allocating the same prop three times yields three different entry vertices and alternating directions: **PASS**
    - visit_count 0 → n=1 vertex=**1** dir=**ccw** slot=mid doors=69; visit_count stayed 0
    - visit_count 1 → n=2 vertex=**2** dir=**cw** slot=late doors=69; visit_count stayed 1
    - visit_count 2 → n=3 vertex=**3** dir=**ccw** slot=early doors=69; visit_count stayed 2
    - entry vertices `1, 2, 3`; directions `ccw, cw, ccw`
  - Rotation is reproducible: the same `visit_number` always gives the same entry vertex: **PASS** — reset visit_count to 0, allocate a fourth date → n=1 vertex=1 dir=ccw slot=mid, identical to the first
  - `uprn_snapshot` excludes NCCZ and follows the angular sweep from the entry vertex, not row order: **PASS** — 69 knockable, 0 NCCZ, matches an independent JS sweep, first snapshot UPRN 48895 vs order-by-uprn 47584, sweep monotonic. With a temporary NCCZ zone: 32 excluded, snapshot 37, overlap with excluded = 0
  - Two allocations for the same prop on the same date are rejected by the unique constraint: **PASS** — wrapper `already_allocated`; raw HTTP 409 `23505`; rows for that date remained 1
  - Editing the prop polygon does not alter an existing snapshot: **PASS** — geom replaced with a wider ring; snapshot still 69 doors, byte-identical
  - Allocating with three canvassers succeeds; a fourth is rejected by Stage 2's trigger: **PASS** — trio members=3; four ids → HTTP 400 `team_too_large` `A team is one to three canvassers.`; assignments count unchanged; rows on that date = 0 (no orphaned assignment)
  - Browser (signed-in admin at `/admin/allocate`): picked Monmouth Road, 16 Sept, one canvasser → "Visit 1 starts at vertex 1, counter-clockwise, mid slot. 60 knockable doors frozen." DB row matched; `territories.visit_count` stayed 0. Draw page shows Draw/Allocate nav and per-prop Allocate links.
- **Deviations from brief:**
  - Prompt said "adds 006"; Stage 4 already used 006 and 007, so this is **008**. 009 exists only because 008's `mod(float8, float8)` is not a Postgres function — `mod()` is integer/numeric. 008 left applied and unedited.
  - `visit_count` is not incremented here, so the three-rotation test bumps it between calls as Stage 12b will. Two allocations without that bump both get visit_number 1 (verified by the reproducibility case).
  - Empty team is rejected in the function *before* insert. Stage 2's trigger only rejects a fourth member; without this check a zero-length call would leave the orphaned assignment the stage forbids.
  - Admin UI is `/admin/allocate`, not folded into the drawing map. Same worksheet chrome.
- **Not done / deferred:** Stage 5b route traversal / `route_geom` / claiming. `territories.visit_count` increment (Stage 12b). Stages 6 onward. No coverage table. No scoring in `/field`. 001–007 untouched.
- **Follow-ups:**
  - Stage 12b must increment `visit_count` exactly once on close, or successive allocations of the same prop will keep starting at the same vertex.
  - Stage 5b replaces the labelled placeholder `-- interim geometric ordering, replaced by Stage 5b's route traversal`. Existing `uprn_snapshot` rows stay frozen.
  - `allocate_prop` has no `service_role` EXECUTE. Grant it if a server-side caller ever needs to allocate.

---

### Stage 06 — Field prop view and offline cache
- **Date:** 2026-09-14
- **Model:** Cursor Grok 4.6
- **Built:** Migration `010_todays_assignment.sql` — `todays_assignment()` SECURITY INVOKER, returns one jsonb document (header + `uprn_snapshot` joined to `properties.geom` in snapshot order as a FeatureCollection) or JSON null. `/field` map + list, Dexie cache of that full document keyed to assignment and canvasser. Types regenerated. Harness `npm run verify:stage6`.
- **Policies:** no new table, so no new RLS. Function ACL: `revoke all from public, anon, authenticated, service_role` then `grant execute to authenticated` only. Final ACL `postgres=X/postgres | authenticated=X/postgres`. No `app_role()` gate in the body.
- **Acceptance:**
  - Load the prop, enable airplane mode, force-quit, reopen — the prop renders from Dexie: **PASS** — canvasser JWT loaded `/field` (`Visit 1 · starting from the east · anticlockwise · mid · 69 doors`, first UPRN 48895, last 48873). Dexie `nakolabs-d2d-field` then held `{assignment_id: 05e544c1-…, work_date: 2026-09-14, door_count: 69, features: 69, compass: east}`. Blocked `*.supabase.co`, full document reload of `/field`: same header, same 69 doors, status “Showing the copy saved on this phone.” Dexie after reopen: same assignment_id, 69 features, first 48895, last 48873. **Caveat:** blocking `*supabase*` also blocked the Next.js chunk whose filename contains `supabase`, so the test blocks the API host only. A true airplane-mode reopen of the whole origin still needs an app shell (no service worker in this stage).
  - Dot order matches `uprn_snapshot` order: **PASS** — canvasser JWT HTTP 200, `feature order matches snapshot: true`, sequences `0..n-1: true`, 69 features / 69 snapshot. First UPRN 48895, last 48873. List view Door 1 = 48895 … Door 69 = 48873.
  - Tap accuracy test on a real phone, on a real terraced street, at zoom 19: **NOT VERIFIED** — needs a real phone on a real terrace. Circle radius at z19 is 16px (~32px diameter); 44px CSS on list rows is not that test.
  - Honest empty when the caller is not a member today: **PASS** — other / idle / office / admin JWT `HTTP 200 body=null` (office is null, not 42501). Idle canvasser in the browser: “No prop allocated for today.” plus “Nothing is assigned to you for today. If you should be out, speak to the person who allocates the props.”
  - Compass reuses Stage 5 centroid→entry-vertex `ST_Azimuth`: **PASS** — live assignment `entry_az=1.83139871854165` rad (`104.93°`) from `st_azimuth(st_centroid(geom), st_pointn(ring, entry+1))`; RPC `entry_compass=east`; independent octant from that azimuth `east`; match true.
  - EXECUTE authenticated, no `app_role()` gate: **PASS** — `acl={postgres=X/postgres,authenticated=X/postgres}`, `body_mentions_app_role=false`. Anon HTTP 401 `42501 permission denied for function todays_assignment`. Canvasser JWT sees only own assignment (`includes other's yesterday: false`).
  - Full RPC response cached, not the raw UPRN array: **PASS** — Dexie payload includes `doors.features[].geometry` and `properties.{uprn,sequence}` plus header fields. No `is_nccz` on features.
  - Nothing coloured, scored, or visually differentiated: **PASS** — one circle layer, `circle-color` is `--color-ink` for every door. Screenshot of Bishopston test prop: all dots the same.
- **Deviations from brief:**
  - Added `dexie` ^4.4.6. Reason: the brief's offline cache. Alternative rejected: `localStorage` (too small, no index by assignment).
  - Header uses compass (“starting from the east”), not a street name. UPRN dots have no address text (Section 3, rule 5). British “anticlockwise”, not the admin UI's “counter-clockwise”.
  - Dexie schema version 2 adds `canvasser_id` so a shared phone cannot show another canvasser's cached prop. Version 1 upgrade clears old rows.
  - RPC/network timeout (8s) and a native IndexedDB fallback if Dexie open is slow, so a blocked API cannot leave the screen on “Loading”.
  - MapTiler style fetch falls back to a plain worksheet background if tiles are unreachable; OS attribution stays on the control.
- **Not done / deferred:** Stage 5b routing. Stage 7 sync queue. Any field writes. Service worker / full-origin airplane shell. Tap-accuracy on a real terrace. 001–009 untouched. No coverage table. No scoring in `/field`.
- **Follow-ups:**
  - Tap accuracy at zoom 19 on a real terraced street is on you — do not treat CSS `min-h-11` as that test.
  - If demo-day airplane mode must survive a killed tab with no localhost either, add a service worker later; Dexie already holds the assignment document.
  - Map-layer skill: 69 points (the Bishopston street-ring fixture), measured on Windows 11 desktop Chrome via the Cursor browser. Not a mid-range phone.

> **Amended 2026-09-16.** Invariant 5 was narrowed on this date to permit read-only address labels. The original entry correctly records what shipped at the time (UPRN dots with no address text). Labels are added in Stage 1c plus the Stage 8 session, via a separate Dexie store — the snapshot shape recorded above is not altered.

---

### Stage 07 — Sync queue (session 1 of 2: queue module; service worker is the separate pass)
- **Date:** 2026-09-15
- **Model:** Claude Fable 5.1 (Cursor)
- **Built:** The only field write path, per `docs/plans/stage-7-plan.md` §1–3, 5. No migration; `supabase/migrations` and `lib/supabase/types.ts` untouched.
  - `lib/field/db.ts` version 3: `outbox` (`++seq, &client_event_id, assignment_id, canvasser_id, status, [assignment_id+seq], [status+assignment_id]`) and `sync_meta` (`key`). `assignments` unchanged, not cleared. Dexie opened with `cache: "disabled"` (see deviations).
  - `lib/sync/ops.ts`: `SyncOp` union (`knock_event` with optional paired `lead`, `property_observation`), narrow wire types (`KnockEventWrite` with device-generated `id`, `CanvasserLeadInsert` = the eight grantable columns so `status` cannot be expressed, `PropertyObservationWrite`), `validateOp` (rejects a lead whose `client_event_id` differs from its knock's, or whose `knock_event_id` is not the knock's `id`), `newClientEventId` / `newRowId` (`crypto.randomUUID`, `getRandomValues` fallback).
  - `lib/sync/classify.ts` (pure): `23505` → duplicate; `401`/`PGRST30x` → auth; status 0, abort, 408, 429, 5xx → retryable; every other 4xx → permanent. Keyed on SQLSTATE, not HTTP status, because PostgREST returns 409 for `23503` as well as `23505`.
  - `lib/sync/backoff.ts` (pure): full jitter, base 2 s, cap 5 min.
  - `lib/sync/queue.ts`: `enqueue` (check-then-add in one rw transaction; same id → `already_queued`), `flush(reason)` under a Web Lock `d2d-outbox-flush` with `ifAvailable` and one queued re-run behind a holder (in-memory flag where Web Locks is absent), `getSession` → held rows for other canvassers, per-assignment groups in `seq` order, ok/duplicate → `synced` + `sync_meta.last_sync_at`, permanent → `failed` and continue, auth → `auth_required` and stop, retryable → head-of-line block for that assignment and backoff. External triggers reset the backoff counter; the 30 s timer never piles onto a scheduled retry. `sendOp` exported for the harness: knock insert → (lead insert), each with its own 10 s `AbortController`, `Prefer: return=minimal`. `retryFailed`, `discardFailed`, `hasPending`, `getStatus`, `subscribe`.
  - `lib/sync/use-sync-status.ts`: `useSyncExternalStore` over Dexie core `liveQuery` (counts, failed rows, `last_sync_at`) merged with the queue's in-memory state. Restarts the observable if it errors or completes.
  - `components/field/sync-provider.tsx`: mount, `online`, `visibilitychange`→visible, `focus`, `pageshow` (persisted), 30 s timer while visible and pending. Development-only `window.__d2dSyncDebug` (`enqueueSynthetic`, `flush`, `dump`, `serverCount`, `reset`, `status`) behind `NODE_ENV === "development"`.
  - `components/field/sync-status.tsx`: header line (`3 to send · waiting for signal · last sent 14:02`, `Sign in again to send 3 knocks`, `Everything sent · last sent 14:02`) and a rejection banner per failed row with 44 px Retry / Discard. Border and text only; no colour carries meaning.
  - `app/(field)/layout.tsx` renders `<SyncProvider>`. `field-prop.tsx` gains `<SyncStatus />` under "Signed in as".
  - Offline identity (plan open question, confirmed in scope): `rememberCanvasser(uid)` writes `sync_meta.last_canvasser_id` on every successful online load (payload or honest-empty); `getCachedToday(uid | null)` falls back to it when `getSession()` has nothing. Native-IndexedDB fallback reader added for `sync_meta` to match the existing one for `assignments`.
  - `scripts/verify-stage-7.ts` (`npm run verify:stage7`, `--keep`, `--cleanup`).
- **Policies:** none new — no schema change.
- **Acceptance:**
  Harness: Node half with three throwaway users (admin, canvasser, second canvasser), a Bishopston street-ring territory allocated to the canvasser for today, every insert made with the canvasser's real JWT through the queue's own `sendOp`; service role only for fixtures, counts and cleanup. 45 checks, 45 pass on the final run; fixtures deleted (`leads=2 knock_events=3`, territory, users). Browser half in the Cursor browser (Windows 11 desktop Chromium) at `localhost:3000/field` signed in as the kept harness canvasser, connectivity controlled with CDP `Network.emulateNetworkConditions` / `Network.setBlockedURLs`, rows counted on the server by `client_event_id` from the same tab. Kept fixtures then deleted (`knock_events=168` across every browser run, `leads=2`).
  - 50 queued events flush without loss: **PASS** — tab offline (`navigator.onLine=false`), `enqueueSynthetic(50)` → 50 pending, 0 attempts, header `50 to send`. Emulation off → `online` event → 50 synced, `synced_at` monotonic in `seq` order, server 50/50 for those ids, `missing: []`, header `Everything sent · last sent 16:46`.
  - Killing the app mid-flush and reopening produces no duplicates and no losses: **PASS** — 50 queued offline, online with 400 ms emulated latency, `location.reload()` at 30 synced / 20 pending while `state=syncing`. Reopened tab: mount flush finished the rest, 50 synced / 0 pending / 0 failed, server 50 rows for 50 ids, `missing: []`, no row carrying a `23505`. (A first attempt without latency finished all 50 before the reload fired; repeated with latency so the kill was genuinely mid-flush.)
  - Deliberately replaying the same `client_event_id` twice results in one row: **PASS** — Node: `sendOp` twice → `ok` then `duplicate`; `knock_events=1 leads=1` for that id. Partial replay: knock-only send, then knock+lead with the same ids → knock `23505` swallowed, lead inserted, `1/1`, third send `duplicate` and still `1/1`. Browser: second `enqueue` of one id → `already_queued`, one outbox row; a synced row flipped back to pending by hand and re-flushed → `synced`, `last_error=null`, server unchanged (51/51).
  - Server rejection with a 4xx does not retry forever; it surfaces to the user: **PASS** — Node: another user's `canvasser_id` → 403 `42501` permanent; non-member JWT → `42501` permanent; ghost UPRN → 409 `23503` permanent (not duplicate); `outcome='bogus'` → 400 `23514` permanent; lead carrying `status` → `42501` at the lead step (the generated-type trap, now unreachable through `CanvasserLeadInsert`); garbage JWT → 401 `PGRST301` auth. Browser: ghost-UPRN knock → `failed`, `attempts=1`, `nextAttemptAt=null`; after two manual flushes and 36 s (past the 30 s timer) still `attempts=1`. Banner `1 knock was rejected by the server. Knock at Door 1 · 23503 · …` with Retry and Discard both 44 px. Retry → one more send, `attempts=2`, parked again. Discard → row gone, banner gone, `Everything sent`.
  - Queue survives a browser restart: **PASS with a caveat** — 5 queued offline (header `5 to send · waiting for signal`), tab closed, new tab with `*.supabase.co/rest/*` blocked, `/field` opened: same 5 ids present, 5 pending, row 1 `attempts=4` with `Failed to fetch`, rows 2–5 `attempts=0` (head-of-line held), `state=backoff`, `next attempt in 6.7 s`, header `5 to send · retrying shortly`. Unblocked → the scheduled `retry` (no `online` event) synced all 5, server 5/5. **Caveat:** this is a tab close and reopen in the Cursor-embedded Chromium, not a browser process restart. IndexedDB persistence across a process restart is a platform guarantee that was not separately exercised here.
  - Not in the checklist, verified: `sync_meta.last_canvasser_id` written on online load (`2d7b4b7c-…` = the signed-in uid); Dexie at version 30 (3) with `assignments`, `outbox`, `sync_meta`; `navigator.locks` present; classify/backoff/validateOp unit checks (14 + 5 + 6) pass; `tsc --noEmit` clean; `eslint --max-warnings 0` clean on every Stage 7 file.
  - Not verified, by instruction: the offline-identity fallback under real token expiry (manual, after both Stage 7 sessions).
- **Deviations from brief / plan:**
  - **Dexie opened with `cache: "disabled"`.** Found during the browser pass: Dexie 4.4.6's liveQuery cache middleware keeps a null optimistic op after a failed `add()` (the `ConstraintError` on a duplicate `client_event_id`) and every subsequent re-query throws `Cannot read properties of null (reading 'type')` in `applyOptimisticOps`, which kills the observable and freezes the header on a stale count. Three fixes, all kept: the cache is disabled (tables are tiny), `enqueue` checks for the id before adding so the error path is not hit in the first place (the `ConstraintError` catch remains as a race fallback), and the hook resubscribes if the observable errors or completes.
  - `enqueue` while `navigator.onLine === false` sets state `offline` immediately instead of leaving `idle`, so the header reads `waiting for signal` before the first flush attempt.
  - Rows for another canvasser (`held`) are skipped without breaking their assignment's group, per plan decision 8.
  - `app/(field)/layout.tsx` renders only `<SyncProvider>`; `<RegisterServiceWorker>` is the service-worker pass.
  - Ghost UPRN for the FK test is `999_999_999_999`, asserted absent first — UPRN `1` exists in Bristol's OS Open UPRN extract and the first run inserted a real row against it.
  - `sendOp` is exported from `queue.ts` (not a separate module) so the Node harness drives the identical wire path; the plan's file list is otherwise followed exactly.
- **Not done / deferred:**
  - Service worker, manifest, icons, `offline.html`, `middleware.ts` matcher, `next.config.ts` headers — the separate Stage 7 pass.
  - Stage 8: no knock UI, nothing calls `enqueue` outside the development harness. No `property_observation` producer yet (the type and send path exist).
  - Pruning of `synced` outbox rows (plan decision 5) — nothing deletes them yet; ~150 small rows a day. Decide alongside Stage 8's read model.
  - Offline-identity fallback under a genuinely expired token — manual, yours.
  - A real phone, real-network run of any of the above.
- **Follow-ups:**
  - On app open with pending rows and no signal, mount + focus + visibilitychange each reset the backoff and fire within a second (row 1 showed `attempts=4` after ~3.5 s). Harmless but chatty; a short cooldown on external triggers would trim it.
  - Stage 8 must pass the queue one `client_event_id` per door-visit action and `newRowId()` for `knock.id`, and build the lead with `knock_event_id = knock.id`; `validateOp` refuses anything else.
  - `window.__d2dSyncDebug` is development-only and reads `knock_events` for its own ids (`serverCount`); it is not a write path and is tree-shaken from production.
  - Dexie: re-check whether a later 4.x fixes the `applyOptimisticOps` null-op bug before re-enabling the cache.

---

### Stage 07 — Sync queue (session 2 of 2: app-shell service worker). Stage 7 complete ✅ — sync queue + service worker. Next: Stage 8.
- **Date:** 2026-09-15
- **Model:** Claude Fable 5.1 (Cursor)
- **Built:** The app shell, per `docs/plans/stage-7-plan.md` §1 (service-worker rows) and §4. No migration; `supabase/migrations`, `lib/supabase/types.ts` and every file under `lib/sync/` untouched. No new dependency.
  - `public/sw.js` — hand-rolled, plain JS, ~280 lines, scope `/`. Two caches: `d2d-shell-v{SW_VERSION}` (precache + `/field` HTML + `/maplibre/*`; deleted on activate when the version changes) and `d2d-static` (hashed `/_next/static/*`, unversioned, pruned on activate by `Date` header older than 14 days). Install precaches `/offline.html` (required), `/manifest.webmanifest`, `/icons/*`, `/maplibre/*.mjs` (best effort each). `skipWaiting` on install, `clients.claim` on activate. Fetch handler is an allowlist over same-origin GETs: `/_next/static/**` cache-first; `/maplibre/**` stale-while-revalidate; precached paths cache-first; navigations to `/field` or `/field/**` network-first with a 3 s timeout → cached document → `/offline.html`, cached only when `ok && !redirected && type === "basic"` and `content-type` is HTML, keyed by path without query, and the late network response still refreshes the cache. Everything else — `/admin`, `/office`, `/login`, `?_rsc=` payloads, POSTs, every cross-origin request (Supabase REST/Auth/Realtime, MapTiler) — returns without `respondWith`. No `sync`/`periodicsync` handler; no IndexedDB access. `message` handler: `WARM` (page-supplied `/_next/static/` URLs and, on the first uncontrolled load only, the document path, fetched with same-origin cookies) and `PING` → `PONG { version, startedAt }` for diagnostics.
  - `components/pwa/register-sw.tsx` — `"use client"`, production only, registers `/sw.js` (`scope: "/"`, `updateViaCache: "none"`) after `load`, posts every same-origin `/_next/static/` URL from `document.scripts`, `link[href]` and resource timing, then keeps posting via a `PerformanceObserver` (1.5 s debounce) as fonts and late chunks arrive.
  - `app/(field)/layout.tsx` — renders `<RegisterServiceWorker />` inside `<SyncProvider>`. Only the field group registers a worker.
  - `app/manifest.ts` → `/manifest.webmanifest`: placeholder identity (`name`/`short_name` `nakolabs-d2d`), `start_url` `/field`, `scope` `/`, `display` `standalone`, `orientation` `portrait`, `background_color` `--color-worksheet`, `theme_color` `--color-paper`, `lang` `en-GB`, icons 192/512 (+512 maskable).
  - `public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180) — placeholder artwork generated from palette tokens (`--color-prop` square, `--color-paper` door dot) with a throwaway pure-Node PNG encoder; no image dependency added, generator not committed.
  - `public/offline.html` — static, palette tokens inline, 44 px "Try again". Served only when `/field` is requested offline and has never been cached.
  - `app/layout.tsx` — `metadata.appleWebApp` (`capable`, `statusBarStyle: "default"`, title), `icons.apple`, `viewport.themeColor`. Manifest `<link>` is automatic.
  - `middleware.ts` — matcher now also excludes `sw.js`, `manifest.webmanifest`, `offline.html`, `icons/`, `maplibre/`.
  - `next.config.ts` — `headers()`: `/sw.js` → `Cache-Control: no-cache, must-revalidate`, `Service-Worker-Allowed: /`.
- **Policies:** none new — no schema change.
- **Acceptance:**
  Harness: production build (`next build --turbopack`, `next start -p 3100`) in the Cursor browser (Windows 11 desktop Chromium), signed in as the kept Stage 7 harness canvasser with today's 69-door Bishopston allocation; connectivity via CDP `Network.emulateNetworkConditions`; server rows counted by `client_event_id` with the service role from Node. Fixtures deleted afterwards (`knock_events=143`, `leads=2`, territory, users). The dev build was not used: registration is `NODE_ENV === "production"` only.
  - App force-quit + zero network + reopen (not a warm tab) still renders the shell and last-cached prop from Dexie: **PASS** — after one online visit the shell cache held the 7 precache entries plus `/field` (12,954 B, `basic`, 200, contains the signed-in name and no door data) and `d2d-static` held all 18 `/_next/static/` assets the page loaded (17 JS chunks + 2 CSS + 3 `woff2`), zero cross-origin entries. Worker `startedAt` recorded (`…445302`). Tab closed, `next start` process killed (port 3100 refused connections), 45 s wait, new tab set offline *before* navigating, `GET /field`: navigation `200`, `transferSize 0`, `responseStart 6 ms`; every one of the 18 static assets `transferSize 0` with `workerStart > 0`; `todays_assignment` RPC failed with status 0 and `workerStart 0` (passed through, not handled); worker `startedAt` `…600291` (155 s later — a fresh boot, not the same instance); header `STAGE 7 TEST PROP — DELETE ME / Visit 1 · starting from the east · anticlockwise · mid · 69 doors`, `Nothing to send`, `Showing the copy saved on this phone.`, 69 door rows, map canvas present. Map tiles came from the browser HTTP cache, not the worker (the caches hold nothing from `api.maptiler.com`). Screenshot taken. Fallback also exercised: `/field` entry deleted from the shell cache, tab offline, `GET /field` → `/offline.html` ("Not ready for offline use." / "Open the app once with signal to prepare it for offline use.") with a 44 px Try again.
  - Service worker install/activate does not swallow or delay a Dexie flush on reconnect: **PASS**, three ways.
    - Steady state (worker active, controlling): 20 rows seeded pending in the outbox while offline, tab online → 20 `POST /rest/v1/knock_events`, all `201` (the +1.82 s to the first request in this run is tool round-trip latency between "arm" and "go online"; the clean figure is in the next line); 20 synced / 0 failed, `attempts` all `0`, `synced_at` monotonic in `seq`, span 896 ms. Every request dispatched through the worker (`workerStart > 0`), `fetchStart − workerStart` 5.7 ms for the first (worker wake) then 0.1–0.3 ms each; nothing served from cache (caches contain no Supabase entry, all responses `201`).
    - Same again with the `online` event timestamped inside the page: 10 rows, first request **4 ms** after `online`, last response +501 ms, last `synced_at` +502 ms, 10/10 on first attempt.
    - Racing install/activate: worker unregistered and both caches deleted, 40 rows seeded pending and `location.reload()` called in the same script. Relative to the reload: document at +1 ms, uncontrolled; install precache fetched at ≈+440 ms; mount flush's first POST at +576 ms (no worker); worker claimed the page at ≈+630 ms *with that request in flight*; the remaining 39 POSTs dispatched through the new worker; all 40 `201`; 40 synced / 0 pending / 0 failed, every row `attempts 0`, last `synced_at` +2,344 ms; post-activation warm-up cached `/field` at +1,440 ms. Nothing was aborted, retried, or slowed by the claim.
    - Server: 140/140 browser-queued ids present, 0 missing, 0 duplicated (canvasser total 143 = 140 + 3 from the Node harness). Header `Everything sent · last sent 17:35`.
  - Not in the checklist, verified: online navigation is network-first (cached `/field` `Date` header equals the navigation start on each online load; the shell HTML carries the signed-in name and no door data); a controlled page does not re-fetch its own document for warm-up (`0` extra `/field` requests); `/sw.js` served with `cache-control: no-cache, must-revalidate` and `service-worker-allowed: /`; `<link rel=manifest>` at `/manifest.webmanifest`, `apple-mobile-web-app-capable=yes`, `theme-color #fbfaf8`; `tsc --noEmit` clean; `eslint --max-warnings 0` clean on every file touched; `next build` clean (12/12 pages).
  - Not verified: an installed home-screen app on a real phone (iOS partitioned storage, Android install prompt); a real airplane-mode reopen on a device; the 14-day `d2d-static` prune (no entry is old enough yet); behaviour after a production deploy changes the chunk set (reasoned, not exercised on Vercel).
- **Decisions (this stage):**
  - **Network-first for `/field` HTML, not literal cache-first.** Literal cache-first would skip middleware's cookie refresh on every open, keep booting the old build after a deploy until `sw.js` itself changed, and hand a signed-out user the shell instead of `/login`. Offline behaviour is identical: network fails fast → cached copy. Cache-first is kept for hashed assets only, which is what "cache-first for the app shell" in `offline-shell.mdc` protects.
  - **`next-pwa` rejected.** Webpack-plugin based and effectively unmaintained against Next 15/Turbopack; pulls Workbox; its generated worker runtime-caches API responses by default, which is the exact behaviour the Dexie-owns-data rule forbids. **`@serwist/next` rejected.** Maintained, and it would give true install-time precache of hashed chunks via build-manifest injection, but that buys nothing here — a device that has never been online has an empty Dexie and nothing to show — at the cost of a bundler integration and Workbox-style caching defaults to disable. Hand-rolled `sw.js` is small enough that owning it is cheaper than configuring around a library. Also not added: `uuid`, `dexie-react-hooks`, `fake-indexeddb`, any PNG library.
  - **Hashed chunks are warmed after load, not precached on install.** Chunk names are content-hashed at build; a static `public/sw.js` cannot list them. The page posts what it actually loaded and the runtime cache-first handler catches anything missed.
  - **Offline-identity fallback stands as built in session 1** (`sync_meta.last_canvasser_id`, used only when `getSession()` has nothing). The cold-open above ran with a live session; the expired-token path is still the manual check below.
  - Registration is production-only and field-layout-only. Once registered on a device the worker's scope is `/`, so it will also see `/admin` and `/office` navigations on that device — and pass them through untouched.
- **Deviations from brief / plan:**
  - `PING`/`PONG` message added to the worker for diagnostics (proves a cold boot in acceptance; useful for version checks after deploys). Not in the plan.
  - Precache is per-URL best effort, not `cache.addAll`; only `/offline.html` failing fails the install. A missing icon must not leave a device without a worker.
  - On a controlled load the page does not warm its own document (the navigation handler already cached it); only the first, uncontrolled load posts `location.pathname`. Saves one HTML round-trip with a middleware `getUser()` per open.
  - `/sw.js` also carries `Service-Worker-Allowed: /` (harmless at root scope; explicit).
  - `Cache-Control: private, no-store` from middleware is on the cached `/field` document. The Cache API ignores it by design — this is the whole point — but it means the copy can outlive the session that produced it (see follow-ups).
- **Not done / deferred:**
  - Branding: app name, icon artwork, theme colour are placeholders by instruction.
  - Stage 8: no knock UI, nothing calls `enqueue` outside the development harness.
  - MapTiler tiles are not cached by the worker (data cache concern, outside "app shell"). Offline with a cold HTTP cache the map is dots on the plain worksheet background, as in Stage 6.
  - Pruning of `synced` outbox rows — still nothing deletes them (plan decision 5; decide with Stage 8's read model).
  - Offline-identity fallback under a genuinely expired token — **code done, manual verification still pending** (load prop, airplane mode, wait > 1 h, force-quit, reopen).
  - A real phone, real network, real home-screen install.
- **Follow-ups:**
  - **Hard gate before Stage 8: the Stage 6 tap-accuracy test on a real phone, on a real terraced street, at zoom 19, has still not run.** Stage 8 builds the knock logger on top of that target size; the brief says stop and redesign the target before Stage 8 if tapping the right door is unreliable. It is yours to run.
  - Shared phone: the cached `/field` HTML carries the last signed-in name until the next online load. Dexie is keyed on `last_canvasser_id`, so the *prop* shown is the right one; only the "Signed in as" line can be stale. Acceptable for now; revisit if the office ever hands one phone to several canvassers.
  - Bump `SW_VERSION` whenever the precache list or the caching rules change; hashed assets need no bump.
  - Development never registers the worker. To test shell behaviour locally use `next build && next start -p 3100`; do not run `next build` while `next dev` is up (Stage 4 follow-up still applies).
  - iOS: an installed home-screen app has its own cookies and IndexedDB, partitioned from Safari. A canvasser must sign in and load the prop once *inside the installed app*; warming Safari does not warm the icon. Installed apps are also exempt from Safari's 7-day storage eviction, which is a second reason to steer canvassers to the icon.
  - **Next step: Stage 8 — Knock logger.** The queue is the only write path (`enqueue` with one `client_event_id` per door-visit action, `newRowId()` for `knock.id`, lead built with `knock_event_id = knock.id`); the shell is in place; nothing in Stage 8 should touch `public/sw.js`.

---

### Stage 1c — Address labels (data layer)
- **Date:** 2026-09-16
- **Model:** Cursor Grok 4.6
- **Built:** `property_addresses` (UPRN PK → `properties`, display fields only, source/confidence checks, street and postcode indexes). RLS on; SELECT for `authenticated` only; no write policy. Ingest RPCs `upsert_property_addresses(jsonb)` (confidence-aware, joins `properties`) and `list_property_uprns` (keyset pages as jsonb), EXECUTE `service_role` only. `scripts/ingest-addresses.ts --pass=epc` streams `data/raw/epc-bristol/certificates.csv`, votes street per EPC postcode, parses labels, upserts in batches of 750. Track B passes log `not implemented, Track B` and exit 0. `lib/supabase/types.ts` regenerated. `npx tsc --noEmit` exit 0.
- **Policies:** `property_addresses_select_authenticated` — SELECT to `authenticated`, `using (true)`. No INSERT/UPDATE/DELETE policy. Table GRANT: SELECT to `authenticated` only (anon none). Function EXECUTE: `service_role` only after 012.
- **Acceptance:**
  - Re-running the ingest changes no row counts: **PASS** (first and second run both 82,381 written / 81,404 exact / 977 street_only)
  - A known Bristol street is spot-checked door by door against reality: **PASS** — Wells Road, Totterdown `BS4 2BU` odds 149–173 match the source certificates (`149 WELLS ROAD | TOTTERDOWN`, `151, Wells Road`, `Flat 1 | 157 Wells Road`, `163, Wells Road`) and form a continuous terrace. Not a pavement walk.
  - A lower-confidence pass cannot overwrite an `exact` row: **PASS** — `upsert_property_addresses` of UPRN 97 as `osm`/`street_only` returned 0; row stayed `exact` / `9` / `Charlton Gardens` / `epc`
  - Unmatched UPRNs are absent from the table, not present with nulls: **PASS** — `house_number is null and street_name is null` = 0; `inferred` = 0
  - Coverage reported as a percentage of Bristol UPRNs in `properties`: **PASS** — 19.39% (82,381 / 424,952)
  - No address column exists on `properties`, `knock_events`, `leads` or in `uprn_snapshot`: **PASS** — `house_number`/`street_name`/`building_name`/`sub_building` exist only on `property_addresses`; `assignments.uprn_snapshot` remains `_int8[]`
- **RLS (simulated JWT, not a real login cookie):** as `authenticated`, SELECT count = 82,381; INSERT/UPDATE/DELETE = `42501`; `upsert_property_addresses` EXECUTE = `42501`. as `anon`, SELECT = `42501`.
- **Deviations from brief:**
  - Second migration `012_property_addresses_revoke_execute.sql`. Reason: Supabase default privileges grant EXECUTE to `anon` and `authenticated` on new functions; 011's `revoke from public` left those role grants in place. Alternative rejected: editing applied 011.
  - Ingest RPCs `list_property_uprns` and `upsert_property_addresses` are not in the brief's CREATE TABLE block. Same pattern as Stage 1's `upsert_properties`. Alternative rejected: 425 PostgREST pages of 1,000 UPRNs, and client-side confidence filtering.
  - Street vote uses a strict majority (>50% of field-votes). Unique plurality below 50% is treated as a failed vote. 3,615 postcodes failed; 56,650 matched UPRNs were not inserted. City-centre blocks (Creswicke House / St. Giles Court / Small Street) typically tie building name with street and are absent, as specified (“do not force a winner”).
  - Date column detected at runtime; this extract used `lodgement_datetime`.
- **Not done / deferred:** `--pass=osm|linked_ids|land_registry`. Interpolation pass (`inferred`). Field display / Dexie `addresses` store (Stage 6 amendment). Stage 8. Nothing under `app/(field)` or Dexie. Did not backfill `properties.postcode` (still NULL on every row). Did not go through `lib/sync/queue.ts`.
- **Follow-ups:** Coverage is 19.39% of OS Open UPRN points, not the 50–60% the brief guessed for dwelling-like UPRNs. Unique EPC UPRNs in `properties` were 139,031 (32.7%); the rest of the drop is failed street votes. A later pass can fill unmatched UPRNs; it must not overwrite `exact`.
- **Numbers:**
  - rows read / usable uprn / matched to `properties`: 183925 / 178363 / 178357
  - distinct UPRNs written: 82381
  - coverage: 19.39%
  - exact / street_only: 81404 / 977
  - postcodes where street vote failed: 3615
  - 20 most common `street_name`: Wells Road 358, Long Cross 301, Whitehall Road 289, Ashley Down Road 275, Stapleton Road 255, St. Johns Lane 250, Bishport Avenue 245, Two Mile Hill Road 188, Wordsworth Road 171, Ridgeway Road 168, Portway 159, Paxton Drive 155, Bishopsworth Road 153, Clouds Hill Road 153, Greystoke Avenue 152, Cranbrook Road 151, Ilchester Crescent 151, Bloomfield Road 149, Speedwell Road 149, Stackpool Road 149

---

### Stage 1c — Address labels (parser fix: drop the postcode street vote)
- **Date:** 2026-09-16
- **Model:** Cursor Grok 4.6
- **Built:** Replaced the EPC postcode-majority street vote with a per-row parse in `scripts/lib/epc-address.ts` / `scripts/ingest-addresses.ts`. Street = last of address3/address2/address1 containing a street-type suffix (optional North/South/East/West). House number = leading number of that field, else the preceding field when it is only a number. Both fields starting with a digit → `house_number` null / `street_only`. Never borrows Flat/Studio/Unit numbers. Certificate pick prefers `uprn_source='Address Matched'`, then most recent `lodgement_datetime` parsed from the stored value. Postcode modal is a flag only (`spatial_approx`); `street_name` is not rewritten. Title-case on `street_name` and letter suffixes on `house_number`. Migration `013_property_addresses_epc_attrs.sql` adds `property_type` and `uprn_source`; recreates `upsert_property_addresses` to write them and to let a same-source re-run replace its own rows. The epc pass deletes previous `source='epc'` rows then INSERTs, so previously-rejected postcodes are not stuck on an UPDATE of a missing row. `lib/supabase/types.ts` regenerated. `npx tsc --noEmit` exit 0.
- **Policies:** none new. Existing `property_addresses_select_authenticated` (SELECT, `authenticated`, `using (true)`) covers the two new columns. No write policy. EXECUTE on `upsert_property_addresses` remains `service_role` only after 013's revoke/grant.
- **Acceptance:**
  - Re-running the ingest changes no row counts: **PASS** — first and second run both 132,977 written / 106,314 exact / 592 spatial_approx / 26,071 street_only / 0 inferred
  - A known Bristol street is spot-checked door by door against reality: **PASS** — Wells Road, Totterdown `BS4 2BU` odds 141A–173, title-cased (`141A` not `141a`), Flats 1–4 at 157/159/161. Not a pavement walk. **Also** `BS1 1DB` (Creswicke House, 9 Small Street, studios A1–D6) and `BS1 1DZ` (St. Giles Court flats are `street_only` on Small Street; Flat 17 / `14 St. Giles Court` were not written as house numbers)
  - A lower-confidence pass cannot overwrite an `exact` row: **PASS** — `upsert_property_addresses` of UPRN 123665 as `osm`/`street_only` returned 0; row stayed `exact` / `163` / `Wells Road` / `epc`
  - Unmatched UPRNs are absent from the table, not present with nulls: **PASS** — `house_number is null and street_name is null` = 0; `inferred` = 0
  - Coverage reported as a percentage of Bristol UPRNs in `properties`: **PASS** — 31.29% any label (132,977 / 424,952), 25.02% exact (106,314 / 424,952)
  - No address column exists on `properties`, `knock_events`, `leads` or in `uprn_snapshot`: **PASS** — `house_number`/`street_name`/`building_name`/`sub_building` exist only on `property_addresses`; `assignments.uprn_snapshot` remains `bigint[]`
- **RLS (simulated JWT, not a real login cookie):** as `authenticated`, SELECT count = 132,977; INSERT/UPDATE/DELETE = `42501 permission denied for table property_addresses`; `upsert_property_addresses` EXECUTE = `42501 permission denied for function`. as `anon`, SELECT = `42501`.
- **INSERT path:** first run deleted 139,031 previous epc rows then upserted 132,977 (row_count = write set, all INSERTs). Surgical check: DELETE UPRN 123665 then `upsert_property_addresses` of that one row returned 1 and restored `163 Wells Road`.
- **Deviations from brief / expected numbers:**
  - All-certificate rows with a house number and street *before* the ambiguous-null rule: 142,561 + 730 = 143,291 (77.91%) vs expected ~143,337 (77.93%). After nulling the 730 double-number rows: 142,561 (77.51%). Not material.
  - Distinct UPRNs with a house number: 106,906 (76.89% of 139,031) vs expected ~107,962 (77.65% of 139,035). −1,056 / −0.76pp. Coverage still landed in the quoted band.
  - Postcodes with exactly one parsed street: 91.51% vs 91.16%. 592 `spatial_approx` rows are minorities on multi-street postcodes (a unique-street postcode cannot disagree). `street_name` was not rewritten.
  - Ambiguous double-number rows: 730 vs 713.
  - Same-source re-run of epc now overwrites even when confidence falls, so a parser fix can demote `exact` → `spatial_approx`. A *different* source still cannot overwrite a higher-confidence earlier pass.
- **Not done / deferred:** `--pass=osm|linked_ids|land_registry` (`osm` still logs `not implemented, Track B`). Interpolation (`inferred`). Field display / Dexie `addresses` store. Stage 8. Nothing under `app/(field)` or Dexie. Did not backfill `properties.postcode`. Did not edit 011 or 012.
- **Follow-ups:** `Park` / `Vale` as suffixes put neighbourhood names such as Westbury Park and Arnos Vale into the top-20 streets when they sit in a later address field than the true street. Spec-compliant (last suffix field wins). A later pass can fill unmatched UPRNs; it must not overwrite `exact`.
- **Numbers:**
  - rows read / usable uprn / matched to `properties`: 183925 / 178363 / 178357
  - rows yielding house number + street (all certificates, after rule 4): 142561 (77.51%)
  - distinct UPRNs written / with a house number: 132977 / 106906
  - coverage: 31.29% any label, 25.02% exact (was 19.39% / 81,404 exact)
  - exact / spatial_approx / street_only: 106314 / 592 / 26071
  - Address Matched preferred over a newer Energy Assessor row: 458
  - uprn_source on written rows: Energy Assessor 119834, Address Matched 13143
  - 20 most common `street_name`: Fishponds Road 796, Whitchurch Lane 705, Redcliff Street 661, Stapleton Road 590, Church Road 580, Gloucester Road 566, St. Annes Park 529, Westbury Park 504, Queens Road 472, Wells Road 435, Hotwell Road 422, Arnos Vale 418, New Kingsley Road 416, West Street 405, Bishport Avenue 403, Pembroke Road 378, St. Thomas Street 369, North Street 365, Lake Shore Drive 363, Redland Road 362

---

### Stage 1c — Address labels (suffix tiers: weak locality yields to earlier strong street)
- **Date:** 2026-09-16
- **Model:** Cursor Grok 4.6
- **Built:** Split street suffixes into STRONG and WEAK. If the last suffix-bearing field is WEAK-only and an earlier field is STRONG, use that earlier field. Parser lives in `scripts/lib/epc-address.ts` (called only from `scripts/ingest-addresses.ts`). No named-locality list. No migration.
- **Acceptance:** Re-run `--pass=epc` twice: **PASS** — both 132,391 written / 107,613 exact / 443 spatial_approx / 24,335 street_only. Table vs previous write: 0 street_name changes on the second run.
- **Deviations:** The rule is in `epc-address.ts`, not inlined in `ingest-addresses.ts` — that file only orchestrates ingest and the change log. Remaining Westbury Park 159 and St. Annes Park 132 are rows with no earlier STRONG field (same shape as Cotham Park). Suffixes that were on the old single list but not in either new tier (Mews, Causeway, Promenade, …) no longer count as streets.
- **Not done / deferred:** No migration, no field UI, no Stage 8, no Track B passes.
- **Numbers vs previous ingest (132,977 / 106,314 exact / 592 spatial_approx / 26,071 street_only):**
  - written 132,391 (−586)
  - exact 107,613 (+1,299)
  - spatial_approx 443 (−149)
  - street_only 24,335 (−1,736)
  - coverage 31.15% any label, 25.32% exact
  - vs previous parser: 2,014 renamed, 768 gained a street, 1,354 lost a street (4,136 UPRNs differed)
  - top 20: Fishponds Road 796, Whitchurch Lane 705, Redcliff Street 661, Church Road 617, Stapleton Road 590, Gloucester Road 566, Queens Road 472, Wells Road 435, Hotwell Road 422, New Kingsley Road 416, West Street 405, Bishport Avenue 403, Pembroke Road 378, St. Thomas Street 369, North Street 365, Lake Shore Drive 363, Redland Road 362, Ashley Down Road 360, Somerset Street 359, East Tucker Street 350. Westbury Park and St. Annes Park are no longer in the top 20.

---

### Stage 1c — Address labels (promotion house-number gate + restored strong suffixes)
- **Date:** 2026-09-16
- **Model:** Cursor Grok 4.6
- **Built:** Promotion of an earlier STRONG field over a later WEAK field now requires a house number on that strong field, or a house-number-only field immediately before it. Added to STRONG (none removed): Mews, Causeway, Promenade, Passage, Path, Steps, Hillside, Meadows, Fields, Croft, Orchard, Approach, Broadway, Circus, Embankment. Parade was already in STRONG.
- **Acceptance:** `--pass=epc` twice: **PASS** — both 133,619 / 108,546 exact / 452 spatial_approx / 24,621 street_only. Second run vs table: 0 renamed.
- **Deviations:** 447 UPRNs still lose a street vs the 132,977 last-suffix parser. Those fields ended in Yard, End or Crest — on that run's suffix list, never added to either current tier, not on this session's add list. Nothing was removed from STRONG or WEAK.
- **Not done / deferred:** No migration, no field UI, no Stage 8.
- **Numbers:**
  - vs 132,391 / 107,613 / 443 / 24,335: written 133,619 (+1,228), exact 108,546 (+933), spatial_approx 452 (+9), street_only 24,621 (+286)
  - vs 132,977 / 106,314 / 592 / 26,071: written 133,619 (+642), exact 108,546 (+2,232), spatial_approx 452 (−140), street_only 24,621 (−1,450)
  - promotion rule fired: 1,509 (down from 2,014 unguarded renames)
  - vs 132,977 parser: 1,527 renamed, 1,089 gained a street, 447 lost a street
  - vs 132,391 table (first write of this fix): 668 renamed, 0 rows dropped from that set

---

### Stage 8 — Knock logger (redesign, documentation only)
- **Date:** 2026-09-17
- **Model:** Cursor Grok 4.6
- **Built:** Documentation and configuration for the Stage 8 redesign. Applied `BRIEF-AMENDMENTS-STAGE-8.md` blocks A–N to `docs/D2D-Build-Brief.md`. Synced `AGENTS.md`, `.cursor/rules/00-core.mdc`, and `.cursor/skills/field-write/SKILL.md`. Created `docs/STAGE-8-SEAMS.md` and `.cursor/skills/outcome-mapping/SKILL.md`. No application code, no SQL, no migrations.
- **Acceptance:** documentation session — not Stage 8a/8b implementation.
  - Brief amendments A–N applied exactly as written: **PASS** (A, B, C, D, E, F, H, I, K appended as dated notes; G replaced Stage 8 body; J, L, M, N in-place)
  - Invariant 2 amended: eligibility facts (NCCZ, `do_not_call`, `no_opportunity`) may persist in `/field`; quality signals may not; current-assignment outcome colour permitted, previous-visit outcome colour banned: **PASS** (brief note + `AGENTS.md` + `00-core.mdc`)
  - Invariant 5 amended (second narrowing): house number may be typed against an already-selected UPRN into `address_observations`; search/autocomplete/street-postcode/address-as-identifier remain banned: **PASS** (brief note + `AGENTS.md` + `00-core.mdc`)
  - Stage 7 full-spec verification recorded: **PASS** as a dated note under Stage 7 (queue shipped to the full Section 6 specification, not Track A "-lite"; Track B "harden 7 to full" closed). This session did **not** re-run Stage 7 acceptance tests.
- **Deviations from brief:** none in application code — none was written. `AGENTS.md` Structure line for `app/(field)` now names the four tabs. `00-core.mdc` and the field-write skill were updated to match the two invariant amendments so they do not contradict the brief.
- **Not done / deferred:** Stage 8a schema. Stage 8b UI. No files under `app/`, `components/`, `lib/`, or `supabase/migrations/`. Did not write or run SQL. Did not create migrations. Did not begin Stage 8a.
- **Follow-ups:** Stage 8a is next (Frontier, highest reasoning). Pre-flight: `knock_events` and `property_observations` must both still be empty before CHECK changes.

---

### Stage 8a — Knock logger (schema)
- **Date:** 2026-09-17
- **Model:** Claude Fable 5.1 (Cursor)
- **Pre-flight:** `select count(*) from knock_events` → **0**; `select count(*) from property_observations` → **0**. Constraint names read from `pg_constraint` (`contype='c'`): `knock_events_outcome_check`, `property_observations_tenure_check`. Both happen to match the names the brief chose for the replacements, so drop-and-recreate keeps the names. Next free migration number read from `supabase/migrations/` and the remote migration list: **014**.
- **Built:** `supabase/migrations/014_stage_8a_knock_logger_schema.sql`, applied to the linked project. SQL and generated types only — no UI, no components, no Dexie, nothing under `lib/sync/`.
  - `knock_events.outcome` CHECK now has nine values including `no_opportunity`; `property_observations.tenure` CHECK gains `no_opportunity`.
  - `knock_events.notes text` with `knock_events_notes_len` (`null or length ≤ 280`).
  - Policy `"canvasser reads team knocks"` (SELECT, `authenticated`) on `knock_events`: `exists (select 1 from assignment_members am where am.assignment_id = knock_events.assignment_id and am.canvasser_id = (select auth.uid()))`. Combines by OR with `knock_events_select_own` and `knock_events_select_admin`. Insert policy untouched.
  - Indexes: `knock_events_latest_idx (assignment_id, uprn, occurred_at desc)`; `assignment_members_canvasser_idx` via `create index if not exists` — it already existed from `003_core.sql` line 73.
  - `address_observations` (`id`, `client_event_id unique`, `uprn → properties`, `canvasser_id → profiles`, `house_number` 1–12 chars, `observed_at`), index `address_observations_uprn_idx (uprn, observed_at desc)`, plus the implicit unique index on `client_event_id`. RLS enabled. Grants: `revoke all from anon, authenticated` then `grant select, insert to authenticated` (no update, no delete — corrections are new rows).
  - `leads_set_is_immediate()` — plpgsql, `security definer`, `set search_path = public, pg_temp`, EXECUTE revoked from `public, anon, authenticated`. Trigger `leads_is_immediate_biu` `before insert or update of booked_for`. Compares `booked_for` and the knock's `occurred_at` as `Europe/London` dates; `null booked_for` → `false`.
  - `v_latest_knock` and `v_door_label`, both `with (security_invoker = true)` (confirmed in `pg_class.reloptions`). SELECT revoked from `anon`, granted to `authenticated`. `v_door_label` exposes `uprn, house_number, building_name, street_name, canvasser_supplied`; no `sub_building`.
  - `addresses_for_assignment(uuid)` — `language sql stable security invoker`, `set search_path = public, pg_temp`; `revoke all … from public, anon, authenticated, service_role` then `grant execute … to authenticated`.
  - `lib/supabase/types.ts` regenerated (new table, `notes`, both views, the RPC). `npx tsc --noEmit` exit 0.
- **Policies written (role → effect):** `knock_events` `"canvasser reads team knocks"` — SELECT for any `authenticated` user who has an `assignment_members` row on that knock's assignment. `address_observations` `"authenticated read labels"` — SELECT `using (true)` for `authenticated`; `"canvasser writes own observations"` — INSERT `with check (canvasser_id = (select auth.uid()))` for `authenticated`. No UPDATE or DELETE policy or grant on `address_observations` for any JWT role. Office still has no read on `knock_events` (unchanged from Stage 2).
- **Acceptance:** harness was a temporary Node script (deleted after the run, not committed) that created five confirmed users via the Auth admin API — admin, office, canvassers c1 and c2 (a duo allocated to one Bishopston test prop, 69 doors), canvasser c3 (member of nothing) — signed each in over HTTPS and made every RLS call with that user's real `access_token` through `supabase-js`. The service role was used only for fixtures, verification counts and cleanup. Fixtures deleted afterwards; table totals after cleanup: `knock_events=0 property_observations=0 address_observations=0 leads=0`.
  - Both pre-flight counts were 0 and are recorded here: **PASS** (0 / 0, above)
  - Constraint names were read from `pg_constraint`, not assumed: **PASS** (query and both names above)
  - `'no_opportunity'` inserts succeed on both tables; an invalid value fails: **PASS** — as canvasser c1: `knock_events.outcome='no_opportunity'` inserted; `'bogus'` → `23514 … "knock_events_outcome_check"`; `property_observations.tenure='no_opportunity'` inserted; `'bogus'` → `23514 … "property_observations_tenure_check"`. Also `notes` of 281 chars → `23514 … "knock_events_notes_len"`, 280 chars accepted.
  - A canvasser JWT reads a teammate's knock on a shared assignment: **PASS** — as canvasser c2, `select id from knock_events where id = <c1's knock>` → 1 row.
  - A canvasser JWT cannot read a knock on an assignment they are not a member of: **PASS** — as canvasser c3, same query → 0 rows; `select count(*) from knock_events` → 0. As office → 0 (unchanged). As c2, INSERT with `canvasser_id = c1` → `42501` (insert policy unchanged).
  - A canvasser JWT still cannot update `leads.status`: **PASS** — as canvasser c1, `update leads set status='sale' where id = <own lead>` → `rows_updated=0`, status still `pending` (service-role read). Same result as Stage 2: no canvasser UPDATE policy, so RLS matches no rows; `leads_guard_status` is the backstop. INSERT carrying `status='sale'` → `42501 permission denied for table leads` (column grant, unchanged).
  - `address_observations`: canvasser inserts own, cannot insert as another `canvasser_id`, can read all: **PASS** — as c1, insert own (`14A`) → ok; insert with `canvasser_id = c2` → `42501 new row violates row-level security policy`; as c3 (outsider) `select` → 1 row (all rows visible). Also as c1: UPDATE → `42501 permission denied`, DELETE → `42501 permission denied`; 13-char `house_number` → `23514 … "address_observations_number_len"`; as anon SELECT → `42501`.
  - A lead booked for the knock's own day gets `is_immediate = true`; next week `false`; client-sent `is_immediate` overridden: **PASS** — as canvasser c1 with knock `occurred_at = 2026-09-17T10:00+01:00`: `booked_for` same day 18:00 with client `is_immediate=false` → stored **true**; `booked_for` 2026-09-24 with client `is_immediate=true` → stored **false**; `booked_for=null` with client `is_immediate=true` → stored **false**. UPDATE path: as office, `update leads set booked_for = 2026-09-24…` on the same-day lead → `is_immediate` flipped to **false**.
  - A 23:30 booking on the knock's own day is still `is_immediate = true` (Europe/London, not UTC): **PASS** — knock `occurred_at = 2026-09-17T00:30+01:00` (= `2026-09-16T23:30Z`), `booked_for = 2026-09-17T23:30+01:00` (stored `2026-09-17T22:30:00+00:00`). UTC dates differ (16th vs 17th); London dates match → **true**. A UTC comparison would have returned false.
  - Both views report `security_invoker` on; a canvasser reading `v_latest_knock` sees only permitted rows: **PASS** — `pg_class.reloptions` = `security_invoker=true` for both. As canvasser c2 (teammate) `select from v_latest_knock` → 8 rows; as canvasser c3 (outsider) → 0 rows; as office → 0 rows; as admin → 8 rows; as anon → `42501 permission denied for view v_latest_knock` and `… v_door_label`. As c3, `v_door_label` for the door c1 labelled → `house_number='14A', canvasser_supplied=true, street_name='Monmouth Road'` (observation beats the EPC label).
  - `v_latest_knock` returns exactly one row per (assignment, uprn) after three knocks on the same door, and it is the newest: **PASS** — as c1, three knocks on one door inserted out of order (11:05 `no_answer`, 11:10 `callback`, 11:00 `answered`); view → 1 row, `outcome='callback'`, `occurred_at=10:10Z` (= 11:10 BST). Underlying table still holds 3 rows.
  - `addresses_for_assignment` tested under a real canvasser JWT; returns no `sub_building`: **PASS** — as canvasser c1, `rpc('addresses_for_assignment', {p_assignment_id})` → 69 rows = snapshot length, 55 ms round-trip; keys exactly `building_name, house_number, street_name, uprn`; 36/69 labelled; the labelled door came back as `14A`. As canvasser c3 (not a member) → 0 rows, no error; as office → 0 rows; as anon → `42501 permission denied for function addresses_for_assignment`.
  - `lib/supabase/types.ts` regenerated and compiles: **PASS** — `npx tsc --noEmit` exit 0; diff is `address_observations`, `knock_events.notes`, `v_door_label`, `v_latest_knock`, `addresses_for_assignment`.
  - Every table still reports `rowsecurity = true`: **PASS** — `pg_class.relrowsecurity` true for `address_observations, assignment_members, assignments, knock_events, leads, nccz_zones, profiles, properties, property_addresses, property_observations, territories`. `spatial_ref_sys` false, PostGIS-owned, reported separately as in Stage 2.
  - Not in the checklist, checked: `explain analyze` of the `v_door_label` join shape for a 2,000-UPRN snapshot (as `postgres`, performance only) — index scans throughout (`properties_pkey` with `= ANY`, `property_addresses_pkey`, `address_observations_uprn_idx`), no seq scan, 748 ms cold.
- **Deviations from brief:**
  - `assignment_members_canvasser_idx` written as `create index if not exists` because `003_core.sql` already created it; the brief's bare `create index` would have failed the migration.
  - `auth.uid()` wrapped as `(select auth.uid())` in both new policies, matching every policy in 003 (initplan, evaluated once). Semantically identical.
  - Grant hygiene beyond the brief's SQL, following 003/010/012: `revoke all from anon, authenticated` then `grant select, insert` on `address_observations`; SELECT revoked from `anon` on both views; the RPC's `revoke` names `public, anon, authenticated, service_role` explicitly, because Supabase default privileges grant EXECUTE to `anon` and `authenticated` directly and `revoke from public` alone leaves those in place (the 012 lesson); `leads_set_is_immediate()` EXECUTE revoked from `public, anon, authenticated`.
  - Policy `"canvasser writes own observations"` is exactly the brief's `with check (canvasser_id = auth.uid())` — it does not gate on `app_role() = 'canvasser'` the way `property_observations_insert_canvasser` does. An admin or office user could record an observation as themselves. Kept as specified; flagged.
- **Not done / deferred:** Stage 8b (tabs, logger, sheet, Dexie stores, queue ops for `notes`, `address_observations`, `no_opportunity`). No `log_knock_outcome` RPC (rejected in the brief). No address column on `properties`, `knock_events`, `leads` or `uprn_snapshot`. `properties.postcode` not backfilled. `match_confidence='inferred'` not written anywhere. No files under `app/`, `components/`, `lib/sync/`, `lib/field/`. `lib/sync/ops.ts` wire types do not yet know about `notes` or `address_observations` — that is 8b's queue work.
- **Follow-ups:**
  - Stage 8b must send `notes` on the knock and add an `address_observation` op through `lib/sync/queue.ts`; `is_immediate` must not be sent by the client (the trigger overrides it, but `CanvasserLeadInsert` should stop carrying it).
  - `v_latest_knock` is the one latest-wins rule; Stage 9 reuses it. Do not write a second `distinct on`.
  - Office still cannot read `knock_events` or `v_latest_knock`; Stage 13 (immediates board) will need to decide whether office reads through `leads` only or gets a policy.
  - The 2,000-door `addresses_for_assignment` cold run was 748 ms as `postgres`; measure under a real canvasser JWT on a real 2,000-door prop in 8b before deciding whether the label fetch needs caching in Dexie earlier than planned.

---

### Stage 8b — Knock logger (field UI)
- **Date:** 2026-09-17
- **Model:** Cursor Grok 4.6
- **Built:** Four-tab field shell under `app/(field)/layout.tsx` (Map, Logger, Leads, Profile) sharing `SyncProvider`, `FieldDataProvider`, undo toast and tab bar. Logger sequence cursor with ✎ house-number sheet, 120px mini map, frequency-ordered outcome buttons (No Answer 96 / Contact 80 / Rented/Council 72 / Lead 72 / Other 56). Canonical mapping in `lib/field/outcomes.ts`; all writes through `lib/field/log-outcome.ts` → `lib/sync/queue.ts`. `KnockEventOp` gained `notes` plus optional nested `lead` / `observation`; `AddressObservationOp` is a separate kind, both registered in `validateOp`. `is_immediate` excluded from `CanvasserLeadInsert` and rejected if present. Dexie bumped **3 → 4** adding only `addresses` keyed on `uprn`. Outbox gained `held_undo` + `eligible_at`, 60s promotion, `promoteDue` on mount. Seams in `docs/STAGE-8-SEAMS.md` all present. MHCLG/EPC attribution on the field maps and the admin prop drawer.
- **Acceptance:**
  - Logging a knock offline, then reconnecting, produces exactly one row: **PASS** — airplane-mode Lead (cid `1e18528a-…`) sat `held_undo` then `pending` with 0 attempts; on reconnect the outbox flipped to `synced`; Postgres had exactly one `knock_events` row and one `leads` row for that cid, sharing it, `is_immediate=true` (Today PM), `is_immediate` absent from the client payload.
  - A logged door visibly changes state immediately, before sync: **PASS** — after No Answer the sequence strip showed `○ No answer` and the already-logged line appeared while the row was still `held_undo`; Postgres query for those cids returned `[]`.
  - `lead` produces one knock and one lead sharing ONE `client_event_id`, generated at the Lead tap; replay after partial failure is clean: **PASS** — Dexie payload `knock.client_event_id === lead.client_event_id === op.client_event_id`, lead keys exactly `id, client_event_id, knock_event_id, uprn, canvasser_id, booked_for, notes`; `scripts/verify-stage-8b.ts` ALL CHECKS PASSED including 3 / 3b (partial-failure recovery, `ok at lead` after knock 23505). Browser undo of cid `4b513653-…` left `leads` count 0 for that id.
  - Rented/Council → `no_opportunity` knock + `property_observations.tenure='no_opportunity'`, one cid: **PASS** — Dexie payload `outcome=no_opportunity` with `observation.tenure=no_opportunity`; harness section 4; Postgres row `a6661857-…` has both.
  - Every write goes through `lib/sync/queue.ts`. Grep `supabase.from(` / `supabase.rpc(` under `components/` and `app/(field)/`: **PASS** — zero hits. The only field RPC is `addresses_for_assignment` in `lib/field/labels.ts` (read, once on prop open). No `.update` / `.delete` on `leads` or `knock_events` from field code.
  - Undo within 60 s leaves zero rows in Postgres: **PASS** — queried four held cids immediately after log → `[]`; undid the Lead; `select count(*) from leads where client_event_id = '4b513653-…'` → 0. That cid never appeared in `knock_events` either.
  - Force-quit inside the undo window, reopen, promote and sync: **PASS** — `promoteDue()` runs on `SyncProvider` mount before the first flush; earlier in this session, rows whose `eligible_at` had passed while offline were `pending` with attempts=0, then `synced` on reconnect. Not a physical process-kill on a phone.
  - Logging the same door twice leaves two `knock_events` rows and exactly one `v_latest_knock` row, newer outcome: **PASS** — UPRN 48904 had 3 knocks (`no_opportunity` then `answered` as a correction with a new cid); `v_latest_knock` for 48904 → 1 row, `answered`. Harness section 5 also passed.
  - A 400 ms double tap logs one door, not two: **PASS** — two immediate clicks on No Answer added exactly 1 outbox row (`newAfterDouble: 1`); `useInputLock` is 400 ms.
  - Typing a house number writes one `address_observations` row and the label updates: **PASS** — earlier browser pass wrote 38A against the already-selected UPRN via `AddressObservationOp`; Dexie plate updated before sync; `v_door_label` newest-wins (38 then 38A). Harness section 6. Still visible this session as `38A Monmouth Road`.
  - A door with no label renders cleanly with the ✎ affordance — never "Unknown": **PASS** — door 5 plate `—`, sequence `3 — —` / `5 — —`; ✎ present; Notes privacy line "Do not record names or contact details."
  - `grep -r "navigator.geolocation"`: **PASS** (call sites) — zero uses. Remaining hits are prohibition comments in `lib/field/position.ts` and `components/field/mini-map.tsx`, plus the brief / AGENTS / rules. No `navigator.geolocation` in executable code.
  - Every row of `docs/STAGE-8-SEAMS.md` is ticked: **PASS** — see seams checklist below.
  - Numbers out of sequence is EXPECTED and the banner explains it: **PASS** — banner "Door order follows the interim sweep, not the street."; sequence 17, 15, —, 11, —, 38A, 5. Snapshot ordering untouched.
  - Tested on a real phone, one-handed, at arm's length: **NOT VERIFIED** — desktop Chromium only. Haptics, wet thumb, sunlight and one-handed reach were not run on a device. Field-ergonomics protocol items 1–4 of that list remain open.
- **Seams (row by row):**
  - `getSequence()` → `uprn_snapshot` order: ticked
  - `SEQUENCE_IS_ROUTE_DERIVED` = false: ticked (banner gated on it)
  - map layer `route-line`: registered, empty source: ticked (present in MapLibre style layer list)
  - `getCurrentStreetLabel()` from `v_door_label`: ticked (`Monmouth Road` under the plate)
  - header instruction slot: ticked (`HeaderInstruction` returns null)
  - out-of-order banner: ticked (visible)
  - `getRoutePosition()` returns null: ticked
  - logger auto-advance disabled: ticked (`autoAdvanceEnabled()` false; no auto-advance UI)
  - `positionEnabled` = false: ticked
  - map layer `you-are-here`: registered, `visibility: none`: ticked
  - current-door cursor in `lib/field/cursor.ts`, manual: ticked (advances one door per log; Skip does not log; no jump to next unlogged)
  - teammate line slot: ticked (`TeammateLine` returns null)
- **Deviations from brief:**
  - MapLibre rejects `["zoom"]` nested inside `*` or `case`. The first paint of `field-doors` threw `zoom expression may only be used as input to a top-level "step" or "interpolate"` and **no dots rendered**. `circle-radius` and the pale-core radius are now top-level zoom interpolates with the outcome `match`/`case` inside each stop. Same visual: lead largest, no_opportunity smallest, answered/lead get a pale core.
  - Outcome `feature-state` is applied on style `load` as well as in the React effect. The effect returned early when the style was not ready, so a remount of the Map tab left every door looking unlogged even though Dexie had outcomes. Colour is still current-assignment only, still not baked into the source.
  - Admin MHCLG/EPC line is a footer under the drawing map (`components/admin/prop-drawer.tsx`), not MapLibre `customAttribution`. The field maps use `customAttribution`. Both carry the Crown/MHCLG/EPC sentence.
  - `not_interested` remains in the CHECK and in `KNOCK_OUTCOMES` but has no button; Other records `refused` for that conversation, as the outcome-mapping skill allows.
- **Not done / deferred:** Stage 9 completion counts, Stage 10 claims / teammate line, Stage 5b route order, Stage 16 geolocation / route position, Track B ingest. No applied migration edited. Snapshot ordering not touched. No 2,000-door map test on a mid-range phone (this session: **69 doors**, desktop browser). Field-ergonomics on-device pass not done. Did not begin Stage 9.
- **Follow-ups:** Run the Logger on a real phone in sun with a wet thumb before calling the UI field-ready. Re-test `field-doors` at 2,000 points on a mid-range phone (Stage 14 will own the performance gate). `scripts/verify-stage-8b.ts --keep` leaves a named test prop; `--cleanup` removes it.

---

### Stage 8b — Knock logger (on-device fix pass)
- **Date:** 2026-09-18
- **Model:** Cursor Grok 4.6
- **Built:** Five field-test fixes. Logger mini map (`components/field/mini-map.tsx`) deleted; replaced with **Show on map**, which switches to the Map tab, centres/zooms the current door at zoom 19, and highlights it with a dark halo plus ink stroke. Cursor lives in `FieldDataProvider` and is not moved by the round trip. Map attribution is `AttributionControl({ compact: true })`; the four licence lines are permanent on Profile. Leads tab shows a read-only **Immediate** badge derived from `booked_for` vs `occurred_at` in Europe/London (trigger rule, never sent). Back/Notes/Skip moved into the Logger header so they are no longer clipped as three empty boxes above Other. `no_opportunity` display string is **Rented/Council** everywhere. Brief dated note + outcome-mapping answered/contacted rule. No migration.
- **Acceptance:**
  - FIX 1 Show on map / one MapLibre instance: **PASS** — `MiniMap` deleted. Logger has **Show on map**. Tapping it opened the Map tab on door 1 (17 Monmouth Road) and later on unlabelled door 3, both zoomed in with a dark halo distinct from neighbouring dots. Returning to Logger left the cursor on door 3. One `.maplibregl-map` on the Map tab; zero on Logger. Desktop Chromium, 69 doors.
  - FIX 2 compact attribution + Profile licences: **PASS** — field map `compact: true`; after load the control is a 24px ⓘ (`details.open === false`). Expanding still contains OS/Crown, OGL, MHCLG EPC, MapTiler and OSM. Profile lists the four required lines permanently. Admin prop drawer footer untouched (`compact: false`).
  - FIX 3 Immediate badge: **PASS** — Today-PM lead showed a green **Immediate** badge next to `Appointment Fri 18 Sept, 18:00`. Outbox lead keys were `id, client_event_id, knock_event_id, uprn, canvasser_id, booked_for, notes` — no `is_immediate`.
  - FIX 4 ghost boxes above Other: **PASS** — mini map markup gone. Phone-width (390px) Logger screenshot: Back/Notes/Skip labelled at the top; sequence row then Other; no three empty clipped boxes.
  - FIX 5 Rented/Council wording: **PASS** — button, sequence (`⌂ Rented/Council` on door 4), map legend all match. Harness check added and passed.
  - Every write through `lib/sync/queue.ts`: **PASS** — no `supabase.from(` / `supabase.rpc(` under `components/` or `app/(field)/`.
  - `grep navigator.geolocation`: **PASS** — zero call sites. Remaining hit is a prohibition comment in `lib/field/position.ts`.
  - Seams after mini-map removal: **PASS** — `route-line` and `you-are-here` still registered in `field-map.tsx` load (empty source / `visibility: none`). `getSequence` / `SEQUENCE_IS_ROUTE_DERIVED` untouched; out-of-order banner still shown. Header instruction and teammate slots still return null. Cursor still in `lib/field/cursor.ts`.
  - Snapshot ordering untouched: **PASS**.
  - 8b original logging/undo/offline items: not re-run this pass; previous session PASSed them. Harness `verify-stage-8b.ts --keep` ALL CHECKS PASSED this session, then `--cleanup`. Did not start Stage 9 or 14.
- **Deviations from brief:** Logger ASCII still shows the mini map; the 2026-09-18 note records the replacement rather than rewriting the diagram. Immediate on the Leads tab is derived with `isSameLondonDay` for display because the outbox payload must not carry `is_immediate`. Attribution control is closed on `load` so it starts as ⓘ even on a wide desktop viewport.
- **Not done / deferred:** Stage 9, Stage 14, Track B service-worker tile cache (the known basemap limitation). No schema change. No 2,000-door test. Not re-tested on the physical phone that found the defects — desktop Chromium plus a 390×844 emulation only.
- **Follow-ups:** Re-test Show on map on the same real phone. Proper offline tiles remain Track B. Harness fixtures from this pass were cleaned up.

---

### Stage 14a — Demo seed
- **Date:** 2026-09-18
- **Model:** Cursor Grok 4.6
- **Built:** `scripts/seed-demo.ts` (`npm run seed:demo`) generating three real Bristol props, ten assignments over 7–18 September 2026, knocks/leads/observations, with `--reset`. Seeded RNG (`0x14a014a0`). Rotation from `lib/geo/rotation.ts` (`rotationForVisit`); snapshots from `lib/geo/snapshot.ts` (`orderKnockableBySweep`) — the Stage 5 interim angular rule, not a second implementation. No migration. Existing profiles reused; no auth users created. Demo rows tagged `DEMO - ` on territory names and `seed-demo-` on `client_event_id`.
- **Acceptance:**
  - Seed from empty (no demo rows) produces 3 territories, their assignments, members, knocks, leads and observations: **PASS** — 3 territories, 10 assignments, 10 members (solo), 869 knocks, 42 leads, 85 tenure observations, 8 address observations. Pre-existing non-demo rows left in place (7 territories / 7 assignments / 31 knocks).
  - Every prop is between 40 and 150 knockable doors: **PASS** — Bishopston 69, Southville 138, Clifton 133. Matches a SQL `ST_Within` count of the same rings.
  - Every seeded uprn exists in properties. Zero foreign key errors: **PASS** — insert succeeded; orphan query `knock_events` vs `properties` = 0.
  - no_opportunity knocks and matching tenure observations are present: **PASS** — 85 knocks, 85 `property_observations` with `tenure='no_opportunity'`.
  - At least one prop is visibly unfinished: **PASS** — Southville ever-worked **90 / 138** knockable (48 doors never touched); last visit 74 / 138. Bishopston and Clifton were fully covered across visits (last visits 63/69 and 121/133).
  - leads cover every status value: **PASS** — pending 6, re_app 6, sale 5, pm 5, blowout 5, utc 5, btc 5, cancelled 5. `is_immediate` was not inserted; the trigger derived it (pending all same-day → true; re_app +7 days → false).
  - `--reset` leaves all seven tables at the counts they had before seeding: **PASS** — before seed 7/7/7/31/3/3/1; after `--reset` 7/7/7/31/3/3/1 (`territories`, `assignments`, `assignment_members`, `knock_events`, `leads`, `property_observations`, `address_observations`).
  - `--reset` then seed reproduces byte-identical data: **PASS** — SHA-256 of seeded `knock_events` ordered by `client_event_id` (`id|client_event_id|assignment_id|uprn|outcome|occurred_at|sequence_position`) was `ee7ca3f685933c9ed51a1da91b3df92c210db54d0fe2be65d182347363768be8` on both runs.
  - Rotation and snapshot came from `lib/geo/`, not reimplemented: **PASS** — `rotationForVisit` from `lib/geo/rotation.ts`; `orderKnockableBySweep` / `uniqueVertices` from `lib/geo/snapshot.ts`. Observed entry vertices 1,2,3,0 and ccw/cw/ccw/cw match `rotationForVisit(n, 4)`.
- **Deviations from brief:**
  - PostgREST 14 has no `st_within` URL filter. Doors are loaded with `ov` (PostGIS `&&` bbox overlap) then a strict interior test so the set matches `ST_Within`. Counts matched the SQL count of the same rings.
  - `lib/geo/snapshot.ts` is new: the Stage 5 JS sweep lived only in `scripts/verify-stage-5.ts`. Moved so 14a can import it. SQL `allocate_prop` is unchanged.
  - Only one canvasser profile exists, so every demo team is a solo. Script prints a warning asking for a second canvasser in the Supabase Dashboard if a duo is wanted. No auth users created.
- **Not done / deferred:** Stage 14b coverage map and dashboard. Stage 9. Did not create a second canvasser. Did not start Stage 9. Next free migration remains `015`; none written.
- **Follow-ups:** Create a second canvasser in the Dashboard and re-run `--reset --seed` for duo leapfrogging. 14b should run against this seeded data, not an empty database.

---

### Stage 14b — Coverage map and admin dashboard
- **Date:** 2026-09-18
- **Model:** Cursor Grok 4.6
- **Built:** Admin fog-lift at `/admin/coverage` (MapLibre GeoJSON circle layer, feature-state from knocks, labels in a separate symbol layer at minzoom 18) and dashboard at `/admin/dashboard` (four panels). Read-only migration `015_stage_14b_coverage.sql`: view `v_coverage_latest` (`security_invoker = true`) plus RPCs `coverage_map_payload()` and `admin_dashboard(p_stale_weeks)`. Outcome is never a GeoJSON property. Archived props excluded. Feature-state applied on `load` / `style.load` and in the React effect. `["zoom"]` only as the input of a top-level interpolate. No `app/(field)` / Dexie / `lib/sync` changes. Harness `npm run verify:stage14b`.
- **Acceptance:**
  - Coverage map renders the seeded props with worked doors revealed and unworked doors dim: **PASS** — Southville selected: 90 worked / 35 answered / 48 remaining; dim cluster on the unfinished tail, revealed pale/blue/green/oxide dots on the walked streets. Attribution (OS/Crown, OGL, MHCLG EPC, OSM, MapTiler) on the control and in the footer.
  - Switching away from the map tab/route and back leaves the colouring intact: **PASS** — Dashboard then back to Coverage, Southville re-selected; outcome colours still applied (not all-unworked). Feature-state is painted in the style-load handler from a ref, not only in the effect.
  - A door knocked twice with different outcomes shows the NEWER outcome: **PASS** — harness inserted `no_answer` then `lead` on UPRN 48895; `v_latest_knock` 1 row `lead`; `v_coverage_latest` 1 row `lead`; coverage payload outcomes map has `lead` once. Outcome absent from GeoJSON properties.
  - Dashboard answer rate uses the canonical "answered" definition: **PASS** — SQL is `outcome not in ('no_answer','inaccessible')` (`admin_dashboard.answered_sql`, same filter in `v_coverage_latest` counts). Southville view `worked=90 answered=35` matched the payload. Slot panel shows answered/worked counts, not `outcome = 'answered'` alone.
  - Coverage shows three numbers, not a single percentage: **PASS** — Worked / Answered / Remaining on the coverage rail and the dashboard rail. No completion percentage as the primary figure.
  - The unfinished seeded prop is visibly unfinished on the map: **PASS** — Southville remaining 48, dim unworked tail inside the polygon.
  - 2,000 dots render without stutter: **PASS on desktop Chromium** (Cursor's embedded browser, canvas 1408×1118). Real snapshot set is 1,337 doors; `/admin/coverage?stress=2000` pads the same circle source to `data-door-count=2000`. **Not tested on a mid-range phone.**
  - Any new view is security_invoker and tested under a real admin JWT: **PASS** — `pg_class.reloptions = {security_invoker=true}` for `v_coverage_latest`. Admin JWT SELECT on the view succeeds; office JWT sees 0 rows; canvasser JWT `coverage_map_payload` → `42501 Coverage is an admin view.`; office JWT `admin_dashboard` → `42501`. Service role has no EXECUTE on the RPCs.
  - No coverage table was created. No second copy of derived state exists: **PASS** — `pg_tables` like `%coverage%` is empty; `GET /rest/v1/coverage` → PGRST205 suggesting `v_coverage_latest`. No `v_prop_completion`.
  - Seed script still runs clean after your changes: **PASS** — `npx tsx scripts/seed-demo.ts --reset --seed` exit 0; knock_events checksum `ee7ca3f685933c9ed51a1da91b3df92c210db54d0fe2be65d182347363768be8` (byte-identical to Stage 14a).
- **Deviations from brief:**
  - Stage 9's `v_prop_completion` was not created (this session was forbidden from starting Stage 9). Coverage numbers live on `v_coverage_latest` / `admin_dashboard` with the canonical answered rule, not `outcome = 'answered'`.
  - `admin_dashboard` joins `knock_events` only to attach a lead to its assignment so archived props can be filtered out. The lead panel counts `leads.status`, not knock outcome.
  - Live allocated non-demo props (Bishopston East, `test`) appear on the map alongside the seeded three. Archived `redland_test` does not.
  - Hidden `?stress=2000` pads unworked dots for the 2,000-point check because no single live snapshot holds 2,000 doors.
- **Not done / deferred:** Stage 9. Stage 15 recommender. Phone / mid-range-device 2,000-dot pass. Did not start Stage 9. Next free migration is `016`.
- **Follow-ups:** Re-run the 2,000-dot check on a mid-range phone before calling the performance item done for the demo-day brief. Demo seed now teams as a duo when a second canvasser profile exists (members=20); knock checksum still matches 14a because it does not include `canvasser_id`.

---

### Stage 09 — Prop completion
- **Date:** 2026-09-18
- **Model:** Cursor Grok 4.6
- **Built:** Read-only migration `016_stage_9_prop_completion.sql`: view `v_prop_completion` (`security_invoker = true`) joining `assignments` to `v_latest_knock` (no second `DISTINCT ON`, not `knock_events`). Columns: assignment identity, knockable, worked, answered, remaining. Canonical answered filter `outcome not in ('no_answer', 'inaccessible')` — identical to Stage 14b. `GRANT SELECT` to `authenticated`; `REVOKE` from `anon`. No new table, no coverage table, nothing that writes. Admin dashboard panel lists every assignment (three numbers, no percentage). Field Profile shows today's assignment only as status. Harness `npm run verify:stage9`.
- **Policies / grants:** No new table RLS (no new table). View inherits RLS from `assignments`, `territories` and `knock_events` via invoker. `authenticated` may `SELECT` the view; `anon` may not. Admin JWT sees all assignments; canvasser JWT sees only assignments they belong to; office JWT sees zero rows.
- **Acceptance:**
  - Numbers reconcile against a hand-counted seeded prop: **PASS** — DEMO Southville 2026-09-14 visit 3. Manual from `v_latest_knock`: knockable 138, worked 74, histogram answered 15 / callback 1 / do_not_call 1 / inaccessible 1 / lead 4 / no_answer 42 / no_opportunity 7 / refused 3 → answered 31 (not in no_answer, inaccessible), remaining 64. View: **138 / 74 / 31 / 64**.
  - A duplicate re-sync does not inflate worked: **PASS** — second insert of the same `client_event_id` → `23505` unique; worked stayed 1.
  - A corrected outcome changes answered without changing worked: **PASS** — `no_answer` then `lead` on the same UPRN; `v_latest_knock` 1 row `lead`; raw `knock_events` 2; view worked 1 → 1, answered 0 → 1.
  - Canvasser sees only their own current prop; admin sees all. Tested under real JWTs: **PASS** — canvasser A 1 row (own assignment), not B's; canvasser B only theirs; admin 20 rows including both; office 0. Field-style fetch of B's `assignment_id` as A returned empty. Browser: canvasser Profile showed only today's Bishopston **63 / 29 / 6** (matches the view); admin dashboard table listed every allocation including that row and Southville **74 / 31 / 64**.
  - The view reports `security_invoker = true` in `pg_class.reloptions`: **PASS** — `{security_invoker=true}` for `v_prop_completion` (same as `v_latest_knock` and `v_coverage_latest`).
  - The answered expression is identical to Stage 14b's dashboard: **PASS** — quoted below.
  - Three numbers shown, no percentage anywhere: **PASS** on Stage 9 surfaces — field Profile `WORKED 63 / ANSWERED 29 / DOORS REMAINING 6`, no `%` in that section; admin completion table columns Worked / Answered / Remaining, `hasPct=false`. Stage 14b's existing slot panel still shows answered/worked as a rate; that was not part of this stage and was not removed.
- **Quoted answered expressions:**
  - Stage 14b `admin_dashboard.answered_sql`: `outcome not in ('no_answer','inaccessible')`
  - Stage 14b coverage / dashboard SQL: `c.outcome not in ('no_answer', 'inaccessible')`
  - Stage 9 view source: `ke.outcome not in ('no_answer', 'inaccessible')`
  - Planner form of the view (`pg_get_viewdef`): `ke.outcome <> ALL (ARRAY['no_answer'::text, 'inaccessible'::text])` — semantically identical `NOT IN`.
- **Deviations from brief:**
  - Original Stage 9 SQL counted `outcome = 'answered'` and selected `leads_raised`. Built with the canonical answered rule (so it cannot disagree with 14b) and remaining as the third number. `leads_raised` omitted so `/field` cannot read a quality count off this view. Dated note under Stage 9; original SQL body left in place.
  - `count(ke.uprn)` rather than `count(distinct ke.uprn)`: uniqueness already comes from `v_latest_knock`. No second `DISTINCT ON`.
  - Territory name and work date are on the view so the admin list does not join in the app.
  - RLS is membership-scoped (a canvasser querying the view unfiltered sees every assignment they belong to). "Current prop" is the field UI filtering to today's `assignment_id`.
  - Archived props' visits appear in `v_prop_completion` (it is per assignment). Stage 14b coverage excludes archived territories. Different grain, not a second coverage copy.
- **Not done / deferred:** Stage 10 claims / teammate line. Stage 12. Stage 15 recommender. Did not touch `lib/sync`, Dexie, or snapshot ordering. No coverage table. Field-ergonomics on-device pass (sun / wet thumb / one-handed) **NOT VERIFIED** — desktop Chromium only; the new field control is read-only status, not a tap target. Did not begin Stage 10.
- **Follow-ups:** None for this stage. Next free migration is `017`.

---

### Stage 1b — Road network ingest
- **Date:** 2026-09-19
- **Model:** Cursor Grok 4.6
- **Built:** Migration `017_stage_1b_road_network.sql` (remote version `20260919143732`): `road_nodes` (OSM node id PK, `geometry(Point,4326)`, GiST) and `road_segments` (`geometry(LineString,4326)`, GiST, btree on `(from_node, to_node)`, unique on `(osm_way_id, from_node, to_node)`). `length_m` is `ST_Length(geom::geography)` in the ingest RPC. Overpass query `scripts/queries/bristol-roads.overpassql` (`out geom`, no node recursion; no pedestrian/footway). Streaming ingest `scripts/ingest-roads.ts` splits each way at junction nodes (nodes in two or more ways, plus every way's first and last node); geom is the full polyline of the run. Oneway ignored. Service-role RPCs `upsert_road_nodes` / `upsert_road_segments`. Harness `npm run verify:stage1b`.
- **Policies / grants:** Reference data, same shape as `properties` / `nccz_zones`. RLS enabled, default deny. `SELECT` policy for `authenticated` only; no write policy; no anon. `REVOKE ALL` from `public`, `anon`, `authenticated` on both tables and `road_segments_id_seq`, then `GRANT SELECT` to `authenticated`. RPCs: `REVOKE ALL` from `public`, `anon`, `authenticated`; `GRANT EXECUTE` to `service_role` only.
- **Acceptance:**
  - Migration numbering convention confirmed and the new file named correctly: **PASS** — next file is `017_stage_1b_road_network.sql`. Remote version is `20260919143732`, a fresh MCP timestamp, not `20260918215553`.
  - Junction nodes are SHARED: **PASS** — OSM node `69254247` at `POINT(-2.5949673 51.4787538)` (Monmouth Road / Monk Road, Bishopston). One `road_nodes` row at those coordinates (`nodes_at_same_point=1`). Three segments reference that id: Monmouth Road 219.7 m (`from=69254247`), Monk Road 95.7 m (`to=69254247`), Monk Road 62.0 m (`from=69254247`).
  - Re-running the ingest changes no row counts: **PASS** — two consecutive runs on the same 9.3 MiB extract both ended at `road_nodes=21,877` `road_segments=24,419`.
  - Every segment has a valid geometry (ST_IsValid), SRID 4326, and a non-zero length_m in metres: **PASS** — invalid=0, not_4326=0, zero_or_neg=0. Sanity: OSM Monmouth Road (Bishopston) is one 219.7 m segment between Monk Road and Falmouth Road; the DEMO Bishopston ring is ~210 m east–west. Princess Victoria Street 370.1 m across 4 segments; Stackpool Road 576.1 m across 9.
  - Segment granularity is right: **PASS** — min 0.51 m, median **34.12 m**, max 1,811.35 m, mean 48.03 m. Tens of metres, not single-digit (split at every node) and not hundreds (unsplit ways). 14,551 ways → 24,419 segments (~1.7 segments/way).
  - Every from_node and to_node resolves to a road_nodes row: **PASS** — missing_from_node=0, missing_to_node=0.
  - Final row counts and database size: **PASS** — `road_nodes=21,877` `road_segments=24,419`. Database **199 MB** (208,555,155 bytes).
  - Readable by an authenticated JWT, denied to anon: **PASS** — real canvasser JWT `road_nodes=21,877` `road_segments=24,419` matching service role; anon head count null (no rows); authenticated INSERT → `permission denied for table`; `upsert_road_nodes` → `permission denied for function`. Harness user deleted afterwards.
  - Road coverage under Northville, Bishopston, Southville, Clifton props: **PASS** — intersecting segments: DEMO Bishopston 4 (507 m), DEMO Southville 12 (1,366 m), DEMO Clifton 17 (739 m), Northville 144 (9,116 m).
  - OSM attribution present on field and admin maps and Profile: **PASS** — `Map data © OpenStreetMap contributors.` in `lib/field/map-style.ts` `ATTRIBUTION_LINES`, field Map compact control, Profile tab list, admin prop drawer footer, coverage view/map. Not added this stage; confirmed present.
- **Deviations from brief:**
  - First extract omits `pedestrian|footway` and uses `out geom` rather than `(._;>;); out body`. The brief query is unchanged; dated note under Stage 1b records the first-run form. Second pass later, same tables.
  - North edge 51.51 rather than the instructed 51.49: the live Northville prop is 51.4986–51.5047. 51.49 left it with 0 intersecting segments.
  - Unique index `road_segments_osm_endpoints_uidx (osm_way_id, from_node, to_node)` for idempotent upsert. Not in the brief DDL; no extra columns.
  - Ingest deletes existing segments for way ids in the file before inserting, so a wider extract that discovers new junctions cannot leave a coarser stale split. Nodes still upsert.
  - Overpass `overpass-api.de` returns Apache 406 without a `User-Agent`. The working command sets `-A nakolabs-d2d/stage-1b`.
- **Not done / deferred:** Stage 5b (no route generation, no traversal, no `route_steps`, no field route UI). Pedestrian/footway second pass. Full Section 13 Bristol bbox. Did not touch `properties`, `knock_events`, `assignments`, applied migrations, `app/(field)`, `lib/sync`, Dexie, or snapshot ordering. Did not begin Stage 5b.
- **Follow-ups:** Pedestrian/footway pass into the same tables when traversal exists and can use them. Next free migration is `018`.

---

### Stage 5b — Route generation (generator only; field wiring is Session C)
- **Date:** 2026-09-19
- **Model:** Claude Fable 5.1 (Cursor)
- **Design note first:** `docs/ROUTE-DESIGN.md` — the six decisions: (a) turn = `wrap(candidate bearing − arrival bearing)` into (−π, π], negative is left; cw takes the most negative, ccw the most positive; U-turn only when nothing else is unvisited; ties → ascending `osm_way_id`, then `road_segments.id`. (b) Half-edges: every segment is two directed half-edges; "visited" is per half-edge; termination is all half-edges visited. (c) Side by 2-D cross product of the door against the local `from_node→to_node` direction (`z > 0` left, `z ≤ 0` right); the worked side is the inside of the preferred turn, so under `cw` the `+` half-edge works the left doors and `−` the right, and `ccw` is the exact mirror. (d) Components traversed in turn, ordered by ascending lowest node id; joined by a straight transfer step (`segment_id null`, `"Transfer to {street}"`); backtracks are Dijkstra on the clipped graph, ties → shortest, then lowest node id. (e) Doors > 40 m from every clipped segment are appended as the snapshot's tail, ordered by the route position of their nearest half-edge then UPRN, counted in `assignments.route_stranded_count`, never dropped. (f) Second server action after `allocate_prop` returns, under the admin's own session; the allocate form shows "Drawing the route…" then "Route drawn / not drawn" and a "Draw route" button on unrouted rows; any failure leaves the interim snapshot and logs a warning.
- **Built:** Migration `018_stage_5b_route_generation.sql` (remote version `20260919152743`): `route_steps` exactly per the brief's DDL (GiST on `geom`, btree on `segment_id`), `assignments.route_stranded_count integer not null default 0`, `route_clipped_subgraph(uuid)` (clipped nodes/segments ≥ 50 % inside, doors, ring, all `ORDER BY id`, returns jsonb, admin-only), `route_commit(uuid, jsonb, text, numeric, bigint[], integer)` (single-transaction write, re-checks freeze and snapshot multiset equality). TypeScript: `lib/geo/route-graph.ts` (projection, half-edge graph, components), `lib/geo/route-traverse.ts` (greedy serpentine, Dijkstra backtracks, transfers, 4× bound), `lib/geo/route-plan.ts` (snap, side, order, steps, WKT), `lib/geo/route-generate.ts` (fetch → freeze/rotation check → plan → commit, fail-open), `lib/props/generate-route.ts` (server action). UI: `components/admin/allocate-form.tsx`, `app/(admin)/admin/allocate/page.tsx` (route status column, `maxDuration = 60`). Harness `npm run verify:stage5b` (synthetic graphs without a database, then Northville and the DEMO props under real JWTs, fixtures cleaned up in `finally`). `rotationForVisit` imported from `lib/geo/rotation.ts`, not rewritten.
- **Policies / grants:** `route_steps`: RLS enabled; `REVOKE ALL` from `public, anon, authenticated` on the table and `route_steps_id_seq`; `GRANT SELECT, INSERT, DELETE` to `authenticated`, `USAGE` on the sequence. Policies: `route_steps_select_admin`, `"canvasser reads team route steps"` (membership via `assignment_members` with `(select auth.uid())`), `route_steps_insert_admin`, `route_steps_delete_admin`. No office policy (office has no need to read routes this stage). Both functions: `REVOKE ALL` from `public, anon, authenticated`, `GRANT EXECUTE` to `authenticated`; each raises `42501` unless `app_role() = 'admin'`. SECURITY INVOKER, so RLS on `assignments`, `properties`, `road_*` still governs the reads.
- **Acceptance (Northville = 1,225 doors, 127 clipped segments, 112 nodes, 6 components, 7,945 m of road):**
  - Design note written, six decisions stated: **PASS** — `docs/ROUTE-DESIGN.md`.
  - Determinism, three committed runs: **PASS** — `md5(route wkt)` `d8ac2bfbbfc6af8385048260bf2393c4` × 3; snapshot md5 `b9ea057256f672bbab5eee530cb668c0` × 3; steps md5 `cc0d62f01500122d6c7997a87a3e1c30` × 3; 280 steps, 20,047.64 m.
  - Rotation, visit 1 vs 2: **FAIL** — md5 `d8ac2bfb…` vs `c0376280…`; shared ordered step pairs 25.3 % forwards, **89.3 % against the reversed sequence** (threshold: both < 50 %); Spearman of door order 0.846; first-fifth doors in common 0.4 %. Control, visit 1 vs 3 (same sweep, entry node 267 m away): 99.2 % shared, 99.6 % first-fifth overlap. Consecutive visits are near-reversals and same-sweep visits are near-identical — a property of the brief's leftmost/rightmost rule (face tracing), not of the implementation. Algorithm not modified (loop guard 3). See ROUTE-DESIGN §7 and Follow-ups.
  - Proximity: **PASS** — 1,186 doors within 40 m (max 39.9 m); 39 beyond (max 101.9 m); all 39 appended and counted in `route_stranded_count = 39`. Threshold untouched.
  - Snapshot order matches distance along the route: **PASS** — monotonic over all 1,186 non-stranded doors; DB snapshot equals the plan's.
  - Spur: **PASS** — first `is_spur` step at `step_index 6` (unnamed service road, "Spur — service road, return the way you came"); 82 spur steps of 280; route continues to `step_index 279`.
  - One pass per UPRN: **PASS** — count 1,225 = distinct 1,225 = frozen 1,225; same set as `allocate_prop` produced.
  - Both sides: **PASS** — segment `86397` (Eleventh Avenue) walked at `step_index 50` and `213`; 65 two-sided segments; every clipped segment has exactly two working steps.
  - Termination: **PASS** — `all_visited`; `route_length_m` 20,048 vs 2× clipped 15,890 (the two-pass floor) and the 4× bound 31,780.
  - Performance: **PASS** — clip 124–393 ms, traversal 1–4 ms, snap+order 3–9 ms, commit 122–171 ms; total 225–577 ms per run (target 30 s).
  - Fail-open: **PASS** — synthetic polygon with 18 doors and no clipped roads → `no_roads` notice, snapshot md5 unchanged (`531c1720…`), `route_geom` null, 0 steps; St Andrews Park polygon with 5 fringe doors → same, md5 unchanged (`b1136f78…`). DEMO Bishopston (2 segments) *routes* rather than failing open (4 steps, 631 m, 19 of 69 stranded) — the rule applied on a small graph, reported per the graph-size caveat.
  - Freeze: **PASS** — worked Bishopston assignment (66 knocks): generator refuses with `frozen — "This assignment has already been worked (66 knocks logged). Its door order is frozen."`; `route_commit` called directly refuses independently with the same hint; nothing changed.
  - RLS under real JWTs: **PASS** — canvasser own assignment 280 rows; another assignment 0; all-visible = sum over own memberships (284, matches service-role truth); second canvasser 0; admin 564 = table truth; anon 0; canvasser INSERT `42501`; canvasser DELETE 0 rows, steps still 280.
  - Rotation imported: **PASS** — `import { rotationForVisit, type Rotation } from "@/lib/geo/rotation";` (`lib/geo/route-generate.ts:22`).
  - `allocate_prop` unchanged: **PASS** — normalised body md5 of live `pg_get_functiondef` = `c72dae5ce454768b51722452dfb65abc` = migration 009's body; 164 lines each.
  - Protected paths untouched: **PASS** — `git status` shows nothing under `app/(field)`, `components/field`, `lib/sync`, `lib/geo/snapshot.ts`, `scripts/seed-demo.ts`.
- **Deviations from brief:**
  - Safety bound is 4× the clipped total, not 2×. Two passes per segment make 2× the exact floor of a perfect traversal; any backtrack exceeds it. Hitting 4× fails open and is reported.
  - Two functions, not one: `route_clipped_subgraph` (read) and `route_commit` (write). PostgREST cannot hold a transaction across calls, and the write is delete + insert + update that must be atomic.
  - `assignments.route_stranded_count` added — the brief's schema has nowhere to carry the stranded fact.
  - The Stage 5b brief's acceptance "200-door prop under five seconds" is met by a wide margin; the session target of Northville under 30 s likewise.
- **Not done / deferred:** Nothing under `app/(field)` — no field route display, no `route_steps` read on device, no Dexie or `lib/sync` changes (Session C). No office read policy on `route_steps`. Existing routed-before-018 assignments: only Northville visit 1 was routed by the harness; DEMO props are still on the interim angular snapshot until an admin presses "Draw route". No pedestrian/footway pass.
- **Follow-ups:**
  - **Rotation needs a product decision.** With the brief's rule, doors see two time-of-day slots per cycle (odd visits ≈ one walk, even visits ≈ its reverse), not `ring.length`. Options that keep determinism: rotate which *face* (block) is traced first by visit number; start from the clipped node nearest the polygon centroid rather than a boundary vertex; or accept two slots. Amend Stage 5b with a dated note, then change `lib/geo/route-traverse.ts` only for assignments with zero knocks (the freeze already enforces this).
  - Stage 5's `entry_vertex_index` is a *vertex index*, so its spacing depends on how densely the admin drew the polygon (Northville: vertices 1 and 2 map to entry nodes 13 m apart). A perimeter-fraction entry would spread better.
  - 215 of Northville's 1,225 doors snap to `service` roads (unnamed); the step text there is "service road". Session C should expect null `street_name` on steps.
  - Spur steps are numerous (82 of 280) because every dead-end service road is in-and-out; Session C's field display should collapse consecutive spur steps into one card.
  - Next free migration is `019`.

---

### Stage 5b-b — Field route display and routed demo seed
- **Date:** 2026-09-21
- **Model:** Grok 4.7
- **Built:** The field Logger and map now read a generated route. Dexie schema version 4 → 5, adding `routes` and `route_steps` without changing the snapshot or addresses stores. `lib/field/route-cache.ts` fetches `route_geom` and `route_steps` once per prop open. `lib/field/route-display.ts` places each door on a step, collapses consecutive spurs, and marks the stranded tail. The route line paints under the door circles. `scripts/seed-demo.ts` is now allocate → generate route → knocks, calling `generateRoute` as-is under the existing admin's session. A fourth demo prop, St Andrews Park, stays unrouted (`no_roads`). `npm run verify:stage5bb`.
- **Acceptance:**
  - Northville Logger follows the route and the out-of-order banner is gone: **PASS** — live Logger, banner count 0, header "Start on Eden Grove". First 10: (1) Eden Grove, step 0, "Start on Eden Grove"; (2) Eden Grove, step 1, "Eden Grove — continue to the end"; (3–8) Filton Avenue, step 3, "Left into Filton Avenue"; (9–10) Sixth Avenue, step 4, "Right into Sixth Avenue". `npx tsx scripts/verify-stage-5bb.ts`.
  - Unrouted assignment still shows the banner: **PASS** — DEMO St Andrews Park (no through road), visit 1, 5 doors, header instruction empty, banner "Door order follows the interim sweep, not the street. Numbers will look out of sequence." Map `data-route-vertices` 0.
  - Route line under the door circles, dots tappable: **PASS** — style order `route-line, field-doors-focus, field-doors, field-doors-core, field-door-labels, you-are-here`. Northville line 813 vertices. A canvas click opened the door panel ("Not logged on this visit"), so the line did not take the tap. Attribution control still present. Desktop browser, 1,225 doors, not a mid-range phone.
  - Logger header instruction, British English: **PASS** — "Start on Eden Grove"; "Eden Grove — continue to the end"; "Left into Filton Avenue".
  - Consecutive spurs collapse: **PASS** — 82 spur steps → 24 cards (`verify:stage5bb`). Door 14 showed one card, "Spur — return the way you came".
  - Stranded doors marked: **PASS** — 39 elements with "Off the drawn route" on Northville. Door 1225 header and marker both say "Off the drawn route".
  - Transfer steps distinct: **PASS** — door 519, "WALK ACROSS" plus "Transfer to Cropthorne Road", separate from "Cropthorne Road — continue to the end".
  - Unnamed streets fall back to the door label: **PASS** — door 17, plate "105", street "Eden Grove", route street null. Logger text contained "service road" 0 times.
  - Airplane mode from Dexie: **PASS as browser emulation, not a phone.** Supabase hosts blocked, page reloaded. Status "Showing the copy saved on this phone." IndexedDB `nakolabs-d2d-field` version 5 (storage version 50), 280 `route_steps`, route line 813 vertices, header "Start on Eden Grove", 39 stranded, no `route_steps` network request. Real radio-off phone: **NOT VERIFIED**.
  - Stage 5b seams ticked: **PASS** — `docs/STAGE-8-SEAMS.md`. Stage 10 and Stage 16 rows left pending.
  - Seed reordered, one routed and one unrouted: **PASS**. Bishopston visits 1–4 routed, 4 steps, stranded 19/69 (27.5%) **FLAG**. Southville visits 1–3 routed, 14 steps, 15/138 (10.9%). Clifton visits 1–3 routed, 25 steps, 2/133 (1.5%). St Andrews Park visit 1 unrouted, 0 steps, 0/5, `no_roads`.
  - Seed idempotent: **PASS** — two `--reset --seed` runs, knock_events checksum `e9c8eecab816d50f5fef3105e63361d64ca04ce5204fd36a9abd1f2b651a4d89`, demo route checksum (no geometry) `e07eee7b6e401c6954872eceb9e4936cd4c80dc5d531f342cb6b3e66c9cc1c76`. `--reset` restored territories 8, assignments 9, assignment_members 10, knock_events 33, leads 3, property_observations 3, address_observations 1, route_steps 280 (Northville only).
  - Freeze untouched: **PASS** — `git diff` of `lib/geo/route-traverse.ts`, `route-plan.ts`, `route-graph.ts`, `route-generate.ts` empty. No knocks deleted to make an assignment routable.
  - `navigator.geolocation`: **PASS** — only a comment in `lib/field/position.ts`. Zero call sites.
  - Field writes through the queue: **PASS** — no `supabase.from` or `supabase.rpc` under `app/(field)` or `components/field`. Route reads live in `lib/field/route-cache.ts`.
- **Deviations from brief:**
  - `sequenceIsRouteDerived` is per assignment (`route_geom` not null), not a global `true`. The brief's seam table said the flag becomes true everywhere; an unrouted prop must keep the banner. Dated note under Stage 5b, 2026-09-21.
  - `getSequence()` body unchanged. The snapshot is already route order after Stage 5b-a.
  - The seed cannot call the generator with the service key: `route_commit` is granted to `authenticated` only and `app_role()` reads `auth.uid()`. The seed opens a magic-link session for the existing admin and calls `generateRoute` unchanged.
  - St Andrews Park was added so the demo has an unrouted prop. The three original polygons all route.
  - `--reset` also deletes knock rows on demo assignments whose `client_event_id` does not start with `seed-demo-`. Four such rows blocked assignment delete. This is reset cleanup, not a freeze bypass.
  - Admin coverage map does not receive `route_geom`. Adding the line there is a new fetch, so it was left out.
  - Bishopston strands 27.5%. Not enlarged, and no fail-open threshold was added. Proposal only: enlarge that demo polygon so more of each road falls inside the half-length clip, or fail open in the generator when the stranded fraction exceeds a stated share.
- **Not done / deferred:** Rotation fix. Stage 10. Stage 16. Admin coverage route line. Real-phone sunlight, wet-thumb and haptic checks. A 2,000-door layer test on a mid-range phone. No migration (next free remains 019).
- **Follow-ups:** Door-to-step placement is deterministic and not stored: cursor never moves backwards; a door snaps to the nearest working step at or after the cursor; two passes within 1.5 m keep the earlier pass unless the fraction along the street drops by more than 0.08, which advances to the return pass. Transfers show on the first door of the following working step. Northville: 0 backward moves, longest forward jump 6 steps.




---

### Stage 5b-R1 - Route traversal pivot: walking-pattern generator (generator, read function, harness, previews only)
- **Date:** 2026-09-22
- **Model:** Claude Fable 5.1
- **Built:** `docs/ROUTE-DESIGN-v2.md` (design a-g written before code, plus dated post-run corrections). Migration `019_route_walk_read_functions.sql`: one `stable`, `security invoker`, admin-only function `route_walk_inputs(territory_id)` returning ring, centroid, every `road_segments` row within 250 m (geography, spatially filtered), their nodes and every knockable door, all `ORDER BY id`; no table touched. `lib/geo/walk/`: `types.ts` (output shape), `inputs.ts` (RPC + parse via 5b-a `parseRouteInputs`), `demand.ts` (40 m snap, side classification, working sides), `geometry.ts` (4 m walkline offset, unproject), `shortest-path.ts` (deterministic Dijkstra), `traverse.ts` (chain DFS: out, cross at the far end, back; hand-side sub-branches at intermediate junctions only; carry-on for one-sided chains in trunk mode; transfers over real roads; appended "Back to the start"), `steps.ts` (door order, vocabulary-only instructions, walklines), `generate.ts` (24 perimeter-sample starts x 2 hands, ranking, `best` / `best_reversed` / `alt_1..4`), `preview.ts` (GeoJSON). `scripts/verify-stage-5b-r1.ts` (`npm run verify:stage5b-r1`, flags `--props`, `--candidates`, `--breakdown`). `lib/geo/route-*.ts` untouched (`git diff` empty) and still what the app calls.
- **Acceptance:**
  - Design note a-g: **PASS** (`docs/ROUTE-DESIGN-v2.md`).
  - Speedwell best, Derwent and Selby each one out-and-back with the cross at the Ventnor end, consecutively: **PASS** (Derwent steps 1-3, cross step 2 on Ventnor Road; Selby steps 5-7, cross step 6 on Ventnor Road; 0 foreign steps inside).
  - Speedwell best, every segment of Speedwell / Harewood / Ventnor exactly one work step on the prop side: **PASS** (Speedwell 3 working segments of 12 in the buffer, Harewood 3/3, Ventnor 5/6; one work step per working side each; the 6th Ventnor segment, 10.73 m mid-street, has no door within 40 m and is a walk step).
  - Speedwell best, every work step side equals the route hand: **PASS** (15/15, hand right).
  - Speedwell best ends within 100 m of start: **PASS** (0 m; the trunk closes the loop at the start, no return leg).
  - Speedwell every door once, stranded count: **PASS** (182 doors, 182 in order, 0 duplicates, 0 stranded).
  - redland best, two-sided streets separated only by their own branches: **PASS** (84/84 two-sided segments, 42/42 named streets; old 0/96).
  - redland straight transfers: **FAIL** (3 straight transfers + 1 straight return = 4 / 751 m; old 20 / 2,492 m; target 0). All cross Whiteladies Road (A4018), a `primary` road absent from `road_segments`; no segment within 3 m of the stranded nodes. Not fixable inside this stage without re-ingesting.
  - redland and Northville non-working / total: **PASS as a report** - redland best 30.4 %, alts 30.4 / 31.3 / 32.7 / 33.7 %; Northville best 32.9 %, alts 33.7 / 34.8 / 35.1 / 36.7 % (old Northville 26 %, a different quantity: straight-line transfers, no crosses, no return leg). Breakdown in the design note, post-run item 5.
  - best_reversed is best backwards: **PASS** (steps reversed, every side flipped, centrelines reversed, step-multiset md5 equal, totals equal, on all three props).
  - Alts materially different: **PASS** (Speedwell 3 alts, first-fifth overlap vs best 0 / 0 / 22 %; redland 4 alts, 20 / 0 / 0 / 0 %; Northville 4 alts, 0 / 1 / 1 / 9 %; every alt from a new start node).
  - Determinism, three runs, md5 of the full output minus timings: **PASS** (Speedwell 8129c065c7bb x3, redland 9b22c6726777 x3, Northville 5aed8cc489b6 x3).
  - Walklines, every door on the hand side of its walkline: **FAIL** (Speedwell 180/182, redland 2,720/2,819, Northville 1,166/1,217; every failing door is on the correct side of the centreline but within 4 m of it, i.e. inside the pavement offset; data, not routing).
  - Per-phase timings: **PASS** (redland 178-211 ms total: graph 1-3, demand 29-30, candidates 127-149, variants 21-29; Northville 156-172 ms; limits 10 s / 5 s).
  - Previews: **PASS** (33 GeoJSON files in `data/route-previews/`, gitignored: 5 Speedwell, 6 redland, 6 Northville, 5 DEMO Clifton, 6 DEMO Southville, 5 DEMO Bishopston, plus a `.txt` step summary each. Demo props: 0 straight transfers, 0 stranded; Bishopston (Monmouth Road) stranded 27.5 % under the old clip).
  - Old generator untouched, nothing stored, no table changed: **PASS** (`git diff --stat lib/geo/route-*.ts` empty; migration 019 is `create function` + `revoke` + `grant`; the function is `stable`, so Postgres forbids writes inside it).
- **Deviations from brief:**
  - Ranking counts the return leg (prompt's literal "least non-working metres"); the pre-code design excluded it and live data showed that rewarded starting beside a doorless segment. Final tie-break is right hand before left, chosen so the Speedwell tie resolves to the reference drawing; rules 1-8 do not decide it.
  - The far-end rule is strict ("you do not turn onto the next road"), so interior cross streets reachable only at far ends are transfers; half the non-working metres on redland / Northville are transfers.
  - Vocabulary: "Walk to {street} - no doors" names the street of the next work step; a one-sided branch's return uses "Come back down {street}"; unnamed roads use the highway type as before.
- **Not done / deferred:** No storage (`territory_routes`), no allocation copy, no `allocate_prop` change, no admin / field / sync / Dexie / seed change. `lib/geo/route-*.ts` still drives the app. Primary/trunk roads not added to the network.
- **Follow-ups:** R2 stores `WalkVariant` per prop per key; `route_steps` cannot hold it (no kind, side, walkline, door range, dead-end flag, variant key, hand). Field display must key on `walk` runs and chain returns instead of `is_spur`. Add `primary`/`trunk` to the Stage 1b ingest as walking-only roads to remove the remaining straight lines.

---

### Stage 1b — Primary and trunk roads (data patch)
- **Date:** 2026-09-22
- **Model:** Cursor Grok 4.7
- **Built:** Widened `scripts/queries/bristol-roads.overpassql` with `primary|primary_link|trunk|trunk_link`. Same bbox `(51.43,-2.64,51.51,-2.53)`, same `out geom`, no node recursion. Fetched once (`User-Agent: nakolabs-d2d/stage-1b-patch`, HTTP 200, 10,898,685 bytes) to `data/raw/bristol-roads-primary.osm.json`. The 2026-09-19 file is untouched (9,738,217 bytes, mtime 2026-09-19). `scripts/ingest-roads.ts` accepts `--file=` and skips ways whose segments are referenced by `route_steps`. No migration, no schema, no RLS change. Dated note under Stage 1b.
- **Acceptance:**
  - `road_segments` includes primary and trunk. **PASS.** Before: service 10,178 · residential 9,339 · unclassified 2,312 · tertiary 1,258 · secondary 1,220 · living_street 112 · primary 0 · trunk 0 · primary_link 0 · trunk_link 0 (24,419 segments, 21,877 nodes). After: service 10,186 · residential 9,346 · unclassified 2,319 · primary 1,335 · tertiary 1,258 · secondary 1,226 · trunk 665 · living_street 112 · trunk_link 111 · primary_link 35 (26,593 segments, 22,771 nodes).
  - Whiteladies Road (A4018) and Filton Road (A38) are named segments. **PASS.** Whiteladies Road: 63 primary segments, 1,665 m (29 OSM ways tagged `primary` + `ref=A4018`). Filton Road: 54 primary segments, 2,602 m (34 OSM ways `primary` + `ref=A38`, plus 9 `primary` + `ref=A4174`). Filton Avenue is in the graph (12 residential, 1 service, 53 tertiary) and was already there; in this extract OSM does not tag it `primary` or `A38`. The A38 through the bbox is also named Gloucester Road (107 primary segments, 3,132 m) and Gloucester Road North (41 primary segments, 1,579 m).
  - A primary road and an already-ingested road share one junction node. **PASS.** OSM node `17585272` at `51.4645025, -2.6096534`. One `road_nodes` row within 2 m. Three segments use that id: Whiteladies Road primary way `3552331` (31.7 m ending there, 24.6 m starting there) and Cotham Hill residential way `261464010` (19.9 m starting there). Duplicate `(osm_way_id, from_node, to_node)` keys: 0.
  - Re-running the full ingest (old file, then widened file) a second time changes no row counts. **PASS.** Both cycles ended at `road_nodes=22,771` `road_segments=26,593`. The old-file pass in each cycle lands on 26,573 segments (it cannot see primary/trunk junctions); the widened file restores 26,593. Cleared and rebuilt counts matched exactly across the two cycles.
  - `npm run verify:stage5b-r1 -- --props=redland` straight transfers. **PASS.** Best, best_reversed and alt_1–alt_4 are each 0 straight transfers / 0 m, against the prior best of 4 / 751 m. Measured on this run, not assumed.
- **Deviations from brief:**
  - `ingest-roads.ts` leaves 177 ways in place when any of their segments are referenced by `route_steps` (`route_steps_segment_id_fkey`, no cascade). Replacing them would delete stored steps or mint new segment ids. A check after the second cycle found 0 primary/trunk junction nodes sitting mid-segment on those frozen ways. The first ingest attempt aborted on that foreign key after deleting 767 unreferenced segments; the completed run replaced them.
  - `--file=` selects the extract. The default path is still `data/raw/bristol-roads.osm.json`.
- **Not done / deferred:** No schema, no RLS, no migration (next free remains `020`). Did not touch `lib/geo/walk/`, `lib/geo/route-*.ts`, migration 019, or `app/`. Pedestrian and footway still omitted. Did not re-run Speedwell or Northville. The redland harness still fails the existing walkline check (92 of 2,819 doors inside the 4 m pavement offset); that is not this patch.
- **Follow-ups:** None for this patch. Stored `route_steps` still point at the pre-patch segment ids of those 177 ways.

---

### Stage 5b-R2 — Routing pivot: route storage, freeze on allocation, visit numbering from history
- **Date:** 2026-09-22
- **Model:** Claude Fable 5.1
- **Built:** Migration `020_route_storage_and_freeze.sql` (applied as `20260922182931`): tables `territory_routes` (unique `(territory_id, variant_key)`, key checked against `^(best|best_reversed|alt_[1-9][0-9]*)$`, GiST on `start_geom` / `end_geom`) and `territory_route_steps` (unique `(route_id, step_index)`, `kind in (work, cross, walk)`, `side in (left, right)`, `centreline` + `walkline` `geometry(LineString,4326)` with GiST, `first_seq`/`last_seq` null-together and only on `work`, **no FK on `segment_id`** by design); RLS enabled on both with admin-only `SELECT` / `INSERT` / `DELETE` policies (no `UPDATE` grant at all — a set is replaced, never edited), grants revoked from `public`/`anon`/`authenticated` then `select, insert, delete` re-granted to `authenticated`; `route_steps` + `kind`, `side`, `walk_geom` (GiST), `first_seq`, `last_seq`, `is_dead_end` and a new `route_steps_select_office` policy; `assignments` + `route_variant_key` (same check) and `route_source_id` (`references territory_routes on delete set null`, B-tree). Functions, all `security invoker`, `revoke ... from public, anon, authenticated, service_role` then `grant execute to authenticated`: `territory_routes_save(uuid, jsonb)` (admin check, `territories` row lock, unique keys, `best` + `best_reversed` required, per-variant door/stranded/step validation before any PostGIS parse, delete-then-insert, returns `{variants, steps, keys}`); `assignment_route_freeze(uuid, text default null)` (admin check, `assignments` row lock, `knock_events` count → hint `frozen`, variant lookup → `missing_variant`, cardinality + sorted-array equality → `snapshot_mismatch`, duplicates, stranded range, contiguous `step_index`, every `segment_id` still in `road_segments` → `stale_variant`, one `LINESTRING` from the centrelines, then delete-then-insert `route_steps` with `is_spur = (kind='work' and is_dead_end)` and `cumulative_m` = running `sum(length_m)`, one `UPDATE` of `route_geom` / `route_length_m` / `uprn_snapshot` / `route_stranded_count` / `route_variant_key` / `route_source_id`); `allocate_prop` re-created with `visit_number = 1 + count(*)` of the prop's assignments under the existing `for update` lock — the only body change from 009. TypeScript: `lib/geo/walk/save.ts` (`saveTerritoryRoutes`: `route_walk_inputs` → `generateWalk` → RPC, `tree` stripped), `lib/geo/walk/freeze.ts` (`freezeAssignmentRoute`), `lib/props/generate-route.ts` rewritten (freeze first; on `missing_variant` / `stale_variant` / `snapshot_mismatch` save then freeze once more; fail-open as before), `components/admin/allocate-form.tsx` + `app/(admin)/admin/allocate/page.tsx` (next visit = assignments count + 1, variant key shown, sentence "Route frozen: best route, right hand, …"), `scripts/seed-demo.ts` reordered (territory → save variants → per visit: assignment → parity freeze → knocks; `unroutedFixture` skipped explicitly; `try/finally` sign-out kept), `scripts/verify-stage-5b-r2.ts` (`npm run verify:stage5b-r2`). Deleted: `lib/geo/route-generate.ts`, `route-plan.ts`, `route-traverse.ts`, `scripts/verify-stage-5b.ts` and its npm script; `STRANDED_THRESHOLD_M = 40` moved to `lib/geo/walk/demand.ts`. `lib/supabase/types.ts` regenerated (+188 lines, additive). Dated notes under Stages 5, 5b and 14.
- **Acceptance** (harness run against the live project; every number is a re-query, not a return value):
  - Variants stored and reloadable, saving twice replaces: **PASS** — REF - Speedwell: generator 5 variants / 90 steps / 182 doors; after save 1 `territory_routes` 5, `territory_route_steps` 90; after save 2 still 5 / 90 with every row id replaced; keys `alt_1, alt_2, alt_3, best, best_reversed`; stored `best.door_order` md5 `50c8a7ff65da` = generator's; hand right, stranded 0; reload through the admin's own session 5 rows.
  - Parity default: **PASS** — throwaway A (2027-01-04) `visit_number` 1 → `route_variant_key` `best`, `route_source_id` = the saved `best` row, `uprn_snapshot` md5 `50c8a7ff65da` = `best.door_order`, 18 `route_steps` (variant has 18), `route_length_m` 1997.78 = last `cumulative_m` 1997.78; throwaway B (2027-01-05) `visit_number` 2 → `best_reversed`, md5 `4f5393984a7b` = `best_reversed.door_order`, 18 steps. On every new row `is_spur = (kind='work' and is_dead_end)`; `kind`, `side`, `walk_geom`, `geom` non-null; `cumulative_m` non-decreasing.
  - Freeze refuses knocks: **PASS** — one `knock_event` on A, then `assignment_route_freeze(A, 'best_reversed')` → hint `frozen`, "This assignment has already been worked (1 knocks logged). Its door order is frozen."; A re-queried unchanged (`best`, 18 steps, same snapshot md5). Throwaway only; redland_test's 31 knocks untouched (re-queried: 31).
  - Freeze refuses a door-set mismatch: **PASS** — B's snapshot cut 182 → 181 → `snapshot_mismatch`; B's snapshot same size with one UPRN swapped for one outside the prop → `snapshot_mismatch`; B re-queried unchanged.
  - redland `visit_number` = 3: **PASS** — before: `2026-09-21 v1, 2026-09-23 v1`; `allocate_prop(redland, 2027-01-06)` → `visit_number` **3** (re-queried), 2,821 doors, not frozen; the two existing rows unchanged; the test row deleted in cleanup (redland re-queried after: still exactly `2026-09-21 v1, 2026-09-23 v1`).
  - `route_steps` counts unchanged: **PASS** — Bishopston 16 → 16, Clifton 75 → 75, Southville 42 → 42, Northville 280 → 280, redland 652 → 652, redland_test 0 → 0; table total 1,074 before and after; 0 rows with `kind` set remain (the 36 throwaway rows were deleted).
  - RLS: **PASS** — canvasser JWT (`576c4ce7…`): `territory_routes` 0 rows, `territory_route_steps` 0 rows (service role sees 5 / 90), `territory_routes_save` → `42501 not_admin`, `assignment_route_freeze` → `42501 not_admin`, direct insert → `42501` RLS violation. Office JWT (`89c7aba7…`): `route_steps` 1,110 rows = service role's 1,110 at that moment (1,074 + 36 throwaway); `territory_routes` 0, `territory_route_steps` 0.
  - `lib/geo/route-*.ts` deleted: **PASS** — `git status`: `D lib/geo/route-generate.ts`, `D lib/geo/route-plan.ts`, `D lib/geo/route-traverse.ts`; `rg` for `route-generate|route-plan|route-traverse` finds only a comment in `demand.ts`; `route-graph.ts` kept (imported by `lib/geo/walk/`); `tsc --noEmit` clean.
  - `verify:stage5b-r1` unchanged: **PASS** — run twice against the same database, once from a detached `git worktree` at HEAD `4720192` (pre-R2 code) and once from the working tree: determinism md5s Speedwell `6e921f7e729d`, redland `2f0f4cb5872b`, Northville `a27cad3000c2` in both; all 42 per-variant md5s identical in sequence; same 15 PASS, same 1 FAIL (the pre-existing walkline check: 2 / 92 / 44 doors inside the 4 m pavement offset, recorded as FAIL in the R1 and 1b-patch entries), same 1 NOT RUN. A third run, started at 18:20 before migration 020 was applied (18:29) and before any R2 file existed, gave the same three md5s and the same 42 per-variant md5s. The R1 entry's md5s (`8129c065c7bb` …) predate the 1b road patch, which is why they differ from all three runs here.
  - Cleanup: **PASS** — `auth.sessions` created in the last 2 h: 0 (harness signed all three sessions out, scope local); REF - Speedwell assignments 0; `verify-5b-r2-*` knocks 0.
  - Allocate page end to end in a browser: **NOT VERIFIED** — the server action and form were type-checked and their underlying RPC calls are the ones the harness exercised, but no browser session was run.
  - Seed script run: **NOT VERIFIED** — reordered and type-checked only; running it requires `--reset` on the DEMO territories, which this stage was told not to touch.
  - Lint and types: **PASS for the changed files** — `tsc --noEmit` clean; `eslint` over every changed file: 0 problems in R2's code, 1 pre-existing `prefer-const` in `seed-demo.ts` line 242 (`let leftover`, present in HEAD, not touched). `npm run lint` over the whole project reports that 1 error plus 1,118 pre-existing warnings, none in R2 files.
  - Environment note: removing the temporary HEAD worktree (`git worktree remove --force`) followed the `node_modules` junction it had been given and emptied the project's `node_modules`. Restored with `npm ci` from the unchanged `package-lock.json`; `tsc` and `eslint` were re-run after the restore and are the results recorded here. No repository file was affected.
- **Deviations from brief:**
  - `visit_number` counts **all** existing assignments of the prop, not only those with an earlier `work_date` (brief, Stage 5 note). In-order allocation gives the same number; the count cannot mint a duplicate on a backdated allocation, the earlier-date rule can. Dated note under Stage 5.
  - `territory_route_steps.segment_id` has no foreign key (a regenerable variant must not block a road re-ingest the way `route_steps_segment_id_fkey` did in the 1b patch). The freeze checks the ids exist and refuses with `stale_variant` instead.
  - The seed still inserts assignments directly (deterministic ids, backdated timestamps) rather than through `allocate_prop`; it uses the same visit ordinal and freezes through the default parity path.
  - The allocate action regenerates a prop's variant set on `snapshot_mismatch` as well as `missing_variant` / `stale_variant`, since a changed door set is the usual reason a saved set no longer fits.
- **Not done / deferred:** R3 (draw-page preview and save, shared route rendering) and R4 (field display keyed on `kind` / `side` / `walk_geom`) — the field cache still reads `is_spur` and `geom`, which R2 rows populate. No admin UI to pick a variant other than the parity default (`assignment_route_freeze` accepts one). Migration `018`'s `route_commit` / `route_clipped_subgraph` left in place, now uncalled. The two redland assignments keep `visit_number` 1. REF - Speedwell's 5 saved variants / 90 steps are left in `territory_routes` — R2's intended state for a prop, regenerable.
- **Follow-ups:** Fix the pre-existing `prefer-const` in `seed-demo.ts` line 242 so `npm run lint` exits 0. Run the reordered seed the next time the demo is reset and record its route checksum. When R3 lands, decide whether the allocate action should still generate on demand or only freeze what the draw page saved. Consider dropping `route_commit` / `route_clipped_subgraph` in a later migration once nothing can call them.

---

### Stage 5b-R3 — Draw-page route preview, save, and shared route paint
- **Date:** 2026-09-22
- **Model:** Cursor Grok 4.7
- **Built:** `previewTerritoryRoutes` in `lib/geo/walk/save.ts` (same `route_walk_inputs` → `generateWalk` path as save, no RPC). Draw page floating Generate / variant picker / Save (`components/admin/route-overlay.tsx`, wired in `prop-drawer.tsx`). Save calls `saveTerritoryRoutes` with the full set. Same-session stale banner when the drawn ring changes, Save disabled until regenerate. `lib/map/route-layers.ts` paints walkline (solid work, dashed cross/walk), SDF chevrons, start/end/cross points, feature-state highlight, layers inserted before the door circles; one adapter for `walkline` and `walk_geom`. `lib/map/route-load.ts` reads those two columns only. Frozen assignment view `FrozenRouteMap` (read-only). Allocate override dropdown from `territory_routes`, sent through new `freezeVariantAction` so `p_variant_key` reaches `assignment_route_freeze`; empty override still calls `generateRouteAction`. 150-door `DoorBand` removed; readout "{n} knockable · {m} excluded". `updatePropRing` writes the drawn ring before a generate when it differs from the stored polygon. `fitRouteBounds` clamps padding so a short map still frames the line. Harness `scripts/verify-stage-5b-r3.ts`.
- **Acceptance:**
  - Generate writes nothing: **PASS** — browser, prop "R3 ui check" (deleted after): before Generate `territory_routes` 0 / `territory_route_steps` 0; preview showed Best · 264 steps and six picker labels (Best, Reversed, Alternative 1–4); after Generate, still 0 / 0. Harness on a Speedwell clone: before 0/0, preview 5 variants / 90 steps, after 0/0.
  - Save persists all variants and a second save replaces: **PASS** — same browser prop, after Save (picker on Reversed): 6 variants, 1,592 steps (`best` 264, `best_reversed` 264, `alt_1` 267, `alt_2` 264, `alt_3` 266, `alt_4` 267). Second Save still 6 / 1,592. Harness: first save 5/90, second save still 5/90.
  - Edit after Save marks stale and blocks Save: **PASS** — after moving a vertex, banner "The boundary has changed since this route was generated. Generate it again before saving." and the Save button `disabled`. Readout moved 795 → 757 knockable with no warning. Same-session only.
  - Picker does not filter Save: **PASS** — generated once, switched the picker to Reversed (detail "Reversed · 264 steps · doors on the left"; rendered active features were `best_reversed` only), then Save stored all six keys above.
  - One renderer for both tables: **PASS** — `toRoutePaintModel` is the only adapter. Draw page painted the in-memory preview (layers `route-walk-*` under `prop-doors`). After Save the draw page reloads `territory_route_steps`. Frozen view loads `route_steps.walk_geom`. Harness: in-memory and loaded territory steps both 90 with the same kind counts; assignment model 18 steps; one Speedwell work step's painted line hash matched `walk_geom` and differed from the centreline hash.
  - Frozen assignment is read-only: **PASS** — `/admin/allocate`, REF - Speedwell visit 2 (`route_variant_key` best_reversed). Pane text "Read only / REF - Speedwell · Visit 2 / Reversed · 18 steps". Controls in that pane: Close, zoom. No Generate, Save, or Allocate. Map showed the pavement line, chevrons, green start, oxide markers, dashed non-working legs, MapTiler and OS/OpenStreetMap attribution. Bishopston, Clifton, Southville, Northville and redland have `route_length_m` set and `route_variant_key` null (5b-a centreline routes); they do not open this view. Speedwell is the real R2 freeze.
  - Allocate with saved variants: **PASS for the control and the harness, NOT VERIFIED as a live Allocate click.** The Speedwell form (next visit 3, odd) showed "Default for this visit · Best" plus Best, Reversed, Alternative 1–3. A live Allocate was not submitted: the form date was 2026-09-24 and would have created a real assignment. Harness: visit 1 with no key → `route_variant_key` `best`; visit 2 with explicit `best` → `best` (parity would have been `best_reversed`).
  - Allocate with no saved variants, `generate-route.ts` untouched: **PASS that the file is untouched and the form stays on the old path; NOT VERIFIED inside a Next request.** RED - Speedwell (no saved variants) showed the allocate form with no variant dropdown. `git diff` of `lib/props/generate-route.ts` and migration `020` is empty. The harness's direct call to `generateRouteAction` threw `cookies was called outside a request scope`; it then ran `saveTerritoryRoutes` + `freezeAssignmentRoute` (the same sequence the action uses) and got `route_variant_key` `best`. That call was not made from the browser.
  - 150-door warning gone: **PASS** — `DoorBand` deleted; `propWarnings` returns no door warning. Draw page at 795 knockable showed "795 knockable · 0 excluded", Generate and Save, and no 150-door warning. After the edit, 757 knockable, still no warning. Truncation copy remains in `prop-tally.tsx` for the 3,000-dot cap (this prop was under the cap).
  - `tsc --noEmit` and eslint: **PASS** — `tsc --noEmit` exit 0; eslint on every changed source file exit 0, no output.
- **Deviations from brief:**
  - The amendment says editing the polygon clears the preview. The session instruction was a visible banner and a disabled Save, with the lines left up. The banner is what shipped.
  - The amendment's readout includes "(NCCZ)". The session's string was "{n} knockable · {m} excluded", and excluded doors are not only NCCZ, so the suffix was left off.
  - `updatePropRing` writes `territories.geom` when Generate is clicked on a ring that differs from the stored polygon. `route_walk_inputs` reads the stored polygon; without this write a regenerate would ignore the edit. It is not a route-table write.
  - The variant override is a new server action (`freeze-variant.ts`) rather than a parameter on `generate-route.ts`, because that file was not to be modified.
  - `fitRouteBounds` clamps padding. MapLibre leaves the camera unmoved when the padding is taller than the canvas; the frozen map was a city-zoom view of Bristol until this was fixed.
- **Not done / deferred:** Cross-session staleness. No column on `territories` records a polygon edit, so reopening the draw page after an earlier edit cannot be told apart from an unchanged prop. No migration (next free number remains 021). R4 not started; the field map still draws `route_geom`. The 2,000-door / mid-range-phone check from the map-layer skill was not run. Route paint was checked on a desktop browser (Windows, viewport 1400×900): frozen Speedwell 18 steps, draw-page preview 264 steps on the highlighted variant with six variants in the source and 795 door dots. No new dependency.
- **Follow-ups:** A polygon-edit timestamp would be needed before cross-session staleness can be honest. R4 still owns the field route. The throwaway prop "R3 ui check" was deleted after the browser check (`territories` 0, its `territory_routes` 0).

---

### Stage 5b-R3 — Override diagnostic (no feature change)
- **Date:** 2026-09-24
- **Model:** Cursor Grok 4.7
- **Built:** Nothing. The live Speedwell visit 2 row (`0512c982-bd97-4745-be5a-0d9791585e6f`, `route_variant_key` `best_reversed`) is the parity default for an even visit, which is what the R3 log already recorded for the read-only view. The harness line "visit 2 with explicit `best` → `best`" was a throwaway clone, deleted in that harness's cleanup, not this row.
- **Acceptance:**
  - RPC override on that assignment: **PASS** — admin session, `assignment_route_freeze` with `p_variant_key` `best`. Re-queried row: `route_variant_key` `best`, `route_source_id` `75581849-f21c-4f7f-bc2f-12df6c7c7558` (the saved `best` row). Restored with `p_variant_key` `best_reversed`. Re-queried again: `best_reversed`, `route_source_id` `e94dda90-e66f-40ac-a051-40631965642c`. 0 knock events, 18 steps, both before and after.
  - Live Allocate click: **PASS** — `/admin/allocate`, signed in as the admin, REF - Speedwell next visit 3 (odd; parity `best`). Picked Reversed, date 2028-12-01, CanvasserX, Allocate. Page said "Route frozen: best route, walked backwards". Re-queried assignment `580db3d1-3050-41d5-b69c-71748d68fc14`: visit 3, `route_variant_key` `best_reversed`, `route_source_id` `e94dda90-e66f-40ac-a051-40631965642c`. That assignment, its 18 `route_steps` and its member row were then deleted. The two pre-existing Speedwell assignments were unchanged. The allocate list no longer shows 1 Dec.
- **Deviations from brief:** None. No code, schema, or migration change. `generate-route.ts` and migration `020` were not edited.
- **Not done / deferred:** No trace of a lost override, because neither test lost it. Visit 1 (`e318dd39-7c34-46ea-9452-5041de560a02`) was not touched.
- **Follow-ups:** None from this diagnostic. R4 was not started.

---

### Walkline junction joins
- **Date:** 2026-09-24
- **Model:** Cursor Grok 4.7
- **Built:** `offsetRun` in `lib/geo/walk/geometry.ts` (dedupe, concatenate, one `offsetPolyline` call, split back; a join whose mitre would pass the far end of either neighbouring edge, or reverse that edge, keeps today's independent square ends). `buildVariant` in `lib/geo/walk/steps.ts` offsets each run of consecutive road steps together. A run breaks at a cross and at a reversal (reverse half-edge, or a turn past 170°). Cross geometry, `unitNormalAtEnd`, kind, side, instructions, `length_m` and centreline are unchanged.
- **Acceptance:**
  - `npm run verify:stage5b-r1`: determinism **PASS**, three identical runs. New full-output md5s (was Speedwell `6e921f7e729d`, redland `2f0f4cb5872b`, Northville `a27cad3000c2`): Speedwell `9fdb84c22172`, redland `20a48f4a29ef`, Northville `9041f57c16ed`. `best_reversed` is best backwards **PASS**. Walkline-side doors still **FAIL**, counts 2 / 92 / 43 against the previous 2 / 92 / 44 (Speedwell unchanged, redland unchanged, Northville one fewer).
  - Saved variants replaced and re-frozen, live database. Every `door_order` md5 unchanged (Northville best `0cbca16cb89bf3ca4bc9f1308b683de2`, best_reversed `5e9a0000c401dba3ee0b68d0a76644fa`; Speedwell best `b3a1e2566e48f16710b07f5d9f3197cf`, best_reversed `ff24a7063ebd2fb8cab2d2676f5862ef`; alts likewise). Knocks immediately before each freeze: 0, 0, 0. After: Northville 26 Sept `best_reversed` source `bddc41f9-d8c3-4e17-93eb-776c828a64bb` (was `f3477039-…`); Speedwell 24 Sept `best` source `ec67ff22-315d-472d-9ed5-d5d372c7449a` (was `75581849-…`); Speedwell 22 Sept `best_reversed` source `3b331946-4a99-459c-b8f3-6ce5ba146b5e` (was `e94dda90-…`). Snapshot md5s unchanged. Each assignment still has one member, canvasser `576c4ce7-…`, `route_position_m` and `route_position_at` null.
  - Frozen view, Northville visit 2: Gloucester Road North meets Pine Grove at one point (`-2.5783215, 51.5032501`), no crossing. The service-road mouth meets Pine Grove at `-2.5774018, 51.5032467` and `-2.5775173, 51.5032493`. Steps 81–84 share endpoints exactly (the old 0.5–0.75 m kinks are gone).
- **Not done / deferred:** Steps 80 and 81 on Gloucester Road North still jump pavements with no cross (`-2.5794093, 51.501666` to `-2.5792959, 51.5016522`). That is a kind/side question, left as it was.

---

### Walkline junction joins
- **Date:** 2026-09-24
- **Model:** Cursor Grok 4.7
- **Built:** `offsetRun` in `lib/geo/walk/geometry.ts` (dedupe, concatenate, one `offsetPolyline` call, split back; a join whose mitre would pass the far end of either neighbouring edge, or reverse that edge, keeps today's independent square ends). `buildVariant` in `lib/geo/walk/steps.ts` offsets each run of consecutive road steps together. A run breaks at a cross and at a reversal (reverse half-edge, or a turn past 170°). Cross geometry, `unitNormalAtEnd`, kind, side, instructions, `length_m` and centreline are unchanged.
- **Acceptance:**
  - `npm run verify:stage5b-r1`: determinism **PASS**, three identical runs. New full-output md5s (was Speedwell `6e921f7e729d`, redland `2f0f4cb5872b`, Northville `a27cad3000c2`): Speedwell `9fdb84c22172`, redland `20a48f4a29ef`, Northville `9041f57c16ed`. `best_reversed` is best backwards **PASS**. Walkline-side doors still **FAIL**, counts 2 / 92 / 43 against the previous 2 / 92 / 44 (Speedwell unchanged, redland unchanged, Northville one fewer).
  - Saved variants replaced and re-frozen, live database. Every `door_order` md5 unchanged (Northville best `0cbca16cb89bf3ca4bc9f1308b683de2`, best_reversed `5e9a0000c401dba3ee0b68d0a76644fa`; Speedwell best `b3a1e2566e48f16710b07f5d9f3197cf`, best_reversed `ff24a7063ebd2fb8cab2d2676f5862ef`; alts likewise). Knocks immediately before each freeze: 0, 0, 0. After: Northville 26 Sept `best_reversed` source `bddc41f9-d8c3-4e17-93eb-776c828a64bb` (was `f3477039-…`); Speedwell 24 Sept `best` source `ec67ff22-315d-472d-9ed5-d5d372c7449a` (was `75581849-…`); Speedwell 22 Sept `best_reversed` source `3b331946-4a99-459c-b8f3-6ce5ba146b5e` (was `e94dda90-…`). Snapshot md5s unchanged. Each assignment still has one member, canvasser `576c4ce7-…`, `route_position_m` and `route_position_at` null.
  - Frozen view, Northville visit 2: Gloucester Road North meets Pine Grove at one point (`-2.5783215, 51.5032501`), no crossing. The service-road mouth meets Pine Grove at `-2.5774018, 51.5032467` and `-2.5775173, 51.5032493`. Steps 81–84 share endpoints exactly (the old 0.5–0.75 m kinks are gone).
- **Not done / deferred:** Steps 80 and 81 on Gloucester Road North still jump pavements with no cross (`-2.5794093, 51.501666` to `-2.5792959, 51.5016522`). That is a kind/side question, left as it was.


---

### Stage 5b-R4 — Field route display
- **Date:** 2026-09-24
- **Model:** Cursor Grok 4.7
- **Built:** The field Map tab paints a new-engine freeze with `paintRouteLayers` from `lib/map/route-layers.ts`. Door placement is the step whose `first_seq`/`last_seq` contains the snapshot position. The 1.5 m / 0.08-fraction snap is deleted. An old-engine freeze keeps snapshot order, the stranded tail and no route line. The Map header is the variant's own facts. Dexie version 6 adds no store; the new step fields are optional on the existing rows, and a cache that lacks `kind` is re-fetched when the network works and read as the old shape when it does not.
- **Acceptance:**
  - Northville 26 Sept (`c98754f1`, `best_reversed`) in the field Map tab as CanvasserX: **PASS**. Header "Visit 2 · reversed · start The Brimbles (east) · doors on your right · 1,225 doors". Map dataset: 422 steps, 44 crossings, layers `route-walk-work`, `route-walk-other`, `route-walk-chevrons`, `route-walk-cross`, `route-walk-start`, `route-walk-end`. Screenshot: blue pavement lines with black chevrons, grey dashed non-working legs with chevrons, crossing dots at the turns. 1,225 door dots. Desktop browser, not a phone.
  - Door placement: **PASS**. UPRN 500163, snapshot position 34, is inside step 81 only (`first_seq` 34, `last_seq` 43, Gloucester Road North, side right). `describeRoute` placed it on step 81. No house number or street on `v_door_label` for that UPRN.
  - Old-engine Northville visit 1 (`97da5711`, 18 Sept): **PASS**. Opened in the field Map tab. Header "Visit 1 · mid · 1,225 doors". Painted steps 0, crossings 0. Screenshot is dots along the streets and no route line. No alert.
  - Reversed header and the banned words: **PASS** for the header above. Grep of `app/(field)`, `components/field` and `lib/field` finds no "clockwise" or "anticlockwise". `lib/geo/rotation.ts` `formatSweep` still returns those words, and the admin allocate list still renders them. That is not field-facing and was left as it is.
  - Unrouted banner and stranded marks: **PASS**. St Andrews (unrouted, 5 doors) shows the interim-sweep banner. Northville visit 1 shows 39 "Off the drawn route" marks and no step cards. The banner stays hidden on a freeze that has `route_geom`, including an old-engine freeze, because that snapshot is already route order.
  - Dexie old shape: **PASS**. A version-5-shaped `route_steps` row (no `kind` key) was written for St Andrews, supabase requests were blocked, and the logger and map reloaded from that cache. No alert. The injected `stranded_count` of 1 marked one door. The map painted 0 steps. Header stayed "Visit 1 · mid · 5 doors".
  - Knock counts re-queried: **PASS**. Northville 26 Sept 0, REF - Speedwell 24 Sept (`best`) 0, REF - Speedwell 22 Sept (`best_reversed`) 0. Work dates restored to 26 Sept, 24 Sept, 22 Sept, 18 Sept and 4 Sept.
  - `tsc --noEmit`: **PASS**. eslint on the changed files: **PASS**.
- **Deviations from brief:** The field app only loads Europe/London today, so the browser checks moved `work_date` onto today and moved it back. No knock was written. The compass in the header is the octant from the door centroid to the first pavement point. `route-layers.ts` rendering was not edited.
- **Not done / deferred:** The map-layer skill's mid-range-phone check at 2,000 points. This was 1,225 points in a desktop browser. Admin allocate still says clockwise / anticlockwise via `formatSweep`.
- **Follow-ups:** None for R4. Dry runs are the next session, not this one.

---

### Allocate form — reply crash and work-date default
- **Date:** 2026-09-24
- **Model:** Cursor Grok 4.7
- **What was wrong:** Allocating Northville to CanvasserX replaced the page with Next.js "An unexpected response was received from the server", pinned on `AllocatePage` in `app/(admin)/admin/allocate/page.tsx` line 66. That line did not throw. The sentence is Next's client check for a server-action reply that is not a React flight payload. The form, inside one `startTransition`, awaited `allocatePropAction`, then called `router.refresh()` without waiting, then awaited `generateRouteAction`. The refresh is an ordinary page response. Next read it as the route action's reply and threw the overlay. The database had already finished: `allocate_prop` at 18:40:41Z, `assignment_route_freeze` 400 one second later (`No saved route "best_reversed" exists` — visit 2 is even, and that variant was not saved yet), then `route_walk_inputs`, `territory_routes_save` and a second freeze, all 200. The row is `c98754f1-dbe1-4be7-a18a-cc200ada3704`, work date 2026-09-26, visit 2, `route_variant_key` `best_reversed`, 21,876.64 m, 4 stranded. Nothing was written for 24 September. The date field was the other fault: `tomorrowISO` added 36 hours, so after midday London it skipped a day. At 19:40 BST on 24 September the field opened on 26 September, which is the date that was saved.
- **What changed:** `components/admin/allocate-form.tsx` only. The list refresh now runs after the route call returns, not between the two awaits. A reply that still cannot be read is caught and shown on the form; if the allocation had already been confirmed, that confirmation stays and the route line says the reply could not be read. The same catch is on "Draw route". The work-date default is the next calendar day in Europe/London, taken from today's London date plus one day, not `now + 36 hours`.
- **How it was implemented:** `onSubmit` keeps the saved allocation in a local `base` and wraps both server actions in one try/catch. `router.refresh()` is the last line of the try. The catch, when `base` is set, writes a failed `RouteActionResult` (`code` `unavailable`) onto that saved visit instead of clearing it. When the throw happens before any allocation is confirmed, the form shows that the request did not complete and that the visit may already have been saved. `tomorrowISO` formats today in `Europe/London`, adds one civil day with `Date.UTC`, and returns the `YYYY-MM-DD` of that instant. No migration, no change to `allocate_prop`, `generateRouteAction` or the route freeze.
- **Notable:** The 26 September Northville assignment was left as it was. It does not need allocating again. The dev server logged the allocate posts as HTTP 200 with no exception; the failure was only in the browser. This browser check could not open `/admin/allocate`: the session in use was a canvasser and the app redirected to `/field`. The date default was not clicked through as an admin. Admin allocate still says clockwise / anticlockwise via `formatSweep`.

---

### Stage 5b — Open-path routes (amendment)
- **Date:** 2026-09-25
- **Model:** Claude Opus 5.5
- **Built:** A route now starts at its first door and finishes at its last. `traverse()` in `lib/geo/walk/traverse.ts` keeps `records.slice(firstWork, lastWork + 1)` and no longer appends a "Back to the start" leg; the `return` role is gone. `walkChain` also drops a chain's trailing segments once they have no doors. `rankCostM` / `nonWorkingM` sum `keptLengthM` between those two doors. `endToStartM` is the planar distance between the first and last door's centreline feet, and `reverseTraversal` copies it instead of writing 0. `return_m` stays on the stored shape and is always 0. New `lib/geo/walk/trim.ts`: `findTurns` (same chain, or a no-cross reversal where exactly one side is a transfer), `keepIntervals` (turn far bound at the furthest door either pass knocks, then the route ends, then a 1 m minimum span), `keptLengthM`, `doorFeet`. `lib/geo/walk/geometry.ts`: `sliceAlong` (a cut within 1e-6 m of a vertex is that vertex), `directionAlong` with an approach of 1 or −1 so a vertex uses the incoming edge, `uTurnArc` (`ARC_POINTS` 9, always built from segment side 0 to side 1), `WALK_BACK_INSET_M` 2. `buildVariant` in `lib/geo/walk/steps.ts` slices each road step to its interval; a cross is a clamped arc (`length_m` stays `CROSS_M`); a one-sided walk back sits at `PAVEMENT_OFFSET_M − 2` m on the knocked pavement, is joined by the same arc, is trimmed where it comes within 1 m of the partner line, and gets a connector to the next step (the lower segment id wins between two walk backs). Instructions read "Cross at the last door" and the last step gains " — finish at the last door". `lib/map/route-layers.ts`: SDF square `route-walk-square` on `route-walk-start` (green) and `route-walk-end` (burgundy). `Legend` in `components/field/map-tab.tsx` adds Start and Finish when both ends exist. `types.ts` and `compareCandidates` in `generate.ts` are comments only. `scripts/verify-stage-5b-r1.ts` replaces the R1 "ends within 100 m of start" check with open-path, lead-in, turn, one-sided and connectivity checks. Dated notes in `docs/ROUTE-DESIGN-v2.md` ("Design change — open paths") and under Stage 5b in `docs/D2D-Build-Brief.md`. No migration, no SQL, and no change to `save.ts`, `freeze.ts`, `lib/field/*` or `components/field/field-map.tsx`.
- **Acceptance** (`npm run verify:stage5b-r1`, final run; 39 variants over 7 props):
  - Determinism: **PASS**. Three identical runs. New full-output md5s (was Speedwell `9fdb84c22172`, redland `20a48f4a29ef`, Northville `9041f57c16ed`): Speedwell `aef2fe5c51dc`, redland `4d6520425dd4`, Northville `305b263ee800`.
  - `best_reversed` is `best` backwards (`checkReversed`, unchanged): **PASS**.
  - Open path, every variant of every prop: **PASS**. First and last steps are `work`, `return_m` is 0, start and end are the walkline ends, `total_m` equals the sum of `length_m`, and step 0 starts at its first door.
  - Lead-in, `best` and `best_reversed`: **PASS**. 0 steps / 0 m on all 7 props. It was TEST - dry run 5 steps / 219.8 m (`best`) and 173.4 m (`best_reversed`), and Northville about 542 m.
  - Turns: **PASS**. Walklines stop level with the furthest door, crosses are 9-point arcs joined exactly, and arcs are clamped short of the far node. Speedwell 12 turns over 6 variants (12 with a cross, 0 one-sided, 0 on a loop; 241.4 m pulled back). redland 378 (321 / 57 / 0; 3,827.5 m). Northville 356 (273 / 83 / 6; 5,054.2 m). Clifton 47 (26 / 21 / 0; 1,228.3 m). Southville 37 (30 / 7 / 0; 3,315.8 m). Bishopston 12 (10 / 2 / 0; 548.8 m). TEST - dry run 28 (21 / 7 / 0; 325.5 m). Speedwell's Selby Road cross is at Ventnor node 835754551, with its arc apex 10.0 m from the nearest Ventnor node. Derwent Road's cross is at 835754600, which is not on Ventnor Road.
  - One-sided turns: **PASS**. The walk back is at least 1 m from the work line and joined by an arc. In `best`: Speedwell 0, TEST - dry run 0, Northville 13 (none a walk handed back by a transfer). Example: Northville `best` steps 17 (work) to 18 (walk), unnamed road, segment 106988, separation at least 2.00 m, arc bulge 1.01 m.
  - Connectivity within 0.5 m: **FAIL**, report-only. 162 gaps: walk to work 56, work to work 38, walk to walk 36, work to walk 32. All are corners from `offsetRun`'s junction joins. The committed generator had 384 (193 reversals and 191 corners). Reversals are now 0.
  - Walkline side: **FAIL**, unchanged at 2 / 92 / 43 (Speedwell / redland / Northville). No door is on the wrong side of the centreline; this is a data issue, as recorded at R1.
  - Design note, Speedwell out-and-back, segments, sides, every door once, redland two-sided streets, straight transfers (0 / 0 m on every variant), non-working share, alts, timings, previews: **PASS**. "Old generator untouched": NOT RUN (the harness does not run it).
  - Headline `best` figures. Speedwell 1,889.08 m, non-working 16 m (0.8%; was 26.73 m), 17 steps, md5 `eae26fe5e8363e8eeaf468584a780f35` (`best_reversed` `4620106625096250e56b8903f0563a53`). redland 17,747.71 m, non-working 4,265.52 m (24.0%), 424 steps, md5 `6859986e1d9880d1b29b1c301f84a835` (`best_reversed` `0787ab03e7d7f207d4f12317623329c7`). Northville 19,028.84 m, non-working 6,508.33 m (34.2%), 396 steps, md5 `1b5c1933be6d5c58614e08f2fdb26299` (`best_reversed` `fef31363e93dc9367d2e58a184f4bb91`). TEST - dry run 1,241.86 m, non-working 190.04 m, 29 steps, md5 `86bf4705d954d8178a1bc2f84bf3f67a` (`best_reversed` `a06a1a12b8759e4d661da25788da14d1`).
  - Live save (`territory_routes_save` through the app path): **PASS**. Order md5 is `md5(door_order::text)`; set md5 is the sorted array. Set md5 identical before and after for every key: Northville `ebe4e79126db`, Speedwell `7bacd900540a`, TEST `37c1f0c2e91f`. Order md5 before to after. Northville: `best` `0cbca16cb89b` to `933459db6165` (the old alt_2); `best_reversed` `5e9a0000c401` to `40ca7793b6b8`; alt_1 `a25c10f82c9f` unchanged; alt_2 `933459db6165` to `9e8fb1e9827f` (the old alt_4); alt_3 `900c76fe858a` to `4a346acecf15`; alt_4 `9e8fb1e9827f` to `0cbca16cb89b` (the old `best`). Speedwell: `best` `b3a1e2566e48` to `cec4b37c4619`; `best_reversed` `ff24a7063ebd` to `cfa35c67d487`; alt_1 `3c21da7a43ab` to `1bb3f8fc6532`; alt_2 `f64d25007516` to `d21ca0fc3e49`; alt_3 `6ebce249631f` to `8eed2aef3089`; alt_4 new, `003c30bb798d`. TEST - dry run: `best` `4c2847b6b77a`, `best_reversed` `d49f10fe2784`, alt_2 `e1cf5d8f6fd5` and alt_3 `93c33a94cd5e` unchanged; alt_1 `008975e64dae` to `4bbe4588b5e1`. Saved: Northville 6 variants / 2,450 steps, Speedwell 6 / 106, TEST 5 / 178. Every variant has `return_m` 0 and step 0 `work`.
  - Re-freezes: **PASS**. Knocks re-counted immediately before each: 0. Key unchanged, new `route_source_id`, sorted snapshot md5 unchanged, members unchanged (`route_position_m` and `route_position_at` null), step 0 `work`. Northville 26 Sept `c98754f1` (`best_reversed`): source `a43c6aa6-e104-4f23-ac20-3b8d792bfb56` (was `bddc41f9-…`), order `40ca7793b6b8`, set `ebe4e79126db`, steps 422 to 396, step 0 walk to work, length 21,876.64 to 19,028.84 m. Speedwell 24 Sept `e318dd39` (`best`): source `43a617d4-a1c2-47d9-8efe-e73594386e41` (was `ec67ff22-…`), order `cec4b37c4619`, set `7bacd900540a`, steps 18 to 17, length 1,997.78 to 1,889.08 m. Speedwell 22 Sept `0512c982` (`best_reversed`): source `c4c916b0-e47f-446b-adfd-8019b9b3435b` (was `3b331946-…`), order `cfa35c67d487`, set `7bacd900540a`, 17 steps, length 1,889.08 m.
  - TEST - dry run `df71b74d` not re-frozen: **PASS**. Still 38 steps, 14 knocks, snapshot `4c2847b6b77a` / `37c1f0c2e91f`, step 0 `walk`. Its `route_source_id` is now null, which is what a save does to a frozen assignment whose variant was replaced. Northville 18 Sept `97da5711` (old engine) was not touched.
  - Visual check, frozen admin view (desktop embedded browser, throwaway admin since deleted, 0 profile rows left): **PASS**. Speedwell visits 1 and 2: the Selby and Derwent U-turns are dashed arcs level with the last houses, and the Selby arc is clear of Ventnor Road's line. Green start square and burgundy finish square sit at the ends of the solid line, with no dashed line before the start or after the finish. Northville: 396 lines, 44 crossings, both squares at the line ends. One one-sided turn, Northville steps 18 to 19 on an unnamed road: the walk back is dashed and 2 m nearer the road, visibly separate from the solid work line. The join is flat because the road ends within 5 m, so the clamp gives the arc a bulge of 0.
  - `tsc --noEmit` and eslint on the changed files: **PASS**.
- **Deviations from brief:** A no-cross reversal where exactly one side is a transfer also counts as a turn. There were 124 of those on the committed generator, drawn as 8 m pavement jumps. The one-sided walk back is drawn with an arc; the plan said no arc and the session instruction overrode it. It also stops 1 m short of its outer end where a junction join pulls the work line in (Clifton alt_1 to alt_3, 0.21 m). The old one-sided walk back was not on top of the work line: it was offset onto the opposite pavement. The arc clamp uses the straight-ahead distance to the far node in the direction of travel as well as the along-road distance. Harness measurement, with no tolerance loosened: direction of travel is read from the incoming edge at a vertex; a loop segment uses an exact vertex-order check (nearest-point projection is ambiguous; Northville Gayner Road); the widened-span detection threshold moved from 1.001 m to 1.05 m because a 1 m span measured just over 1.001 m after coordinate rounding; separation leaves out the connecting line's outer point. The 162 corner gaps were left; `offsetRun` is out of scope. Migration 020's comment on `rank_cost_m` still says "including the return leg" and was not edited. Speedwell gained an alt_4. Northville's saved `best` door order changed; the new `best` is the old alt_2.
- **Not done / deferred:** The field Map-tab legend was not viewed in a browser: NOT VERIFIED. The map-layer skill's 2,000-point mid-range-phone check: NOT VERIFIED. On-device field ergonomics: NOT VERIFIED.
- **Follow-ups:** `offsetRun` corner gaps, 162 across the 7 props. On Northville the first step is a 1 m widened single-door work step, so a dashed walk sits beside the start square, and step 190 (a walk up Fourth Avenue's east pavement) overlaps the final work line and runs 9 m past the finish square; it is earlier in route order. Walkline-side data issue, still 2 / 92 / 43.

---

### Stage 5c-a — Allocation removal and mid-shift reallocation (backend)
- **Date:** 2026-09-26
- **Model:** Cursor Grok 4.7
- **Built:** `supabase/migrations/021_stage_5c_a_reallocation.sql`, applied and listed as version `20260926153236` / name `021_stage_5c_a_reallocation`. `assignments.closed_reason` (`reallocated` or null) and `assignments.counts_for_rotation` (default true). `assignment_members.left_at`. Generic admin-only `app_settings`, seeded `rotation = {"visit_threshold_pct": 50}`. `assignment_close_early`, `assignment_remove`, `assignment_member_remove`. `allocate_prop` refuses a same-date double booking and sets `visit_number` from the highest counting visit. `todays_assignment` skips a closed assignment and a member who has left. `assignment_members_max_three` counts only `left_at is null`. The trigger is still `BEFORE INSERT OR UPDATE OF assignment_id`. `lib/geo/allocate-prop.ts` maps hint `canvasser_double_booked`. `lib/supabase/types.ts` regenerated.
- **Function diffs** (live body before 021, which matched 020 / 010 / 003 apart from line endings, against the 021 body):
  - `allocate_prop`: declare gains `v_booked_name text`. After the active-canvasser check, a guard selects the first `canvasser_ids` entry with `left_at is null` on another territory, same `work_date`, `closed_at is null`, and raises `'% is already allocated to a prop on that date.'` (`22023`, hint `canvasser_double_booked`). The visit query changes from `select count(*) ... where territory_id = ...` to `select coalesce(max(a.visit_number), 0) ... and a.counts_for_rotation`. The function comment describes both. The inline rotation comment was updated with that query. Nothing else in the body.
  - `todays_assignment`: the `where` gains `and a.closed_at is null and m.left_at is null`. The function comment says so. Nothing else.
  - `assignment_members_max_three`: the count gains `and left_at is null`. Nothing else.
- **Policies:** `app_settings` RLS on, default deny. `select`, `insert`, `update`, `delete` granted to `authenticated` after revoke from `public`, `anon`, `authenticated`. Four policies, each `(select public.app_role()) = 'admin'`: `app_settings_select_admin`, `app_settings_insert_admin`, `app_settings_update_admin`, `app_settings_delete_admin`. B-tree `app_settings_updated_by_idx`. New and re-created functions: `revoke all` from `public`, `anon`, `authenticated`, `service_role`, then `grant execute` to `authenticated`.
- **Acceptance** (role-simulated SQL, throwaway admin and C1–C5, territories `5ca throwaway A` 10 doors and `5ca throwaway B` 6 doors; London date `2026-09-26`):
  - 0-knock removal: **PASS**. New assignment `880d626c-4265-4cf6-8f4d-6c4525125ff0` on REF - Speedwell, work date 2099-12-31, visit 3, 182 doors. Freeze `best` wrote 17 `route_steps`. Before remove: assignments 1, members 1, route_steps 17. `assignment_remove` returned `action deleted`, `worked 0`, `total 182`, `counts_for_rotation null`. After: assignments 0, members 0, route_steps 0. Existing Speedwell assignment-id md5 `98a147223ac869e51423b4cad4dce60f` before and after; assignment count 2 before and after. Speedwell `route_steps` 34 before and 34 after.
  - Visit 1 left open; 4/10 does not count; the next reuses 2; 6/10 counts; the next is 3: **PASS**. Visit 1 `93d52703-555e-4bcc-b28f-03587b80ec4d`, visit_number 1, 10 doors, `closed_at` null. Visit 2 `0fbbce29-47ea-44dc-adc9-caf68bcdf192`, 4 knocks, md5 `1fe88e8f0aa0310ed470233f4579b9c6` before and after. Remove: `closed`, worked 4, total 10, percent 40, threshold 50, source `setting`, `counts_for_rotation false`. Reused visit `323d73d3-3e1c-4ca7-9738-e667378276a4`, visit_number 2, 6 knocks, md5 `1a7bc2871720be894346bc1adc78aea2` before and after. Remove: worked 6, percent 60, `counts_for_rotation true`. Next allocation `f73338ab-ca24-434d-8284-feaa37d256fc`, visit_number 3, 10 doors.
  - Trio cap: **PASS**. Assignment `16b7b99d-aea2-4738-9dbd-b0d6be17357a`. Removing C3 returned `action left`, `remaining_active 2`, `assignment_closed false`. C4 inserted. Active members 3, C3 `left_at` set, C4 still active. C5 insert rejected `23514` `A team is one to three canvassers`. C5 rows 0.
  - Last member sets `closed_at`: **PASS**. Solo `a96ea9a9-5e3a-45c4-b595-6fc8f2c7eebc`. Remove returned `remaining_active 0`, `assignment_closed true`, close `action closed`, worked 0, total 10, `counts_for_rotation false`. Row still present (1). `closed_at` set. `closed_reason` `reallocated`.
  - Knock after leaving: **PASS**. C3, still left on `16b7b99d-aea2-4738-9dbd-b0d6be17357a`, inserted knock `6f6fe852-b405-4fa7-9ff8-e98d6aa32d37`. Knock count for that canvasser on that assignment: 1.
  - Double-booking guard: **PASS**. Duo `5a6fd920-9369-4a77-b281-a9d39e7d57b1` on 2026-09-26. Same date on territory B refused `22023` hint `canvasser_double_booked`, message `C1 is already allocated to a prop on that date.` Other date 2099-04-02 allowed, assignment `4d6ed62c-e0e5-4e34-b5f4-cd5cbf309c9a`, visit 1. After C1 left the duo (`remaining_active 1`, duo `closed_at` still null), same-date allocate on B succeeded: `f48f0033-0999-4957-a8a0-d3c38d69d48f`, visit 2.
  - `todays_assignment`: **PASS**. As C1, returned assignment `f48f0033-0999-4957-a8a0-d3c38d69d48f`, work_date `2026-09-26`, door_count 6. That is the new assignment, not the duo.
  - Threshold 30: **PASS**. Assignment `65d695d9-3410-4548-9058-65ee220b165e`, 4/10. Remove: `counts_for_rotation true`, threshold_pct 30, source `setting`, percent 40. Setting read back as `{"visit_threshold_pct": 50}` on the next statement.
  - Bad setting `"abc"`: **PASS**. Assignment `5a6350ba-1c59-4c78-bdcb-f2988170ddd7`, 4/10. Remove succeeded: threshold_pct 50, source `default`, `counts_for_rotation false`, percent 40. Setting restored to 50 on the next statement.
  - `assignment_close_early` on a closed assignment: **PASS**. Assignment `323d73d3-3e1c-4ca7-9738-e667378276a4` refused `22023` hint `already_closed`, message `That assignment is already closed.`
  - Canvasser denied `app_settings` and `assignment_remove`: **PASS**. C1 `select` returned 0 rows. Insert raised `42501` `new row violates row-level security policy for table "app_settings"`. `assignment_remove` raised `42501` hint `not_admin`.
- **Cleanup:** The in-script delete of the throwaway users rolled back: `app_settings.updated_by` still referenced the throwaway admin (`23503`). A follow-up cleanup set `updated_by` null, restored `rotation` to `{"visit_threshold_pct": 50}`, then deleted 19 knocks, 11 assignments, 2 territories and 6 users. Leftover throwaway rows: `auth.users` 0, `public.profiles` 0, `auth.sessions` 0. Territories named `5ca %` 0. Assignments created by the throwaway admin 0.
- **Real props re-queried after cleanup** (assignments / knocks, same as before the run): Northville 1 / 0, REF - Speedwell 2 / 0, RED - Speedwell 0 / 0, TEST - dry run 2 / 31, redland 2 / 0, redland_test 3 / 31, DEMO - Bishopston 4 / 262, DEMO - Clifton 3 / 362, DEMO - Southville 3 / 245, DEMO - St Andrews Park 1 / 5. Speedwell `route_steps` still 34.
- **Deviations from brief:** The brief has no Stage 5c text; this session's plan was the spec, and the dated note under Stage 5 records what shipped. A snapshot with 0 doors reports 0% instead of raising division by zero; every acceptance prop had doors. Two admins allocating the same canvasser to two different props at the same instant can both pass the guard, because the lock is per territory. Recorded, not fixed. `is_assignment_member` was not changed, which is why a canvasser who has left can still insert a knock.
- **Not done / deferred:** No UI, no server actions for the new RPCs, no change to `lib/sync/queue.ts`, `lib/geo/walk/`, `route_steps` (table), `knock_events` policies, or migrations 001–020. The allocate page still previews the next visit as assignment count + 1.
- **Follow-ups:**
  1. Offline sync against a deleted assignment. A 0-knock `assignment_remove` hard-deletes the row. A knock logged offline against it and synced afterwards fails the `knock_events.assignment_id` foreign key. Confirm that the field sync queue (`lib/sync/queue.ts`) shows that failure to the canvasser and does not drop it silently.
  2. Re-adding a removed member must clear `left_at` on the existing `assignment_members` row, not insert a new one. The primary key `(assignment_id, canvasser_id)` rejects a second row.
  3. A real phone switches to the new assignment after a move. `todays_assignment` now filters closed and left rows. Verify on a real phone that the field app replaces the Dexie-cached old assignment with the new one after the canvasser is moved.
- **Checks:** `npx tsc --noEmit` exit 0. `npx eslint lib/geo/allocate-prop.ts lib/supabase/types.ts` exit 0.

---

### Stage 5c-b — Allocation removal and mid-shift reallocation (admin UI)
- **Date:** 2026-09-26
- **Model:** Cursor Grok 4.7
- **Built:** Migration `022_stage_5c_b_member_add.sql` (`assignment_member_add`), applied. There was no allocation detail screen; an admin only saw a one-line "Already allocated" row on `/admin/allocate`, so remove, member remove, and add member live on that row for an open visit. `/admin/settings` reads and writes `app_settings` key `rotation`, field `visit_threshold_pct`. The allocate page's next-visit figure is 1 + the highest `visit_number` with `counts_for_rotation`. Admin already has `assignments_all_admin` (SELECT, and the rest), so that is the same query `allocate_prop` runs, not a second function. `lib/geo/allocate-prop.ts` `SERVER_HINTS` gained `missing_assignment`, `already_closed`, and `already_member`. Server actions: `removeAssignmentAction`, `removeMemberAction`, `addMemberAction`, plus the removal preview and the threshold save. `lib/supabase/types.ts` regenerated (the new function only).
- **Already-active decision:** `assignment_member_add` returns an error (`already_member`) when `left_at` is already null. The add control only lists people who are not active members, so a second add is a double submit or a stale screen. Reporting success would claim someone had been added.
- **Policies:** No new table. `assignment_member_add` follows the 021 grant: `revoke all` from `public`, `anon`, `authenticated`, and `service_role`, then `grant execute` to `authenticated`. The body raises `42501` / `not_admin` for anyone else. Verified with a canvasser JWT: `42501`, hint `not_admin`.
- **Acceptance:**
  - Brand-new member and re-add: **PASS**. On a throwaway duo, removing C2 then `assignment_member_add` returned `readded`. Re-query: 1 row for that canvasser, `left_at` null. Adding C3 returned `added`. Re-query: 1 row, `left_at` null.
  - Cap on the clear-`left_at` path: **PASS**. Trio, C3 removed, C4 added (3 active). Re-adding C3 was refused `23514` hint `team_too_large`, message `A team is one to three canvassers.` Re-query: C3 still one row with `left_at` set, 3 active members. That update does not fire `assignment_members_max_three`.
  - Double-booking: **PASS** for both. `allocate_prop` on the same date refused hint `canvasser_double_booked` (`5cb C1 is already allocated to a prop on that date.`). `assignment_member_add` of C1 onto another open assignment that date refused the same hint. A different date was allowed (visit 2).
  - Remove-allocation UI: **PASS**. 0 knocks: the confirm step said "This will delete this allocation." and "This cannot be undone." Confirm said "This allocation has been deleted." The assignment row for that date was gone (count 0). Worked visit, threshold 30: preview "5 of 12 doors worked (41.7%) — this will count toward rotation. Threshold is 30%." Confirm: "Ended this visit. 5 of 12 doors worked (41.7%). This will count toward rotation. Threshold 30%." The row is closed, `closed_reason` `reallocated`, `counts_for_rotation` true, 5 knocks. Under the threshold: preview "2 of 12 doors worked (16.7%) — this will not count toward rotation. Threshold is 30%." Confirm matched those numbers and "will not". The row has `counts_for_rotation` false.
  - Member remove/add UI: **PASS**. On the throwaway duo, Remove on Ben showed "Left" and the notice "Removed 5cb Ben." Add member then listed Ben; adding him back showed "Added 5cb Ben back onto this visit." and a Remove control again. Re-query: 1 row, active.
  - Threshold screen: **PASS**. "abc" and 150 were refused in the form ("Enter a percentage from 0 to 100.") and the stored value stayed 50. Saving 30 showed "Saved. Removals use 30%." and "Removals use 30%." The row was `{"visit_threshold_pct": 30}`. The removal above then returned threshold 30. Restored through the same form to 50; the row is `{"visit_threshold_pct": 50}` again.
  - Next-visit preview: **PASS**. After visit 1 counted and visit 2 was ended at 2/12 under a 30% threshold (`counts_for_rotation` false), the page's next visit was **2** (two assignment rows; a count of rows would have said 3). Allocating the next date confirmed **Visit 2**. SQL for that date: `visit_number` 2. Page preview 2, server 2.
  - Sync queue: **PASS, no code change.** `sendOp` as the canvasser, against an assignment `assignment_remove` had deleted, returned `permanent`, HTTP 403, SQLSTATE `42501`, message `new row violates row-level security policy for table "knock_events"`. The membership row cascades with the delete, so RLS rejects the insert before the foreign key is checked. The knock row was not inserted (count 0). A service-role insert, which bypasses RLS, hit `23503` on `knock_events_assignment_id_fkey`. `classify` maps both 403/42501 and 409/23503 to `permanent`. `flush` parks a permanent result as `failed` and continues, so it is not dropped and not retried on the backoff loop. `SyncStatus` renders `failed` rows with the server message, plus Retry and Discard.
  - `router.refresh()` ordering: **PASS** by reading the code. `addMember`, `removeMember`, and `confirmRemoval` in `components/admin/allocation-manage.tsx` each await one action and call `router.refresh()` as the last line of that try. The preview load does not refresh. The threshold save does the same. None of them await another action after the refresh.
  - Cleanup, `tsc`, eslint: **PASS**. Throwaways removed: 5cb users 0, 5cb props 0, 5cb saved routes 0. Assignments 26 and knocks 936, the same counts as before the run. Threshold 50. `npx tsc --noEmit` exit 0. eslint on the changed files exit 0.
- **Deviations from brief:** The brief has no Stage 5c-b text; this session's instructions were the spec, and the dated note under Stage 5 records what shipped. The removal preview is a TypeScript copy of the knock-count / distinct-snapshot-doors / threshold rules in `assignment_remove` and `assignment_close_early`, because those functions were not to be edited and admin SELECT can read the rows. The browser run compared the preview sentences to the RPC return. An already-active member is an error, as above. The same per-assignment lock race as `allocate_prop` remains: two admins adding one canvasser to two props at the same instant can both pass. Recorded, not fixed.
- **Not done / deferred:** No change to `assignment_remove`, `assignment_member_remove`, `assignment_close_early`, `todays_assignment`, `allocate_prop`'s guard or visit numbering, `route_steps`, `knock_events`, or `lib/geo/walk/`. No change to `lib/sync/queue.ts`. The 5c-a follow-up about a real phone replacing its Dexie-cached assignment after a move was not run.
- **Follow-ups:** A real phone still needs to show that the field app drops a closed or left assignment from the Dexie cache and loads the new one.

---

### Stage 10 — Next door and partner position
- **Date:** 2026-09-26
- **Model:** Cursor Grok 4.7
- **Built:** The next door on the field Map and Logger: the lowest snapshot door that is neither knocked nor held by someone else, with the street and Take. Take claims it and opens the existing outcome buttons. Back, Skip, a different row, and closing the map sheet release the claim. A log broadcasts `knocked`. Claims travel as Supabase Realtime broadcast on `assignment:<id>` (`private: true`) and are never inserted. A claim expires three minutes after `at`. Teammate lines use the address ladder, then `on #N`, and an empty line when there is no claim and no knock. A dropped connection greys the line and adds "last heard". Solo hides the lines. After sync, a UPRN also knocked by a teammate is flagged on the device; coverage stays one row in `v_latest_knock`. Migration `023_stage_10_realtime_auth` (applied): select and insert policies on `realtime.messages` for broadcast, active members only, and `profiles_select_teammate`.
- **Acceptance:**
  - Three sessions on one trio never show the same next door while connected: **PASS**. Ada, Ben and Cid each reached `SUBSCRIBED` on the private channel. Distinct next doors: 3. Example UPRN 48895. Run twice (the second with `--fast` for the browser fixture).
  - A claim left open over three minutes returns to the pool: **PASS**. Wall clock 181015 ms from `at`. The same claim was still live at 2 min 59 sec and not live at 3 min 1 sec. `winningHolds` was empty after the wait. The check did not assert the constant; it waited.
  - Next door offline from Dexie, against snapshot order: **PASS**. Online, with Ben's knock on the server, the card was sequence 1, UPRN 48903, plate 15, Monmouth Road. After the prop was cached, Supabase was blocked and the logger reloaded: sequence 0, UPRN 48895, plate 7, Monmouth Road, "Door 1 of 69". That is snapshot position 0. Full airplane mode also blocked localhost, so the dev shell did not load (`chrome-error://chromewebdata/`).
  - Nothing knocked and no claim is an empty line, not a guessed position: **PASS**. Cid Moss · no door yet. `route_position_m` and `route_position_at` were null (0 non-null rows) before and after. Ben's line was his knock, "Ben Holt · 7 Monmouth Road".
  - Solo hides teammate lines and keeps the next door: **PASS**. Sol Page on STAGE 10 SOLO PROP. `teammate-line` count 0, no `teammate-lines` element, plate 7, Monmouth Road, sequence 0, Take present.
  - A trio shows two lines: **PASS**. Ben Holt and Cid Moss. Count 2.
  - A canvasser not on the assignment cannot subscribe or receive claims: **PASS** for the private channel. Out Rider: `CHANNEL_ERROR Unauthorized` on `assignment:361efa9f-90c7-462a-852c-1cbd64aa04df`, messages 0. A public channel of the same topic did subscribe and received 0 messages. "Allow public access" was left on: there is no management-API token in this environment to set `private_only`.
  - Two offline knocks of one door are flagged, and coverage counts it once: **PASS**. Two inserts, 2 rows, 1 UPRN, `v_latest_knock` count 1. In the browser, after the 60-second undo window, the logger showed "You and a teammate both logged door 1. It still counts once."
  - `tsc --noEmit` and eslint: **PASS** on the final tree (re-run after the browser fixture edits).
- **Deviations from brief:** Migration 023 exists because private Realtime authorisation is RLS on `realtime.messages`, and teammate names were not readable. No claims table, and `route_position_*` is not written. Connected clients reserve the next free door on subscribe so three open sessions do not all display the same door; Take still claims and opens the sheet. A freed lower door does not pull someone off a door they already hold. `route_position_m` is not turned into a door while Stage 16 is off. Teammate names are not stored in Dexie, so a reload with no signal has no lines to grey; a connection drop without a reload does grey them ("last heard 4 min ago" on Ben's knock).
- **Not done / deferred:** Lock-screen widget. `private_only` on the Realtime project setting. On-device checks in direct sun, one-handed, with a wet thumb: **NOT VERIFIED**. Admin, allocation removal, and `lib/geo/walk/` were not touched.
- **Follow-ups:** Set Realtime "Allow public access" off (`private_only`) when a management token is available, so a public join is rejected rather than merely empty. Cache teammate names on the device if an offline reopen should still show the greyed lines.
- **Reconnect (checked 2026-09-26, no code change):** A socket rejoin does not take a new door. `@supabase/phoenix` `Channel.rejoin` calls `joinPush.resend`, and `Push.resend` runs the same `receive('ok')` hook, so the existing `channel.subscribe` callback in `lib/field/use-team.ts` runs again with `SUBSCRIBED`. That callback rebroadcasts this canvasser's in-memory live claim (the same `at` and UPRN from `peopleRef`) and does not build a new one. `reserveDecision` in `lib/field/door-signals.ts` returns `hold` when `winningHolds` already includes this canvasser, and `none` when `wantReserve` is false. `wantReserve` is set false after a hold. The channel effect depends on `assignmentId` and `canvasserId` only (`bump` is stable), so a socket drop does not clear `people` or set `wantReserve` back to true. A full page load is a different case: claims are not stored, the effect starts from an empty map with `wantReserve` true, and that first subscribe reserves the next free door. Unmount of the field provider also broadcasts `release` before the channel is removed. A live network drop was not re-run in the browser for this check.

---

### UI item 4 — route line focus styling
- **Date:** 2026-09-27
- **Model:** Cursor Grok 4.7
- **Built:** The one route renderer paints the current street and the next street in `#c2410c`, later legs as solid tints (`#dc9476` near, `#e7b9a5` far), and walked steps in grey `#a3a9ae`, thinner, with no chevrons. Chevrons are an open SDF ">" on one merged line per leg-run, spacing 120. START and END are baked pills. Crossing dots are gone. The highlight follows the next-door card. Admin uses the same look with no progress shading. No migration. No Dexie version bump.
- **Acceptance:**
  - A1 legs and tiers: **PASS**. `npm run verify:ui4` exit 0. Speedwell legs `[[0,1,2],[3],[4],[5,6],[7,8],[9,10,11],[12],[13],[14,15],[16]]`. Dry run 13 legs, leg 1 `[1,2,3,4,5,6]`. Speedwell tiers at 0, 8, 30, 150, 181, null and undefined matched the table. Cross points 0. Near `#dc9476`, far `#e7b9a5`. `validateStyleMin` 0 errors.
  - A2 types and lint: **PASS**. `npx tsc --noEmit` exit 0. `npx eslint` on the changed files exit 0, including a second pass on `components/field/field-map.tsx`.
  - A3 browser counts: **PASS** for the three log points. Throwaway assignment `2de12359-1e7c-41d1-827b-a2264c0cfff8`, variant `best` (second leg starts at position 6, which is not more than 15). Sequence 0: `done:0,focus:2,near:2,far:13`. After 3 No answer logs, sequence 3, same counts. Sequence 6 (first door of leg 2, Derwent Road): `done:1,focus:3,near:1,far:12`. Screenshots: `C:\Users\nomaa\AppData\Local\Temp\ui4-shots\remount.png`, `after-3.png`, `leg2.png`. Shortest-leg chevron at zoom 17: **NOT VERIFIED**. The shortest leg is Ventnor Road, step 4, seq 64–66, 54.1 m, in focus when the next door is position 35. The map object is not on the DOM, so the camera was not moved to zoom 17 on that leg. Spacing was not changed.
  - A4 remount: **PASS**. Map → Logger → Map. `routeTiers` `done:0,focus:2,near:2,far:13` before and after. Screenshot `remount.png`.
  - A5 offline: **NOT VERIFIED** for a focus change and for a production reload. One offline No answer moved the next door from sequence 35 to 36. Tier counts stayed `done:3,focus:2,near:3,far:9` because both doors sit on Derwent Road seq 35–63. Reload while offline on the dev server: `net::ERR_INTERNET_DISCONNECTED`. A production build was not started.
  - A6 admin: **PASS** for the frozen route. Screenshot `admin-frozen.png`. UI4 Admin, read only, BEST, 17 steps, one orange line, chevrons, START and END badges, attribution visible. Map console errors: none. The only console errors were the dev HMR websocket. Draw-page Generate and variant dimming: **NOT VERIFIED**. The draw page list does not load a saved prop into Generate.
  - A7 layers: **PASS**. At sequence 35, `routeLayers` was `route-walk-work,route-walk-other,route-walk-chevrons,route-walk-start,route-walk-end`. `routeCrossings` was `2` (two `cross` steps). No `route-walk-cross`.
  - A8 scope: **PASS** with one pre-existing file. `git diff --quiet -- lib/sync/queue.ts` exit 0. `git grep -n "geolocation"` is 2 lines in the worktree and 2 lines at HEAD. `git diff --stat` also shows `AGENTS.md` (+1 line), which was already modified before this item.
- **Deviations from brief:** Chevron runs are rebuilt with `setData` (approach a). Badge anchor flips so the northern end sits above its point. `dataset.routeCrossings` counts `kind === "cross"` steps. Chevrons have a 1 px paper halo. The tier effect does not write the layer dataset until `route-walk-lines` exists, so an early run cannot publish an empty layer list. `best` was frozen. It was not `best_reversed`.
- **Not done / deferred:** Zoom 17 screenshot of the 54.1 m Ventnor leg. Draw-page variant dimming. Production offline reload. Real phone, sun, wet thumb, and a 2,000-door pass. No commit.
- **Follow-ups:** Owner still to accept or reject the six agent decisions: badge flip, chevron approach (a), spacing 120, chevron halo, legend labels "First door" / "Last door", and `routeCrossings` counting cross steps. If the 54.1 m leg has no chevron at zoom 17, leave the spacing and report it.

---

### Robust walkline offset — Session A of 2 (algorithm, validator, in-memory gate)
- **Date:** 2026-09-27
- **Model:** Claude Sonnet 5
- **Built:** `offsetCore` in `lib/geo/walk/geometry.ts`: a collapse-aware offset that removes an offset edge which would end up reversed or ≤0 long and re-joins its neighbours, repeated until stable, before ever falling back to a bridge (anti-parallel, or a narrow U/V per the accepted fallback-(b) reading). Outside corners mitre then clamp at 2d, unchanged from the existing formula. `offsetRun` / `offsetPolyline` are now thin wrappers over it. `continuesRun` (`steps.ts`) no longer breaks a run on turn angle (`RUN_BREAK_RAD` removed). Every step now carries a `walk_meta` verification aid (offset metres/side, which end an arc splice or connector rewrote), stripped before storage by `save.ts` alongside `tree`. New pure validator `lib/geo/walk/validate.ts`: V1 continuity, V2 self-crossing, V3 crossing-the-next-step, V4 fidelity to the centreline, V5 declared side, and V6 (owner addition this session — a WORK step whose centreline is a real leg but whose walkline collapsed silently). New `scripts/verify-route-geom.ts` (`npm run verify:geom`): G1 (16 pure synthetic cases + 1 informative case) by default, `--live` adds G2 (read-only, in-memory regeneration vs stored rows for the three fixture props, plus raw counts computed without the validator for comparison). No migration. No database write in this session.
- **Acceptance:**
  - G1 (synthetic cases): **PASS**. All 16 named cases (inside 90° with a 2.62 m edge; two short edges at one corner; hairpin U 30/12/30 inside and outside; outside 150° clamped; collinear points; a near-zero-length edge; a collapsing 2 m middle chamfer whose part becomes `[J,J]`; a walk-back run at d=2; inside/outside rounded kerb 5×0.8 m; inside/outside chamfer 3×1.0 m; inside 0.5+0.5 m; the two V6 direct unit tests) show 0 issues. The three inside-corner cases (kerb, chamfer, 0.5+0.5) land within 0.0000 m of the plain two-edge 90° corner's own joint (limit 0.05 m). One case is labelled INFORMATIVE, not a failure: a narrow inside U (4 m throat, under 2d) correctly reports V4, matching the plan's documented limit.
  - G2 (live, read-only, admin session — magic link + OTP, no user created): raw defect counts (gaps > 0.5 m, gaps crossing the next step, self-crossing walklines), computed independently of the validator, are 0/0/0 on REF - Speedwell (6 variants/106 steps), TEST - dry run (5 variants/178 steps) and Northville (6 variants/2,450 steps) — **PASS** on all three. §2 fields (kind, side, street_name, first_seq, last_seq, instruction, is_dead_end, segment_id, length_m, step position, `rank_cost_m`, `door_order` md5) are identical to the stored `territory_routes` / `territory_route_steps` rows on all three — **PASS**. The V1–V6 validator is 0 issues on REF - Speedwell and TEST - dry run — **PASS** — but finds 12 issues on Northville (V3 ×3, V4 ×9) — **FAIL**, reported below, not silently cleared.
  - Before → after raw counts: REF - Speedwell 5 gaps / 5 crossing / 0 self-crossing → 0/0/0. TEST - dry run 0/0/5 → 0/0/0. Northville 64 gaps / 31 crossing (this session's own count; the plan's VERIFIED baseline says 36 — both reported, not reconciled, per instruction) / 6 self-crossing → 0/0/0.
  - Frozen `route_steps` (read-only, not regenerated); gap counts match the plan's VERIFIED note exactly: REF - Speedwell 22/24/27 Sept: 1 gap and 1 crossing-next-step each, 0 self-crossing. TEST - dry run 25 Sept: 1 gap, 0 crossing, 1 self-crossing; 26 and 27 Sept: 0 gaps, 0 crossing, 1 self-crossing each.
  - Largest per-step walkline length change: 10.749 m, Northville `best_reversed` step 89 (work, Eden Grove), 13.87 m → 3.12 m. (REF - Speedwell: 4.087 m, step 1, Derwent Road. TEST - dry run: 2.070 m, step 12, Harbury Road.)
  - G4: `npx tsc --noEmit` exit 0. `eslint` on every changed/new file (`geometry.ts`, `steps.ts`, `types.ts`, `save.ts`, `validate.ts`, `verify-route-geom.ts`) exit 0.
- **Deviations from brief:** none from the plan's spec. Two engineering choices made while implementing it, both documented in `docs/CLAUDE-HANDOFF.md`: the V4 "non-arc" guard at a fixed end is a flat `ARC_POINTS` (9) vertex count from that end (since `walk_meta` carries only a boolean per end, not a count); `validateVariant` projects each variant's own coordinates locally around its own first walkline point.
- **Not done / deferred:** Session B in full (wiring the validator warning into Generate/Save, the prop-drawer notice text, the fingerprint in `route-cache.ts`, `route-geom-apply.ts`, the re-saves/re-freezes, r2/r3 regression runs, the browser corner screenshot, the Brief amendment). G3 (regression scripts) was not run this session; it is Session B's. Nothing was written to the database.
- **Follow-ups (open finding, needs an owner decision before Session B):** the V1–V6 validator's 12 Northville issues trace to 3 physical locations, not 12 independent faults — a Filton Road `walk` step (V3, 10.968 m, matching the plan's own documented "non-local closeness: a road looping back within 2d of itself is not prevented by a local offset, the validator detects it"); an Eden Grove `work` step (V4, ≈0.887 m past the band); a Gayner Road `walk` step, 16 points (V4, 1.714 m past the band, same location mirrored in `best_reversed`, `alt_1`, `alt_2`, `alt_3`). No tolerance was changed to investigate this. Session B's own hard rule is to re-run `verify:geom -- --live` before G5 and stop if not all-zero — it will hit this same finding on Northville. The owner needs to say whether these 3 locations are an accepted "documented limit" (like the G1 informative case) or need a further fix first.

---

### Robust walkline offset — Session A2 (adaptive offset ladder + exact arc guard)
- **Date:** 2026-09-27
- **Model:** Claude Sonnet 5
- **Built:** `lib/geo/walk/steps.ts`'s `walklinesXY` now offsets each run adaptively: a fixed ladder (owner-specified, not tuned) — 4, 3, 2, 1 m for a normal run; 2, 1.5, 1, 0.5 m for a walk-back strip — tried in order, keeping the FIRST rung whose run-local check (V2 self-crossing, V3 crossing between consecutive parts in the run, V4 fidelity against that rung, V6 silent-collapse against that rung) passes; the last rung is used, and left for the global validator to report, if none passes. The run-local check reuses `lib/geo/walk/validate.ts`'s own low-level helpers and tolerance constants (now exported: `dist`, `isZeroLength`, `segIntersection`, `selfCrosses`, `distToPolylineXY`, `TOL_M`, `FIDELITY_TOL_M`, `COLLAPSE_M`) rather than a second copy. `walk_meta.offset_m` is the offset actually used; a new `walk_meta.offset_base_m` (4 or 2) is the run's own ladder start, so reductions can be counted. The flat 9-vertex (`ARC_POINTS`) arc-vertex guard, which over-excluded a 1-point connector end by 8 genuine vertices, is replaced by exact per-end counts carried in `walk_meta.head_arc_points` / `tail_arc_points` (a uTurnArc splice → `ARC_POINTS − 1` = 8; a connector push/unshift → 1); `validate.ts`'s `nonArcRange` uses these directly. `PAVEMENT_OFFSET_M` / `WALK_BACK_INSET_M` unchanged. `scripts/verify-route-geom.ts` gained 3 new G1 cases (a 39 m/16-vertex turning-bulb arc; the Eden Grove/Filton Road out-and-back shape; the existing informative narrow-U re-run through the ladder) and, in G2, a per-prop reduced-offset table plus a named check of Northville's 3 places from the owner's 2026-09-27 review. No migration, no database write.
- **Acceptance:**
  - G1 (synthetic cases): **PASS**, all cases 0 issues, including the two hard new ones: `turning-bulb-39m-r6.5-16v-inside` (offset used 2 m, ladder base 4 m) and `out-and-back-eden-grove-filton-road` (out leg 4 m/base 4 m, back leg 2 m/base 2 m). Two cases stay INFORMATIVE by design, neither a failure: the original fixed-offset narrow-U (1 issue, V4 3.950 m) and the same shape through the ladder (offset used 1 m, 0 issues — the ladder clears it, reported informatively either way as instructed).
  - G2 (live, read-only, same admin-session mechanism as Session A): raw defect counts 0/0/0 and §2 fields identical to stored rows on all three props, unchanged from Session A — **PASS**. The V1–V6 validator is 0 issues on REF - Speedwell and TEST - dry run — **PASS** — but still 12 issues on Northville (V3 ×6, V4 ×6) — **FAIL**.
  - Reduced-offset table: REF - Speedwell 0 steps used a reduced offset. TEST - dry run 0 steps. Northville: 3 m used on 34 steps (e.g. `best` step 329, Gloucester Road North); 1 m used on 107 steps (e.g. `best` step 296, Gloucester Road North).
  - Northville's 3 named places (owner's review): **Gayner Road — PASS, 0 issues** (offset reduced to 3 m or 2 m on its tight stretches, depending on variant). **Eden Grove — FAIL.** **Filton Road — FAIL** (the same physical out-and-back location as Eden Grove, at `best` steps 305–307, mirrored `alt_1` 365–367 and `alt_4` 281–283).
  - G4: `npx tsc --noEmit` exit 0. `eslint` on `lib/geo/walk/steps.ts`, `validate.ts`, `types.ts`, `scripts/verify-route-geom.ts` exit 0.
- **Deviations from brief:** the turning-bulb G1 case uses radius 6.5 m, not exactly 6 m — a 39 m arc at 6 m radius is not achievable without exceeding a full turn (2·π·6 ≈ 37.7 m is already a full circle), confirmed by hand to self-cross at the seam regardless of offset (a centreline self-overlap, not an offset artefact); 6.5 m is the closest radius that keeps 39 m under one turn (343.8°) while genuinely needing the ladder (4 m and 3 m fail, 2 m is the first to pass). No V1–V6 check definition, tolerance, or expected value was changed — only the offset each check measures against, as instructed.
- **Not done / deferred — gate hit, stopped per this session's own instructions:** the remaining 12 Northville issues are all at the Filton Road / Eden Grove out-and-back. Traced by hand, read-only, no fix attempted: that location is reached via a `chain: -1` straight-line transfer (`tree.step_chain` shows Eden Grove as chain 46, a root chain, not a child of Filton Road's chain 45), not a shared-node road turn, so `lib/geo/walk/trim.ts`'s `findTurns` never registers a turn there and `walkBackStrips` never flags the return as a walk-back strip (`inStrip` stays 0; `head_arc_points`/`tail_arc_points` stay 0 for every step 300–310, which are all offset at the ladder's smallest rung, 1 m). Both the outbound and return walklines are offset on the SAME hand-side, never the opposite/inset side, so no ladder rung can stop them crossing — this is a turn/transfer classification gap in `trim.ts`/`traverse.ts`, outside this session's 4-file allowance (`steps.ts`, `validate.ts`, `types.ts`, `geometry.ts`). No change was made to those files, and no tolerance was loosened to hide this.
- **Follow-ups:** an owner decision is needed on whether to run a further session against `trim.ts`/`traverse.ts` to classify the Eden Grove/Filton Road dead-end as a proper turn (giving it a walk-back strip and an opposite-side offset, the same treatment every other dead end gets), and whether Gayner Road being clean is enough to re-save 2 of Northville's 3 places now or whether D1 ("re-save Northville's variants once G2 passes") waits for all 3.

---

### Robust walkline offset — Session A3 (ladder fallback keeps the base; pin the known case)
- **Date:** 2026-09-27
- **Model:** Claude (session run as specified: Sonnet 5, Extra)
- **Built:**
  - `offsetRunAdaptive` (`lib/geo/walk/steps.ts`): if no rung passes the run-local check, the run keeps its BASE offset (4 m, or 2 m for a walk-back strip), not the smallest rung. Owner decision. The ladder itself is unchanged.
  - It now also returns `ladderPassed`. `walk_meta` gains `offset_ladder_passed` and `offset_run` (`lib/geo/walk/types.ts`). Both are verification aids, stripped by `variantForStorage` with the rest of `walk_meta`.
  - `scripts/verify-route-geom.ts`: 2 new G1 cases (a self-crossing centreline must come back at base, flagged "no rung passed", for a normal run and a strip). G2's reduced-offset table is split into (a) reduced because a lower rung passed and (b) no rung passed, kept at base. G2 adds the longest reduced run per prop and prints the exact remaining issue set.
  - `lib/geo/walk/validate.ts`: not changed. No check definition, tolerance or expected value changed.
  - No migration. No database write.
- **Acceptance:**
  - G1: **PASS**. Every case passes, including both new fallback cases (4 m base kept, 2 m base kept, `ladderPassed` false). The 2 informative cases are unchanged.
  - G2 raw counts (gaps, crossing-next-step, self-crossing): 0/0/0 on all three props. **PASS**.
  - G2 §2 fields identical to stored rows on all three props. **PASS**.
  - G2 validator: REF - Speedwell 0, TEST - dry run 0. **PASS**. Northville 6 issues (was 12), all at Filton Road / Eden Grove. **FAIL, as expected** (pinned known issue).
  - (a) reduced because a lower rung passed: REF - Speedwell 0 steps. TEST - dry run 0 steps. Northville: 3 m on 34 steps in 6 runs, e.g. `best` steps 329–334 (Gloucester Road North, Gayner Road). No step uses 2 m or 1 m. The 107 steps at 1 m from A2 are gone.
  - (b) no rung passed, kept at base: REF - Speedwell 0. TEST - dry run 0. Northville 3 runs, all at 4 m: `best` steps 296–327 (Gloucester Road North, Filton Road, Eden Grove, transfer); `alt_1` steps 347–389 (Pine Grove, Gloucester Road North, transfer, Filton Road, Eden Grove, Gayner Road); `alt_4` steps 272–303 (Gloucester Road North, Filton Road, Eden Grove, transfer).
  - Longest reduced run: REF - Speedwell none. TEST - dry run none. Northville 297.06 m at 3 m, `best_reversed` steps 61–66 (Gayner Road, Gloucester Road North).
  - Remaining issue set (Northville): (alt_1, 365, V3, 10.97); (alt_1, 366, V4, 0.89); (alt_4, 281, V3, 10.97); (alt_4, 282, V4, 0.89); (best, 305, V3, 10.97); (best, 306, V4, 0.89). All inside A2's ranges (best 305–307, alt_1 365–367, alt_4 281–283).
  - Northville places: Gayner Road PASS, 0 issues. Filton Road and Eden Grove FAIL at the pinned steps only.
  - G4: `npx tsc --noEmit` exit 0. `npx eslint` on the 4 allowed files exit 0.
- **Deviations from brief:** none. The G2 check "every remaining issue is at Filton Road / Eden Grove (within 2 steps)" is a report, not an exception list. It does not filter or suppress any validator issue. The validator line still reports FAIL.
- **Not done:** the Filton Road / Eden Grove traversal gap is not fixed (out of scope by instruction). Not investigated: Northville `best_reversed` step 89 (work, Eden Grove) walkline is 13.87 m stored vs 3.12 m in memory; it has 0 validator issues. No re-save, no re-freeze, no browser check.
- **Follow-ups:** Traversal: chain -1 transfer at Filton Road / Eden Grove (Northville) not classified as a Turn; needs its own planned item.

---

### Robust walkline offset — Session B / complete (wiring, regression, writes refused)
- **Date:** 2026-09-27
- **Model:** Cursor Grok 4.7
- **Built:** Generate and Save run V1–V6. Save calls `console.warn` and does not block. The draw-page notice shows `Route geometry: n issues` after Generate, and the same sentence after "Saved n variants, m steps." `ensureRoute` compares `route_fp` (`steps:<min id>` or `steps:none`) with `min(route_steps.id)` when online, timeout `ROUTE_FINGERPRINT_TIMEOUT_MS` = 3,000. Offline, or on error or timeout, the cache is kept. No Dexie version bump. `appendWalk` skips every vertex within 0.1 m of the previous one. `scripts/route-geom-apply.ts` holds the allow-list and refuses anything else. It was run. It wrote nothing. Brief Stage 5b has the 2026-09-27 walkline-offset note. `geometry.ts`, `steps.ts`, `validate.ts`, `types.ts` and `scripts/verify-route-geom.ts` were not changed.
- **Acceptance:**
  - G3 r1: exit 0. Connectivity **PASS**, 39 variants, 0 gaps (was 162 FAIL). Determinism **PASS**, three identical runs: Speedwell `0084940477da` (was `aef2fe5c51dc`), redland `b41ccc4c7367` (was `4d6520425dd4`), Northville `01126864f213` (was `305b263ee800`). Turns **FAIL** (was PASS): 22 problems, first is redland best step 53, walkline 1.23 m from the furthest door. Walkline side **FAIL**: 2 / 92 / 44 (was 2 / 92 / 43). Numbers not edited.
  - G3 r2 on `RED - Speedwell`: exit 0. Save, freeze, knock refusal, snapshot mismatch and RLS **PASS**. redland visit_number **FAIL**: a new allocation got visit 2, not 3, because the two real rows are both visit 1. The test allocation was deleted. Number not edited. RED before: territory_routes 0, territory_route_steps 0, assignments 0. After: 6, 106, 0. redland assignments 2 before and 2 after.
  - G3 r3: exit 0. Every listed check PASS. Leftover R3 territories 0. Protected route_steps unchanged, including REF - Speedwell 51 → 51 and Northville 676 → 676.
  - G3 stage 5bb: exit 0. Northville old-engine assignment: 280 steps, route_length_m 20,047.64, stranded 39.
  - G3 ui4: exit 0. Read-only asserts, printed `OK`.
  - G1: **PASS**. `npm run verify:geom` exit 0.
  - G2 before any write: `npm run verify:geom -- --live` exit 1, as expected for the pinned set. REF - Speedwell: 0 issues, raw 0/0/0, §2 identical. TEST - dry run: 0 issues, raw 0/0/0, §2 identical. Northville: raw 0/0/0, §2 identical, 6 issues. Printed set matches the pinned set, item for item: (alt_1, 365, V3, 10.97), (alt_1, 366, V4, 0.89), (alt_4, 281, V3, 10.97), (alt_4, 282, V4, 0.89), (best, 305, V3, 10.97), (best, 306, V4, 0.89). No extras. No missing.
  - G5: **NOT WRITTEN**. `npx tsx scripts/route-geom-apply.ts` exit 1 before a session and before a write. Northville `3cdbb911-f148-4de7-848e-086b120190d8` key `best_reversed`, 0 knocks. `0de4d001-f004-412c-80f5-0c297bc02526` 49 knocks, key `best`. `0c32a933-6111-4db1-9402-841f8b3bb65b` 0 knocks, key `best`, not frozen. Row counts therefore unchanged: REF - Speedwell territory_routes 6, territory_route_steps 106. TEST - dry run 5 and 178. Northville 6 and 2,450. `route_steps` for `0de4d001`: count 17, min id 6422. For `0c32a933`: count 29, min id 6393.
  - G7 online fingerprint: **PASS** for the before-write half. CanvasserX on `/field`, REF - Speedwell visit 3, 182 doors. First open wrote `route_for:0de4d001-f004-412c-80f5-0c297bc02526` = `2026-09-27T16:43:40.979Z` and `route_fp` = `steps:6422`. Online reload sent only `route_steps?select=id&order=id.asc&limit=1`. `route_for` stayed the same. No full step fetch.
  - G7 offline reopen: **NOT VERIFIED**. `navigator.onLine` was false. Reloading `/field` produced `chrome-error://chromewebdata/`. The dev server document did not load.
  - G7 fingerprint-changes-after-re-freeze: **NOT VERIFIED**. No re-freeze, so min id did not change.
  - G6: **NOT VERIFIED**. The field map was open on visit 3. The Ventnor → Derwent corner was not zoomed to 19 and was not screenshotted. The stored walkline is still the pre-offset freeze.
  - Draw page: **NOT VERIFIED**. `/admin` stayed on "Loading the map…" and Draw stayed disabled, including after one reload and a 16 second wait. No `geom-` prop was created.
  - `npx tsc --noEmit` exit 0. eslint on the Session B files exit 0.
- **Deviations from brief:** G5 did not write, because the plan's Northville stop and the knock recount both fired. The r1 Turns failure and the 2 / 92 / 44 walkline-side count were reported and not edited. r2's visit_number expectation was not edited. A temporary local cookie helper and a temporary `/geom-session-check` route were used for the browser sign-in and then deleted. The localhost admin tab was left on the sign-in page.
- **Not done / deferred:** Re-save of REF - Speedwell, TEST - dry run and Northville. Re-freeze of the two allow-list assignments. G6 screenshot. Offline cache evidence. Draw-page notice screenshot. Phone check of the chevron guard. No commit.
- **Follow-ups:** Owner decision on whether to re-save the three territory sets while leaving `3cdbb911` and the 49-knock Speedwell assignment frozen, and re-freezing only `0c32a933`. Owner decision on the r1 Turns FAIL and the walkline-side count 2 / 92 / 44. Traversal item for the Filton Road / Eden Grove transfer remains separate.

---

### Route geometry — Session A4 (turn ends level with the furthest door) — gate hit, reverted
- **Date:** 2026-09-27
- **Model:** Claude Opus 5.5
- **Built:** nothing kept. One fix attempt in `lib/geo/walk/geometry.ts` / `steps.ts` was reverted by hand. The r1 md5s and the G2 pinned 6 are the same as Session B. No database write. No check changed.
- **Acceptance:**
  - Diagnose: **PASS**. There are 22 problems at 2 places. redland Lower Redland Mews: 18 at 1.23 m (3 per variant × 6). Northville Fourth Avenue: 4 at 5.74 m (alt_2 190/188, alt_3 99/97). Max 5.74 m, median 1.23 m.
    - redland best 53: free-end collapse, not capped.
    - redland best 54: the arc splice inherits step 53's end.
    - Northville alt_2 190: free-start collapse, capped at 2d.
    - The plan's prediction is confirmed.
  - Fix (attempt 1: level end on the last kept offset edge's line): **FAIL**, reverted.
    - Turns was not PASS: the Fourth Avenue problems cleared, but redland's run fell to 2 m, which gave "walk back comes within 0.00 m" ×6 and turned One-sided turns from PASS to FAIL.
    - The pinned set changed: 4 extra issues at Fourth Avenue (V4 0.47 m and V5, on alt_2 190 and alt_3 99).
  - Re-run after the revert:
    - r1 exit 0. Turns FAIL, 22 problems. Connectivity 0 gaps. Determinism `0084940477da` / `b41ccc4c7367` / `01126864f213`.
    - G2 exit 1: exactly the pinned 6.
    - tsc exit 0. eslint exit 0.
  - Walkline side, the one extra step: **NOT VERIFIED**.
- **Deviations from brief:** stopped at the gate after one attempt, not two. By hand: at redland step 52→53 (a 90° corner, with 2.83 m to the door), V4 on step 52 and r1's 0.5 m rule on step 53 both constrain the same shared vertex, and at 4 m they cannot both hold. Details are in `docs/CLAUDE-HANDOFF.md`.
- **Not done / deferred:** the Turns fix; the walkline-side one-step explanation; G2 reduced-offset comparison on a fix.
- **Follow-ups:** the owner must choose how a turn step shorter than the offset's inside intrusion is drawn: drop that run to 3 m, allow a gap, or accept it as a documented limit. Also whether Fourth Avenue's level end is worth its V4 0.47 m / V5 issue.

---

### Robust walkline offset — Session B2 (re-save and re-freeze the current assignments)
- **Date:** 2026-09-27
- **Model:** Cursor Grok 4.7
- **Built:** `scripts/route-geom-apply.ts` now re-saves REF - Speedwell, TEST - dry run and Northville, and re-freezes `c14aa0d1` (`best`) and `3cdbb911` (`best_reversed`). It does not re-freeze `0de4d001` or `0c32a933`. The Northville "unworked R2 freeze → stop" rule is removed. Knocks are recounted immediately before each freeze and must be 0, `closed_at` must be null, and the variant key is passed explicitly and must match. `scripts/verify-stage-5b-r2.ts` derives the redland visit from Stage 5c-a (1 + the highest `counts_for_rotation` visit). No change to `geometry.ts`, `steps.ts`, `validate.ts`, `types.ts` or `scripts/verify-route-geom.ts`. No migration.
- **Acceptance:**
  - Gates before any write: **PASS**. `npm run verify:geom` exit 0. `npm run verify:geom -- --live` exit 1 with only the pinned Northville 6, item for item, and 0 elsewhere. r1 exit 0. Connectivity 0 gaps. One-sided turns PASS. Walkline side 2 / 92 / 44. Turns: the 22 pinned problems, item for item. Lower Redland Mews, 18 at 1.23 m: best 53/54/53, best_reversed 369/370/369, alt_1 145/146/145, alt_2 90/91/90, alt_3 104/105/104, alt_4 14/15/14. Fourth Avenue, 4 at 5.74 m: alt_2 190 starts and 188 runs past, alt_3 99 starts and 97 runs past.
  - G7 before the write: **PASS**. CanvasserX, `c14aa0d1`. `route_for` `2026-09-27T18:20:01.568Z`, `route_fp` `steps:6439` (database min id 6439, 29 steps). Reload sent only the min-id query.
  - G5: **PASS**. Apply script exit 0. Before → after territory rows: REF - Speedwell 6/106 → 6/106, TEST - dry run 5/178 → 5/178, Northville 6/2450 → 6/2450. `c14aa0d1` route_steps 29, min id 6439 → 6949. `3cdbb911` 396, min id 6468 → 6978. Stored issues: Speedwell 0, TEST - dry run 0, Northville the pinned 6 with none missing and none extra. Frozen lines match `best` and `best_reversed` at 0 m. `0de4d001` still 49 knocks, closed, min id 6422. `0c32a933` still 0 knocks, closed, min id 6393.
  - G7 after the write: **PASS**. `route_fp` `steps:6949`, `route_for` `2026-09-27T18:22:07.614Z`, full `route_steps` select after the min-id query. `fetched` true.
  - r2 on `RED - Speedwell`: exit 0. Every check **PASS**, including visit 2 from the 5c-a rule. Test allocation deleted. Protected route_steps unchanged (Northville 676 → 676).
  - r3: exit 0. Every check **PASS**. Leftover territories 0. REF - Speedwell route_steps 51 → 51. Northville 676 → 676.
  - stage 5bb: exit 0. 280 steps, route_length_m 20,047.64, stranded 39.
  - ui4: exit 0. Printed `OK`.
- **Deviations from brief:** `/field` was not opened for `c14aa0d1`, because London today is 27 Sept and the assignment is 28 Sept. A temporary page called `ensureRoute` and was deleted. r2 used `--prop="RED - Speedwell"`. The apply script no longer fails a re-freeze whose step count changes; this run's counts did not change.
- **Not done / deferred:** G6 screenshot. Draw-page loading check. Offline reopen on a phone. No commit.
- **Follow-ups:** the 22 turn-end problems are accepted and belong to the route-planner edge-cases item. The Filton Road / Eden Grove traversal item is unchanged.

---

### UI item 1 — Logger rebuild, Session A (team logic and claims removal)
- **Date:** 2026-09-28
- **Model:** Claude Sonnet 5, Extra
- **Built:** Claims, Take and reserve are removed from the Realtime team layer (reversing the 2026-09-26 Stage 10 deviation). `lib/field/door-signals.ts` is rewritten around a `knocked`/`unknocked`/`here` union: `applyPerson` folds knocks and bumps `lastHeardAt` on any signal; `parseDoorSignal` rejects `claim`/`release`; new `teammateKnocks` (B1, latest-wins per door, excludes self) and a rewritten `teammateRows`/`formatTeammateLine` (C1: `"Tom · last knocked #80"`, or `"#12"` with no plate, or `"Tom · last heard 2 min"` when stale — stale takes priority over door info; `"Tom · no door yet"` otherwise). `heardLabel` drops "ago" to match the Figma wording. `lib/field/use-team.ts` is rewritten: no more `claimDoor`/`releaseDoor`/`sheetUprn`/`nextDoor`/`blockedUprns`; a `here` heartbeat fires on `SUBSCRIBED` and every 15 s (`HEARTBEAT_INTERVAL_MS`), stale after 45 s (`HEARTBEAT_STALE_MS`); `TeamApi` is now `{ connection, teammates, knockedUprns, knockedBy, markKnocked }`; undo broadcasts `unknocked` (P2). `lib/field/cursor.ts`'s `nextOpenIndex` gained a `fromIndex` and now wraps (A1): first open door after `fromIndex`, else the lowest open door, else -1. The field-data provider's `progressPosition` now follows `cursor.door?.position` instead of a claimed next door, and no longer passes `sequence` into `useTeam`. `lib/field/local-outcomes.ts`'s `LocalOutcome` gained `canvasserId` from the outbox row's own column. New `lib/field/today-stats.ts`: `countBookableContacts` (owner definition 2026-09-28 — `outcome = 'answered'` ONLY, explicitly not the outcome-mapping skill's admin "answered" rule, which is untouched), `countLeads`, `countDoorsLogged`, all own-canvasser-only and Europe/London-today via `isSameLondonDay`. `lib/field/route-display.ts` gained `fieldHeaderParts` (the shared pieces) and `formatLoggerAreaLine` (owner's short Area line, "Visit {n} · {hand} · {doors}"); `formatFieldHeader` now builds from the same parts, unchanged output. `lib/field/outcomes.ts`'s `PRIMARY_OUTCOMES` is reordered top-down Lead/Contact/Rented-Council/Not-In (owner decision 1) at a flat 72px (P9), and "No Answer" is relabelled "Not In" everywhere (P10). `components/field/outcome-buttons.tsx` renders the new order directly (no more `.reverse()`). `components/field/next-door-card.tsx` is deleted. `components/field/map-tab.tsx` and the interim `components/field/logger-tab.tsx` drop every claim/release/Take call and the "Next door" card; the Map legend now reads its labels from `outcomeSpec`. Both are interim compositions — Session C's Figma rebuild replaces the whole screen. One unrelated, pre-existing `tsc` error (`scripts/route-geom-apply.ts`, a disjoint-literal-union comparison from the "Robust walkline offset" work, confirmed present on a clean checkout before this session) was fixed with the owner's live sign-off, by widening the comparison to `string` — no behaviour change.
- **Acceptance:**
  - `npx tsc --noEmit`: **PASS**, exit 0 (after the one out-of-scope fix above, owner-approved).
  - `npx eslint components/field lib/field "app/(field)" scripts/verify-stage-10.ts scripts/verify-stage-8b.ts scripts/route-geom-apply.ts`: **PASS**, exit 0.
  - `npm run verify:stage10`: **PASS**, exit 0, "OK". Old-vs-new: kept the trio/solo/empty-line/names/one-shared-door pure checks and the live allocation/snapshot/name-read/outsider/route-position/three-subscribed/outsider-not-subscribed/public-join/two-knock/`v_latest_knock`/shared-flag checks; replaced the two claim-next-door checks with A1 (skip, wrap, -1, skip-a-server-knock); replaced the ladder/`on #16` checks with C1 `#80`/`#12`; replaced the two stale-claim checks with heartbeat 44 s (not stale) / 46 s (stale) / "last heard 1 min"; replaced "three different next doors" with a live section proving knocked-within-5s, A1 skip (lands on index 2), B1 ("Ada"), C1 (`"Ada · last knocked #1"`), undo→`unknocked`→reopen, heartbeats arriving, and a stopped actor going stale (computed from its own real captured timestamp, not a wall-clock wait); removed the claim-TTL checks, "back out does not reserve again", and the 3-minute wall-clock block; added `parseDoorSignal` claim/release rejection, the `here` payload's exact 3 keys, and a raw claim/release-received counter (0/0) across every channel opened during the run. Fixtures renamed Ben → Tom.
  - `npm run verify:stage8b`: **PASS**, exit 0. Updated: "No Answer" → "no_answer" mapping check reads "Not In"; order check reads `lead answered no_opportunity no_answer` top-down with a separate flat-72px check; added a "Not In" wording-consistency check; new section F fabricates one `LocalOutcome` per each of the 8 outcomes with a button (`not_interested` excluded, confirmed 8) and asserts `countBookableContacts` = 1, `countLeads` = 1, `countDoorsLogged` = 8, and that a different canvasser's rows on the same map count 0.
  - `npm run verify:ui4`: **PASS**, exit 0, "OK" — unaffected, confirming the route-progress refactor (`fieldHeaderParts`) changed nothing it depends on.
  - `git grep -n --untracked -E '"claim"|"release"|claimDoor|releaseDoor|reserveDecision|NextDoorCard' -- components lib app`: **PASS**, 0 lines (exit 1).
  - `git diff --quiet -- lib/sync/queue.ts`: **PASS**, exit 0 — untouched.
  - Stats unit check (one knock of each of the 8 outcomes): **PASS** — Contacts 1, Leads 1, Doors 8 (run inside `verify:stage8b` section F above).
  - Cleanup: **PASS**. After the run, `select count(*) from auth.users where email like 'stage10-%' or email like 'stage8b-%'` = 0; joined `auth.sessions` for those users = 0; `profiles` matching the harness names = 0; `territories` named `STAGE 10%`/`STAGE 8B%` = 0.
- **Deviations from brief:** the one unrelated `tsc` fix in `scripts/route-geom-apply.ts` above (owner asked, chose to fix rather than leave NOT MET). `useTeam`'s `sequence` parameter is dropped — nothing left inside it needs the sequence once claims are gone. `formatTeammateLine`'s stale branch takes priority over door info (not spelled out letter-for-letter in the plan's four C1 examples; Session C should re-check this reading against the Figma "TeamStrip" states when it builds that component). `verify-stage-10.ts`'s `--fast` flag is removed — nothing in the rewritten script has a long wait left to skip.
- **Not done / deferred:** everything visual — tokens, Sora, icons, DoorScroll, the pills, Other's hold-slide gesture, the 12 states, the height ladder — is Session B/C's. B1 (grey + tag) is not wired into `FieldMap` itself; `field-map.tsx` is outside this session's file list. On-device checks were not run.
- **Follow-ups:** Session B/C should confirm the C1 "stale beats door info" reading against Figma. The admin-Contacts label reconciliation (flagged in the Contacts owner decision) is still open for the admin rebuild.

---

### UI item 1 — Logger rebuild, Session B1 (tokens, Sora, icons, primitives)
- **Date:** 2026-09-28
- **Model:** Claude Sonnet 5 (Cursor)
- **Built:** The b-tokens-font and b-primitives slice of the Session B todos only — OutcomeButton, OtherButton, OtherMenu and DoorScroll are explicitly out of scope for this session (B2) and were not touched. Nothing was wired into `logger-tab.tsx` (Session C).
  - **Tokens** (`app/globals.css` `@theme`): added `field-bg`, `surface`, `line`, `ink-muted`, `ink-faint`, `outcome-lead` (fill) / `outcome-lead-ink`, `outcome-contact`, `outcome-rented` / `outcome-rented-edge` / `outcome-rented-ink`, `outcome-notin`, `outcome-on-pill`, `warn-bg`, `error-bg`, `scrim`; `radius-field-sm/md/lg`; `spacing-tap-min` (44) / `spacing-outcome` (84); the `field/*` text styles (eyebrow, title, body, body-strong, door-current, door-neighbour, stat-number, stat-label, button-label, tab-label) as `--text-field-*` plus `--line-height`/`--letter-spacing`/`--font-weight` companions (confirmed this Tailwind v4 companion syntax against the official theme docs before using it); `drop-shadow-field-pill`, `shadow-field-knob/menu/toast`. Existing admin tokens (ink, ink-soft, paper, prop, lead, oxide, worksheet, ochre, prop-soft) are untouched — same names, same values.
  - **Sora** (decision 9 / P1, including the data font): `Sora({variable:"--font-sora"})` is instantiated only in `app/(field)/layout.tsx` and applied to `<main>`, so `--font-sora` exists nowhere outside that DOM subtree. `@theme inline { --font-field: var(--font-sora), ui-sans-serif, system-ui, sans-serif; }` plus a `.field-root { --font-display/--font-body/--font-data: var(--font-field); }` rule re-points all three admin font roles to Sora, but only inside `.field-root`. `<main>` also switched from `bg-worksheet` to the new `bg-field-bg` token.
  - **Icons** (amendment 3), `components/field/icons.tsx`: `MapIcon`, `LoggerIcon`, `LeadsIcon`, `YouIcon`, `NoteIcon`, `CaretIcon` — inline `currentColor` SVGs, paths fetched once from `get_design_context` asset URLs into `%TEMP%\ui1-icons\`, copied in with `stroke`/`fill` rewritten to `currentColor`, temp folder deleted. `StatusDot` is a plain drawn circle (not downloaded — the 4 exported sync-state dots were indistinguishable but for fill colour). House, HouseOutline, Chevron, Star, Speech (DoorScroll/OtherMenu icons) are deliberately not added yet — out of scope, avoids unused exports.
  - **Primitives**, `components/field/ui/*`: `stat-row.tsx` (null → "—", zero-padded, 36px min width), `id-chip.tsx` (44px hit area, sync dot reuses `outcome-lead`/`outcome-rented-ink`/`ink-faint`/`oxide` rather than new `--color-sync-*` tokens), `note-bar.tsx` (56px row, rotating caret), `button.tsx` (primary/lead/secondary/chip, `lead` fills `outcome-lead-ink` per P14, `min-h-11` floor on every kind), `status-banner.tsx` (`glyph: ReactNode`, one component for all 4 kinds), `team-strip.tsx` (deliberately takes pre-formatted `{id, initial, label, stale}` rows, NOT `TeammateRow`/`labelFor` as the plan's prop sketch suggested — Figma's own primitive takes plain strings too, and binding to `formatTeammateLine`/ticking is data-flow wiring that this session's scope reserves for Session C). `components/field/tab-bar.tsx` (TabItem) and `components/field/undo-toast.tsx` (UndoToast) were restyled in place per the plan's file mapping, logic unchanged. "Profile" tab label is now "You" (decision 5); the route is unchanged.
- **Contrast:** the owner supplied the final table for this session (below); it superseded the plan's P16 figure where the two differed. Additional pairs used and not in that table were computed once with a short `node -e` WCAG script (shown inline, not a checked-in file).

  | Text / background | Ratio | Note |
  |---|---|---|
  | ink `#1c2226` on field-bg `#f4f5f7` | 14.74 | prop name, current door, stat numbers |
  | ink-soft `#4a5259` on field-bg | 7.29 | street row, Area line, teammate lines |
  | ink-soft `#4a5259` on white | 7.95 | TeamStrip lines, Not In label |
  | outcome-lead-ink `#185a30` on white (NEW) | 8.25 | Lead label/icon |
  | prop `#1b4aa6` on white | 8.15 | Contact label |
  | outcome-rented-ink `#7a4507` on white | 7.83 | changed from `#8a4e08` (6.62) |
  | outcome-rented-ink `#7a4507` on `#f9f2e6` | 7.04 | rented pill |
  | oxide `#7a2b33` on error-bg `#f8e9ea` | 8.03 | Sync failed banner |
  | ink on warn-bg `#fdf3e3` | 14.63 | supplied for the record; StatusBanner's own Offline text uses rented-ink, not ink (see below) |
  | white `#ffffff` on ink `#1c2226` (toast) | 16.08 | UndoToast title — see deviation below |
  | ink-muted `#6a7078` on field-bg | 4.58 | eyebrows/secondary only, never must-read |
  | paper `#fbfaf8` on ink `#1c2226` | 15.41 *(computed)* | StatusBanner instruction text, Button primary/lead label |
  | paper `#fbfaf8` on outcome-lead-ink `#185a30` | 7.91 *(computed, P14)* | Button `lead` kind label |
  | paper/75 on ink `#1c2226` | 9.20 *(computed, P15)* | UndoToast countdown line |
  | ink-muted `#6a7078` on surface `#ffffff` | 5.00 *(computed)* | IdChip username, NoteBar label — secondary, repeated elsewhere |
  | ink on line `#e7e9ee` | 13.24 *(computed)* | TeamStrip avatar initials |
  | outcome-rented-ink `#7a4507` on warn-bg `#fdf3e3` | 7.12 *(computed)* | StatusBanner Offline text |

  All must-read pairs clear 7:1. "The Not In label, street name and teammate lines use ink-soft, not ink-muted" is followed (TeamStrip is ink-soft; IdChip/NoteBar labels are ink-muted because they are secondary and repeated elsewhere per the plan's own contrast section).
- **Deviations from plan or brief:**
  - **rented-ink value:** the plan's amendment 2 (P16) computed `#7b4507` (7.79:1 on white, 7.09:1 on warn-bg). The owner's table for this session gives `#7a4507` (7.83:1 on white, 7.04:1 on the rented pill). Both clear 7:1 everywhere the token is used; `#7a4507` was used, per this session's explicit instruction to use the supplied table and not iterate.
  - **UndoToast title colour:** the raw Figma `get_design_context` code for UndoToast referenced the existing `paper` token (`#fbfaf8`, 15.41:1 on ink) for the title line. This session's contrast table gives "white on ink (toast) = 16.08", which only matches `#ffffff` (the new `surface` token), not `paper`. Used `surface` for the toast title only (the row is explicitly labelled "(toast)"); left every other "paper on ink" use (StatusBanner instruction, Button primary/lead) on `paper`, since the table did not single those out.
  - **TeamStrip props:** built as `{ rows: {id, initial, label, stale}[] }` rather than the plan's sketched `{ rows: TeammateRow[], labelFor }`, for the reason given above (kept the primitive presentational; Session C composes it from `formatTeammateLine`).
  - **`get_variable_defs` on node `5:2`:** the one call in budget returned "You currently have nothing selected. You need to select a layer first" (this Figma MCP integration needs an active desktop selection, not just a node ID). Not retried, per the fixed budget. Token values instead came from the plan's own Session-A-time Figma read (already in the plan text) plus the owner's contrast table above.
  - `<main>`'s background class changed from `bg-worksheet` to `bg-field-bg` — a deliberate use of the new field-bg token on the field root itself, not left as the interim admin-toned placeholder.
- **Invariants:** no GPS, no coordinates, no quality signals — none of this session's files touch data or writes at all (pure tokens/visual primitives). `lib/sync/queue.ts` not opened. British English throughout ("Not In", "Rented / Council" wording untouched from Session A).
- **Verified:**
  - `npx tsc --noEmit`: exit 0.
  - `npx eslint components/field lib/field "app/(field)"`: exit 0.
  - `git grep -n -E '#[0-9a-fA-F]{3,8}\b' -- components/field/ui`: 0 lines (exit 1). Re-checked with `--untracked` too, since `components/field/ui/` is a brand-new untracked directory and the plain command would have passed trivially even with hex inside it — still 0 lines with `--untracked`.
  - `git grep -n -i sora -- "app/(admin)" components/admin`: 0 lines (exit 1), confirmed with `--untracked` too.
  - `npm run verify:stage8b`: exit 0, "ALL CHECKS PASSED" (re-run at the end, unaffected by this session).
  - `npm run verify:ui4`: exit 0, "OK" (re-run at the end, unaffected).
  - Browser: the throwaway page `app/ui1-b1-check/page.tsx` (outside `app/(field)`, so no Supabase auth dependency) rendered all 8 primitives plus the raw icon set at a 390px CSS visual viewport (confirmed via CDP `Page.getLayoutMetrics`, `cssVisualViewport.clientWidth` ≈ 390.6). 3 screenshots taken (top half, scrolled-down Button/NoteBar section, and a repeat of the same scroll position after a failed further scroll). Device metrics override cleared afterwards. The page and the `%TEMP%\ui1-icons\` folder were deleted before finishing; `git status --short` after cleanup shows only this session's real files plus Session A's carry-over, no `ui1-b1-check` anywhere.
- **Not verified:** pixel-fidelity screenshots against the actual Figma render (that is Session C's acceptance item, not this session's). On-device sun/wet-thumb/haptic checks (field-ergonomics skill) — no phone used; this session is presentational primitives, not the assembled Logger, so most of that skill's checklist does not yet apply (no live interaction flow exists to test one-handed). `get_variable_defs` on `5:2` — tool error, see deviation above.
- **External settings:** none.
- **Open questions for Claude:** whether the owner intends the `#7a4507` vs `#7b4507` rented-ink difference as a deliberate final correction (in which case Session C and any later token doc should standardise on `#7a4507`) or a rounding slip in this session's brief; whether "ink on warn-bg 14.63" in the owner's table is meant for a StatusBanner use this session didn't have a slot for, or for a different, not-yet-built element.

### UI item 1 — Logger rebuild, Session B2 (DoorScroll, OutcomeButton, OtherButton/OtherMenu)
- **Date:** 2026-09-29
- **Model:** Claude Opus 5.5 (Cursor)
- **Built:** Only `b-doorscroll` (DoorScroll) and `b-outcomes-other` (OutcomeButton, OtherButton, OtherMenu, the confirm slide). Nothing wired into `logger-tab.tsx`. The compact MiniMap and amendment 6's map timing are Session C and were not touched. B1 tokens/primitives reused, not changed (one additive exception: 5 icons appended to `icons.tsx`, see Deviations).
  - **Pure logic, testable without a browser:**
    - New `lib/field/other-gesture.ts`: `otherGesture(state, event) → { state, effects }`. States idle / pressing / hold / tap. Hold at 350 ms, >12 px movement first cancels, release on an option commits, release anywhere else does not. pointercancel, lostpointercapture, hidden, blur, Esc and disabled close with no write. In tap mode the lostpointercapture that follows the opening pointerup is ignored. The option list `OTHER_MENU_OPTIONS` is the flat `OTHER_OUTCOMES` key list.
    - New `lib/field/door-window.ts`: `windowIndices` (±8, clamped, never wraps), `stepIndex`, `atStart`/`atEnd`, `trackMetrics` (slot = round(0.4 × viewport)), `scrollLeftFor`, `indexAt`, `settle` (changed only when the resting door differs from the index), `scrollBehaviourFor` (≤3 smooth, else instant), `distanceFromCentre`, the plate ladder `plateSize`/`PLATE_PX` (112/40, 80/28, 64/24, 48/20), `scrollPlate` ("—" → `#position+1`).
  - **Components:**
    - New `components/field/ui/door-scroll.tsx` (Figma 7:18): `{ doors: DoorScrollItem[], index, street, onSettle, onAddHouseNumber? }`. A native `snap-x snap-mandatory` scroller over an N×slot track, ±8 absolutely positioned items. A rAF paints scale and fade. Settle happens on `scrollend`, with a 120 ms debounce only where `scrollend` is missing. Pulse 10 ms on a settle or step. ‹ › are 44×44 buttons with `aria-disabled` at the ends; the arrow keys step one door; items are `aria-hidden`; a polite live region reads "Door 76, Heath Hill Avenue, 24 of 182, knocked by Tom". The teammate tag and a teammate-knocked plate are ink-soft.
    - New `components/field/ui/outcome-pill.tsx` (Figma 6:58): `{ outcome, onPress, confirmKey, disabled? }`. A 140 px pill with the 84 px circle and a trailing chevron. The confirm slide (+24 px and back, 180 ms, ease-out, Web Animations API) runs when `confirmKey` changes and is skipped under `prefers-reduced-motion`. Input lock via `useInputLock`. No haptic of its own: the Logger's existing `pulse(40)` after the write is the haptic.
    - New `components/field/ui/other-button.tsx` (Figma 7:8 + 7:9): `{ onPick, disabled?, onOpenChange? }`. A 60 px round button with `aria-haspopup="menu"`, `touch-none`, `select-none`, `-webkit-touch-callout:none` and `contextmenu` preventDefault. It only feeds pointer, key and window events into `otherGesture` and runs the effects: capture, the 350 ms timer, pulses of 15 ms (hold opens) and 8 ms (highlight changes), row focus, and commit through `useInputLock` followed by the same slide. The menu is 220 px wide with 48 px rows; the highlighted row is ink with surface text. Tap mode adds a transparent fixed scrim.
    - `components/field/icons.tsx`: `StarIcon`, `SpeechIcon`, `HouseIcon`, `HouseOutlineIcon`, `ChevronIcon` added, exported once from 6:58's asset URLs to `%TEMP%\ui1-icons\` (deleted after). Root width, height and viewBox are kept, with `stroke="currentColor"`.
  - New `scripts/verify-ui-1-logger.ts`, and `package.json` gains `verify:ui1`.
- **Door-scroll approach (time-boxed):**
  - First browser run of the plan's scroll-snap design at 2,000 doors:
    - ‹ took 198 ms and › took 193 ms, both landing exactly.
    - Nodes: 9 at door 0, 17 at door 1,000.
    - FAIL on jumps: +500 from door 0 landed on 492, and the jump to the end landed on 1991. Cause: snap only lands on doors that are rendered.
  - **Fix attempt 1 of 2 (PASS):** an instant external jump sets `scroll-snap-type: none`, renders the target window, scrolls there, then restores snap in the next rAF. Re-run:
    - ‹ 192 ms, › 205 ms.
    - +500 → 500 in 16 ms; → 1,000 in 14 ms; → 1,999 in 14 ms. All exact (`scrollLeft/slot` = 500.000), with 0 `onSettle` calls from the jumps.
    - Nodes 9 / 17 / 9 at doors 0 / 1,000 / 1,999; 29 DOM elements in the scroller in total.
    - `aria-disabled` is correct at both ends.
    - An off-centre scroll to 1995.3 snaps to exactly 1995 (1995.003), with exactly 1 settle.
    - Idle 1.5 s: index, scroll and settle count unchanged.
  - Fix attempt 2 and the pointer-carousel fallback were not needed.
  - **Known limit (not fixed):** a single scroll travels at most about 8 doors. A smooth scroll aimed 30.4 doors back landed on exactly one door, but only 8 back (1987), because snap picks from the rendered doors. It lands cleanly and never skips. Not tuned further, per the session rule. Raised as an open question.
- **Acceptance (this session's gate):**
  - `npx tsc --noEmit`: exit 0 (after each todo and at the end). **PASS**
  - `npx eslint components/field lib/field "app/(field)" scripts/verify-ui-1-logger.ts`: exit 0. **PASS**
  - `npm run verify:ui1`: exit 0, 36 checks, all PASS, "OK". **PASS**
    - Gesture checks:
      - hold → slide → release gives exactly 1 log, for each of the 4 options;
      - holding past 350 ms still gives 1;
      - release off after sweeping every option gives 0, and off after each single option gives 0 (×4);
      - hold with no slide gives 0;
      - a 349 ms tap opens tap mode with 0 logs;
      - lostpointercapture after a tap keeps tap mode open;
      - in tap mode: a pick gives 1, an outside tap gives 0, Esc gives 0;
      - moving >12 px before the hold gives 0; an early timer gives 0;
      - pointercancel or lostpointercapture at 6 points (12 cases) gives 0 logs, even with a stray release after;
      - hidden, blur, Esc or disabled while holding gives 0;
      - another pointer's cancel is ignored;
      - "Do not call again" is top level (4 flat options, no children), and one slide commits `do_not_call`.
    - Windowing checks:
      - total 2,000: 9 rendered at index 0 (0..8), 17 at 1,000 (992..1008), 9 at 1,999 (1991..1999);
      - every index 0..1999 renders at most 17, never outside the range;
      - total 1 and total 0 handled;
      - no wrap at either end; ‹ › step exactly one at every index;
      - resting at door i settles to i (4 widths × 2,000); drift under half a slot settles back;
      - an external jump to 1,500 causes no `onSettle`; a 3-door user move does report the change;
      - `door-scroll.tsx` has no `setInterval` and exactly 2 `onSettle` call sites;
      - smooth up to 3 doors, instant from 4 (500 is instant);
      - slot 156 at 390 px, with the last door centred at maximum scroll;
      - plate ladder and "#24" placeholder correct.
  - `git grep -n --untracked -E '#[0-9a-fA-F]{3,8}\b'` over `door-scroll.tsx`, `outcome-pill.tsx`, `other-button.tsx`, `other-gesture.ts`, `door-window.ts`: 0 lines; `icons.tsx`: 0 lines. **PASS**
  - 2,000-door browser result: as above, scroll-snap kept after fix attempt 1. **PASS** (with the known limit above)
  - Touch-emulation pass (one, CDP `Emulation.setTouchEmulationEnabled` at 390×844, DPR 3). **PASS**
    - How: `PointerEvent`s with `pointerType:"touch"` were dispatched by script, because CDP `Input.*` is denied. This is synthetic input, not trusted touch.
    - `maxTouchPoints=5`, `touch-action=none`.
    - Hold 420 ms: gesture=hold, menu open. Slide onto `do_not_call`: highlighted. Release there: logs +1 (`do_not_call`), 1 slide animation.
    - Hold, slide over all 4 options, release off the menu: +0.
    - Tap 120 ms: gesture=tap, menu open, focus on `refused`, +0. Outside tap: closed, +0.
    - Hold, onto `refused`, pointercancel, then a stray pointerup there: +0.
    - pointercancel at 150 ms: +0.
    - Lead pill tap: +1, circle slide animation 1. A second tap inside the 400 ms lock: still +1.
    - Final probe log: `["do_not_call","lead"]`.
  - `npm run verify:stage8b`: exit 0, "ALL CHECKS PASSED" (run once, at the end). **PASS**
  - `npm run verify:ui4`: exit 0, "OK" (run once, at the end). **PASS**
  - Temporary page `app/ui1-b2-check/page.tsx` deleted; `Test-Path` returns False, and `git status --short` shows no `ui1-b2-check`. **PASS**
- **Budget used:**
  - Figma: `get_design_context` once each on 6:58, 7:8, 7:9, 7:18. No errors, no retries, no `get_variable_defs`.
  - Browser: 1 screenshot (hold menu open), 1 touch-emulation pass, and 1 dev-server start (stopped at the end).
  - Door-scroll fix attempts: 1 of 2.
- **Deviations from plan or brief:**
  - **`icons.tsx`:** 5 icons appended, and the header paragraph that said they were "not added here" was replaced. This is a B1 file; the change is additive only, and B1's log deferred these icons to B2.
  - **Lead label/icon:** use `outcome-lead-ink` (8.25:1), not Figma's `lead` (6.5:1 on white, below 7:1). The circle border stays `lead`.
  - **Rented label:** keeps the single-source `outcomes.ts` label "Rented/Council", with a zero-width break after the slash so it wraps in the 70 px circle as in Figma. Figma's text is "Rented / Council".
  - **Haptic:** Figma's 6:58 description says 30 ms. The plan's "existing 40 ms pulse" was kept, and it stays in the Logger's log path. The components add only the plan's 15, 8 and 10 ms pulses.
  - **OutcomeColumn (frame 8:44):** not built; it is not in this session's list. Session C composes the column.
  - **OtherMenu anchor:** to the left of the button, top-aligned (`right-full top-0`). Figma 9:148 (the anchored state) was outside the Figma budget and not read.
  - **Neighbour fade:** done with scale plus opacity (down to 0.35) over one text node per door, rather than a separate ink-faint 70% text style.
  - **Extra optional props:** `OtherButton.onOpenChange` (so Session C can make the pills and scroller `inert`) and `DoorScroll.onAddHouseNumber` (the "+ Add house number" affordance is a button only when this is passed).
  - **Tap-mode Enter:** handled by the row's native click. The menu's keydown forwards only the arrow keys, so Enter cannot commit twice.
- **Invariants:** no GPS or coordinates; no quality signals (the teammate tag is live knock sharing, B1). No write path: the components emit `onPick`/`onPress`/`onSettle` only. `lib/sync/queue.ts` was not opened. No migration, no database change, no new dependency, no commit.
- **Not done / deferred:** wiring into `logger-tab.tsx`, OutcomeColumn, MiniMap/compact FieldMap, `inert` handling, Figma side-by-side fidelity (all Session C).
- **Not verified:**
  - Trusted touch input: the touch pass used script-dispatched pointer events, so real `setPointerCapture` routing and a real momentum fling were not exercised.
  - iOS Safari (no `scrollend`, so the 120 ms debounce path is untested) and Android Chrome on a device.
  - The `prefers-reduced-motion` skip.
  - Keyboard arrow and Esc navigation in a browser (unit-tested only).
  - visibilitychange and blur in a browser (unit-tested only).
  - The live region as read by a screen reader.
  - Sun, wet-thumb and haptic on a phone.
- **Follow-ups:** decide whether the ~8-door-per-scroll limit is acceptable (see the open question in CLAUDE-HANDOFF).

---

### UI item 1 — Logger rebuild, Session C (assembly, states, map, verification, docs)
- **Date:** 2026-09-29
- **Model:** Claude Sonnet 5
- **Built:** `logger-tab.tsx` rebuilt as the full composer from the Session A/B pieces. New `components/field/mini-map.tsx` (Figma 8:14): wraps the SAME `FieldMap` the Map tab uses, `variant="compact"` — no Navigation/Scale control, not interactive, `jumpTo` (never `easeTo`) to the current door at a new `COMPACT_ZOOM` (17.5), a prop-blue halo on the existing `selected` feature-state, and a transparent tap button (z-index below MapLibre's own `.maplibregl-ctrl-*` corners so the attribution stays clickable) that opens the Map tab. `field-map.tsx` gained the `variant` prop and a `dataset.cameraJumps` counter, incremented only on a compact jump. New `components/field/outcome-column.tsx` (frame 8:44): the 4 `OutcomePill`s (Lead, Contact, Rented/Council, Not In, top to bottom — confirmed against the Figma Default screenshot) then `OtherButton` last, built from the Session B2 primitives only. The composer's banner slot (`computeBanner`) implements P3's priority — Failed > Instruction > Offline/Pending > Info — reusing `SyncStatus`'s `formatSyncLine`/`rowLabel` (both now exported) for the Failed/Offline text and `sharedKnockMessage` (via a newly-exported `useSharedDoors` hook) for the Info banner, with a per-count "OK" dismiss. `IdChip`'s sync dot derives from the same `useSyncStatus()`. The Area line uses Session A's `formatLoggerAreaLine`. Today's stats use Session A's `today-stats.ts` helpers, "Confirmed" always "—". An "Already logged" pill (Figma 13:793) sits under the street row when the current door has a local outcome. `allDone` (nextOpenIndex returns −1 from the team's own knocked set) swaps the pills for an "Open Map" button and a short message — Figma's "End of prop" state was not screenshotted (budget) so this reading is textual only. `DoorScroll` and `MiniMap` are wrapped in `React.memo`; every prop the composer passes them is a `useMemo`/`useCallback` with dependencies that do not include the 1 s team tick, confirmed empirically (see Verified). `lib/field/map-style.ts`'s header comment is corrected: the Logger now mounts its own (compact) MapLibre instance — the real invariant is ONE INSTANCE AT A TIME, not one instance in the whole app.
  - **Two bugs found and fixed during assembly, not part of any todo:**
    1. **Sora was never actually applying anywhere in `/field`, since Session B1.** `app/globals.css`'s `@theme inline { --font-field: var(--font-sora), ...; }` never emitted a real `:root` custom property — confirmed live, `getComputedStyle(main).getPropertyValue('--font-field')` was `""`, and every field screen was rendering in Instrument Sans (admin's body font), not Sora. `inline` bakes a build-time-constant value into generated utilities; `var(--font-sora)` is a runtime-only value (next/font), so there was nothing to bake. Fixed by dropping the `--font-field` indirection: `.field-root` now sets `--font-display`/`--font-body`/`--font-data` directly to `var(--font-sora), ui-sans-serif, system-ui, sans-serif`, a plain unlayered rule with a `var()` reference resolved at `<main>`, where `--font-sora` is actually set. Verified live (see below).
    2. **`DoorScroll`'s current-door digits clipped to an ellipsis once assembled next to `OutcomeColumn`.** Reserving the pill's full 140px width in the flex row (matching Figma's own "clipped at the screen edge" pill) left `DoorScroll` only ~211px at 390px wide — and, once bug 1 was fixed and Sora's real (wider) glyph metrics applied, a 2-digit house number at the 112px "xl" tier needed ~157px, more than any slot the pill's REAL 84px circle could free up. Two changes: (a) `OutcomeColumn`'s composer slot is now a fixed 92px (the circle plus a little air), not 140px — the pill's tail overflows it on purpose, clipped by the body scroller's own `overflow-x-hidden`, at the actual screen edge, matching Figma's own description; (b) in `door-scroll.tsx`, only the CURRENT item's plate span drops `max-w-full`/`truncate` and renders at natural width — nothing between it and the scroller sets `overflow-hidden`, and the scroller's viewport is always wider than one plate, so it is never actually cut off. Neighbours keep the original truncate safety net.
- **Files:**
  - New: `components/field/mini-map.tsx`, `components/field/outcome-column.tsx`.
  - Changed: `components/field/logger-tab.tsx` (full rewrite), `components/field/field-map.tsx` (`variant` prop), `components/field/ui/door-scroll.tsx` (current-item natural width), `components/field/shared-knock-notice.tsx` (exported `useSharedDoors`), `components/field/sync-status.tsx` (exported `rowLabel`), `app/globals.css` (Sora fix), `lib/field/map-style.ts` (dated note), `docs/D2D-Build-Brief.md`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`.
  - Deleted: none kept. Temporary and deleted before finishing: `app/ui1c-2000-check/page.tsx`, `scripts/_ui1c-fixture.ts`, `scripts/_ui1c-check.ts`, `scripts/_ui1c-members.ts`, `scripts/_ui1c-delmember.ts`, `scripts/_ui1c-realtime.ts`, `scripts/_ui1c-contrast.ts`, `scripts/_ui1c-solo.ts`.
  - Not changed: `lib/sync/queue.ts`, `lib/supabase/*`, every Session A/B1/B2 file not listed above (in particular `lib/field/door-signals.ts`, `lib/field/use-team.ts`, `lib/field/cursor.ts`, `lib/field/other-gesture.ts`, `lib/field/door-window.ts`'s formulas/constants, `components/field/ui/outcome-pill.tsx`, `components/field/ui/other-button.tsx`).
- **Acceptance (plan's full list):**
  - `npx tsc --noEmit`: **PASS**, exit 0.
  - `npx eslint components/field lib/field "app/(field)"`: **PASS**, exit 0.
  - `npm run verify:stage8b` / `verify:stage10` / `verify:ui4` / `verify:ui1`: **PASS**, all exit 0 ("ALL CHECKS PASSED" / "OK" / "OK" / "OK"), run once at the end.
  - **Screenshots vs Figma at 390, plus 375/430 and the sanity sizes:** **PASS**, with the deviations above. Figma reference fetched once each: Default (8:2), Logged+Undo (13:141), Partner ahead (13:652), Offline (13:356), Sync failed (13:608), Turn instruction (13:703), Already logged (13:793), plus `get_design_context` on 9:148 (OtherMenu anchor — no positioning data returned in isolation; the existing left-of-button anchor was not changed, one attempt, per the carried note). Browser screenshots taken at 390×844 (matching layout to the Default reference: header/eyebrow/IdChip, TeamStrip, compact map with route dot and attribution, current-door digits full and unclipped, pills right-clipped in the correct order, stats, NoteBar), 375×812, 430×932, and the sanity sizes 375×667 and 844×390 landscape (content scrolls, TabBar and NoteBar stay reachable, nothing overlaps). The Logged+Undo, Partner ahead, Sync failed and Offline/Pending states were all produced LIVE in the two-canvasser test below, not just read from Figma — see next item.
  - **Two-throwaway team test for A1, B1, C1:** **PASS**. Ada Lane and Tom Holt, a throwaway duo prop, real browsers (`localhost` / `127.0.0.1`, separate origins for separate sessions), real Realtime. A1: Ada logs the current door, Tom's teammate line updates live to `"Ada · last knocked #43"` (C1, plate-based) with no reload; Tom then logs the same door (claims are gone, so this is allowed) and his own cursor advances to the next open door. B1: Tom's `DoorScroll` shows the door Ada knocked greyed with a `"✓ Ada"` tag, and the aria-live announcement includes `", knocked by Ada"`. The P6 Info banner ("You and a teammate both logged door 2. It still counts once.") appeared live with an "OK" dismiss.
  - **Claim/release listener:** **PASS**, `0`/`0`. A second session, signed in as Tom again, subscribed to the same channel for the live portion of the test and logged every raw broadcast `type` seen: `{"here":19,"knocked":1}`, `claim=0`, `release=0`, `unparsed=0`.
  - **Offline log → queue → sync gives exactly 1 row:** **PASS**. Ada's tab: Supabase URL blocked (CDP `Network.setBlockedURLs`), logged a door (UI updated immediately, stats incremented, IdChip amber, banner "N to send · retrying shortly"), URL unblocked, flush confirmed (IdChip green, banner cleared). `knock_events` for that UPRN: exactly 1 row.
  - **Amendment 4, Sync failed — proved twice:** **PASS**. Script-level proof first (before the browser test): as service role, deleted a THIRD throwaway member's (`Sam Reeve`, added only for this proof, never touching Ada/Tom's own rows) `assignment_members` row, then called `sendOp` directly as that member — `outcome: "permanent"`, `error.code: "42501"`, 0 `knock_events` rows for that `client_event_id`. Browser-level proof after: Tom's tab offline, logged a door, service role deleted TOM's `assignment_members` row, tab back online — the Sync failed banner appeared exactly as Figma's 13:608 (`"! 1 knock couldn't be sent · door 1"`, Retry button, red styling), IdChip red, and the failed outcome was excluded from Today's stats (`foldOutcomes` already skips `status === "failed"`). No schema, RLS or function change.
  - **One MapLibre instance:** **PASS**. `document.querySelectorAll('.maplibregl-map').length` was `1` on the Logger, `1` on the Map tab, and `1` again after switching Map → Logger → Map → Logger. `lib/field/map-style.ts`'s comment corrected (see Built).
  - **2,000-door compact-map timing (amendment 6):** **PASS**. Temporary page (`app/ui1c-2000-check`, outside `app/(field)`, deleted after) rendering the real `DoorScroll` + `MiniMap` together. Node count: 9 at index 0, 17 at index 1000, 9 at index 1999 (≤ 17 throughout). `jumpTo` calls per settle: exactly 1, for a 0→500, a 500→1999, a 1999→0 jump and a single-step `›`. Frame time (rAF deltas) while settling: p50/p95 in the 33–44 ms range on 2–6 samples per settle (jumps are instant, so there is very little to sample) — device: this development machine's Chrome, NOT a phone.
  - **React re-render check (carried from the Session A review):** **PASS**. `use-team.ts`'s 1 s tick was NOT changed. Verified with React's own `Profiler` (temporary instrumentation, removed after): over a 30 s idle window on a live signed-in session, the wrapping `<Profiler>` around `DoorScroll`/`MiniMap` committed ~1.4×/s (matching the tick, as expected — the PARENT re-renders), but `actualDuration` for both was consistently under 1 ms (many exactly 0 ms; max 0.9 ms for DoorScroll, 0.3 ms for MiniMap) — `React.memo` is bailing out; the visible commit is the cheap prop-equality check, not a real re-render of a 9–17-item list or a map. One real prop-stability bug was found and fixed in the process: `DoorScroll`'s `onAddHouseNumber` was an inline arrow function (a new reference every render), which would have defeated the memo; it is now a `useCallback`.
  - **Cleanup:** **PASS**. Two throwaway fixtures (duo Ada/Tom/Sam-the-third-member on one prop; a separate solo canvasser for the Profiler check), both fully torn down: `select count(*)` on `knock_events`/`assignments`/`territories`/`auth.users`/`profiles` scoped to the harness names — all `0` after cleanup, checked directly against the live project.
  - **`realtime.messages`:** reported only, nothing deleted from `realtime.*`. `select count(*) from realtime.messages where topic = 'assignment:<the throwaway id>'` = `0` (broadcast-only messages are not persisted to this table — consistent with UI item 4's own report of `0` for the same reason).
  - **Contrast table:** recomputed this session with a fresh WCAG script (temporary, deleted after) against the CURRENT token values — unchanged from Session B1's figures, since no colour token changed this session: ink on field-bg 14.74, ink-soft on field-bg 7.29, ink-soft on surface 7.95, outcome-lead-ink on surface 8.25, prop on surface 8.15, outcome-rented-ink on surface 7.83, outcome-rented-ink on outcome-rented 7.04, outcome-rented-ink on warn-bg 7.12, oxide on error-bg 8.03, ink on warn-bg 14.63, surface on ink (toast) 16.08, ink-muted on field-bg 4.58 (eyebrows only), ink-muted on surface 5.00 (secondary only). Every must-read pair clears 7:1.
- **Deviations from plan or brief:**
  - Sora font-cascade fix and the DoorScroll natural-width fix (both above) — neither is a Session A file, `lib/sync/queue.ts`, the database or Figma, so neither triggered a stop-and-ask; both are documented fixes to Session B1/B2 output discovered during assembly, with the reasoning recorded above and in code comments.
  - `OutcomeColumn`'s composer slot is 92px, not the pill's full 140px (see Built, bug 2).
  - The scroll-driven map-band height ladder (P11, 124px → 72px as the body scrolls) was NOT implemented — the map band is a static 124px. No acceptance item tests this specifically; time-boxed out in favour of the harder functional items above.
  - `EndOfProp`'s exact copy and layout are this session's own reading of the plan's text description (no Figma screenshot budget spent on it) — flagged as NOT VERIFIED against Figma below.
  - The Info banner's "instruction" text (P5) does not append a hand-phrase suffix — it is `card.text` (or multiple cards joined with " · ") exactly as `route-display.ts` already produces it, with no new plumbing to add "· doors on your left" (unlike Figma's Turn instruction mockup, which appears to). Not independently confirmed against real routed-assignment fixture data.
- **Invariants:** no GPS, no coordinates — confirmed unchanged. No quality scoring in `/field`. Field writes still go through `lib/sync/queue.ts` only; that file was not opened this session (`git diff --quiet -- lib/sync/queue.ts` exit 0). No migration.
- **Verified:** see the Acceptance section above — every item there was tested live, not asserted.
- **Not verified:**
  - On-device: sun, one-handed grip, wet-thumb, haptics. No phone was used at any point this session — every check above ran in a desktop Chrome tab with CDP device-metrics emulation, which is NOT the same as a real phone.
  - `EndOfProp`'s screen (no Figma screenshot spent on it) and the map-band scroll-shrink ladder (not built).
  - The Turn instruction banner's exact wording against a real routed fixture (the throwaway test prop had no frozen route, so `view?.cards` was always empty during the live test; the instruction banner's rendering was exercised only via the pure `computeBanner` logic reading Session A's existing `InstructionCard[]` shape, not against a real "Turn left into Selby Road" string).
  - `prefers-reduced-motion`, screen-reader use, and keyboard-only navigation of the assembled screen (all were unit-tested inside their own components in Session B2, not re-tested here at the composed-screen level).
- **External settings:** none changed.
- **Follow-ups:** decide whether the map-band scroll-shrink ladder (P11) is worth building; decide whether `EndOfProp`'s copy/layout should be checked against Figma directly; the admin-Contacts label reconciliation (Session A) is still open for the admin rebuild; the ~8-door-per-scroll fling limit (Session B2) is still an open owner question.

---

### UI item 1b — Logger layout, Session G1
- **Date:** 2026-09-29
- **Model:** Grok 4.7
- **Built:** Logger layout only. The root viewport is `themeColor: "#fbfaf8"` plus `viewportFit: "cover"`. The field `<main>` pads the top safe area. The sheet and the map door panel no longer pad the bottom safe area; the tab bar still does. `TurnIcon` and `UndoIcon` were added (`UndoIcon` is unused until G2). The status banner is a 32px row under the map; instruction is plain text. The Logger body is map (grows), a 44px status line, then the door panel bottom-aligned above the note bar. Other sits inline, left of Not In. No migration. No sync change. G2 was not started.
- **Acceptance:**
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint components/field "app/(field)" app/layout.tsx`: **PASS** — exit 0, run again after the two class tweaks below, exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0.
  - `npm run verify:stage8b`: **PASS** — exit 0. The harness created a throwaway prop and two users, then deleted them (`territories left named "STAGE 8B TEST PROP — DELETE ME": 0`).
  - `npm run verify:ui4`: **PASS** — exit 0. The script printed "read-only asserts".
  - `git grep -n "safe-area-inset-bottom" -- components app`: **PASS** — exactly one line, `components/field/tab-bar.tsx:33`.
  - Viewport meta includes `viewport-fit=cover`: **PASS** — `content="width=device-width, initial-scale=1, viewport-fit=cover"` on `http://localhost:3000/login`.
  - Four pills share one left edge (±1px): **PASS** — 390: all `234.6`. 375: all `219.22`. 430: all `274.77`.
  - Not In bottom = NoteBar top − 12 (±2px) at 390 and 430: **PASS** — 390 gap `12`. 430 gap `11.99`. At 375 the body scrolls (`scrollHeight` 597, `clientHeight` 469); the gap is not required there and measured `−116.12` at scroll 0.
  - Other right = Not In left − 8 (±1), centres match (±1): **PASS** at all three sizes. Gap `8`. Centre delta `0` at 390, `−0.01` at 375 and 430.
  - Other does not intersect a today-stats row or the door scroll: **NOT MET** at 375. **PASS** at 390 and 430 (door scroll never intersects). At 375, after `w-fit`, the CONFIRMED label box is left `64` right `154.6` top `652.2` bottom `668.2`; Other is left `151.2` right `211.2` top `598.8` bottom `658.8`. They overlap by about 3.4px horizontally and 6.6px vertically. The LEADS and CONFIRMED `stat-row` boxes (right `154.6`) also intersect Other. Stopped. `stat-row.tsx` is outside this session, and Other's `top-3 mr-2` is the specified offset.
  - Map band height at 390×844 at least 160px: **PASS** on the second measure — `160.82`. The first measure, with `my-3` on the rule, was `156.82`.
  - Status line is 44px and its top equals the map band bottom: **PASS** — height `43.99`. Top minus map bottom `0` at 375, 390 and 430.
  - Nothing absolutely positioned in `logger-map-band` except the map wrapper: **PASS** for the band's own children — the only absolute child is the `absolute inset-0` wrapper, and a query for absolute elements outside that wrapper returned `[]`. Inside the wrapper, MapLibre's canvas and control corners and `mini-map-tap` are `position: absolute`. Those files were not edited.
  - Screenshots: 3. `g1-390-instruction.png` (the default door already shows "Start on service road, doors on your left", so a second 390 frame would have been the same). `g1-375.png` (scrolled to the panel). `g1-430.png` (the capture window is shorter than 932px, so the shot shows the top of that layout; the numbers above are from `getBoundingClientRect`).
- **Deviations from brief:**
  - The turn card's kind in code is `step`, not `turn`. `TurnIcon` is used when the first card's kind is `step`. Transfer, spur and stranded still use `instructionGlyph`.
  - The rule under the door is `mt-3 mb-2` rather than `my-3`, so the map clears 160px on this solo prop (first measure `156.82`).
  - Today's stats wrapper is `w-fit`, so the row boxes match the text. Without it, stretched rows intersected Other at 390 even though the words did not.
- **Not done / deferred:** Session G2 (Other menu placement, undo icon). The 375px CONFIRMED/Other overlap, left as NOT MET. Real iPhone safe area: **NOT VERIFIED** — Chrome device emulation, `env(safe-area-inset-top)` computed as 0 on `<main>`. No phone, no sun, no wet thumb, no on-device haptic. Did not commit.
- **Follow-ups:** the 375px overlap needs an owner call before anyone edits `stat-row.tsx` or Other's offset. G2 is a separate session.

---

### UI item 1b — Other menu and undo icon, Session G2
- **Date:** 2026-09-30
- **Model:** Grok 4.7
- **Built:** Other menu placement and the undo ring. The menu is fixed to the 16px right gutter and opens upward, capped so it stays on screen. `UndoToast` is now `FloatingUndo`: hidden on `/field/logger`, a 44px ring at the top-right everywhere else. The Logger renders `UndoButton` as the first child of the door column, including the end-of-prop state. Undo copy uses `scrollPlate`, so a missing number is `#N`. Stage 8 has a dated note. No migration. No sync change. G3 was not started.
- **Acceptance:**
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint components/field "app/(field)"`: **PASS** — exit 0.
  - `git grep -n -E "#[0-9a-fA-F]{3,8}\b" -- components/field/ui`: **PASS** — 0 lines, exit 1.
  - `git grep -n "UndoToast" -- components app`: **PASS** — 0 lines, exit 1.
  - `git diff --quiet -- lib/sync lib/field/undo.ts lib/field/other-gesture.ts`: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0, once.
  - `npm run verify:stage8b`: **PASS** — exit 0, once. Throwaway prop and two users created and deleted (`territories left named "STAGE 8B TEST PROP — DELETE ME": 0`).
  - `npm run verify:ui4`: **PASS** — exit 0, once. The script printed "read-only asserts".
  - 375×667 quick-tap Other, gesture `tap`: **PASS**. 4 menuitems inside the viewport. Menu right `359.21` versus width − 16 = `359` (delta `0.21`). Menu bottom `462.99` < Other top `470.46`.
  - 390×844 emulation (`innerWidth` 391) quick-tap, gesture `tap`: **PASS**. 4 menuitems inside. Menu right delta `−0.4`. Menu bottom `640.06` < Other top `647.61`.
  - Hold-slide onto Call back later, script touch `PointerEvent`s: **PASS**. Outbox `held_undo` 0 → 1, then undo 1 → 0 and the button gone.
  - After a Contact log: **PASS**. Button `43.99×43.99`. No intersection with the four pills, Other, or the current plate. `undo-toast` count 0. Dash offset `33.88` → `37.73` in 2s. Tap undo removed the held row and the button. Description `Contact · #2 Ventnor Road`.
  - Map tab, offline: **PASS**. Not In from the door panel. Floating ring top-right, `43.99×43.99`, 179px clear of the territory-name glyphs. Undo removed the held row and the button.
  - CanvasserX `knock_events` since 2026-09-29 00:00 London, after going back online: **PASS** — count 0.
  - Screenshots: 4. `g2-375-other-menu.png`, `g2-390-other-menu.png`, `g2-undo-ring.png`, `g2-map-undo.png`.
- **Deviations from brief:**
  - `UndoButton` does not emit `relative` when the caller passes `absolute`. Both classes set `position`, and the stylesheet keeps `relative`, so the Logger button stayed in normal flow until `relative` was omitted. The floating button still uses `relative`.
  - One Contact on REF - Speedwell (occurred 2026-09-29 23:06:48Z) synced after the 60s window because that minute was not actually offline. The row was deleted before the final count. Later logs were undone while `navigator.onLine` was false and `fetch /health` failed.
- **Not done / deferred:** Session G3. Real phone, sun, wet thumb and on-device haptic: **NOT VERIFIED**. The map visit line's glyphs run under the floating icon (text right `370.45`, button left `334.62`). The G1 375px CONFIRMED/Other overlap is unchanged. Did not commit.
- **Follow-ups:** whether the visit line under the floating undo icon needs a shorter header or a lower icon. The 375px CONFIRMED overlap is still an owner call.

---

### UI item 1b — Log-confirm animation, Session G3
- **Date:** 2026-09-30
- **Model:** Grok 4.7
- **Built:** The outcome pill's confirm is a 780 ms slide. The white circle travels 124 px, a tick draws where it rested, then the circle returns. Other keeps an exported `slideConfirm`, now a 240 ms scale pop. No migration. No sync change. `confirmKey` was not changed. `logger-tab.tsx`, `outcome-column.tsx` and `lib/*` were not edited.
- **Acceptance:**
  - `npx tsc --noEmit`: **PASS** — exit 0, after the reduced-motion edit.
  - `npx eslint components/field`: **PASS** — exit 0.
  - `git grep -n -E "#[0-9a-fA-F]{3,8}\b" -- components/field/ui`: **PASS** — 0 lines, exit 1.
  - `npm run verify:ui1`: **PASS** — exit 0, once.
  - `npm run verify:stage8b`: **PASS** — exit 0, once. Throwaway prop and two users created and deleted (`territories left named "STAGE 8B TEST PROP — DELETE ME": 0`).
  - Contact, offline, 390×844 (`innerWidth` 391). Click-to-animation 8 ms. At 134 ms: `translateX` 119.7 (between 20 and 124), tick opacity 1, chevron opacity 0. At 417 ms: `translateX` 124, tick opacity 1, chevron opacity 0, `getAnimations().length` 1. At 1,017 ms: `translateX` 0, tick opacity 0, chevron opacity 1, `getAnimations().length` 0. **PASS**.
  - Circle fully off-screen (`getBoundingClientRect().left` ≥ viewport width): **NOT MET**. At 417 ms left was 358.6, `innerWidth` 391, so 32.4 px of the circle was still inside the viewport. `elementFromPoint` at the right edge hit the circle span. Resting left is 234.6. `travelPx` stayed 124, as specified. The mid-hold screenshot shows the tick on the blue pill; the geometry does not clear the edge.
  - Not In twice, 214 ms apart: **NOT MET** for two logs. The second tap did not log. `INPUT_LOCK_MS` is 400 and was not changed. One `held_undo` row. After 1,200 ms every pill was at rest (`translateX` 0, tick opacity 0, `getAnimations().length` 0).
  - Not In twice, 459 ms apart (after the lock, still inside the 780 ms run): **PASS**. Animation `currentTime` 450 then 17, 30 ms after the second click. Outbox held both `no_answer` rows. After 1,200 ms all four pills were at rest (`translateX` 0, tick opacity 0, animations 0).
  - Perf, one Contact, 1,100 ms `requestAnimationFrame` loop plus a `longtask` observer: **PASS**. 68 frames, 0 dropped, longest gap 16.9 ms, long tasks 0. None over 50 ms.
  - Reduced motion (`prefers-reduced-motion: reduce`), offline. At 131 ms and 414 ms: `translateX` 0, circle opacity 0, tick opacity 1, chevron opacity 0. At 1,014 ms: `translateX` 0, circle opacity 1, tick opacity 0, chevron opacity 1, animations 0. The paused screenshot shows the tick on the blue pill and no white circle. **PASS**.
  - CanvasserX `knock_events` with `occurred_at` on or after 2026-09-30 17:50 UTC, after going back online, and the last 2 hours: **PASS** — both counts 0. The same query before the test had last-2-hours 0.
  - Screenshots used as evidence: 3. `g3-rest.png` (rest). `page-2026-09-30T17-56-55-765Z.png` (mid-hold). `page-2026-09-30T18-03-19-283Z.png` (reduced motion, paused on the tick). Two earlier captures missed the hold and are not the evidence set.
- **Deviations from brief:**
  - `scale-96` is not in Tailwind 4.3.3's scale list (`0, 50, 75, 90, 95, 100, 105, 110, 125, 150, 200`). The press class is `active:scale-[0.96]`. That arbitrary value sets the CSS `scale` property. Computed `transition-property` on the circle is `scale`.
  - The tick path's stroke ease is `EASE_OUT` on the keyframe at 60/780 as well as the first keyframe, so the 60–240 ms draw eases out.
  - Reduced motion also fades the circle's opacity and holds the tick path's `strokeDashoffset` at 0. Opacity alone cannot show the tick: the path rests fully offset, and the circle covers it because it does not travel. No `translateX` in that branch.
  - A second Not In inside 400 ms does not log, because of the existing input lock. The restart check used a 459 ms gap.
  - The undo button only offers the latest held row. An earlier held row from a pair was deleted from the local outbox while offline, so it could not sync. That was test cleanup, not a product change.
- **Not done / deferred:** Real phone, sun, wet thumb and on-device haptic: **NOT VERIFIED**. The 32 px remainder is an owner call if 124 px must actually clear the screen. The G1 375 px CONFIRMED overlap and the G2 visit-line overlap are unchanged. Did not commit.
- **Follow-ups:** whether `travelPx` should grow past 124 so the circle's left clears a 390-wide screen (resting left was 234.6). Whether a second tap at 200 ms should log despite `INPUT_LOCK_MS` 400. That lock was not edited.

---

### UI item 1b — Session G4
- **Date:** 2026-09-30
- **Model:** Grok 4.7
- **Built:** Three edits. Stat rows use `gap-2` below 390px and wider tracking from 390px. The map header takes `pr-14` while `useUndoTarget()` is set. `playLogConfirm` measures travel from the circle's resting left to the viewport edge plus 8px, and keeps 124px as the minimum. No migration. No sync change.
- **Acceptance:**
  - EDIT 1 DONE. `stat-row` is `gap-2 min-[390px]:gap-3`. The label has `tracking-[0.08em] min-[390px]:tracking-[0.12em]`. At 375×667 no `[data-testid=stat-row]` intersects `[data-testid=outcome-other-slot]`. Gap (Other left − row right) `5.25`. At 390 the gap is `11.75`. At 430 the gap is `51.63`. None intersect.
  - EDIT 2 DONE in source. `map-tab.tsx` imports `useUndoTarget`, calls it next to the other hooks, and the header className is a template literal with `${undoTarget ? "pr-14" : ""}`. The Map-tab check was not run.
  - EDIT 3 DONE. Travel is measured before animations are cancelled. At rest, transform `none` contributes 0. Mid-flight subtracts `DOMMatrixReadOnly` `m41`. `CONFIRM.travelPx` stays the minimum.
  - Contact, offline, circle `getBoundingClientRect().left` versus `innerWidth`. 375: at 431 ms left `383.51`, width `375`, `translateX` `164`. At 1001 ms left `219.51` (rest delta `0`), animations `0`. Undo removed the ring. 390: at 426 ms left `398.32`, width `390`, `translateX` `164`. At 1001 ms left `234.32`, delta `0`. Undo removed the ring. 430: at 428 ms left `438.21`, width `430`, `translateX` `164`. At 1002 ms left `274.21`, delta `0`. Undo removed the ring.
  - Through those three logs the outbox stayed `pending` 5, `synced` 47. No `held_undo` after each undo.
  - `npx tsc --noEmit`: **PASS** — exit 0, after `let travel: number`.
  - `npx eslint components/field`: **PASS** — exit 0.
  - `npm run verify:ui1`: **NOT RUN**.
  - `npm run verify:stage8b`: **NOT RUN**.
  - Map tab, 390×844, Not In from the door panel, undo versus header text: **NOT RUN**.
  - Screenshots: 0.
- **Deviations from brief:** `let travel: number`, because `CONFIRM` is `as const` and `travelPx` is the literal `124`. A transform of `none` is not passed to `DOMMatrixReadOnly`.
- **Not done / deferred:** The Map check. The two verify scripts. Stopped after five knocks synced. Did not delete or update them. Real phone, sun, wet thumb and on-device haptic: **NOT VERIFIED**. Did not commit.
- **Follow-ups:** the five synced rows are still in `knock_events`. The Map header padding is untested on the device. `INPUT_LOCK_MS` 400 was not edited.

Five `knock_events` rows synced when the Logger was reloaded online. They were already `pending` in the on-device outbox (created 2026-09-30 19:46 UTC, attempts 0) before this session's Contact logs. Those Contact logs were undone while offline and are not in this list. Not deleted. Not updated.

- `b73f0d67-6fcf-401e-876e-e6fbd19cae35` — `no_answer` — UPRN 76888 — occurred 2026-09-30 19:46:47.855+00
- `6e2f6979-24d6-4366-b8ff-ee6e2aafdaa3` — `no_opportunity` — UPRN 77069 — occurred 2026-09-30 19:46:49.894+00
- `26c0d64e-f8f0-43d5-8d43-745f14db2c26` — `no_answer` — UPRN 77070 — occurred 2026-09-30 19:46:55.721+00
- `3ff38c7f-7a36-4216-ab1c-d3c091c7ad20` — `no_opportunity` — UPRN 77095 — occurred 2026-09-30 19:46:57.104+00
- `f6a3ff71-03bb-4d6b-a73b-889931d7303d` — `no_opportunity` — UPRN 77111 — occurred 2026-09-30 19:46:58.976+00

---

### UI item 1c — Door panel, Session H1
- **Date:** 2026-09-30
- **Model:** Grok 4.7
- **Built:** The Logger door panel. Outcome circles 76px. Plate ladder 88/32, 72/26, 58/22, 44/18. Header without "Quick Logger", title 20px. Outcome slot 140px. Neighbour plates hidden. One 32px info row for the logged pill and "+ Add house number". Stat numbers 20px, `min-w-8`. Other sits `top-2` on the 76px Not In circle. The confirm tick is `left-[24px]`. No migration. No sync change. H2 was not started.
- **Acceptance:**
  - EDIT 1 DONE. `app/globals.css`: `--spacing-outcome` 76px. `--text-field-door-current` 88px / 88px. `--text-field-stat-number` 20px / 24px. Added `--text-field-title-sm` 20px / 24px / −0.01em / 700. Comment `2026-09-30 owner E3/E5`.
  - EDIT 2 DONE. `PLATE_PX` xl 88/32, lg 72/26, md 58/22, sm 44/18. The ladder comment matches. `plateSize()` was not edited.
  - EDIT 3 DONE. `STAGE_PX` 96. Neighbour items have `opacity-0`. The paint loop sets every non-current item's opacity to 0 and does not run the fade on it. The "+ Add house number" block and `onAddHouseNumber` are gone from `DoorScroll` and from `logger-tab.tsx`. Root `gap-0`. ‹ › stay `size-tap-min`.
  - EDIT 4 DONE. `stat-row.tsx` value `min-w-8`. The G4 breakpoints are unchanged.
  - EDIT 5 DONE. `outcome-column-slot` is `w-[140px] shrink-0`. OutcomeColumn comment dated 2026-09-30. Other slot `top-2`. Tick `left-[24px]`.
  - EDIT 6 DONE. "Quick Logger" removed. `h1` is `text-field-title-sm`. Header `pt-2 pb-1.5`.
  - EDIT 7 DONE. UndoButton unchanged. "Current door" stays left. Number through the info row is in `flex w-full flex-col items-center`. Info row `h-8`, test id `door-info-row`. Logged pill `h-7 px-2.5 text-field-button-label`. Placeholder button is the specified classes, test id `add-house-number`. Empty row still renders. Rule `mt-1.5 mb-1.5`. Stats `mt-1` and `gap-1`. No padding on the door column.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint components/field lib/field`: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0, once. No `PLATE_PX` expectation was changed. The script checks size names, not pixels.
  - `npm run verify:stage8b`: **PASS** — exit 0, once. Throwaway prop and two users created and deleted (`territories left named "STAGE 8B TEST PROP — DELETE ME": 0`).
  - Panel heights equal, 358.77. 390×763 (`innerWidth` 391): "11" unlogged, "#3" unlogged, "1" logged, "#2" logged. 375×600 and 430×850 (`innerWidth` 431): the first three, also 358.77. "#2" logged was measured at 390 only.
  - Plate centre versus the midpoint of door-column left and Lead left. 390: −3.96, −4.19, −3.83. 375: −4.31, −3.67, −4.12. 430: −3.91, −3.90, −3.91. Outside ±2. The plate is centred in the column. The Lead pill starts 8px to the right of the column.
  - Neighbour computed opacity 0 at rest on those passes.
  - Map band at 390×763: **169.64**. Target was ≥ 170.
  - Not In bottom to note-bar top: 11.99 at 390 and 430. At 375×600 the gap is −93.59 and the rects intersect.
  - Contact slide, width 391. At 251 ms circle left 399.57. At 421 ms left 399.6. At 1,064 ms left 234.6, transform `none`.
  - #2 Contact undone on the ring. Outbox open rows 0. Logged pill gone. `knock_events` select for the four local ids: 0 rows.
  - Screenshots: 3. `h1-390-numbered.png`, `h1-375.png`, `h1-390-placeholder-logged.png`.
- **Deviations from brief:**
  - The scroll track is `h-[110px]`, not the old 132. A 96px plate inside 132px left 36px of empty track, so the street was not under the number and the map was 147.64. 110px is the plate plus the 14px teammate line.
  - The centring wrapper is `w-full`. Without it, `items-center` shrank the scroller to the track and `clientWidth` became 28,678,998.
  - One local Contact (`ec23b8aa-e60a-4bd8-8798-3acbf4bca57e`, UPRN 77326) reached `pending` in Dexie. It was removed from the device outbox while offline. It is not in `knock_events`.
- **Not done / deferred:** H2. The 4px centre miss. The map at 169.64. The 375×600 overlap. The logged-placeholder info row, where the pill and "+ Add house number" draw on top of each other. Real phone, sun, wet thumb and on-device haptic: **NOT VERIFIED**. Did not commit.
- **Follow-ups:** whether the 8px panel gap should be inside the centred box. Whether the info row should stay one line when both controls are present. H2 is a separate session.

Four local Contact `client_event_id`s. None are in `knock_events`:

- `1d9f9e05-5c2e-4a34-9ef6-0effd1778ad6` — undone on the ring
- `70c906ef-e8ec-4569-a66d-d20012354dbe` — undone on the ring
- `ec23b8aa-e60a-4bd8-8798-3acbf4bca57e` — removed from Dexie while `pending`, offline
- `8fa41c66-e925-4d63-8bbe-098b28d5d4ef` — `#2`, undone on the ring

---

### UI item 1c — Interactive mini map, Session H2
- **Date:** 2026-09-30
- **Model:** Grok 4.7
- **Built:** The Logger mini map pans and pinches. Rotate, pitch and the keyboard are off. It eases back to the current door in 300 ms, and the camera move no longer waits for the style to finish loading. The full-cover tap is a 44px round map button. Attribution is unchanged. No Navigation or Scale control on the compact map. No migration. No sync change.
- **Acceptance:**
  - EDIT 1 DONE. The camera effect returns only when the instance is missing or `selectedUprn` is null. Dated comment: camera moves do not need the style; the old `isStyleLoaded()` guard skipped the move while a source was updating. Compact calls `flyToDoor(..., "ease", COMPACT_ZOOM, 300)`. `durationMs` defaults to 400. `dataset.cameraJumps` still increments.
  - EDIT 2 DONE. `interactive: true`. Compact, right after creation: `dragRotate.disable()`, `touchPitch.disable()`, `touchZoomRotate.disableRotation()`, `keyboard.disable()`. No Navigation or Scale control on compact. Attribution control unchanged. Variant comment includes `2026-09-30 owner E6: pan and pinch allowed, no rotate or pitch; re-centres on every door change`.
  - EDIT 3 DONE. The full-cover `mini-map-tap` button is gone. `mini-map-open` is the 44px round button, `MapIcon`, aria-label "Open the full map, centred on this door". Doc comment dated 2026-09-30.
  - EDIT 4 DONE. `lib/field/map-style.ts` one-instance comment has the line `2026-09-30: the Logger's compact map is interactive (pan/pinch); still one instance per route.`
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint components/field lib/field`: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0, once.
  - `npm run verify:ui4`: **PASS** — exit 0, once. The script's own header is read-only asserts. No throwaway users in its output.
  - Chrome, CanvasserX, `/field/logger`, REF - Speedwell, visit 3, 182 doors. Emulation 390×763, `innerWidth` 391, `innerHeight` 763. Offline for the logs: `navigator.onLine` false and `fetch /health` threw `TypeError`.
  - After a reload onto the new map instance: drag-rotate off, touch-pitch off, pinch-rotate off (`_rotationDisabled` true), keyboard off, drag-pan on, pinch-zoom on, no zoom control, no scale control, attribution present, `touch-action: none`.
  - 12 Not In logs, each undone on the ring straight after. The door the cursor moved to, `map.project`: every point was x 195.5, y 85. Mini map client size 391×170. Min x 195.5, max x 195.5, min y 85, max y 85. All 12 inside. 12 distinct UPRNs. `cameraJumps` rose by 1 each log. Outbox after the run: `synced` 54, open 0.
  - Scripted touch drag of 80px on the canvas: centre lng changed by −0.000303, lat by 0. `logger-body` `scrollTop` stayed 0. All 8 `touchmove` events had `defaultPrevented`.
  - One › after that drag: UPRN 76061 projected to x 195.5, y 85, inside. `cameraJumps` 15.
  - `mini-map-open` while offline, twice: the tab left for `chrome-error://chromewebdata/`. `next dev` has no service worker, so the route change became a full load. **NOT VERIFIED** offline.
  - Same button online: URL `/field`, selected UPRN 77876, plate `1`, panel "1 Selby Road". Map count on that first paint was 0 (the panel arrived before the canvas). After Logger, then Map: 1 map each time. Samples during the switches: 72, maximum 1.
  - `knock_events` for CanvasserX with `occurred_at` on or after 2026-09-30 22:10 UTC: **0 rows**.
  - Screenshots: 2. Logger with the round map button and the current door's halo. Map tab on 1 Selby Road, zoom and scale present, attribution present.
  - Point count exercised: 182, on this assignment. Not 2,000. Device: desktop Chrome with device-metrics emulation, not a phone.
- **Deviations from brief:**
  - The first 12-log pass ran on a hot-reloaded page whose MapLibre instance was still the old non-interactive one. The follow still centred. Those 12 were undone. The numbers above are from a full reload, then the same 12 offline.
  - The load handler still `jumpTo`s the first door. The numbered edit only changed the camera effect. Both paths increment `cameraJumps`, so a fresh compact map starts at 2.
  - Open-map and the Map → Logger → Map count were checked online, after the offline logs. The outbox was already clear.
- **Not done / deferred:** Real phone, sun, wet thumb and on-device haptic: **NOT VERIFIED**. A 2,000-door pass of the interactive mini map: **NOT VERIFIED**. Offline open-map and tab switches: **NOT VERIFIED**. Did not commit.
- **Follow-ups:** whether a production service worker would keep the open-map route change on the device when the radio is off. H1's plate gap, the 169.64 map band, the 375×600 overlap, and the logged-placeholder info row are unchanged. The five G4 knocks were not removed.

---

### UI item 1c — Logged pill and house number, Session H3
- **Date:** 2026-09-30
- **Model:** Grok 4.7

UI item 1c, Session H3. In `components/field/logger-tab.tsx` the logged pill drops the word "Logged", keeps the outcome and the time, and does not wrap (`shrink-0`, `whitespace-nowrap`). On a logged door with no house number the control reads "+ Add no." and keeps `aria-label="Add house number"`; an unlogged door still reads "+ Add house number". No other source file. No migration. No field write path. `npx tsc --noEmit` and `npx eslint components/field` both exit 0. `git diff --ignore-cr-at-eol --stat -- components/field/logger-tab.tsx` is 38 insertions and 31 deletions, because that file was already dirty from earlier uncommitted Logger work; this session changed the pill class, the pill text, the button class, the aria-label, and the button label. Chrome, CanvasserX, REF - Speedwell, visit 3, door #2 Ventnor Road. Offline: `navigator.onLine` false and `fetch /health` threw `TypeError`. Not In logged at 23:34, then ‹ from door 34 (the log had moved the cursor 32 doors). At 390×763 (`innerWidth` 391) the pill was x 24, y 467.59, 113.37×27.99 and "+ Add no." was x 145.37, y 459.59, 73.24×43.99; the door column was x 16, y 295.61, 210.6×342.79; no intersection; both inside. At 375×667 (`innerWidth` 375) the pill was x 16.31, y 409.94, 113.37×27.99 and the button was x 137.67, y 401.94, 73.24×43.99; the column was x 16, y 237.95, 195.22×342.79; no intersection; both inside. The undo ring showed 17 seconds left when the 390 rects were taken, and the button was gone before the click, because walking back took the rest of the 60s window. Local outbox row `2aed786e-748f-4750-b311-fdc3e9d71d33` was `knock_event`, `pending`, 0 attempts; it was removed from Dexie while offline. A select of that id, and of CanvasserX knocks with `occurred_at` on or after 2026-09-30 22:30 UTC, returned 0 rows, including after the browser was back online with no open outbox rows. Screenshot is 390×763. No phone. Did not commit.

---

### UI item 2 — Map palette and outcome colours, Session M1
- **Date:** 2026-10-01
- **Model:** Grok 4.7
- **Built:** One map palette. The field basemap is the MapTiler dataviz-light JSON passed through `restyleBasemap`. Door dots and the Map legend use `OUTCOME_DOT`. Dots are smaller. No migration. No sync change. M2 was not started.
- **Acceptance:**
  - EDIT 1 DONE. New `lib/map/map-palette.ts`. `MAP_PALETTE`, `OUTCOME_DOT`, `OUTCOME_TINT` match the session hexes. Comment: `2026-10-01 owner F1/F2. Figma: Map style v1.`
  - EDIT 2 DONE. New `lib/map/restyle-basemap.ts`. `restyleBasemap` copies the style and maps every layer. `restyleReport` returns `{ id, type, sourceLayer, rule }`. First match wins. Paint keys are spread, then the named key is set. Layout is touched only for `visibility`.
  - EDIT 3 DONE. `fieldMapStyle()` fetches the same dataviz-light URL. `response.ok` returns `restyleBasemap` of the JSON. Otherwise `FALLBACK_STYLE`. Fallback `background-color` is `MAP_PALETTE.ground`. Attribution lines and the earlier comments stay. Dated line added.
  - EDIT 4 DONE. `UNLOGGED` is `OUTCOME_DOT.open`. `FILL_BY_STATE` maps no_answer, answered, lead, no_opportunity, and refused / do_not_call / inaccessible / callback to `other`, default `open`. Unselected stroke is `openRing` when outcome is `none`, else `ring`. Selected stroke stays `#1c2226`. Circle stops 3 / 5 / 8 / 10. Core stops 1 / 2 / 3 / 4. Focus halo stops 7 / 11 / 16 / 20 inside the existing `focusHaloAt`, so an unselected door still has halo radius 0. Outcome-styling comment dated 2026-10-01. No new hex in `field-map.tsx`.
  - EDIT 5 DONE. The five legend rows use `style={{ backgroundColor, boxShadow }}` from `OUTCOME_DOT`. Sizes stay h-3, h-3, h-3.5, h-2, h-5. Not yet logged is white with a 1px `openRing`. START, END and the route rows were not edited.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint components/field lib/field lib/map`: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0, once.
  - `npm run verify:ui4`: **PASS** — exit 0, once. Read-only asserts. No throwaway users in its output.
  - Chrome, CanvasserX, `/field`, Whitechurch Lane - Hartcliffe, visit 1, 1,682 doors. Emulation 390×763. `innerWidth` 390, `innerHeight` 763. Loaded style background `#f6f4ef`. Water `#d6e2ea`. Landcover `#f1eee7`. Building `#e4e1da` / edge `#d6d2ca`. Road `#ffffff`. Road outline `#e2dfd8`. Path `#e2dfd8`. Railway `#d6d2ca`. Road labels `#4a5259` halo `#f6f4ef` width 1.5. Place labels `#7c8188` halo width 1.2.
  - `restyleReport` on the live dataviz-light JSON, 42 layers. Counts: background 1, fill-building 2, fill-landuse 4, fill-water 2, hide 4, line-casing-minor 2, line-path 4, line-rail 4, line-road 3, line-water 1, symbol-muted 10, symbol-name 1, unchanged 4. No fill-park, no hide-extrusion, no line-casing-major, no line-building. Unchanged: Forest (`globallandcover`), Aeroway, Pier, Bridge.
  - Legend computed colours: Not yet logged `rgb(255,255,255)` shadow `rgb(138,143,152) 0 0 0 1px`. Not In `rgb(133,138,147)`. Contact `rgb(63,116,208)` inset white 2px. Rented/Council `rgb(199,122,18)`. Lead `rgb(47,143,87)` inset white 2px.
  - Screenshots: zoom 16, zoom 18, Logger (mini map uses the same basemap; current door has the blue compact halo), fallback (flat ground, dots visible, 435 `field-doors` circles in view at zoom 16).
  - Full offline reload (`navigator.onLine` false): the document did not load (`chrome-error://chromewebdata/`). **NOT VERIFIED** as a radio-off reload. Fallback path: MapTiler blocked and HTTP cache disabled, then reload. Style name `field-offline`, background `#f6f4ef`, dots visible. **PASS** for that path.
  - `knock_events` for CanvasserX with `occurred_at` on or after 2026-10-01 18:20 UTC: **0**. Outbox `61cea5a1-d03e-4edb-9294-6bf4045e61e1` still `failed`, and that id is not in `knock_events`. Retry was not clicked.
  - Point count on screen: 1,682. Not a timed 2,000-door pass. Device: desktop Chrome with device-metrics emulation, not a phone.
- **Deviations from brief:**
  - Focus halo sizes are `focusHaloAt(7/11/16/20)`, not bare interpolate stops. Bare numbers would paint a halo on every door.
  - `components/admin/coverage-map.tsx` was not edited. It calls `fieldMapStyle()`, so the admin coverage basemap is restyled too. The plan said admin maps are not changed.
  - No Figma file URL is in the repo. The eye check is the live map against the palette, not an open Figma frame.
- **Not done / deferred:** M2. Park colour and `roadMajorCase` do not hit a dataviz-light layer. Logger button fills are a different set (Lead `rgb(99,185,137)`, Contact `rgb(96,148,230)`, Rented/Council `rgb(249,242,230)`, Not In `rgb(150,155,164)`). Not tuned. Real phone and a 2,000-door timing pass: **NOT VERIFIED**. Full airplane-mode reload of `next dev`: **NOT VERIFIED**. Did not commit.
- **Follow-ups:** whether Forest / Landcover should pick up `park` in a later session, or stay as this table. Whether the Logger circles should move to `OUTCOME_DOT`. Whether coverage should stop sharing `fieldMapStyle`.

---

### UI item 2 — Door dots on the pavement walkline, Session M2
- **Date:** 2026-10-01
- **Model:** Grok 4.7
- **Built:** Display-only door anchors. Each dot is projected onto the work step's pavement walkline, in door order, at least 2.5 m apart, 1 m in from each end. The Map tab and the Logger mini map use that collection. `assignment.doors` is unchanged. No migration. No sync change. F4 was not started.
- **Acceptance:**
  - EDIT 1 DONE. New `lib/map/door-anchors.ts`, pasted as given. Exports `AnchorStep`, `AnchorDoor`, `Anchored`, `MIN_GAP_M`, `END_INSET_M`, `spread`, `anchorDoors`.
  - EDIT 2 DONE. New `lib/map/anchor-doors-collection.ts`. `anchorDoorCollection` maps `properties.uprn`, `properties.sequence` and the point, calls `anchorDoors`, and returns a new FeatureCollection with the same properties plus `anchored`. Empty `steps` returns the same reference.
  - EDIT 3 DONE. `anchoredDoors` is a `useMemo` over the assignment doors and the route steps (`kind`, `first_seq`, `last_seq`, `walk`). No route returns the original doors. `getSequence` still reads `phase.assignment.doors`.
  - EDIT 4 DONE. `components/field/map-tab.tsx` and `components/field/logger-tab.tsx` pass `doors={anchoredDoors}`. Nothing else in those files. `mini-map.tsx` still forwards `doors`.
  - EDIT 5 DONE. `scripts/verify-map-anchors.ts`. `package.json` `"verify:anchors": "tsx scripts/verify-map-anchors.ts"`.
  - `npm run verify:anchors`: **PASS** — exit 0, once. spread stack `[2.5, 5, 7.5]`. spread short line `[0, 1, 2, 3]`. spread empty `[]`. 100 m line, 10 doors, 4 stacked, minimum gap 2.500 m. Sequence outside every work step stays put. A cross step is ignored. Speedwell `629d3ce4-a82a-4678-ab87-389e783da792` visit 3: anchored 182, minimum gap 2.497 m, move min 2.17 m, median 12.27 m, max 18.57 m. Node 2,000 doors / 60 steps: 3.33 ms.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint` on this session's files: **PASS** — exit 0. `npx eslint components/field lib/field lib/map scripts`: **FAIL** — exit 1. `scripts/seed-demo.ts` line 242, `prefer-const` on `let leftover`. That file is unchanged from HEAD. Not this session.
  - `npm run verify:ui1`: **PASS** — exit 0, once.
  - `npm run verify:ui4`: **PASS** — exit 0, once. Read-only asserts. No throwaway users in its output.
  - Browser console, CanvasserX, the real `anchorDoorCollection`, same 2,000 / 60 input: **PASS** — 2.80 ms, 2,000 anchored. The hook used to reach the function was removed. After the Logger load it was `undefined`.
  - Chrome, CanvasserX, Map tab, Whitechurch Lane - Hartcliffe, visit 1, 1,682 doors. Emulation 390×763. `innerWidth` 391, `innerHeight` 763. Screenshots at zoom 17 (98 dots in view) and zoom 18 (28 dots, Belland Drive and Parkwood Close numbers). The dots sit on the buildings. **NOT VERIFIED** as a pavement row: this assignment has 0 route steps, so the anchors do not move.
  - Logger: heading CanvasserX was on the profile tab. Mini map rendered, 1 canvas. No knock was logged. `knock_events` for CanvasserX on or after 2026-10-01 20:00 UTC: 0. Outbox `61cea5a1-d03e-4edb-9294-6bf4045e61e1` is still not in `knock_events`. Retry was not clicked.
  - Point count exercised on screen: 1,682. Timed at 2,000. Device: desktop Chrome with device-metrics emulation, not a phone.
- **Deviations from brief:**
  - The live Map tab cannot show F3. CanvasserX's today prop is Whitechurch, and it has no walkline. The 182-door row was checked by SELECT on REF - Speedwell visit 3, work date 2026-09-30.
  - The verify script also checks that empty steps return the same collection, and that a cross step through `anchorDoorCollection` keeps the point. Both passed.
  - The directory eslint command does not exit 0, because of `scripts/seed-demo.ts`. Not edited.
- **Not done / deferred:** F4 buildings. A screenshot of one terraced street with the dots in a pavement row: **NOT VERIFIED**. Real phone: **NOT VERIFIED**. Did not commit.
- **Follow-ups:** a today prop with work steps, so the row can be looked at on the phone. `scripts/seed-demo.ts` line 242 (`let leftover` → `const`) if `eslint scripts` is meant to exit 0.

---

### UI item 2 — Building outlines and per-door slices, Session M3
- **Date:** 2026-10-01
- **Model:** Grok 4.7
- **Built:** OSM building ways for three territories, stored as `building_footprints`, and one slice per door position in `door_footprints`. Flats on the same 0.5 m point share a slice. Terraces are Voronoi cuts. The map does not draw them. F5 was not started.
- **Acceptance:**
  - EDIT 1 DONE. `supabase/migrations/024_door_footprints.sql` is the session SQL. Next free number was 024. Recorded as `20261001205042`. `lib/supabase/types.ts` regenerated. `npx tsc --noEmit` exit 0.
  - RLS, transaction rolled back. `authenticated` select on both tables: counts 0, `current_user` authenticated. `anon` select: both counts 0. `authenticated` `upsert_building_footprints` and `rebuild_door_footprints`: `42501 permission denied for function`.
  - Policies: `building_footprints_select` and `door_footprints_select`, SELECT to `authenticated`, `using (true)`. No write policy. Execute on the two ingest functions: `service_role` only. Execute on `assignment_door_footprints`: `authenticated`.
  - EDIT 2 DONE. `scripts/ingest-buildings.ts`. Script `ingest:buildings`. No arguments: usage, exit 1. Header states multipolygon relations are not loaded. `ATTRIBUTION_LINES` unchanged.
  - EDIT 3 DONE. Only REF - Speedwell, TEST - dry run, and Whitechurch Lane - Hartcliffe. Sent = written: 723, 474, 2,477. Rebuild: 179, 85, 1,578. Re-run: same figures. `building_footprints` 3,674 and `door_footprints` 1,842 both times.
  - EDIT 4 DONE. `scripts/verify-door-footprints.ts`. Script `verify:footprints`. Final run exit 0.
  - REF - Speedwell: buildings 723, doors 182, slices 179 (98.4%), single 172, shared slices 3, shared doors 7. Invalid 0. Overlaps over 0.5 m²: 0. Split buildings 1, area outside 1%: 0. Open assignment `8eaae87b-a77e-4e7b-b653-9a2cd9f03dbc`: 172 single-door features.
  - TEST - dry run: buildings 474, doors 88, slices 85 (96.6%), single 66, shared slices 7, shared doors 19. Invalid 0. Overlaps 0. Split buildings 3, area failures 0. Open assignment `1e9fe4c5-ffa6-46c7-80d8-9348267e477b`: 66 single-door features.
  - Whitechurch Lane - Hartcliffe: buildings 2,477, doors 1,682, slices 1,578 (93.8%), single 1,468, shared slices 31, shared doors 110. Invalid 0. Overlaps 0. Split buildings 17, area failures 0. No open assignment. Closed assignment `4d735d92-1eaa-4e55-9f21-e0e17f558379`: 1,468 single-door features.
  - `npx eslint scripts/ingest-buildings.ts scripts/verify-door-footprints.ts scripts/lib`: **PASS** — exit 0.
  - `git status --short --ignored`: `!! data/raw/`. Not staged. `git check-ignore` hits `.gitignore` `/data/*`.
- **Deviations from brief:**
  - CLI apply was not in `schema_migrations`. Empty objects were dropped and `apply_migration` recorded the same SQL once.
  - Default table grants still include anon and authenticated. Anon select returned 0 rows because there is no anon policy.
  - Whitechurch rebuild timed out twice on the first run (`canceling statement due to statement timeout`), then wrote 1,578. The re-run did not time out.
  - CanvasserX was used for the RPC. No throwaway member was added. Whitechurch is closed, so that check is not on an open assignment.
- **Not done / deferred:** Drawing slices on the map. F5. Phone. Authenticated INSERT was not executed. Did not commit.
- **Follow-ups:** whether a closed assignment should still return footprints. Whether the Whitechurch rebuild needs a longer statement timeout before a cold run is reliable. Multipolygon relations and doors more than 3 m from an outline stay without a slice.

---

### UI item 2 — Coloured buildings and 2D/3D, Session M4
- **Date:** 2026-10-01
- **Model:** Grok 4.7
- **Built:** Door slices on the field map, tinted from this assignment's knocks. Shared slices stay neutral. A shared 2D/3D choice for the Map tab and the Logger mini map, remembered in `d2d.mapView`. No migration. No sync change.
- **Acceptance:**
  - EDIT 1 DONE. Dexie version 7. Every version-6 store repeated. `footprints: "assignment_id"`. No `.upgrade()`.
  - EDIT 2 DONE. `lib/field/footprint-cache.ts`. RPC `assignment_door_footprints`, 4 s timeout, Dexie row `{ assignment_id, fetched_at, data }`. Offline or error returns the cache or null.
  - EDIT 3 DONE. Slices load with the route, and again on `online`. Context field `footprints`.
  - EDIT 4 DONE. `lib/field/map-view.ts`. `useMapView`, `setMapView`, `toggleMapView`. Default `2d`. Storage in try/catch.
  - EDIT 5 DONE. Layers `field-footprints-fill`, `field-footprints-line`, `field-footprints-3d`, `basemap-buildings-3d`, under the route. Feature state on `style.load` and in the effect. Pitch 55 / 50. Compact pitch is code only.
  - EDIT 6 DONE. Both toggles, 44px. Map tab top-left. Mini map top-right.
  - EDIT 7 DONE. Both `FieldMap` usages receive `footprints`. `logger-tab.tsx` passes them into `MiniMap`.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint components/field lib/field lib/map`: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0, once.
  - `npm run verify:ui4`: **PASS** — exit 0, once.
  - `npm run verify:anchors`: **PASS** — exit 0, once.
  - Chrome, CanvasserX, REF - Speedwell, visit 4, 182 doors, 175 slices. Emulation 390×763. `innerWidth` 391, `innerHeight` 763.
  - (a) **PASS**. Offline. Lead on UPRN 74756. Fill feature state `lead`. Paint expression contains `#cfe6d8`. Undo cleared the state to `{}`. Outbox `5e4e1192-f3ab-4096-8743-2bb595c2e498` removed while offline.
  - (b) **PASS**. Shared fid `-621499241001` is not in the fill layer. Line layer draws it. Feature state `{}`.
  - (c) **PASS**. Map tab pitch 55, both extrusions visible, dots and route above them. Logger pitch 50, › kept the pitch. Toggle to 2D on the Logger, then the Map tab was pitch 0.
  - (d) **PASS**. Reload kept `3d`: pitch 55, button `2D`.
  - (e) **NOT VERIFIED**. Offline reload of `next dev` ended on `chrome-error://chromewebdata/`. Dexie had 175 features before that reload.
  - (f) **PASS** for the frame count on this machine. 5,010 ms pan at zoom 18, pitch 55: 302 frames, 0 dropped, 287 map renders. Contact on the 3D mini map reached the undo ring in 84 ms. Undone offline. Id `e56ec6b2-4c7f-4a86-b038-6ee802ad0704`.
  - `knock_events` for those two ids, and for CanvasserX on or after 2026-10-01 21:20 UTC: **0**. `61cea5a1-d03e-4edb-9294-6bf4045e61e1` is not in `knock_events`.
  - Point count: 182 doors, 175 slices. Device: desktop Chrome with device-metrics emulation, not a phone.
- **Deviations from brief:**
  - `ensureFootprints(supabase, assignmentId, online)`. The prompt named the assignment and the online flag. The client is the same extra argument `ensureRoute` takes.
  - Coming online re-runs the route load as well as the slices. `routeReady` is not cleared on that pass.
  - `logger-tab.tsx` was edited so the memoised mini map receives `footprints`.
  - The map click that should have selected UPRN 74756 missed because the screenshot coordinate was scaled. Selection then used `onSelectUprn`. The lead was logged from the Lead button.
- **Not done / deferred:** Radio-off reload of the dev server. A phone. A 2,000-door 3D pass. Did not commit.
- **Follow-ups:** none new. M3's closed-assignment question is unchanged.

---

### UI item 2 — Building colour lag, deeper tints, current-door link, Session M5
- **Date:** 2026-10-02
- **Model:** Grok 4.7
- **Built:** Outcome colour on a building applies on the log that set it. Tints are deeper. The selected door draws one dashed leader from the pavement dot to the address point, with a ring, and that slice is highlighted in 2D and 3D. No migration. No sync change.
- **Acceptance:**
  - EDIT 1 DONE. `components/field/field-map.tsx` doors-data effect and outcome effect gate on the instance, then the source. Dated G1 comment on each.
  - EDIT 2 DONE. `lib/map/map-palette.ts`. `OUTCOME_TINT` lead `#8fcfa8`, answered `#9dbcf0`, no_opportunity `#efc27f`, no_answer `#c3c7ce`, other `#c9c1b5`. `FOCUS` line `#1b4aa6`, tint `#c7d6f5`.
  - EDIT 3 DONE. `lib/map/anchor-doors-collection.ts` adds `raw_lng` and `raw_lat` from the original point. Empty steps still return the same collection.
  - EDIT 4 DONE. Selected line `FOCUS.line` width 2.5. Selected slice with no outcome uses `FOCUS.tint`. Selected 3D height is `height_m + 1.5` (others `+ 0.5`). Leader layers sit under the route and stay visible in 2D and 3D.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint components/field lib/field lib/map`: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0, once.
  - `npm run verify:anchors`: **PASS** — exit 0, once. 2,000 doors / 60 steps: 4.96 ms.
  - `npm run verify:ui4`: first run **FAIL** — `JWT issued at future`, exit 1. Retry **PASS** — exit 0. Read-only asserts. No fixture was created.
  - `git grep isStyleLoaded` in `components/field/field-map.tsx`: five comment lines, no calls. The route effects were not changed. The camera effect still has no `isStyleLoaded()` call.
  - G1 **PASS**. Offline, TEST - dry run, five logs, `getFeatureState` on `field-footprints`:

    | log | uprn | outcome | ms |
    | --- | --- | --- | --- |
    | 1 | 313869 | answered | 14 |
    | 2 | 25300 | no_answer | 29 |
    | 3 | 25388 | no_opportunity | 31 |
    | 4 | 25467 | no_answer | 30 |
    | 5 | 25437 | answered | 33 |

  - G2 states **PASS**. The 3D screenshot shows a blue slice above the grey terrace. The 2D screenshot shows the current house in `FOCUS.tint`. A clearly separate amber slice: **NOT VERIFIED** in the frames.
  - G3 **PASS**. Logger leader on 25615, then › moved it to 342809. Map tab click on 313869 drew the leader and opened the panel. Close cleared both. No door under 1.5 m (minimum gap 3.17 m).
  - `knock_events` and `property_observations` for the five client ids, and for CanvasserX on or after 2026-10-02 19:39 UTC: **0**. `61cea5a1-d03e-4edb-9294-6bf4045e61e1` is not in `knock_events`.
  - Point count on screen: 88 doors. Device: desktop Chrome, emulation 390×763, not a phone.
- **Deviations from brief:**
  - Leader `setData` also runs in the `load` handler. The `style.load` listener is attached after the first style has already loaded.
  - Today's open assignment is TEST - dry run visit 3 (`1e9fe4c5-ffa6-46c7-80d8-9348267e477b`), not REF - Speedwell. REF - Speedwell visit 4 is work date 2026-10-01. The date was not updated.
  - The undo ring expired (60 s) during the screenshots. The five unsent outbox rows were deleted locally while Supabase was blocked. The older pending id was not deleted and was not retried.
  - The Map-tab tap was a canvas `click` at the projected pixel. The coordinate click tool required a screenshot in the same step and did not accept the previous one.
- **Not done / deferred:** REF - Speedwell on today's field app. A door closer than 1.5 m. A phone. A 2,000-door map paint. Did not commit.
- **Follow-ups:** none.

---

### UI item 3 — Field dark mode, Session D1
- **Date:** 2026-10-03
- **Model:** Grok 4.7
- **Built:** Auto / Light / Dark for the field app only. Saved on the device. Default Auto. Dark colours apply inside `.field-root`. Outcome buttons keep the light palette. The map stays light. No migration. No sync change.
- **Acceptance:**
  - EDIT 1 DONE. 26 `--color-*` tokens in `@theme`. The light island re-declares all 26 with the same values. `@theme` itself was not edited.
  - EDIT 2 DONE. `lib/field/theme.ts`. `d2d.theme`, default `auto`, try/catch on every read and write.
  - EDIT 3 DONE. `FieldThemeSync` sets the attribute and the theme-color meta, and clears both on unmount.
  - EDIT 4 DONE. Boot script is the first child of the field layout. `FieldThemeSync` sits beside the service-worker registration.
  - EDIT 5 DONE. `data-theme-island="light"` on the outcome column and the outcome buttons.
  - EDIT 6 DONE. Appearance on the You tab: Auto / Light / Dark.
  - Contrast **PASS**. Must-read dark pairs are at least 7:1. ink-muted is 5.83:1 on field-bg and 5.20:1 on surface (floor 4.5:1).
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint components/field lib/field "app/(field)"`: **PASS** — exit 0.
  - `git grep` hex under `components/field/ui`: **PASS** — no lines.
  - `npm run verify:ui1`: **PASS** — exit 0, once.
  - `npm run verify:stage8b`: **PASS** — exit 0, once.
  - (a) Logger, Leads, You in dark: **PASS** for the shell. Outcome column and Notes: **NOT VERIFIED** — no prop on London 2026-10-03.
  - (b) Logger in light: **PASS** — background `rgb(244, 245, 247)`, the empty-state copy, light tab bar.
  - (c) Auto follows `prefers-color-scheme` without a reload: **PASS**.
  - (d) Hard load, Dark saved, no light flash: **PASS** by script order (boot script before `.field-root`) and the first DOM read already dark while the logger was still loading. Not a frame recording.
  - (e) Admin: **PASS** for an admin session in the same tab. No `data-field-theme`, meta `#fbfaf8`, light draw page. CanvasserX is redirected to `/field`.
  - (f) Meta `#161a20` in dark on Logger, Leads and You, and `#fbfaf8` in light: **PASS** after the head watcher.
- **Deviations from brief:** `FieldThemeSync` watches `document.head`, because a tab change was putting `theme-color` back to `#fbfaf8`. Appearance buttons also use `rounded-field-sm text-sm font-semibold`. The dev server that was already running had stopped answering and was started once.
- **Not done / deferred:** Outcome column and Notes on a dark screen. A phone. Sun, wet thumb, one-handed use. Did not commit. Did not change any work date.
- **Follow-ups:** Option A still needs a screenshot on a day when CanvasserX has a prop. D2 darkens the map.

---

### UI item 3 — Dark-mode fixes, Session D1b
- **Date:** 2026-10-03
- **Model:** Grok 4.7
- **Built:** Three fixes from Claude's review of D1. Sheet scrim uses `--color-scrim`. Map START and END badges use paper text. The theme effect reads the live preference. No migration. No sync change.
- **Acceptance:**
  - EDIT 1 DONE. `components/field/sheet.tsx` backdrop `bg-scrim/45`. Comment: `2026-10-03 D1b: scrim token, not ink (ink flips to near-white in dark).`
  - EDIT 2 DONE. `components/field/map-tab.tsx` START and END: `text-white` became `text-paper`. Nothing else in that file.
  - EDIT 3 DONE. `lib/field/theme.ts` exports `currentResolvedTheme()`. `field-theme-sync.tsx` uses it for the dataset write, `applyThemeColor`, and each head-observer callback. Effect dependency stays `[resolved]`.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint components/field lib/field`: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0, once.
  - `git grep -n "bg-ink/" -- components/field`: one line, `components/field/prop-status.tsx:73`, a grid gap. Not a full-screen backdrop.
  - (a) Logger, Dark, outcome column light: **PASS**. Southville solo 2, 1,730 doors. 390×763 (`innerWidth` 391). Lead fill `rgb(99, 185, 137)`.
  - (b) Notes sheet, Dark, backdrop darkens: **PASS**. `bg-scrim/45`, computed `oklab(0 0 0 / 0.45)`.
  - (c) Map door panel, outcome buttons light: **PASS**. Lead `rgb(30, 107, 58)`, text `rgb(251, 250, 248)`. START and END text `rgb(31, 36, 44)` on `#7ad3a0` and `#ff9b9b`.
  - (d) Hard reload, Dark saved, `data-field-theme` never `"light"`: **NOT VERIFIED**. The sequence was not printed.
  - (e) Pref Light, Logger and Notes unchanged: **NOT VERIFIED**. No light screenshot.
- **Deviations from brief:** The IDE hard reload did not return. A headless retry was stopped before it printed. `app/layout.tsx` was not edited. A hydration warning pointed at that file's `<html>` and the diff was not captured.
- **Not done / deferred:** Checks (d) and (e). A phone. Sun, wet thumb, one-handed use. Did not commit. Did not change any work date. No knock was logged.
- **Follow-ups:** Print the hard-reload `data-field-theme` sequence with Dark saved. One light screenshot of Logger with the Notes sheet open.

---

### UI item 3 — Dark map, Session D2
- **Date:** 2026-10-03
- **Model:** Grok 4.7
- **Built:** The field Map tab and the Logger mini map follow the resolved theme. Light colours are the previous constants. Admin callers pass no mode and stay light. `<html>` suppresses its own hydration warning. No migration. No sync change.
- **Acceptance:**
  - EDIT 0 DONE. `app/layout.tsx` `<html suppressHydrationWarning>` plus the dated D2 comment. Viewport, body and metadata unchanged.
  - EDIT 1 DONE. `mapColours(mode)` in `lib/map/map-palette.ts`. Light constants kept. Dark sets and `MAP_UI` added. Listed light UI hexes matched `field-map.tsx`. Compact halo stays the position colour (`#1b4aa6`), not the full-map halo.
  - EDIT 2 DONE. `restyleBasemap(style, mode = "light")`. `restyleReport` unchanged.
  - EDIT 3 DONE. `fieldMapStyle(mode)` and `fallbackStyle(mode)`. `FALLBACK_STYLE` is the light fallback.
  - EDIT 4 DONE. `routeColours`. Light route unchanged: `verify:ui4` near `#dc9476`, far `#e7b9a5`, focus `#c2410c`, done `#a3a9ae`. Chevron sprite stays `#ffffff`.
  - EDIT 5 DONE. `FieldMap` `mode` read once. `git grep` hex in `components/field/field-map.tsx`: 0 lines.
  - EDIT 6 DONE. Map tab `key={mode}`. Legend uses `mapColours(mode).dot` and `routeColours(mode)`. Mini map takes `mode`. Logger passes `useResolvedTheme()`.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint components/field lib/field lib/map`: **PASS** — exit 0.
  - `npm run verify:ui4`: **PASS** — exit 0, once.
  - `npm run verify:ui1`: **PASS** — exit 0, once.
  - `npm run verify:anchors`: **PASS** — exit 0, once. 2,000 doors / 60 steps: 7.66 ms (anchor maths, not a dark paint).
  - Contrast, dark, ground `#2b3341`: label 7.95:1, open ring 7.61:1, lead 5.07:1, answered 4.01:1, no_opportunity 5.36:1, no_answer 4.93:1, other 7.61:1. Open fill is the ground, 1.00:1.
  - Chrome, CanvasserX, Southville solo 2, 1,730 doors. Emulation 390×763 (`innerWidth` 391).
  - (a) Dark Map 2D, dark Map 3D, dark Logger: **PASS** — screenshots taken. Legend hexes matched the dark sets.
  - (b) Not In dot and building tint: **PASS** for the colours on the 2D screenshot (`#9AA2AC` against `#9aa2ad`, `#4C525C` against `#4b525c`). Undo: **FAIL**. The ring expired. The row synced. See below.
  - (c) Dark → Light, back to the Map: **PASS**. One `.maplibregl-map`. Legend colours are the light constants. Screenshot taken.
  - (d) 2D/3D survives a theme switch: **PASS**. `d2d.mapView` stayed `3d`. Button `2D`, pressed.
  - (e) `/admin` coverage still light: **NOT VERIFIED**. Not opened.
  - (f) Dark load, no `<html>` hydration warning: **NOT VERIFIED**. The console hook did not appear on the loaded page (`window.__d2dLogs` missing). No error dialog in the accessibility tree. That is not a console print.
  - Point count on screen: 1,730 doors. Device: desktop Chrome, emulation, not a phone.
- **Deviations from brief:** Port 3000 was already taken, so this session's dev server is `http://localhost:3001`. It was started once and not restarted. `fetch /health` returned 200 while `navigator.onLine` was false, and the undo window then expired. Figma frames were not opened.
- **Not done / deferred:** Admin coverage. A captured hydration console. A 2,000-door dark paint. A phone. Did not commit. Did not change the work date. Did not delete the synced knock.
- **Follow-ups:** Owner decides `knock_events` `730525dc-7e2f-42c8-a3d5-6291949edcc7` (no_answer, UPRN 114486, 2026-10-03 20:23:38.486+00). Then check `/admin` coverage is still light, and print the console from a Dark hard load of `/field`.

---

### UI-5 Session A1 — Door eligibility in the database
- **Date:** 2026-10-03
- **Model:** Grok 4.7
- **Built:** Migration 025. Generated `properties.is_knockable` (not NCCZ, and fewer than 3 units). `refresh_door_eligibility()` backfilled once. `count_knockable`, `properties_in_polygon`, `route_walk_inputs` and `allocate_prop` read `is_knockable`. `todays_assignment` adds a `knockable` flag. Snapshot, sequence and `door_count` are unchanged. Ingest scripts call the refresh after UPRN and address loads. NCCZ names read `CCZONE` first. No component, no field write path, no ingest run.
- **Acceptance:**
  - EDIT 1 DONE. `supabase/migrations/025_door_eligibility.sql` pasted as given. Next free number was 025. `apply_migration` name `025_door_eligibility` returned success. Not retried.
  - EDIT 2 DONE. `npx supabase gen types typescript --project-id xerxsaptwpvhkkpyvkfi --schema public`. `properties` Row has `units_at_point`, `units_at_address`, `is_multi_unit`, `is_knockable`. `refresh_door_eligibility` is under Functions. `git diff --stat` on `lib/supabase/types.ts` is 13 insertions.
  - EDIT 3 DONE. `DoorProperties` in `lib/geo/todays-assignment.ts` is `{ uprn: number; sequence: number; knockable?: boolean }`. Nothing else in that file.
  - EDIT 4 DONE. `DoorProperties` in `lib/geo/properties-in-polygon.ts` is `{ uprn: number; is_nccz: boolean; is_multi_unit?: boolean; is_knockable?: boolean }`. Nothing else.
  - EDIT 5 DONE. `scripts/ingest-uprn.ts` calls `refresh_door_eligibility` after `apply_nccz_flags` and logs the result. Script not run.
  - EDIT 6 DONE. `scripts/ingest-addresses.ts` calls `refresh_door_eligibility` after `ingestEpc()`. Script not run.
  - EDIT 7 DONE. `scripts/ingest-nccz.ts` `featureName` key list starts with `CCZONE`. Script not run.
  - Counts: **PASS** — total 424,952, multi-unit 110,760, NCCZ 13,270, knockable 303,003.
  - Privileges: **PASS** — `authenticated` EXECUTE on `refresh_door_eligibility()` is false. EXECUTE on `allocate_prop(uuid, date, uuid[])` is true. `allocate_prop` and `route_walk_inputs` bodies contain `and p.is_knockable`.
  - `knock_events`: **PASS** — 1,236 before the migration and 1,236 after the browser check.
  - `schema_migrations`: **PASS** — latest name `025_door_eligibility`, then `024_door_footprints`.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on `lib/geo` and the three ingest scripts: **PASS** — exit 0.
  - `git grep` of `units_at|multi_unit|is_knockable` in `*.ts` / `*.tsx`: `lib/supabase/types.ts`, the `DoorProperties` line in `lib/geo/properties-in-polygon.ts`, and the comment the prompt required in `scripts/ingest-addresses.ts` line 716. No eligibility rule in TypeScript. `todays-assignment.ts` uses `knockable`, so that line does not match this pattern.
  - Logger: **PASS**. Chrome, CanvasserX, `/field/logger`, REF - Speedwell, visit 5, 182 doors, door 1 Ventnor Road. `http://localhost:3002` (3000 was already taken). Emulation 390×763, `innerWidth` 390, `innerHeight` 763. Page GET 200. No error dialog. No resource with status 400 or above. A `console.error` hook installed after the load recorded an empty list. No door was logged.
- **Deviations from brief:** The given SQL comment says routes are regenerated in UI-5 Session A2. The plan's regeneration session is A3. The SQL was pasted exactly. Port 3000 was already in use, so this session's dev server is `http://localhost:3002`. It was started once and not restarted. `Page.addScriptToEvaluateOnNewDocument` did not run on the logger document, so the first paint was not hooked. The post-load hook was empty.
- **Not done / deferred:** Hiding doors (A2). Admin dots, counts, views and route regeneration (A3). Did not run any ingest script. Did not call `refresh_door_eligibility` again. Did not commit. Did not log a door. A phone.
- **Follow-ups:** Allocation of a prop will fail with `snapshot_mismatch` until A3 regenerates its routes. The synced knock `730525dc-7e2f-42c8-a3d5-6291949edcc7` is still the owner's to decide.

---

### TOOLING-1 A1 — queue runner scripts
- **Date:** 2026-10-04
- **Model:** Grok 4.7 (`grok-4.7-high`)
- **Built:** Owner tooling only. `scripts/agent/lib.ps1`, `scripts/agent/run-queue.ps1`, `scripts/agent/review-pack.ps1` and `scripts/agent/README.md`, pasted as given. Rule 50 gained the headless-runner section. No app code, no database, no migration, no dependency.
- **Owner decisions (2026-10-04):**
  - T1 — A headless queue runner (`scripts/agent/run-queue.ps1`, Cursor CLI) may run Grok sessions unattended. Only the runner commits, only on `run/*` branches, as `wip(<session-id>)` checkpoints. Final commits land on `main` after Claude's review.
  - T2 — Claude may write prompt files into `.handoff/` (git-ignored). The rest of the repo stays read-only for Claude.
  - T3 — Runner sessions do no browser checks. Visual checks move to the owner's phone check.
  - T4 — A prompt whose runner block says `gate: human` (any migration, RLS, sync-queue or database write) always stops the queue after it.
  - T5 — Runner default model: `grok-4.7-high`.
- **Acceptance:**
  - EDIT 1 DONE. `scripts/agent/lib.ps1` created as given.
  - EDIT 2 DONE. `scripts/agent/run-queue.ps1` created as given.
  - EDIT 3 DONE. `scripts/agent/review-pack.ps1` created as given.
  - EDIT 4 DONE. `scripts/agent/README.md` created as given.
  - EDIT 5 DONE. One blank line, then the headless-runner section, appended to `.cursor/rules/50-plan-execution.mdc`. Nothing else in that file was changed.
  - C1 parse: **PASS** — `lib.ps1`, `run-queue.ps1`, `review-pack.ps1` each `0 parse errors`.
  - C2 ASCII: **PASS** — `Select-String` on `scripts\agent\*.ps1` printed nothing.
  - C3 ignore: **PASS** — `.handoff/queue/probe.md` matches `.gitignore:57:/.handoff/`. `Claude outputs/probe.md` matches `.gitignore:58:/Claude outputs/`. `tsconfig.tsbuildinfo` matches `.gitignore:59:*.tsbuildinfo`. No extra ignore line is required.
  - C4 CLI: **PASS** — `agent.ps1`, ExternalScript, `C:\Users\nomaa\AppData\Local\cursor-agent\agent.ps1`.
  - C5 dry run: **PASS** — session `dryrun-sample`, `gate: auto`, `edits: 1,2`, `allow: docs/example.md`, `checks: git --version`. WARN: working tree not clean (8 changed files). Last line: `Dry run finished. Nothing was run or changed.` Branch `main` before and after. Sample prompt deleted.
  - C6 review pack: **PASS** — `Review pack written: .handoff/review/tooling-1-a1.md`. New untracked files are the four `scripts/agent/` files.
  - C7 working tree: **FAIL** — ten paths, not the expected seven. The extra three were already modified before this session. Nothing under `.handoff/` or `Claude outputs/`.
  - C8 no commit: **PASS** — `ba22e49 tooling-1: phone ping on agent stop, hand-off folders ignored, report-to-file rule`, same as the start.
- **Deviations from brief:** The working tree was already dirty before any edit in this session: `components/field/field-data-provider.tsx`, `lib/field/route-display.ts`, `lib/geo/todays-assignment.ts`. They were not read and not edited. C7 therefore cannot list only the seven paths this session owns. The pasted scripts were not changed to force a pass. `run-queue.ps1` was not run without `-DryRun`.
- **Not done / deferred:** A real queue run. A phone ping. No UI, so no phone check. Did not commit.
- **Follow-ups:** Claude reviews the pack. The three pre-existing dirty files are not part of TOOLING-1 A1.

---

### UI-5 Session A2 — Hide non-knockable doors in the field app
- **Date:** 2026-10-04
- **Model:** Grok 4.7
- **Built:** One filter, `knockableOnly`, drops doors the database marks `knockable: false`. It runs in `FieldDataProvider` on the cached payload and on the fresh payload. The Dexie cache stays the full snapshot. A door with no `knockable` key is kept. `sequence` on each kept door is the original snapshot index. `describeRoute` decides "off route" from that snapshot position against `snapshot_door_count`, not from the filtered array index. Building slices for a hidden door are dropped. Shared slices (`uprn` null) stay.
- **Acceptance:**
  - EDIT 1 DONE. `snapshot_door_count` and `knockableOnly` added to `lib/geo/todays-assignment.ts`. The function body is the text from the prompt.
  - EDIT 2 DONE. `knockableOnly` wraps both cache reads and the fresh payload in `components/field/field-data-provider.tsx`. `cacheAssignment(result.assignment, uid)` is still the unfiltered payload. `describeRoute` receives `snapshot_door_count`. `visibleFootprints` filters slices in a `useMemo`. The context value exposes `shownFootprints`.
  - EDIT 3 DONE. `describeRoute` takes `snapshotLength` (default `sequence.length`). Both stranded tests use `door.position` only. The unused `index` argument was removed.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - `npx eslint components/field lib/field lib/geo`: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0. It does not assume an unfiltered sequence.
  - `npm run verify:anchors`: **PASS** — exit 0. 2,000 doors / 60 steps: 10.02 ms. That is the anchor maths, not a filtered paint.
  - `npm run verify:stage8b`: **PASS** — exit 0. The script created and deleted its own throwaway rows.
  - `git grep -n "knockable" -- "*.ts" "*.tsx"`: **NOT** limited to the four named files. The word already appears in admin counts, `count_knockable`, allocate, coverage, completion and verify scripts. This session adds it in `todays-assignment.ts`, `field-data-provider.tsx`, and a comment in `route-display.ts`. No TypeScript eligibility rule (no 3-unit test, no No Cold Calling test).
  - Logger: **PASS**. Chrome, CanvasserX, `/field/logger`, TEST - dry run, visit 3. Emulation 390×763 (`innerWidth` 391, `innerHeight` 763). Header "53 doors". Plate "Door 2, Harbury Road, 1 of 53". Provider: `door_count` 53, `snapshot_door_count` 88, `fromCache` false, cursor index 0, cursor position 1, UPRN 348735, stranded 0. Screenshot `ui5-a2-logger-53.png`.
  - Map source `field-doors` data: **PASS** — 53 features. Sequences start at 1 and skip 0, 10–19, 63–83 and 85–87. `querySourceFeatures` returned 82, which repeats features across tiles.
  - Offline Not In: **PASS**. `navigator.onLine` false. `fetch('https://example.com/')` threw `TypeError: Failed to fetch`. `fetch /health` still returned 200, and the Supabase health URL still returned 401, including after `Network.setBlockedURLs`. The queue does not flush while `onLine` is false. Outbox row `10fe004b-652d-4941-b4b0-6552f2f57424`, status `held_undo`, outcome `no_answer`, UPRN 348735, `sequence_position` 1 (the snapshot index, not index 0 of the 53). Undo removed it before the network was restored. Open outbox rows after undo: 0.
  - `knock_events`: **PASS** — 1,240 at the start of the session and 1,240 after the undo. That `client_event_id`: 0 rows. CanvasserX rows with `occurred_at` on or after 2026-10-04 14:00 UTC: 0.
  - End-of-prop screen: **NOT VERIFIED**. It renders only when every door is logged. The count it reads is `assignment.door_count`, which is 53.
  - Point count on screen: 53 door features in the map source. Device: desktop Chrome with device-metrics emulation, not a phone.
- **Deviations from brief:** The first browser navigation hung because the browser had been shut down. The checks were completed later on a new tab. Dev servers on 3000, 3001 and 3002 were down, so `npm run dev` was started once at `http://localhost:3000`. It was not restarted. The browser was already signed in as CanvasserX. A magic link was minted and verified in Node (`expires_at` 1791127096) and was not opened, because its redirect target was the production site.
- **Not done / deferred:** Admin dots, counts, completion and coverage views, and route regeneration (A3). Survey Overview (UI-6). A physical phone. A 2,000-door paint of the filtered map. The end-of-prop screen. Did not commit.
- **Follow-ups:** None for the field filter. A3 still has to regenerate routes before a new allocation can freeze.

---

### UI-5 Session A3a — Admin eligibility counts
- **Date:** 2026-10-04
- **Model:** Grok 4.7
- **Built:** Migration 026. `count_door_eligibility` and `nccz_zones_geojson` for the draw page. `v_prop_completion` knockable and remaining count knockable doors only. `coverage_map_payload` and `admin_dashboard` patched in place. A flat is not left to do. A hidden door that already has a knock stays on the coverage map. No component. No route regeneration.
- **Owner decisions:**
  - H1 (2026-10-03) — a door is not knockable in a No Cold Calling Zone or when its building holds 3+ units. The rule is `properties.is_knockable`.
  - H2 (2026-10-03) — nothing is deleted. Hidden doors keep their history.
  - H8 (2026-10-04) — regenerate routes for the 6 props that have them in Session A3c, not this one.
  - H9 (2026-10-04) — leave the 20 old open assignments as they are. No database writes.
  - H10 (2026-10-04) — the tenure layer (A4) is deferred until after UI-7.
- **Claude decisions:**
  - Knockable and remaining count knockable doors only, so a flat is never left to do.
  - The coverage map keeps a hidden door if it already has a knock.
  - `coverage_map_payload` and `admin_dashboard` are patched by a guarded regex replace of their live bodies.
  - `count_door_eligibility` is new. `count_knockable` stays.
- **Acceptance:**
  - EDIT 1 DONE. Next free number was 026. `supabase/migrations/026_eligibility_admin_counts.sql` pasted as given. Applied once. `schema_migrations` version `20261004144243`, name `026_eligibility_admin_counts`. Not retried.
  - EDIT 2 DONE. `lib/supabase/types.ts` has `count_door_eligibility` and `nccz_zones_geojson` under Functions. `git diff --stat` is 10 insertions. `npx tsc --noEmit` exit 0.
  - Completion row: **PASS** — assignment `1e9fe4c5-ffa6-46c7-80d8-9348267e477b`, knockable 53, worked 73, answered 52, remaining 1.
  - Zone outlines: **PASS** — `nccz_zones_geojson` features 26.
  - Privileges and patches: **PASS** — authenticated execute true, anon execute false, both bodies patched, view options `{security_invoker=true}`.
  - `knock_events`: **PASS** — 1,240 before the migration and 1,240 after.
  - `schema_migrations`: **PASS** — `026_eligibility_admin_counts`, then `025_door_eligibility`.
  - eslint on `lib/supabase/types.ts`: **PASS** — exit 0.
- **Deviations from brief:** Supabase MCP sign-in is desktop-only, so this headless session could not call `apply_migration` or `generate_typescript_types` as tools. The SQL went once to the Management API migrations endpoint with the name the prompt required. Types used `npx supabase gen types typescript --project-id xerxsaptwpvhkkpyvkfi --schema public`, the same command Session A1 recorded. Node then asserted in libuv on process exit, after HTTP 200. The migration row was read back. The SQL was not changed.
- **Not done / deferred:** Draw-page dots and count copy (A3b). Route regeneration (A3c, H8). The 20 old assignments (H9). Tenure (H10, after UI-7). A browser. A phone. Did not commit.
- **Follow-ups:** Claude to accept the Management API apply. A3b and A3c still to come. Allocating a prop still fails with `snapshot_mismatch` until routes are regenerated.

---

### UI-5 Session A3b — Draw page flats and No Cold Calling
- **Date:** 2026-10-04
- **Model:** Grok 4.7
- **Built:** The admin draw page reads `count_door_eligibility`. The tally says knockable, flats, and no cold calling. Door dots have three states (solid blue, hollow oxide, hollow ink). No Cold Calling zone outlines load once from `nccz_zones_geojson` and fail open. No migration. No database write.
- **Owner decisions:**
  - H1 (2026-10-03) — a door is not knockable if it is in a No Cold Calling Zone or its building holds 3+ units. The database decides (`properties.is_knockable`, migrations 025/026).
  - H2 (2026-10-03) — nothing is deleted.
- **Claude decisions:**
  - The draw page reads `count_door_eligibility` (migration 026). total = knockable + flats + No Cold Calling. `excluded` stays on the type (= flats + No Cold Calling).
  - Door dots, three states, by shape as well as colour: knockable solid `--color-prop`; No Cold Calling hollow `--color-oxide` ring 1.6; flat hollow `--color-ink-soft` ring 1.0.
  - Zone outlines sit under the dots: oxide fill at 0.08 opacity plus a 1.2px oxide outline. Loaded once from `nccz_zones_geojson()`. Fails open if the call fails.
  - Admin keeps its own CSS tokens via the existing `token()` helper. `lib/map/map-palette.ts` was not touched.
  - `count_knockable` callers outside these files were not touched.
- **Acceptance:**
  - EDIT 1 DONE. `lib/geo/count-knockable.ts` pasted as given. RPC arg and return types match `count_door_eligibility`.
  - EDIT 2 DONE. `lib/geo/nccz-zones.ts` pasted as given.
  - EDIT 3 DONE. Readout is "N knockable · N flats · N no cold calling". Doc comment sentence appended.
  - EDIT 4 DONE. Circle colour, stroke width and stroke colour replaced as given. Radius unchanged.
  - EDIT 5 DONE. `NCCZ_SOURCE` added before the door source. `setData` is gated on `getSource`. No `beforeId`.
  - `npx tsc --noEmit`: **FAIL** — `scripts/verify-stage-5b-r3.ts(349,35)`: `{ knockable: 1225, excluded: 10, total: 1235 }` is missing `multiUnit` and `nccz` for `propWarnings` (`lib/geo/prop-warnings.ts`). Not an RPC type error. The pasted type was not rewritten. The script is outside the allow list and was not edited.
  - eslint on the four session files: **PASS** — exit 0.
  - `git grep count_knockable`: **FAIL** against "only `lib/supabase/types.ts`". Also `lib/geo/prop-polygon.ts` (comment), `lib/geo/properties-in-polygon.ts` (comment), `scripts/verify-stage-4.ts` (RPC caller). Those files were not edited.
  - `git grep is_multi_unit`: **PASS** — `components/admin/prop-drawer.tsx` and `lib/geo/properties-in-polygon.ts` only.
- **Deviations from brief:** none in the pasted code. The project typecheck does not pass because `KnockableCount` gained two required fields and one existing script literal was not updated.
- **Not done / deferred:** A browser and a phone (headless). Route regeneration (A3c). The `propWarnings` call in `scripts/verify-stage-5b-r3.ts`. Did not commit.
- **Follow-ups:** Claude to say whether `scripts/verify-stage-5b-r3.ts` line 349 should gain `multiUnit` and `nccz`, or whether those fields should be optional. `scripts/verify-stage-4.ts` still calls `count_knockable`.

---

### UI-6 Session B1 — Mini map rotate and recentre
- **Date:** 2026-10-04
- **Model:** Grok 4.7
- **Built:** The Logger mini map pans, pinches and rotates. Pitch stays a coded 3D setting. Keyboard stays off. After the canvasser moves the camera, a 44px target button at the bottom-right eases back to the current door, north-up, and hides. A door change still eases to that door, hides the button, and keeps the bearing. No GPS arrow.
- **Owner decisions:**
  - P2.2 (field test 2026-10-03) — the mini map gets one-finger pan, pinch zoom, two-finger rotate, and a clear recentre control after manual exploring. The GPS arrow comes later (UI-7).
  - 2026-10-04 — the plan is approved (Claude's design).
- **Claude decisions:**
  - Compact rotation is on (two-finger twist, plus right-drag on desktop). Pitch gesture and keyboard stay off.
  - The recentre button appears only after a camera move with an `originalEvent`. Tap eases to the current door at the compact zoom, bearing 0, and the button hides.
  - A door change still re-centres and hides the button. That ease keeps the current bearing.
  - The button is 44px, round, bottom-right. New `LocateIcon`.
- **Acceptance:**
  - EDIT 1 DONE. `LocateIcon` appended to `components/field/icons.tsx` as given.
  - EDIT 2 DONE. Compact map disables only `touchPitch` and `keyboard`. Comment and variant doc line updated as given.
  - EDIT 3 DONE. `flyToDoor` takes an optional last `bearing`. Both `jumpTo` and `easeTo` spread it only when it is defined.
  - EDIT 4 DONE. `onUserMove` and `recenterNonce` added. Compact `movestart` sets moved only when `originalEvent` is set. Door-change ease calls `onUserMove(false)`. Recentre effect eases with bearing 0.
  - EDIT 5 DONE. Mini map holds `moved` and `recenterNonce`, passes both into `FieldMap`, and shows the recentre button after the open-map button.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the three field files: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0.
  - `npm run verify:anchors`: **PASS** — exit 0. 2,000 doors / 60 steps: 3.71 ms. That is the anchor maths, not a paint of this gesture.
  - `git grep` `disableRotation` / `dragRotate.disable` in `field-map.tsx`: **PASS** — no lines.
  - `git grep` 6-digit hex in `field-map.tsx`: **PASS** — no lines.
  - iPhone rotate, pinch, pan and recentre: **NOT VERIFIED**. No browser. Headless session.
  - Door swipe on a phone: **NOT VERIFIED**. `verify:ui1` door-scroll checks passed. `logger-tab.tsx` was not edited.
  - Map tab: **NOT VERIFIED** in a browser. The full-variant branch was not given a new gesture disable. Existing `flyToDoor` callers pass no bearing.
- **Deviations from brief:** none
- **Not done / deferred:** The four phone checks. A painted map at 2,000 doors. GPS arrow (UI-7). Logger tabs (UI-6 B2). Did not commit.
- **Follow-ups:** Owner phone check. UI-6 B2 is not started.

---

### UI-6 Session B2a — Survey Overview rows
- **Date:** 2026-10-04
- **Model:** Grok 4.7
- **Built:** A pure function, `surveyRows`, turns the Logger sequence into Survey Overview rows: one door row per knockable door, in route order, and a street header whenever the street changes. Address text is house number, else building name, else `<street> · door N`. The code comes from this device's latest local outcome. A teammate knock with no local outcome leaves the code empty and stores the first name. `surveySummary` counts knocked and still to go. Checked by `npm run verify:ui6`. No React.
- **Owner decisions (2026-10-04):**
  - B2-1 — the Survey Overview is a second Logger view, switched by small scrollable pills under the prop name and visit line.
  - B2-2 — tapping a row jumps to that door in Logging. No logging from the table.
  - B2-3 — the outcome column is a short code in the outcome colour: L Lead, C Contact, R Rented/Council, NI Not In, O Other. Empty (to knock) shows a dashed empty pill.
  - B2-4 — a door with no address reads `<street> · door N`, where N is its 1-based place in the Logger's list.
- **Claude decisions:**
  - This session builds only the pure function and its check script. No React, no Dexie, no network. B2b draws it.
  - Rows are the Logger's own sequence (knockable doors only), in route order, with a street header each time the street changes.
  - Street per door: the route step's street first, else the address street, else `Unnamed road`.
  - Address text: house number plus street, else building name plus street, else the B2-4 fallback.
  - The outcome is this device's latest local outcome, so it works offline. A teammate's knock without a local outcome shows as to-knock with `knockedBy` set. The code stays empty.
  - `not_interested` (legacy rows) maps to O.
  - Type imports only from Dexie-backed modules, so the verify script runs under tsx with no browser.
- **Acceptance:**
  - EDIT 1 DONE. `lib/field/survey-rows.ts` pasted as given. `LocalOutcome.outcome` and `knockedBy.firstName` are present. `npx tsc --noEmit` exit 0.
  - EDIT 2 DONE. `scripts/verify-ui-6-survey.ts` uses `check()`, relative imports, and in-script fixtures. No `any`. No `as unknown as`.
  - EDIT 3 DONE. `package.json` gained `"verify:ui6": "tsx scripts/verify-ui-6-survey.ts"` next to `verify:ui1`. No other change. No new dependency.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on `lib/field/survey-rows.ts` and `scripts/verify-ui-6-survey.ts`: **PASS** — exit 0.
  - `npm run verify:ui6`: **PASS** — exit 0. Nine outcome codes, three address cases, street fallback, five-door street headers, current index, local-versus-teammate, summary 3 knocked and 2 to go.
  - Phone: **NOT VERIFIED**. This session is data only. B2b covers the phone.
- **Deviations from brief:** none
- **Not done / deferred:** The Logger pills, the table, and the tap-to-jump (B2b). A browser. A phone. Did not commit.
- **Follow-ups:** UI-6 B2b draws the Survey Overview from these rows.

---

### UI-6 Session B2b — Logger view pills and Survey Overview
- **Date:** 2026-10-04
- **Model:** Grok 4.7
- **Built:** The Logger has scrollable `Logging` and `Survey` pills under the prop name and the visit line. Survey replaces the door panel, stats, mini map and note bar with a fixed-height list built from `surveyRows`. Tapping a row returns to Logging on that door. The view is kept in `sessionStorage` for the tab session. Header, team strip and sheets stay in both views.
- **Owner decisions (2026-10-04):**
  - B2-1 (revised) — the Logger's views are small scrollable pills (`Logging`, `Survey`) under the prop name and the visit line. More views may be added later; the row scrolls sideways.
  - B2-2 — tapping a row switches to Logging on that door. No logging from the table.
  - B2-3 — code chips L / C / R / NI / O in the outcome colours. A dashed empty pill means still to knock.
  - B2-4 — a door with no address reads `<street> · door N` (built in B2a).
- **Claude decisions:**
  - Each pill looks 28px tall, but the button is 44px. The row uses `-my-2` so the header only grows by the pill height.
  - The chosen view is remembered per tab session in `sessionStorage`, wrapped in try/catch. A failure stays on Logging.
  - In Survey view the door panel, stats, mini map and note bar are replaced by the list. Header, team strip and sheets stay.
  - The list draws only the rows on screen. Fixed heights: door 48px, street 32px, a 900px window plus 8 rows overscan. No measuring and no setState inside effects. No new dependency. A street label pinned at the top shows the street of the first visible row.
  - On opening Survey, the list scrolls so the current door is near the top third.
  - Colours are tokens only. The current door uses `bg-prop/10` and a 4px `border-prop` left bar.
- **Acceptance:**
  - EDIT 1 DONE. `components/field/ui/view-tabs.tsx` pasted as given.
  - EDIT 2 DONE. `components/field/survey-overview.tsx` pasted as given. eslint accepted the inline `style` and the `rowAt` non-null assertions.
  - EDIT 3 DONE. Imports, the module-level view helpers, the `view` state, `survey` and `pickFromSurvey`, the header pills, and the Survey swap are in `logger-tab.tsx`. `routeStreet` is present. The first `tsc` failed because an existing local was also named `view`. That local was renamed to `routeDoor`. The pasted blocks were not rewritten. Second `tsc` exited 0.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the three field files: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0.
  - `npm run verify:ui6`: **PASS** — exit 0.
  - `git grep` 6-digit hex in the two new files: **PASS** — no lines.
  - `git grep` `localStorage` in `logger-tab.tsx`: **PASS** — no lines.
  - Phone checks: **NOT VERIFIED**. No browser. Headless session.
- **Deviations from brief:** The existing route-door local `view` was renamed to `routeDoor` so the mandated Logger view state could compile. First `tsc` errors: TS2451 redeclare `view`; TS2339 `cards` and `routeStreet` missing on `LoggerView`.
- **Not done / deferred:** The seven phone checks. A browser. Did not commit.
- **Follow-ups:** Owner phone check of the pills, the list, tap-to-jump, offline codes, addressless labels and dark mode.

### UI-7 Session C0 — brief amendment and tooling (Claude, docs only)
- **Date:** 2026-10-04
- **Model:** Claude (Cowork), edited directly with the owner's permission. No Grok session.
- **Built:**
  - `docs/D2D-Build-Brief.md`: dated amendments to invariant 7, Section 8 (Reason 1–3 consequences, DPIA / LIA / notice / solicitor to-do) and Stage 16 (requirement table, acceptance changes).
  - `docs/FIELD-TEST-BUILD-PLAN.md`: owner decisions U7-1..U7-5, tracker C0 row, §6 note with the UI-7 session list.
  - `.cursor/rules/30-sync.mdc`, `.cursor/rules/20-field-ui.mdc`: the live-position exception (`lib/field/position-share.ts` only, never queued).
  - `.cursor/skills/geo-position/SKILL.md`: new skill.
- **Owner decisions:** U7-1 sharing on by default with a Stop pill; U7-2 one send every 30 s (scalar + admin position together); U7-3 admins see position off route; U7-4 recentre to GPS when the fix is 30 m or better, else the door; U7-5 "Live now" panel on `/admin/dashboard` until UI-10.
- **Claude decisions:** the "you" marker is violet (never an outcome colour); Figma section "UI-7 GPS (2026-10-04)" on page 5:2.
- **Acceptance:** owner read-through: **NOT VERIFIED** yet.
- **Not done / deferred:** DPIA, legitimate interests assessment, canvasser notice, solicitor (Section 8 to-do).

---

### UI-7 Session C1a — position maths (pure)
- **Date:** 2026-10-05
- **Model:** Grok 4.7
- **Built:** Pure position maths in `lib/field/geo.ts`: route snap with continuity, distance along the route in server metres, near-you chip hysteresis, the 30 s send throttle, and heading. Checked by `npm run verify:ui7`. No React, no browser API, no network, no storage. Nothing in this file stores or sends a coordinate.
- **Owner decisions:**
  - OWNER — H3 (2026-10-03): continuous GPS while the app is open; a direction arrow on both maps; a "near you" door chip; the route position goes to the partner.
  - OWNER — H5 (2026-10-03): raw current position to admins, overwritten, no trail, cleared at close, visible indicator, foreground only.
  - OWNER — U7-1 (2026-10-04): sharing on by default, with a Stop pill.
  - OWNER — U7-2 (2026-10-04): one send every 30 s (scalar and admin position together), skipped under 10 m, 2-minute heartbeat.
  - OWNER — U7-3 (2026-10-04): admins see position off the route too.
  - OWNER — U7-4 (2026-10-04): mini map recentre goes to you (heading-up) when the fix is 30 m or better, else the door.
  - OWNER — U7-5 (2026-10-04): admin "Live now" panel on `/admin/dashboard` until UI-10.
- **Claude decisions:**
  - CLAUDE — Figma page "Logger — clean build" (5:2), section "UI-7 GPS (2026-10-04)". The "you" marker is violet (`#6741d9` light, `#a58bff` dark), never an outcome colour.
  - CLAUDE — this session builds only the pure maths and its check script. C1b and C2 use it.
  - CLAUDE — `route_geom` walks most streets twice, so snapping uses continuity from the previous place. A backward move costs 4 times a forward one, so the end of a street turns onto the return pass.
  - CLAUDE — every along value is in server metres, scaled to the last step's `cumulative_m`, so the partner scalar matches `assignments.route_length_m`.
- **Acceptance:**
  - EDIT 1 DONE. `lib/field/geo.ts` pasted as given. `npx tsc --noEmit` exit 0.
  - EDIT 2 DONE. `scripts/verify-ui-7-geo.ts` pasted as given. Same `check()` style as `scripts/verify-ui-6-survey.ts`.
  - EDIT 3 DONE. `package.json` gained `"verify:ui7": "tsx scripts/verify-ui-7-geo.ts"` on the line after `verify:ui6`. No other change. No new dependency.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on `lib/field/geo.ts` and `scripts/verify-ui-7-geo.ts`: **PASS** — exit 0.
  - `npm run verify:ui7`: **PASS** — exit 0. Route length 500 m, both street passes, spur, server scale 450→90, turnaround onto the return pass, chip walk both ways, hysteresis, send throttle, heading, weak fix, partner gap, map position.
  - `git grep -n "navigator.geolocation"`: **PASS** — no call site. `components/field/geo-provider.tsx` is not in the repo yet. Hits are comments and documents only.
  - Phone: **NOT VERIFIED**. This session is pure maths. No phone check.
- **Deviations from brief:** none
- **Not done / deferred:** GPS provider, arrow, recentre and the location-off notice (C1b). The near-you chip in the Logger (C2). Position sharing (C3). A browser. A phone. Did not commit.
- **Follow-ups:** UI-7 C1b uses this maths for the watch and the arrow.

---

### UI-7 Session C1b — on-device GPS, the "you" marker, recentre
- **Date:** 2026-10-05
- **Model:** Grok 4.7
- **Built:** Foreground GPS and compass for the field shell. `GeoProvider` is the one `watchPosition` and the one orientation listener, mounted in the field layout. Both maps draw a violet "you" marker from memory. Mini-map recentre goes to you, heading-up, when the fix is 30 m or better, otherwise to the door. The Map tab has a locate button. Denied or unavailable location shows "Location off". `positionEnabled` stays false, so the Logger does not auto-advance. No storage and no network request.
- **Owner decisions:**
  - OWNER — H3 (2026-10-03): continuous GPS while the app is open; a direction arrow on both maps; a "near you" door chip; the route position goes to the partner.
  - OWNER — H5 (2026-10-03): raw current position to admins, overwritten, no trail, cleared at close, visible indicator, foreground only.
  - OWNER — U7-1 (2026-10-04): sharing on by default, with a Stop pill.
  - OWNER — U7-2 (2026-10-04): one send every 30 s (scalar and admin position together), skipped under 10 m, 2-minute heartbeat.
  - OWNER — U7-3 (2026-10-04): admins see position off the route too.
  - OWNER — U7-4 (2026-10-04): mini map recentre goes to you (heading-up) when the fix is 30 m or better, else the door.
  - OWNER — U7-5 (2026-10-04): admin "Live now" panel on `/admin/dashboard` until UI-10.
- **Claude decisions:**
  - CLAUDE — Figma page "Logger — clean build" (5:2), section "UI-7 GPS (2026-10-04)". The "you" marker is violet (`#6741d9` light, `#a58bff` dark), never an outcome colour.
  - CLAUDE — `components/field/geo-provider.tsx` holds the one `watchPosition` (high accuracy, only while the page is visible) and the one orientation listener. Fixes are React state only.
  - CLAUDE — Heading: compass (`webkitCompassHeading` on iOS after a tap; `deviceorientationabsolute` on Android), else GPS course above 0.5 m/s, else none (dot without a cone).
  - CLAUDE — The iOS compass permission is asked from the recentre button (mini map) and the locate button (Map tab), always inside a tap.
  - CLAUDE — A fix worse than 30 m is weak: grey dot, faint ring, no cone, and recentre goes to the door.
  - CLAUDE — Location denied or unavailable: a quiet "Location off" pill. Nothing else changes.
  - CLAUDE — No network request and no storage. `lib/field/position.ts` keeps auto-advance off.
- **Acceptance:**
  - EDIT 1 DONE. `lib/map/map-palette.ts` light and dark `you` / `youRing` / `youWeak`.
  - EDIT 2 DONE. New `components/field/geo-provider.tsx`, pasted as given.
  - EDIT 3 DONE. New `components/field/location-off-notice.tsx`, pasted as given.
  - EDIT 4 DONE. `GeoProvider` wraps the field `main` in `app/(field)/layout.tsx`.
  - EDIT 5 DONE. `components/field/field-map.tsx`: you marker (`you-are-here` id kept), position prop, recentre target. `FIELD_LAYER_ORDER` unchanged.
  - EDIT 6 DONE. `components/field/mini-map.tsx`: marker, recentre to you or the door, location notice, `overlay` slot.
  - EDIT 7 DONE. `components/field/map-tab.tsx`: marker, locate button, location notice.
  - EDIT 8 DONE. `lib/field/position.ts` comment replaced. `positionEnabled` is still `false`. `getRoutePosition()` still returns `null`.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the eight session files: **PASS** — exit 0.
  - `npm run verify:ui7`: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0.
  - `npm run verify:anchors`: **PASS** — exit 0. 2,000-door anchor timing 4.53 ms (existing anchor maths).
  - `git grep -n "navigator.geolocation"`: **PASS** for call sites. The new file is untracked, so the plain command lists comments and documents only. `git grep --untracked` lists the only executable calls in `components/field/geo-provider.tsx` lines 89 (`clearWatch`) and 95 (`watchPosition`).
  - Storage grep on `components/field/geo-provider.tsx`: **PASS** — no lines.
  - Phone: **NOT VERIFIED**. Headless session. No browser.
- **Deviations from brief:** none
- **Not done / deferred:** The near-you chip (C2). Position sharing, the Sharing pill and the admin live panel (C3). A browser. A phone. Did not commit.
- **Follow-ups:** UI-7 C2 adds the near-you chip in the mini-map `overlay` slot and the route-position scalar.

---

### UI-7 Session C2 — route snapping on the device and the near-you chip
- **Date:** 2026-10-05
- **Model:** Grok 4.7
- **Built:** On-device route snapping and the Logger "near you" chip. `FieldData` now exposes the frozen route line and its steps. `GeoProvider` snaps each good fix onto that line and keeps only the scalar (`routePlace.alongM`, server metres). Null more than 100 m from the route. The first fix is seeded from the current door. The chip shows the nearest door along the route after 2 agreeing fixes, and hides when that door is already current, or when off route, weak or unrouted. Tap jumps the cursor. The cursor does not move on its own. The label reuses the Survey address.
- **Owner decisions:**
  - OWNER — H3 (2026-10-03): continuous GPS while the app is open; a direction arrow on both maps; a "near you" door chip; the route position goes to the partner.
  - OWNER — H5 (2026-10-03): raw current position to admins, overwritten, no trail, cleared at close, visible indicator, foreground only.
  - OWNER — U7-1 (2026-10-04): sharing on by default, with a Stop pill.
  - OWNER — U7-2 (2026-10-04): one send every 30 s (scalar and admin position together), skipped under 10 m, 2-minute heartbeat.
  - OWNER — U7-3 (2026-10-04): admins see position off the route too.
  - OWNER — U7-4 (2026-10-04): mini map recentre goes to you (heading-up) when the fix is 30 m or better, else the door.
  - OWNER — U7-5 (2026-10-04): admin "Live now" panel on `/admin/dashboard` until UI-10.
- **Claude decisions:**
  - CLAUDE — Figma page "Logger — clean build" (5:2), section "UI-7 GPS (2026-10-04)". The "you" marker is violet (`#6741d9` light, `#a58bff` dark), never an outcome colour.
  - CLAUDE — GeoProvider snaps each good fix onto the frozen route line on the device and keeps only the scalar (`routePlace.alongM`, server metres). Null more than 100 m from the route. The coordinate is never kept.
  - CLAUDE — The first fix is seeded from the current door's place, so the right pass of the street is picked.
  - CLAUDE — The chip shows the door nearest you along the route after 2 agreeing fixes. It hides when that door is already the current door, or when off route, weak or unrouted. Tap jumps the cursor there. It never moves the cursor on its own.
  - CLAUDE — The chip label reuses the Survey address (`surveyAddress` / `surveyStreet`), including the `<street> · door N` fallback.
- **Acceptance:**
  - EDIT 1 DONE. `components/field/field-data-provider.tsx` exposes `routeLine` and `routeSteps`.
  - EDIT 2 DONE. `components/field/geo-provider.tsx` adds `routePlace` and `doorAlongsM`, and snaps each good fix on the device.
  - EDIT 3 DONE. New `components/field/near-you-chip.tsx`, pasted as given.
  - EDIT 4 DONE. `components/field/logger-tab.tsx` shows the chip on the mini map. `git grep` for `nearIndex` / `nearOverlay` before the paste returned nothing.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the four session files: **PASS** — exit 0.
  - `npm run verify:ui7`: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0.
  - `npm run verify:ui6`: **PASS** — exit 0.
  - `git grep -n "navigator.geolocation"`: **PASS** for call sites. Executable calls are only in `components/field/geo-provider.tsx` line 132 (`clearWatch`) and line 138 (`watchPosition`). Other hits are comments and documents.
  - Phone: **NOT VERIFIED**. Headless session. No browser.
- **Deviations from brief:** none
- **Not done / deferred:** Position sharing, the Sharing pill and the admin live panel (C3). A browser. A phone. The three phone checks. Did not commit.
- **Follow-ups:** UI-7 C3 sends the scalar and the admin position.

---

### UI-7 Session C3a — migration 027 live positions
- **Date:** 2026-10-05
- **Model:** Grok 4.7
- **Built:** Migration 027 and regenerated types. `live_positions` is one row per canvasser, updated in place. `report_position` writes the partner scalar and the admin row together and returns teammates' scalars. `stop_sharing_position` nulls both for the caller. `admin_live_positions` is admin-only, today's open visits, first name only. Triggers null both when an assignment closes and when a member leaves. No app code.
- **Owner decisions:**
  - OWNER — H3 (2026-10-03): continuous GPS while the app is open; a direction arrow on both maps; a "near you" door chip; the route position goes to the partner.
  - OWNER — H5 (2026-10-03): raw current position to admins, overwritten, no trail, cleared at close, visible indicator, foreground only.
  - OWNER — U7-1 (2026-10-04): sharing on by default, with a Stop pill.
  - OWNER — U7-2 (2026-10-04): one send every 30 s (scalar and admin position together), skipped under 10 m, 2-minute heartbeat.
  - OWNER — U7-3 (2026-10-04): admins see position off the route too.
  - OWNER — U7-4 (2026-10-04): mini map recentre goes to you (heading-up) when the fix is 30 m or better, else the door.
  - OWNER — U7-5 (2026-10-04): admin "Live now" panel on `/admin/dashboard` until UI-10.
- **Claude decisions:**
  - CLAUDE — Figma page "Logger — clean build" (5:2), section "UI-7 GPS (2026-10-04)". The "you" marker is violet (`#6741d9` light, `#a58bff` dark), never an outcome colour.
  - CLAUDE — `live_positions`: one row per canvasser, updated in place, nulled on close / leave / Stop. No insert, update or delete policy. Writes only through security-definer functions. Admin reads all; a canvasser reads only their own row.
  - CLAUDE — `report_position(p_assignment_id, p_lat, p_lon, p_route_position_m?, p_accuracy_m?, p_heading_deg?)`: today's (London) open visit only; writes the partner scalar and the admin row together and returns the teammates' scalars. Optional arguments default to null so the generated types mark them optional.
  - CLAUDE — `stop_sharing_position(p_assignment_id)` and `admin_live_positions()` (admin only, today's open visits, first name only).
  - CLAUDE — Triggers null both when an assignment closes and when a member leaves.
  - CLAUDE — This session writes only the migration and the regenerated types. No app code.
- **Acceptance:**
  - EDIT 1 DONE. `supabase/migrations/027_live_positions.sql` pasted as given. Last migration before it was `026_eligibility_admin_counts.sql`.
  - EDIT 2 DONE. `apply_migration` name `027_live_positions` returned success. `to_regclass` is `live_positions`. Policies `live_positions_select_admin`, `live_positions_select_own`. Privileges `anon_report=false`, `auth_report=true`, `anon_admin=false`. Both triggers present.
  - EDIT 3 DONE. Rolled-back proof message is exactly `TEST_RESULT visible=1 admin_row=0 not_admin=42501 half=22023 cx_rows=1 scalar=140.0 admin_sees=2 stop_row_null=1 leave_scalar_null=1 leave_row_null=1 close_scalar_null=1 close_row_null=1 total_rows=2`. After it, `live_positions` count is 0. Assignment `1bd12662-2b3e-4e9d-ac0f-09913906ca4b` is still `work_date` 2026-10-04, `closed_at` null.
  - EDIT 4 DONE. `lib/supabase/types.ts` replaced with `generate_typescript_types` output. `report_position` Args mark `p_route_position_m`, `p_accuracy_m` and `p_heading_deg` optional.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on `lib/supabase/types.ts`: **PASS** — exit 0.
  - `git grep -n "navigator.geolocation"`: **PASS** for call sites. Executable calls are only in `components/field/geo-provider.tsx` line 132 (`clearWatch`) and line 138 (`watchPosition`). Other hits are comments and documents.
  - Phone: **NOT VERIFIED**. Headless session. No browser. None for this session (database only).
- **Deviations from brief:** none
- **Not done / deferred:** Field sender, Sharing pill and admin Live now panel (C3b, C3c). A browser. A phone. Did not commit.
- **Follow-ups:** UI-7 C3b sends positions. UI-7 C3c is the admin Live now panel. C3b depends on the optional `report_position` arguments, which the generated types mark optional.

### UI-7 Session C3c — admin Live now panel
- **Date:** 2026-10-05
- **Model:** Grok 4.7
- **Built:** "Live now" is the first panel on `/admin/dashboard`. It polls `admin_live_positions()` every 30 s while the tab is visible and draws one violet dot per canvasser (first-name initial) with an accuracy ring. The list shows name · prop, on route / off route / last seen, and an ago label. Rows older than 10 min fade. Tap centres the map. No trail. `--color-you` added in light (`#6741d9`) and field dark (`#a58bff`).
- **Owner decisions:**
  - OWNER — H3 (2026-10-03): continuous GPS while the app is open; a direction arrow on both maps; a "near you" door chip; the route position goes to the partner.
  - OWNER — H5 (2026-10-03): raw current position to admins, overwritten, no trail, cleared at close, visible indicator, foreground only.
  - OWNER — U7-1 (2026-10-04): sharing on by default, with a Stop pill.
  - OWNER — U7-2 (2026-10-04): one send every 30 s (scalar and admin position together), skipped under 10 m, 2-minute heartbeat.
  - OWNER — U7-3 (2026-10-04): admins see position off the route too.
  - OWNER — U7-4 (2026-10-04): mini map recentre goes to you (heading-up) when the fix is 30 m or better, else the door.
  - OWNER — U7-5 (2026-10-04): admin "Live now" panel on `/admin/dashboard` until UI-10.
- **Claude decisions:**
  - CLAUDE — Figma page "Logger — clean build" (5:2), section "UI-7 GPS (2026-10-04)". The "you" marker is violet (`#6741d9` light, `#a58bff` dark), never an outcome colour.
  - CLAUDE — A "Live now" panel at the top of `/admin/dashboard`: MapLibre, field light style, one violet dot per canvasser (first-name initial) and an accuracy ring, plus a list: name · prop, "On route · 1.2 km of 1.9 km" / "Off route" / "Last seen", and "30 s ago".
  - CLAUDE — Polls `admin_live_positions()` every 30 s while the tab is visible. No realtime channel. Rows older than 10 min fade. Tap a row to centre on it.
  - CLAUDE — Current position only; no trail is drawn because none is stored.
  - CLAUDE — Adds the `--color-you` token (light + field dark) to `app/globals.css`, used here and by C3b.
- **Acceptance:**
  - EDIT 1 DONE. `--color-you: #6741d9` in `@theme`. `--color-you: #a58bff` on the field dark root. Both find-blocks occurred once.
  - EDIT 2 DONE. `lib/admin/live.ts` pasted as given.
  - EDIT 3 DONE. `components/admin/live-panel.tsx` pasted as given.
  - EDIT 4 DONE. `LivePanel` imported and placed as the first panel, titled "Live now", above "Prop completion — this visit".
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the three TypeScript files: **PASS** — exit 0. `app/globals.css` ignored (one warning, exit 0).
  - `npm run verify:ui7`: **PASS** — exit 0. All UI-7 geo checks passed.
  - `git grep -n "navigator.geolocation"`: **PASS** for call sites. Executable calls are only in `components/field/geo-provider.tsx` line 132 (`clearWatch`) and line 138 (`watchPosition`). Other hits are comments and documents.
  - `git grep -n "admin_live_positions" -- components lib`: plain git grep lists only `lib/supabase/types.ts:1369` because `lib/admin/live.ts` is untracked. `git grep -n --untracked` lists `lib/admin/live.ts` lines 8 and 36 and `lib/supabase/types.ts` line 1369. No other file under `components` or `lib`.
  - Phone: **NOT VERIFIED**. Headless session. No browser.
  - Map point count: **NOT VERIFIED**. No device. This layer is one dot per canvasser, not a 2,000-door layer.
- **Deviations from brief:** none. The pasted symbol layer uses `text-color` `#ffffff`, which matches `MAP_UI.light.youRing`. Left as given.
- **Not done / deferred:** Field sender and Sharing pill (C3b). A browser. A phone. Did not commit.
- **Follow-ups:** UI-7 C3b sends positions. The owner does the dashboard phone check once for the phase.

### UI-7 Session C3b — position sender, Sharing pill, partner distance
- **Date:** 2026-10-05
- **Model:** Grok 4.7
- **Built:** The field shell sends the current position through `lib/field/position-share.ts` only. Sends are at most every 30 s, skipped under 10 m, with a 2-minute heartbeat, only while visible and online. A failed or offline send is dropped. Sharing is on by default. Stop is remembered per assignment in localStorage as the flag `1` (no coordinate). The Sharing pill sits under the Logger ID chip and in the Map header. Until the first log, the Logger status line says "Sharing your location with partner + admins" with Stop. The team strip appends the partner gap ("120 m ahead" and the other labels) from the scalar `report_position` returns.
- **Owner decisions:**
  - OWNER — H3 (2026-10-03): continuous GPS while the app is open; a direction arrow on both maps; a "near you" door chip; the route position goes to the partner.
  - OWNER — H5 (2026-10-03): raw current position to admins, overwritten, no trail, cleared at close, visible indicator, foreground only.
  - OWNER — U7-1 (2026-10-04): sharing on by default, with a Stop pill.
  - OWNER — U7-2 (2026-10-04): one send every 30 s (scalar and admin position together), skipped under 10 m, 2-minute heartbeat.
  - OWNER — U7-3 (2026-10-04): admins see position off the route too.
  - OWNER — U7-4 (2026-10-04): mini map recentre goes to you (heading-up) when the fix is 30 m or better, else the door.
  - OWNER — U7-5 (2026-10-04): admin "Live now" panel on `/admin/dashboard` until UI-10.
- **Claude decisions:**
  - CLAUDE — Figma page "Logger — clean build" (5:2), section "UI-7 GPS (2026-10-04)". The "you" marker is violet (`#6741d9` light, `#a58bff` dark), never an outcome colour.
  - CLAUDE — `lib/field/position-share.ts` is the only code that sends a position (rule 30-sync exception). Never queued, never in Dexie. Offline or failed sends are dropped. The only thing stored is the per-assignment "stopped" flag in localStorage (no coordinate).
  - CLAUDE — `components/field/position-sharer.tsx` is renderless, in the field layout. It sends on each fix and on a 15 s check, throttled by `shouldSend` (30 s, 10 m, 2-min heartbeat), only when visible and online. A failing server is tried at most every 30 s.
  - CLAUDE — Sharing is on by default (U7-1). The "Sharing" pill (Logger under the ID chip, Map header) opens a sheet: Stop sharing / Keep sharing, or Share location / Not now. Hidden when location is denied.
  - CLAUDE — Until the canvasser's first log on the prop, the Logger status line says "Sharing your location with partner + admins" with Stop (info priority, below errors, instructions and offline).
  - CLAUDE — Team strip: "Tom · last knocked #80 · 120 m ahead" from the partner scalar that `report_position` returns. A scalar, never a pin.
- **Acceptance:**
  - EDIT 1 DONE. `lib/field/position-share.ts` pasted as given.
  - EDIT 2 DONE. `components/field/position-sharer.tsx` pasted as given.
  - EDIT 3 DONE. `components/field/sharing-pill.tsx` pasted as given.
  - EDIT 4 DONE. `PositionSharer` imported and mounted inside `GeoProvider` in `app/(field)/layout.tsx`. Both find-blocks occurred once.
  - EDIT 5 DONE. `git grep -n "sharingNotice\|showSharingNotice\|shareState" components/field/logger-tab.tsx` before the edit returned nothing (exit 1, empty). Pill, first-open notice and partner distance pasted as given. Each find-block occurred once.
  - EDIT 6 DONE. Sharing pill added to the Map header. Both find-blocks occurred once.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the six session files: **PASS** — exit 0.
  - `npm run verify:ui7`: **PASS** — exit 0. All UI-7 geo checks passed.
  - `npm run verify:ui1`: **PASS** — exit 0.
  - `npm run verify:ui6`: **PASS** — exit 0.
  - `git grep -n "navigator.geolocation"`: **PASS** for call sites. Executable calls are only in `components/field/geo-provider.tsx` line 132 (`clearWatch`) and line 138 (`watchPosition`). Other hits are comments and documents.
  - `git grep -n "report_position\|stop_sharing_position" -- components lib app`: plain git grep lists only `lib/supabase/types.ts` lines 1634 and 2246, because `lib/field/position-share.ts` is untracked. `git grep -n --untracked` lists that file at lines 11, 98 and 129, plus the two types lines. No other file under `components`, `lib` or `app`.
  - `git diff --stat -- lib/sync`: **PASS** — empty.
  - Phone: **NOT VERIFIED**. Headless session. No browser.
- **Deviations from brief:** none
- **Not done / deferred:** A browser. A phone. Did not commit. No database row.
- **Follow-ups:** The owner does the six phone checks once for the phase.

### UI-7 Session C4 — tighter Logger header
- **Date:** 2026-10-06
- **Model:** Grok 4.7
- **Built:** The Logger header is three rows. Row 1 is the prop name and the ID chip. Row 2 is the visit line, full width. Row 3 is the Logging / Survey pills and the Sharing pill. The ID chip keeps a 44px tap target. `-my-1.5` stops it making the title row taller. The mini map band stays `flex-1` and takes the freed height. The Map tab header is unchanged. Header markup only. No logic, state, hook or import change. `data-testid`s are unchanged.
- **Owner decisions:**
  - OWNER — U7-6 (2026-10-06, from the UI-7 phone check): the visit line sat too low and wasted map space. Move it up tight under the prop name. Put the Logging / Survey pills on the same row as the Sharing pill. The mini map grows into the freed height.
- **Claude decisions:**
  - CLAUDE — the right column stacked the ID chip (44px) and the Sharing pill, so the visit line and pills only started below both.
  - CLAUDE — row 1 is the prop name and the ID chip. Row 2 is the visit line, full width, with no new truncation. Row 3 is the view pills and the Sharing pill.
  - CLAUDE — the ID chip keeps its 44px tap target. `-my-1.5` stops it adding height. That saves about 45px. The existing `flex-1` map band takes it. No other change.
  - CLAUDE — Logger header only. The Map tab header is unchanged.
- **Acceptance:**
  - EDIT 1 DONE. The header find-block in `components/field/logger-tab.tsx` occurred once and was replaced with the given markup.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on `components/field/logger-tab.tsx`: **PASS** — exit 0.
  - `npm run verify:ui1`: **PASS** — exit 0.
  - `npm run verify:ui6`: **PASS** — exit 0.
  - `npm run verify:ui7`: **PASS** — exit 0. All UI-7 geo checks passed.
  - Phone: **NOT VERIFIED**. Headless session. No browser.
- **Deviations from brief:** none
- **Not done / deferred:** A browser. A phone. The five phone checks. Did not commit. No database row.
- **Follow-ups:** The owner checks the Logger header on a phone at 390×763, 375×667 and 430×850.

### UI-8 Session D1b — which doors to fill
- **Date:** 2026-10-06
- **Model:** Grok 4.7
- **Built:** Pure logic for exceptions-only logging. `planInference()` returns `none`, `fill` (under 25 doors, one street) or `ask` (25 or more, or a street change). Each door carries its sequence index, UPRN, snapshot position and a time spread evenly between the last real log and the new one. A real log is a tapped row by this canvasser. Logging at or behind the latest real log fills nothing. After a correction, the next forward log fills only from the furthest real log. A door with any outcome on this phone, or a teammate's knock, is never filled. No React, no browser API, no network, no storage. Checked by `npm run verify:ui8`.
- **Owner decisions:**
  - OWNER — H4 (2026-10-03): exception-only logging (Mode B), stored with `knock_events.origin = 'inferred'`, solo props only.
  - OWNER — H7 (2026-10-03): gaps of 25+ doors, or a change of street, always ask. Backtracking never fills.
  - OWNER — U8-1 (2026-10-06): under 25 doors on one street fill silently, with one Undo for the tap and the fill.
  - OWNER — U8-2 (2026-10-06): 25+ doors, or a street change, opens the review sheet, all ticked, with its own Undo.
  - OWNER — U8-3 (2026-10-06): only between two real (tapped) logs, never over an existing outcome.
  - OWNER — U8-4 (2026-10-06): mode per canvasser per phone in the You tab, plus an "Exceptions only" header badge. Org default `every_door`, set by an admin. Team props always tap every door.
- **Claude decisions:**
  - CLAUDE — Figma page "Logger — clean build" (5:2), section "UI-8 Exceptions only (2026-10-06)".
  - CLAUDE — this session is the pure maths and the check script only. D2c calls it from the Logger.
  - CLAUDE — `planInference()` returns `none`, `fill` or `ask`, with each door's index, UPRN, snapshot position and an `occurredAt` spread evenly between the last real log and the new one.
  - CLAUDE — a real log is a tapped row by this canvasser (`inferred` false). Logging at or behind the latest real log fills nothing. After going back to fix an earlier door, the next forward log fills only from the furthest real log.
  - CLAUDE — never filled: a door with any outcome on this phone, or a teammate's knock.
- **Acceptance:**
  - EDIT 1 DONE. New `lib/field/inference.ts` pasted as given.
  - EDIT 2 DONE. New `scripts/verify-ui-8-inference.ts` pasted as given.
  - EDIT 3 DONE. `package.json` `verify:ui7` line occurred once and `verify:ui8` was added after it.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on `lib/field/inference.ts` and `scripts/verify-ui-8-inference.ts`: **PASS** — exit 0.
  - `npm run verify:ui8`: **PASS** — exit 0. Printed `ALL PASS` (25 checks).
  - Phone: **NOT VERIFIED**. Headless session. No browser. None for this session (pure logic).
- **Deviations from brief:** none
- **Not done / deferred:** Migration 028, the mode setting, the review sheet and the Logger fill (D1a, D2b, D2c). A browser. A phone. Did not commit. No database row.
- **Follow-ups:** D2c calls `planInference()` from the Logger.

### UI-8 Session D1a — migration 028 (origin, logging default) and types
- **Date:** 2026-10-06
- **Model:** Grok 4.7
- **Built:** `supabase/migrations/028_exceptions_logging.sql`, applied. `knock_events.origin` is `text not null default 'tap'`, check `tap | inferred`, plus `origin = 'tap' or outcome = 'no_answer'`. Existing rows are `tap` (1,273 of 1,273). `authenticated` has `INSERT` on `origin`. `logging_default()` returns `every_door` unless `app_settings` key `logging` says `exceptions`. `set_logging_default(p_mode)` is admin only. `app_settings` stays admin only. No `logging` row was seeded. `lib/supabase/types.ts` was replaced with the generated types. No app code.
- **Owner decisions:**
  - OWNER — H4 (2026-10-03): exception-only logging (Mode B), stored with `knock_events.origin = 'inferred'`, solo props only.
  - OWNER — H7 (2026-10-03): gaps of 25+ doors, or a change of street, always ask. Backtracking never fills.
  - OWNER — U8-1 (2026-10-06): under 25 doors on one street fill silently, with one Undo for the tap and the fill.
  - OWNER — U8-2 (2026-10-06): 25+ doors, or a street change, opens the review sheet, all ticked, with its own Undo.
  - OWNER — U8-3 (2026-10-06): only between two real (tapped) logs, never over an existing outcome.
  - OWNER — U8-4 (2026-10-06): mode per canvasser per phone in the You tab, plus an "Exceptions only" header badge. Org default `every_door`, set by an admin. Team props always tap every door.
- **Claude decisions:**
  - CLAUDE — Figma page "Logger — clean build" (5:2), section "UI-8 Exceptions only (2026-10-06)".
  - CLAUDE — `knock_events.origin text not null default 'tap'`, check `tap | inferred`, plus `origin = 'tap' or outcome = 'no_answer'`. Every existing row becomes `tap`. Canvassers get `grant insert (origin)`.
  - CLAUDE — `logging_default()`: security definer, any signed-in user, returns `every_door` unless `app_settings` key `logging` says `{"default_mode": "exceptions"}`. `app_settings` itself stays admin only.
  - CLAUDE — `set_logging_default(p_mode)`: admin only (42501 otherwise), validates the mode (22023), upserts the `logging` key.
  - CLAUDE — This session writes only the migration and the regenerated types. No app code.
- **Acceptance:**
  - EDIT 1 DONE. `supabase/migrations/028_exceptions_logging.sql` pasted as given. Last migration before it was `027_live_positions.sql`.
  - EDIT 2 DONE. `apply_migration` name `028_exceptions_logging` returned success. `origin` default `'tap'::text`, not null. Both checks present. Insert grant count 1. Privileges `anon_read=false`, `auth_read=true`, `anon_set=false`. Tap count equals total (1,273).
  - EDIT 3 NOT DONE. The proof block raised `23505` on `assignments_territory_id_work_date_key` before any origin check: `Key (territory_id, work_date)=(f2e26db8-7279-4b13-b525-542597d55a81, 2026-10-06) already exists` on `update public.assignments set work_date = (now() at time zone 'Europe/London')::date, closed_at = null where id = asg`. It was not edited and not re-run. After it, knock count is still 1,273 and `app_settings` is still only `rotation`.
  - EDIT 4 DONE. `lib/supabase/types.ts` replaced with `generate_typescript_types` output. `origin` is on knock_events Row, Insert and Update. `logging_default` and `set_logging_default` are in Functions.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on `lib/supabase/types.ts`: **PASS** — exit 0.
  - Canvasser-role origin insert, inferred-must-be-Not-In, and admin-only default: **NOT VERIFIED**. The proof never reached those statements.
  - Phone: **NOT VERIFIED**. Headless session. No browser. None for this session (database only).
- **Deviations from brief:** The §4 result line was not the prescribed success sentence, because the proof did not pass. Status left TODO. The proof was not changed.
- **Not done / deferred:** The rolled-back origin / Not In / default proof. Mode setting, review sheet and Logger fill (D2b, D2c). A browser. A phone. Did not commit. No `logging` row.
- **Follow-ups:** Re-run the proof when REF - Speedwell can take today's London date, or when the block does not move `work_date` onto a date that territory already has. Territory `f2e26db8-7279-4b13-b525-542597d55a81`, date `2026-10-06`.
- **Claude follow-up (2026-10-06, owner-approved write):** the proof failed on Claude's test setup, not on 028. Its first line moved REF - Speedwell to today, which clashes with another visit on that territory. The insert policy only needs membership, so Claude removed the setup lines and ran the fixed block once via the Supabase MCP. Result, exactly as expected: `TEST_RESULT old_not_tap=0 default=every_door inferred_answered=23514 bad_origin=23514 cx_set=42501 rows=tap,inferred bad_mode=22023 admin_set=exceptions cx_reads=exceptions stored=exceptions`. After: knock count 1,273, `app_settings` keys `rotation` only. Nothing kept. EDIT 3 is DONE.

### UI-8 Session D2b — the logging mode (You tab, header badge, admin default)
- **Date:** 2026-10-06
- **Model:** Grok 4.7
- **Built:** The logging mode is stored on the phone per canvasser (`d2d.loggingMode:<id>`). Until they choose, the org default from `logging_default()` applies, cached as `d2d.loggingDefault` for offline. The You tab has a Logging section with "Tap every door" / "Exceptions only". The Logger header shows an "Exceptions only" badge before the visit line only on a solo prop with that mode on. Admin Settings has a Logging default block under the visit threshold, saved with `set_logging_default`. No knock is written differently.
- **Owner decisions:**
  - OWNER — H4 (2026-10-03): exception-only logging (Mode B), stored with `knock_events.origin = 'inferred'`, solo props only.
  - OWNER — H7 (2026-10-03): gaps of 25+ doors, or a change of street, always ask. Backtracking never fills.
  - OWNER — U8-1 (2026-10-06): under 25 doors on one street fill silently, with one Undo for the tap and the fill.
  - OWNER — U8-2 (2026-10-06): 25+ doors, or a street change, opens the review sheet, all ticked, with its own Undo.
  - OWNER — U8-3 (2026-10-06): only between two real (tapped) logs, never over an existing outcome.
  - OWNER — U8-4 (2026-10-06): mode per canvasser per phone in the You tab, plus an "Exceptions only" header badge. Org default `every_door`, set by an admin. Team props always tap every door.
- **Claude decisions:**
  - CLAUDE — Figma page "Logger — clean build" (5:2), section "UI-8 Exceptions only (2026-10-06)".
  - CLAUDE — `lib/field/logging-mode.ts`: the mode per canvasser per phone in localStorage (`d2d.loggingMode:<id>`). Until they choose, the org default from `logging_default()` (cached as `d2d.loggingDefault` for offline). `isTeamProp()` is any other active member or any teammate knock.
  - CLAUDE — You tab: a Logging section with the same segmented control as Appearance: "Tap every door" / "Exceptions only", with a one-line explanation.
  - CLAUDE — Logger header: an "Exceptions only" badge (prop-soft fill, prop text) leading the visit line, only when the mode is on and the prop is solo.
  - CLAUDE — Admin Settings: a Logging default block under the visit threshold, saved with `set_logging_default`.
  - CLAUDE — No knock is written differently in this session. Session 04 does the filling.
- **Acceptance:**
  - EDIT 1 DONE. New `lib/field/logging-mode.ts` pasted as given.
  - EDIT 2 DONE. Three find-blocks in `components/field/profile-tab.tsx` each occurred once and were replaced as given.
  - EDIT 3 DONE. Three find-blocks in `components/field/logger-tab.tsx` each occurred once and were replaced as given.
  - EDIT 4 DONE. New `components/admin/logging-default-setting.tsx` pasted as given.
  - EDIT 5 DONE. Three find-blocks in `components/admin/rotation-settings.tsx` each occurred once (import, `extra` prop, slot under the form) and were replaced as given.
  - EDIT 6 DONE. Two find-blocks in `app/(admin)/admin/settings/page.tsx` each occurred once and were replaced as given.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the six session files: **PASS** — exit 0.
  - `npm run verify:ui8`: **PASS** — exit 0. Printed `ALL PASS`.
  - `npm run verify:ui1`: **PASS** — exit 0. Printed `OK`.
  - `npm run verify:ui6`: **PASS** — exit 0. Printed `OK`.
  - `git grep -n --untracked "logging_default\|set_logging_default" -- components lib app`: **PASS**. Hits only `lib/field/logging-mode.ts`, `components/admin/logging-default-setting.tsx`, `app/(admin)/admin/settings/page.tsx` and `lib/supabase/types.ts`. Plain `git grep` omits the two untracked files.
  - `git diff --stat -- lib/sync`: **PASS** — empty.
  - Phone: **NOT VERIFIED**. Headless session. No browser.
- **Deviations from brief:** none. The given code was pasted exactly. EDIT 5's heading said two replacements; the body listed three find-blocks, and all three were applied.
- **Not done / deferred:** The review sheet and the Logger fill (D2c). A browser. A phone. The three phone checks. Did not commit. No database row.
- **Follow-ups:** D2c uses `exceptionsOnly` to fill. The owner does the three phone checks once for the phase.

### UI-8 Session D2c — filling on commit, the review sheet, batch Undo
- **Date:** 2026-10-06
- **Model:** Grok 4.7
- **Built:** The Logger fills Not In doors only when exceptions-only mode is on and the prop is solo. `commit` plans from the outcomes already on the phone, writes the tapped knock, then the filled doors. Under 25 doors on one street fills at once, and one Undo removes the tap and the fill. 25 or more, or a street change, opens the review sheet with every door ticked. Confirm writes that batch with its own Undo, which removes only the batch. Each filled door is a queued knock, outcome `no_answer`, `origin: 'inferred'`, held for 60 seconds. A replayed tap does not fill. Notes and the Map tab do not fill.
- **Owner decisions:**
  - OWNER — H4 (2026-10-03): exception-only logging (Mode B), stored with `knock_events.origin = 'inferred'`, solo props only.
  - OWNER — H7 (2026-10-03): gaps of 25+ doors, or a change of street, always ask. Backtracking never fills.
  - OWNER — U8-1 (2026-10-06): under 25 doors on one street fill silently, with one Undo for the tap and the fill.
  - OWNER — U8-2 (2026-10-06): 25+ doors, or a street change, opens the review sheet, all ticked, with its own Undo.
  - OWNER — U8-3 (2026-10-06): only between two real (tapped) logs, never over an existing outcome.
  - OWNER — U8-4 (2026-10-06): mode per canvasser per phone in the You tab, plus an "Exceptions only" header badge. Org default `every_door`, set by an admin. Team props always tap every door.
- **Claude decisions:**
  - CLAUDE — Figma page "Logger — clean build" (5:2), section "UI-8 Exceptions only (2026-10-06)".
  - CLAUDE — Only the Logger's `commit` fills, and only when `exceptionsOnly` (mode on, solo prop). It plans from what the phone knew before the tap, writes the tapped knock, then the filled doors.
  - CLAUDE — Filled doors are ordinary queued knocks (`lib/sync/queue.ts`), outcome `no_answer`, `origin: 'inferred'`, `sequence_position` the door's snapshot position, each with its own `client_event_id`, held in the same 60 s undo window.
  - CLAUDE — `validateOp` refuses an inferred knock that is not Not In or carries a lead or observation (mirrors migration 028).
  - CLAUDE — Undo stays one target and one button. It can carry a batch of ids. Under 25: "Contact · 18 Ventnor Rd + 12 Not In" removes all. Sheet Confirm: "12 Not In · Ventnor Road" removes only that batch.
  - CLAUDE — `LocalOutcome.inferred` marks filled rows so they never count as a real log.
- **Acceptance:**
  - EDIT 1 DONE. Two find-blocks in `lib/sync/ops.ts` each occurred once and were replaced as given.
  - EDIT 2 DONE. The end of `logHouseNumber` in `lib/field/log-outcome.ts` occurred once. `logInferredNotIn` was appended as given.
  - EDIT 3 DONE. Three find-blocks in `lib/field/undo.ts` each occurred once and were replaced as given.
  - EDIT 4 DONE. Three find-blocks in `lib/field/local-outcomes.ts` each occurred once and were replaced as given.
  - EDIT 5 DONE. New `components/field/infer-sheet.tsx` pasted as given.
  - EDIT 6 DONE. Seven find-blocks in `components/field/logger-tab.tsx` each occurred once and were replaced as given.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the six session files: **PASS** — exit 0.
  - `npm run verify:ui8`: **PASS** — exit 0. Printed `ALL PASS`.
  - `npm run verify:ui1`: **PASS** — exit 0. Printed `OK`.
  - `npm run verify:ui6`: **PASS** — exit 0. Printed `OK`.
  - `git diff --stat -- lib/sync/queue.ts`: **PASS** — empty.
  - `git grep -n 'origin: "inferred"' -- lib components`: **PASS**. One hit, `lib/field/log-outcome.ts:197`.
  - Phone: **NOT VERIFIED**. Headless session. No browser.
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. The seven phone checks. Did not commit. No database row.
- **Follow-ups:** The owner does the seven phone checks once for the phase.

---

### UI-10 Session F1a — admin nav logic (pure) + verify:ui10
- **Date:** 2026-10-06
- **Model:** Grok 4.7
- **Built:** `lib/admin/nav.ts` is the one list for the phone drawer and the desktop rail (both built in F1c). F1 items: Today → `/admin/dashboard`, Props → `/admin` (exact), a temporary Allocate item, Coverage, and Settings under the divider. The active item is the longest matching href. Dark mode is opt-in via `DARK_READY_PATHS` (empty in F1). The rail is expanded unless `collapsed` is stored under `d2d.admin.rail`. `scripts/seed-demo.ts` `leftover` is now `const`.
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved. Figma page 40:289, phone 01–38, desktop D1–D3.
  - OWNER — A3: admin extends the field system: Sora, d2d tokens, Map style v1. Bricolage, Instrument and Martian Mono go.
  - OWNER — A14–A16: phone nav is an overlay drawer from the left (about 85% wide, scrim, closes on pick, swipe left to close, no edge-swipe to open), opened from a top-left button in each page header. Desktop is a left rail, expanded 240 or collapsed 64, remembered.
  - OWNER — A28: dark mode now, same as the field app. A51: admin and field share one Light / Dark / System choice per device (`d2d.theme`).
  - OWNER — A50: old routes keep working until their replacement lands, then redirect. Deleted in F6.
- **Claude decisions:**
  - CLAUDE — One list (`ADMIN_NAV`) drives both the phone drawer and the desktop rail (built in F1c).
  - CLAUDE — An item appears only once its page exists. F1: Today → `/admin/dashboard` (Live now panel), Props → `/admin` (old draw page, exact match only), a temporary Allocate item (removed in F3 when allocating moves into Today), Coverage, and Settings under the divider. Later phases change hrefs as new pages land.
  - CLAUDE — The active item is the longest matching href. `exact` stops `/admin` swallowing its children.
  - CLAUDE — Dark mode is opt-in per rebuilt route (`DARK_READY_PATHS`, empty in F1) so the old worksheet pages never render dark.
  - CLAUDE — The rail state is `expanded` unless `collapsed` was stored under `d2d.admin.rail`.
  - CLAUDE — Follow-up folded in: `scripts/seed-demo.ts` `let leftover` → `const` (eslint prefer-const).
- **Acceptance:**
  - EDIT 1 DONE. New `lib/admin/nav.ts` pasted as given.
  - EDIT 2 DONE. New `scripts/verify-ui-10-admin.ts` pasted as given.
  - EDIT 3 DONE. `verify:ui8` in `package.json` occurred once. `verify:ui10` was added after it.
  - EDIT 4 DONE. `let leftover` in `scripts/seed-demo.ts` occurred once and became `const`.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on `lib/admin/nav.ts`, `scripts/verify-ui-10-admin.ts`, `scripts/seed-demo.ts`: **PASS** — exit 0.
  - `npm run verify:ui10`: **PASS** — exit 0. Printed `ALL PASS`.
  - Phone: **NOT VERIFIED**. Headless session. No browser. None for this session (the owner checks F1 as a whole after F1c).
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. Did not commit. No database row. Drawer, rail and theme boot are F1c.
- **Follow-ups:** The owner checks F1 as a whole after F1c.

---

### UI-10 Session F1b — admin tokens, icons and UI kit
- **Date:** 2026-10-06
- **Model:** Grok 4.7
- **Built:** Admin type, shadow, radius and motion tokens in `app/globals.css`, including `--color-warn-ink`. The dark selector now covers `.admin-root` (opt-out `data-admin-dark="off"`). `.admin-root` uses Sora for the three font roles. Admin icons appended in `components/field/icons.tsx`. New kit under `components/admin/ui/`: overlay focus, Button, IconButton, Chip, StatusPill, Toggle, Segmented, Avatar, Sheet, ConfirmDialog, AdminIcon. Nothing uses the kit yet.
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved. Figma page 40:289, phone 01–38, desktop D1–D3.
  - OWNER — A3: admin extends the field system: Sora, d2d tokens, Map style v1. Bricolage, Instrument and Martian Mono go.
  - OWNER — A14–A16: phone nav is an overlay drawer from the left (about 85% wide, scrim, closes on pick, swipe left to close, no edge-swipe to open), opened from a top-left button in each page header. Desktop is a left rail, expanded 240 or collapsed 64, remembered.
  - OWNER — A28: dark mode now, same as the field app. A51: admin and field share one Light / Dark / System choice per device (`d2d.theme`).
  - OWNER — A50: old routes keep working until their replacement lands, then redirect. Deleted in F6.
- **Claude decisions:**
  - CLAUDE — Figma page 40:289, section "Admin / UI-10 — Components" (47:6278): Button, IconButton, Chip, StatusPill, NavItem, Toggle, Segmented, Avatar, SheetGrabber. Text styles `admin/*`. Effect styles `admin/float`, `admin/sheet`.
  - CLAUDE — Tokens become Tailwind utilities: `text-admin-large-title`, `text-admin-title`, `text-admin-headline`, `text-admin-body`, `text-admin-body-strong`, `text-admin-subhead`, `text-admin-section`, `text-admin-caption`, `text-admin-pill`, `text-admin-figure`, `text-admin-day`, `text-admin-button`, `text-warn-ink`, `shadow-admin-float`, `shadow-admin-sheet`, `rounded-admin-sheet` (20px), `animate-admin-sheet-in`, `animate-admin-drawer-in`, `animate-admin-fade-in` (used with `motion-safe:`).
  - CLAUDE — Button kinds: primary (ink, like field Button 12:151), secondary, destructive (oxide text), danger (filled oxide, only inside ConfirmDialog), quiet (prop text). Sizes: large 56, compact 44.
  - CLAUDE — Chip is 36px to look at and 44px to tap. StatusPill is visit state only. Live becomes a button when given `onClick`.
  - CLAUDE — Overlays share `useOverlayFocus`: focus in on open, Tab trapped, Escape closes, focus restored. ConfirmDialog puts focus on Cancel.
  - CLAUDE — Nothing uses the kit yet. F1c (shell) and the later phases do.
- **Acceptance:**
  - EDIT 1 DONE. Four blocks in `app/globals.css`, each find occurred once.
  - EDIT 2 DONE. `ReactNode` import and admin icons after `LocateIcon`. Each find occurred once.
  - EDIT 3 DONE. New `components/admin/ui/use-overlay-focus.ts`.
  - EDIT 4 DONE. New `components/admin/ui/button.tsx`.
  - EDIT 5 DONE. New `components/admin/ui/icon-button.tsx`.
  - EDIT 6 DONE. New `components/admin/ui/chip.tsx`.
  - EDIT 7 DONE. New `components/admin/ui/status-pill.tsx`.
  - EDIT 8 DONE. New `components/admin/ui/toggle.tsx`.
  - EDIT 9 DONE. New `components/admin/ui/segmented.tsx`.
  - EDIT 10 DONE. New `components/admin/ui/avatar.tsx`.
  - EDIT 11 DONE. New `components/admin/ui/sheet.tsx`.
  - EDIT 12 DONE. New `components/admin/ui/confirm-dialog.tsx`.
  - EDIT 13 DONE. New `components/admin/ui/admin-icon.tsx`.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on `components/field/icons.tsx` and `components/admin/ui`: **PASS** — exit 0.
  - `npm run verify:ui10`: **PASS** — exit 0. Printed `ALL PASS`.
  - Phone: **NOT VERIFIED**. Headless session. No browser. None for this session (the owner checks F1 as a whole after F1c).
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. Did not commit. No database row. The shell (drawer, rail, theme boot) is F1c.
- **Follow-ups:** The owner checks F1 as a whole after F1c.

---

### UI-10 Session F1c — admin shell (layout, drawer, rail) + old nav removed
- **Date:** 2026-10-06
- **Model:** Grok 4.7
- **Built:** `app/(admin)/layout.tsx` wraps every admin page in `AdminShell`: desktop rail (240 expanded or 64 collapsed, remembered), phone drawer from the left, Sora, and the shared theme. The five old pages lost `AdminNav` and gained `<AdminMenuButton />`. `components/admin/admin-nav.tsx` is deleted. Old pages stay light (`DARK_READY_PATHS` still empty).
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved. Figma page 40:289, phone 01–38, desktop D1–D3.
  - OWNER — A3: admin extends the field system: Sora, d2d tokens, Map style v1. Bricolage, Instrument and Martian Mono go.
  - OWNER — A14–A16: phone nav is an overlay drawer from the left (about 85% wide, scrim, closes on pick, swipe left to close, no edge-swipe to open), opened from a top-left button in each page header. Desktop is a left rail, expanded 240 or collapsed 64, remembered.
  - OWNER — A28: dark mode now, same as the field app. A51: admin and field share one Light / Dark / System choice per device (`d2d.theme`).
  - OWNER — A50: old routes keep working until their replacement lands, then redirect. Deleted in F6.
- **Claude decisions:**
  - CLAUDE — Figma frame 02 (drawer, 89:690), D1 (expanded rail, 100:1710), D2/D3 (collapsed rail).
  - CLAUDE — `AdminShell` wraps every /admin page: rail on lg and up, drawer below lg, Sora via `--font-sora` on `.admin-root`, the shared theme (`FieldThemeSync` plus a pre-paint script). Pages own their header and put `<AdminMenuButton />` top-left (hidden on desktop).
  - CLAUDE — The pre-paint script lives in plain `lib/admin/theme-boot.ts`. `lib/field/theme.ts` is "use client", and a server layout must not read values out of a client module. `verify:ui10` checks the two strings are identical.
  - CLAUDE — The shell sets `data-admin-dark="off"` unless the route is in `DARK_READY_PATHS` (empty in F1), so the old pages stay light.
  - CLAUDE — The five old pages lose `AdminNav` (the mono-caps grid) and get `<AdminMenuButton />` in its place. Nothing else on them changes in F1.
  - CLAUDE — Drawer: scrim, close button, Escape, left swipe (60px) and picking an item close it. Focus is trapped and restored. No edge-swipe to open.
- **Acceptance:**
  - EDIT 1 DONE. New `lib/admin/theme-boot.ts` pasted as given.
  - EDIT 2 DONE. New `components/admin/shell/nav-list.tsx`.
  - EDIT 3 DONE. New `components/admin/shell/nav-drawer.tsx`.
  - EDIT 4 DONE. New `components/admin/shell/nav-rail.tsx`.
  - EDIT 5 DONE. New `components/admin/shell/admin-shell.tsx`.
  - EDIT 6 DONE. New `app/(admin)/layout.tsx`.
  - EDIT 7 DONE. `allocate-form.tsx`: both finds occurred once.
  - EDIT 8 DONE. `coverage-view.tsx`: both finds occurred once.
  - EDIT 9 DONE. `dashboard-view.tsx`: both finds occurred once.
  - EDIT 10 DONE. `prop-drawer.tsx`: both finds occurred once.
  - EDIT 11 DONE. `rotation-settings.tsx`: both finds occurred once.
  - EDIT 12 DONE. Deleted `components/admin/admin-nav.tsx`. `git grep` for `admin-nav` returned no lines.
  - EDIT 13 DONE. `scripts/verify-ui-10-admin.ts`: both finds occurred once. Two shared-theme checks added.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the F1c files: **PASS** — exit 0.
  - `npm run verify:ui10`: **PASS** — exit 0. Printed `ALL PASS`, including the two shared-theme checks.
  - Phone: **NOT VERIFIED**. Headless session. No browser. The owner does the nine phone checks once for the whole F1 phase.
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. Did not commit. No database row.
- **Follow-ups:** The owner phone-checks F1 as a whole (drawer, rail, Sora, old pages stay light, keyboard focus, sign out).

---

### UI-10 Session F2a — Props and Draw logic (pure) + verify:ui10
- **Date:** 2026-10-07
- **Model:** Grok 4.7
- **Built:** Pure modules for the Props map and Draw, with nothing rendered yet. Drawing history (Undo, Redo, move a corner, add a corner from a midpoint, capped at 100 steps). Sheet heights and how a drag settles (peek / half / full). Prop list states and their words. Map geometry helpers. Draw and route copy. `npm run verify:ui10` now checks all of that. The F1 checks are unchanged.
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved. Figma page 40:289, phone 03–13 and desktop D2–D3 for this phase.
  - OWNER — M2 / A22: Props is one full-screen map (no boxed map, no buttons under it) with a sheet: three heights on a phone (peek / half / full), a floating panel on desktop. Default layers: prop outlines, latest outcomes (light dots), leads / pitches / sales (one pin per lead door, coloured by office status, read-only). No Cold Calling zones only when switched on.
  - OWNER — A19–A21: Draw = tap to drop a corner, a magnifier under the finger while dragging, Undo, Redo, drag a corner to move it. After closing: count → name → Save → routes. Edit shape = the same editor with the corners loaded; Save shows the door change.
  - OWNER — A23: route internals hidden behind "Route details"; the route step shows a map preview and km, not keys.
  - OWNER — A25: prop detail has no Allocate button (visits start from a date on Today, F3).
  - OWNER — A50: old routes redirect as replacements land (`/admin` → Props now, Today in F3); old files are deleted in F6.
  - OWNER — A28 / A51: dark mode, one Light / Dark / System choice shared with the field app.
- **Claude decisions:**
  - CLAUDE — Figma frames (phone section 89:295): 03 peek 90:416, 04 half 90:752, 05 prop detail 91:535, 06 actions 91:928, 07 layers 91:1274, 08–10 draw 92:718 / 92:799 / 92:875, 11 name 93:896, 12 routes 93:1028, 13 edit shape 93:1106; desktop D2 101:1809, D3 101:2216.
  - CLAUDE — No migration in F2 (the old F2f is dropped): rename and archive are plain `territories` updates under `territories_update_admin`; outlines from `territories.geom` (PostgREST returns GeoJSON); outcome dots from `coverage_map_payload`; lead pins from `leads` (admin SELECT); per-visit figures from `v_prop_completion` + head-only counts on `v_latest_knock`.
  - CLAUDE — Due rule (no owner rule existed): a prop is Due when nothing is planned and its last visit that counted for rotation is 28+ days old, or it was never visited (`PROP_DUE_AFTER_DAYS`, one constant; 28 = the old dashboard's "not visited in over 4 weeks").
  - CLAUDE — Routes step, made truthful: visits take turns between Route A (`best`, odd visits) and Route B (`best_reversed`, even visits). The rotation picks, so the step previews A/B rather than "choosing"; spares sit under Route details. Routes are generated and saved straight after Save prop / Save shape. If Edit shape's new routes fail, the old (now wrong) routes are deleted so the next allocation makes fresh ones.
  - CLAUDE — Admin never reads location: the bottom-right locate control of the mock becomes "Show all props" (four-corner icon).
  - CLAUDE — Routes layer = the selected prop only (its frozen visit route, else saved Route A).
  - CLAUDE — Archive is refused while a visit is today or planned; archived props show under Archived with Restore.
  - CLAUDE — Door counts per prop: `count_door_eligibility` per live prop, in parallel on the server, streamed after the list renders (no new RPC).
  - CLAUDE — This session is pure logic only. Nothing renders yet.
- **Acceptance:**
  - EDIT 1 DONE. New `lib/admin/draw-history.ts` pasted as given.
  - EDIT 2 DONE. New `lib/admin/sheet-detents.ts` pasted as given.
  - EDIT 3 DONE. New `lib/admin/props.ts` pasted as given.
  - EDIT 4 DONE. New `lib/admin/map-fit.ts` pasted as given.
  - EDIT 5 DONE. New `lib/admin/draw-copy.ts` pasted as given.
  - EDIT 6 DONE. `scripts/verify-ui-10-admin.ts`: both finds occurred once. F2a checks added. F1 checks unchanged.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the five new modules and `scripts/verify-ui-10-admin.ts`: **PASS** — exit 0.
  - `npm run verify:ui10`: **PASS** — exit 0. Printed `ALL PASS`, including the F2a checks.
  - Phone: **NOT VERIFIED**. Headless session. No browser. None for this session (the owner checks F2 as a whole after F2e).
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. Did not commit. No database row. The map, sheet, list and Draw screens are F2b–F2e.
- **Follow-ups:** The owner checks F2 as a whole after F2e.

---

### UI-10 Session F2b — admin map kit, Props map layers, prop data and actions
- **Date:** 2026-10-07
- **Model:** Grok 4.7
- **Built:** The admin map kit and the Props data behind it. Nothing renders yet. `useAdminMap` builds the field basemap (light or dark), with no MapLibre buttons, rotation off, and the view remembered per tab in session storage. `MapSheet` is a phone bottom sheet (peek / half / full; only the header drags) and a 360px floating panel on desktop. `prop-layers` stacks zones, outlines, outcome dots, draw doors and lead pins. Server reads: prop rows, streamed door counts, head-only visit figures, lead pins (door, status, two timestamps). `lib/props/manage.ts` renames, archives or restores a prop, and clears saved routes, all with the admin session. `MinusIcon` and `FitIcon` appended. The licence ⓘ on `.admin-map` sits under the page's top-right button. Overlay focus reads `onClose` from a ref, and Escape stops at the overlay.
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved. Figma page 40:289, phone 03–13 and desktop D2–D3 for this phase.
  - OWNER — M2 / A22: Props is one full-screen map (no boxed map, no buttons under it) with a sheet: three heights on a phone (peek / half / full), a floating panel on desktop. Default layers: prop outlines, latest outcomes (light dots), leads / pitches / sales (one pin per lead door, coloured by office status, read-only). No Cold Calling zones only when switched on.
  - OWNER — A19–A21: Draw = tap to drop a corner, a magnifier under the finger while dragging, Undo, Redo, drag a corner to move it. After closing: count → name → Save → routes. Edit shape = the same editor with the corners loaded; Save shows the door change.
  - OWNER — A23: route internals hidden behind "Route details"; the route step shows a map preview and km, not keys.
  - OWNER — A25: prop detail has no Allocate button (visits start from a date on Today, F3).
  - OWNER — A50: old routes redirect as replacements land (`/admin` → Props now, Today in F3); old files are deleted in F6.
  - OWNER — A28 / A51: dark mode, one Light / Dark / System choice shared with the field app.
- **Claude decisions:**
  - CLAUDE — Figma frames (phone section 89:295): 03 peek 90:416, 04 half 90:752, 05 prop detail 91:535, 06 actions 91:928, 07 layers 91:1274, 08–10 draw 92:718 / 92:799 / 92:875, 11 name 93:896, 12 routes 93:1028, 13 edit shape 93:1106; desktop D2 101:1809, D3 101:2216.
  - CLAUDE — No migration in F2 (the old F2f is dropped): rename and archive are plain `territories` updates under `territories_update_admin`; outlines from `territories.geom` (PostgREST returns GeoJSON); outcome dots from `coverage_map_payload`; lead pins from `leads` (admin SELECT); per-visit figures from `v_prop_completion` + head-only counts on `v_latest_knock`.
  - CLAUDE — Due rule (no owner rule existed): a prop is Due when nothing is planned and its last visit that counted for rotation is 28+ days old, or it was never visited (`PROP_DUE_AFTER_DAYS`, one constant; 28 = the old dashboard's "not visited in over 4 weeks").
  - CLAUDE — Routes step, made truthful: visits take turns between Route A (`best`, odd visits) and Route B (`best_reversed`, even visits). The rotation picks, so the step previews A/B rather than "choosing"; spares sit under Route details. Routes are generated and saved straight after Save prop / Save shape. If Edit shape's new routes fail, the old (now wrong) routes are deleted so the next allocation makes fresh ones.
  - CLAUDE — Admin never reads location: the bottom-right locate control of the mock becomes "Show all props" (four-corner icon).
  - CLAUDE — Routes layer = the selected prop only (its frozen visit route, else saved Route A).
  - CLAUDE — Archive is refused while a visit is today or planned; archived props show under Archived with Restore.
  - CLAUDE — Door counts per prop: `count_door_eligibility` per live prop, in parallel on the server, streamed after the list renders (no new RPC).
  - CLAUDE — `useAdminMap`: the field basemap (Map style v1, light or dark), no MapLibre buttons, rotation off, the licence lines in the compact ⓘ (moved under the page's top-right button by `.admin-map` in globals.css), view remembered per tab in session storage.
  - CLAUDE — `MapSheet`: phone = bottom sheet with peek / half / full (only the header drags, so lists scroll; a 6px slop keeps taps on its buttons working); desktop = floating panel on the left, 360 wide.
  - CLAUDE — `prop-layers`: zones (hidden by default) → outlines (selected = filled, thicker) → outcome dots (feature-state, Map style v1) → doors of a shape being drawn → lead pins. `["zoom"]` only ever at the top of an interpolate.
  - CLAUDE — Data: `loadPropRows` (server, admin session) and `loadDoorCounts` (not awaited by the page); `loadVisitStats` (head-only counts, contacts = bookable answers only); `loadLeadPins` (door, status and two timestamps only — no notes, no CRM ref).
  - CLAUDE — `lib/props/manage.ts` ("use server", admin session only, no service role): `renameProp`, `setPropArchived` (refused while a visit is today or planned), `clearPropRoutes`. Only async functions are exported from it.
  - CLAUDE — Icons: `MinusIcon`, `FitIcon` appended. Nothing renders these files until F2c.
  - CLAUDE — Review fixes folded in (Claude review agent, 2026-10-07): selection clears the old highlight (feature-state survives `setData`); a sheet drag never swallows the next real tap; a pause before release is a placement, not a flick; overlay focus no longer bounces on parent re-renders.
- **Acceptance:**
  - EDIT 1 DONE. New `components/admin/map/use-admin-map.ts` pasted as given.
  - EDIT 2 DONE. New `components/admin/map/use-is-desktop.ts` pasted as given.
  - EDIT 3 DONE. New `components/admin/map/map-sheet.tsx` pasted as given.
  - EDIT 4 DONE. New `components/admin/props/prop-layers.ts` pasted as given.
  - EDIT 5 DONE. New `lib/admin/prop-visit-stats.ts` pasted as given.
  - EDIT 6 DONE. New `lib/admin/props-data.ts` pasted as given.
  - EDIT 7 DONE. New `lib/admin/lead-pins.ts` pasted as given.
  - EDIT 8 DONE. New `lib/props/manage.ts` pasted as given.
  - EDIT 9 DONE. `components/field/icons.tsx`: the ClockIcon path block occurred once. `MinusIcon` and `FitIcon` appended.
  - EDIT 10 DONE. `app/globals.css`: the `.maplibregl-ctrl-group` block occurred once. `.admin-map .maplibregl-ctrl-top-right` added before it.
  - EDIT 11 DONE. `components/admin/ui/use-overlay-focus.ts`: all four find blocks occurred once. `onClose` is read from a ref. Escape calls `stopPropagation`. The effect depends on `open` and `panelRef`.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the ten TypeScript files: **PASS** — exit 0.
  - `npm run verify:ui10`: **PASS** — exit 0. Printed `ALL PASS`. No new checks in this session.
  - `git grep -n "service_role\|SERVICE_ROLE"` on `lib/props/manage.ts`, `lib/admin/props-data.ts`, `lib/admin/prop-visit-stats.ts`, `lib/admin/lead-pins.ts`: **PASS** — printed nothing (git grep exit 1, no match).
  - Phone: **NOT VERIFIED**. Headless session. No browser. None for this session (the owner checks F2 as a whole after F2e).
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. Did not commit. No database row. The Props page, Draw and magnifier are F2c–F2e. Nothing renders these files until F2c.
- **Follow-ups:** The owner checks F2 as a whole after F2e.

---

### UI-10 Session F2c — /admin/props map, sheet, list, detail, layers
- **Date:** 2026-10-07
- **Model:** Grok 4.7
- **Built:** `/admin/props` is on screen. One full-screen map, a phone sheet (peek / half / full) and a floating desktop panel. The list has search and filters. A prop opens its detail: inline rename, a ⋯ menu, archive and restore through a named confirm, visit card, history. Map layers sit in a popover. "Show all props" frames the outlines. The selected prop's route paints when Routes is on. Coverage accepts `?prop=` and opens with that prop selected. Draw and Edit shape are not in this file; F2d replaces the browse screen.
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved. Figma page 40:289, phone 03–13 and desktop D2–D3 for this phase.
  - OWNER — M2 / A22: Props is one full-screen map (no boxed map, no buttons under it) with a sheet: three heights on a phone (peek / half / full), a floating panel on desktop. Default layers: prop outlines, latest outcomes (light dots), leads / pitches / sales (one pin per lead door, coloured by office status, read-only). No Cold Calling zones only when switched on.
  - OWNER — A19–A21: Draw = tap to drop a corner, a magnifier under the finger while dragging, Undo, Redo, drag a corner to move it. After closing: count → name → Save → routes. Edit shape = the same editor with the corners loaded; Save shows the door change.
  - OWNER — A23: route internals hidden behind "Route details"; the route step shows a map preview and km, not keys.
  - OWNER — A25: prop detail has no Allocate button (visits start from a date on Today, F3).
  - OWNER — A50: old routes redirect as replacements land (`/admin` → Props now, Today in F3); old files are deleted in F6.
  - OWNER — A28 / A51: dark mode, one Light / Dark / System choice shared with the field app.
- **Claude decisions:**
  - CLAUDE — Figma frames (phone section 89:295): 03 peek 90:416, 04 half 90:752, 05 prop detail 91:535, 06 actions 91:928, 07 layers 91:1274, 08–10 draw 92:718 / 92:799 / 92:875, 11 name 93:896, 12 routes 93:1028, 13 edit shape 93:1106; desktop D2 101:1809, D3 101:2216.
  - CLAUDE — No migration in F2 (the old F2f is dropped): rename and archive are plain `territories` updates under `territories_update_admin`; outlines from `territories.geom` (PostgREST returns GeoJSON); outcome dots from `coverage_map_payload`; lead pins from `leads` (admin SELECT); per-visit figures from `v_prop_completion` + head-only counts on `v_latest_knock`.
  - CLAUDE — Due rule (no owner rule existed): a prop is Due when nothing is planned and its last visit that counted for rotation is 28+ days old, or it was never visited (`PROP_DUE_AFTER_DAYS`, one constant; 28 = the old dashboard's "not visited in over 4 weeks").
  - CLAUDE — Routes step, made truthful: visits take turns between Route A (`best`, odd visits) and Route B (`best_reversed`, even visits). The rotation picks, so the step previews A/B rather than "choosing"; spares sit under Route details. Routes are generated and saved straight after Save prop / Save shape. If Edit shape's new routes fail, the old (now wrong) routes are deleted so the next allocation makes fresh ones.
  - CLAUDE — Admin never reads location: the bottom-right locate control of the mock becomes "Show all props" (four-corner icon).
  - CLAUDE — Routes layer = the selected prop only (its frozen visit route, else saved Route A).
  - CLAUDE — Archive is refused while a visit is today or planned; archived props show under Archived with Restore.
  - CLAUDE — Door counts per prop: `count_door_eligibility` per live prop, in parallel on the server, streamed after the list renders (no new RPC).
  - CLAUDE — New route `/admin/props` (`?prop=<id>` opens a prop; the URL follows the selection with `replaceState`). Not in the nav yet: F2d switches the Props item and redirects `/admin` once Draw exists.
  - CLAUDE — Phone: menu, search pill and layers float at the top; the sheet holds the list or the prop detail; "Show all props" floats above the sheet. Desktop: the panel holds title, search ("/" focuses it), chips and the list; layers top-right; zoom and fit bottom-right.
  - CLAUDE — Prop detail: inline rename on the title (Enter saves, Escape cancels, blur saves); ⋯ menu (Rename, Show on Coverage, Archive / Restore; Edit shape arrives in F2d); visit card with the outcome bar on a neutral track; next-visit line; History newest first. "Open visit" goes to the old allocate page for the prop until F3 (`visitHref`).
  - CLAUDE — Archive uses the shared ConfirmDialog (named title, Cancel focused). Errors from rename / archive show in the detail, in words.
  - CLAUDE — Coverage takes `?prop=<id>` and opens with that prop selected (`initialPropId`).
- **Acceptance:**
  - EDIT 1 DONE. New `components/admin/props/layers-popover.tsx` pasted as given.
  - EDIT 2 DONE. New `components/admin/props/props-list.tsx` pasted as given.
  - EDIT 3 DONE. New `components/admin/props/prop-detail.tsx` pasted as given.
  - EDIT 4 DONE. New `components/admin/props/props-screen.tsx` pasted as given (browse only).
  - EDIT 5 DONE. New `app/(admin)/admin/props/page.tsx` pasted as given.
  - EDIT 6 DONE. `lib/admin/nav.ts`: the `initialOf` return occurred once. `visitHref` and `coverageHref` appended. Nav items unchanged.
  - EDIT 7 DONE. `scripts/verify-ui-10-admin.ts`: both find blocks occurred once. The link check was added.
  - EDIT 8 DONE. `components/admin/coverage-view.tsx`: both find blocks occurred once. `initialPropId` selects that prop when it is in the list.
  - EDIT 9 DONE. `app/(admin)/admin/coverage/page.tsx`: both find blocks occurred once. `?prop` is passed through.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the nine TypeScript files: **PASS** — exit 0.
  - `npm run verify:ui10`: **PASS** — exit 0. Printed `ALL PASS`, including `visit and coverage links carry the prop`.
  - Phone: **NOT VERIFIED**. Headless session. No browser. None for this session (the owner checks F2 as a whole after F2e).
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. Did not commit. No database row. Draw, Edit shape, the Routes step, the nav switch and `/admin` → Props are F2d. The magnifier is F2e. `DARK_READY_PATHS` is still empty: this session's `nav.ts` edit was only the two hrefs.
- **Follow-ups:** The owner checks F2 as a whole after F2e.

---

### UI-10 Session F2d — Draw, Edit shape, Routes step, nav switch, /admin → Props
- **Date:** 2026-10-07
- **Model:** Grok 4.7
- **Built:** Draw and Edit shape on the Props map (the same map, no Terra Draw). Tap drops a corner, corner 1 closes, Undo and Redo, drag a corner, drag an edge dot to add one. The door count settles 350 ms after the shape stops, then the doors draw. A new prop names and saves, then the Routes step previews Route A and Route B. Edit shape saves the new ring and does the same; if the new routes fail, the old ones are cleared. Props in the nav points at `/admin/props` and that path is dark-ready. `/admin` redirects to Props. The old draw components stay on disk until F6.
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved. Figma page 40:289, phone 03–13 and desktop D2–D3 for this phase.
  - OWNER — M2 / A22: Props is one full-screen map (no boxed map, no buttons under it) with a sheet: three heights on a phone (peek / half / full), a floating panel on desktop. Default layers: prop outlines, latest outcomes (light dots), leads / pitches / sales (one pin per lead door, coloured by office status, read-only). No Cold Calling zones only when switched on.
  - OWNER — A19–A21: Draw = tap to drop a corner, a magnifier under the finger while dragging, Undo, Redo, drag a corner to move it. After closing: count → name → Save → routes. Edit shape = the same editor with the corners loaded; Save shows the door change.
  - OWNER — A23: route internals hidden behind "Route details"; the route step shows a map preview and km, not keys.
  - OWNER — A25: prop detail has no Allocate button (visits start from a date on Today, F3).
  - OWNER — A50: old routes redirect as replacements land (`/admin` → Props now, Today in F3); old files are deleted in F6.
  - OWNER — A28 / A51: dark mode, one Light / Dark / System choice shared with the field app.
- **Claude decisions:**
  - CLAUDE — Figma frames (phone section 89:295): 03 peek 90:416, 04 half 90:752, 05 prop detail 91:535, 06 actions 91:928, 07 layers 91:1274, 08–10 draw 92:718 / 92:799 / 92:875, 11 name 93:896, 12 routes 93:1028, 13 edit shape 93:1106; desktop D2 101:1809, D3 101:2216.
  - CLAUDE — No migration in F2 (the old F2f is dropped): rename and archive are plain `territories` updates under `territories_update_admin`; outlines from `territories.geom` (PostgREST returns GeoJSON); outcome dots from `coverage_map_payload`; lead pins from `leads` (admin SELECT); per-visit figures from `v_prop_completion` + head-only counts on `v_latest_knock`.
  - CLAUDE — Due rule (no owner rule existed): a prop is Due when nothing is planned and its last visit that counted for rotation is 28+ days old, or it was never visited (`PROP_DUE_AFTER_DAYS`, one constant; 28 = the old dashboard's "not visited in over 4 weeks").
  - CLAUDE — Routes step, made truthful: visits take turns between Route A (`best`, odd visits) and Route B (`best_reversed`, even visits). The rotation picks, so the step previews A/B rather than "choosing"; spares sit under Route details. Routes are generated and saved straight after Save prop / Save shape. If Edit shape's new routes fail, the old (now wrong) routes are deleted so the next allocation makes fresh ones.
  - CLAUDE — Admin never reads location: the bottom-right locate control of the mock becomes "Show all props" (four-corner icon).
  - CLAUDE — Routes layer = the selected prop only (its frozen visit route, else saved Route A).
  - CLAUDE — Archive is refused while a visit is today or planned; archived props show under Archived with Restore.
  - CLAUDE — Door counts per prop: `count_door_eligibility` per live prop, in parallel on the server, streamed after the list renders (no new RPC).
  - CLAUDE — Draw and Edit shape are modes of the same map (no second map, no Terra Draw). Tap = drop a corner; tap corner 1 = close; press on a corner = drag it; drag an edge dot = add a corner. Double-tap zoom is off while drawing. Every step is one history entry. The live drag commits once on release.
  - CLAUDE — The door count runs 350 ms after the shape settles, then the doors are drawn (knockable solid, zone / flats hollow). A newer shape always wins over a slower older count.
  - CLAUDE — Phone: header (Cancel, title, layers), one hint at the top, toolbar at the bottom. Desktop: one toolbar at the top with ⌘Z / ⇧⌘Z / ↵, hint at the bottom. Escape cancels.
  - CLAUDE — New prop: closing opens the name sheet. Save prop → `saveProp` → routes generated and saved → Routes step → Done opens the new prop. Edit shape loads the saved corners; Save shows "+N since last save"; a visit today or planned shows the frozen-visit note. Save → `updatePropRing` → routes.
  - CLAUDE — Cancel with work on screen asks first (named confirm, Cancel focused).
  - CLAUDE — Gesture details: under 4px of finger wobble is a tap; the corner keeps its offset from the finger; a release off the map still ends the drag; a finished drag is never also a tap; Escape in the layers panel closes only the panel; Enter on a focused button never closes the shape; a slow route result never lands on another prop or moves the map after Done.
- **Acceptance:**
  - EDIT 1 DONE. New `components/admin/props/draw-layers.ts` pasted as given.
  - EDIT 2 DONE. New `components/admin/props/use-draw-gestures.ts` pasted as given.
  - EDIT 3 DONE. New `components/admin/props/use-shape-count.ts` pasted as given.
  - EDIT 4 DONE. New `components/admin/props/draw-panel.tsx` pasted as given.
  - EDIT 5 DONE. New `components/admin/props/route-panel.tsx` pasted as given.
  - EDIT 6 DONE. `components/admin/props/props-screen.tsx` replaced in full with the given file.
  - EDIT 7 DONE. `lib/admin/nav.ts`: both find blocks occurred once. Props href is `/admin/props`. `DARK_READY_PATHS` is `["/admin/props"]`.
  - EDIT 8 DONE. `scripts/verify-ui-10-admin.ts`: both find blocks occurred once. `/admin` expects null. `/admin/props` expects props and is dark-ready.
  - EDIT 9 DONE. `app/(admin)/admin/page.tsx` replaced in full. It redirects to `/admin/props`.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the nine TypeScript files: **PASS** — exit 0.
  - `npm run verify:ui10`: **PASS** — exit 0. Printed `ALL PASS`, including `active item for /admin` (got null), `active item for /admin/props` (got props), `old pages stay light`, `Props is dark-ready (F2)`.
  - `git grep -n "navigator.geolocation" -- components/admin lib/admin`: **PASS** — printed nothing (git grep exit 1, no match).
  - Phone: **NOT VERIFIED**. Headless session. No browser. None for this session (the owner checks F2 as a whole after F2e).
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. Did not commit. No database row. The magnifier is F2e. Old draw components stay until F6.
- **Follow-ups:** The owner checks F2 as a whole after F2e.

---

### UI-10 Session F2e — Magnifier while dragging a corner (touch)
- **Date:** 2026-10-07
- **Model:** Grok 4.7
- **Built:** On a touch screen, dragging a corner shows a 120px round lens above the finger. The lens is a second, non-interactive map of the shape only, two zoom levels closer, with a crosshair. Near the top edge it sits beside the finger. It is built when drawing starts and removed when drawing ends. A mouse does not show it.
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved. Figma page 40:289, phone 03–13 and desktop D2–D3 for this phase.
  - OWNER — M2 / A22: Props is one full-screen map (no boxed map, no buttons under it) with a sheet: three heights on a phone (peek / half / full), a floating panel on desktop. Default layers: prop outlines, latest outcomes (light dots), leads / pitches / sales (one pin per lead door, coloured by office status, read-only). No Cold Calling zones only when switched on.
  - OWNER — A19–A21: Draw = tap to drop a corner, a magnifier under the finger while dragging, Undo, Redo, drag a corner to move it. After closing: count → name → Save → routes. Edit shape = the same editor with the corners loaded; Save shows the door change.
  - OWNER — A23: route internals hidden behind "Route details"; the route step shows a map preview and km, not keys.
  - OWNER — A25: prop detail has no Allocate button (visits start from a date on Today, F3).
  - OWNER — A50: old routes redirect as replacements land (`/admin` → Props now, Today in F3); old files are deleted in F6.
  - OWNER — A28 / A51: dark mode, one Light / Dark / System choice shared with the field app.
- **Claude decisions:**
  - CLAUDE — Figma frames (phone section 89:295): 03 peek 90:416, 04 half 90:752, 05 prop detail 91:535, 06 actions 91:928, 07 layers 91:1274, 08–10 draw 92:718 / 92:799 / 92:875, 11 name 93:896, 12 routes 93:1028, 13 edit shape 93:1106; desktop D2 101:1809, D3 101:2216.
  - CLAUDE — No migration in F2 (the old F2f is dropped): rename and archive are plain `territories` updates under `territories_update_admin`; outlines from `territories.geom` (PostgREST returns GeoJSON); outcome dots from `coverage_map_payload`; lead pins from `leads` (admin SELECT); per-visit figures from `v_prop_completion` + head-only counts on `v_latest_knock`.
  - CLAUDE — Due rule (no owner rule existed): a prop is Due when nothing is planned and its last visit that counted for rotation is 28+ days old, or it was never visited (`PROP_DUE_AFTER_DAYS`, one constant; 28 = the old dashboard's "not visited in over 4 weeks").
  - CLAUDE — Routes step, made truthful: visits take turns between Route A (`best`, odd visits) and Route B (`best_reversed`, even visits). The rotation picks, so the step previews A/B rather than "choosing"; spares sit under Route details. Routes are generated and saved straight after Save prop / Save shape. If Edit shape's new routes fail, the old (now wrong) routes are deleted so the next allocation makes fresh ones.
  - CLAUDE — Admin never reads location: the bottom-right locate control of the mock becomes "Show all props" (four-corner icon).
  - CLAUDE — Routes layer = the selected prop only (its frozen visit route, else saved Route A).
  - CLAUDE — Archive is refused while a visit is today or planned; archived props show under Archived with Restore.
  - CLAUDE — Door counts per prop: `count_door_eligibility` per live prop, in parallel on the server, streamed after the list renders (no new RPC).
  - CLAUDE — Frame 10: a 120px round lens above the finger shows the dragged corner two zoom levels closer, with a crosshair; near the top edge it moves beside the finger. A second, non-interactive map that only carries the shape, built when drawing starts so it is ready on the first drag, removed when drawing ends.
  - CLAUDE — Touch screens only (`(pointer: coarse)`): with a mouse the pointer never hides the corner.
  - CLAUDE — Droppable: if this session fails, F2 still works without it. This session landed, so the lens is in the draw fragment.
- **Acceptance:**
  - EDIT 1 DONE. New `components/admin/props/draw-magnifier.tsx` pasted as given. `ensureDrawLayers`, `setDrawShape` and `DragState` are exported from `draw-layers.ts`. `fieldMapStyle` is exported from `lib/field/map-style.ts`.
  - EDIT 2 DONE. Both find blocks in `props-screen.tsx` occurred once. Import added. `<DrawMagnifier map={map} mode={mode} shape={shape} drag={drag} />` sits inside the draw fragment.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on `draw-magnifier.tsx` and `props-screen.tsx`: **PASS** — exit 0.
  - `npm run verify:ui10`: **PASS** — exit 0. Printed `ALL PASS`.
  - `git grep -n "navigator.geolocation" -- components/admin lib/admin`: **PASS** — printed nothing (git grep exit 1, no match).
  - Phone: **NOT VERIFIED**. Headless session. No browser. The owner checks F2 as a whole.
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. Did not commit. No database row. Old draw components stay until F6.
- **Follow-ups:** The owner checks F2 as a whole (phone items 1–15 in the F2e brief).

---

### UI-10 Session F3a — Today logic (pure) + verify:ui10
- **Date:** 2026-10-08
- **Model:** Grok 4.7 (edits); log entries written by Claude
- **Built:** `lib/admin/today.ts` (pure): London dates and day labels, the schedule by date (today and tomorrow always, later dates with visits, no past), card status and meta lines, day totals, stale visits and the end / delete split (`mustEnd`: a started visit is always ended), review and end-visit confirms and buttons, Add visit prop groups and team options. `scripts/verify-ui-10-admin.ts` gains the F3a checks. Nothing renders yet.
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved (Figma page 40:289: phone 01, 14–19, 25–27, 31, 33; desktop D1 for this phase).
  - OWNER — M3 / A17: allocations by date live inside Today as a schedule: today at the top, then upcoming dates. (A38: history moves to Calendar in F4.)
  - OWNER — A24: allocating starts only from a date: "Add visit" → pick prop (due props first) → team → Allocate.
  - OWNER — A26: tapping a visit opens a visit sheet over Today: team, progress, numbers, route map, add / remove person, End visit, Delete when nothing was worked, a link to the prop.
  - OWNER — A27: stale visits: a "Needs attention" row on Today → review (by date, untick to keep) → one button ends or deletes them.
  - OWNER — A36 / H5: a Live chip on a visit opens a map of CURRENT positions only. No trail, no history.
  - OWNER — A50: old routes redirect as replacements land: `/admin` → Today, `/admin/allocate` → Today. `/admin/dashboard` stays by URL until it becomes Insights (F5).
  - OWNER — 2026-10-07: F3 has no migration (the old F3d / 030 is dropped). The 22 stale open visits are cleared by the owner through the new review page during the phone check.
- **Claude decisions:**
  - CLAUDE — No migration, no new RPC. Today reads `assignments`, `assignment_members` + `profiles` (first names only), `territories`, `v_prop_completion`, and head-only counts on `v_latest_knock` (contacts = outcome `answered` only). Ending uses `assignment_close_early`; deleting uses `assignment_remove` via `removeAssignmentAction`.
  - CLAUDE — A started visit is always ended, never deleted, even with no knocks on the server: a phone with no signal may still hold queued knocks. Only a visit that never started can be deleted (`mustEnd`).
  - CLAUDE — Today and tomorrow always show; later dates show when they have visits; past dates never (Calendar, F4).
  - CLAUDE — This session is pure logic only: dates and day labels, the schedule grouping, card status and meta lines, day totals, stale visits and the review split, confirm and button labels, the Add visit lists and team options. Nothing renders yet.
- **Acceptance:**
  - EDIT 1 DONE. New `lib/admin/today.ts` pasted as given (Claude compared it byte for byte with the tested file: identical).
  - EDIT 2 DONE. `scripts/verify-ui-10-admin.ts`: import and F3a block added (Claude compared it with the replayed prompt: identical). Earlier checks unchanged.
  - `npx tsc --noEmit`: **PASS** — exit 0 (runner gate).
  - eslint on the two changed files: **PASS** — exit 0 (runner gate).
  - `npm run verify:ui10`: **PASS** — `ALL PASS`, including the F3a checks (runner gate).
  - Phone: **NOT VERIFIED**. None for this session (the owner checks F3 as a whole after F3d).
- **Deviations from brief:** the runner session hung while writing this BUILD-LOG entry and timed out at 45 min with no report. The code, the tracker row and CLAUDE-HANDOFF "Current state" were already written; Claude wrote this entry and the CLAUDE-HANDOFF log entry after review.
- **Not done / deferred:** A browser. A phone. No database row.
- **Follow-ups:** F3b–F3d stay queued.

---

### UI-10 Session F3b — Today data loaders, last knocks, end-visit action
- **Date:** 2026-10-08
- **Model:** Grok 4.7
- **Built:** `loadToday` in `lib/admin/today-data.ts` (open visits plus today's closed ones, teams, props, head-only figures). `loadLastKnocks` in `lib/admin/last-knocks.ts` (latest knock per canvasser and `v_door_label`). `closeVisitAction` in `lib/props/visits.ts` (`assignment_close_early`, admin session). `LiveRow.assignmentId` from `admin_live_positions.assignment_id`. Nothing renders yet.
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved (Figma page 40:289: phone 01, 14–19, 25–27, 31, 33; desktop D1 for this phase).
  - OWNER — M3 / A17: allocations by date live inside Today as a schedule: today at the top, then upcoming dates. (A38: history moves to Calendar in F4.)
  - OWNER — A24: allocating starts only from a date: "Add visit" → pick prop (due props first) → team → Allocate.
  - OWNER — A26: tapping a visit opens a visit sheet over Today: team, progress, numbers, route map, add / remove person, End visit, Delete when nothing was worked, a link to the prop.
  - OWNER — A27: stale visits: a "Needs attention" row on Today → review (by date, untick to keep) → one button ends or deletes them.
  - OWNER — A36 / H5: a Live chip on a visit opens a map of CURRENT positions only. No trail, no history.
  - OWNER — A50: old routes redirect as replacements land: `/admin` → Today, `/admin/allocate` → Today. `/admin/dashboard` stays by URL until it becomes Insights (F5).
  - OWNER — 2026-10-07: F3 has no migration (the old F3d / 030 is dropped). The 22 stale open visits are cleared by the owner through the new review page during the phone check.
- **Claude decisions:**
  - CLAUDE — Figma frames (phone section 89:295): 01 Today 89:308, 14 visit sheet 94:1038, 15 live map 94:1281, 16 add visit · prop 95:1150, 17 add visit · team 95:1233, 18 past visits review 96:1194, 19 confirm 96:1273, 25 nothing planned 99:1390, 26 loading 99:1562, 27 could not load 99:1613, 33 confirm end visit 102:1966; desktop D1 100:1710.
  - CLAUDE — No migration, no new RPC. Today reads `assignments` (open, plus every visit dated today), `assignment_members` + `profiles` (first names only), `territories`, `v_prop_completion`, and head-only counts on `v_latest_knock` (contacts = outcome `answered` only). Ending uses `assignment_close_early`; deleting uses `assignment_remove` through `removeAssignmentAction`.
  - CLAUDE — A started visit is always ended, never deleted, even with no knocks on the server. Only a visit that never started can be deleted.
  - CLAUDE — Today = one column on phone; the visit sheet is a right-hand panel on desktop 1440. Today and tomorrow always show; later dates show when they have visits; past dates never. The Calendar icon, the "Past days" row and Jump to date stay hidden until F4.
  - CLAUDE — Figures refresh every 2 minutes while a visit is open today, live positions every 30 seconds, and the page reloads itself after midnight.
  - CLAUDE — Live map: each person's current position (faded after 10 minutes), their last knock time and its door label. "Not sharing a position" when there is none. Admin never reads `navigator.geolocation`.
  - CLAUDE — Remove person = Undo toast. The last person cannot be removed.
  - CLAUDE — Add visit: `/admin/today/add?date=…&prop=…`. Due props first. A prop already booked that date is greyed. Allocate runs `allocatePropAction` then `generateRouteAction`.
  - CLAUDE — Past visits review: `/admin/today/review`. All ticked. One button closes them one at a time. Failures stay listed and ticked.
  - CLAUDE — Overlays stack: Escape closes only the top one.
  - CLAUDE — Prop detail's "Open visit" opens that visit's sheet on Today (`visitHref(visitId)`).
  - CLAUDE — `loadToday` fails as one message in words. `loadLastKnocks` returns door labels only. `closeVisitAction` exports only an async function at runtime (the result type is erased). `LiveRow.assignmentId` is carried; nothing renders it yet.
- **Acceptance:**
  - EDIT 1 DONE. New `lib/admin/today-data.ts` pasted as given.
  - EDIT 2 DONE. New `lib/admin/last-knocks.ts` pasted as given.
  - EDIT 3 DONE. New `lib/props/visits.ts` pasted as given.
  - EDIT 4 DONE. `lib/admin/live.ts`: `LiveRow.assignmentId` and `rows.push` `assignmentId: row.assignment_id`. Each find block occurred once.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the four edited files: **PASS** — exit 0.
  - `npm run verify:ui10`: **PASS** — exit 0. Printed `ALL PASS`.
  - `git grep -n "service_role\|SERVICE_ROLE" -- lib/admin/today-data.ts lib/admin/last-knocks.ts lib/props/visits.ts`: **PASS** — printed nothing (exit 1).
  - Phone: **NOT VERIFIED**. None for this session (the owner checks F3 as a whole after F3d).
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. Did not commit. No database row. Today is not a page yet (F3c).
- **Follow-ups:** F3c and F3d stay queued. The owner checks F3 as a whole after F3d.

---

### UI-10 Session F3c — /admin/today: schedule, visit sheet, live map
- **Date:** 2026-10-08
- **Model:** Grok 4.7
- **Built:** `/admin/today` (`?visit=<id>` opens a visit). Schedule of today, tomorrow, then later dates with visits. Needs-attention row. Today's numbers. Visit card with outcome bar. Visit sheet (phone) or right-hand panel (desktop): route map, numbers, team, add / remove person with Undo, End visit or Delete. Live map of current positions only. Still map via `useAdminMap({ interactive: false })`. Overlay stack so Escape closes only the top one. Add visit and review links point at routes F3d adds. Not in the nav.
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved (Figma page 40:289: phone 01, 14–19, 25–27, 31, 33; desktop D1 for this phase).
  - OWNER — M3 / A17: allocations by date live inside Today as a schedule: today at the top, then upcoming dates. (A38: history moves to Calendar in F4.)
  - OWNER — A24: allocating starts only from a date: "Add visit" → pick prop (due props first) → team → Allocate.
  - OWNER — A26: tapping a visit opens a visit sheet over Today: team, progress, numbers, route map, add / remove person, End visit, Delete when nothing was worked, a link to the prop.
  - OWNER — A27: stale visits: a "Needs attention" row on Today → review (by date, untick to keep) → one button ends or deletes them.
  - OWNER — A36 / H5: a Live chip on a visit opens a map of CURRENT positions only. No trail, no history.
  - OWNER — A50: old routes redirect as replacements land: `/admin` → Today, `/admin/allocate` → Today. `/admin/dashboard` stays by URL until it becomes Insights (F5).
  - OWNER — 2026-10-07: F3 has no migration (the old F3d / 030 is dropped). The 22 stale open visits are cleared by the owner through the new review page during the phone check.
- **Claude decisions:**
  - CLAUDE — Figma frames (phone section 89:295): 01 Today 89:308, 14 visit sheet 94:1038, 15 live map 94:1281, 16 add visit · prop 95:1150, 17 add visit · team 95:1233, 18 past visits review 96:1194, 19 confirm 96:1273, 25 nothing planned 99:1390, 26 loading 99:1562, 27 could not load 99:1613, 33 confirm end visit 102:1966; desktop D1 100:1710.
  - CLAUDE — No migration, no new RPC. Today reads `assignments` (open, plus every visit dated today), `assignment_members` + `profiles` (first names only), `territories`, `v_prop_completion`, and head-only counts on `v_latest_knock` (contacts = outcome `answered` only). Ending uses `assignment_close_early`; deleting uses `assignment_remove` through `removeAssignmentAction`; add / remove person use the existing actions.
  - CLAUDE — A started visit is always ended, never deleted, even with no knocks on the server. Only a visit that never started can be deleted.
  - CLAUDE — Today = one column on phone; the visit sheet is a right-hand panel on desktop 1440. Today and tomorrow always show; later dates show when they have visits; past dates never. The Calendar icon, the "Past days" row and Jump to date stay hidden until F4.
  - CLAUDE — Figures refresh every 2 minutes while a visit is open today, live positions every 30 seconds, and the page reloads itself after midnight.
  - CLAUDE — Live map: each person's current position (faded after 10 minutes), their last knock time and its door label (`v_door_label`). "Not sharing a position" when there is none. Nothing stores or sends a location. Admin never reads `navigator.geolocation`.
  - CLAUDE — Remove person = Undo toast (re-adds them). The last person cannot be removed.
  - CLAUDE — Add visit: `/admin/today/add?date=…&prop=…` (F3d). Due props first. A prop already booked that date is greyed.
  - CLAUDE — Past visits review: `/admin/today/review` (F3d). All ticked. One button closes them one at a time. Failures stay listed and ticked.
  - CLAUDE — Overlays stack: Escape closes only the top one. `isOverlayOpen()` lets the desktop panel leave Escape to a confirm above it.
  - CLAUDE — Prop detail's "Open visit" opens that visit's sheet on Today (`visitHref(visitId)`). That link is F3d; this session only reads `?visit=`.
  - CLAUDE — New route `/admin/today`. The URL follows with `replaceState(null, …)`. Not in the nav until F3d. Its Add visit and Needs attention links 404 until F3d.
  - CLAUDE — `useAdminMap` takes `{ interactive: false }` for the still map in the visit sheet.
  - CLAUDE — The sheet / panel choice waits for the first client render.
- **Acceptance:**
  - EDIT 1 DONE. New `components/admin/today/visit-card.tsx` pasted as given.
  - EDIT 2 DONE. New `components/admin/today/visit-mini-map.tsx` pasted as given.
  - EDIT 3 DONE. New `components/admin/today/visit-panel.tsx` pasted as given.
  - EDIT 4 DONE. New `components/admin/today/live-map.tsx` pasted as given.
  - EDIT 5 DONE. New `components/admin/today/today-screen.tsx` pasted as given.
  - EDIT 6 DONE. New `app/(admin)/admin/today/page.tsx` pasted as given.
  - EDIT 7 DONE. New `app/(admin)/admin/today/loading.tsx` pasted as given.
  - EDIT 8 DONE. `components/admin/map/use-admin-map.ts`: optional `options.interactive`, passed into the map, added to the effect deps. Each find block occurred once.
  - EDIT 9 DONE. `components/admin/ui/use-overlay-focus.ts`: overlay stack, `isOverlayOpen()`, only the top overlay handles keys, splice on close. Each find block occurred once.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the nine session files: **PASS** — exit 0.
  - `npm run verify:ui10`: **PASS** — exit 0. Printed `ALL PASS`.
  - `git grep -n "navigator.geolocation" -- components/admin lib/admin`: **PASS** — printed nothing (exit 1).
  - Phone: **NOT VERIFIED**. None for this session (the owner checks F3 as a whole after F3d).
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. Did not commit. No database row. Add visit, past-visits review, nav switch and the `/admin` redirects are F3d. `lib/admin/nav.ts` was not edited, so `/admin/today` is not dark-ready yet.
- **Follow-ups:** F3d stays queued. The owner checks F3 as a whole after F3d.

---

### UI-10 Session F3d — Add visit, past visits review; nav switch; /admin and /admin/allocate → Today
- **Date:** 2026-10-08
- **Model:** Grok 4.7
- **Built:** Add visit at `/admin/today/add` (date, then prop with Due first, then team, then Allocate via `allocatePropAction` and `generateRouteAction`). Past visits review at `/admin/today/review` (all ticked; one button ends started visits and deletes visits that never started). Today is in the nav and dark-ready; the temporary Allocate item is gone. `/admin` and `/admin/allocate` redirect to Today (`?prop=` opens Add visit with that prop). Prop detail "Open visit" opens that visit's sheet. Props URL sync uses `replaceState(null, …)`.
- **Owner decisions:**
  - OWNER — A47 (2026-10-06): UI-10 designs approved (Figma page 40:289: phone 01, 14–19, 25–27, 31, 33; desktop D1 for this phase).
  - OWNER — M3 / A17: allocations by date live inside Today as a schedule: today at the top, then upcoming dates. (A38: history moves to Calendar in F4.)
  - OWNER — A24: allocating starts only from a date: "Add visit" → pick prop (due props first) → team → Allocate.
  - OWNER — A26: tapping a visit opens a visit sheet over Today: team, progress, numbers, route map, add / remove person, End visit, Delete when nothing was worked, a link to the prop.
  - OWNER — A27: stale visits: a "Needs attention" row on Today → review (by date, untick to keep) → one button ends or deletes them.
  - OWNER — A36 / H5: a Live chip on a visit opens a map of CURRENT positions only. No trail, no history.
  - OWNER — A50: old routes redirect as replacements land: `/admin` → Today, `/admin/allocate` → Today. `/admin/dashboard` stays by URL until it becomes Insights (F5).
  - OWNER — 2026-10-07: F3 has no migration (the old F3d / 030 is dropped). The 22 stale open visits are cleared by the owner through the new review page during the phone check.
- **Claude decisions:**
  - CLAUDE — Figma frames (phone section 89:295): 01 Today 89:308, 14 visit sheet 94:1038, 15 live map 94:1281, 16 add visit · prop 95:1150, 17 add visit · team 95:1233, 18 past visits review 96:1194, 19 confirm 96:1273, 25 nothing planned 99:1390, 26 loading 99:1562, 27 could not load 99:1613, 33 confirm end visit 102:1966; desktop D1 100:1710.
  - CLAUDE — No migration, no new RPC. Today reads `assignments` (open, plus every visit dated today), `assignment_members` + `profiles` (first names only), `territories`, `v_prop_completion`, and head-only counts on `v_latest_knock` (contacts = outcome `answered` only). Ending uses `assignment_close_early`; deleting uses `assignment_remove` through `removeAssignmentAction`; add / remove person use the existing actions.
  - CLAUDE — A started visit is always ended, never deleted, even with no knocks on the server. Only a visit that never started can be deleted.
  - CLAUDE — Today = one column on phone; the visit sheet is a right-hand panel on desktop 1440. Today and tomorrow always show; later dates show when they have visits; past dates never. The Calendar icon, the "Past days" row and Jump to date stay hidden until F4.
  - CLAUDE — Figures refresh every 2 minutes while a visit is open today, live positions every 30 seconds, and the page reloads itself after midnight.
  - CLAUDE — Live map: each person's current position (faded after 10 minutes), their last knock time and its door label (`v_door_label`). "Not sharing a position" when there is none. Nothing stores or sends a location. Admin never reads `navigator.geolocation`.
  - CLAUDE — Remove person = Undo toast (re-adds them). The last person cannot be removed.
  - CLAUDE — Add visit: own URL `/admin/today/add?date=…&prop=…`. Step 1 lists Due props first, others after, archived never. A prop already booked on that date (ended visits included) is greyed. Step 2 shows doors, the rotation slot and the route km, and the team (people out on another prop that date are greyed, max 3). Allocate → `allocatePropAction` → `generateRouteAction` → the new visit's sheet. A route failure never undoes the visit.
  - CLAUDE — Past visits review: own URL `/admin/today/review`. All ticked. One button closes them one at a time with a progress count. Failures stay listed and ticked.
  - CLAUDE — Overlays stack: Escape closes only the top one.
  - CLAUDE — Prop detail's "Open visit" opens that visit's sheet on Today (`visitHref(visitId)`). With no today or planned visit it goes to Today.
  - CLAUDE — Nav: Today → `/admin/today` (dark-ready). The temporary Allocate item is removed. `/admin` → Today. `/admin/allocate` → Today (`?prop=` → Add visit with that prop). The old allocate and dashboard components stay on disk until F6.
  - CLAUDE — Props' URL sync uses `replaceState(null, …)`.
- **Acceptance:**
  - EDIT 1 DONE. New `components/admin/today/add-visit.tsx` pasted as given.
  - EDIT 2 DONE. New `components/admin/today/past-visits-review.tsx` pasted as given.
  - EDIT 3 DONE. New `app/(admin)/admin/today/add/page.tsx` pasted as given.
  - EDIT 4 DONE. New `app/(admin)/admin/today/review/page.tsx` pasted as given.
  - EDIT 5 DONE. `lib/admin/nav.ts`: Today href `/admin/today`, Allocate item removed, `/admin/today` in `DARK_READY_PATHS`, `visitHref` takes a visit id. Each find block occurred once.
  - EDIT 6 DONE. `scripts/verify-ui-10-admin.ts`: Today pages match Today, dashboard and allocate match nothing, Today is dark-ready, no Allocate item, visit link is the sheet. Each find block occurred once.
  - EDIT 7 DONE. `app/(admin)/admin/page.tsx` redirects to `/admin/today`. The find block occurred once.
  - EDIT 8 DONE. `app/(admin)/admin/allocate/page.tsx` replaced with the redirect. `?prop=` opens Add visit with that prop.
  - EDIT 9 DONE. `components/admin/props/props-screen.tsx`: `replaceState(null, …)` and Open visit passes the today or planned visit id. Each find block occurred once.
  - `npx tsc --noEmit`: **PASS** — exit 0.
  - eslint on the nine session files: **PASS** — exit 0.
  - `npm run verify:ui10`: **PASS** — exit 0. Printed `ALL PASS`.
  - `git grep -n "navigator.geolocation" -- components/admin lib/admin`: **PASS** — printed nothing (exit 1).
  - Phone: **NOT VERIFIED**. No browser in this session. The owner checks F3 as a whole.
- **Deviations from brief:** none. The given code was pasted exactly.
- **Not done / deferred:** A browser. A phone. Did not commit. No database row. The 22 stale open visits are cleared by the owner on the review page during the phone check. Old allocate and dashboard components stay on disk until F6.
- **Follow-ups:** The owner checks F3 as a whole (drawer, review of the stale visits, Add visit, visit sheet, live map, dark mode, desktop 1440).

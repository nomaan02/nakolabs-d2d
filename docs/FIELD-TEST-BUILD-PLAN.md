# Field-test build plan (UI-5 to UI-10)

**Owner:** Nomaan · **Planner/reviewer:** Claude · **Executor:** Grok 4.7 in Cursor
**Started:** 2026-10-03 · **Source:** owner's field test, 2026-10-03
**Lives at:** `docs/FIELD-TEST-BUILD-PLAN.md` (committed). The governing document is still `docs/D2D-Build-Brief.md`. This file is the plan for this run of changes only.

## How to use this file (Grok)

- Every session prompt names its session ID (for example `UI-5 A1`). Read **§1, §2, §3 and that session's block in §5** before starting.
- Do ONLY your session. Never start the next one.
- At the end of the session, change **only your row** in the §4 tracker:
  - set Status to `DONE`, `PARTIAL` or `BLOCKED`
  - fill in the date and a 1-line result
  - leave the Commit column as `—` (the owner fills it in)
- Never rewrite §1–§3 or another session's block. If something has to change, add a dated note at the end of §6.
- BUILD-LOG and CLAUDE-HANDOFF entries are still required, exactly as before.

---

## 1. Owner decisions (2026-10-03)

| ID | Decision |
|---|---|
| H1 | **Eligibility.** A door is not knockable if it is in a No Cold Calling Zone, OR its building holds 3+ units. "Units" = the larger of: UPRNs at the same OS point, or addresses sharing house number (or building name) + street + postcode. Two-flat conversions stay knockable. EPC "Flat" alone does not exclude a door. The rule lives in ONE place: `properties.is_knockable`. |
| H2 | **Existing data.** Nothing is ever deleted. Non-knockable doors are hidden in currently open assignments too. Knock writes keep the ORIGINAL snapshot index as `sequence_position`. |
| H3 | **GPS on the phone.** Continuous while the app is open: a direction arrow on both maps and a "near you" door chip. The Stage 16 route position (distance along the route) goes to the partner. |
| H4 | **Exception-only logging (Mode B).** Inferred "Not In" doors go through a review sheet. Solo props only. Stored with `knock_events.origin = 'inferred'`. |
| H5 | **Admin location.** Raw GPS goes to admins. Current position only, overwritten on every update: no trail, no history. Cleared when the visit closes. A visible "sharing location" indicator. Foreground only. The brief's invariant 7 and Section 8 get a dated amendment (UI-7 C0), plus a "DPIA before anyone else uses it" to-do. |
| H6 | The owned/rented (tenure) layer is admin only (invariant 2: no scoring in /field). |
| H7 | Mode B review sheet: gaps of 25+ doors, or a change of street, always ask. Backtracking never fills. |
| U7-1 | **2026-10-04. Sharing on by default** per assignment. A "Sharing" pill in the Logger and Map headers; tap it to Stop (or share again). No opt-in question. |
| U7-2 | **2026-10-04. One send every 30 s**, partner scalar and admin position together (`report_position`). Skipped if moved under 10 m; 2-minute heartbeat. Battery: about +1–3 %/hr on top of GPS. |
| U7-3 | **2026-10-04. Admins see position even off the route.** The partner scalar is still null beyond 100 m. |
| U7-4 | **2026-10-04. Mini map recentre** goes to your position, heading-up, when the fix is 30 m or better; otherwise to the current door, north-up. |
| U7-5 | **2026-10-04. Admin live map** is a "Live now" panel at the top of `/admin/dashboard` until UI-10's Today screen exists. |
| U8-1 | **2026-10-06. Small gaps fill silently** (amends H4). In exceptions-only mode, a gap of under 25 doors on one street is filled as Not In without a sheet. ONE Undo covers the tapped door and the filled doors ("Contact · 18 Ventnor Rd + 12 Not In"). |
| U8-2 | **2026-10-06. Big gaps and street changes ask** (H7). 25+ doors, or a change of street, opens the review sheet with every door ticked. Confirm has its own Undo ("12 Not In · Ventnor Road"), which removes only that batch. |
| U8-3 | **2026-10-06. Only between two real logs.** Any tapped outcome (Lead, Contact, Rented/Council, Not In, Other) is a real log; filled doors never are. Nothing before the first log or after the last, nothing when walking back, never over an existing outcome. |
| UI-10 | **2026-10-06. Admin redesign.** Owner decisions A1–A51 live in project doc `claude/admin-design-HANDBACK.md` (§3, §12, §14, §15). Headlines: drawer on phone, collapsible rail on desktop (A14–A16) · full-screen Props map + Draw with undo/redo/drag (A19–A23) · Today = schedule, allocate date-first (A17, A24–A27) · Calendar page (A38–A46) · field look, Sora, light + dark now (A3, A28) · office out of UI-10 (A29) · admin into /field (A30) · one batch per phase (A49) · old routes redirect then go (A50) · one shared theme setting (A51). Designs approved 2026-10-06 (A47). |
| CRM | **2026-10-10. CRM data into the app** (Brief Stage 12c). Read-only pull of the company CRM (vtiger) into `crm_leads`; door matching with tiers; Insights, heat map, door-history filters, revenue. Owner decisions and plan: project doc `claude/plan-crm-integration-2026-10-10.md`. |
| U8-4 | **2026-10-06. Mode setting:** per canvasser, per phone, in the You tab ("Tap every door" / "Exceptions only"), plus an "Exceptions only" badge in the Logger header. Org default `every_door`, set by an admin in Settings. Team props always tap every door. |

## 2. Facts found on 2026-10-03 (SELECT only, by Claude)

- **No Cold Calling Zones:** `nccz_zones` was empty until 2026-10-03.
  - Loaded by Claude via the Supabase connection: 26 zones, from `data/raw/bristol-nccz.geojson` (Bristol City Council, OGL v3).
  - 13,270 properties flagged.
  - The council file names each zone in a field called `CCZONE`.
- **Knocks already logged inside a zone:** 29 knocks on 22 doors in the Horfield zone, all on "TEST - dry run", 25 Sep to 2 Oct.
- **City-wide eligibility under H1:**

  | | Doors |
  |---|---|
  | Total | 424,952 |
  | Multi-unit | 110,760 |
  | In a No Cold Calling Zone | 13,270 |
  | Knockable | 303,003 |

- **Open props:**

  | Prop | Total | Multi-unit | NCCZ | Knockable |
  |---|---|---|---|---|
  | Southville solo 2 | 1,730 | 661 | 0 | 1,069 |
  | redland | 5,642 | 3,824 | 0 | 1,818 |
  | Northville | 2,450 | 44 | 244 | 2,162 |
  | TEST - dry run | 264 | 39 | 66 | 159 |

- **Addresses:** `property_addresses` covers 133,619 of 424,952 properties, all from EPC. On Southville, 54% of doors have no address text.
- **Saved routes:** `territory_routes.door_order` must equal the assignment snapshot exactly, or `assignment_route_freeze` raises `snapshot_mismatch`. Once `allocate_prop` snapshots knockable doors only, **every prop's routes must be regenerated** before its next allocation can freeze.
- **GPS:** there is no `navigator.geolocation` anywhere in the repo yet (`lib/field/position.ts` is a stub). `assignment_members.route_position_m` and `route_position_at` exist from Stage 2.

## 3. Standing rules for every session

- **Rule 50** (`.cursor/rules/50-plan-execution.mdc`) applies:
  - every numbered EDIT gets a DONE / NOT DONE line
  - read only the listed files
  - paste given code exactly
  - no DB deletes or updates unless the prompt grants that exact write
  - PowerShell only, no `&&`, `git grep`
  - never commit
- **Database:**
  - the next migration number comes from listing `supabase/migrations/`
  - apply with the Supabase MCP `apply_migration` (name = the file name without `.sql`)
  - regenerate `lib/supabase/types.ts`
  - `npx tsc --noEmit` must pass
- **The eligibility rule is never re-implemented in TypeScript.** The client reads `knockable` / `is_knockable` from the database.
- **Phone sizes:** 390×763 (main), 375×667, 430×850.
- **Browser checks need a prop dated TODAY (London)** for CanvasserX. The owner creates or re-dates one before the session.
- **Offline tests:** CDP offline (rule 50). Undo every test log.
- **Invariants:**
  - no scoring in /field
  - field writes only via `lib/sync/queue.ts`
  - no resident names
  - coverage is derived, never stored

---

## 4. Tracker

| Session | What | Status | Date | Result | Commit |
|---|---|---|---|---|---|
| UI-5 A0 | Load No Cold Calling Zones | DONE | 2026-10-03 | 26 zones, 13,270 properties flagged (Claude, via MCP) | n/a (data) |
| UI-5 A1 | Eligibility migration 025 + types + ingest hooks | DONE | 2026-10-03 | 025 applied: 424,952 doors, 110,760 multi-unit, 13,270 NCCZ, 303,003 knockable. Logger loads. | 591913d |
| UI-5 A2 | Field: hide non-knockable doors (logger, maps, counts) | DONE | 2026-10-04 | Logger and map show 53 of 88 on TEST - dry run. First door is snapshot position 1. Offline Not In wrote sequence_position 1, then undo. No new knock. | 3f3604f |
| UI-5 A3 | Admin: 3-state dots and counts, completion/coverage views, route regeneration | DONE | 2026-10-04 | A3a: migration 026, admin counts follow is_knockable. A3b: draw page shows knockable, flats and No Cold Calling. A3c (route regeneration) dropped: allocation regenerates routes on snapshot_mismatch. | 65a1917, cd111e7 |
| UI-5 A4 | Admin tenure layer (optional) | TODO | | | — |
| UI-6 B1 | Mini map: rotate, recentre | DONE | 2026-10-04 | Compact map rotates; recentre returns north-up. tsc, eslint, verify:ui1 and verify:anchors passed. | 025ccd8 |
| UI-6 B2 | Logger tabs: Logging View / Survey Overview | DONE | 2026-10-04 | B2a done: surveyRows + verify:ui6. B2b done: view pills + Survey Overview. Phone check 10/10 passed. | 38fdba1, c21a652 |
| UI-7 C0 | Brief amendment: invariant 7, Section 8, Stage 16 (H3, H5) | DONE | 2026-10-04 | Done by Claude directly (docs only): invariant 7, Section 8 (DPIA/LIA/notice/solicitor to-do), Stage 16 table. Owner read-through pending. | b41a1c3 |
| UI-7 C1 | On-device GPS + direction arrow (both maps) | DONE | 2026-10-06 | C1a done: geo maths + verify:ui7. C1b done: GeoProvider, you marker, recentre, Location off. C4 done: tighter Logger header (U7-6). | 7ad0c10, 8d67f60 |
| UI-7 C2 | "Near you" door chip | DONE | 2026-10-05 | Route snapping on device + near-you chip (2 agreeing fixes, tap to jump). | d5cd445 |
| UI-7 C3 | Position sharing: partner scalar + admin live map | DONE | 2026-10-06 | C3a migration 027 + types. C3b position sender, Sharing pill + notice, partner distance. C3c admin Live now panel. | 94afa8c, 5c0532e, 11788c4 |
| UI-8 D1 | `knock_events.origin` + logging-mode setting | DONE | 2026-10-06 | D1a migration 028 + types. D2b mode setting: You tab, header badge, admin default. | b367097, 31108f3 |
| UI-8 D2 | Mode B inference + review sheet | DONE | 2026-10-06 | D1b inference + verify:ui8. D2c fill on commit (silent under 25), review sheet (25+ / street change), batch Undo, origin inferred. | fafc47d, 5078457 |
| UI-9 E1 | Route door-list editor + server validation | TODO | | | — |
| UI-9 E2 | Manual route tracing (snapped to roads) | TODO | | | — |
| UI-10 F1a | Admin nav logic + `verify:ui10` | DONE | 2026-10-06 | lib/admin/nav.ts + verify:ui10; seed-demo prefer-const. | 54d40d1 |
| UI-10 F1b | Admin tokens, icons, UI kit | DONE | 2026-10-06 | admin tokens + icons + components/admin/ui kit. | c3b3e5a |
| UI-10 F1c | Admin shell: layout, drawer, rail; old nav removed | DONE | 2026-10-06 | admin layout + shell (drawer, rail, menu button); AdminNav removed. Phone check passed 2026-10-07. | 7d0e68e |
| UI-10 F2a | Props + Draw logic (pure) + verify:ui10 | DONE | 2026-10-07 | Props and Draw pure logic + verify:ui10 checks. | 7f13ec7 |
| UI-10 F2b | Admin map kit, Props layers, prop data + actions | DONE | 2026-10-07 | admin map kit (map, sheet), Props layers, prop data loaders, rename/archive/clear-routes actions. | 544a9db |
| UI-10 F2c | `/admin/props`: map, sheet, list, detail, layers | DONE | 2026-10-07 | `/admin/props: full-screen map, sheet, list, search, filters, prop detail, rename, archive/restore, layers.` | 76169e2 |
| UI-10 F2d | Draw, Edit shape, Routes step; nav switch; `/admin` → Props | DONE | 2026-10-07 | Draw (tap, close, undo/redo, drag, add corner), Edit shape, count + name + Save, Routes step (A/B preview), nav switch, /admin → Props. | 954f3f0 |
| UI-10 F2e | Magnifier while dragging a corner (touch, droppable) | DONE | 2026-10-07 | touch magnifier while dragging a corner. Phone check passed 2026-10-07. | 0a646ff |
| UI-10 F3a | Today logic (pure) + verify:ui10 | DONE | 2026-10-08 | Today pure logic + verify:ui10 checks. | 7577367 |
| UI-10 F3b | Today data loaders, last knocks, end-visit action | DONE | 2026-10-08 | Today data loader, last-knock loader, closeVisitAction, LiveRow.assignmentId. | 2795e74 |
| UI-10 F3c | `/admin/today`: schedule, visit sheet, live map | DONE | 2026-10-08 | `/admin/today: schedule, needs attention row, numbers, visit sheet (team, route, end/delete), live map.` | 953c735 |
| UI-10 F3d | Add visit, past visits review; nav switch; `/admin` + `/admin/allocate` → Today | DONE | 2026-10-08 | Phone check passed 2026-10-08. `Add visit (date → prop → team → Allocate), past visits review (end/delete), nav switch, /admin and /admin/allocate → Today, Open visit → visit sheet.` | 11bfa01 |
| UI-10 F4a | Calendar + Coverage logic (pure); visits end once their day comes; verify:ui10 | DONE | 2026-10-08 | Calendar and Coverage pure logic; visits end, never delete, once their day comes; verify:ui10 checks. | b77bfca |
| UI-10 F4b | Calendar + Coverage data loaders | DONE | 2026-10-08 | readAll paging, Calendar month loader, Coverage loader (no migration). | 31f0dcd |
| UI-10 F4c | `/admin/calendar`; Calendar in nav; Appearance; Today → Calendar | DONE | 2026-10-08 | `/admin/calendar (month grid, swipe, day panel, End for unworked visits, Open on map), Calendar in nav, Appearance control, Today → Calendar.` | 9c21ad9 |
| UI-10 F4d | Coverage rebuilt: map, filters, door popup | DONE | 2026-10-08 | Phone check passed 2026-10-08. Coverage rebuilt: full-screen map, filter chips (days, visit, slot, outcome, person, prop), door popup, legend, dark-ready. | b06245d |
| UI-10 F5a | Team, profile, Leads, Insights, Settings logic (pure); verify:ui10 | DONE | 2026-10-09 | Team, profile, Leads, Insights and Settings pure logic; verify:ui10 F5a checks. | b348922 |
| UI-10 F5b | Team, profile, Leads, Insights, Settings loaders | DONE | 2026-10-09 | Team, canvasser, Leads, Insights and Settings loaders (no migration). | 01b4a8d (landed with F5c) |
| UI-10 F5c | `/admin/team` + canvasser profile; Team in nav | DONE | 2026-10-09 | `/admin/team (period chips, sort, cards) and /admin/team/<id> profile; Team in nav.` | 01b4a8d |
| UI-10 F5d | `/admin/leads` (read-only) + `/admin/insights`; dashboard → Insights | DONE | 2026-10-09 | `/admin/leads (period + status chips, read-only) and /admin/insights (charts); /admin/dashboard → Insights.` | 4bc9425 |
| UI-10 F5e | `/admin/settings` rebuilt; `/auth/confirm` + `/set-password`; `/signup` removed | DONE | 2026-10-09 | `/admin/settings rebuilt (threshold and logging sheets, Appearance, accounts list, data status); /auth/confirm + /set-password; /signup removed.` | c1eab5d |
| UI-10 F5f | human: migration 029 `admin_set_canvasser_active`; account switches; invite by email | DONE | 2026-10-09 | Phone check passed 2026-10-10. Migration 029 admin_set_canvasser_active applied, types regenerated; Settings switches accounts on/off and invites by email (service role, server only). | 5a7232f |
| UI-10 F6a | Delete old admin components; remove terra-draw | DONE | 2026-10-10 | 14 old admin components deleted; terra-draw packages removed. | cbec18d |
| UI-10 F6b | Go canvassing in nav; admin pickable; Back to admin in /field | DONE | 2026-10-10 | Go canvassing in nav; admin pickable for teams; Back to admin on the You tab; canCanvass/mayOpen. | 4850e1c |
| UI-10 F6c | human: migration 030 (admin canvassing, FU-2 delete guard, FU-3 started_at); middleware | DONE | 2026-10-10 | Migration 030 applied (admin may log and be on teams; FU-2 delete guard; FU-3 started_at trigger + backfill); middleware opens /field to the admin. | 417e653 |
| UI-10 F6d | human: migration 031 `admin_latest_knocks` (FU-1); Calendar, Coverage, Team read through it | DONE | 2026-10-10 | Phone check passed 2026-10-10. Migration 031 admin_latest_knocks applied, types regenerated; Calendar, Coverage and Team read through it. | 8748fd7 |
| CRM-1 A | human: migration 032 `crm_leads`, `crm_status_map`, `crm_sync_runs` + types | DONE | 2026-10-10 | Migration 032 applied (crm_leads, crm_status_map 7 rows, crm_sync_runs; admin + office read only); types regenerated. | — |
| CRM-1 B | human: migration 033 matcher; read-only CRM client, sync and backfill script | DONE | 2026-10-10 | Migration 033 crm_match_batch applied, types regenerated; lib/crm client/parse/sync, crm:backfill (dry run default) and verify:crm added. Backfill not run. | — |
| CRM-2 A | human: migration 034 `crm_insights`, `crm_heat_grid`, `crm_door_history` + types | DONE | 2026-10-10 | Migration 034 crm_insights, crm_heat_grid, crm_door_history applied (admin/office, read-only); types regenerated. | — |
| CRM-2 B | CRM pure logic, data loaders, colour tokens, verify:crm checks | DONE | 2026-10-10 | CRM pure logic (crm-insights, crm-map), data loaders, crm colour tokens, verify:crm checks. | — |
| CRM-2 C | Insights Company CRM view | DONE | 2026-10-10 | Insights Company CRM view (switch, booked this week, period sheet, hero, chart, areas, props). | — |
| CRM-2 D | CRM layers on Coverage and Props | DONE | 2026-10-10 | CRM heat map and CRM doors on Coverage; CRM history layer on Props. | — |
| CRM-2 E | human: migration 035 `crm_insights` London-day fixes + types | DONE | 2026-10-10 | Migration 035: crm_insights daily windows and Booked this week in London days. | — |
| CRM-3 A | human: sale price from Result / Rep Result; Insights missing amounts and Other | DONE | 2026-10-11 | Sale price read from Result / Rep Result when Sale Amount is empty; Insights shows missing amounts and spells out Other. | — |
| CRM-4 A | human: CRM sync every 30 minutes (route + migration 036 pg_cron) and "CRM updated" on Insights | DONE | 2026-10-11 | CRM sync every 30 min (route + pg_cron migration 036); Insights shows when the CRM last updated. | — |
| CRM-5 A | human: migration 037 (canvasser CRM link, call-back contacts, call results, leaderboard) + sync fills call-back reason and contacts | DONE | 2026-10-11 | Migration 037: canvasser CRM link, call-back contacts (90-day purge), call results, leaderboard; sync fills call-back reason + contacts. | — |
| CRM-5 B | human: `crm_callback` op in the offline queue (call results synced from the phone) | DONE | 2026-10-12 | Offline queue: crm_callback op (call results synced to crm_callbacks). | — |
| CRM-5 U | human: sign in with a username + a script to create canvasser accounts linked to their CRM name | DONE | 2026-10-12 | Sign in with a username; accounts:create script makes canvasser accounts linked to their CRM name. | — |
| CRM-5 C1 | Leads → Call-backs + result sheet; You → my results, my week, leaderboard | DONE | 2026-10-12 | Leads → Call-backs + result sheet; You → my results, my week, leaderboard. | — |
| CRM-5 C2 | Map → My CRM leads layer (own leads, off by default) | DONE | 2026-10-12 | Map → My CRM leads layer (own leads, off by default). | — |
| CRM-6 A | Leaderboard ranks by pitches by default; My results leads with Pitched | DONE | 2026-10-13 | Leaderboard ranks by pitches by default (Pitched · Sales · Value); My results leads with Pitched. | — |
| CRM-6 B | human: call-backs show the CRM address and open to show the CRM notes (migration 038) | DONE | 2026-10-13 | Call-backs show the CRM address + postcode and open to show status, Result, Product interest, Best time to call and Description (migration 038). | — |
| CRM-6 C | human: the Coverage CRM layer follows the Days chip (migration 039) | DONE | 2026-10-13 | Coverage CRM layer (heat map and doors) follows the Days chip; squares from 2 leads under three months (migration 039). | — |

---

## 5. Sessions

### UI-5: Data eligibility (field requirement P0.1)

**Goal:** buildings with 3+ units and No Cold Calling Zone doors vanish from the logger, the maps, the counts and route generation. Nothing is deleted.

**UI-5 A1: eligibility in the database**
- Migration 025:
  - `properties.units_at_point`, `units_at_address`, generated `is_multi_unit` and `is_knockable`
  - `refresh_door_eligibility()` (service role only), run once as a backfill
  - `count_knockable`, `properties_in_polygon`, `route_walk_inputs` and `allocate_prop` switch to `is_knockable`
  - `todays_assignment` adds a `knockable` flag per door. The snapshot, sequence and door_count are unchanged, so today's client keeps working.
- Ingest hooks:
  - `ingest-uprn.ts` and `ingest-addresses.ts` call `refresh_door_eligibility` at the end
  - `ingest-nccz.ts` reads the `CCZONE` name
- **Acceptance:**
  - totals match §2 (multi-unit 110,760, knockable 303,003)
  - `authenticated` cannot execute `refresh_door_eligibility`
  - the field app still loads today's prop with no error
  - tsc exits 0

**UI-5 A2: field client hides non-knockable doors (H2)**
- The logger sequence, door scroll, "Door x of N", stats, Map tab dots, mini map, building slices and route door markers all skip doors with `knockable === false`.
- Knock writes keep the ORIGINAL snapshot index in `sequence_position`.
- The cursor, nextOpenIndex and the team logic work on the filtered list.
- **Offline cache:** the Dexie cache refreshes so an open assignment hides flats after the next sync. Check whether a Dexie version bump is needed.
- **Acceptance:**
  - Southville solo 2 shows 1,069 doors
  - a log writes the original `sequence_position`
  - offline load still works
  - verify:ui1 and verify:stage8b pass, or a documented update is made

**UI-5 A3: admin and views**
- **Draw page:**
  - dots in 3 states: knockable, flats (multi-unit), No Cold Calling
  - count copy: "N knockable · N flats · N no cold calling" (needs an extended count RPC: new migration)
  - NCCZ polygons drawn on the map
- **Views:** `v_prop_completion`, `coverage_map_payload` and `admin_dashboard` count only knockable doors as "remaining", so a flat is never "left to do".
- **Route regeneration:** a script, in the pattern of `scripts/route-geom-apply.ts`, re-saves the routes of every non-archived prop. The owner runs it; it's the only write. Unworked open assignments are re-frozen only if the owner says so.
- **Acceptance:**
  - the draw page shows 3 dot states
  - every live prop's `best` door_order equals its knockable set
  - completion "remaining" excludes flats

**UI-5 A4 (optional): admin tenure layer (H6)**
- **Sources:**
  - own Rented/Council observations (`property_observations`)
  - EPC tenure (needs re-ingesting: an `ingest-addresses.ts` pass)
  - Census TS054 area share
- An admin-only map toggle. Never in /field.

### UI-6: Logger quick wins (P2.2, P2.1)

**UI-6 B1: mini map parity (P2.2)**
- Two-finger rotate on the compact FieldMap.
- A recentre button appears after a manual pan, rotate or zoom. It snaps back to the current door, or to the GPS position once UI-7 lands.
- The door-scroll swipe must not fight the map gestures.
- **Acceptance:**
  - rotate, pinch and pan work on the iPhone
  - recentre works
  - the door swipe is unaffected

**UI-6 B2: Logging View / Survey Overview tabs (P2.1)**
- **Figma mock first** (Claude). A segmented control at the top of the Logger.
- The Survey Overview is a virtualised two-column list:
  - columns: address | outcome
  - order: route order, with sticky street headers
  - includes doors still to knock
  - tapping a row opens the outcome picker and re-logs (a new event, latest wins)
- **Addressless rows:** a fallback label (street + door number in route order). The wording gets decided in the Figma step.
- **Acceptance:**
  - 1,069 rows scroll smoothly at 390×763
  - a re-log updates instantly, offline

### UI-7: GPS (P1.5, P2.2 arrow; H3, H5)

**UI-7 C0: brief amendment (docs only)**
- Dated amendments to invariant 7, Section 8 and Stage 16:
  - on-device continuous fixes (H3)
  - raw position to admins, current only (H5)
  - no trail, ever
  - cleared at close
  - visible indicator
  - opt-in per assignment
  - fallback when denied
  - "DPIA before anyone else uses it" to-do
- **Acceptance:** an owner read-through.

**UI-7 C1: on-device GPS + arrow**
- A `useGeoPosition` hook using `watchPosition` (high accuracy), only while the page is visible.
- Heading from `DeviceOrientationEvent`. iOS needs `requestPermission` on a tap.
- Arrow on the Map tab and the mini map.
- Fixes with accuracy worse than 30 m are dimmed.
- **Denied permission:** everything works as today, with a quiet notice.
- No coordinate is stored, in IndexedDB or anywhere else, in this session.
- **Acceptance:**
  - the arrow moves on a walk test
  - "denied" leaves the logger working
  - no fix appears in any network payload (C3 adds the admin channel deliberately)

**UI-7 C2: "near you" chip**
- Snap the fix onto the route line. The nearest knockable door by distance along the route becomes the chip ("Near you: 42 Coronation Rd → Jump").
- Hysteresis: the chip changes only after 2 agreeing fixes.
- Off-route by more than 100 m: no chip.
- The chip suggests and never jumps on its own (owner can change this later).
- **Acceptance:** walking 3 doors moves the chip about 3 doors, with no flicker.

**UI-7 C3: sharing**
- **Partner:** `assignment_members.route_position_m` / `_at`, an update roughly every 30 s while visible.
- **Admins:** a new table `live_positions`:
  - one row per canvasser, upserted (never inserted twice)
  - RLS: admin read, own-row write
  - lat, lon, accuracy, heading, at
  - nulled on assignment close
  - no history table, ever
- An admin live map (on the Today screen, or a temporary panel until UI-10).
- A "Sharing location" indicator in /field whenever it's on.
- **Acceptance:**
  - the row count stays constant while walking
  - closing the visit nulls the row
  - a canvasser cannot read another canvasser's row

### UI-8: Exception-only logging (P1.4; H4, H7)

**Amended 2026-10-06 (owner U8-1..U8-4).** Sessions: D1b `lib/field/inference.ts` + `verify:ui8` · D1a migration 028 (`knock_events.origin`, `logging_default()`, `set_logging_default()`) + types · D2b mode setting (You tab, header badge, admin default) · D2c fill on commit, review sheet, batch Undo. Figma: page 5:2, section "UI-8 Exceptions only (2026-10-06)". Where this section and U8-1..U8-4 differ, U8-1..U8-4 win.

**UI-8 D1:**
- Migration: `knock_events.origin text not null default 'tap' check (origin in ('tap','inferred'))`.
- A logging-mode setting: per user, stored locally, with an org default in `app_settings`.
- A mode badge in the logger header.
- Mode B is disabled on team props.

**UI-8 D2:**
- When a door is logged in Mode B, collect the unlogged knockable doors between the last confirmed log and this one, in route order.
- Show the review sheet: list, untick, Confirm.
- Writes go through the queue with `origin = 'inferred'`.
- Undo removes the whole batch.
- **Never fill:**
  - an existing outcome
  - when backtracking
  - a gap of 25+ doors, or a change of street, without asking
- **Acceptance:** log #5 then #18 → the sheet lists #6–#17 minus doors already logged.

### UI-9: Route editing (P1.2, P1.1)

**UI-9 E1: door-list editor**
- On a prop's saved variant: reorder (drag), remove (swipe), re-add.
- Saves as a new variant `edited_N`, which the freeze key regex must accept.
- Server validation: knockable only, no duplicates, `validate.ts` V1–V6.
- **Acceptance:** an ineligible door is rejected; the edited order shows in the logger after allocation.

**UI-9 E2: manual trace**
- The admin taps along streets; the trace snaps to `road_segments` and the pavement side.
- Doors are ordered by where they fall along the trace.
- Saved as `manual_N`. Doors the trace doesn't reach are counted as stranded.
- **Acceptance:** trace → save → allocate → the logger follows the trace, and it reloads unchanged next visit.

### UI-10: Mobile admin (P1.3)

**Amended 2026-10-06 (owner A1–A51, designs approved A47).** Figma: page "Admin — design" (40:289), phone section 89:295 (frames 01–38), desktop section 100:1709 (D1–D3), components 47:6278. Rule `.cursor/rules/25-admin-ui.mdc`, skill `admin-ui`, profile `.ux-profile.md`. One queue batch per phase (`-Batch ui-10`), phone check after each phase. Every migration / RPC session is `gate: human` and last in its phase.

**F1 Shell (M1, M4)**
- F1a: `lib/admin/nav.ts` (nav items, active-route matching, rail state, dark-ready paths, initials) + `verify:ui10`. Folds in `seed-demo.ts` let→const.
- F1b: admin tokens in `app/globals.css` (`text-admin-*`, `warn-ink`, shadows, sheet radius, motion; dark block extended to `.admin-root`), admin icons in `components/field/icons.tsx`, UI kit `components/admin/ui/*`.
- F1c: `app/(admin)/layout.tsx` (Sora, shared theme), `components/admin/shell/*` (drawer, rail, menu button), `AdminNav` removed from the five old pages. Old pages stay light until rebuilt.

**F2 Props + Draw (M2), amended 2026-10-07 — no migration, all `gate: auto`:** F2a pure (draw history, sheet detents, prop states, map geometry, draw/route copy) · F2b admin map kit (`useAdminMap`, `MapSheet`), Props layers, data loaders, `lib/props/manage.ts` (rename, archive/restore, clear routes) · F2c `/admin/props` map + sheet + list + prop detail + layers · F2d Draw, Edit shape, Routes step, nav switch, `/admin` → Props · F2e magnifier (droppable). The old F2f (migration 029) is dropped: rename and archive are plain `territories` updates under admin RLS, and nothing in F2 reads footprints.

**F3 Today (M3):** F3a pure (schedule, card lines, stale end/delete split, confirms, add-visit lists) + verify:ui10 · F3b data (`loadToday`, `loadLastKnocks`, `closeVisitAction`, `LiveRow.assignmentId`) · F3c `/admin/today` (schedule, needs attention, numbers, visit sheet, live map) · F3d Add visit (`/admin/today/add`), past visits review (`/admin/today/review`), nav switch, `/admin` and `/admin/allocate` → Today. All `gate: auto`. **No migration** (owner, 2026-10-07: the old F3d / 030 is dropped; existing tables, views and RPCs cover it).

**F4 Calendar + Coverage:** F4a pure (`lib/admin/calendar.ts`, `lib/admin/coverage-filters.ts`) + the owner's end/delete rule (`mustEnd(visit, figures, today)`) + verify:ui10 · F4b loaders (`readAll`, `loadCalendarMonth`, `loadCoverage`) · F4c `/admin/calendar` (grid, swipe, day panel, Open on map), Calendar in nav, Appearance (System / Light / Dark) in drawer and rail, Today → Calendar · F4d Coverage rebuilt (full-screen map, chips, door popup, legend, dark-ready). All `gate: auto`. **No migration** (owner, 2026-10-08: the old F4d / 031 is dropped).

**F5 Team, Leads, Settings, Insights (amended 2026-10-09):** F5a pure (`lib/admin/team.ts`, `leads.ts`, `insights.ts`, `settings.ts`) + verify:ui10 · F5b loaders (`lookups.ts`, `team-data.ts`, `leads-data.ts`, `insights-data.ts`, `settings-data.ts`; no migration) · F5c `/admin/team` (Analytics) + `/admin/team/<id>` canvasser profile (Detail), Team in nav · F5d `/admin/leads` (List, read-only) + `/admin/insights` (Dashboard), `/admin/dashboard` → Insights, Leads and Insights in nav · F5e `/admin/settings` rebuilt (Settings), `/auth/confirm` + `/set-password`, `/signup` removed (invite only) · F5f **human**: migration **029** `admin_set_canvasser_active` + types regen, account switches, invite by email (service role, server only). F5a–F5e `gate: auto`. The old "032" label is gone: per-canvasser numbers need no migration.

**F6 (amended 2026-10-10):** F6a delete the 14 old admin components + terra-draw · F6b "Go canvassing" (A30) in nav, the admin pickable for teams, "Back to admin" on the field You tab, `canCanvass` / `mayOpen` · F6c **human**: migration **030** (admin may log knocks, leads, rented answers and be on teams; FU-2 delete guard in `assignment_remove`; FU-3 `started_at` trigger + backfill) and middleware · F6d **human**: migration **031** `admin_latest_knocks` (FU-1); Calendar, Coverage and Team read through it.

- **Acceptance:**
  - no horizontal overflow at 375, 390 or 430 px; desktop works at 1440
  - draw → route → edit → allocate is completed end to end on the iPhone
  - light and dark both readable on every rebuilt page

### CRM-1: CRM data (Brief Stage 12c)

- **P1 (CRM-1 A, human):** migration **032**: `crm_leads`, `crm_status_map` (7 rows), `crm_sync_runs`; admin + office SELECT, no API writes; types regenerated. AGENTS "CRM data" and Brief 12c written by Claude.
- **P2:** matcher (migration 033) + `scripts/crm-backfill.ts` (dry run, then real run by the owner).
- **P3:** daily Vercel Cron `app/api/cron/crm-sync/route.ts`.
- **P4:** Insights (trends by month/branch, revenue) · Coverage heat map by postcode sector · Coverage/Props filters (source app/CRM, previous outcome). Admin only.
- **Later:** map extension beyond BS1–BS16 (load UPRNs + addresses for BS20+ and nearby) · `/office` sync review (A29).

---

## 6. Dated notes

- 2026-10-03 (Claude): plan approved by the owner. "UI item 4" is already used in BUILD-LOG (route focus), so this run starts at UI-5.
- 2026-10-04 (Claude): UI-7 plan approved by the owner (U7-1..U7-5). Sessions: C0 (Claude, docs) · C1a `lib/field/geo.ts` + `verify:ui7` · C1b GPS provider, arrow, recentre, location-off notice · C2 near-you chip + route position hook · C3a migration 027 (`live_positions`, `report_position`, `stop_sharing_position`, `admin_live_positions`, close triggers) · C3c admin "Live now" panel · C3b field sender, Sharing pill, notice, partner distance. Figma: page 5:2, section "UI-7 GPS (2026-10-04)". "You" marker is violet (never an outcome colour).
- 2026-10-06 (Claude): UI-7 phone check passed (owner, all points). One follow-up from it: U7-6 tighter Logger header (session UI-7 C4).
- 2026-10-06 (Claude): UI-8 plan approved by the owner (U8-1..U8-4). CLAUDE decisions: `origin` is sent only for filled rows (`'inferred'`); filled times are spread evenly between the last real log and the new one; only Logger commits fill (Map tab logs still count as real logs); after going back to fix an earlier door, the next forward log fills only from the furthest real log; batch Undo is in `lib/field/undo.ts` (no `lib/sync/queue.ts` change).
- 2026-10-06 (Claude): UI-8 landed (fafc47d, b367097, 31108f3, 5078457) and the owner phone check passed (all points). Migration 028 proof: Claude re-ran it with owner approval after fixing its own test setup (the first run moved REF - Speedwell onto a date its territory already had). No `logging` row is stored, so the org default is `every_door`. Security advisor: only the expected new entries (`logging_default`, `set_logging_default` callable by signed-in users; the setter checks admin itself).
- 2026-10-06 (Claude): UI-10 designs approved (A47) and the phase plan approved by the owner. Owner tooling written directly by Claude: `.ux-profile.md`, AGENTS.md "UI/UX skills" block, `.cursor/rules/25-admin-ui.mdc`, `.cursor/skills/admin-ui/SKILL.md`. CLAUDE decisions for F1: nav items appear only once their page exists (F1: Today→old dashboard, Props→old draw page, temporary Allocate item, Coverage, Settings); dark mode is opt-in per rebuilt route via `DARK_READY_PATHS` so the old worksheet pages never render dark; the admin theme boot script lives in a plain module (`lib/admin/theme-boot.ts`) because `lib/field/theme.ts` is "use client", and `verify:ui10` checks the two strings match.
- 2026-10-07 (Claude): UI-10 F1 landed (54d40d1, c3b3e5a, 7d0e68e) and the owner phone check passed (drawer, rail, menu; the boxed draw page was expected to stay until F2). F2 queued as five `gate: auto` sessions (F2a–F2e), built and tested in Claude's workspace copy of 7d0e68e: each prompt replayed onto a pristine tree, tsc + eslint + `verify:ui10` pass after every session, final tree byte-identical; the screens were exercised in headless Chromium at 390×664 and 1440×900, light and dark (draw, drag, close, name sheet, layers, menu, sheet drag). An independent review agent found 11 bugs (stuck drag on release off the map, stale prop highlight, swallowed tap after a sheet drag, late route result, Escape/Enter leaking into Draw, focus bounce in overlays); all fixed before queueing. CLAUDE decisions: Due = nothing planned and the last counting visit 28+ days ago, or never visited (`PROP_DUE_AFTER_DAYS`, matches the old dashboard's 4 weeks); the Routes step previews Route A (odd visits, `best`) and Route B (even visits, `best_reversed`) instead of "choosing" one, because the rotation picks; routes are generated and saved straight after Save, and if Edit shape's new routes fail the old ones are deleted so the next allocation makes fresh ones; admin reads no location, so the mock's ⌖ is "Show all props"; Routes layer = selected prop only; archive refused while a visit is today or planned; per-prop door counts are `count_door_eligibility` calls streamed after the list renders (an RPC can replace this later if the prop count grows); "Open visit" goes to the old allocate page until F3.
- 2026-10-07 (Claude): UI-10 F2 landed (7f13ec7, 544a9db, 76169e2, 954f3f0, 0a646ff) and the owner phone check passed. Owner (2026-10-07): F3 has no migration; the 22 stale open visits are cleared through the new review page in the F3 phone check. F3 queued as four `gate: auto` sessions (F3a–F3d), built and tested in Claude's workspace copy of 0a646ff: each prompt replayed onto a pristine tree, tsc + eslint + `verify:ui10` pass after every session, final tree byte-identical; screens exercised in headless Chromium at 390 and 1440, light and dark. An independent review agent found 10 issues (a started visit with no synced knocks could be deleted, losing knocks still queued on a phone; `replaceState` with Next's state broke router sync; no failure handling around actions; "booked" ignored ended visits; phone/desktop layout flash; the toast covered the sheet footer; Escape closed several layers; figures never refreshed; map redraws on refresh; selection outliving its visit); all fixed before queueing. CLAUDE decisions: a started visit is always ended (`assignment_close_early`), never deleted; only a visit that never started can be deleted (`assignment_remove`); figures refresh every 2 minutes while a visit is open today, positions every 30 seconds, and the page reloads after midnight; the Calendar icon, "Past days" row and Jump to date stay hidden until F4 builds Calendar; `/admin/dashboard` stays reachable by URL until it becomes Insights (F5); `/admin/allocate` redirects to Today (`?prop=` → Add visit with that prop); prop detail's "Open visit" opens that visit's sheet on Today; overlays stack so Escape closes only the top one; Add visit greys a prop already booked on the date (ended visits included: one visit per prop per day).
- 2026-10-08 (Claude): UI-10 F3 landed (7577367, 2795e74, 953c735, 11bfa01; F3a was committed by hand after the session froze editing the 462 KB BUILD-LOG) and the owner phone check passed, including clearing the stale visits. BUILD-LOG entries before UI-10 moved to `docs/BUILD-LOG-archive.md` (owner approved). Owner decisions 2026-10-08: F4 has no migration; Coverage gets a door popup; admin gets Light / Dark / System now (drawer and rail); and, amending A27 and A46, **once a visit's day has come it is ended, never deleted** (nothing in the app writes `assignments.started_at` yet, so the F3 "started" rule protected nothing; a phone may hold unsynced knocks). F4 queued as four `gate: auto` sessions (F4a–F4d), built and tested in Claude's workspace copy of 11bfa01: each prompt replayed onto a pristine tree, tsc + eslint + `verify:ui10` pass after every session, final tree byte-identical; screens exercised in headless Chromium at 390 and 1440, light and dark. An independent review agent found 10 issues, then 4 more on re-review (Delete offered on days that may have been worked offline; "not worked" for visits knocked outside the grid; whole-history reads and payloads; offset-paging duplicates; Today link; archived or unknown prop filter invisible; `not_interested` painted as unknocked; unpaged assignments and long `in` lists; error under the dialog; duplicate keys; wrong day on Back after Clear; "last 7 days" that widened); all fixed. CLAUDE decisions: Calendar entries and Coverage door colours are resolved on the server so no knock rows reach the browser; rows are read 1,000 at a time and de-duplicated per door per visit; Coverage opens on the last 30 days with no prop and on all time for one prop (neither counts as a filter; `period=all` is all time); a visit knocked only outside the grid is never "not worked"; Calendar offers End only; "Past days" row says "Every day's visits and numbers" (no extra query); `not_interested` paints as other. Follow-ups for a later migration: an RPC so Calendar and Coverage stop reading `v_latest_knock` (its DISTINCT ON sorts all knocks per page) as volume grows; a server-side guard in `assignment_remove` that refuses deletes once `work_date` is today or earlier.
- 2026-10-09 (Claude): UI-10 F5 plan approved by the owner. Owner decisions 2026-10-09: Team and Insights numbers are computed without a migration (as F4); canvasser accounts are in F5 as the last session, human-gated (migration **029**, the next free number); Insights keeps doors per prop per week, answer rate by slot, lead outcomes, prop completion and stale props ("Live now" stays on Today only); order Team + Leads, then Settings + Insights; invites are emailed through the owner's own SMTP; `/signup` is removed (invite only); tapping a canvasser opens a full profile; Leads gets period chips like Team. F5 queued as six sessions (F5a–F5e `gate: auto`, F5f `gate: human`), built and tested in Claude's workspace copy of 7b9a6e5: each prompt replayed onto a pristine tree, tsc + eslint + `verify:ui10` pass after every session, final tree byte-identical; screens exercised in headless Chromium at 375, 390, 430 and 1440, light and dark (Team, profile, Leads, Insights, Settings, the threshold, logging and invite sheets, the switch-off confirm). The independent review agent stopped on a usage limit before reporting; Claude reviewed the code itself and fixed three issues (switch-off error hidden under the dialog, Enter not submitting the sheets, the lead chart's subtitle). CLAUDE decisions: a door belongs to whoever logged its latest outcome; contact → lead = leads ÷ (contacts + leads), since a lead was a contact before it was booked (never above 100%); lead → sale = sales ÷ leads the office has settled; This week = Monday to Sunday, Last 4 weeks = 28 days to today; Team lists active canvassers plus anyone who knocked in the period; the profile compares the period with all time and lists the last 10 leads, 14 days (each opens Calendar on that day) and 20 doors; Leads rows show the office status as a ring (still with the office) or a dot (settled) beside its word, 50 rows then Show more; Insights bars are neutral ink with their numbers as text, lead marks are the only colour; Settings' Last data load is the later of NCCZ zones added and address labels updated; switching an account off asks first and warns about planned visits and knocks still on the phone; the invite link lands on `/auth/confirm` (token verified, then the fixed path `/set-password`). Owner setup before the invite test: Supabase custom SMTP, the invite email template, Site URL and redirect URLs, and "Allow new users to sign up" off (steps in the project handback §21).
- 2026-10-10 (Claude): UI-10 F5 landed (b348922 F5a, 01b4a8d F5b + F5c, 4bc9425 F5d, c1eab5d F5e, 5a7232f F5f; docs ba7413f before them) and the owner phone check passed (all 10 points, including the invite email through the owner's SMTP). F5a–F5e passed first time. F5f was marked FAIL by the log scan only because Claude's own SELECT check contained the text `'UPDATE'` (`pg_policies.cmd`); the only database write was the granted migration 029, and every landed file matched Claude's tested copy. F5b's files went into the F5c commit when landing (contents unchanged). Lesson for prompt writing: never put SQL keywords (insert, update, delete, create, alter, drop, grant, revoke, truncate) inside quoted text in a check query, because the scan reads them as writes. Next: F6 (admin into /field, "Go canvassing", A30; delete the old admin routes and components).
- 2026-10-10 (Claude): UI-10 F6 plan approved by the owner. Owner decisions 2026-10-10: the admin is always pickable for a team; in /field the admin sees the canvasser app plus "Back to admin" on the You tab; FU-1, FU-2 and FU-3 fold into F6; the D2 test knock is already gone (nothing to remove). F6 queued as four sessions (F6a–F6b `gate: auto`, F6c and F6d `gate: human`), built and tested in Claude's workspace copy of 5a7232f: each prompt replayed onto a pristine tree, tsc + eslint + `verify:ui10` pass after every session, final tree identical except `package-lock.json` (F6a regenerates it with `npm install`). Migrations 030 and 031 were run on a throwaway Postgres 16 with the same policies (admin knock on own visit allowed, on another visit and by office refused; admin lead pending only; team checks take the admin, not office; today's visit can't be deleted; `started_at` follows the earliest knock, also for a canvasser's insert; non-admins can't call the RPC), and the RPC's query was compared with `v_latest_knock` on live data (SELECT only): zero differences for all time, a month, one person, a window + person and a list of visits. CLAUDE decisions: `allocate_prop` and `assignment_member_add` are re-created from their stored definitions with only the role line changed (count-checked) rather than retyped; FU-3 is a database trigger so `lib/sync/queue.ts` is untouched; trigger functions do not appear in the generated types, so F6c expects no types change; check queries in prompts avoid SQL write words (the runner's scan matches them anywhere). The independent review agent could not run (usage limit until 11 Oct).
- 2026-10-10 (Claude): UI-10 F6 landed (cbec18d F6a, 4850e1c F6b, 417e653 F6c, 8748fd7 F6d) and the owner phone check passed (all 6 points). F6a, F6b and F6d passed first time. F6c was marked FAIL by the log scan, a false positive: its four check queries were plain SELECTs, but the scan reads the whole tool call, and Grok's own labels for two of them contained "insert" and "delete". The only database writes were the granted migrations 030 and 031. Claude checked every landed file against its tested copy (identical apart from line endings) and checked the live database read-only: 030's trigger, policies, team checks and delete guard are in place; 26 visits have `started_at`, each equal to its first knock; 031's function body matches the migration file exactly, it is SECURITY INVOKER, and anon cannot run it. Lesson: prompt wording can't prevent this false FAIL, because the label is Grok's own. The fix belongs in `scripts/agent/lib.ps1` (scan only the SQL, not the label). UI-10 is complete; Office (A29) is the next phase on the plan.
- 2026-10-10 (Claude): CRM integration plan approved by the owner (written OK from work received). Probes (read-only, aggregates only): 20,651 leads Dec 2023–today, only the Leads module visible, 100 rows per page, 0 duplicates over 207 pages, 98.4% of streets start with a house number, 29.8% of postcodes outside BS, 4,075 blank statuses. Owner decisions 2026-10-10: Booked→confirmed on crm_leads only (option A); blank status = No outcome; outside-area leads in Insights now, map extension later; canvasser = tidied first name. Claude wrote AGENTS "CRM data", Brief 12c and this section directly. Migration 032 tested on a local Postgres 16 + PostGIS: tier/UPRN/point constraints, status values, admin and office read, canvasser and no-profile see nothing, anon refused, no API writes. CRM-1 A queued (human).
- 2026-10-10 (Claude): CRM-1 B landed. Owner ran the backfill: dry run, then `--write --tz=utc` (CRM screen shows 11:46 for an API time of 10:46:43, so the API sends UTC), then the same command again. Run 1: 20,651 inserted, 0 skipped, 0 unknown statuses. Run 2: 0 / 0 / 20,651 unchanged (idempotent). Claude checked the database (SELECT only): 20,651 rows, 4,969 distinct doors with CRM history, no tier/UPRN or status/raw mismatch, created 2023-12-04 to 2026-10-10. Placement: outside_area 11,113 · exact 4,320 · snapped 1,354 · street_nearest 326 · interpolated 296 · unmatched 3,242. Of the unmatched, 1,164 are BS15, 753 BS16 and 240 BS31 (districts only partly loaded, or barely: BS31 has 3 address labels) and 276 have no usable postcode; about 800 are inside the city. So the map extension (South Glos BS15/BS16/BS30/BS31 and North Somerset) is the main gain. Lesson: Claude's device copy tool reuses an earlier upload when the staged file name repeats, so each push to the owner's PC uses a new file name and is checked by re-staging.

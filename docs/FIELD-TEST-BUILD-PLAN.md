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
| UI-10 F1a | Admin nav logic + `verify:ui10` | TODO | | | — |
| UI-10 F1b | Admin tokens, icons, UI kit | TODO | | | — |
| UI-10 F1c | Admin shell: layout, drawer, rail; old nav removed | TODO | | | — |
| UI-10 F2 | Props + Draw (F2a–F2f; F2f migration 029, human) | TODO | | | — |
| UI-10 F3 | Today + allocations (F3a–F3d; F3d migration 030, human) | TODO | | | — |
| UI-10 F4 | Calendar + Coverage (F4a–F4d; F4d migration 031, human) | TODO | | | — |
| UI-10 F5 | Team, Leads, Settings, Insights (F5a–F5c; F5c migration 032, human) | TODO | | | — |
| UI-10 F6 | Admin into /field + delete old routes (human) | TODO | | | — |

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

**F2 Props + Draw (M2):** F2a pure (draw history, sheet detents, map fit) · F2b `/admin/props` map + sheet + layers + prop detail · F2c Draw mode · F2d route choice + Edit shape · F2e magnifier (droppable) · F2f human: migration 029 (`prop_archive`, footprints grant).

**F3 Today (M3):** F3a pure (schedule grouping, stale end/delete split, CTA labels) · F3b Today page + Live chip · F3c visit sheet, Add visit (`/admin/today/add`), past-visits review · F3d human: migration 030 (`admin_day_board`, `admin_needs_attention`, `assignment_close_bulk`).

**F4 Calendar + Coverage:** F4a pure (month grid, URL state) · F4b `/admin/calendar` + day overlay · F4c Coverage restyle, filters, focus from Calendar + Back · F4d human: migration 031 (`admin_calendar_month`, coverage filter args).

**F5 Team, Leads, Settings, Insights:** F5a Team + Leads · F5b Settings (+ invite sheet) and Insights (old dashboard panels restyled, A48) · F5c human: migration 032 (`admin_canvasser_stats`, `admin_set_profile_active`) + invite server action.

**F6:** human: admin allowed into /field ("Go canvassing"); old routes deleted.

- **Acceptance:**
  - no horizontal overflow at 375, 390 or 430 px; desktop works at 1440
  - draw → route → edit → allocate is completed end to end on the iPhone
  - light and dark both readable on every rebuilt page

---

## 6. Dated notes

- 2026-10-03 (Claude): plan approved by the owner. "UI item 4" is already used in BUILD-LOG (route focus), so this run starts at UI-5.
- 2026-10-04 (Claude): UI-7 plan approved by the owner (U7-1..U7-5). Sessions: C0 (Claude, docs) · C1a `lib/field/geo.ts` + `verify:ui7` · C1b GPS provider, arrow, recentre, location-off notice · C2 near-you chip + route position hook · C3a migration 027 (`live_positions`, `report_position`, `stop_sharing_position`, `admin_live_positions`, close triggers) · C3c admin "Live now" panel · C3b field sender, Sharing pill, notice, partner distance. Figma: page 5:2, section "UI-7 GPS (2026-10-04)". "You" marker is violet (never an outcome colour).
- 2026-10-06 (Claude): UI-7 phone check passed (owner, all points). One follow-up from it: U7-6 tighter Logger header (session UI-7 C4).
- 2026-10-06 (Claude): UI-8 plan approved by the owner (U8-1..U8-4). CLAUDE decisions: `origin` is sent only for filled rows (`'inferred'`); filled times are spread evenly between the last real log and the new one; only Logger commits fill (Map tab logs still count as real logs); after going back to fix an earlier door, the next forward log fills only from the furthest real log; batch Undo is in `lib/field/undo.ts` (no `lib/sync/queue.ts` change).
- 2026-10-06 (Claude): UI-8 landed (fafc47d, b367097, 31108f3, 5078457) and the owner phone check passed (all points). Migration 028 proof: Claude re-ran it with owner approval after fixing its own test setup (the first run moved REF - Speedwell onto a date its territory already had). No `logging` row is stored, so the org default is `every_door`. Security advisor: only the expected new entries (`logging_default`, `set_logging_default` callable by signed-in users; the setter checks admin itself).
- 2026-10-06 (Claude): UI-10 designs approved (A47) and the phase plan approved by the owner. Owner tooling written directly by Claude: `.ux-profile.md`, AGENTS.md "UI/UX skills" block, `.cursor/rules/25-admin-ui.mdc`, `.cursor/skills/admin-ui/SKILL.md`. CLAUDE decisions for F1: nav items appear only once their page exists (F1: Today→old dashboard, Props→old draw page, temporary Allocate item, Coverage, Settings); dark mode is opt-in per rebuilt route via `DARK_READY_PATHS` so the old worksheet pages never render dark; the admin theme boot script lives in a plain module (`lib/admin/theme-boot.ts`) because `lib/field/theme.ts` is "use client", and `verify:ui10` checks the two strings match.

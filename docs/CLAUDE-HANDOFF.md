# Claude handoff log

## Current state

- Last updated: 2026-10-04 (UI-6 Session B2b). Uncommitted. **The owner commits after review — this session did not commit.** The runner may checkpoint.
- The Logger has scrollable `Logging` and `Survey` pills under the prop name and the visit line. Survey replaces the door panel, stats, mini map and note bar with the list from `surveyRows`. Header, team strip and sheets stay. Tapping a row returns to Logging on that door.
- The chosen view is kept in `sessionStorage` (`d2d.loggerView`). A storage failure stays on Logging.
- The existing route-door local in `logger-tab.tsx` was renamed from `view` to `routeDoor` so it does not collide with the new view state. The pasted blocks were not rewritten.
- `npx tsc --noEmit` exited 0. eslint on the three field files exited 0. `npm run verify:ui1` and `npm run verify:ui6` exited 0.
- No migration. No database row. No `client_event_id`.
- UI-6 B2 Status is DONE. Result is `B2a done: surveyRows + verify:ui6. B2b done: view pills + Survey Overview.`
- A3c is not started. Routes are not regenerated (H8). The 20 old open assignments were left as they are (H9). The tenure layer stays deferred until after UI-7 (H10).
- Still open from UI-5 A1: allocating a prop fails with `snapshot_mismatch` until A3c regenerates routes. Knock `730525dc-7e2f-42c8-a3d5-6291949edcc7` is still the owner's.
- No magic link this session. Password, profile and role were not changed.
- External settings changed since handover: none. No browser. No dev server.

## Log

### 2026-09-26 — Stage 10 next door and partner position (e7dd51a015f700fbfc39ca001d47acee49897dab)

- **Item:** other
- **What changed:** Field Map and Logger show the next door: the lowest snapshot door that is neither knocked nor held by someone else, with the street and Take. Take claims it and opens the existing outcome buttons. Back, Skip, a different row, and closing the map sheet release the claim. A log broadcasts `knocked`. Claims are Supabase Realtime broadcast on `assignment:<id>` with `private: true`. They are not inserted. A claim expires three minutes after `at`. Teammate lines use the address ladder, then `on #N`, and an empty line when there is no claim and no knock. A dropped connection greys the line and adds "last heard". Solo hides the lines. After sync, a UPRN also knocked by a teammate is flagged on the device. Coverage stays one row in `v_latest_knock`.
- **Files:**
  - Changed: `components/field/field-data-provider.tsx`, `components/field/logger-tab.tsx`, `components/field/map-tab.tsx`, `components/field/profile-tab.tsx`, `docs/BUILD-LOG.md`, `docs/D2D-Build-Brief.md`, `lib/field/cursor.ts`, `lib/field/db.ts`, `lib/field/undo.ts`, `lib/sync/queue.ts`, `package.json`
  - New: `components/field/next-door-card.tsx`, `components/field/shared-knock-notice.tsx`, `components/field/teammate-lines.tsx`, `lib/field/door-signals.ts`, `lib/field/shared-knock.ts`, `lib/field/use-team.ts`, `scripts/verify-stage-10.ts`, `supabase/migrations/023_stage_10_realtime_auth.sql`
  - Deleted: none
  - `package.json` keeps `verify:stage9` and adds `verify:stage10`. The stage 10 edit had replaced the stage 9 script line. That line was put back in this commit.
- **Database:** 023 `023_stage_10_realtime_auth.sql`. Select and insert policies on `realtime.messages` for broadcast, active assignment members only. `profiles_select_teammate` so a canvasser can read a teammate's name. No claims table. `route_position_m` and `route_position_at` are not written. `realtime.messages` RLS was already on. This migration does not enable it.
- **Shared modules touched:** `lib/sync/queue.ts` (local shared-door flag after flush), `lib/field/cursor.ts`, `lib/field/db.ts`, `lib/field/undo.ts`, and the new `lib/field/door-signals.ts`, `lib/field/use-team.ts`, `lib/field/shared-knock.ts`. `lib/map/route-layers.ts`, `lib/geo/walk/*`, and `lib/supabase/*` were not changed.
- **Decided by:** agent — reserve the next free door on subscribe so three open sessions do not all show the same door. Take still claims and opens the sheet. A freed lower door does not pull someone off a door they already hold. Recorded as a deviation in `docs/BUILD-LOG.md`. No owner decision in this commit.
- **Deviations from plan or brief:** Migration 023, because private Realtime authorisation is RLS on `realtime.messages` and teammate names were not readable. No claims table. Connected clients reserve on subscribe. `route_position_m` is not turned into a door while Stage 16 is off. Teammate names are not stored in Dexie, so a reload with no signal has no lines to grey. A connection drop without a reload does grey them.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. Knocks still go through `lib/sync/queue.ts`. The shared-door flag is a local Dexie field set after sync. Claims are broadcast, not inserted.
- **Verified:** `scripts/verify-stage-10.ts` against the live project, plus a browser pass on the throwaway trio and solo props. Three subscribed sessions, distinct next doors: 3 (example UPRN 48895), run twice. Claim still live at 2 min 59 sec and not live at 3 min 1 sec (wall clock 181015 ms). Offline next door from Dexie was snapshot position 0 (UPRN 48895) after Supabase was blocked. Empty teammate line for Cid Moss. Solo hid the lines. Trio showed two lines. Outsider private channel: `CHANNEL_ERROR Unauthorized`, 0 messages. Two knock inserts, 2 rows, 1 UPRN, `v_latest_knock` count 1. `npx tsc --noEmit` exit 0. eslint on the changed files exit 0. Reconnect: read `lib/field/use-team.ts`, `lib/field/door-signals.ts`, and `@supabase/phoenix` `Channel.rejoin` / `Push.resend`. A socket rejoin calls the same subscribe callback with `SUBSCRIBED`. That callback resends the in-memory live claim (same `at`, same UPRN). `reserveDecision` returns `hold` if this canvasser already wins that door, and `none` when `wantReserve` is false, which is set after a hold. The channel effect does not re-run on a socket drop, so it does not clear that claim. No code change.
- **Not verified:** A live network drop in the browser. On-device sun, one-handed, and wet-thumb checks. Full airplane mode (localhost blocked, dev shell did not load). `private_only` on the Realtime project.
- **External settings:** none changed. Realtime "Allow public access" left on.
- **Open questions for Claude:** Set `private_only` when a management token exists, so a public join is rejected rather than merely empty. A full page load is not a socket rejoin: claims are not stored, so that first subscribe reserves the next free door. Say if a reload should keep the same door. That would need a local copy of the claim. It was not built.

### 2026-09-27 — UI item 4 plan approved (uncommitted)

- **Item:** 4 — route line styling
- **What changed:** The owner approved the route-line focus plan (`ui_4_route_focus`), including the 2026-09-27 review amendments 1–8. Implementation has not started. The one renderer will paint the current street and the next street at full strength, later legs as solid tints, and walked steps grey, with sparse chevrons and baked START / END badges. The highlight follows the next-door card. Admin gets the same look with no progress shading.
- **Files:** none yet. Planned new: `lib/map/street-name.ts`, `lib/map/route-progress.ts`, `scripts/verify-ui-4-route-focus.ts`. Planned edits: `lib/map/route-layers.ts`, `lib/field/route-display.ts`, `lib/map/route-load.ts`, `components/field/field-data-provider.tsx`, `components/field/field-map.tsx`, `components/field/map-tab.tsx`, `package.json`, `docs/D2D-Build-Brief.md`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`.
- **Database:** none
- **Shared modules touched:** none yet
- **Decided by:**
  - owner — 1A: a cross starts a new leg; the out side and the return side of one street are separate legs.
  - owner — 2A: greying is per step. Every step before the current step is done, even inside the current street.
  - owner — 3A: remove the burgundy crossing dots. The U-turn arc already shows the cross.
  - owner — 4A: admin maps get the same new look with no progress shading. Everything renders as focus. No fork of the renderer.
  - owner — 5A: focus colour starts at `#c2410c`. Fade with solid pre-mixed tints at opacity 1.
  - owner — plan approved, including review amendments 1–8 (rename to `computeRouteTiers`; PowerShell-safe commands; prove the shortest-leg chevron with a z17 screenshot and do not change spacing; protected counts 936 / 26 / 4 / 17; report `realtime.messages` and never delete from `realtime.*`; freeze parity default `best`, or `best_reversed` if `best` needs more than 15 logs; log the agent decisions below; A3 and A5 in a real browser).
  - agent, not approved by the owner yet — north/south badge flip.
  - agent, not approved by the owner yet — chevron approach (a): rebuild the chevron source with `setData`, tier as a feature property.
  - agent, not approved by the owner yet — `symbol-spacing` 120.
  - agent, not approved by the owner yet — chevron paper halo.
  - agent, not approved by the owner yet — legend labels "First door" / "Last door".
  - agent, not approved by the owner yet — `dataset.routeCrossings` redefined to count cross steps.
- **Deviations from plan or brief:** none. Implementation has not started.
- **Invariants:** no GPS and no coordinates. No quality scoring in `/field`. No field writes. No change to `lib/sync/queue.ts`.
- **Verified:** not applicable. No code yet.
- **Not verified:** the whole item. A3–A7 need a real browser after implementation.
- **External settings:** none
- **Open questions for Claude:** none for this approval. The agent decisions above still need an owner yes or no.

### 2026-09-27 — UI item 4 route line styling (uncommitted)

- **Item:** 4 — route line styling
- **What changed:** The one route renderer now paints the current street and the next street at full strength (`#c2410c`), later legs as solid tints, and walked steps grey and thinner with no chevrons. Chevrons are a sparse SDF ">" (spacing 120). START and END are baked pills. Crossing dots are gone. The highlight follows the next-door position. Admin maps use the same look with every step in focus. The throwaway prop was created and deleted in this session.
- **Files:**
  - Changed: `lib/map/route-layers.ts`, `lib/field/route-display.ts`, `lib/map/route-load.ts`, `components/field/field-data-provider.tsx`, `components/field/field-map.tsx`, `components/field/map-tab.tsx`, `package.json`, `docs/D2D-Build-Brief.md`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: `lib/map/street-name.ts`, `lib/map/route-progress.ts`, `scripts/verify-ui-4-route-focus.ts`
  - Deleted: none
- **Database:** none
- **Shared modules touched:** `lib/map/route-layers.ts` (the renderer) and `lib/field/route-display.ts` (street and sequence passed through). `lib/sync/queue.ts`, `lib/geo/walk/*` and `lib/supabase/*` were not changed.
- **Decided by:**
  - owner — decisions 1A to 5A, and the plan with review amendments 1–8, recorded in the entry above.
  - agent, not approved by the owner yet — north/south badge flip; chevron approach (a); `symbol-spacing` 120; chevron paper halo; legend labels "First door" / "Last door"; `dataset.routeCrossings` counts cross steps.
  - agent — the tier effect waits until `route-walk-lines` exists before it writes `dataset.routeLayers`, so an early run cannot publish an empty list.
- **Deviations from plan or brief:** Chevron geometry is rebuilt with `setData`. Badge anchors flip by which end is further north. `routeCrossings` counts cross steps. `best` was frozen (6 logs to the second leg, not more than 15). `best_reversed` was not used.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No new field write path. `lib/sync/queue.ts` is unchanged (`git diff --quiet` exit 0). `git grep` for `geolocation` is 2 lines in the worktree and 2 lines at HEAD.
- **Verified:** `npm run verify:ui4` exit 0. `npx tsc --noEmit` exit 0. eslint exit 0. London date from `select (timezone('Europe/London', now()))::date` was `2026-09-27`, the same as `londonDate()`. Browser on the throwaway canvasser: sequence 0 `done:0,focus:2,near:2,far:13`; after 3 logs sequence 3, same counts; sequence 6 `done:1,focus:3,near:1,far:12`. Remount left the counts unchanged. At sequence 35, `routeLayers` was `route-walk-work,route-walk-other,route-walk-chevrons,route-walk-start,route-walk-end` and `routeCrossings` was 2. Frozen admin map screenshot shows one orange line, chevrons, START and END. Cleanup: knock_events 936, assignments 26, auth.users 4, territories 17. `v_latest_knock` for the fixture assignment: 0. REF/TEST route_steps 17, 17, 29, 38. TEST knocks 17. `auth.users` / `profiles` / `auth.sessions` like `ui4-%`: 0. `realtime.messages` for `assignment:2de12359-1e7c-41d1-827b-a2264c0cfff8`: 0. Nothing was deleted from `realtime.*`.
- **Not verified:** A zoom-17 chevron on the 54.1 m Ventnor leg (step 4, seq 64–66). Draw-page Generate and variant dimming. Production offline reload (`ERR_INTERNET_DISCONNECTED` on the dev server). On-device sun, one-handed use, wet thumb, haptics, and 2,000 doors.
- **External settings:** none
- **Open questions for Claude:** Accept or reject the six agent decisions. If the 54.1 m leg shows no chevron at zoom 17, leave the spacing at 120.

### 2026-09-27 — Robust walkline offset: plan approved (uncommitted)

- **Item:** other — route geometry (clears part of the "162 walkline corner gaps" known issue)
- **What changed:** The owner approved the "Robust walkline offset" plan (`robust_walkline_offset_2febe30f.plan.md`), with the 2026-09-27 review amendments 1–6 and the two decisions below. Implementation had not started at the point this entry was written (Session A, Step 0).
- **Files:** none yet.
- **Database:** none planned.
- **Shared modules touched:** none yet.
- **Decided by:**
  - owner — D1: re-save Northville's territory variants once G2 passes.
  - owner — D2: the geometry validator warns on Save and never blocks.
  - owner — D3: a cheap route fingerprint check in `ensureRoute`, online only.
  - owner — the fingerprint timeout is 3 s, in a named constant.
  - owner — the G7 magic link for CanvasserX (ticktocktekker343@gmail.com) is allowed; that account's password, profile and role are never changed.
  - owner — the plan is approved with the 2026-09-27 review amendments 1–6.
  - owner — the fallback (b) reading is accepted: when a removal cascade has eaten edges between two kept offset segments, "the vertex the join replaces" (the mitre-limit fallback condition) means the nearest of those removed vertices, not a single named one.
  - owner — new validator check V6 ("silent collapse"): reports any WORK step whose centreline length is greater than 2d but whose walkline length is under 0.05 m; `metres` = the centreline length; a short stub (e.g. Northville's 1 m step 0) does not trigger it; V6 is included in G1 and G2 alongside V1–V5.
  - agent proposal, owner accepted 2026-09-27 — running r2 on RED - Speedwell and leaving its saved variants in place.
  - agent proposal, owner accepted 2026-09-27 — the draw-page check on a throwaway prop.
  - agent proposal, owner accepted 2026-09-27 — clamp, not bevel, for an outside corner past the mitre limit.
  - agent proposal, owner accepted 2026-09-27 — the bridge rule as amended: removal always runs before the bridge; the bridge is only a fallback for (a) an anti-parallel pair or (b) a narrow U/V per the fallback-(b) reading above.
  - agent proposal, owner accepted 2026-09-27 — the free-end cap (mirrors the free-start collapse rule).
  - agent proposal, owner accepted 2026-09-27 — removing `RUN_BREAK_RAD` from `continuesRun`.
  - agent proposal, owner accepted 2026-09-27 — the `min(id)` route-fingerprint design.
  - agent proposal, owner accepted 2026-09-27 — `walk_meta` as the verification aid carrying per-step offset/side/fixed-end facts.
  - agent proposal, owner accepted 2026-09-27 — V5 judged on the drawing side (a walk-back strip's stored `side` stays the hand, per the 2026-09-25 note).
- **Deviations from plan or brief:** none (approval only; no code yet).
- **Invariants:** no GPS, no coordinates, no quality scoring in `/field`, `lib/sync/queue.ts` unchanged. Not applicable yet (no code).
- **Verified:** not applicable.
- **Not verified:** the whole item.
- **External settings:** none.
- **Open questions for Claude:** none for this approval.

### 2026-09-27 — Robust walkline offset, Session A of 2 (uncommitted)

- **Item:** other — route geometry
- **What changed:** `offsetRun` / `offsetPolyline` are rewired onto a new `offsetCore`: an offset edge that would end up reversed or ≤0 long is removed and its neighbours re-joined, repeated until stable, before any bridge fallback. Outside corners still mitre-then-clamp at 2d. `continuesRun` no longer breaks a run at a sharp turn angle (`RUN_BREAK_RAD` removed) — the new join handles it. Every step now carries a `walk_meta` verification aid (offset metres/side, which end was rewritten by an arc or connector). A new pure validator (`validate.ts`) implements V1 continuity, V2 self-crossing, V3 crossing-the-next-step, V4 fidelity to the centreline, V5 declared side, and V6 (owner addition, silent collapse). A new script (`verify-route-geom.ts`) runs G1 (16 synthetic cases + 1 informative case, all pure) and, with `--live`, G2 (in-memory regeneration vs stored rows for REF - Speedwell, TEST - dry run, Northville, read-only). Session B (wiring into Generate/Save, the fingerprint, re-saves/re-freezes, browser checks) was explicitly out of scope for this session and was not started.
- **Files:**
  - Changed: `lib/geo/walk/geometry.ts`, `lib/geo/walk/steps.ts`, `lib/geo/walk/types.ts`, `lib/geo/walk/save.ts`, `package.json`
  - New: `lib/geo/walk/validate.ts`, `scripts/verify-route-geom.ts`
  - Deleted: none. Removed from `geometry.ts`: `cornerMitre`, `joinOvershoots`, `offsetGroup`, the old `along` helper, the old vertex-by-vertex `offsetPolyline` body. Removed from `steps.ts`: `RUN_BREAK_RAD`.
- **Database:** none. No migration.
- **Shared modules touched:** `lib/geo/walk/geometry.ts` (the offset algorithm itself — `offsetCore`, `offsetRun`, `offsetPolyline` rewritten) and `lib/geo/walk/steps.ts` (`continuesRun`, `walk_meta` construction). Not touched: `lib/geo/walk/trim.ts`, `traverse.ts`, `generate.ts`, `freeze.ts`, `lib/map/route-layers.ts`, `lib/field/*`, `lib/sync/queue.ts`, `lib/supabase/*`, migrations.
- **Decided by:** as recorded in the "plan approved" entry immediately above. No new decisions in this entry; two engineering choices were made while implementing the plan's own spec (documented, not deviations from it):
  - agent — the V4 "non-arc" exclusion at a fixed end is a flat `ARC_POINTS` (9) vertex guard from that end (the plan's "`ARC_POINTS − 1` plus 1 for a connector" collapsed to one constant, since `walk_meta` only carries a boolean per end, not a count).
  - agent — `validateVariant`'s coordinate projection is local to each variant, centred on its own first walkline point, per the plan's "positions are projected with `makeProjection` around the first walkline point."
- **Deviations from plan or brief:** none knowingly. See the unresolved finding below, which is a result, not a deviation.
- **Invariants:** no GPS, no coordinates. No quality scoring in `/field`. `lib/sync/queue.ts` untouched (not read or written by this session). No migration. Nothing written to the database this session — G2 was run read-only (an admin session for `route_walk_inputs` and `SELECT`s only).
- **Verified:**
  - `npx tsc --noEmit`: exit 0. `eslint` on every changed/new file above: exit 0.
  - `npm run verify:geom` (G1): 16/16 named cases PASS (0 issues each), plus 1 case marked INFORMATIVE by design (a narrow inside U with a 4 m throat, under 2d — V4 fires as the plan documents it should). The three named inside-corner cases (rounded kerb 5×0.8 m, chamfer 3×1.0 m, 0.5+0.5 m) each land within 0.0000 m of the plain two-edge 90° corner's own joint (limit 0.05 m).
  - `npm run verify:geom -- --live` (G2), read-only, admin session (magic link + OTP, no user created): raw counts (gaps > 0.5 m, gaps crossing the next step, self-crossing walklines) are 0/0/0 on all three of REF - Speedwell (6 variants), TEST - dry run (5 variants) and Northville (6 variants). §2 fields (kind, side, street_name, first_seq, last_seq, instruction, is_dead_end, segment_id, length_m, step position, plus `rank_cost_m` and a `door_order` md5) are identical to the stored `territory_routes` / `territory_route_steps` rows on all three, for every variant key.
  - Before (stored) vs after (in-memory) raw counts — see the chat report for the full table; in short: REF - Speedwell 5/5/0 → 0/0/0; TEST - dry run 0/0/5 → 0/0/0; Northville 64/36or31/6 → 0/0/0 (the plan's baseline said 36 crossings, this session's own raw-count pass over the same stored rows found 31; both are reported, not reconciled, per the brief's instruction).
  - Frozen `route_steps` (read-only, not regenerated) gaps match the plan's VERIFIED note exactly: REF - Speedwell 22/24/27 Sept 1 gap each; TEST - dry run 25 Sept 1, 26/27 Sept 0.
- **Not verified — open finding, reported not resolved:** the V1–V6 validator finds 12 issues on Northville (V3 ×3, V4 ×9) even though raw counts are 0. Traced to 3 physical locations (not 12 independent faults): a Filton Road `walk` step (V3, 10.968 m, matches the plan's own documented "non-local closeness" limit — a road can loop back within 2d of itself and no local offset prevents that); an Eden Grove `work` step (V4, ≈0.887 m past the band); a Gayner Road `walk` step, 16 points (V4, 1.714 m past the band, mirrored in `best_reversed`). No tolerance, threshold or expected value was changed to investigate or to try to clear this. This is not resolved and needs an owner decision before Session B's `--live` gate is re-run.
- **External settings:** none.
- **Open questions for Claude:** whether the 3 Northville locations above are an accepted "documented limit" case (like the informative narrow-U in G1) or need a further fix before Session B proceeds. Session B's own hard rule ("re-run `verify:geom -- --live`; if not all-zero, stop") will hit this on Northville specifically.

### 2026-09-27 — Robust walkline offset, Session A2 (adaptive offset + exact arc guard) — GATE HIT, STOPPED (uncommitted)

- **Item:** other — route geometry
- **What changed:** `walklinesXY` (`steps.ts`) no longer offsets each run at a single fixed metre value. For each run it tries a fixed ladder in turn — a normal run 4, 3, 2, 1 m; a walk-back strip 2, 1.5, 1, 0.5 m — and keeps the FIRST rung whose run-local V2/V3/V4/V6 check passes (V1/V5 hold by construction). If none passes it uses the ladder's last (smallest) rung and lets the global validator report it. The run-local check calls the SAME low-level helpers `validate.ts` uses (now exported: `dist`, `isZeroLength`, `segIntersection`, `selfCrosses`, `distToPolylineXY`, `TOL_M`, `FIDELITY_TOL_M`, `COLLAPSE_M`), not a duplicate implementation. `walk_meta.offset_m` is now the offset actually used; a new `offset_base_m` (4 or 2) records the run's own ladder start, so a reduction can be counted. Separately, the flat 9-vertex (`ARC_POINTS`) arc guard is replaced by exact per-end counts: `head_arc_points` / `tail_arc_points` (a uTurnArc splice → `ARC_POINTS − 1` = 8; a connector push/unshift → 1). `validate.ts`'s `nonArcRange` uses these counts directly. `PAVEMENT_OFFSET_M` and `WALK_BACK_INSET_M` are unchanged; the ladder is built from them (`[PAVEMENT_OFFSET_M, 3, 2, 1]` / `[PAVEMENT_OFFSET_M − WALK_BACK_INSET_M, 1.5, 1, 0.5]`), not re-tuned. 3 new G1 cases were added (a 39 m turning-bulb arc; the Eden Grove / Filton Road out-and-back shape; the existing informative narrow-U re-run through the ladder). G2 gained a reduced-offset table per prop and a named check of Northville's 3 places from the owner's review.
- **Files:**
  - Changed: `lib/geo/walk/steps.ts`, `lib/geo/walk/types.ts`, `lib/geo/walk/validate.ts`, `scripts/verify-route-geom.ts`
  - New: none
  - Deleted: none. `lib/geo/walk/geometry.ts` was not touched — no pure helper needed to move.
- **Database:** none. No migration. No database write (G2 ran read-only, same admin-session mechanism as Session A).
- **Shared modules touched:** `lib/geo/walk/steps.ts` (`walklinesXY`, `buildVariant`'s arc/connector bookkeeping) and `lib/geo/walk/validate.ts` (new exports, `nonArcRange` signature). Not touched: `geometry.ts`, `trim.ts`, `traverse.ts`, `generate.ts`, `freeze.ts`, `save.ts`, `lib/map/route-layers.ts`, `lib/field/*`, `lib/sync/queue.ts`, `lib/supabase/*`.
- **Decided by:**
  - owner — no exception list; fix it in the algorithm so any prop validates (recorded in this session's own instructions).
  - owner — the 36-vs-31 Northville crossing-baseline difference is resolved, not a discrepancy (36 counted every consecutive walkline crossing, 31 only crossings at gaps).
  - owner (by review) — the OLD stored Eden Grove/Filton Road and Gayner Road geometry was already wrong at these same 2 places, so today's findings there are not regressions.
  - agent — for the two G1 cases that needed a genuinely tight synthetic shape (turning bulb, out-and-back), the exact metre figures given (radius 6 m, 39 m arc) are not jointly achievable without exceeding a full turn (2·π·6 ≈ 37.7 m is already a full circle) — confirmed by hand: any lead-in/lead-out, or the arc itself past 360°, crosses back over itself at the seam regardless of offset, because it is a centreline self-overlap, not an offset artefact. Radius 6.5 m is the closest value to the plan's "6 m" that keeps a 39 m arc under one turn (343.8°) and genuinely exercises the ladder (4 m and 3 m both fail there; 2 m is the first to pass). Documented in `scripts/verify-route-geom.ts`'s own comment, not hidden.
- **Deviations from plan or brief:** the turning-bulb G1 case uses radius 6.5 m, not exactly 6 m, for the reason above. No tolerance, threshold, or V1–V6 check definition was changed; only the offset each check measures against (now the offset actually used) — as instructed.
- **Invariants:** no GPS, no coordinates. No quality scoring in `/field`. `lib/sync/queue.ts` untouched. No migration. G2 read-only.
- **Verified:**
  - `npx tsc --noEmit`: exit 0. `eslint` on `lib/geo/walk/steps.ts`, `validate.ts`, `types.ts`, `scripts/verify-route-geom.ts`: exit 0. (G4: PASS.)
  - `npm run verify:geom` (G1): every case PASS, 0 issues, including the 2 new hard cases: `turning-bulb-39m-r6.5-16v-inside` (offset used 2 m, ladder base 4 m, 16 walkline points) and `out-and-back-eden-grove-filton-road` (out leg 4 m/base 4 m, back leg 2 m/base 2 m). 2 cases stay INFORMATIVE by design: the original fixed-offset narrow-U (1 issue, V4 3.950 m) and the same shape re-run through the ladder (`informative-narrow-U-under-2d-adaptive`: offset used 1 m, 0 issues — the ladder clears it, reported informatively either way, per instruction). (G1: PASS.)
  - `npm run verify:geom -- --live` (G2), read-only: raw defect counts (gaps, crossing-next-step, self-crossing) 0/0/0 and §2 fields identical to stored rows, unchanged from Session A, on all three of REF - Speedwell, TEST - dry run, Northville.
  - Reduced-offset table (steps whose used offset is below the run's own ladder base): REF - Speedwell 0 steps. TEST - dry run 0 steps. Northville: 3 m used on 34 steps (e.g. `best` step 329, Gloucester Road North); 1 m used on 107 steps (e.g. `best` step 296, Gloucester Road North). REF - Speedwell and TEST - dry run are both 0, as expected; neither needed listing.
  - Northville's 3 named places (owner's 2026-09-27 review): **Gayner Road — PASS, 0 issues** (offset used 3 m or 4 m across its steps, 2 m on its short walk-back stretch, varying by variant). **Eden Grove — FAIL.** **Filton Road — FAIL** (same physical location as Eden Grove: the dead-end knock and its return).
- **Not verified / gate hit — session stopped, not fixed:** the V1–V6 validator still reports 12 issues on Northville (V3 ×6, V4 ×6), all at the Filton Road / Eden Grove out-and-back (`best` steps 305–307, mirrored `alt_1` 365–367 and `alt_4` 281–283; `best_reversed` and other alts pass through the same physical spot cleanly). Traced by hand (coordinates, `walk_meta`, and `tree.step_chain` read directly, no fix attempted): steps 300–310 are ALL offset at 1 m (the ladder's smallest rung) with `head_arc_points`/`tail_arc_points` = 0 throughout — Eden Grove (`tree.step_chain` 46, `chain_parent` −1, a root chain) is reached from Filton Road via a `chain: -1` straight-line transfer, not a shared-node road turn, so `lib/geo/walk/trim.ts`'s `findTurns` never registers a "turn" there and `walkBackStrips` (in `steps.ts`, which IS an allowed file, but has nothing to act on) never sets `inStrip` for the return leg. Both the outbound and the return walkline are therefore offset onto the SAME hand-side, never the opposite/inset side that a proper walk-back strip would use — so no ladder rung, down to 1 m, can stop them crossing; this is a topological gap in `trim.ts` / `traverse.ts`'s turn-vs-transfer classification, not an offset-tightness problem, and both those files are outside this session's 4-file allowance (`steps.ts`, `validate.ts`, `types.ts`, `geometry.ts`). Per this session's own gate ("G2 is not 0 on raw counts and V1–V6 for all three props" → stop and report), no further code change was attempted.
- **External settings:** none.
- **Open questions for Claude:** whether to open a Session A3 (or fold into Session B) to fix the Eden Grove / Filton Road turn/transfer classification in `trim.ts`/`traverse.ts`, and whether Gayner Road being clean plus this session's 4-file-scoped ladder/arc-guard fix is enough to re-save Northville's variants now for the 2 places that are fixed, or whether all 3 places must be clean first (owner decision D1, "re-save Northville's territory variants once G2 passes", has not been met — G2 is not all-zero).

### 2026-09-27 — Route geometry Session A3: ladder fallback keeps the base (uncommitted)

- **Item:** other — route geometry
- **What changed:** If no ladder rung passes the run-local check, the run now keeps its base offset (4 m, or 2 m for a walk-back strip). A2 used the smallest rung, which put 107 Northville steps at 1 m, including main-road stretches of Gloucester Road North. The global validator still reports such a run. The rest of the ladder is unchanged. G2 now splits the reduced-offset table, reports the longest reduced run, and prints the exact remaining issue set.
- **Files:**
  - Changed: `lib/geo/walk/steps.ts`, `lib/geo/walk/types.ts`, `scripts/verify-route-geom.ts`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: none
  - Deleted: none
  - `lib/geo/walk/validate.ts`: allowed, not changed.
- **Database:** none. No migration. G2 read-only.
- **Shared modules touched:** `lib/geo/walk/steps.ts` (`offsetRunAdaptive` fallback and new `ladderPassed`; `walklinesXY` carries run index and pass flag). `lib/geo/walk/types.ts` (`walk_meta.offset_ladder_passed`, `walk_meta.offset_run`; stripped before storage with the rest of `walk_meta`).
- **Decided by:**
  - owner — if no rung passes, use the run's base offset (4 m, or 2 m for a walk-back strip), not the smallest rung. The global validator still reports that run. Nothing else about the ladder changes.
  - owner — the Filton Road / Eden Grove case is a traversal classification gap, fixed later as its own planned item, not here, and not added to any exception list.
  - agent — `walk_meta` carries `offset_ladder_passed` and `offset_run` so G2 can tell "passed at base" from "kept at base", and group steps into runs.
  - agent — 2 new G1 cases: a self-crossing centreline must come back at base with `ladderPassed` false (normal run and strip).
- **Deviations from plan or brief:** none. The G2 line "every remaining issue is at Filton Road / Eden Grove (within 2 steps)" is a report. It filters nothing; the validator line still reports FAIL.
- **Invariants:** no GPS, no coordinates. No quality scoring in `/field`. No field write; `lib/sync/queue.ts` untouched. No database write.
- **Verified:**
  - G1 (`npm run verify:geom`): PASS. All cases pass, including `fallback-keeps-base-normal-run` (4 m, passed false) and `fallback-keeps-base-walk-back-strip` (2 m, passed false).
  - G2 (`npm run verify:geom -- --live`), read-only: raw counts 0/0/0 on REF - Speedwell (6 variants), TEST - dry run (5), Northville (6). §2 fields identical on all three. Validator: REF - Speedwell 0, TEST - dry run 0, Northville 6 (V3 ×3, V4 ×3). Gayner Road 0 issues.
  - (a) reduced because a lower rung passed: REF - Speedwell 0. TEST - dry run 0. Northville 3 m on 34 steps in 6 runs, e.g. `best` steps 329–334 (Gloucester Road North, Gayner Road). 0 steps at 2 m or 1 m.
  - (b) no rung passed, kept at base: REF - Speedwell 0. TEST - dry run 0. Northville 3 runs at 4 m: `best` 296–327 (Gloucester Road North, Filton Road, Eden Grove, transfer); `alt_1` 347–389 (Pine Grove, Gloucester Road North, transfer, Filton Road, Eden Grove, Gayner Road); `alt_4` 272–303 (Gloucester Road North, Filton Road, Eden Grove, transfer).
  - Longest reduced run: REF - Speedwell none. TEST - dry run none. Northville 297.06 m at 3 m, `best_reversed` steps 61–66 (Gayner Road, Gloucester Road North).
  - G4: `npx tsc --noEmit` exit 0. `npx eslint` on the 4 allowed files exit 0.
- **Pinned known issue: Filton Road / Eden Grove transfer**
  - (alt_1, 365, V3, 10.97)
  - (alt_1, 366, V4, 0.89)
  - (alt_4, 281, V3, 10.97)
  - (alt_4, 282, V4, 0.89)
  - (best, 305, V3, 10.97)
  - (best, 306, V4, 0.89)
  - Steps 305 / 365 / 281 are walk steps on Filton Road; 306 / 366 / 282 are work steps on Eden Grove. All inside A2's ranges (best 305–307, alt_1 365–367, alt_4 281–283).
- **Not verified:** a browser or phone view of the new 4 m lines. Northville `best_reversed` step 89 (work, Eden Grove) walkline is 13.87 m stored vs 3.12 m in memory, with 0 validator issues; not investigated. No re-save, no re-freeze.
- **External settings:** none.
- **Known issues follow-up:** Traversal: chain -1 transfer at Filton Road / Eden Grove (Northville) not classified as a Turn; needs its own planned item.
- **Open questions for Claude:** whether the longest reduced run (297.06 m at 3 m on Gloucester Road North / Gayner Road, `best_reversed`) is acceptable on a main road. Whether D1 (re-save Northville once G2 passes) can go ahead with the 6 pinned issues, or waits for the traversal item.

### 2026-09-27 — Route geometry Session B / complete (uncommitted)

- **Item:** other — route geometry
- **What changed:** Generate and Save now run the geometry check. Save logs a warning and still saves. The draw page notice shows the issue count after Generate and after Save. The field app, when online, compares `route_fp` with `min(route_steps.id)` and refetches when they differ; offline, or on error or the 3 s timeout, it keeps the cache. Chevron merging skips any vertex within 0.1 m of the previous one, so a zero-length step adds no duplicate. `scripts/route-geom-apply.ts` is the hard-coded writer. It refused before any write. Stored territory routes and the two allow-list freezes were not changed.
- **Files:**
  - Changed: `lib/geo/walk/save.ts`, `components/admin/prop-drawer.tsx`, `lib/field/db.ts`, `lib/field/route-cache.ts`, `lib/map/route-layers.ts`, `docs/D2D-Build-Brief.md`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: `scripts/route-geom-apply.ts`
  - Deleted: none kept. A temporary cookie helper, a temporary check route, and a middleware log line were added for the browser pass and removed.
  - Not changed: `lib/geo/walk/geometry.ts`, `lib/geo/walk/steps.ts`, `lib/geo/walk/validate.ts`, `lib/geo/walk/types.ts`, `scripts/verify-route-geom.ts`
- **Database:** none. No migration. No re-save. No re-freeze.
- **Shared modules touched:** `lib/geo/walk/save.ts` (returns issues, warns, does not block). `lib/field/route-cache.ts` and `lib/field/db.ts` (fingerprint key, no Dexie version bump). `lib/map/route-layers.ts` (`appendWalk` only).
- **Decided by:**
  - owner — the 3 m reduced runs are accepted, including the 297 m run at `best_reversed` steps 61–66.
  - owner — D1 goes ahead: re-save Northville with the 6 pinned issues. The traversal item will re-save it again later. The write did not happen. See the gates below.
  - owner — D2, D3, the 3 s timeout, and the CanvasserX magic link, already recorded in the plan-approved entry.
- **Deviations from plan or brief:** G5 did not write. The apply script stops before every write if Northville has an unworked R2-frozen assignment or either allow-list assignment has knocks. Both were true. r1 "Turns" now FAILs (was PASS) and the walkline-side count is 2 / 92 / 44 (was 2 / 92 / 43). Those expected numbers were not edited. r2's redland visit_number check got 2, not 3, because both existing visits are 1. That number was not edited. RED's saved variants were left in place.
- **Invariants:** no GPS, no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not changed.
- **Verified:**
  - G1 `npm run verify:geom`: PASS, exit 0.
  - G2 `npm run verify:geom -- --live`: exit 1. REF - Speedwell and TEST - dry run: 0 validator issues, raw 0/0/0, §2 identical. Northville raw 0/0/0, §2 identical, 6 issues matching the pinned set exactly.
  - G3: r1 exit 0, connectivity 0 gaps (was 162). r2 on `RED - Speedwell` exit 0. r3 exit 0, leftover territories 0. `verify:stage5bb` exit 0 (280 steps, 20,047.64 m). `verify:ui4` exit 0.
  - `npx tsc --noEmit` exit 0. eslint on the Session B files exit 0.
  - Browser, CanvasserX, `/field`: REF - Speedwell, visit 3, 182 doors. `route_for:0de4d001-f004-412c-80f5-0c297bc02526` = `2026-09-27T16:43:40.979Z`. `route_fp` = `steps:6422` (the stored min id). Online reload: one `route_steps?select=id&…&limit=1` request, no full step fetch, `route_for` unchanged.
  - RED - Speedwell: territory_routes 0 → 6, territory_route_steps 0 → 106, assignments 0 → 0. redland assignments 2 → 2.
  - CanvasserX profile after the magic links: role canvasser, name CanvasserX, active true.
- **Not verified:** G5 stored-row checks (no write). G6 Ventnor → Derwent screenshot. G7 offline reopen (`chrome-error://chromewebdata/` with `navigator.onLine` false; the dev server HTML did not load). G7 "fingerprint differs after a re-freeze". Draw page: "Loading the map…" for 16 seconds, Draw stayed disabled, no `geom-` prop created. Not tested on a phone. The field map that was open had 182 doors and 17 route steps.
- **External settings:** none. MapTiler unchanged. The localhost browser's admin session was signed out (scope local) at the end of the draw-page attempt.
- **Sessions created, then signed out locally:**
  - r2 harness: admin `802e95de-e975-4bb5-9545-123b4bc8fe43`, canvasser `576c4ce7-5fe0-489f-bd7f-42912925951a`, office `89c7aba7-3949-4739-82db-fcc8c3412ac5`. The script signed out 3 sessions.
  - CanvasserX magic link, user `576c4ce7-5fe0-489f-bd7f-42912925951a`, signed out locally before the browser used it. A later token check returned `session_not_found`.
  - CanvasserX magic link, same user, `expires_at` 1790530976. Used for `/field`. Signed out locally after.
  - Admin magic link, user `802e95de-e975-4bb5-9545-123b4bc8fe43`, `expires_at` 1790531238. Used for `/admin`. Signed out locally after. Password, profile and role were not changed on any of these.
- **Known issues follow-up:** Traversal: chain -1 transfer at Filton Road / Eden Grove (Northville) not classified as a Turn. G5 is waiting on an owner decision because Northville now has an unworked R2-frozen assignment, and the Speedwell visit-3 assignment has 49 knocks.
- **Open questions for Claude:** Whether to re-save the three territory variant sets anyway, leaving `3cdbb911` and `0de4d001` frozen as they are, and re-freezing only `0c32a933` (0 knocks, key `best`). Whether the r1 Turns FAIL (redland best step 53, walkline 1.23 m from the furthest door, 22 problems) and the walkline-side count moving from 2 / 92 / 43 to 2 / 92 / 44 should be accepted. The numbers were not changed.

### 2026-09-27 — Route geometry Session A4: turn ends level with the furthest door — GATE HIT, REVERTED (uncommitted)

- **Item:** other — route geometry
- **What changed:** Nothing, in the end. The 22 r1 Turns problems were diagnosed read-only. One fix was tried, it hit two gates, and it was reverted by hand. `geometry.ts` and `steps.ts` are back to Session B. Proof: the r1 md5s and determinism hashes match Session B, and G2 gives the same pinned 6.
- **Files:**
  - Changed then reverted: `lib/geo/walk/geometry.ts`, `lib/geo/walk/steps.ts`
  - Changed: `docs/CLAUDE-HANDOFF.md`, `docs/BUILD-LOG.md`
  - Not changed: `lib/geo/walk/types.ts`, `scripts/verify-route-geom.ts`, `scripts/verify-stage-5b-r1.ts`, `lib/geo/walk/validate.ts`
  - Outside the repo, not committed: a copy of r1 that prints every problem, plus a probe, in `%TEMP%\a4\`. The attempt was saved as `%TEMP%\a4\session-b-plus-a4-attempt1.diff`. That diff is against HEAD, so it includes Sessions A–B.
- **Database:** none. Reads only (admin magic-link session, `route_walk_inputs`, `SELECT`s). Signed out locally.
- **Shared modules touched:** `lib/geo/walk/geometry.ts` and `lib/geo/walk/steps.ts`, both reverted. Net change: none.
- **Decided by:**
  - owner — the r1 check is the spec. Do not edit r1. The fix may only move the walkline end that meets a Turn.
  - agent — stop after the first attempt, because two gates fired (Turns not PASS, pinned set changed), and revert rather than leave a regression.
- **Diagnosis, 22 problems (prop, variant, step, message, metres):**
  - redland, Lower Redland Mews, one-sided turn, 3 problems per variant:
    - best 53 / 54 / 53: "ends" / "starts" / "runs past", each 1.23
    - best_reversed 369 / 370 / 369: 1.23 each
    - alt_1 145 / 146 / 145: 1.23 each
    - alt_2 90 / 91 / 90: 1.23 each
    - alt_3 104 / 105 / 104: 1.23 each
    - alt_4 14 / 15 / 14: 1.23 each
  - Northville, Fourth Avenue, 2 problems per variant:
    - alt_2 190 "starts" 5.74, and alt_2 188 "runs past" 5.74
    - alt_3 99 "starts" 5.74, and alt_3 97 "runs past" 5.74
  - Max 5.74 m. Median 1.23 m. 18 problems at 1.23 m, 4 at 5.74 m. Two physical places.
- **Which rule moved the end:** the plan's prediction is confirmed.
  - redland best 53 (work): free-end collapse. The last 2.83 m offset edge was removed. Not capped. The end is left at the inside joint, 1.225 m ahead.
  - redland best 54 (walk back): not its own collapse. The strip itself was not collapsed (0.003 m). The uTurnArc splice starts from step 53's collapsed end, so it inherits the 1.225 m.
  - Northville alt_2 190 (walk): free-start collapse. The first 2.11 m edge was removed, then the end was capped at 2d. 5.738 m ahead.
  - The pre-Session-A end (last centreline point + normal·d) was 0.003–0.005 m from level at all of these.
- **Attempt 1 (reverted):** at a run end that meets a Turn, and only if the collapse moved it, put the end on the last kept offset edge's line, level with the centreline end. Ends that did not collapse were left as they were.
  - Northville Fourth Avenue: r1 cleared, but G2 gained 4 issues: (alt_2, 190, V4, 0.47), (alt_2, 190, V5), (alt_3, 99, V4, 0.47), (alt_3, 99, V5). The pinned set changed.
  - redland Lower Redland Mews: step 52 runs at right angles to the 2.83 m turn step 53. The kept edge's line is level with the door 76.56 m away at 4 m, and 10.89 m away at 3 m. The run-local V4 check rejected both, so the ladder fell to 2 m. At 2 m the work line lies on the 2 m walk-back strip. r1 then gave "walk back comes within 0.00 m of the work line" ×6, and One-sided turns went from PASS to FAIL.
  - Connectivity stayed at 0 gaps. G1 passed. The redland and Northville md5s changed. Speedwell's did not.
- **Why this spot cannot pass at 4 m (by hand):** V4 includes the boundary vertex between steps 52 and 53. That vertex must be at least 3.95 m from step 52's centreline, which puts it at least 1.15 m past the door. r1 wants every point of step 53's walkline to be at most 0.5 m past the door. Both rules apply to the same shared point, so no end placement satisfies them at 4 m. At 3 m a window exists (0.15–0.5 m past). Pre-Session-A only passed here because `RUN_BREAK_RAD` split the run at the 90° corner, and that left a connectivity gap.
- **Deviations from plan or brief:** Step 3 was not run on a fix, because the gate fired. The r1 walkline-side "one extra step" was not identified. That needs a comparison against HEAD's generator.
- **Invariants:** no GPS, no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` untouched. No database write. No check, tolerance or expected value changed.
- **Verified:**
  - Baseline and after the revert, r1 exit 0. Turns FAIL, 22 problems. One-sided PASS. Connectivity 0 gaps. Walkline side 2 / 92 / 44. Determinism `0084940477da` / `b41ccc4c7367` / `01126864f213`, the same as Session B. best md5s: Speedwell `f42e682c777deb44976d30fcf3191831`, redland `0173835987c03c5af472e496dee6bb31`, Northville `077e3075618ce11ba77641b8279e05f3`.
  - After the revert, G2 (`npm run verify:geom -- --live`) exit 1: REF - Speedwell 0, TEST - dry run 0, Northville exactly the pinned 6.
  - After the revert, `npx tsc --noEmit` exit 0, and eslint on the 4 allowed files exit 0.
- **Not verified:** the one extra walkline-side step. The G2 reduced-offset table and §2 after the revert were not re-read line by line (the code is identical to Session B).
- **External settings:** none.
- **Open questions for Claude:** The owner must pick one rule for a turn step that is shorter than the offset's inside intrusion, like redland step 53. The options:
  - Let that one run drop to 3 m. This needs a ladder rule, "a Turn end must be within 0.5 m of level", and r1's 1 m walk-back separation would sit at exactly 1.00 m.
  - Allow a break (gap) at that corner, as pre-Session-A did. This conflicts with Connectivity at 0 gaps.
  - Accept these 2 places as a documented limit.
  - For Fourth Avenue: say whether a V4 0.47 m / V5 issue there is acceptable in exchange for a level turn.

### 2026-09-27 — Route geometry Session B2 / writes on the current assignments (uncommitted)

- **Item:** other — route geometry
- **What changed:** `scripts/route-geom-apply.ts` re-saves REF - Speedwell, TEST - dry run and Northville, and re-freezes only `c14aa0d1` (`best`) and `3cdbb911` (`best_reversed`). The old "Northville has an unworked R2 freeze → stop" rule is gone. Each re-freeze still recounts knocks (must be 0), requires `closed_at` null, and passes the current variant key explicitly. `scripts/verify-stage-5b-r2.ts` derives redland's next `visit_number` as 1 + the highest counting visit (Stage 5c-a, migration 021). That is the only expected value changed. The script was run. It wrote.
- **Files:**
  - Changed: `scripts/route-geom-apply.ts`, `scripts/verify-stage-5b-r2.ts`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New then deleted: `app/geom-session-check/page.tsx`, `scripts/_b2-link.ts`. A temp copy of r1 that printed all 22 turn problems was run and deleted. r1 in the repo was not edited.
  - Not changed: `lib/geo/walk/geometry.ts`, `lib/geo/walk/steps.ts`, `lib/geo/walk/validate.ts`, `lib/geo/walk/types.ts`, `scripts/verify-route-geom.ts`, `scripts/verify-stage-5b-r1.ts`
- **Database:** none (no migration). Re-save replaced the three territory variant sets in place. Re-freeze replaced `route_steps` on the two open assignments. Counts: territory_routes / territory_route_steps stayed 6/106, 5/178, 6/2450. `c14aa0d1` route_steps 29, min id 6439 → 6949. `3cdbb911` 396, min id 6468 → 6978.
- **Shared modules touched:** none. The apply script calls the existing save and freeze functions.
- **Decided by:**
  - owner — N: re-freeze `3cdbb911` with `best_reversed`, 0 knocks required at write time.
  - owner — r2's "visit_number = 3" expectation is out of date. Stage 5c-a sets visit_number to the highest counting visit + 1. redland's two real rows are both visit 1, so 2 is correct. Derive it. Do not hard-code another number.
  - owner — the Northville re-save (D1) stands, with the pinned 6 issues.
  - owner — the 22 r1 Turns problems at Lower Redland Mews and Fourth Avenue are a pinned known limit. Do not edit r1. They move to the route-planner edge-cases item.
  - owner — do not re-freeze `0de4d001` (49 knocks, closed reallocated) or `0c32a933` (closed reallocated).
- **Deviations from plan or brief:** `/field` cannot open `c14aa0d1` on 27 Sept, because `todays_assignment` uses the Europe/London date and that assignment is 28 Sept. CanvasserX's open assignment for 27 Sept is Northville `3cdbb911`. The fingerprint check called `ensureRoute` for `c14aa0d1` from a temporary page, then the page was deleted. r2 was run as `npm run verify:stage5b-r2 -- --prop="RED - Speedwell"` because the harness refuses a prop that already has assignments, and REF - Speedwell has 3. The apply script's "min id rose" line no longer also requires the step count to stay equal. This run's counts did stay equal (29 and 396). The frozen-step comparison uses the explicit key, so Northville is checked against `best_reversed`.
- **Invariants:** no GPS, no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not changed. Nothing with knocks was re-frozen. r2's one throwaway knock on RED - Speedwell was deleted in that script's cleanup (1 knock_events deleted). redland_test and the DEMO props were not written by the apply script. r2 and r3 report their protected `route_steps` counts unchanged.
- **Verified:**
  - Gates, before any write. `npm run verify:geom` exit 0, G1 PASS.
  - `npm run verify:geom -- --live` exit 1. REF - Speedwell and TEST - dry run: 0 validator issues, raw after 0/0/0, §2 identical. Northville raw after 0/0/0, §2 identical, issue set exactly the pinned 6, no missing, no extra: (alt_1, 365, V3, 10.97), (alt_1, 366, V4, 0.89), (alt_4, 281, V3, 10.97), (alt_4, 282, V4, 0.89), (best, 305, V3, 10.97), (best, 306, V4, 0.89). "Every remaining issue is at Filton Road / Eden Grove" PASS. Gayner Road PASS, 0 issues.
  - `npm run verify:stage5b-r1` exit 0. Connectivity PASS, 39 variants, 0 gaps. One-sided turns PASS. Walkline side: Speedwell 2, redland 92, Northville 44. Determinism `0084940477da` / `b41ccc4c7367` / `01126864f213`. Turns FAIL, 22 problems, matching the pinned list item for item (official output prints the first 12; a deleted temp copy printed all 22). Streets from the preview text r1 wrote: Lower Redland Mews for the 18 at 1.23 m; Fourth Avenue for the 4 at 5.74 m (alt_2 190 starts and 188 runs past; alt_3 99 starts and 97 runs past).
  - G7 before the write. CanvasserX `576c4ce7-5fe0-489f-bd7f-42912925951a`, role canvasser, active true. `route_for:c14aa0d1-…` = `2026-09-27T18:20:01.568Z`. `route_fp` = `steps:6439`. Database min id 6439, 29 steps. A reload sent only `route_steps?select=id&…&limit=1`. `fetched` false. `route_for` unchanged.
  - G5 `npx tsx scripts/route-geom-apply.ts` exit 0. Recount at freeze: both targets 0 knocks, `closed_at` null, keys `best` and `best_reversed`. Stored validator sets: Speedwell 0, TEST - dry run 0, Northville the pinned 6. Stored raw counts 0/0/0. Frozen lines match the saved key at 0 m. After the write, `0de4d001` is still closed, 49 knocks, 17 steps, min id 6422. `0c32a933` is still closed, 0 knocks, 29 steps, min id 6393.
  - G7 after the write. Same CanvasserX session. `fetched` true. `route_for` = `2026-09-27T18:22:07.614Z`. `route_fp` = `steps:6949`. Requests: the min-id query, then the full `route_steps` select. Cached steps 29. Signed out locally. `expires_at` 1790536801. Profile after: name CanvasserX, role canvasser, active true.
  - r2 on RED - Speedwell exit 0. Every check PASS, including the derived visit 2. redland before: 2026-09-21 v1 counts, 2026-09-23 v1 counts. Test allocation `2826ccbc…` deleted. RED left at 6 routes / 106 steps / 0 assignments. Protected route_steps unchanged, Northville 676 → 676, redland 652 → 652. 3 sessions signed out locally.
  - r3 exit 0. Every check PASS. Leftover R3 territories 0. Protected route_steps unchanged, including REF - Speedwell 51 → 51 and Northville 676 → 676. Admin magic-link session signed out locally.
  - `verify:stage5bb` exit 0. Northville old-engine assignment: 280 steps, route_length_m 20,047.64, stranded 39.
  - `verify:ui4` exit 0. Printed `OK`.
- **Not verified:** G6 corner screenshot. Draw-page "Loading the map…" check. Offline reopen of `c14aa0d1`. Not tested on a phone. The field map was not opened; the check was the route cache (29 steps) in the desktop browser.
- **External settings:** none. MapTiler unchanged.
- **Sessions created, then signed out locally:**
  - Apply script: admin `802e95de-e975-4bb5-9545-123b4bc8fe43`. Password, profile and role were not changed.
  - CanvasserX magic link, user `576c4ce7-5fe0-489f-bd7f-42912925951a`, `expires_at` 1790536801. Used for the route-cache check. Signed out locally after.
  - r2: admin `802e95de-e975-4bb5-9545-123b4bc8fe43`, canvasser `576c4ce7-5fe0-489f-bd7f-42912925951a`, office `89c7aba7-3949-4739-82db-fcc8c3412ac5`. The script signed out 3 sessions.
  - r3: admin magic link for the same first active admin, signed out locally. The script did not print `expires_at`.
- **Known issues follow-up:** The 22 turn-end problems are accepted and move to the route-planner edge-cases item. Traversal: chain -1 transfer at Filton Road / Eden Grove remains its own item.
- **Open questions for Claude:** none from this session. G6, the draw page, and the offline phone reopen are for the owner.

### 2026-09-28 — UI item 1 Logger rebuild plan approved (uncommitted)

- **Item:** 1 — Logger rebuild
- **What changed:** The owner approved the "UI 1 Logger rebuild" plan
  (`ui_1_logger_rebuild_a5feb2ee.plan.md`): re-skin the field Logger to the
  Figma page "Logger — clean build" (Sora, new tokens, horizontal door
  scroll, hold-and-slide Other, compact live map, 12 states), and remove
  claims and Take from the Realtime team layer, keeping live knock sharing
  (A1/B1/C1) and adding a heartbeat. No migration. `lib/sync/queue.ts` is not
  modified. Implementation had not started at the point this entry was
  written. Split across three sessions: A (Sonnet 5, Extra — team logic and
  claims removal), B (Opus 5.5 — visual system and the hard components), C
  (Sonnet 5 — assembly, states and verification).
- **Files:** none yet.
- **Database:** none planned.
- **Shared modules touched:** none yet. Planned: `lib/field/door-signals.ts`
  and `lib/field/use-team.ts` (claims removal — reverses the 2026-09-26
  Stage 10 deviation recorded above).
- **Decided by:**
  - **Owner, 2026-09-27/28** — decisions 1 to 11 from the brief: outcome
    order; Other hold; tap plus slide confirm; horizontal scroll; tab
    labels; own-count stats with Confirmed as "—"; mini map dot = current
    door; pencil removed and IdChip username; Sora on the field app only;
    claims and Take removed with A1/B1/C1; "Tom" as the fixture name.
  - **Owner** — the plan is approved with amendments 1 to 8 of 2026-09-28.
  - **Owner definition, Contacts (2026-09-28):** a "Contact" is a BOOKABLE
    ANSWER. Contacts = count of `outcome = 'answered'` (the Contact button)
    ONLY. `lead` is its own stat and is never folded in; `no_opportunity`
    is not a contact even though someone answered; `no_answer` is not a
    contact; `refused` / `do_not_call` / `inaccessible` / `callback` are
    not contacts. This is deliberately NOT the outcome-mapping skill's
    "answered" rule, which is unchanged for admin. The skill, admin
    queries and every verify script's use of that rule are not touched.
  - **Owner change, Area line:** the short form
    `Visit {n} · {hand phrase} · {door_count} doors`, single line,
    truncated, built from `formatFieldHeader`'s own pieces, not duplicated.
    The start street and compass stay in the turn banner and on the Map tab.
  - **Owner contrast rule:** 7:1 for text a canvasser must read, overriding
    the Figma values below it; the street row and teammate lines use
    ink-soft; new token `outcome-lead-ink`; `rented-ink` darkened;
    ink-muted only for eyebrows and secondary labels repeated elsewhere.
  - **Owner:** icons are inline currentColor SVG components; Sync failed
    needs a real server rejection or it is NOT VERIFIED with injected data;
    `git grep`, not `rg` (PowerShell has no `rg`); one MapLibre instance,
    with evidence; model split A Sonnet 5 Extra / B Opus 5.5 / C Sonnet 5.
  - **Agent proposal, owner ACCEPTED 2026-09-28:** A1 forward-wrap; C1
    N = plate (`#80`, else `#12`); a quick tap on Other opens tap mode;
    heartbeat `here` every 15 s, stale after 45 s; the throwaway-canvasser
    team test (CanvasserX is not used). Also P1 (Sora on all of `/field`,
    including the data font), P2–P13 as listed in the plan, and P14–P18
    from this amendment (Lead sheet fill token, toast countdown token,
    rented-ink value, FieldMap compact/MiniMap moved into Session B, the
    Sync failed trigger candidate).
  - **Agent proposal, recorded as agent, NOT an owner decision:** Contacts
    = `answered` only (superseded by the owner's definition above); Area
    line = full `formatFieldHeader` (replaced by the owner's short form
    above). The original plan draft had wrongly recorded both as owner
    decisions; amendment 1 of the 2026-09-28 review corrected this.
- **Deviations from plan or brief:** none (approval only; no code yet).
- **Invariants:** no GPS, no coordinates, no quality scoring in `/field`,
  field writes via `lib/sync/queue.ts` only. Not applicable yet (no code).
- **Verified:** not applicable.
- **Not verified:** the whole item.
- **External settings:** none.
- **Open questions for Claude:** P14–P18 above; whether the stat labels
  count as must-read (ink-soft vs ink-muted); the admin-Contacts label
  reconciliation flagged for the admin rebuild.

### 2026-09-28 — UI item 1 Logger rebuild, Session A (uncommitted)

- **Item:** 1 — Logger rebuild
- **What changed:** Claims, Take and reserve are removed from the Realtime
  team layer, reversing the 2026-09-26 Stage 10 deviation. Live knock
  sharing (A1 forward-wrap next door, B1 which teammate last knocked a door,
  C1 the teammate line) stays, plus a new `here` heartbeat (15 s, stale
  after 45 s). Outcome button order and the "Not In" relabel (owner
  decision 1, P10) are in. New `lib/field/today-stats.ts` implements the
  owner's Contacts definition (`outcome = 'answered'` only). Both
  `map-tab.tsx` and `logger-tab.tsx` are interim — Session C's Figma
  rebuild replaces the visuals; this session only removed claims and wired
  the new order/labels/stats so the app keeps working.
- **Files:**
  - Changed: `lib/field/door-signals.ts`, `lib/field/use-team.ts`,
    `lib/field/cursor.ts`, `lib/field/local-outcomes.ts`,
    `lib/field/route-display.ts`, `lib/field/outcomes.ts`,
    `components/field/field-data-provider.tsx`, `components/field/map-tab.tsx`,
    `components/field/logger-tab.tsx`, `components/field/outcome-buttons.tsx`,
    `scripts/verify-stage-10.ts`, `scripts/verify-stage-8b.ts`,
    `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`.
  - New: `lib/field/today-stats.ts`.
  - Deleted: `components/field/next-door-card.tsx`.
  - Also changed, out of scope, owner-approved: `scripts/route-geom-apply.ts`
    (one line — see Deviations).
  - Not changed: `lib/sync/queue.ts`, `lib/supabase/*`, `lib/map/route-layers.ts`,
    `lib/geo/walk/*`, `components/field/field-map.tsx`,
    `components/field/teammate-lines.tsx`, `components/field/shared-knock*.ts(x)`.
- **Database:** none. No migration.
- **Shared modules touched:** `lib/field/door-signals.ts`, `lib/field/use-team.ts`
  and `lib/field/cursor.ts` — the claims-removal rewrite this item's plan
  calls for. `lib/sync/queue.ts` was not read or written.
- **Decided by:**
  - owner (recorded in the Step 0 entry above) — A1 forward-wrap; C1
    N = plate; heartbeat 15 s / 45 s; the Contacts definition
    (`outcome = 'answered'` ONLY); the Area line short form; outcome order
    1 (Lead, Contact, Rented/Council, Not In) and P9/P10 (flat 72px,
    "Not In" relabel).
  - owner, this session — asked whether to fix one pre-existing, unrelated
    `tsc` error in `scripts/route-geom-apply.ts` (confirmed present on a
    clean checkout, from the "Robust walkline offset" work, nothing to do
    with the Logger) or report the `tsc` gate as NOT MET. Owner chose:
    fix it.
  - agent — `formatTeammateLine`'s stale branch takes priority over door
    info when both could apply (the plan's four C1 examples do not state
    an order). Flagged below for Session C to re-check against Figma.
  - agent — `useTeam` drops its `sequence` parameter; nothing left inside
    it needs the sequence once claims (and `reserveDecision`/`shownDoor`)
    are gone.
- **Deviations from plan or brief:**
  - Fixed `scripts/route-geom-apply.ts(366)` (a `target.id === banned`
    comparison across two disjoint literal-string unions, which TS
    flags as always-false) by widening both sides to `string` in the
    comparison only — no behaviour change, owner-approved this session,
    unrelated to the Logger rebuild.
  - `verify-stage-10.ts`'s `--fast` flag is removed: the rewritten script
    has no long wait left to skip (the old 3-minute claim-TTL wait is
    gone; the "stopped actor goes stale" check now reasons from a real
    captured heartbeat timestamp plus a computed offset, not a wall-clock
    wait).
  - `formatTeammateLine`'s stale-vs-door priority (agent decision above).
- **Invariants:** no GPS, no coordinates — confirmed unchanged. No quality
  scoring in `/field` — confirmed unchanged; Contacts/Leads/Doors are own
  counts only, today, Europe/London (invariant 2). Field writes still go
  through `lib/sync/queue.ts` only — confirmed by `git diff --quiet --
  lib/sync/queue.ts` (exit 0); that file was not opened this session.
- **Verified:** `npx tsc --noEmit` exit 0 (after the one out-of-scope fix).
  `npx eslint components/field lib/field "app/(field)" scripts/verify-stage-10.ts
  scripts/verify-stage-8b.ts scripts/route-geom-apply.ts` exit 0.
  `npm run verify:stage10` exit 0, "OK" — every pure and live check PASS,
  including the live trio (Ada/Tom/Cid) proving A1 skip → index 2, B1
  tagging Ada, C1 `"Ada · last knocked #1"`, undo → `unknocked` → reopen,
  heartbeats recorded, and staleness computed from a real captured
  timestamp. `npm run verify:stage8b` exit 0, "ALL CHECKS PASSED",
  including the new stats section (8 outcomes → Contacts 1, Leads 1,
  Doors 8, and 0 for a different canvasser's rows). `npm run verify:ui4`
  exit 0, unaffected. `git grep -n --untracked -E
  '"claim"|"release"|claimDoor|releaseDoor|reserveDecision|NextDoorCard'
  -- components lib app` — 0 lines. Cleanup: `auth.users`, joined
  `auth.sessions`, `profiles` and `territories` matching this session's
  harness names/prefixes are all 0, checked directly against the live
  project after both verify runs.
- **Not verified:** everything Session B/C owns — tokens, Sora, icons,
  DoorScroll, the pills, Other's hold-slide gesture, the 12 states, the
  height ladder. B1's grey-plus-tag is not wired into `FieldMap` itself
  (`field-map.tsx` is outside this session's file list). No on-device,
  sun, one-handed or wet-thumb checks — no phone used.
- **External settings:** none.
- **Open questions for Claude:** whether the "stale beats door info" C1
  reading (agent decision above) matches the Figma TeamStrip states —
  Session C should check this when it builds that component. The
  admin-Contacts label reconciliation (owner decision, Step 0 entry)
  is still open for the admin rebuild.

### 2026-09-28 — UI item 1 Logger rebuild, Session B1 (uncommitted)

- **Item:** 1 — Logger rebuild
- **What changed:** Only the plan's `b-tokens-font` and `b-primitives`
  todos, restricted further to exclude OutcomeButton, OtherButton,
  OtherMenu and DoorScroll (those are Session B2). `app/globals.css`
  gained the field token set (`field-bg`, `surface`, `line`, `ink-muted`,
  `ink-faint`, `outcome-*`, `warn-bg`, `error-bg`, `scrim`, `radius-field-*`,
  `spacing-tap-min`/`spacing-outcome`, the `field/*` text styles, and the
  `shadow-field-*`/`drop-shadow-field-pill` shadows). Sora is scoped to
  `app/(field)/layout.tsx` only, via `next/font` plus a `.field-root` rule
  that re-points `--font-display`/`--font-body`/`--font-data` to Sora
  inside that subtree — admin's `<html>` className is untouched. New
  `components/field/icons.tsx` (6 inline `currentColor` SVG icons plus a
  drawn `StatusDot`). New `components/field/ui/{stat-row,id-chip,note-bar,
  button,status-banner,team-strip}.tsx`. `components/field/tab-bar.tsx`
  (TabItem) and `components/field/undo-toast.tsx` (UndoToast) were
  restyled with the new tokens/icons in place, logic unchanged; the
  "Profile" tab label is now "You" (decision 5), route unchanged. Nothing
  is wired into `logger-tab.tsx` — that is Session C.
- **Files:**
  - Changed: `app/globals.css`, `app/(field)/layout.tsx`,
    `components/field/tab-bar.tsx`, `components/field/undo-toast.tsx`.
  - New: `components/field/icons.tsx`,
    `components/field/ui/stat-row.tsx`, `components/field/ui/id-chip.tsx`,
    `components/field/ui/note-bar.tsx`, `components/field/ui/button.tsx`,
    `components/field/ui/status-banner.tsx`,
    `components/field/ui/team-strip.tsx`.
  - Not changed: everything Session A touched; `logger-tab.tsx`,
    `map-tab.tsx`, `outcome-buttons.tsx`, `lib/sync/queue.ts`,
    `lib/supabase/*`, `lib/field/door-signals.ts`, `lib/field/use-team.ts`.
- **Database:** none. No migration.
- **Shared modules touched:** none of the data-flow shared modules
  (`lib/sync/queue.ts`, `lib/field/*`, `lib/map/route-layers.ts`,
  `lib/geo/walk/*`, `lib/supabase/*`). `app/globals.css` and
  `app/(field)/layout.tsx` are shared by every field route, but this
  session only added tokens/font scoping additively — no existing
  admin-token name or value changed.
- **Decided by:**
  - owner, this session — the exact contrast table to use (superseding
    the plan's P16 rented-ink figure where the two differ; see
    Deviations).
  - agent — `TeamStrip` takes pre-formatted `{id, initial, label, stale}`
    rows rather than `TeammateRow`/`labelFor` as the plan sketched, to
    keep the primitive presentational (Figma's own component takes plain
    strings too). Flagged for Session C to confirm when it wires the
    real data.
  - agent — UndoToast's title uses `surface` (white, 16.08:1) rather than
    `paper` (15.41:1, what the raw Figma code referenced), because the
    owner's table for this session explicitly labels "white on ink
    (toast)" at 16.08, which only matches `surface`.
  - agent — sync-state dot colours reuse existing tokens
    (`outcome-lead`/`outcome-rented-ink`/`ink-faint`/`oxide`) instead of
    adding new `--color-sync-*` tokens, since each state already had a
    close existing match.
  - agent — `<main>`'s background switched from `bg-worksheet` to the new
    `bg-field-bg` token, since the field root should use its own new
    token rather than the admin-toned placeholder Session A left it on.
- **Deviations from plan or brief:**
  - rented-ink is `#7a4507` (the owner's table this session), not the
    plan's `#7b4507` (P16). Both clear 7:1 everywhere used; the later,
    session-specific figure was used per this session's explicit "use
    these values, do not iterate" instruction.
  - `get_variable_defs` on node `5:2` (the one call in this session's
    Figma budget) returned "You currently have nothing selected" — this
    Figma MCP tool needs an active desktop selection, not just a node ID.
    Not retried (budget was fixed at one call). Token values came from
    the plan's own text (itself sourced from a working Figma read during
    planning) plus the owner's contrast table.
  - House, HouseOutline, Chevron, Star, Speech (the remaining amendment-3
    icon names) were not added — they belong to DoorScroll/OtherMenu
    (Session B2) and adding them now would mean unused exports.
- **Invariants:** confirmed unchanged — no GPS/coordinates, no quality
  scoring, no field write path touched (this session has no data-flow
  code at all). `git diff --quiet -- lib/sync/queue.ts` still exits 0.
- **Verified:** `npx tsc --noEmit` exit 0. `npx eslint components/field
  lib/field "app/(field)"` exit 0. `git grep -n -E
  '#[0-9a-fA-F]{3,8}\b' -- components/field/ui` and the same with
  `--untracked` (the directory is new and untracked, so the plain form
  alone would have passed trivially): both 0 lines. `git grep -n -i sora
  -- "app/(admin)" components/admin` (and with `--untracked`): 0 lines.
  `npm run verify:stage8b` exit 0, "ALL CHECKS PASSED". `npm run
  verify:ui4` exit 0, "OK". Tailwind v4's `--text-*--letter-spacing`/
  `--text-*--font-weight` companion syntax was confirmed against the
  official theme-variables doc before relying on it. The full computed
  contrast table is in the BUILD-LOG entry. Browser: a throwaway page
  (`app/ui1-b1-check/page.tsx`, outside `app/(field)` so it needs no
  Supabase auth) rendered all 8 primitives and the icon set; 3
  screenshots at a confirmed ~390.6px CSS visual viewport (CDP
  `Page.getLayoutMetrics`); device override cleared; the page and the
  `%TEMP%\ui1-icons\` folder deleted before finishing;
  `git status --short` confirmed clean of both afterwards.
- **Not verified:** pixel-fidelity vs the actual Figma render (Session
  C's acceptance item). On-device sun/wet-thumb/haptic checks — no phone
  used, and most of the field-ergonomics checklist needs a live
  interaction flow that does not exist yet (this session built
  presentational primitives only, nothing tappable end-to-end).
- **External settings:** none.
- **Open questions for Claude:** whether `#7a4507` vs the plan's
  `#7b4507` for rented-ink is a deliberate final correction (standardise
  on `#7a4507` going forward) or a rounding slip; what "ink on warn-bg
  14.63" in the owner's table is for, since no primitive built this
  session had a slot for it — StatusBanner's own Offline text uses
  rented-ink, not ink, matching the Figma default.

### 2026-09-29 — UI item 1 Logger rebuild, Session B2 (uncommitted)

- **Item:** 1 — Logger rebuild
- **What changed:** Built DoorScroll, OutcomeButton (`OutcomePill`),
  and OtherButton with OtherMenu. The Other gesture is a pure state
  machine; the scroll windowing is a pure module; both are checked by a
  new browser-free script, `verify:ui1`. Nothing is wired into
  `logger-tab.tsx`. The MiniMap is not touched.
- **Files:**
  - New: `lib/field/other-gesture.ts`, `lib/field/door-window.ts`,
    `components/field/ui/door-scroll.tsx`,
    `components/field/ui/outcome-pill.tsx`,
    `components/field/ui/other-button.tsx`,
    `scripts/verify-ui-1-logger.ts`.
  - Changed: `components/field/icons.tsx` (5 icons appended),
    `package.json` (`verify:ui1`), `docs/BUILD-LOG.md`,
    `docs/CLAUDE-HANDOFF.md`.
  - Created and deleted: `app/ui1-b2-check/page.tsx` (temporary).
  - Not changed: `logger-tab.tsx`, `outcome-buttons.tsx`,
    `lib/sync/queue.ts`, `lib/supabase/*`, `app/globals.css`, the B1
    primitives, and every Session A file.
- **Database:** none. No migration.
- **Shared modules touched:** `lib/field/*`, two new files only
  (`other-gesture.ts`, `door-window.ts`). They are pure, with no I/O and
  no writes. No existing `lib/field` file changed.
- **Decided by:**
  - agent — kept scroll-snap after fix attempt 1: snap is switched off
    for an instant external jump, then restored. The pointer-carousel
    fallback was not needed.
  - agent — accepted, and did not tune, the limit that one scroll travels
    at most about 8 doors (see the open questions).
  - agent — Lead label and icon use `outcome-lead-ink`, not Figma's
    `lead`, which is 6.5:1 on white, below 7:1.
  - agent — kept the 40 ms haptic in the Logger's log path, not
    Figma's 30 ms. The components add no confirm pulse of their own.
  - agent — the OtherMenu sits to the left of the button, top-aligned.
    Figma 9:148 was not read (outside the Figma budget).
  - agent — the Rented label keeps "Rented/Council" from `outcomes.ts`,
    with a zero-width break, rather than Figma's "Rented / Council".
  - agent — added optional props `OtherButton.onOpenChange` and
    `DoorScroll.onAddHouseNumber`. The item shape is `DoorScrollItem`
    `{uprn, label, position, knockedBy}`.
  - owner — none this session.
- **Deviations from plan or brief:**
  - `icons.tsx` (a B1 file) was edited additively: 5 icons appended, and
    the header note replaced.
  - OutcomeColumn (frame 8:44) was not built; it is not in this
    session's list.
  - Snap is switched off during instant jumps; the plan has snap on
    throughout.
  - Otherwise as in BUILD-LOG.
- **Invariants:** no GPS or coordinates. No quality scoring in
  `/field`. No field write path touched: the components only raise
  callbacks, and `lib/sync/queue.ts` was not opened.
- **Verified:**
  - `npx tsc --noEmit` exit 0. The scoped `eslint` exit 0.
  - `npm run verify:ui1` exit 0: 36 checks, all PASS.
  - Hex `git grep --untracked` on the new files: 0 lines.
  - `npm run verify:stage8b` exit 0; `npm run verify:ui4` exit 0.
  - Browser at 2,000 doors, 390 px:
    - ‹ 192 ms, › 205 ms;
    - +500 in 16 ms, to 1,000 in 14 ms, to the end in 14 ms, all exact,
      with 0 stray settles;
    - nodes 9 / 17 / 9;
    - an off-centre scroll snaps to exactly one door, with 1 settle;
    - idle is stable.
  - One touch-emulation pass, with script-dispatched touch
    `PointerEvent`s:
    - hold-slide-release on `do_not_call` logged +1;
    - release off the menu +0; a tap +0 (tap mode opened);
    - pointercancel on a row +0; pointercancel at 150 ms +0;
    - a Lead pill tap +1, and a double tap still +1.
  - 1 screenshot. Temporary page deleted; `git status --short` is clean
    of it.
- **Not verified:**
  - Trusted touch input: no real `setPointerCapture` routing, and no
    real momentum fling.
  - iOS Safari (the `scrollend` debounce fallback).
  - The `prefers-reduced-motion` skip.
  - Keyboard, blur and visibility handling in a browser.
  - A screen reader.
  - Any phone: sun, wet thumb, haptic.
  - Figma fidelity (Session C).
- **External settings:** none.
- **Open questions for Claude:**
  - Is one scroll travelling at most about 8 doors acceptable? The plan
    says "a fling can cross many doors". Fixing it would mean a JS
    end-snap or the pointer-carousel fallback.
  - Should the OtherMenu anchor be checked against Figma 9:148 in
    Session C?
  - Confirm 40 ms (plan) over 30 ms (Figma 6:58 description) for the
    confirm haptic.

### 2026-09-29 — UI item 1 Logger rebuild, Session C (assembly, states, map, verification, docs) (uncommitted)

- **Item:** 1 — Logger rebuild
- **What changed:** `logger-tab.tsx` rebuilt as the full composer from
  every earlier session's pieces (header, `TeamStrip`, compact live
  `MiniMap` with a single priority banner slot, `DoorScroll` + new
  `OutcomeColumn`, Today's stats, an "Already logged" pill, an `allDone`
  end-of-prop state, `NoteBar`). New `components/field/mini-map.tsx` and
  `components/field/outcome-column.tsx`. Two bugs found and fixed during
  assembly: Sora had never actually applied anywhere in `/field` since
  Session B1 (an `@theme inline` custom property that never resolved —
  fixed by pointing `.field-root`'s three font roles at `var(--font-sora)`
  directly); and, once Sora's real glyph metrics applied, `DoorScroll`'s
  current-door digits clipped once assembled next to the pills (fixed by
  narrowing the composer's reserved slot to the pill's 84px circle, with
  the tail overflowing on purpose, and letting the current item's plate
  render at natural, unclipped width). Full acceptance list passed live:
  screenshots vs Figma, a two-throwaway-canvasser team test proving
  A1/B1/C1 through the real UI, a claim/release listener at 0/0, an
  offline log→queue→sync giving exactly 1 row, the amendment 4 Sync
  failed trigger proved both at the script level and live in the browser,
  one MapLibre instance confirmed through four tab switches, a 2,000-door
  timing check, and a React Profiler re-render check (which found and fixed
  one more memoisation bug, an inline `onAddHouseNumber` arrow).
- **Files:**
  - New: `components/field/mini-map.tsx`, `components/field/outcome-column.tsx`.
  - Changed: `components/field/logger-tab.tsx`, `components/field/field-map.tsx`,
    `components/field/ui/door-scroll.tsx`, `components/field/shared-knock-notice.tsx`,
    `components/field/sync-status.tsx`, `app/globals.css`, `lib/field/map-style.ts`,
    `docs/D2D-Build-Brief.md`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`.
  - Deleted: none kept. Temporary, created and deleted this session:
    `app/ui1c-2000-check/page.tsx` and seven `scripts/_ui1c-*.ts` scratch
    scripts (fixture creation, DB checks, contrast, the solo re-render
    check).
  - Not changed: `lib/sync/queue.ts`, `lib/supabase/*`, `lib/field/door-signals.ts`,
    `lib/field/use-team.ts`, `lib/field/cursor.ts`, `lib/field/other-gesture.ts`,
    `lib/field/door-window.ts` (formulas/constants), `components/field/ui/outcome-pill.tsx`,
    `components/field/ui/other-button.tsx`, every other Session A/B1/B2 file.
- **Database:** none. No migration. All reads/writes this session were
  against throwaway fixtures (a duo — Ada Lane, Tom Holt, plus a
  third-member-only Sam Reeve for the amendment 4 proof — and a separate
  solo canvasser for the Profiler check), fully cleaned up.
- **Shared modules touched:** `components/field/field-map.tsx` (additive —
  new `variant` prop and a `dataset.cameraJumps` counter; the existing
  "full" behaviour path is unchanged). `app/globals.css` (the Sora fix —
  corrective, no admin token name or value changed). `lib/sync/queue.ts`,
  `lib/geo/walk/*`, `lib/map/route-layers.ts`, `lib/supabase/*` not
  touched.
- **Decided by:**
  - owner (already recorded in the plan-approved entry) — decisions 1–11
    and amendments 1–8, including amendment 4 (the Sync failed trigger
    must be a real rejection), amendment 5 (`git grep`, not `rg`), and
    amendment 6 (one MapLibre instance at a time, plus the 2,000-door
    compact-map timing).
  - agent — the Sora `@theme inline` fix and the `DoorScroll`
    natural-width fix (both above). Neither is a Session A file,
    `lib/sync/queue.ts`, the database or Figma, so neither required a
    stop-and-ask; both are documented, reasoned fixes to Session B1/B2
    output discovered during assembly, not new design decisions.
  - agent — `OutcomeColumn`'s composer slot is 92px (the pill's circle),
    not the pill's full 140px, so `DoorScroll` gets the width it needs.
  - agent — the map-band scroll-shrink ladder (P11) was not built; no
    acceptance item tests it and it was time-boxed out in favour of the
    functional items above. Flagged for the owner.
  - agent — `EndOfProp`'s copy and layout are this session's own reading
    of the plan's text description; no Figma screenshot was spent on it.
  - agent — the Info banner's instruction text does not append a
    hand-phrase suffix; it is `route-display.ts`'s existing card text,
    unchanged, joined with " · " when there is more than one card.
- **Deviations from plan or brief:** the two bug fixes above (Sora,
  DoorScroll width); the map-band height ladder not built; `EndOfProp`
  not screenshotted; the instruction banner's exact wording not checked
  against a real routed fixture (the throwaway prop had no frozen route,
  so `view?.cards` was empty throughout the live test).
- **Invariants:** no GPS, no coordinates — confirmed unchanged. No
  quality scoring in `/field` — Today's stats are still own-counts-only,
  Confirmed still "—". Field writes still go through
  `lib/sync/queue.ts` only; that file was not opened this session
  (`git diff --quiet -- lib/sync/queue.ts` exit 0). No migration.
- **Verified:** `npx tsc --noEmit` exit 0. `npx eslint components/field
  lib/field "app/(field)"` exit 0. `npm run verify:stage8b` exit 0
  ("ALL CHECKS PASSED"). `npm run verify:stage10` exit 0 ("OK", including
  the live A1/B1/C1/heartbeat sections). `npm run verify:ui4` exit 0
  ("OK"). `npm run verify:ui1` exit 0 ("OK", 36 checks). Figma read-only:
  `get_screenshot` on 8:2, 13:141, 13:652, 13:356, 13:608, 13:703, 13:793
  (each once); `get_design_context` on 9:148 (once — no positioning data
  returned in isolation, so the existing OtherMenu anchor was left
  unchanged, one attempt as instructed). Browser: 390×844, 375×812,
  430×932, and sanity 375×667 / 844×390 landscape, all screenshotted and
  compared against the Figma renders above; `Page.getLayoutMetrics`
  confirmed each CSS viewport size directly (not inferred from the
  screenshot tool). Live two-canvasser test (`localhost` / `127.0.0.1`,
  separate origins for separate sessions): A1 confirmed (Ada logs, Tom's
  next-open-door and teammate line update live); B1 confirmed (Tom's
  `DoorScroll` shows Ada's door greyed with "✓ Ada", aria-live says
  "knocked by Ada"); C1 confirmed (`"Ada · last knocked #43"`, live, no
  reload); the P6 Info banner appeared live with a working "OK" dismiss.
  A second Realtime session (signed in as Tom again) listened for the
  live portion of the test: `{"here":19,"knocked":1}`, `claim=0`,
  `release=0`, `unparsed=0`. Offline test (Ada, CDP `Network.setBlockedURLs`
  on the Supabase host): logged while blocked (UI updated immediately,
  IdChip amber, banner "N to send · retrying shortly"), unblocked, flush
  confirmed (IdChip green); `knock_events` for that UPRN: exactly 1 row,
  checked directly. Amendment 4 script-level proof: deleted a third
  member's (`Sam Reeve`) `assignment_members` row, `sendOp` as that
  member returned `outcome: "permanent"`, `error.code: "42501"`, 0
  `knock_events` rows for that `client_event_id`. Amendment 4 browser
  proof: Tom offline, logged a door, his `assignment_members` row
  deleted (service role), back online — the Sync failed banner appeared
  exactly as Figma 13:608 ("! 1 knock couldn't be sent · door 1", Retry,
  red), IdChip red, the row excluded from Today's stats. One-instance
  check: `document.querySelectorAll('.maplibregl-map').length` was 1 on
  the Logger, 1 on the Map tab, and 1 again after Map→Logger→Map→Logger.
  2,000-door check (temporary page, deleted after): node count 9 at
  index 0, 17 at index 1000, 9 at index 1999 (≤17 throughout); exactly 1
  `jumpTo` per settle for a 0→500, 500→1999, 1999→0 jump and a
  single-step `›`; frame-time p50/p95 in the 33–44ms range (jumps are
  instant, so little to sample) on this development machine's Chrome —
  NOT a phone. React `Profiler` re-render check (temporary, removed
  after): over 30s idle on a live signed-in session, `DoorScroll`/`MiniMap`
  committed roughly every 700ms–1s (matching `use-team.ts`'s tick, as
  expected — the parent re-renders) but `actualDuration` stayed under 1ms
  for every commit (many exactly 0ms), confirming `React.memo` bails out;
  one real prop-stability bug found and fixed in the process (`onAddHouseNumber`
  was a fresh arrow function every render). Contrast table recomputed
  with a fresh WCAG script (temporary, deleted after) against the current
  token values — unchanged from Session B1's figures, since no colour
  token changed this session. `realtime.messages` for the throwaway
  topic: 0 (reported only, nothing deleted from `realtime.*`). Cleanup:
  `knock_events`/`assignments`/`territories`/`auth.users`/`profiles`
  counts scoped to every harness name used this session are all 0 after
  cleanup, checked directly against the live project.
- **Not verified:** on-device sun, one-handed grip, wet-thumb and haptic
  checks — no phone was used anywhere in this session; every check above
  ran in desktop Chrome with CDP device-metrics emulation. `EndOfProp`'s
  screen and the map-band scroll-shrink ladder (not built). The Turn
  instruction banner's exact wording against a real routed fixture.
  `prefers-reduced-motion`, screen-reader use, and keyboard-only
  navigation of the assembled (composed) screen — all were unit-tested
  inside their own components in Session B2, not re-tested here at the
  composed-screen level.
- **External settings:** none changed.
- **Open questions for Claude:** whether the map-band scroll-shrink
  ladder (P11) is worth building; whether `EndOfProp` should be checked
  against Figma directly; the admin-Contacts label reconciliation
  (Session A) is still open for the admin rebuild; the ~8-door-per-scroll
  fling limit (Session B2) is still unanswered; the whole Logger rebuild
  needs an on-device pass before it can be called field-ergonomics-verified.

### 2026-09-29 — UI item 1b Session G1 (uncommitted)

- **Item:** 1b — Logger layout
- **What changed:** The Logger map now fills the space above a 44px status line, and the door panel sits on the bottom of that column, just above the note bar. The knocking instruction is plain grey text with a turn icon, and it no longer covers the map. Other sits inline, 8px left of Not In and centred on it. The viewport requests `viewport-fit=cover` so the tab bar's existing home-indicator padding can work; the sheet and the map door panel no longer add a second bottom inset.
- **Files:**
  - Changed: `app/layout.tsx`, `app/(field)/layout.tsx`, `components/field/sheet.tsx`, `components/field/map-tab.tsx`, `components/field/icons.tsx`, `components/field/ui/status-banner.tsx`, `components/field/logger-tab.tsx`, `components/field/outcome-column.tsx`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: none
  - Deleted: none
- **Database:** none
- **Shared modules touched:** none. `lib/sync/queue.ts`, `lib/field/*` logic, `lib/geo/walk/*`, `lib/map/route-layers.ts` and `lib/supabase/*` were not edited.
- **Decided by:**
  - owner — D1: the tab bar sits above the iPhone home indicator. `viewportFit: "cover"`; only the tab bar keeps `pb-[env(safe-area-inset-bottom)]`.
  - owner — D2: the knocking instruction is a plain line of grey text under the map. No black box, and nothing covers the map.
  - owner — D3: the four pills move down. Not In's bottom sits just above the note bar. Other sits inline, just left of Not In, vertically centred on it.
  - owner — D6: the door panel moves down with the pills. The mini map takes the freed height.
  - agent — the turn card's stored kind is `step`, so that case gets `TurnIcon`. Transfer, spur and stranded keep their characters.
  - agent — the rule under the door is `mt-3 mb-2` (was `my-3`) so the map band clears 160px. First measure was 156.82px.
  - agent — today's stats wrapper is `w-fit` so the row boxes match the text. Stretched rows intersected Other at 390.
- **Deviations from plan or brief:** the two agent class changes above. G2 was not started.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write path was added. `lib/sync/queue.ts` was not changed. No migration.
- **Verified:**
  - `npx tsc --noEmit` exit 0. eslint on `components/field`, `app/(field)` and `app/layout.tsx` exit 0 (twice; the second run was after the class tweaks).
  - `npm run verify:ui1`, `npm run verify:stage8b` and `npm run verify:ui4` each exit 0, once. `verify:stage8b` created a throwaway prop and two users and deleted them. `verify:ui4` was read-only.
  - `git grep` for `safe-area-inset-bottom` under `components` and `app`: one line, `components/field/tab-bar.tsx:33`.
  - Viewport meta: `width=device-width, initial-scale=1, viewport-fit=cover`.
  - One `getBoundingClientRect` script, CanvasserX on `/field/logger`, TEST - dry run, visit 2, 88 doors. Chrome device metrics.
  - 390×844: pill lefts all `234.6`. Not In to NoteBar gap `12`. Other gap `8`, centre delta `0`. No intersection with stat rows or the door scroll. Map height `160.82`. Status line `43.99` tall, top equal to the map bottom. Only absolute child of the map band is the map wrapper.
  - 430×932: pill lefts all `274.77`. Gap `11.99`. Other gap `8`, centre delta `−0.01`. No intersections. Map height `248.85`. Status line flush with the map.
  - 375×667: pill lefts all `219.22`. Other gap `8`, centre delta `−0.01`. Map height `111.99` (the 112px minimum; the body scrolls). Status line flush. Door scroll does not intersect Other.
- **Not verified:** the real iPhone safe area. In this Chrome emulation `env(safe-area-inset-top)` on `<main>` computed to 0, so D1's home-indicator padding was not seen with a real inset. No phone, no sun, no wet thumb, no on-device haptic.
- **External settings:** none. Signed the browser in as CanvasserX with a magic link. Password, profile and role were not changed.
- **Open questions for Claude:** at 375×667 the CONFIRMED label intersects Other (label right `154.6`, Other left `151.2`, about 3.4×6.6px). Stopped rather than edit `stat-row.tsx` or move Other off `top-3 mr-2`. Needs an owner call before G2 or a follow-up.

### 2026-09-30 — UI item 1b Session G2 (uncommitted)

- **Item:** 1b — Other menu and undo icon
- **What changed:** The Other menu is `fixed` to the right gutter and opens upward from the button, with a max height that keeps it on screen. The full-width undo toast is a 44px ring with a prop-coloured countdown stroke. The Logger draws it at the top-right of the door panel, including the end-of-prop state. Other field routes draw the same button floating top-right. Undo descriptions use the scroll plate, so a door with no number reads `#N` rather than an em dash.
- **Files:**
  - Changed: `components/field/ui/other-button.tsx`, `components/field/undo-toast.tsx`, `components/field/logger-tab.tsx`, `app/(field)/layout.tsx`, `docs/D2D-Build-Brief.md`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: `components/field/ui/undo-button.tsx`
  - Deleted: none
- **Database:** none
- **Shared modules touched:** none. `lib/sync/queue.ts` is imported for `UNDO_WINDOW_MS` only. `lib/field/undo.ts`, `lib/field/other-gesture.ts`, `lib/sync/*`, `lib/geo/walk/*`, `lib/map/route-layers.ts` and `lib/supabase/*` were not edited.
- **Decided by:**
  - owner — D4: the menu opens up, right-aligned to the gutter, always on screen.
  - owner — D5: the full-width toast is replaced by a 44px ring icon.
  - agent — the button's base `relative` class is omitted when the caller passes `absolute`. Both utilities set `position`, and this Tailwind build keeps the `relative` rule, so the Logger placement did not apply until `relative` was left off.
- **Deviations from plan or brief:** the `relative` omission above. No other placement, size, or write-path change.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write path was added. `lib/sync/queue.ts` was not changed. No migration.
- **Verified:**
  - `npx tsc --noEmit` exit 0. `npx eslint components/field "app/(field)"` exit 0.
  - `git grep` hex under `components/field/ui`: 0 lines (exit 1). `git grep UndoToast` under `components` and `app`: 0 lines (exit 1). `git diff --quiet` on `lib/sync`, `lib/field/undo.ts` and `lib/field/other-gesture.ts`: exit 0.
  - `npm run verify:ui1`, `npm run verify:stage8b` and `npm run verify:ui4` each exit 0, once. `verify:stage8b` created a throwaway prop and two users and deleted them. `verify:ui4` was read-only.
  - Chrome device metrics, CanvasserX. Offline for every log that was meant to stay on the device.
  - 375×667, quick tap, gesture `tap`. All 4 menuitems inside the viewport. Menu right `359.21`, viewport width − 16 = `359`, delta `0.21`. Menu bottom `462.99`, Other top `470.46`.
  - 390×844 emulation, `innerWidth` `391`, quick tap, gesture `tap`. All 4 inside. Menu right delta `−0.4`. Menu bottom `640.06`, Other top `647.61`.
  - Hold-slide, script touch `PointerEvent`s, onto Call back later: outbox `held_undo` 0 → 1. Undo: 1 → 0 and the button gone. Description `Call back · 18A Harbury Road`.
  - After a Contact log: undo button `43.99×43.99`, `position: absolute`, no intersection with Lead, Contact, Rented/Council, Not In, Other, or the current plate. `[data-testid=undo-toast]` count 0. Ring `stroke-dashoffset` `33.88` → `37.73` over 2s. Tap undo: `held_undo` 1 → 0 and the button gone. Description `Contact · #2 Ventnor Road`.
  - Map tab, offline (`fetch /health` failed, `navigator.onLine` false). Not In from the door panel. Floating button top-right (`right-3 top-3`), `43.99×43.99`. Territory name glyphs right `155.64`, button left `334.62`, gap `179`, no intersection. Undo: `held_undo` 1 → 0 and the button gone.
  - After going back online: `knock_events` for CanvasserX with `occurred_at` on or after 2026-09-29 00:00 London: **0**.
- **Not verified:** no phone, no sun, no wet thumb, no on-device haptic. Chrome emulation only. The visit line under the map title does run under the floating icon (text right `370.45`, button left `334.62`). The territory name does not.
- **External settings:** none. Signed in as CanvasserX with the existing browser session. Password, profile and role were not changed.
- **Open questions for Claude:** the map visit line passes under the floating undo icon. The G1 375px CONFIRMED/Other overlap is still open. The Logger still needs an on-device pass.

### 2026-09-30 — UI item 1b log-confirm animation, Session G3 (uncommitted)

- **Item:** 1b — Logger layout, the log-confirm animation
- **What changed:** A successful log plays a 780 ms confirm on that pill. The circle moves 124 px right, the chevron fades, a tick draws in the circle's resting slot, holds, then the circle and chevron return. Tapping the same outcome again cancels the run and starts it from rest. Other's confirm is a 240 ms scale pop, skipped under reduced motion. Under reduced motion the circle does not travel: it fades, and the tick shows, then both return. Pressing a pill scales the circle to 0.96 on the CSS `scale` property.
- **Files:**
  - Changed: `components/field/ui/outcome-pill.tsx`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: none
  - Deleted: none
- **Database:** none
- **Shared modules touched:** none. `lib/sync/queue.ts`, `lib/field/*`, `lib/geo/walk/*`, `lib/map/route-layers.ts` and `lib/supabase/*` were not edited. `confirmKey` was not changed.
- **Decided by:**
  - owner — D7 (2026-09-29): slide-to-confirm (circle off-screen, tick, return, 780 ms, compositor-only, restartable). `travelPx` 124.
  - agent — `active:scale-[0.96]`, because `scale-96` is not in the Tailwind 4.3.3 scale list. The arbitrary value sets the CSS `scale` property.
  - agent — under reduced motion the circle fades on opacity, and the tick path is held at `strokeDashoffset` 0. Otherwise the tick is either undrawn or hidden under the circle.
- **Deviations from plan or brief:** the two reduced-motion additions above. The stroke draw eases with `EASE_OUT` from 60 ms as well as on the first keyframe. A second tap inside 400 ms still does not log (`INPUT_LOCK_MS`, not edited). `travelPx` was not increased when 124 px left 32.4 px of the circle on screen.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write path was added. `lib/sync/queue.ts` was not changed. No migration. The 40 ms haptic stays the Logger's existing pulse. This component adds no second one.
- **Verified:**
  - `npx tsc --noEmit` exit 0. `npx eslint components/field` exit 0.
  - `git grep` hex under `components/field/ui`: 0 lines (exit 1).
  - `npm run verify:ui1` and `npm run verify:stage8b` each exit 0, once. `verify:stage8b` created a throwaway prop and two users and deleted them (`territories left named "STAGE 8B TEST PROP — DELETE ME": 0`).
  - Chrome device metrics 390×844, `innerWidth` 391. CanvasserX on `/field/logger`, REF - Speedwell, visit 3. Offline: `navigator.onLine` false and `fetch /health` threw `TypeError`.
  - Contact: at 134 ms `translateX` 119.7; at 417 ms `translateX` 124, tick opacity 1, chevron opacity 0; at 1,017 ms `translateX` 0, tick opacity 0, chevron opacity 1, circle animations 0.
  - At 417 ms the circle's left was 358.6, not ≥ 391. 32.4 px remained. `elementFromPoint` at the right edge hit the circle.
  - Not In at 214 ms: one log. Not In at 459 ms: animation restarted (`currentTime` 450 → 17) and both rows were `held_undo`. After 1,200 ms every pill was at rest.
  - One Contact, 1,100 ms: 68 frames, 0 dropped, longest gap 16.9 ms, long tasks 0.
  - Reduced motion: `translateX` 0 at 131, 414 and 1,014 ms. Tick opacity 1 while the circle opacity was 0. At 1,014 ms the circle was back and the tick was gone.
  - After each test the latest row was undone on the button. Any earlier held row was deleted from the local outbox while offline. Back online, outbox open rows 0. `knock_events` for CanvasserX with `occurred_at` on or after 2026-09-30 17:50 UTC: 0. Last 2 hours: 0.
- **Not verified:** no phone, no sun, no wet thumb, no on-device haptic. Chrome emulation only.
- **External settings:** none. Signed the browser in as CanvasserX with a magic link, then cleared that cookie locally. Password, profile and role were not changed.
- **Open questions for Claude:** 124 px does not take the circle's left past the viewport on this layout (resting left 234.6). A second tap at about 200 ms is eaten by the 400 ms input lock. Say if either should change.

### 2026-09-30 — UI item 1b Session G4 (uncommitted)

- **Item:** 1b — stat row, map undo padding, log-confirm travel
- **What changed:** Below 390px the stat row gap is 8px and the label tracking is 0.08em; from 390px both go back to the previous gap and 0.12em tracking. The map header pads on the right while an undo is offered, so the floating ring has 56px clear of the header text. Each log-confirm measures how far the circle must travel to leave the viewport, plus 8px, and never travels less than 124px.
- **Files:**
  - Changed: `components/field/ui/stat-row.tsx`, `components/field/map-tab.tsx`, `components/field/ui/outcome-pill.tsx`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: none
  - Deleted: none
- **Database:** none by this session's edits. Five pre-existing outbox knocks synced on an online reload. Select only afterwards. No delete, no update. Ids below.
- **Shared modules touched:** none. `lib/sync/queue.ts`, `lib/field/*`, `lib/geo/walk/*`, `lib/map/route-layers.ts` and `lib/supabase/*` were not edited. `useUndoTarget` was only imported.
- **Decided by:**
  - owner — G4 prompt: the three class and travel changes, measured per run, 124px kept as the minimum.
  - agent — `let travel: number`, because `travelPx` is the literal type `124`.
  - agent — a computed transform of `none` is treated as translate 0, so the first run does not throw.
- **Deviations from plan or brief:** the type annotation and the `none` guard. The Map check and both verify scripts were not run, because the session stopped when knocks synced.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write path was added. `lib/sync/queue.ts` was not changed. No migration.
- **Verified:**
  - `npx tsc --noEmit` exit 0. `npx eslint components/field` exit 0.
  - EDIT 1. At 375×667, 390×844 and 430×932, offline, CanvasserX on the Logger, REF - Speedwell. No stat row intersects Other. Gap at 375 is `5.25` (row right `146.26`).
  - EDIT 3. Contact circle left at about 420 ms: 375 → `383.51` / width `375`; 390 → `398.32` / width `390`; 430 → `438.21` / width `430`. At about 1,000 ms the left matched the resting left and `translateX` was 0. Each undo removed the ring. Outbox after each undo: `pending` 5, `synced` 47.
- **Not verified:** Map tab at 390. `npm run verify:ui1`. `npm run verify:stage8b`. No phone, no sun, no wet thumb, no on-device haptic.
- **External settings:** none. The browser session had dropped after an offline navigation. A magic link for the existing CanvasserX account was used to sign in again. Password, profile and role were not changed.
- **Open questions for Claude:** five knocks synced and were left in place. The map header padding still needs the door-panel check.

Synced `client_event_id`s (select, 2026-09-30):

- `b73f0d67-6fcf-401e-876e-e6fbd19cae35` — `no_answer` — UPRN 76888
- `6e2f6979-24d6-4366-b8ff-ee6e2aafdaa3` — `no_opportunity` — UPRN 77069
- `26c0d64e-f8f0-43d5-8d43-745f14db2c26` — `no_answer` — UPRN 77070
- `3ff38c7f-7a36-4216-ab1c-d3c091c7ad20` — `no_opportunity` — UPRN 77095
- `f6a3ff71-03bb-4d6b-a73b-889931d7303d` — `no_opportunity` — UPRN 77111

### 2026-09-30 — UI item 1c Session H1 (uncommitted)

- **Item:** 1c — the door panel
- **What changed:** The Logger door panel is tighter. Outcome circles are 76px. The current plate is 88px for a short number, and the ladder steps down from there. The header drops "Quick Logger" and uses a 20px title. The pills sit in a 140px slot, so the tail no longer covers the door column. Neighbour plates are hidden. "+ Add house number" and the logged line share one fixed 32px row under the street.
- **Files:**
  - Changed: `app/globals.css`, `lib/field/door-window.ts`, `components/field/ui/door-scroll.tsx`, `components/field/ui/stat-row.tsx`, `components/field/ui/outcome-pill.tsx`, `components/field/outcome-column.tsx`, `components/field/logger-tab.tsx`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: none
  - Deleted: none
- **Database:** none by this session's edits. `npm run verify:stage8b` created a throwaway prop and two users and deleted them. Four local Contact attempts on CanvasserX were undone or removed from the device outbox while offline. A select on those `client_event_id`s returned 0 rows. No canvassing row was deleted or updated.
- **Shared modules touched:** `lib/field/door-window.ts` — `PLATE_PX` and its doc comment only. `plateSize()` is unchanged. `lib/sync/queue.ts`, `lib/field/undo.ts`, `lib/field/other-gesture.ts`, `lib/geo/walk/*`, `lib/map/route-layers.ts` and `lib/supabase/*` were not edited. `field-map.tsx` and `mini-map.tsx` were not edited.
- **Decided by:**
  - owner — E1: the screen does not shift when the door changes. "+ Add house number" and the logged pill share one fixed-height row. The row stays when neither applies.
  - owner — E2: the door number and street are centred in the space left of the buttons. Neighbour numbers are hidden. Swiping and ‹ › still work.
  - owner — E3: the door number, the stats and the spacing are tighter and smaller.
  - owner — E4: the street sits under the number. "+ Add house number" is smaller and sits in the info row under the street.
  - owner — E5: the map gets more height: no "Quick Logger" label, a smaller prop name, outcome buttons at 76px.
  - agent — the scroll track is `h-[110px]` (was 132). 96px plate plus 14px for the teammate line. The old 132px left a 36px hole under the plate.
  - agent — the centring wrapper is `w-full` as well as `items-center`. `items-center` alone sized the scroller to the track and the slot width ran away.
- **Deviations from plan or brief:** the track height and the `w-full` wrapper, above. The plate's centre is about 4px left of the midpoint between the door column's left and the Lead pill's left. No padding was added to close that. The map band at 390×763 is 169.64. At 375×600 Not In overlaps the note bar. On a logged placeholder the logged pill and "+ Add house number" overlap each other.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write path was added. `lib/sync/queue.ts` was not changed. No migration.
- **Verified:**
  - `npx tsc --noEmit` exit 0. `npx eslint components/field lib/field` exit 0.
  - `npm run verify:ui1` exit 0, once. The plate check is still the size names (`xl`/`lg`/`md`/`sm`). No `PLATE_PX` number in that script needed changing.
  - `npm run verify:stage8b` exit 0, once. Throwaway prop and two users created and deleted (`territories left named "STAGE 8B TEST PROP — DELETE ME": 0`).
  - Chrome, CanvasserX, `/field/logger`, REF - Speedwell, visit 3. Offline: `navigator.onLine` false and `fetch /health` threw `TypeError`.
  - Panel height, all 358.77. At 390×763 (`innerWidth` 391): door 3 "11" unlogged, door 2 "#3" unlogged, door 0 "1" logged, door 1 "#2" logged. At 375×600 and 430×850 (`innerWidth` 431): the first three of those, also 358.77. Door 1 logged was measured at the 390 size only.
  - Neighbour computed opacity at rest: 0 on those passes.
  - Not In bottom to note-bar top: 11.99 at 390 and at 430. At 375×600 the gap is −93.59 and the rects intersect.
  - Contact slide, viewport 391. At 251 ms the circle's left was 399.57. At 421 ms it was 399.6. At 1,064 ms the left was 234.6 and the transform was `none`.
  - The #2 Contact was undone on the ring. Outbox open rows after that: 0. The logged pill was gone.
- **Not verified:** no phone, no sun, no wet thumb, no on-device haptic. Placeholder+logged panel height was not repeated at 375 and 430.
- **External settings:** none. Signed the browser in as CanvasserX with a magic link. Password, profile and role were not changed.
- **Open questions for Claude:** the 4px centre gap, the map at 169.64, the 375×600 overlap, and the logged-placeholder info row. H2 was not started.

Local Contact attempts, all offline. None of these ids are in `knock_events` (select returned 0 rows):

- `1d9f9e05-5c2e-4a34-9ef6-0effd1778ad6` — undone on the ring
- `70c906ef-e8ec-4569-a66d-d20012354dbe` — undone on the ring
- `ec23b8aa-e60a-4bd8-8798-3acbf4bca57e` — `answered`, UPRN 77326. The undo window had closed (`pending` in the device outbox). The row was removed from Dexie while offline. It was not updated in Postgres.
- `8fa41c66-e925-4d63-8bbe-098b28d5d4ef` — `answered`, UPRN 77673 (`#2`). Undone on the ring.

### 2026-09-30 — UI item 1c Session H2 (uncommitted)

- **Item:** 1c — the mini map
- **What changed:** The Logger mini map can be dragged and pinched. It does not rotate or pitch. After a log, or after ›, it eases back onto the current door in 300 ms, including when the door layer is mid-update. A 44px round button at the bottom-left opens the full map. The attribution control is unchanged.
- **Files:**
  - Changed: `components/field/field-map.tsx`, `components/field/mini-map.tsx`, `lib/field/map-style.ts`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: none
  - Deleted: none
- **Database:** none. Twelve offline Not In logs on CanvasserX were undone on the ring. A select of `knock_events` for that canvasser with `occurred_at` on or after 2026-09-30 22:10 UTC returned 0 rows. No canvassing row was deleted or updated.
- **Shared modules touched:** `lib/field/map-style.ts` — one dated line on the one-instance comment. `lib/sync/queue.ts`, `lib/field/undo.ts`, `lib/field/other-gesture.ts`, `lib/geo/walk/*`, `lib/map/route-layers.ts` and `lib/supabase/*` were not edited.
- **Decided by:**
  - owner — E6: pan and pinch allowed, no rotate or pitch; re-centres on every door change.
- **Deviations from plan or brief:** the first follow pass was on a hot-reloaded map that was still non-interactive. It was repeated after a reload. Offline, the open-map button's route change became a full document load and the tab died (`chrome-error`). That check, and Map → Logger → Map, were then run online. The load handler still jumps to the first door; the 300 ms ease is the camera effect.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write path was added. `lib/sync/queue.ts` was not changed. No migration. One MapLibre instance at a time: 72 samples while switching Map and Logger, maximum 1.
- **Verified:**
  - `npx tsc --noEmit` exit 0. `npx eslint components/field lib/field` exit 0.
  - `npm run verify:ui1` exit 0, once. `npm run verify:ui4` exit 0, once. ui4 printed read-only asserts and did not mention throwaway users.
  - Chrome, CanvasserX, REF - Speedwell, visit 3, 182 doors. Emulation 390×763 (`innerWidth` 391). Offline for the logs: `navigator.onLine` false, `fetch /health` threw `TypeError`.
  - Twelve Not In logs, each undone on the ring. Projected current door: min x 195.5, max x 195.5, min y 85, max y 85, map 391×170. All inside.
  - An 80px touch drag changed the centre lng by −0.000303. `logger-body` `scrollTop` stayed 0.
  - One › after the drag put UPRN 76061 at x 195.5, y 85.
  - Online, `mini-map-open` opened `/field` on UPRN 77876, plate `1`, panel "1 Selby Road".
- **Not verified:** no phone, no sun, no wet thumb, no on-device haptic. Not run at 2,000 doors. Offline open-map and offline tab switches.
- **External settings:** none. The browser was already signed in as CanvasserX. No new magic link. Password, profile and role were not changed.
- **Open questions for Claude:** the open-map route change dies offline in `next dev` because there is no service worker. H1's plate gap, the map at 169.64, the 375×600 overlap, and the logged-placeholder info row are unchanged.

### 2026-09-30 — UI item 1c Session H3 (uncommitted)

UI item 1c, Session H3. In `components/field/logger-tab.tsx` the logged pill drops the word "Logged", keeps the outcome and the time, and does not wrap (`shrink-0`, `whitespace-nowrap`). On a logged door with no house number the control reads "+ Add no." and keeps `aria-label="Add house number"`; an unlogged door still reads "+ Add house number". No other source file. No migration. No field write path. `npx tsc --noEmit` and `npx eslint components/field` both exit 0. `git diff --ignore-cr-at-eol --stat -- components/field/logger-tab.tsx` is 38 insertions and 31 deletions, because that file was already dirty from earlier uncommitted Logger work; this session changed the pill class, the pill text, the button class, the aria-label, and the button label. Chrome, CanvasserX, REF - Speedwell, visit 3, door #2 Ventnor Road. Offline: `navigator.onLine` false and `fetch /health` threw `TypeError`. Not In logged at 23:34, then ‹ from door 34 (the log had moved the cursor 32 doors). At 390×763 (`innerWidth` 391) the pill was x 24, y 467.59, 113.37×27.99 and "+ Add no." was x 145.37, y 459.59, 73.24×43.99; the door column was x 16, y 295.61, 210.6×342.79; no intersection; both inside. At 375×667 (`innerWidth` 375) the pill was x 16.31, y 409.94, 113.37×27.99 and the button was x 137.67, y 401.94, 73.24×43.99; the column was x 16, y 237.95, 195.22×342.79; no intersection; both inside. The undo ring showed 17 seconds left when the 390 rects were taken, and the button was gone before the click, because walking back took the rest of the 60s window. Local outbox row `2aed786e-748f-4750-b311-fdc3e9d71d33` was `knock_event`, `pending`, 0 attempts; it was removed from Dexie while offline. A select of that id, and of CanvasserX knocks with `occurred_at` on or after 2026-09-30 22:30 UTC, returned 0 rows, including after the browser was back online with no open outbox rows. Screenshot is 390×763. No phone. Did not commit.

### 2026-10-01 — UI-2 Session M1 (uncommitted)

- **Item:** 2 — map palette and outcome colours
- **What changed:** Map colours live in `lib/map/map-palette.ts`. The field basemap is the fetched MapTiler dataviz-light JSON, restyled in `restyleBasemap`. Unlogged doors are white with a grey ring. Logged doors use the new outcome colours, and the dots are smaller. The Map legend uses the same hexes. Offline, or a failed style fetch, still paints `MAP_PALETTE.ground` and the dots.
- **Files:**
  - Changed: `lib/field/map-style.ts`, `components/field/field-map.tsx`, `components/field/map-tab.tsx`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: `lib/map/map-palette.ts`, `lib/map/restyle-basemap.ts`
  - Deleted: none
- **Database:** none
- **Shared modules touched:** `lib/field/map-style.ts` (shared by the field map, the Logger mini map, and the admin coverage map). New `lib/map/map-palette.ts` and `lib/map/restyle-basemap.ts`. `lib/map/route-layers.ts` was not edited. `lib/sync/queue.ts` was not edited.
- **Decided by:**
  - owner — F1. Palette "v1, soft neutral light". Hex values in `MAP_PALETTE`.
  - owner — F2. Outcome colours: Lead green, Contact blue, Rented/Council amber, Not In grey. A door not yet knocked is white with a grey ring. Hex values in `OUTCOME_DOT`.
  - owner — F3, size half only. Circle bases 3/5/8/10, cores 1/2/3/4, focus halo 7/11/16/20. The walkline anchoring half of F3 is not this session.
  - agent — focus halo sizes stay inside `focusHaloAt`, so an unselected door still has radius 0.
- **Deviations from plan or brief:** Admin coverage was not edited, but it calls `fieldMapStyle()`, so that basemap is restyled too. The plan said admin maps are not changed. No Figma file was opened; the eye check is the live map against the palette.
- **Invariants:** No GPS and no coordinates. Outcome colour is the current assignment only. No quality score. No field write. `lib/sync/queue.ts` was not touched.
- **Verified:** `npx tsc --noEmit` exit 0. `npx eslint components/field lib/field lib/map` exit 0. `npm run verify:ui1` exit 0, once. `npm run verify:ui4` exit 0, once. Chrome, CanvasserX, `/field`, Whitechurch Lane - Hartcliffe, visit 1, 1,682 doors, 390×763 (`innerWidth` 390). Zoom 16 and 18 screenshots. Logger screenshot. `restyleReport`: 42 layers, counts in `docs/BUILD-LOG.md`. Fallback with MapTiler blocked and cache off: style `field-offline`, background `#f6f4ef`, 435 door circles in view at zoom 16. `knock_events` for CanvasserX on or after 2026-10-01 18:20 UTC: 0. Outbox `61cea5a1-d03e-4edb-9294-6bf4045e61e1` still `failed`, and that id is not in `knock_events`.
- **Not verified:** A radio-off reload of the document (`chrome-error`, no service worker). A phone. A timed pass at 2,000 doors. A live Figma frame.
- **External settings:** none. Magic link for CanvasserX, user `576c4ce7-5fe0-489f-bd7f-42912925951a`, `expires_at` 1790883474 (2026-10-01T19:37:54Z). Password, profile and role were not changed. The browser session was left signed in.
- **Open questions for Claude:** Dataviz Light never selects `park` or `roadMajorCase`. Forest, Aeroway, Pier and Bridge stay on the style's own paint. Logger button fills are lighter than `OUTCOME_DOT` (Lead `rgb(99,185,137)`, Contact `rgb(96,148,230)`, Rented/Council `rgb(249,242,230)`, Not In `rgb(150,155,164)`). Not tuned. Should coverage stop sharing `fieldMapStyle`?

### 2026-10-01 — UI-2 Session M2 (uncommitted)

- **Item:** 2 — door dots on the pavement walkline
- **What changed:** A door's display point is its position projected onto the pavement walkline of the work step that covers its sequence, in order, at least 2.5 m from the next dot and 1 m in from each end of the line. A stack of flats spreads around the shared point. Doors with no work step, and any cross step, stay on the property point. The Map tab and the Logger mini map draw those display points. The assignment doors, the sequence and the writes are the same objects as before.
- **Files:**
  - Changed: `components/field/field-data-provider.tsx`, `components/field/map-tab.tsx`, `components/field/logger-tab.tsx`, `package.json`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: `lib/map/door-anchors.ts`, `lib/map/anchor-doors-collection.ts`, `scripts/verify-map-anchors.ts`
  - Deleted: none
- **Database:** none. The Speedwell check was SELECT only.
- **Shared modules touched:** new `lib/map/door-anchors.ts` and `lib/map/anchor-doors-collection.ts` (display geometry only). `lib/map/route-layers.ts` was not edited. `lib/sync/queue.ts` was not edited. `lib/field/*`, `lib/geo/walk/*` and `lib/supabase/*` were not edited.
- **Decided by:**
  - owner — F3. Each door's dot sits on the pavement walkline in front of its house, in door order, at least 2.5 m from its neighbours. Display only: UPRN, data and writes unchanged.
  - agent — when the field phase is not ready, `anchoredDoors` is an empty collection. Map and Logger return before they read it.
  - agent — the live gap is the straight-line distance between consecutive doors in one work step. The 2,000-door figure is the second run, after one discarded warm-up.
- **Deviations from plan or brief:** CanvasserX's today prop has no route steps, so the Map screenshots do not show a pavement row. The row was checked on REF - Speedwell's data, not on the open Map tab. `npx eslint components/field lib/field lib/map scripts` exits 1 on pre-existing `scripts/seed-demo.ts` line 242. A `window.anchorDoorCollection` hook was added for the browser timing and then removed. After the Logger load, `typeof window.anchorDoorCollection` was `undefined`.
- **Invariants:** No GPS and no coordinates stored or sent. No quality score. No field write. `assignment.doors` is still what `getSequence` reads. `lib/sync/queue.ts` was not touched.
- **Verified:**
  - EDIT 1 DONE. `lib/map/door-anchors.ts` is the pasted file. `spread` and `anchorDoors` are exported from it.
  - EDIT 2 DONE. `anchorDoorCollection` maps `uprn`, `sequence` and coordinates, returns a new collection with `anchored`, and returns the same reference when `steps` is empty.
  - EDIT 3 DONE. `anchoredDoors` is a `useMemo` on the assignment doors and the route. No route returns the original doors. `getSequence(phase.assignment.doors)` is unchanged.
  - EDIT 4 DONE. `map-tab.tsx` and `logger-tab.tsx` pass `doors={anchoredDoors}`. `mini-map.tsx` still forwards its `doors` prop.
  - EDIT 5 DONE. `package.json` script `verify:anchors`. `npm run verify:anchors` exit 0, once.
  - Pure: `spread([5,5,5],0,10,2.5)` = `[2.5,5,7.5]`. `spread([1,2,3,4],0,3,2.5)` = `[0,1,2,3]`. `spread([],0,5,2.5)` = `[]`. 100 m line, 10 doors, 4 stacked: minimum gap 2.500 m, order kept, inside [1, 99] m. A sequence outside every work step stays put, `anchored` false. A cross step is ignored.
  - REF - Speedwell open assignment `629d3ce4-a82a-4678-ab87-389e783da792`, visit 3, snapshot 182. Anchored count 182. Minimum neighbour gap 2.497 m. Move min 2.17 m, median 12.27 m, max 18.57 m.
  - `npx tsc --noEmit` exit 0.
  - `npx eslint` on this session's files exit 0. The directory command that includes `scripts` exits 1. See deviations.
  - `npm run verify:ui1` exit 0, once. `npm run verify:ui4` exit 0, once. ui4 printed read-only asserts.
  - Node timing, 2,000 doors / 60 steps: 3.33 ms. Browser console, same generator, the real `anchorDoorCollection`: 2.80 ms, 2,000 features, 2,000 anchored.
  - Chrome, CanvasserX, `/field`, Whitechurch Lane - Hartcliffe, visit 1, 1,682 doors. Emulation 390×763. `innerWidth` 391, `innerHeight` 763. Zoom 17: 98 `field-doors` in view. Zoom 18: 28 in view, house numbers visible (Belland Drive, Parkwood Close). Dots sit on the buildings. This assignment has 0 `route_steps`, so nothing is anchored. Profile heading CanvasserX, role canvasser. Logger mini map: 1 canvas. Attribution links for MapTiler and OpenStreetMap were on the map.
  - `knock_events` for CanvasserX on or after 2026-10-01 20:00 UTC: 0. Outbox `61cea5a1-d03e-4edb-9294-6bf4045e61e1` is not in `knock_events`. Retry was not clicked.
  - Point count on screen: 1,682. Timed at 2,000. Device: desktop Chrome with device-metrics emulation, not a phone.
- **Not verified:** A pavement row on the live Map tab. Whitechurch has no walkline. A phone. Sun, wet thumb, one-handed use. A radio-off reload.
- **External settings:** none. No new magic link. Password, profile and role were not changed. The browser was left signed in as CanvasserX.
- **Open questions for Claude:** Today's prop cannot show F3. Speedwell visit 3 is 2026-09-30, so the field app will not open it. The row needs a today prop that has work steps, or a look at Speedwell another way. `scripts/seed-demo.ts` line 242 fails `prefer-const` and blocks `eslint scripts`.

### 2026-10-01 — UI item 2 building outlines and door slices (uncommitted)

- **Item:** 2 — building outlines and per-door slices (Session M3)
- **What changed:** OpenStreetMap building ways for three named territories are stored as polygons, then cut into one slice per door position. Flats at the same 0.5 m point share a slice. A terrace is cut by the Voronoi cells of its door positions. The field app does not draw these yet. A second ingest left the row counts unchanged.
- **Files:**
  - Changed: `package.json`, `lib/supabase/types.ts`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: `supabase/migrations/024_door_footprints.sql`, `scripts/ingest-buildings.ts`, `scripts/verify-door-footprints.ts`
  - Deleted: none
  - Raw Overpass JSON is under `data/raw/buildings-*.osm.json`. `/data/*` already ignores it. `git status --short --ignored` shows `!! data/raw/`. It is not staged.
- **Database:** 024 `024_door_footprints.sql`, recorded as version `20261001205042`. Tables `building_footprints` (Polygon, 4326) and `door_footprints` (MultiPolygon, 4326). GiST on both geoms. B-tree on `door_footprints.osm_id`. RLS on, SELECT for `authenticated` only, no write policy. `upsert_building_footprints` and `rebuild_door_footprints` are service role only. `assignment_door_footprints` is executable by `authenticated`.
- **Shared modules touched:** `lib/supabase/types.ts`, regenerated after 024. No other shared module.
- **Decided by:**
  - owner — F4. Building outlines from OpenStreetMap, and a slice per door so a building can be coloured by outcome. The migration text in the session is the schema.
  - agent — Overpass retries on 429, 502 and 504, and a 3 second pause between territories.
  - agent — height is parsed from a leading number of metres. `building:levels` is used when that parse fails.
  - agent — the verify script calls the read RPC as CanvasserX, who is already a member. No throwaway user was created. Whitechurch has no open assignment, so that check used the closed assignment.
- **Deviations from plan or brief:** The first apply went through the Supabase CLI and was not recorded. Those empty objects were dropped, then `apply_migration` recorded `20261001205042`. New tables still receive the project's default grants (anon and authenticated have table privileges). RLS is what limits them: anon select returned 0 rows; authenticated select worked. Whitechurch's assignment is closed, so it is not an open assignment. The RPC check still matched: 1,468 single-door features. The first Whitechurch rebuild hit the statement timeout twice, then the third attempt wrote 1,578. The re-run wrote 1,578 on the first attempt.
- **Invariants:** No GPS and no coordinates sent from a device. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not used. Ingest is service role, the same class as the road ingest. Address text was not written. `door_footprints.geom` is MultiPolygon because the session SQL says so.
- **Verified:**
  - EDIT 1 DONE. `supabase/migrations/024_door_footprints.sql` is the session SQL. Next free number was 024. Applied and recorded as `20261001205042`. `lib/supabase/types.ts` regenerated. `npx tsc --noEmit` exit 0.
  - RLS, rolled back. As `authenticated`, `select count(*)` on both tables returned 0 with `current_user` authenticated. As `anon`, both counts returned 0. As `authenticated`, `upsert_building_footprints` and `rebuild_door_footprints` raised `42501 permission denied for function`. After those errors, `current_user` was `postgres` again.
  - EDIT 2 DONE. `scripts/ingest-buildings.ts`. `package.json` has `ingest:buildings`. No arguments prints usage and exits 1. Multipolygon relations are named in the script header. Attribution lines were not edited.
  - EDIT 3 DONE. Ingested only "REF - Speedwell", "TEST - dry run" and "Whitechurch Lane - Hartcliffe". Sent equals written: 723, 474, 2,477. Rebuild rows: 179, 85, 1,578. Second run: same sent, written and rebuild counts. `building_footprints` 3,674 and `door_footprints` 1,842 both times.
  - EDIT 4 DONE. `scripts/verify-door-footprints.ts`. `package.json` has `verify:footprints`. Final `npm run verify:footprints` exit 0.
  - REF - Speedwell: buildings 723, doors 182, with a slice 179 (98.4%), single slices 172, shared slices 3, shared doors 7. Invalid 0. Single-door overlaps over 0.5 m²: 0. Split buildings 1, area failures 0.
  - TEST - dry run: buildings 474, doors 88, with a slice 85 (96.6%), single 66, shared slices 7, shared doors 19. Invalid 0. Overlaps 0. Split buildings 3, area failures 0.
  - Whitechurch Lane - Hartcliffe: buildings 2,477, doors 1,682, with a slice 1,578 (93.8%), single 1,468, shared slices 31, shared doors 110. Invalid 0. Overlaps 0. Split buildings 17, area failures 0.
  - RPC as CanvasserX. REF open assignment `8eaae87b-a77e-4e7b-b653-9a2cd9f03dbc` (2026-10-01): 172 single-door features. TEST open assignment `1e9fe4c5-ffa6-46c7-80d8-9348267e477b` (2026-10-02): 66. Whitechurch closed assignment `4d735d92-1eaa-4e55-9f21-e0e17f558379`: 1,468. Profile after: name CanvasserX, role canvasser, active true.
  - `npx eslint scripts/ingest-buildings.ts scripts/verify-door-footprints.ts scripts/lib` exit 0.
  - `git check-ignore` matches `.gitignore` line 49 `/data/*` for the three raw files. `git status --short --ignored` shows `!! data/raw/`.
- **Not verified:** Drawing the slices on a map. A phone. Doors that are missing because the outline is a multipolygon relation, counted only as the gap below 100%. Authenticated INSERT on the new tables (RLS has no write policy; the session proof asked for select and the two function denials).
- **External settings:** none. Magic link for CanvasserX, user `576c4ce7-5fe0-489f-bd7f-42912925951a`, `expires_at` 1790892025, used by the first passing verify, then local sign-out. Magic link for the same user, `expires_at` 1790892081, used by the final verify, then local sign-out. Password, profile and role were not changed. The browser was not opened.
- **Open questions for Claude:** Whitechurch visit 1 is closed. The slice RPC still returns its doors for CanvasserX because the member row remains. Say if a closed assignment should stop returning footprints. The first cold rebuild of Whitechurch exceeded the API statement timeout twice before it finished. A later cold run may need the same retry.

### 2026-10-01 — UI item 2 coloured buildings and 2D/3D (uncommitted)

- **Item:** 2 — coloured buildings and the 2D/3D toggle (Session M4)
- **What changed:** The field map loads each door's building slice and tints it from this assignment's knock. A shared slice is outlined and never tinted. 2D is flat. 3D tilts the camera and extrudes the slices 0.5 m above the basemap buildings. One control on the Map tab and one on the Logger mini map share the choice and remember it on the device.
- **Files:**
  - Changed: `lib/field/db.ts`, `components/field/field-data-provider.tsx`, `components/field/field-map.tsx`, `components/field/map-tab.tsx`, `components/field/mini-map.tsx`, `components/field/logger-tab.tsx`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: `lib/field/footprint-cache.ts`, `lib/field/map-view.ts`
  - Deleted: none
- **Database:** none. Reads `assignment_door_footprints` from migration 024. No new migration.
- **Shared modules touched:** `lib/field/db.ts` (Dexie version 7, `footprints` store). New `lib/field/footprint-cache.ts` and `lib/field/map-view.ts`. `lib/map/route-layers.ts`, `lib/sync/queue.ts`, `lib/geo/walk/*` and `lib/supabase/*` were not edited.
- **Decided by:**
  - owner — F4. Buildings take the outcome colour (tints), in 2D and 3D. Outlines come from OpenStreetMap. A terrace is split per house. A slice with several doors at one position stays neutral, with an outline.
  - owner — F5. The dots stay, smaller, on top of the coloured buildings.
  - owner — F6. A 2D/3D toggle on the Map tab and the Logger mini map. The choice is shared and remembered. 3D is a tilted camera plus extruded buildings. No terrain.
  - agent — `ensureFootprints` takes the Supabase client as well as the assignment id and the online flag, the same shape as `ensureRoute`.
  - agent — the route load and the slice load share one effect. Coming back online runs that load again. It does not clear `routeReady` on the way.
  - agent — `logger-tab.tsx` passes `footprints` into `MiniMap`. The mini map is memoised and does not call `useFieldData` itself.
- **Deviations from plan or brief:** The door dot for UPRN 74756 was selected by calling the map's `onSelectUprn` after `queryRenderedFeatures` showed that dot under the projected point. The screenshot click landed on the canvas at a scaled coordinate and did not open the panel. The lead itself was logged with the Lead button and the sheet, offline. A second offline Contact on door 17 was logged and undone to time the 3D mini map. `next dev` would not load the document while the radio was off.
- **Invariants:** No GPS and no coordinates sent. No quality score. The two test knocks went through the existing logger and the queue, then undo deleted the held rows before anything was sent. `lib/sync/queue.ts` was not edited. Slice geometry is display only.
- **Verified:**
  - EDIT 1 DONE. Dexie version 7 repeats every version-6 store and adds `footprints: "assignment_id"`. No `.upgrade()`. Dated comment is above the version call and in the file header.
  - EDIT 2 DONE. `lib/field/footprint-cache.ts`. Online calls `assignment_door_footprints` with a 4 s timeout, stores `{ assignment_id, fetched_at, data }`, and returns the collection. Offline, a timeout, or an error returns the cache or null.
  - EDIT 3 DONE. Footprints load when the assignment is ready and again on `window` `online`, in the same effect as the route. Context exposes `footprints`.
  - EDIT 4 DONE. `lib/field/map-view.ts`. `useMapView`, `setMapView`, `toggleMapView`. Key `d2d.mapView`. Reads and writes are in try/catch. Default `2d`.
  - EDIT 5 DONE. `field-footprints` source, `promoteId: "fid"`. Fill, line and extrusion sit under the route. Basemap extrusion sits under the slices. Outcome state is applied on `style.load` and in the effect. 3D pitch is 55 on the Map tab and 50 on the mini map. Compact `touchPitch` stays disabled. Follow keeps the current pitch.
  - EDIT 6 DONE. Both toggles are 44px, round, `border-line`, `bg-surface`, `text-field-button-label`, `aria-pressed`. The label is `3D` in 2D and `2D` in 3D. Map tab is `left-2 top-2`. Mini map is `right-2 top-2 z-[2]`.
  - EDIT 7 DONE. `useFieldData().footprints` is passed into both `FieldMap` usages. `logger-tab.tsx` passes it through `MiniMap`.
  - `npx tsc --noEmit` exit 0. `npx eslint components/field lib/field lib/map` exit 0.
  - `npm run verify:ui1` exit 0, once. `npm run verify:ui4` exit 0, once. `npm run verify:anchors` exit 0, once.
  - Chrome, CanvasserX, REF - Speedwell, visit 4, assignment `8eaae87b-a77e-4e7b-b653-9a2cd9f03dbc`. Emulation 390×763. `innerWidth` 391, `innerHeight` 763. 182 doors, 175 slices.
  - Offline (`navigator.onLine` false, `fetch /health` threw `TypeError`). Lead on UPRN 74756 (174 Speedwell Road, door 89). `queryRenderedFeatures` on `field-footprints-fill` returned that feature with `state.outcome` `lead`, `shared` false. `getFeatureState` was `{ outcome: "lead" }`. The fill paint expression contains `#cfe6d8`. Undo removed outbox row `5e4e1192-f3ab-4096-8743-2bb595c2e498`. Feature state afterwards was `{}`.
  - Shared slice fid `-621499241001`. Fill filter is `["!=", ["get", "shared"], true]`. Rendered fill features with `shared` true: 0. The line layer rendered that fid with feature state `{}`.
  - Map tab 3D: pitch 55. `basemap-buildings-3d` and `field-footprints-3d` visible. Fill and line `none`. Doors and `route-walk-work` visible. Layer indexes: basemap extrusion 42, slice extrusion 45, route work 48, dots 53. `localStorage` `3d`.
  - Logger mini map opened already in 3D: pitch 50, zoom 17.5, `touchPitch` false, button `2D` pressed. › moved the camera and pitch stayed 50. Toggling to 2D there stored `2d`. The Map tab then read pitch 0, fill visible, extrusion `none`, button `3D`.
  - Reload with `d2d.mapView` `3d`: pitch 55, button `2D` pressed, 175 slices.
  - 3D pan, 5,010 ms, zoom 18, pitch 55: 302 animation frames, 0 gaps over 1.5 frame budgets, 287 `render` events. A Contact tap on the 3D mini map showed the undo ring in 84 ms. Pitch stayed 50. That row `e56ec6b2-4c7f-4a86-b038-6ee802ad0704` was undone while offline. Outbox left 0.
  - After both undos, and again after the app was back online: `knock_events` for those two ids, and for CanvasserX with `occurred_at` on or after 2026-10-01 21:20 UTC: 0 rows. `61cea5a1-d03e-4edb-9294-6bf4045e61e1` is not in `knock_events`.
  - Point count on screen: 182 doors, 175 slices. Device: desktop Chrome with device-metrics emulation, not a phone.
- **Not verified:** A radio-off reload. `location.reload()` while `navigator.onLine` was false ended on `chrome-error://chromewebdata/`. The Dexie row was present before that reload (175 features, fetched `2026-10-01T21:16:36.246Z`). A phone. A 2,000-door 3D timing pass. Sun, wet thumb, one-handed use.
- **External settings:** none. No new magic link. The browser was already signed in as CanvasserX. Password, profile and role were not changed. Left on `/field`, map view `3d`.
- **Open questions for Claude:** none from this session. The M3 question about a closed assignment still returning footprints is unchanged.

### 2026-10-02 — UI item 2, Session M5 (uncommitted)

- **Item:** 2 — building colour lag, deeper tints, current-door link
- **What changed:** A logged door's building takes the outcome colour on that log. The tint no longer waits for a later log. Building tints are deeper. The selected door (Logger current door, or the Map tab's tapped door) draws one dashed line from its pavement dot to the address point inside the house, ending in a small ring, and that slice is highlighted. Other doors have no leader.
- **Files:**
  - Changed: `components/field/field-map.tsx`, `lib/map/map-palette.ts`, `lib/map/anchor-doors-collection.ts`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: none
  - Deleted: none
- **Database:** none
- **Shared modules touched:** `lib/map/map-palette.ts` (deeper `OUTCOME_TINT`, new `FOCUS`) and `lib/map/anchor-doors-collection.ts` (`raw_lng` / `raw_lat` on anchored features). `lib/map/route-layers.ts`, `lib/sync/queue.ts`, `lib/geo/walk/*` and `lib/supabase/*` were not edited.
- **Decided by:**
  - owner — G1. A building takes its outcome colour immediately after the log.
  - owner — G2. Building outcome tints are deeper and higher contrast.
  - owner — G3. Only the door being worked gets a dashed leader from its pavement dot to the address point, ending in a small ring, and that house slice is highlighted in 2D and 3D.
  - agent — the same leader `setData` also runs in the map `load` handler, next to the first `applyOutcomeState`. The `style.load` listener is registered inside `load`, so it does not run for the first style.
- **Deviations from plan or brief:** The phone check ran on today's open prop, TEST - dry run visit 3, not REF - Speedwell. REF - Speedwell visit 4 is dated 2026-10-01. The work date was not changed. The undo ring holds one log for 60 seconds. The five logs were made consecutively so the lag check was real, and the ring had expired before they could be undone one by one. The five unsent outbox rows were deleted locally while Supabase was blocked. Nothing was inserted. The pre-existing outbox id `61cea5a1-d03e-4edb-9294-6bf4045e61e1` was left pending. The Map-tab tap was a `click` event on the map canvas at the door's pixel, because the coordinate click tool would not run without a screenshot in the same step.
- **Invariants:** No GPS and no coordinates sent. `raw_lng` / `raw_lat` stay on the device as display properties for the leader. No quality score. Field writes still go through `lib/sync/queue.ts`, which was not edited. The five test knocks were queued offline and removed from the local outbox before send.
- **Verified:**
  - EDIT 1 DONE. Doors-data effect and outcome effect each gate on the map instance, then on the source. Dated G1 comment on each. No other effect was given that change.
  - EDIT 2 DONE. `OUTCOME_TINT` is lead `#8fcfa8`, answered `#9dbcf0`, no_opportunity `#efc27f`, no_answer `#c3c7ce`, other `#c9c1b5`. `FOCUS` is `{ line: "#1b4aa6", tint: "#c7d6f5" }`. Dated comment `2026-10-02 G2/G3 (phone check)`.
  - EDIT 3 DONE. Anchored features carry `raw_lng` and `raw_lat` from the original point. Empty steps still return the same collection, with no `raw_*`.
  - EDIT 4 DONE. Selected outline uses `FOCUS.line` at width 2.5. A selected slice with no outcome uses `FOCUS.tint` in 2D and in 3D. Selected extrusion stands 1 m proud (`height_m + 1.5` against `+ 0.5`). Leader source `field-door-leader`, layers `field-door-leader-line` and `field-door-leader-end`, under the route, visible in 2D and 3D, not in `applyMapView`. `leaderFor` returns empty when there is no selection, no door, no raw point, or the gap is under 1.5 m.
  - `git grep -n "isStyleLoaded" -- components/field/field-map.tsx` prints five comment lines (831, 832, 880, 881, 903). None call it. 831–832 and 880–881 are the G1 comments. 903 is the 2026-09-30 camera comment. The route effects still gate on `getStyle()` and `getSource`. They were not changed.
  - `npx tsc --noEmit` exit 0. `npx eslint components/field lib/field lib/map` exit 0. `npm run verify:ui1` exit 0. `npm run verify:anchors` exit 0 (2,000 doors / 60 steps, 4.96 ms). `npm run verify:ui4` first run: `JWT issued at future`, exit 1. Retry: exit 0.
  - Chrome, CanvasserX, TEST - dry run, visit 3, 88 doors. Emulation 390×763. Offline (`navigator.onLine` false) for every log.
  - G1 **PASS**. Five logs, feature state on `field-footprints` within 300 ms: 313869 answered 14 ms; 25300 no_answer 29 ms; 25388 no_opportunity 31 ms; 25467 no_answer 30 ms; 25437 answered 33 ms. The first log was immediate.
  - G2 feature states **PASS** for answered, no_answer and no_opportunity. The 3D frame shows a blue slice standing above the grey terrace. The 2D frame shows `FOCUS.tint` on the current house. A separate amber rented slice is not obvious in the captured frames.
  - G3 **PASS** on the Logger: leader line plus end point on door 25615 (gap 6.93 m), footprint state `{ selected: true }` and no outcome. › moved the selection to 342809 and the line start moved. Map tab: canvas click on 313869 opened the panel and drew a LineString and a Point. Close removed the panel and the leader (0 features).
  - G3 short leader: **none on this prop**. Minimum dot-to-raw gap 3.17 m across the doors queried.
  - After the local outbox delete, `knock_events` for the five ids, and for CanvasserX with `occurred_at` on or after 2026-10-02 19:39 UTC: 0 rows. `property_observations` for those ids, and for that canvasser in the same window: 0 rows. `61cea5a1-d03e-4edb-9294-6bf4045e61e1` is not in `knock_events`.
  - Point count on screen: 88 doors. Device: desktop Chrome with device-metrics emulation, not a phone. The leader is two features.
- **Not verified:** REF - Speedwell on the phone, because it is not today's open assignment. A distinct amber building in the screenshot. A door under 1.5 m. A physical phone. A 2,000-door paint of the map. Sun, wet thumb, one-handed use. The undo ring itself, because the 60 s window closed during the screenshots.
- **External settings:** none. No new magic link. The browser was already signed in as CanvasserX. Password, profile and role were not changed. Left on `/field` with the devtools network forced offline.
- **Open questions for Claude:** none. REF - Speedwell visit 4 is yesterday's assignment. Say if a later phone check should use a prop whose work date is today.

### 2026-10-03 — UI item 3, Session D1, field dark mode (uncommitted)

- **Item:** 3 — field app dark mode
- **What changed:** The field app (/field) can be Auto, Light or Dark. Auto follows the phone and is the default. The choice is stored on the device under `d2d.theme`. A script sets `data-field-theme` on `<html>` before the field UI is parsed. Dark colours are re-declared on `.field-root` only. Outcome buttons sit in a light island, so they keep the light palette on a dark screen. Admin and office are not included. The map is still light.
- **Files:**
  - Changed: `app/globals.css`, `app/(field)/layout.tsx`, `components/field/outcome-column.tsx`, `components/field/outcome-buttons.tsx`, `components/field/profile-tab.tsx`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`, `docs/D2D-Build-Brief.md`
  - New: `lib/field/theme.ts`, `components/field/field-theme-sync.tsx`
  - Deleted: none
- **Database:** none
- **Shared modules touched:** new `lib/field/theme.ts` (local preference only). `lib/map/*`, `lib/sync/queue.ts`, `lib/geo/walk/*` and `lib/supabase/*` were not edited.
- **Decided by:**
  - owner — H1: dark mode covers the whole field app (Map, Logger, Leads, You, sheets, tab bar). Admin and office are not included.
  - owner — H2: You tab setting Auto / Light / Dark. A new install starts on Auto. The choice is saved on the device.
  - owner — H3: Dark palette v1.
  - owner — H4: outcome buttons keep the light look (option A), including the Map tab door panel.
  - owner — the map stays light in this session. D2 darkens the map.
  - agent — the Appearance buttons also use `rounded-field-sm text-sm font-semibold`, so the selected segment follows the field radius.
  - agent — `FieldThemeSync` watches `document.head` and writes the theme colour back when Next.js replaces the meta tag on a client navigation.
- **Deviations from plan or brief:** The head watcher was not in the prompt. Without it, Logger loaded with `theme-color` `#161a20` and Leads / You went back to `#fbfaf8` while the page stayed dark. The dev server that was already running stopped answering; it was stopped and started once. It was not restarted again.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not edited. No knock was logged.
- **Verified:**
  - EDIT 1 DONE. `@theme` has these 26 `--color-*` tokens, and the light island copies all 26 with the same values: ink, ink-soft, worksheet, worksheet-deep, paper, prop, prop-soft, ochre, oxide, lead, field-bg, surface, line, ink-muted, ink-faint, outcome-lead, outcome-lead-ink, outcome-contact, outcome-rented, outcome-rented-edge, outcome-rented-ink, outcome-notin, outcome-on-pill, warn-bg, error-bg, scrim.
  - EDIT 2 DONE. `lib/field/theme.ts`. Key `d2d.theme`. Default `auto`. Reads and writes are in try/catch. Server snapshot for the resolved theme is light.
  - EDIT 3 DONE. `FieldThemeSync` sets `data-field-theme` and every `theme-color` meta, and on unmount clears the attribute and sets the meta back to `#fbfaf8`.
  - EDIT 4 DONE. The boot script is the first child inside the field layout, before `RegisterServiceWorker`. `FieldThemeSync` is next to it.
  - EDIT 5 DONE. `data-theme-island="light"` is on `outcome-column` and `outcome-buttons`.
  - EDIT 6 DONE. You tab, first section, Appearance, radiogroup of Auto / Light / Dark. Each radio is at least 44px tall.
  - Contrast, dark palette: ink on field-bg 15.40:1; ink on surface 13.75:1; ink-soft on field-bg 10.46:1; ink-soft on surface 9.34:1; ink-muted on field-bg 5.83:1; ink-muted on surface 5.20:1; prop on surface 7.49:1; lead on surface 8.65:1; oxide on surface 7.73:1; rented-ink on warn-bg 7.48:1; oxide on error-bg 7.10:1. Selected Appearance text `#161a20` on prop `#8cb4ff` is 8.39:1. Must-read pairs are at least 7:1. ink-muted is at least 4.5:1.
  - `npx tsc --noEmit` exit 0. `npx eslint components/field lib/field "app/(field)"` exit 0. `git grep` for a hex colour under `components/field/ui` returned no lines. `npm run verify:ui1` exit 0, once. `npm run verify:stage8b` exit 0, once.
  - Headless Chromium, CanvasserX, 390×763. Dark: Logger, Leads and You use field background `rgb(22, 26, 32)` and paper `#1f242c`. You shows Dark selected. Light: Logger background `rgb(244, 245, 247)`, paper `#fbfaf8`, meta `#fbfaf8`. Auto plus `prefers-color-scheme` dark then light, no reload: theme and background followed, and the meta was `#161a20` then `#fbfaf8`. After the head watcher, Logger, Leads and You in dark all kept meta `#161a20`.
  - No light flash on a hard load with Dark saved: the boot script is in the HTML before `.field-root`, and the first read, while the logger still said "Loading today's prop", already had `data-field-theme` `dark` and background `#161a20`.
  - CanvasserX opening `/admin` is sent back to `/field`. An admin session in the same tab (`802e95de-e975-4bb5-9545-123b4bc8fe43`) loaded `/admin` with no `data-field-theme`, meta `#fbfaf8`, title "Draw a prop", light map and worksheet. Signed out locally after.
- **Not verified:** The outcome column and the Notes sheet on a dark screen. There is no prop for London 2026-10-03, so those controls were not mounted. The light-island rule was not seen in the browser. A physical phone. Sun, wet thumb, one-handed use. Haptics (this setting does not vibrate). The paint-observer trace was null, so the flash check is the script order plus the first DOM read, not a frame recording.
- **External settings:** none. Magic links as in Current state. Password, profile and role were not changed.
- **Open questions for Claude:** A screenshot of option A (light outcome buttons on a dark logger) needs a prop whose work date is the London day of the check. TEST - dry run `1e9fe4c5-ffa6-46c7-80d8-9348267e477b` is 2026-10-02. The date was not changed.

### 2026-10-03 — UI item 3, Session D1b, dark-mode fixes (uncommitted)

- **Item:** 3 — field app dark mode
- **What changed:** Three fixes from Claude's review of D1. Sheet backdrops use the scrim token, so dark mode no longer opens a white wash. The map START and END badges use paper text, so they stay readable on the light dark-mode greens and reds. The theme effect writes the live preference, so the hydration snapshot cannot put "light" back over the boot script.
- **Files:**
  - Changed: `components/field/sheet.tsx`, `components/field/map-tab.tsx`, `lib/field/theme.ts`, `components/field/field-theme-sync.tsx`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: none
  - Deleted: none
- **Database:** none
- **Shared modules touched:** `lib/field/theme.ts` — added `currentResolvedTheme()`. `lib/map/*`, `lib/sync/queue.ts`, `lib/geo/walk/*` and `lib/supabase/*` were not edited.
- **Decided by:**
  - agent — the three fixes, found in Claude's D1 review. No owner decision in this session.
- **Deviations from plan or brief:** The hard reload (check d) and the light screenshot (check e) were not finished. The IDE reload call did not return. A headless retry was stopped while Chrome was still running, before it printed a result. `app/layout.tsx` was not edited. A Next.js hydration warning pointed at `app/layout.tsx` line 50; the attribute diff was not captured.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not edited. No knock was logged.
- **Verified:**
  - EDIT 1 DONE. `components/field/sheet.tsx` backdrop is `bg-scrim/45`. Dated comment: `2026-10-03 D1b: scrim token, not ink (ink flips to near-white in dark).`
  - EDIT 2 DONE. In `components/field/map-tab.tsx`, the START and END badges use `text-paper`. No other line in that file was changed.
  - EDIT 3 DONE. `currentResolvedTheme()` is exported from `lib/field/theme.ts`. The effect in `field-theme-sync.tsx` writes `const live = currentResolvedTheme()` onto the dataset and into `applyThemeColor`. The head observer calls `currentResolvedTheme()` each time. The effect dependency is still `[resolved]`.
  - `npx tsc --noEmit` exit 0. `npx eslint components/field lib/field` exit 0. `npm run verify:ui1` exit 0, once.
  - `git grep -n "bg-ink/" -- components/field` prints one line: `components/field/prop-status.tsx:73` (`gap-px bg-ink/15` on a three-column grid). That is not a full-screen backdrop.
  - (a) **PASS**. Chrome, CanvasserX, Southville solo 2, visit 1, 1,730 doors, door #1 Coronation Road. Emulation 390×763 (`innerWidth` 391, `innerHeight` 763). Pref Dark (`d2d.theme` `dark`, `data-field-theme` `dark`). The outcome column was on screen. Lead fill `rgb(99, 185, 137)`, the light-island outcome colour, not the dark `#3f9e69`.
  - (b) **PASS**. Notes sheet open. Backdrop class `bg-scrim/45`, computed `oklab(0 0 0 / 0.45)`, about 391×706. Not a white wash.
  - (c) **PASS**. Map tab, door panel open. Lead `rgb(30, 107, 58)` with text `rgb(251, 250, 248)` (light-island lead and paper). START text `rgb(31, 36, 44)` on `rgb(122, 211, 160)`. END text `rgb(31, 36, 44)` on `rgb(255, 155, 155)`.
  - No knock. No database write.
- **Not verified:** (d) the hard-reload sequence of `data-field-theme`. It was not printed. It is not known whether a value was `"light"`. (e) Pref Light, Logger and Notes. No light screenshot in this session. A physical phone. Sun, wet thumb, one-handed use. Haptics.
- **External settings:** none. Magic links as in Current state. Password, profile and role were not changed.
- **Open questions for Claude:** Check (d) still needs a hard reload with Dark saved and a log of every `data-field-theme` value. Check (e) still needs one light screenshot of Logger and the Notes sheet. The hydration warning on `<html>` was seen and not diagnosed.

### 2026-10-03 — UI item 3, Session D2, dark map (uncommitted)

- **Item:** 3 — the dark map (Map tab and Logger mini map)
- **What changed:** Field maps follow the resolved theme. `mapColours(mode)` is the only colour source for the basemap, door dots, building tints, focus and the small UI marks. `routeColours(mode)` paints the route. Light output is the previous constants. A theme change remounts `FieldMap` with `key={mode}`. Admin callers pass no mode and stay light. `<html>` has `suppressHydrationWarning` so the field boot script can set `data-field-theme` before hydration.
- **Files:**
  - Changed: `app/layout.tsx`, `lib/map/map-palette.ts`, `lib/map/restyle-basemap.ts`, `lib/field/map-style.ts`, `lib/map/route-layers.ts`, `components/field/field-map.tsx`, `components/field/map-tab.tsx`, `components/field/mini-map.tsx`, `components/field/logger-tab.tsx`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: none
  - Deleted: none
- **Database:** none
- **Shared modules touched:** `lib/map/map-palette.ts`, `lib/map/restyle-basemap.ts`, `lib/map/route-layers.ts` (optional `mode`, default `"light"`), `lib/field/map-style.ts`. `lib/sync/queue.ts`, `lib/geo/walk/*` and `lib/supabase/*` were not edited. Door-anchor code was not edited.
- **Decided by:**
  - owner — H1 to H4, recorded in the D1 entry.
  - owner — H5 (2026-10-02): the map follows the resolved theme. The dark map is the Apple-Maps-style palette from Figma section "Dark mode v1 (2026-10-02)". Admin maps stay light.
  - agent — the Logger compact halo keeps using the position colour (`#1b4aa6` in light, `#8cb4ff` in dark). The full-map halo uses `ui.halo` (`#1c2226` in light). Every listed light UI hex matched the file.
  - agent — `applyRouteProgress` takes `mode` and does not repaint. Line, chevron and badge colours are set when `paintRouteLayers` adds the layers.
- **Deviations from plan or brief:** A second `next dev` was started on port 3001 because port 3000 was already in use (pid 8444). It was not restarted. The Not In log was not undone: the 60 s ring expired while the dark-dot screenshot was being read, and the row then synced. `fetch /health` returned 200 while `navigator.onLine` was false. The Figma frames were not opened; no file key is in the repo.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. Field writes still go through `lib/sync/queue.ts`, which was not edited. One test knock did reach `knock_events`. See Current state. The owner decides that row.
- **Verified:**
  - EDIT 0 DONE. `app/layout.tsx` `<html>` has `suppressHydrationWarning` and the dated D2 comment. Viewport, body and metadata were not changed.
  - EDIT 1 DONE. `MapMode`, dark palette sets, `MAP_UI`, and `mapColours(mode)`. Light `MAP_PALETTE`, `OUTCOME_DOT`, `OUTCOME_TINT` and `FOCUS` are unchanged.
  - EDIT 2 DONE. `restyleBasemap(style, mode = "light")` uses `mapColours(mode).palette`. `restyleReport` is unchanged.
  - EDIT 3 DONE. `fieldMapStyle(mode = "light")` passes the mode through. `fallbackStyle(mode)` supplies the ground. `FALLBACK_STYLE` is `fallbackStyle("light")`.
  - EDIT 4 DONE. `routeColours` light values are today's hexes. `ROUTE_TIER_COLOURS` is still those light values. `paintRouteLayers` and `applyRouteProgress` take a last optional `mode` defaulting to `"light"`. The chevron sprite stays `#ffffff`.
  - EDIT 5 DONE. `FieldMap` takes `mode` and reads it once on `modeRef`. `git grep -n -E "#[0-9a-fA-F]{6}\b" -- components/field/field-map.tsx` returned no lines.
  - EDIT 6 DONE. Map tab renders `<FieldMap key={mode} mode={mode}>`. The legend swatches use `mapColours(mode).dot`. The route rows use `routeColours(mode)`. `MiniMap` takes `mode` and passes `key` and `mode`. Logger passes `useResolvedTheme()`.
  - `npx tsc --noEmit` exit 0. `npx eslint components/field lib/field lib/map` exit 0.
  - `npm run verify:ui4` exit 0. Near `#dc9476`, far `#e7b9a5`, focus `#c2410c`, done `#a3a9ae`. Style validates, 0 errors.
  - `npm run verify:ui1` exit 0. `npm run verify:anchors` exit 0. 2,000 doors / 60 steps: 7.66 ms. That timing is the anchor maths, not a dark-map paint.
  - Contrast, WCAG, dark ground `#2b3341`: label `#c7cdd6` 7.95:1; open ring `#c2c9d2` 7.61:1; lead `#45b877` 5.07:1; answered `#5b8ff0` 4.01:1; no_opportunity `#e09a3a` 5.36:1; no_answer `#9aa2ad` 4.93:1; other `#c2c9d2` 7.61:1. Labels are at least 7:1. Those dots are at least 3:1. The open fill `#2b3341` is the ground (1.00:1); the ring is the mark.
  - Chrome, CanvasserX, Southville solo 2, visit 1, 1,730 doors. Emulation 390×763 (`innerWidth` 391, `innerHeight` 763).
  - (a) Dark Map 2D, dark Map 3D, dark Logger: screenshots taken. Legend swatches matched the dark dot and route hexes, including Now & next `rgb(255, 122, 69)` and Later `rgb(117, 76, 66)`.
  - (b) Not In on UPRN 114486. 2D screenshot pixels: closest to the dark dot `#9AA2AC` (target `#9aa2ad`, one channel off by 1) and closest to the dark tint `#4C525C` (target `#4b525c`, one channel off by 1).
  - (c) You tab Light, then Map: one `.maplibregl-map`. Legend open `rgb(255, 255, 255)`, Not In `rgb(133, 138, 147)`, Contact `rgb(63, 116, 208)`, Rented/Council `rgb(199, 122, 18)`, Lead `rgb(47, 143, 87)`, Now & next `rgb(194, 65, 12)`. Those are the light constants.
  - (d) `d2d.mapView` stayed `3d` after Dark → Light and after a later load with Dark saved. The button read `2D` and `aria-pressed` true.
  - Point count on screen: 1,730 doors. Device: desktop Chrome with device-metrics emulation, not a phone.
- **Not verified:** (e) `/admin` coverage was not opened. (f) The console was not captured. `Page.addScriptToEvaluateOnNewDocument` was installed twice; after the load, `window.__d2dLogs` was missing, so "no hydration warning" was not printed. The accessibility tree showed no error dialog. Figma frames "Dark / Map 2D" and "Dark / Map 3D" were not opened. A 2,000-door paint of the dark style was not timed. A physical phone. Sun, wet thumb, one-handed use.
- **External settings:** none. Magic link `expires_at` 1791057115, as in Current state. Password, profile and role were not changed. Left on `/field?d2=hydration` with `d2d.theme` `dark` and `d2d.mapView` `3d`.
- **Open questions for Claude:** The synced Not In row above. Say whether to leave it. `/admin` coverage still needs a light-map check. The `<html>` console on a Dark hard load still needs a captured log.

### 2026-10-03 — UI-5 Session A1 (uncommitted)

- **Item:** UI-5 — door eligibility
- **What changed:** A door is not knockable when it is in a No Cold Calling Zone or its building holds 3 or more units. The rule is the generated column `properties.is_knockable`. `refresh_door_eligibility()` filled `units_at_point` and `units_at_address` once. Read paths use that column. Today's assignment adds a `knockable` flag and leaves the snapshot, sequence and door count as they were. Ingest hooks are in place and were not run.
- **Files:**
  - New: `supabase/migrations/025_door_eligibility.sql`
  - Changed: `lib/supabase/types.ts`, `lib/geo/todays-assignment.ts`, `lib/geo/properties-in-polygon.ts`, `scripts/ingest-uprn.ts`, `scripts/ingest-addresses.ts`, `scripts/ingest-nccz.ts`, `docs/FIELD-TEST-BUILD-PLAN.md`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - Deleted: none
- **Database:** 025 `025_door_eligibility`. Four columns on `properties`. `is_multi_unit` and `is_knockable` are generated. `refresh_door_eligibility()` is revoked from `public`, `anon` and `authenticated`. `count_knockable`, `properties_in_polygon`, `route_walk_inputs` and `todays_assignment` were replaced. `allocate_prop` changed one predicate, `and not p.is_nccz` to `and p.is_knockable`, via a guarded replace. No new table. No row deleted.
- **Shared modules touched:** `lib/supabase/types.ts` regenerated after 025 (13 insertions). `lib/geo/todays-assignment.ts` and `lib/geo/properties-in-polygon.ts` only widened `DoorProperties`. `lib/sync/queue.ts`, `lib/field/*`, `lib/map/*` and `lib/geo/walk/*` were not touched.
- **Decided by:**
  - owner — H1 (2026-10-03): a door is not knockable if it is in a No Cold Calling Zone or its building holds 3 or more units. Units are the larger of UPRNs at the same OS point, or addresses sharing house number (or building name) plus street plus postcode. Two-flat conversions stay knockable. EPC "Flat" alone does not exclude. The rule lives only in `properties.is_knockable`.
  - owner — H2 (2026-10-03): nothing is deleted. Non-knockable doors will also be hidden in open assignments. That hide is Session A2, not this session.
  - Claude — the rule is a generated column, so it cannot drift from `is_nccz`.
  - Claude — `todays_assignment` only adds a `knockable` flag. Snapshot, sequence and `door_count` stay as they were, so today's field app keeps working until A2.
  - Claude — `allocate_prop` changes one line by a guarded replace of its live body, and keeps the 021 body, comment and grants.
  - Claude — dry-ran this SQL in a rolled-back transaction on 2026-10-03: 4 columns, multi-unit 110,760, knockable 303,003, `allocate_prop` patched, `authenticated` keeps EXECUTE on `allocate_prop` and has no EXECUTE on `refresh_door_eligibility`.
- **Deviations from plan or brief:** The pasted SQL comment says routes are regenerated in Session A2. The plan's regeneration session is A3. The SQL was not rewritten. Port 3000 was already in use, so the dev server is `http://localhost:3002`. Started once, not restarted.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not edited. Coverage was not stored. `knock_events` stayed at 1,236. The eligibility columns were written only by the migration's one call to `refresh_door_eligibility()`.
- **Verified:**
  - Counts: 424,952 total, 110,760 multi-unit, 13,270 NCCZ, 303,003 knockable.
  - `has_function_privilege`: `authenticated` cannot execute `refresh_door_eligibility()`. `authenticated` can execute `allocate_prop(uuid, date, uuid[])`. Both patched bodies contain `and p.is_knockable`.
  - `schema_migrations` latest row is `025_door_eligibility`, then `024_door_footprints`.
  - `npx tsc --noEmit` exit 0. eslint on `lib/geo` and the three ingest scripts exit 0.
  - Chrome, CanvasserX, `/field/logger`, REF - Speedwell, visit 5, 182 doors, door 1 Ventnor Road. 390×763 (`innerWidth` 390, `innerHeight` 763). GET 200. No error dialog. No failed resource. Post-load `console.error` hook was empty. No door logged. Profile after: name CanvasserX, role canvasser, active true.
- **Not verified:** A `console.error` hook on the first paint. `Page.addScriptToEvaluateOnNewDocument` did not run. Hiding doors, admin dots, views, and route regeneration. The ingest scripts were not run. A phone.
- **External settings:** none. Magic link `expires_at` 1791070252, minted and verified in Node, not opened. Password, profile and role were not changed. No token is stored here.
- **Open questions for Claude:** Allocating a prop will fail with `snapshot_mismatch` until A3 regenerates its routes. The migration comment names that work as A2.

### 2026-10-04 — TOOLING-1 A1, queue runner scripts (uncommitted)

- **Item:** other — owner tooling
- **What changed:** `run-queue.ps1` reads `.handoff/queue/NN-<session-id>.md` in name order and runs each prompt through the Cursor CLI (`agent -p`, model `grok-4.7-high`). After each session it checks the report, the allow list, the CLI log, `tsc`, eslint and the prompt's own checks. A pass commits `wip(<session-id>)` on `run/<batch>` and continues; a fail commits nothing and stops the queue. `gate: human` always stops after that prompt. `review-pack.ps1` writes `.handoff/review/<id>.md` for Claude. Only the runner commits, and only on `run/*`. Final commits land on `main` after review.
- **Files:**
  - New: `scripts/agent/lib.ps1`, `scripts/agent/run-queue.ps1`, `scripts/agent/review-pack.ps1`, `scripts/agent/README.md`
  - Changed: `.cursor/rules/50-plan-execution.mdc`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - Deleted: none
- **Database:** none
- **Shared modules touched:** none
- **Decided by:**
  - owner — T1 (2026-10-04): a headless queue runner may run Grok sessions unattended. Only the runner commits, only on `run/*` branches, as `wip(<session-id>)` checkpoints. Final commits land on `main` after Claude's review.
  - owner — T2 (2026-10-04): Claude may write prompt files into `.handoff/` (git-ignored). The rest of the repo stays read-only for Claude.
  - owner — T3 (2026-10-04): runner sessions do no browser checks. Visual checks move to the owner's phone check.
  - owner — T4 (2026-10-04): a prompt whose runner block says `gate: human` (any migration, RLS, sync-queue or database write) always stops the queue after it.
  - owner — T5 (2026-10-04): runner default model is `grok-4.7-high`.
  - agent — the three files already dirty at session start were left as they were. The pasted scripts were not edited.
- **Deviations from plan or brief:** C7's expected list of seven paths does not match the tree, because those three files were already modified. No script line was changed to hide that.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not edited. No knock was logged.
- **Verified:** C1, three scripts, 0 parse errors. C2, no non-ASCII in `scripts\agent\*.ps1`. C3, `/.handoff/`, `/Claude outputs/` and `*.tsbuildinfo` are ignored. C4, `agent.ps1` at `C:\Users\nomaa\AppData\Local\cursor-agent\agent.ps1`. C5, `-DryRun` on batch `dryrun`, branch stayed `main`, sample prompt deleted. C6, review pack `.handoff/review/tooling-1-a1.md`; new untracked files are the four `scripts/agent/` files. C8, HEAD still `ba22e49`.
- **Not verified:** `run-queue.ps1` without `-DryRun` (forbidden this session). A phone ping. No UI in this session. C7 did not match the expected seven paths: three files were already dirty. Details are in the session report.
- **External settings:** none
- **Open questions for Claude:** The three pre-existing dirty files are not part of this session. Say if they should be set aside before a real queue run. The line above the new rule 50 section still ends `review UI-5 A2`. It was already in the file and was not changed.

### 2026-10-04 — UI-5 Session A2 (uncommitted)

- **Item:** UI-5 — hide non-knockable doors in the field app
- **What changed:** Doors the database marks `knockable: false` are hidden in the open assignment. One function, `knockableOnly`, filters the cached payload and the fresh payload before any tab reads them. The cache itself stays complete. A missing `knockable` key is kept, so an old offline cache still shows every door until the next online load. Knocks still store the original snapshot index. Stranded doors are judged by that index against the snapshot length. A building slice whose UPRN is hidden is dropped. Shared slices stay.
- **Files:**
  - Changed: `lib/geo/todays-assignment.ts`, `components/field/field-data-provider.tsx`, `lib/field/route-display.ts`, `docs/FIELD-TEST-BUILD-PLAN.md`, `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: none
  - Deleted: none
- **Database:** none. No migration. No row deleted or updated.
- **Shared modules touched:** `lib/geo/todays-assignment.ts` (the filter and `snapshot_door_count`). `lib/field/route-display.ts` (stranded uses snapshot position). `lib/sync/queue.ts`, `lib/map/*`, `lib/field/log-outcome.ts`, `lib/field/cursor.ts`, `lib/field/use-team.ts` and `lib/supabase/*` were not edited.
- **Decided by:**
  - owner — H1 (2026-10-03): flats in buildings of 3+ units and No Cold Calling Zone doors are not knockable. The database decides (`knockable` on each door from `todays_assignment`, migration 025). The client never re-derives it.
  - owner — H2 (2026-10-03): hide them in currently open assignments too. Nothing is deleted. A knock keeps the original snapshot index as `sequence_position`.
  - Claude — one choke point, `knockableOnly`, applied in `FieldDataProvider` to both the cached and the fresh payload.
  - Claude — a door with no `knockable` key is kept. Only `knockable === false` hides. No Dexie version bump. The cache stores the unfiltered payload.
  - Claude — `SequenceDoor.position` already comes from the door's `sequence`, so logging code is unchanged.
  - Claude — `describeRoute` must use the snapshot length and snapshot positions, because a filtered sequence would otherwise mark real doors as off route.
  - Claude — drop a building slice whose `uprn` is a hidden door. Shared slices (`uprn` null) stay.
- **Deviations from plan or brief:** `git grep "knockable"` is not limited to the four files named in the prompt. The word was already used for counts and allocation. This session did not add an eligibility rule in TypeScript. The required comment in `route-display.ts` also contains the word. The end-of-prop screen was not opened. `fetch /health` returned 200 while `navigator.onLine` was false, same as the dark-map session. Dev servers were down, so this session started `http://localhost:3000` once.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. The test knock went through the existing queue and was undone on the device. `lib/sync/queue.ts` was not edited. Nothing was deleted from the database. Coverage is still derived.
- **Verified:** `npx tsc --noEmit` exit 0. `npx eslint components/field lib/field lib/geo` exit 0. `npm run verify:ui1`, `npm run verify:anchors` and `npm run verify:stage8b` exit 0. Chrome, CanvasserX, TEST - dry run, 390×763 (`innerWidth` 391). Header 53 doors. First door snapshot position 1, UPRN 348735, "1 of 53". Map source `field-doors` has 53 features. Stranded count 0. Offline outbox `sequence_position` 1 on `10fe004b-652d-4941-b4b0-6552f2f57424`, then undo. `knock_events` 1,240 before and after. That id: 0 rows. CanvasserX knocks since 2026-10-04 14:00 UTC: 0.
- **Not verified:** The end-of-prop screen (it shows only when every door is logged). A 2,000-door paint. A physical phone. Sun, wet thumb, one-handed use. `querySourceFeatures` returned 82 because features repeat across tiles; the source data count is 53.
- **External settings:** none. Magic link `expires_at` 1791127096, minted and verified in Node, not opened. Password, profile and role were not changed.
- **Open questions for Claude:** none for this filter. A3 still has to regenerate routes before a new allocation can freeze.

### 2026-10-04 — UI-5 Session A3a (uncommitted)

- **Item:** UI-5 — admin eligibility counts
- **What changed:** Migration 026. New `count_door_eligibility` and `nccz_zones_geojson`. `v_prop_completion` knockable and remaining count knockable doors only. `coverage_map_payload` and `admin_dashboard` were patched in place so a flat is not left to do, and a hidden door with a knock stays on the coverage map. No table, no row, no RLS change.
- **Files:**
  - New: `supabase/migrations/026_eligibility_admin_counts.sql`
  - Changed: `lib/supabase/types.ts` (10 insertions), `docs/FIELD-TEST-BUILD-PLAN.md` (UI-5 A3 tracker row only), `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - Deleted: none
- **Database:** 026 `026_eligibility_admin_counts`. Recorded as version `20261004144243`. No row written to an application table.
- **Shared modules touched:** `lib/supabase/types.ts` only, regenerated after 026. No component. No other `lib/**`.
- **Decided by:**
  - owner — H1 (2026-10-03): a door is not knockable if it is in a No Cold Calling Zone or its building holds 3+ units. The rule is `properties.is_knockable` (migration 025).
  - owner — H2 (2026-10-03): nothing is deleted. Hidden doors keep their history.
  - owner — H8 (2026-10-04): regenerate routes for the 6 props that have them in Session A3c, not this one.
  - owner — H9 (2026-10-04): leave the 20 old open assignments as they are. No database writes.
  - owner — H10 (2026-10-04): the tenure layer (A4) is deferred until after UI-7.
  - Claude — admin counts must agree with the field app: knockable and remaining count knockable doors only, so a flat is never left to do.
  - Claude — the coverage map keeps a hidden door if it already has a knock, so history stays visible.
  - Claude — `coverage_map_payload` and `admin_dashboard` are edited by a guarded in-place regex replace of their live bodies. Each pattern must match the expected number of times, or the migration aborts.
  - Claude — `count_door_eligibility` is new. `count_knockable` stays for existing callers.
- **Deviations from plan or brief:** Supabase MCP OAuth cannot run in this headless session (`mcp_auth` is desktop-only). The SQL was applied once through the Management API `POST /v1/projects/xerxsaptwpvhkkpyvkfi/database/migrations` with name `026_eligibility_admin_counts`, which is the call `apply_migration` makes. HTTP 200. Types were regenerated with `npx supabase gen types typescript --project-id xerxsaptwpvhkkpyvkfi --schema public`, the method Session A1 recorded, because MCP `generate_typescript_types` was not authenticated. The Node process then hit a Windows libuv assertion on exit, after the 200 body was printed. The migration row was confirmed by a later read. The SQL was not edited and not applied again.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not edited. No application row was inserted, updated or deleted. Coverage is still derived.
- **Verified:** Read-only SQL. `v_prop_completion` for `1e9fe4c5-ffa6-46c7-80d8-9348267e477b`: knockable 53, worked 73, answered 52, remaining 1. `nccz_zones_geojson` features 26. Privileges: authenticated execute true on both new functions, anon execute false on `count_door_eligibility`. Both function bodies patched. `v_prop_completion` reloptions `{security_invoker=true}`. `knock_events` 1,240 before and after. `schema_migrations` names `026_eligibility_admin_counts` then `025_door_eligibility`. `npx tsc --noEmit` exit 0. eslint on `lib/supabase/types.ts` exit 0.
- **Not verified:** A browser. `/admin/dashboard` and `/admin/coverage` were not opened. A phone.
- **External settings:** none
- **Open questions for Claude:** Accept the Management API apply in place of the MCP tool. The SQL and the migration name match the prompt. A3b and A3c are still to come.

### 2026-10-04 — UI-5 Session A3b (uncommitted)

- **Item:** UI-5 — admin draw page shows flats and No Cold Calling
- **What changed:** The draw page counts doors with `count_door_eligibility`. The readout is knockable, flats, and no cold calling. `excluded` remains multi-unit plus No Cold Calling. Door dots have three states, by shape as well as colour. No Cold Calling zone outlines are drawn under the dots and fail open if the fetch fails.
- **Files:**
  - Changed: `lib/geo/count-knockable.ts`, `components/admin/prop-tally.tsx`, `components/admin/prop-drawer.tsx`, `docs/FIELD-TEST-BUILD-PLAN.md` (UI-5 A3 Result only), `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: `lib/geo/nccz-zones.ts`
  - Deleted: none
- **Database:** none. No migration. No row written.
- **Shared modules touched:** `lib/geo/count-knockable.ts` (now calls `count_door_eligibility`). New `lib/geo/nccz-zones.ts`. `lib/map/*`, `lib/sync/queue.ts`, `lib/field/*` and `lib/supabase/*` were not edited.
- **Decided by:**
  - owner — H1 (2026-10-03): a door is not knockable if it is in a No Cold Calling Zone or its building holds 3+ units. The database decides (`properties.is_knockable`, migrations 025/026).
  - owner — H2 (2026-10-03): nothing is deleted.
  - Claude — the draw page reads `count_door_eligibility`. total = knockable + flats + No Cold Calling. `excluded` stays on the type.
  - Claude — three dot states, by shape as well as colour: knockable solid `--color-prop`; No Cold Calling hollow `--color-oxide` ring 1.6; flat (multi-unit, not NCCZ) hollow `--color-ink-soft` ring 1.0.
  - Claude — zone outlines under the dots: oxide fill 0.08 and a 1.2px oxide line. Loaded once from `nccz_zones_geojson()`. Fails open.
  - Claude — admin keeps the existing `token()` helper. `lib/map/map-palette.ts` is not touched.
  - Claude — do not change `count_knockable` callers outside these files.
- **Deviations from plan or brief:** none in the pasted code. `npx tsc --noEmit` fails because `scripts/verify-stage-5b-r3.ts` builds a `KnockableCount` without `multiUnit` and `nccz`. That file is outside the allow list. The pasted type was not rewritten. `git grep count_knockable` is not limited to `lib/supabase/types.ts`: comments in `lib/geo/prop-polygon.ts` and `lib/geo/properties-in-polygon.ts`, and an RPC call in `scripts/verify-stage-4.ts`. Those were already there and were not edited.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not edited. No application row was inserted, updated or deleted. Coverage is still derived.
- **Verified:** eslint on `lib/geo/count-knockable.ts`, `lib/geo/nccz-zones.ts`, `components/admin/prop-tally.tsx` and `components/admin/prop-drawer.tsx` exit 0. `git grep is_multi_unit` in `components/*` and `lib/geo/*` is prop-drawer.tsx and properties-in-polygon.ts only.
- **Not verified:** `npx tsc --noEmit` (exit 2, one error, see above). A browser. The three phone checks. A 2,000-door paint. A phone. Point count not tested. No device.
- **External settings:** none
- **Open questions for Claude:** Should `scripts/verify-stage-5b-r3.ts` line 349 pass `multiUnit` and `nccz`, or should those fields be optional on `KnockableCount`? `scripts/verify-stage-4.ts` still calls `count_knockable`. A3c is still to come.

### 2026-10-04 — UI-6 Session B1 (uncommitted)

- **Item:** UI-6 — mini map rotate and recentre (P2.2)
- **What changed:** The compact map keeps pan and pinch, and now allows two-finger rotate and desktop right-drag. Pitch is not a gesture. Keyboard stays off. A recentre button appears only after a camera move that carries an `originalEvent`. Tap eases to the current door at the compact zoom with bearing 0, then the button hides. Changing door still eases and hides the button, and does not force bearing.
- **Files:**
  - Changed: `components/field/icons.tsx`, `components/field/field-map.tsx`, `components/field/mini-map.tsx`, `docs/FIELD-TEST-BUILD-PLAN.md` (UI-6 B1 row only), `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: none
  - Deleted: none
- **Database:** none
- **Shared modules touched:** none
- **Decided by:**
  - owner — P2.2 (field test 2026-10-03): the mini map gets one-finger pan, pinch zoom, two-finger rotate, and a clear recentre control after manual exploring. The GPS arrow comes later (UI-7).
  - owner — 2026-10-04: the plan is approved (Claude's design below).
  - Claude — compact rotation is on (two-finger twist, plus right-drag on desktop). Pitch gesture and keyboard stay off. 3D pitch is set in code.
  - Claude — the recentre button appears only after the canvasser moves the map (a camera move with an `originalEvent`). Tap eases back to the current door at the compact zoom, north-up (bearing 0), and the button hides.
  - Claude — moving to another door still re-centres and hides the button. That ease keeps the current bearing.
  - Claude — the button is 44px, round, bottom-right. New `LocateIcon`. The open-full-map button stays bottom-left. The 2D/3D toggle stays top-right.
- **Deviations from plan or brief:** none
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not edited. Coverage is still derived.
- **Verified:** `npx tsc --noEmit` exit 0. eslint on `components/field/field-map.tsx`, `components/field/mini-map.tsx` and `components/field/icons.tsx` exit 0. `npm run verify:ui1` exit 0. `npm run verify:anchors` exit 0 (2,000 doors / 60 steps, 3.71 ms). `git grep` for `disableRotation` and `dragRotate.disable` in `field-map.tsx`: no lines. `git grep` for a 6-digit hex colour in `field-map.tsx`: no lines.
- **Not verified:** A browser. A phone. The four phone checks (rotate, pinch, pan, recentre, next-door hide, door swipe, Map tab). A painted map at 2,000 doors. Sun, wet thumb, one-handed use. The anchor timing is not a paint of this gesture.
- **External settings:** none
- **Open questions for Claude:** none

### 2026-10-04 — UI-6 Session B2a (uncommitted)

- **Item:** UI-6 — Survey Overview rows (P2.1, data only)
- **What changed:** `surveyRows` builds the Survey Overview as plain data. Knockable doors stay in route order. A street header is added when the street changes. Address text is the house number, else the building name, else `<street> · door N`. The code is this device's latest local outcome. A teammate knock with no local outcome leaves the code empty and keeps the first name. `npm run verify:ui6` checks it. No React.
- **Files:**
  - Changed: `package.json` (one script, `verify:ui6`), `docs/FIELD-TEST-BUILD-PLAN.md` (UI-6 B2 Result only), `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: `lib/field/survey-rows.ts`, `scripts/verify-ui-6-survey.ts`
  - Deleted: none
- **Database:** none
- **Shared modules touched:** new `lib/field/survey-rows.ts` (pure row builder; no Dexie, no network). `lib/sync/queue.ts`, `lib/map/route-layers.ts`, `lib/geo/walk/*` and `lib/supabase/*` were not edited.
- **Decided by:**
  - owner — B2-1 (2026-10-04): the Survey Overview is a second Logger view, switched by small scrollable pills under the prop name and visit line.
  - owner — B2-2 (2026-10-04): tapping a row jumps to that door in Logging. No logging from the table.
  - owner — B2-3 (2026-10-04): the outcome column is a short code in the outcome colour: L Lead, C Contact, R Rented/Council, NI Not In, O Other. Empty (to knock) shows a dashed empty pill.
  - owner — B2-4 (2026-10-04): a door with no address reads `<street> · door N`, where N is its 1-based place in the Logger's list.
  - Claude — this session is the pure function and the check script only. B2b draws it.
  - Claude — rows are the Logger sequence, knockable doors only, in route order, with a street header when the street changes.
  - Claude — street is the route step's street, else the address street, else `Unnamed road`.
  - Claude — address text is house number plus street, else building name plus street, else the B2-4 fallback.
  - Claude — the code is this device's latest local outcome. A teammate knock without a local outcome is still to knock, with `knockedBy` set. The code stays empty.
  - Claude — `not_interested` maps to O.
  - Claude — type imports only from Dexie-backed modules, so `tsx` can run the check with no browser.
- **Deviations from plan or brief:** none
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not edited. Coverage is still derived. No database row. No `client_event_id`.
- **Verified:** `npx tsc --noEmit` exit 0. eslint on `lib/field/survey-rows.ts` and `scripts/verify-ui-6-survey.ts` exit 0. `npm run verify:ui6` exit 0 (lead L, answered C, no_opportunity R, no_answer NI, refused/do_not_call/inaccessible/callback/not_interested O; "12 Coronation Road"; "Rosebank House, Coronation Road"; "Coronation Road · door 5"; route street wins; five doors give headers A, B, A and indexes 0..4; current only at index 2; local outcome clears the teammate name; summary 3 knocked, 2 to go).
- **Not verified:** A browser. A phone. The pills, the table, and tap-to-jump. Those are B2b.
- **External settings:** none
- **Open questions for Claude:** none

### 2026-10-04 — UI-6 Session B2b (uncommitted)

- **Item:** UI-6 — Logger view pills and Survey Overview (P2.1)
- **What changed:** The Logger header now has scrollable `Logging` and `Survey` pills under the prop name and the visit line. Survey replaces the door panel, stats, mini map and note bar with a fixed-height list of `surveyRows`. Tapping a row returns to Logging on that door. The view is remembered in `sessionStorage` for the tab session.
- **Files:**
  - Changed: `components/field/logger-tab.tsx`, `docs/FIELD-TEST-BUILD-PLAN.md` (UI-6 B2 row only), `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`
  - New: `components/field/ui/view-tabs.tsx`, `components/field/survey-overview.tsx`
  - Deleted: none
- **Database:** none
- **Shared modules touched:** none. `lib/field/survey-rows.ts` is read, not edited. `lib/sync/queue.ts`, `lib/map/route-layers.ts`, `lib/geo/walk/*` and `lib/supabase/*` were not edited.
- **Decided by:**
  - owner — B2-1 (revised, 2026-10-04): the Logger's views are small scrollable pills (`Logging`, `Survey`) under the prop name and the visit line. More views may be added later; the row scrolls sideways.
  - owner — B2-2 (2026-10-04): tapping a row switches to Logging on that door. No logging from the table.
  - owner — B2-3 (2026-10-04): code chips L / C / R / NI / O in the outcome colours. A dashed empty pill means still to knock.
  - owner — B2-4 (2026-10-04): no address reads `<street> · door N` (built in B2a).
  - Claude — each pill looks 28px tall, but the button is 44px. The row uses `-my-2` so the header only grows by the pill height.
  - Claude — the chosen view is remembered per tab session in `sessionStorage`, wrapped in try/catch. Failure stays on Logging.
  - Claude — in Survey view the door panel, stats, mini map and note bar are replaced by the list. Header, team strip and sheets stay.
  - Claude — the list draws only the rows on screen. Fixed heights: door 48px, street 32px, a 900px window plus 8 rows overscan. No measuring and no setState inside effects. No new dependency. A street label pinned at the top shows the street of the first visible row.
  - Claude — on opening Survey, the list scrolls so the current door is near the top third.
  - Claude — colours are tokens only. The current door uses `bg-prop/10` and a 4px `border-prop` left bar.
- **Deviations from plan or brief:** The pasted blocks were not rewritten. The existing route-door local `view` was renamed to `routeDoor`. The first `tsc` failed with TS2451 (redeclare `view`) and then TS2339 (`cards` and `routeStreet` missing on `LoggerView`). After the rename, `tsc` exited 0. `routeStreet` is present on the route door.
- **Invariants:** No GPS and no coordinates. No quality scoring in `/field`. No field write. `lib/sync/queue.ts` was not edited. Coverage is still derived. No database row. No `client_event_id`.
- **Verified:** `npx tsc --noEmit` exit 0. eslint on `components/field/ui/view-tabs.tsx`, `components/field/survey-overview.tsx` and `components/field/logger-tab.tsx` exit 0 (inline `style` and the `rowAt` non-null assertions were accepted). `npm run verify:ui1` exit 0. `npm run verify:ui6` exit 0. `git grep` for a 6-digit hex colour in the two new files: no lines. `git grep` for `localStorage` in `logger-tab.tsx`: no lines.
- **Not verified:** A browser. A phone. The seven phone checks in the brief (pills, Survey list, fast scroll, tap-to-jump, offline code, addressless label, dark mode). Sun, wet thumb, one-handed use.
- **External settings:** none
- **Open questions for Claude:** none



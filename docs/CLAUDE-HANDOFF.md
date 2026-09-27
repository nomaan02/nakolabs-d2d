# Claude handoff log

## Current state

- Last updated: 2026-09-27 (Session B2), last commit: af0d7a5 (HEAD). Session B2 is uncommitted on top of Sessions A, A2, A3, A4, B and UI item 4.
- Session B2 re-saved REF - Speedwell, TEST - dry run and Northville, and re-froze two open zero-knock assignments. `c14aa0d1` (TEST - dry run, 28 Sept, visit 1, `best`): `route_steps` 29, min id 6439 → 6949. `3cdbb911` (Northville, 27 Sept, visit 2, `best_reversed`): 396, min id 6468 → 6978. Territory row counts stayed 6/106, 5/178 and 6/2450.
- Not re-frozen: `0de4d001` (REF - Speedwell, 49 knocks, closed reallocated, min id 6422, 17 steps) and `0c32a933` (TEST - dry run, 0 knocks, closed reallocated, min id 6393, 29 steps).
- The 22 r1 Turns problems are an accepted pinned limit (Lower Redland Mews and Fourth Avenue). r1 was not edited. r2's redland visit check now derives the next visit from Stage 5c-a. On this data that is 2, and the new allocation got 2. The test row was deleted.
- G1 PASS. G2 live exit 1 is still only the pinned Northville 6. r1, r2, r3, 5bb and ui4 all exited 0.
- Browser: CanvasserX, online, assignment `c14aa0d1`. Before the write, `route_fp` was `steps:6439` and `route_for` was `2026-09-27T18:20:01.568Z`. After the re-freeze, `route_fp` was `steps:6949`, `route_for` was `2026-09-27T18:22:07.614Z`, and the full step query ran. `/field` was not used: London today is 27 Sept, and that assignment is 28 Sept. Offline reopen was not run.
- Pinned known issue, still not fixed: Filton Road / Eden Grove `chain: -1` transfer. The 22 turn-end problems are now a separate accepted limit for the route-planner edge-cases item.
- Open questions for Claude (UI item 4, carried): Realtime "Allow public access" is still on. The six agent decisions for that item are not yet accepted or rejected.
- Unverified: G6 zoom-19 corner; draw-page "Loading the map…" check; offline reopen of `c14aa0d1` on a phone after deploy. UI item 4's carried unverified items remain.
- Changed shared modules since handover: `lib/geo/walk/*` (A–A3, plus `save.ts` in Session B). This session did not change `geometry.ts`, `steps.ts`, `validate.ts`, `types.ts` or `scripts/verify-route-geom.ts`. `lib/sync/queue.ts` and `lib/supabase/*` were not changed.
- External settings changed since handover: none. Password, profile and role were not changed. Sessions created this session were signed out locally.

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

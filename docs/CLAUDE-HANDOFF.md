# Claude handoff log

## Current state

- Last updated: 2026-09-29 (UI item 1, Session C — the Logger rebuild is now feature-complete and assembled). Last commit: cc30407 (HEAD). Everything on top of HEAD is still uncommitted: the route-geometry work (A–B2, A4 reverted), UI item 4, and all four UI item 1 sessions (plan approval, A, B1, B2, C). **The owner commits after review — this session did not commit.**
- **UI item 1, Session C (this session) assembled the whole Logger.** `logger-tab.tsx` is now the full composer built from every earlier session's pieces: header (eyebrow, territory name, `IdChip`, the short Area line), `TeamStrip`, a compact live `MiniMap` with a single banner slot (`computeBanner`, priority Failed > Instruction > Offline/Pending > Info), the real `DoorScroll` + new `OutcomeColumn` (Lead/Contact/Rented-Council/Not In then Other, confirmed top-to-bottom against the Figma screenshot), Today's stats, an "Already logged" pill, an `allDone` end-of-prop state, and `NoteBar`. New files: `components/field/mini-map.tsx` (wraps `FieldMap` with a new `variant="compact"` — no Nav/Scale control, not interactive, `jumpTo` at a new `COMPACT_ZOOM` 17.5, a prop-blue halo on the existing `selected` state, a tap button that opens the Map tab) and `components/field/outcome-column.tsx`.
- **Two bugs found and fixed during assembly** (full reasoning in the BUILD-LOG entry): (1) Sora had never actually applied anywhere in `/field` since Session B1 — `app/globals.css`'s `@theme inline { --font-field: ...; }` never emitted a working `:root` custom property (confirmed live: empty string), so every field screen was rendering in Instrument Sans. Fixed by dropping the indirection — `.field-root` now sets the three font roles directly to `var(--font-sora), ...`. (2) Once Sora's real (wider) glyph metrics applied, `DoorScroll`'s current-door digits clipped to an ellipsis once assembled next to the pills — the pills' reserved flex width was cut from 140px to 92px (a fixed slot for the 84px circle only, with the tail overflowing on purpose, matching Figma's own "clipped at the screen edge" description), and `door-scroll.tsx`'s current item now renders at natural width instead of `max-w-full`+`truncate` (neighbours keep the truncate safety net).
- **Full acceptance list, all PASS** (evidence and exact numbers in the BUILD-LOG entry): `tsc`/`eslint` exit 0; `verify:stage8b`/`verify:stage10`/`verify:ui4`/`verify:ui1` all exit 0; screenshots vs Figma at 390/375/430 plus the two sanity sizes; a live two-throwaway-canvasser (Ada, Tom) team test proving A1 (forward-wrap), B1 (greyed + "✓ name" tag) and C1 (`"Ada · last knocked #43"`, live, no reload) end to end through the real rebuilt UI; a second-session Realtime listener showing `claim=0`/`release=0`; an offline log→queue→sync test giving exactly 1 `knock_events` row; the amendment 4 Sync failed trigger proved BOTH at the script level (delete a member's `assignment_members` row, `sendOp` returns `permanent`/`42501`, 0 rows) AND live in the browser (the banner, IdChip red, the row excluded from stats); `document.querySelectorAll('.maplibregl-map').length` staying at 1 through Map→Logger→Map→Logger; a temporary 2,000-door page proving ≤17 `DoorScroll` nodes and exactly 1 `jumpTo` per settle; and a React `Profiler` check (temporary, removed after) proving `DoorScroll`/`MiniMap` cost under 1ms per commit despite `use-team.ts`'s 1s tick still firing — one real memoisation bug (an inline `onAddHouseNumber` arrow) was found and fixed as part of that check.
- **Not done / deferred by Session C, explicitly:** the map-band scroll-shrink height ladder (P11, 124px→72px) — the band is a static 124px; `EndOfProp`'s exact copy/layout is this session's own reading of the plan text, no Figma screenshot spent on it; the Turn instruction banner's exact wording was not exercised against a real routed fixture (the throwaway test prop had no frozen route); `prefers-reduced-motion`/screen-reader/keyboard-only checks at the composed-screen level (all unit-tested inside their own components in Session B2, not re-tested here). **No phone was used anywhere in this session** — every check ran in desktop Chrome with CDP device-metrics emulation, which the field-ergonomics skill is explicit is not equivalent evidence.
- All UI item 1 sessions' throwaway data (auth users, profiles, territories, knock_events) confirmed deleted after every verify run and after this session's own two extra fixtures (a duo + a solo canvasser), checked directly against the live project. `realtime.messages` for the test topic: `0` (broadcast messages are not persisted to that table — consistent with UI item 4's own finding). Nothing was ever deleted from `realtime.*`.
- Carried from the route-geometry work (unrelated to UI item 1): the 22 r1 Turns problems are an accepted pinned limit (Lower Redland Mews and Fourth Avenue); the Filton Road / Eden Grove `chain: -1` transfer is a separate, still-unfixed traversal item; REF - Speedwell / TEST - dry run / Northville were re-saved and two open zero-knock assignments (`c14aa0d1`, `3cdbb911`) re-frozen in Session B2, with `0de4d001` and `0c32a933` left un-refrozen.
- Carried from UI item 4: Realtime "Allow public access" is still on; its six agent decisions are not yet accepted or rejected; G6 zoom-19 corner, the draw-page "Loading the map…" check, and an offline reopen on a phone after deploy remain unverified.
- Changed shared modules since HEAD: `lib/field/door-signals.ts`, `lib/field/use-team.ts`, `lib/field/cursor.ts` (Session A, claims removal); `lib/field/other-gesture.ts`, `lib/field/door-window.ts` (Session B2, pure, no I/O, unchanged since); `components/field/field-map.tsx` (Session C, added the `variant` prop and a `dataset.cameraJumps` counter — the existing "full" behaviour is byte-for-byte unchanged, only new `compact` branches were added); `app/globals.css` (Session C, the Sora fix — additive/corrective only, no admin token name or value changed). `lib/sync/queue.ts` and `lib/supabase/*` are unchanged throughout every UI item 1 session. `lib/geo/walk/*` and `lib/map/route-layers.ts` are unchanged (last touched by the route-geometry work above).
- Open questions for the owner: whether the map-band scroll-shrink ladder (P11) is worth building given no acceptance item tests it; whether `EndOfProp` should be checked against Figma directly; the admin-Contacts label reconciliation (Session A) is still open for the admin rebuild; the ~8-door-per-scroll fling limit (Session B2) is still unanswered; **the whole Logger rebuild needs an on-device pass (sun, one hand, wet thumb, haptics) before it can be called field-ergonomics-verified — none of that ran this session.**
- External settings changed since handover: none. Every throwaway session created by a verify run or by this session's manual browser testing was deleted (not merely signed out) by its own script's cleanup, confirmed against the live project.

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

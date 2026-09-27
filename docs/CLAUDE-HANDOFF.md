# Claude handoff log

## Current state

- Last updated: 2026-09-27, last commit: e7dd51a015f700fbfc39ca001d47acee49897dab
- UI item 4 (route line focus styling) is implemented and uncommitted. The throwaway fixture was removed in the same session.
- Latest migration: 023 `023_stage_10_realtime_auth.sql`. This item added no migration and no Dexie version bump.
- Open questions for Claude: Realtime "Allow public access" is still on. `private_only` was not set. The six agent decisions for this item are not yet accepted or rejected by the owner.
- Unverified items:
  - A chevron on the 54.1 m Ventnor leg at zoom 17. Spacing was not changed.
  - Draw-page Generate preview and variant dimming.
  - A production-build reload while offline.
  - On-device checks in direct sun, one-handed, with a wet thumb. Haptics in headless Chrome were blocked (`navigator.vibrate`).
  - A 2,000-door pass.
  - Carried from Stage 10: a live socket drop, full airplane mode, the lock-screen widget.
- Changed shared modules since handover:
  - `lib/map/route-layers.ts` — the one route renderer. Tier colours, chevron runs, START/END badges. Crossing dots removed.
  - `lib/field/route-display.ts` — passes street and sequence into the paint model. `plateStreet` moved to `lib/map/street-name.ts`.
  - `lib/sync/queue.ts`, `lib/geo/walk/*`, `lib/supabase/*` — none.
- External settings changed since handover: none. No MapTiler change. No Vercel env change. Realtime "Allow public access" left on.

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

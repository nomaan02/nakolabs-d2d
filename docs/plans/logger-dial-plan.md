# Logger V2.1: the radial dial (DIAL-1)

Claude, 2026-11-19. Base commit bed05e5. Design: Figma `EHxBRxJZGVAU1MuSU59RTH`, page "Logger V2 — Radial dial" (310:289), section "Logger V2.1 — polish" (324:810).

This is the build plan behind sessions `dial-1a`, `dial-1b` and `dial-1c` in `.handoff/queue/`. The code in those prompts is final: Claude wrote it, type-checked it, linted it, ran it and drove it in a browser. Grok pastes it. This file explains how it works, so a reviewer or a later session can change it safely.

## 1. What changes for the canvasser

- The Logger's logging view swaps the outcome buttons down the right edge for one dial at the bottom of the screen, in thumb reach.
- Press the dark middle and slide towards an outcome, then lift. Or tap the outcome's label. A quick tap on the middle opens Other.
- Up is Contact, right is Lead, down is Not in, left is Rented / council.
- After a log the dial confirms it on the spot (ring sweep and a check), then a dark toast says what happened and offers Undo for 60 seconds.
- You → Outcomes → Dial / Buttons. The dial is the default; Buttons brings back the V1 screen exactly. The choice is saved on the phone, per canvasser.
- Survey view, the header, the tab bar, sheets, sync and the data are unchanged.

## 2. Sessions

| Session | Files | On screen after it |
|---|---|---|
| dial-1a | `app/globals.css`, `components/field/icons.tsx`, new `lib/field/dial-gesture.ts`, new `lib/field/logger-style.ts`, `lib/field/undo.ts` | Nothing |
| dial-1b | new `components/field/ui/outcome-dial.tsx`, `log-toast.tsx`, `note-button.tsx`, `stats-rail.tsx`, new `components/field/logger-dial-body.tsx` | Nothing (not imported yet) |
| dial-1c | `components/field/logger-tab.tsx`, `components/field/profile-tab.tsx`, new `scripts/verify-dial.ts`, `package.json` | The dial is live |

Each session type-checks on its own (checked: tsc 0 after 1a, after 1a+1b, after all three). dial-1c has `gate: human`, so the runner stops for the owner after it.

## 3. Component map (Figma → code)

| Figma | Code |
|---|---|
| Logger V2.1 / Rest (331:935), whole body | `LoggerDialBody` in `components/field/logger-dial-body.tsx` |
| Glance zone: MiniMapCard + status line | `map` and `banner` slots; existing `MemoMiniMap` and `StatusBanner` |
| Focus zone: door, door line, NoteButton | `door` slot (existing `MemoDoorScroll` / `EndOfProp`), `doorLine` slot, `NoteButton` |
| Dock (surface, 24 top radius, border-top) | the `data-dial-dock` div |
| StatsRail 2.1 | `StatsRail` |
| OutcomeDial 2.1 (Rest, Pressed, Dragging·Dir, Tap·Dir, Logged) | `OutcomeDial`; one component, `data-phase` shows the variant |
| LogToast 2.1 (Sent, Queued) | `LogToast`, driven by the undo target |
| NoteButton (Empty, Draft) | `NoteButton` |
| V2 line icons (310:293 … 324:814) | `StarLineIcon`, `MessageLineIcon`, `DoorLineIcon`, `KeyLineIcon`, `PencilLineIcon`, `UndoLineIcon`, `CheckLineIcon`, `QueuedLineIcon`; exact path data |

Layout, top to bottom, in a column that fills the tab:

1. Live `FieldHeader` (unchanged), wrapped so a scrim can sit on it while the dial is pressed.
2. Upper area (`flex-1`, scrolls only if it must): glance (map card `flex-1`, min 64; status line 40) then focus (door line overlay at the top, the door, the note button at top 26 / right 16).
3. Dock (`shrink-0`): stats rail 40 tall, toast overlay on top of it, the dial centred, 16 above and 12 below.
4. Live tab bar. Its top border is hidden when a dock is on screen (`.field-root:has([data-dial-dock])`), so the dock's border is the only seam.

Measured in Chrome with Sora: at 390×763 header 97, map 94, status 40, focus 154, dock 309, dial 224 at y 470, tabs 57, no scroll. At 375×667 the compact tier kicks in (map 50, dock 257, dial 184), no scroll. At 430×850 the map grows to 181.

## 4. The gesture (`lib/field/dial-gesture.ts`)

A pure reducer, `dialGesture(state, event) → { state, effects }`, same pattern as `lib/field/other-gesture.ts`. No DOM, no React, no timers; time comes in on the events. The component turns pointer events into events, and effects into actions.

Coordinates are dial units: the 224 box, centre (112, 112), whatever the on-screen scale. The component divides by `rect.width / 224`.

States:

| State | Meaning |
|---|---|
| `idle` | Nothing pressed |
| `puck` | The middle is pressed. Keeps the pointer id, start point and time, the current `target` (a direction or null), `left` (has the finger ever left the dead zone) and `travel` (furthest distance) |
| `wedge` | A label is pressed. Keeps the pointer id, start point, its `dir`, and `armed` (still a tap) |

Hit test on `down` (`hitAt`): within 36 of centre is the puck; within 112 is a wedge (by angle); outside is nothing.

Rules:

| Event | From | Result |
|---|---|---|
| down on puck | idle | → `puck`; effects: capture pointer, pulse 15 ms |
| move | puck | distance > 24 sets `target = directionAt(angle, target)`, `left = true`; a new target pulses 8 ms. Distance ≤ 24 clears the target |
| up | puck | target set → commit(target). Else, if never left, travel ≤ 12 and held ≤ 350 ms → openOther. Else nothing |
| down on wedge | idle | → `wedge` armed; capture, pulse 8 ms |
| move > 12 | wedge | disarm (a slide off a label is not a tap) |
| up | wedge | armed → commit(dir); else nothing |
| cancel (pointercancel, lostpointercapture, hidden, blur, escape, disabled) | any | → idle, nothing logged. A pointer cancel for another pointer id is ignored |
| down / move / up from another pointer | puck or wedge | ignored |

Direction with hysteresis (`directionAt`): the plain wedges are right −45…45°, down 45…135°, up −135…−45°, left the rest. Once a target is held, a new one needs the angle 10° past the shared edge, so a thumb on the diagonal does not flicker.

`dialPhase(state)` gives the visual phase: `rest`, `pressed` (puck, no target), `choosing` (puck with a target), `tap` (wedge armed).

`DIAL_OUTCOME` maps up → `answered`, right → `lead`, down → `no_answer`, left → `no_opportunity`.

## 5. The dial (`components/field/ui/outcome-dial.tsx`)

Props: `onPick(outcome)`, `onOther(outcome)`, `logged` (`{ key, tone, label }`, a new key plays the logged frame), `disabled`, `onActiveChange(active)`, `onLoggedChange(playing)`.

Structure:

- Outer `relative` light island. A sizer div `calc(224px * var(--dial-scale, 1))` square holds the layout space. Inside it a 224 box, `transform: scale(var(--dial-scale, 1))` from the top left, takes the pointer events (`touch-none select-none`).
- One SVG: the face (r92, field-bg), four divider lines on the diagonals (r44–90; 0.4 opacity at rest, 0.6 pressed, hidden while choosing), four arcs, the logged ring.
- Arcs are circles r98 with `pathLength=360`, dash `74 286` and a dash offset per direction (start angles −127, −37, 53, 143). Stroke width is twice the visual width, clipped by a r98 clip path, so the arc grows inwards only: 6 rest, 10 pressed, 14 target. Non-target arcs fade to 0.4 while choosing.
- Four label buttons centred at 64 from the middle, icon 20 (stroke 1.75) over the word; 44 minimum target. The choosing target's label hides (the readout says it); the others go to ink-muted.
- Halo 88 behind the puck (0.08 while pressed). A drag trail, a 72×88 capsule rotated to the target, 0.3 while choosing.
- Puck 72 (68 while pressed), `--color-puck`, `--shadow-field-puck` (pressed variant while pressed), inner hairline ring, three dots. While choosing it moves 16 towards the target.
- Readout pill 28 above the box: "Release · Lead" while choosing or tapping, "Logged · Lead" in the logged frame, with the outcome icon or a check.
- Other menu: a fixed 220-wide menu above the puck with a transparent scrim; first row focused, arrow keys, Escape closes and returns focus to the puck.

Logged frame (on a new `logged.key`): ring in the outcome colour sweeps from the outcome's side (dash offset 360 → 0, 320 ms), puck fills in the outcome colour and draws a check (260 ms), readout "Logged · X". Holds 900 ms, fades 200 ms. When the sweep ends the ring's dash is removed, so no hairline is left at the seam. Any new press clears the frame.

Safety: window `visibilitychange`, `blur` and Escape cancel a press. `disabled` (a sheet is open) cancels. Label `onClick` only acts for keyboard clicks (`event.detail === 0`); pointer taps on labels go through the state machine, so a tap is never logged twice.

## 6. Motion

| What | Duration | Easing |
|---|---|---|
| Arc width and opacity, label state, dividers | 120 ms | cubic-bezier(0.2, 0.8, 0.2, 1) |
| Puck size, travel and shadow | 140 ms | same |
| Header and glance scrims, stats fade | 160 ms | same |
| Logged ring sweep | 320 ms | same |
| Check draw | 260 ms | same |
| Logged hold, then fade | 900 ms, 200 ms | same |
| Toast in (opacity, 8px rise) | 220 ms | same |
| Toast out (opacity, 4px) | 160 ms | same |
| Toast countdown bar | the rest of the 60 s | linear |

Only `opacity`, `transform`, stroke width and dash offset animate. Reduced motion: no sweep (ring shows full), no check draw, no rise on the toast (opacity only), 700 ms hold.

Haptics use the existing `pulse`: 15 ms on press, 8 ms on each new target, 25 ms on Undo.

## 7. Toast and undo

- `offerUndo` gains an optional fourth argument, `{ title, detail, tone }`. Old callers are unchanged; the V1 undo ring still reads `description`.
- The Logger fills it on every log: "Door 71 logged" / "Lead · now on 73" (or "· last door"); with filled doors "Not in + 3 Not in"; offline "Door 71 saved offline" / "Lead · waiting to send" and tone `queued`. Bulk infer: "5 doors marked Not in" / street. Note correction: "Note added" / "Door 71".
- `LogToast` shows the current undo target over the stats rail. It stays hidden while the dial is pressed and while the logged frame plays (`settling`), so it never covers the readout, then slides in. Its countdown starts at the log, not when it appears.

## 8. Tokens added (`app/globals.css`)

| Token | Value | Use |
|---|---|---|
| `--color-puck` | #303337 | Puck |
| `--color-on-ink-muted` | white 62% | Toast detail, puck dots |
| `--color-on-ink-wash` / `-strong` | white 12% / 24% | Undo button, queued badge, puck ring |
| `--color-scrim-focus` | #f4f5f7 at 55% (dark: #161a20 at 55%) | Header and glance dim |
| `--radius-field-xl` | 24px | Dock top corners |
| `--shadow-field-float` | 0 6 16 −4 rgb(28 34 38 / .18) | Toast, readout |
| `--shadow-field-puck` / `-pressed` | from Figma | Puck |
| `--text-field-caption`, `-caption-xs`, `-stat-compact`, `-detail` | 11/14, 10/12, 17/20 600, 12/16 | Stats, sub-labels, toast |

Everything else reuses existing tokens (`outcome-*`, `ink*`, `line`, `surface`, `field-bg`, `prop`).

## 9. Where the build differs from the Figma (owner to confirm)

1. Door number: the live `DoorScroll` (88px plate, neighbours hidden at rest). Figma shows 112 with 69 and 73 visible. At 112 the map card would collapse on a 390×763 phone. A later session can grow it if the owner wants.
2. Header and tab bar: live components, 16px margins (Figma 20).
3. Lead ink: `outcome-lead-ink` #185a30 for the Lead label, readout and logged puck (Figma #1e6b3a), for 7:1 contrast on the light face.
4. Stats show "04" (Figma); this overrides the earlier FUI "no zero padding" call.
5. No GPS-lost banner: there is no app state for it yet; the map's weak-fix marker already covers it.
6. The note draft dot is new.
7. In dial mode the toast replaces the undo ring.
8. The dial and toast stay light in dark mode, like the outcome pills.

## 10. Testing done

- `tsc --noEmit` 0, `eslint` 0 on every touched file.
- `npm run verify:dial` (new): direction mapping, geometry and hysteresis, hit tests, a drag each way, the dead zone, drag back to cancel, change of direction, diagonal wobble, puck tap → Other, long hold and small slide do nothing, every cancel reason, a second pointer, a non-primary pointer, outside the ring, label tap and disarm, stat formatting, and source rules (the dial never imports the sync layer or Supabase, honours reduced motion, is a light island; the Logger still has `logOutcome`, `<OutcomeColumn` and `<LoggerDialBody`; the default style is dial).
- `verify:ui1`, `ui6`, `ui7`, `ui8`, `gl` still pass.
- Driven in Chrome (Playwright, Sora, a test page with fake doors) at 390×763, 375×667, 430×850: rest, pressed, drag to each direction, tap on a label, the logged frame then the toast, offline queued, empty start, dark, the Other menu (pointer and keyboard), reduced motion. The test page is not part of the prompts.
- The prompts were generated from the tested files, then parsed back the way an executor reads them and applied to a clean checkout of bed05e5. Every file came out byte for byte the same as the tested tree.

Not tested: the full Logger against real Supabase data, a real phone, iOS Safari's pointer handling. The phone check at the end of `03-dial-1c.md` covers these.

## 11. Rolling back

- One phone: You → Outcomes → Buttons.
- Everyone: change the default in `lib/field/logger-style.ts` (`"dial"` → `"buttons"`). The V1 body is untouched, so this is a one-word change.

## 12. Running it

Queue runner (headless, one session at a time, stops after dial-1c for review):

```powershell
.\scripts\agent\run-queue.ps1 -Batch dial-1 -DryRun
.\scripts\agent\run-queue.ps1 -Batch dial-1
```

Or paste the Cursor prompt from the chat into Grok in Cursor, once per session.

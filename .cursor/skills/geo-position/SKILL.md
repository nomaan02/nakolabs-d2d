---
name: geo-position
description: GPS, compass, the "you" arrow, route snapping, the near-you chip and live position sharing in /field and the admin live panel. Use for anything that reads navigator.geolocation or DeviceOrientation, or sends or shows a position.
---

# Geo position (UI-7, owner decisions H3, H5, U7-1..U7-5)

Read the brief's invariant 7, Section 8 and Stage 16 amendments (2026-10-04) first.

## Where things live

- `lib/field/geo.ts` - pure maths only (snap, along-route, hysteresis, send throttle, heading). No React, no browser APIs. Checked by `npm run verify:ui7`.
- `components/field/geo-provider.tsx` - the ONE `watchPosition` and the ONE orientation listener for the whole field shell. Nothing else calls `navigator.geolocation`.
- `lib/field/use-route-position.ts` - snaps fixes to the route on the device (scalar metres).
- `lib/field/position-share.ts` - the ONLY code that sends a position (`report_position`, `stop_sharing_position`).
- Admin: `components/admin/live-panel.tsx` reads `admin_live_positions()`.

## Rules

- `watchPosition` runs only while `document.visibilityState === "visible"`. Clear the watch on hidden; restart on visible. No background collection, no service-worker geolocation.
- High accuracy on. Fixes with accuracy worse than 30 m are "weak": grey dot, dashed ring, no heading cone, never used for recentre or the chip.
- Never store a coordinate: not in Dexie, localStorage, sessionStorage, the outbox, a log line or an error report. Only React state in memory.
- Only `lib/field/position-share.ts` may put a coordinate in a network request. Every other payload must stay coordinate-free.
- Never add a positions history table or an append-only insert "for debugging". Updates are in place, one row per canvasser.
- Off the route (more than 100 m) the scalar is null. The admin position still goes (U7-3).
- iOS compass: `DeviceOrientationEvent.requestPermission()` must be called inside a tap handler (the recentre and locate buttons). Never on load.
- Heading priority: compass (`webkitCompassHeading`, or `360 - alpha` from `deviceorientationabsolute`), else GPS `coords.heading` when speed is above 0.5 m/s, else none.
- The Logger cursor never moves on its own. The near-you chip suggests; the canvasser taps.
- Location denied or unavailable: everything works as before, with a quiet "Location off" pill. No error banners, no retry loops.
- Map colours for the marker come from `lib/map/map-palette.ts` (`MAP_UI.*.you*`). Violet is "you" and is never an outcome colour.
- MapLibre: gate updates on `getSource(...)`, never `isStyleLoaded()`. A user move is a `movestart` with an `originalEvent`.

## Before finishing

- `git grep -n "navigator.geolocation"` returns only `components/field/geo-provider.tsx`.
- `git grep -n "report_position\|stop_sharing_position" -- components lib` returns only `lib/field/position-share.ts` (and generated types).

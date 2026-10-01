---
name: map-layer
description: Add or modify a MapLibre GL layer, source or interaction. Use for anything touching the map — markers, polygons, route lines, coverage styling, drawing tools.
---

# Map layers

## Setup that is already decided
- MapLibre GL JS with MapTiler tiles. Never OSM public tile servers.
- Terra Draw for polygon drawing.
- Key from `NEXT_PUBLIC_MAPTILER_KEY`.

## Rules
- Spatial filtering and counting happen in Postgres via RPC. Never fetch points to the client to count them.
- Coverage styling uses MapLibre `feature-state`, driven by knock events. Do not bake coverage into the source data.
- A prop can hold 2,000+ points. Test any new layer at that size on a mid-range phone before calling it done.
- Cached offline data comes from Dexie, not from a refetch. A map screen must render with no network.
- Attribution for OS and OpenStreetMap must remain visible. Do not remove it to tidy the UI.
- Address labels render in a SEPARATE MapLibre symbol layer above the circle layer, with minzoom 18. Never add text to the circle layer and never render labels at all zooms: symbol collision detection at 2,000 points will break the Stage 14 performance acceptance. Circles render at every zoom; text only appears close in. If the Dexie addresses store is empty or absent, the symbol layer renders nothing and the circle layer is unaffected — fail open.

## Before finishing
State the point count you tested at and the device you tested on.


## MapLibre gotchas found in this repo

**`["zoom"]` cannot nest inside `*`, `case` or `match`.**
MapLibre throws: "zoom expression may only be used as input to a top-level
step or interpolate". The layer fails to paint entirely — no error in the UI,
just no dots. Put the zoom interpolate at the TOP level and the outcome
match/case inside each stop, not the other way round. Found in Stage 8b:
field-doors rendered nothing.

**Feature-state must be applied on `style.load`, not only in a React effect.**
An effect that returns early when the style isn't ready leaves every feature
looking default after a tab remount, even when the data is correct in Dexie.
Apply state in BOTH places. Found in Stage 8b: outcome colour vanished on
Map-tab remount. Stage 14's coverage map uses the same mechanism.

UI item 2 map facts (2026-10-01)
Colours: every map paint colour lives in lib/map/map-palette.ts (MAP_PALETTE, OUTCOME_DOT, OUTCOME_TINT). MapLibre cannot read CSS variables. No other map file defines a new hex value.
Basemap: the MapTiler style is fetched as JSON and passed through restyleBasemap() (lib/map/restyle-basemap.ts), which matches layers by source-layer and type, not by layer id. The basemap's own fill-extrusion layers are hidden; we add our own.
Door dots are drawn at ANCHORED points (lib/map/door-anchors.ts): each door is projected onto its work step's walkline, in sequence order, at least 2.5 m apart. This is display geometry only. Never use an anchored coordinate for a write, the sequence, routing, coverage counts or the UPRN. Doors with no work step keep their own point.
Buildings: door_footprints (one slice per door, Voronoi-split terraces; shared = true when several doors share a position) is read through the RPC assignment_door_footprints and cached in Dexie (footprints store). The map source is field-footprints with promoteId: "fid". Outcome colour is feature-state, applied on style.load AND in the effect, the same as the dots. Shared slices are never coloured.
Layer order: basemap → basemap-buildings-3d → field-footprints (fill / line / 3d) → route layers → focus halo → dots → core → labels → position. Route and dots must always draw above buildings.
3D: lib/field/map-view.ts holds the shared 2D/3D choice (localStorage, try/catch). 3D = pitch 55 (Map tab) or 50 (mini map); rotation stays off; the mini map's pitch is set by code only.
Overpass is called by scripts/ingest-buildings.ts only, never by the app (rule 40).
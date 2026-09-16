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
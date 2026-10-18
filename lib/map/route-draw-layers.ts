import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import { mapColours, type MapMode } from "@/lib/map/map-palette";

/**
 * RT-3 (owner 2026-10-13; Figma R2–R8, D1, component `RouteDoor`). The prop's
 * doors while a route is drawn by hand. One feature per door, keyed by UPRN;
 * what changes as the admin draws is feature-state only (no setData per
 * stroke), so drawing stays smooth on a phone:
 *
 *   linked   on the route (solid prop blue)
 *   end      the door the next stroke carries on from (larger, soft halo)
 *   left     left out on purpose (greyed; the save sheet and the saved view)
 *   fresh    added by a shape change, not yet on the route (warning ring)
 *   track    on the pavement the finger is following right now (soft halo;
 *            RT-5, so a zoomed-out stroke shows which row it has caught)
 *
 * No state at all: an open door (hollow).
 */

export const ROUTE_DRAW_SOURCE = "admin-route-draw-doors";
export const ROUTE_DRAW_LAYER = "admin-route-draw-doors";
const ROUTE_DRAW_HALO = "admin-route-draw-halo";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export type RouteDrawDoor = { uprn: number; lon: number; lat: number };
export type RouteDoorState = { linked: boolean; end: boolean; left: boolean; fresh: boolean };

const LINKED: ExpressionSpecification = ["boolean", ["feature-state", "linked"], false];
const END: ExpressionSpecification = ["boolean", ["feature-state", "end"], false];
const LEFT: ExpressionSpecification = ["boolean", ["feature-state", "left"], false];
const FRESH: ExpressionSpecification = ["boolean", ["feature-state", "fresh"], false];
const TRACK: ExpressionSpecification = ["boolean", ["feature-state", "track"], false];

function warn(mode: MapMode): string {
  return mode === "dark" ? "#e0a03a" : "#9a5b00";
}

export function ensureRouteDrawLayers(map: MapLibreMap, mode: MapMode): void {
  if (map.getSource(ROUTE_DRAW_SOURCE)) return;
  const c = mapColours(mode);
  map.addSource(ROUTE_DRAW_SOURCE, { type: "geojson", data: EMPTY, promoteId: "uprn" });
  map.addLayer({
    id: ROUTE_DRAW_HALO,
    type: "circle",
    source: ROUTE_DRAW_SOURCE,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 8, 18, 16, 20, 22],
      "circle-color": c.focus.line,
      "circle-opacity": ["case", END, 0.22, TRACK, 0.14, 0],
    },
  });
  map.addLayer({
    id: ROUTE_DRAW_LAYER,
    type: "circle",
    source: ROUTE_DRAW_SOURCE,
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        15,
        ["case", END, 4.5, LEFT, 2, 3],
        18,
        ["case", END, 8, LEFT, 3.5, 5.5],
        20,
        ["case", END, 11, LEFT, 5, 8],
      ],
      "circle-color": ["case", ["any", LINKED, END], c.focus.line, LEFT, c.palette.labelMuted, c.dot.open],
      "circle-opacity": ["case", LEFT, 0.6, 1],
      "circle-stroke-color": ["case", FRESH, warn(mode), ["any", LINKED, END], c.dot.ring, TRACK, c.focus.line, c.dot.openRing],
      "circle-stroke-width": ["case", FRESH, 2.5, LEFT, 0, ["any", LINKED, END], 1.5, 1.5],
    },
  });
}

export function setRouteDrawDoors(map: MapLibreMap, doors: readonly RouteDrawDoor[] | null): void {
  const source = map.getSource(ROUTE_DRAW_SOURCE) as GeoJSONSource | undefined;
  if (!source) return;
  if (!doors) {
    source.setData(EMPTY);
    return;
  }
  source.setData({
    type: "FeatureCollection",
    features: doors.map((door) => ({
      type: "Feature",
      properties: { uprn: door.uprn },
      geometry: { type: "Point", coordinates: [door.lon, door.lat] },
    })),
  });
}

/** Applies the states that changed since `previous` (both keyed by UPRN). Returns `next` for the caller to keep. */
export function applyRouteDoorStates(
  map: MapLibreMap,
  previous: ReadonlyMap<number, RouteDoorState>,
  next: ReadonlyMap<number, RouteDoorState>,
): ReadonlyMap<number, RouteDoorState> {
  if (!map.getSource(ROUTE_DRAW_SOURCE)) return previous;
  const blank: RouteDoorState = { linked: false, end: false, left: false, fresh: false };
  const touch = (uprn: number) => {
    const was = previous.get(uprn) ?? blank;
    const now = next.get(uprn) ?? blank;
    if (was.linked === now.linked && was.end === now.end && was.left === now.left && was.fresh === now.fresh) return;
    map.setFeatureState({ source: ROUTE_DRAW_SOURCE, id: uprn }, now);
  };
  for (const uprn of previous.keys()) touch(uprn);
  for (const uprn of next.keys()) if (!previous.has(uprn)) touch(uprn);
  return next;
}

/** The state of every door that is not plain open. */
export function routeDoorStates(input: {
  chain: readonly number[];
  /** Doors to show greyed (left out). */
  left: readonly number[];
  /** Doors to show with a warning ring (new since the drawing was saved). */
  fresh: readonly number[];
  /** Show the carry-on halo on the last door. */
  showEnd: boolean;
}): Map<number, RouteDoorState> {
  const out = new Map<number, RouteDoorState>();
  const last = input.chain[input.chain.length - 1];
  for (const uprn of input.chain) out.set(uprn, { linked: true, end: input.showEnd && uprn === last, left: false, fresh: false });
  for (const uprn of input.left) if (!out.has(uprn)) out.set(uprn, { linked: false, end: false, left: true, fresh: false });
  for (const uprn of input.fresh) if (!out.has(uprn)) out.set(uprn, { linked: false, end: false, left: false, fresh: true });
  return out;
}

/** Forgets every door's state (feature-state outlives `setData`). */
export function clearRouteDoorStates(map: MapLibreMap): void {
  if (map.getSource(ROUTE_DRAW_SOURCE)) map.removeFeatureState({ source: ROUTE_DRAW_SOURCE });
}

/**
 * The "following this pavement" highlight. Only `track` changes (feature-state
 * merges keys), so the door's other states stay. Returns `next` to keep.
 */
export function setRouteTrack(map: MapLibreMap, previous: readonly number[], next: readonly number[]): readonly number[] {
  if (!map.getSource(ROUTE_DRAW_SOURCE)) return previous;
  const keep = new Set(next);
  for (const uprn of previous) if (!keep.has(uprn)) map.setFeatureState({ source: ROUTE_DRAW_SOURCE, id: uprn }, { track: false });
  const had = new Set(previous);
  for (const uprn of next) if (!had.has(uprn)) map.setFeatureState({ source: ROUTE_DRAW_SOURCE, id: uprn }, { track: true });
  return next;
}

export function setRouteDrawVisible(map: MapLibreMap, on: boolean): void {
  for (const id of [ROUTE_DRAW_HALO, ROUTE_DRAW_LAYER]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  }
}

import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import { edgeMidpoints, type DrawShape } from "@/lib/admin/draw-history";
import { mapColours, type MapMode } from "@/lib/map/map-palette";

/**
 * UI-10 F2c (owner A19-A21; frames 08-13, D3). The shape being drawn: the
 * area once closed, its edges, a midpoint on every edge of a closed shape
 * (drag one to add a corner) and the corners themselves. Corner 1 is solid
 * while the shape is open, because tapping it closes the shape. The corner
 * being dragged is solid with a soft halo under the finger.
 */

export const DRAW_SOURCE = "admin-draw";
export const DRAW_VERTEX_LAYER = "admin-draw-vertex";
export const DRAW_MID_LAYER = "admin-draw-mid";
const DRAW_AREA_LAYER = "admin-draw-area";
const DRAW_EDGE_LAYER = "admin-draw-edge";
const DRAW_HALO_LAYER = "admin-draw-halo";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function ensureDrawLayers(map: MapLibreMap, mode: MapMode): void {
  if (map.getSource(DRAW_SOURCE)) return;
  const c = mapColours(mode);
  const line = c.focus.line;
  const core = c.ui.core;

  map.addSource(DRAW_SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: DRAW_AREA_LAYER,
    type: "fill",
    source: DRAW_SOURCE,
    filter: ["==", ["get", "kind"], "area"],
    paint: { "fill-color": line, "fill-opacity": 0.14 },
  });
  map.addLayer({
    id: DRAW_EDGE_LAYER,
    type: "line",
    source: DRAW_SOURCE,
    filter: ["==", ["get", "kind"], "edge"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": line, "line-width": 2.6 },
  });
  map.addLayer({
    id: DRAW_HALO_LAYER,
    type: "circle",
    source: DRAW_SOURCE,
    filter: ["all", ["==", ["get", "kind"], "vertex"], ["boolean", ["get", "active"], false]],
    paint: { "circle-radius": 22, "circle-color": c.ui.halo, "circle-opacity": 0.14 },
  });
  map.addLayer({
    id: DRAW_MID_LAYER,
    type: "circle",
    source: DRAW_SOURCE,
    filter: ["==", ["get", "kind"], "mid"],
    paint: {
      "circle-radius": 4.5,
      "circle-color": core,
      "circle-stroke-color": line,
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: DRAW_VERTEX_LAYER,
    type: "circle",
    source: DRAW_SOURCE,
    filter: ["==", ["get", "kind"], "vertex"],
    paint: {
      "circle-radius": [
        "case",
        ["boolean", ["get", "active"], false],
        9,
        ["boolean", ["get", "target"], false],
        8,
        6.5,
      ],
      "circle-color": [
        "case",
        ["any", ["boolean", ["get", "active"], false], ["boolean", ["get", "target"], false]],
        line,
        core,
      ],
      "circle-stroke-color": ["case", ["boolean", ["get", "active"], false], core, line],
      "circle-stroke-width": 2.5,
    },
  });
}

export type DragState =
  | { kind: "vertex"; index: number; point: [number, number] }
  | { kind: "mid"; afterIndex: number; point: [number, number] };

/** The corners as they look right now: a dragged corner moved, a dragged midpoint inserted. */
export function displayShape(shape: DrawShape, drag: DragState | null): { points: [number, number][]; activeIndex: number | null } {
  if (!drag) return { points: shape.points, activeIndex: null };
  if (drag.kind === "vertex") {
    const points = shape.points.slice();
    points[drag.index] = drag.point;
    return { points, activeIndex: drag.index };
  }
  const points = [...shape.points.slice(0, drag.afterIndex + 1), drag.point, ...shape.points.slice(drag.afterIndex + 1)];
  return { points, activeIndex: drag.afterIndex + 1 };
}

export function setDrawShape(map: MapLibreMap, shape: DrawShape | null, drag: DragState | null, editable: boolean): void {
  const source = map.getSource(DRAW_SOURCE) as GeoJSONSource | undefined;
  if (!source) return;
  if (!shape) {
    source.setData(EMPTY);
    return;
  }
  const { points, activeIndex } = displayShape(shape, drag);
  const features: GeoJSON.Feature[] = [];
  if (shape.closed && points.length >= 3) {
    const ring = [...points, points[0]!];
    features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { kind: "area" } });
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring }, properties: { kind: "edge" } });
  } else if (points.length >= 2) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: { kind: "edge" } });
  }
  if (editable && shape.closed && !drag) {
    for (const mid of edgeMidpoints(shape)) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: mid.point },
        properties: { kind: "mid", after: mid.afterIndex },
      });
    }
  }
  points.forEach((point, index) => {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: point },
      properties: {
        kind: "vertex",
        index,
        active: index === activeIndex,
        target: !shape.closed && index === 0 && points.length >= 3,
      },
    });
  });
  source.setData({ type: "FeatureCollection", features });
}

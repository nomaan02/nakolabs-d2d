import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import type { CoverageDoorCollection, CoverageOutcome } from "@/lib/admin/coverage";
import type { LeadPin } from "@/lib/admin/props";
import type { DoorCollection } from "@/lib/geo/properties-in-polygon";
import { mapColours, type MapMode } from "@/lib/map/map-palette";

/**
 * UI-10 F2b (owner A22, A33). The Props map's own layers, bottom to top:
 * No Cold Calling zones (only when switched on), prop outlines, latest
 * outcome dots (Map style v1, light), the doors inside a shape being drawn,
 * and one pin per lead door coloured by the office's status (read-only).
 *
 * Coverage is derived: outcomes arrive as feature-state on the doors, never
 * baked into the source. `["zoom"]` is only ever the top-level input of an
 * interpolate (nested, MapLibre throws and the layer paints nothing).
 */

export const NCCZ_SOURCE = "admin-nccz";
export const PROPS_SOURCE = "admin-props";
export const DOORS_SOURCE = "admin-doors";
export const DRAW_DOORS_SOURCE = "admin-draw-doors";
export const LEADS_SOURCE = "admin-leads";

export const PROPS_FILL = "admin-props-fill";
export const PROPS_LINE = "admin-props-line";
export const DOORS_LAYER = "admin-doors";
const NCCZ_FILL = "admin-nccz-fill";
const NCCZ_LINE = "admin-nccz-line";
const DRAW_DOORS_LAYER = "admin-draw-doors";
const LEADS_LAYER = "admin-leads";

export type MapLayers = {
  outlines: boolean;
  outcomes: boolean;
  leads: boolean;
  routes: boolean;
  nccz: boolean;
};

/** A22: everything on except routes and No Cold Calling zones. */
export const DEFAULT_LAYERS: MapLayers = {
  outlines: true,
  outcomes: true,
  leads: true,
  routes: false,
  nccz: false,
};

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const OUTCOME: ExpressionSpecification = ["coalesce", ["feature-state", "outcome"], "none"];
const SELECTED: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];

function byState(unworked: number, worked: number): ExpressionSpecification {
  return ["case", ["==", OUTCOME, "none"], unworked, worked];
}

function colourByState(unworked: string, worked: string): ExpressionSpecification {
  return ["case", ["==", OUTCOME, "none"], unworked, worked];
}

function oxide(mode: MapMode): string {
  return mode === "dark" ? "#ff9b9b" : "#7a2b33";
}

function closedPin(mode: MapMode): string {
  return mode === "dark" ? "#5b6470" : "#a5abb3";
}

function setData(map: MapLibreMap, source: string, data: GeoJSON.FeatureCollection): void {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

/** Adds every source and layer once. Safe to call again. */
export function ensurePropLayers(map: MapLibreMap, mode: MapMode): void {
  if (map.getSource(PROPS_SOURCE)) return;
  const c = mapColours(mode);
  const dot = c.dot;

  map.addSource(NCCZ_SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: NCCZ_FILL,
    type: "fill",
    source: NCCZ_SOURCE,
    layout: { visibility: "none" },
    paint: { "fill-color": oxide(mode), "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: NCCZ_LINE,
    type: "line",
    source: NCCZ_SOURCE,
    layout: { visibility: "none" },
    paint: { "line-color": oxide(mode), "line-width": 1.4 },
  });

  map.addSource(PROPS_SOURCE, { type: "geojson", data: EMPTY, promoteId: "id" });
  map.addLayer({
    id: PROPS_FILL,
    type: "fill",
    source: PROPS_SOURCE,
    paint: {
      "fill-color": c.focus.line,
      "fill-opacity": ["case", SELECTED, 0.16, 0.05],
    },
  });
  map.addLayer({
    id: PROPS_LINE,
    type: "line",
    source: PROPS_SOURCE,
    layout: { "line-join": "round" },
    paint: {
      "line-color": c.focus.line,
      "line-width": ["case", SELECTED, 2.6, 1.4],
      "line-opacity": ["case", SELECTED, 1, ["boolean", ["get", "archived"], false], 0.45, 0.8],
    },
  });

  map.addSource(DOORS_SOURCE, { type: "geojson", data: EMPTY, promoteId: "uprn" });
  map.addLayer({
    id: DOORS_LAYER,
    type: "circle",
    source: DOORS_SOURCE,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, byState(0.8, 1.4), 15, byState(1.6, 2.6), 17, byState(2.6, 4), 19, byState(4, 6)],
      "circle-color": [
        "match",
        OUTCOME,
        "no_answer",
        dot.no_answer,
        "answered",
        dot.answered,
        "lead",
        dot.lead,
        "no_opportunity",
        dot.no_opportunity,
        "refused",
        dot.other,
        "do_not_call",
        dot.other,
        "inaccessible",
        dot.other,
        "callback",
        dot.other,
        dot.open,
      ],
      "circle-opacity": byState(0.7, 0.9),
      "circle-stroke-color": colourByState(dot.openRing, dot.ring),
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0.3, 17, byState(0.6, 1), 19, byState(0.8, 1.4)],
    },
  });

  map.addSource(DRAW_DOORS_SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: DRAW_DOORS_LAYER,
    type: "circle",
    source: DRAW_DOORS_SOURCE,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 1.6, 15, 2.6, 17, 4, 19, 6],
      // UI-5 A3b: knockable solid; No Cold Calling zone hollow oxide; flats hollow ink.
      "circle-color": [
        "case",
        ["boolean", ["get", "is_nccz"], false],
        c.palette.ground,
        ["boolean", ["get", "is_multi_unit"], false],
        c.palette.ground,
        c.focus.line,
      ],
      "circle-stroke-width": [
        "case",
        ["boolean", ["get", "is_nccz"], false],
        1.6,
        ["boolean", ["get", "is_multi_unit"], false],
        1,
        0.6,
      ],
      "circle-stroke-color": [
        "case",
        ["boolean", ["get", "is_nccz"], false],
        oxide(mode),
        ["boolean", ["get", "is_multi_unit"], false],
        c.palette.label,
        c.palette.ground,
      ],
    },
  });

  map.addSource(LEADS_SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: LEADS_LAYER,
    type: "circle",
    source: LEADS_SOURCE,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.4, 15, 4, 17, 6, 19, 8.5],
      "circle-color": [
        "match",
        ["get", "pin"],
        "lead",
        c.ui.core,
        "pitched",
        dot.other,
        "sale",
        dot.lead,
        closedPin(mode),
      ],
      "circle-stroke-color": ["match", ["get", "pin"], "lead", dot.lead, dot.ring],
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 17, ["match", ["get", "pin"], "lead", 2.4, 1.4]],
    },
  });
}

export type MapProp = {
  id: string;
  name: string;
  archived: boolean;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

export function setProps(map: MapLibreMap, props: MapProp[]): void {
  setData(map, PROPS_SOURCE, {
    type: "FeatureCollection",
    features: props.map((prop) => ({
      type: "Feature",
      geometry: prop.geometry,
      properties: { id: prop.id, name: prop.name, archived: prop.archived },
    })),
  });
}

/** Feature-state survives `setData`, so the old selection is cleared first. */
export function setSelectedProp(map: MapLibreMap, next: string | null): void {
  if (!map.getSource(PROPS_SOURCE)) return;
  map.removeFeatureState({ source: PROPS_SOURCE });
  if (next) map.setFeatureState({ source: PROPS_SOURCE, id: next }, { selected: true });
}

/** Outcome dots: doors from the coverage payload, latest outcome as feature-state. */
export function setOutcomeDoors(map: MapLibreMap, doors: CoverageDoorCollection, outcomes: CoverageOutcome[]): void {
  setData(map, DOORS_SOURCE, doors);
  map.removeFeatureState({ source: DOORS_SOURCE });
  for (const row of outcomes) {
    map.setFeatureState({ source: DOORS_SOURCE, id: row.uprn }, { outcome: row.outcome });
  }
}

/** One pin per lead door, placed on that door's dot. Doors not on the map are skipped. */
export function setLeadPins(map: MapLibreMap, doors: CoverageDoorCollection, pins: Map<number, LeadPin>): void {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const door of doors.features) {
    const pin = pins.get(Number(door.properties.uprn));
    if (!pin) continue;
    features.push({ type: "Feature", geometry: door.geometry, properties: { pin } });
  }
  setData(map, LEADS_SOURCE, { type: "FeatureCollection", features });
}

export function setNcczZones(map: MapLibreMap, zones: GeoJSON.FeatureCollection): void {
  setData(map, NCCZ_SOURCE, zones);
}

export function setDrawDoors(map: MapLibreMap, doors: DoorCollection | null): void {
  setData(map, DRAW_DOORS_SOURCE, doors ?? EMPTY);
}

function visibility(on: boolean): "visible" | "none" {
  return on ? "visible" : "none";
}

/** `drawing` hides the outcome dots and lead pins so the shape's own doors read clearly. */
export function applyLayerVisibility(map: MapLibreMap, layers: MapLayers, drawing: boolean): void {
  const set = (id: string, on: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility(on));
  };
  set(NCCZ_FILL, layers.nccz);
  set(NCCZ_LINE, layers.nccz);
  set(PROPS_FILL, layers.outlines);
  set(PROPS_LINE, layers.outlines);
  set(DOORS_LAYER, layers.outcomes && !drawing);
  set(LEADS_LAYER, layers.leads && !drawing);
  set(DRAW_DOORS_LAYER, drawing);
}

/**
 * Stage 5b-R3 — one route renderer for the draw page and the frozen
 * assignment view.
 *
 * The line is the walkline (pavement), never `centreline`, `geom` or
 * `route_geom`. MapLibre's `line-offset` moves a line but not the symbols
 * placed along it, so chevrons would sit on the road centre if we drew the
 * centreline and offset it.
 *
 * `["zoom"]` is only ever the top-level input of `interpolate`. Nesting it
 * inside `case` or `match` throws and the layer paints nothing.
 *
 * Feature-state (`active`) is applied by `paintRouteLayers`, which callers
 * run from `style.load` and from the React effect. An effect that returns
 * early while the style is loading leaves every feature inactive.
 */

import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from "maplibre-gl";

import type { WalkResult } from "@/lib/geo/walk/types";

export const ROUTE_LINE_SOURCE = "route-walk-lines";
export const ROUTE_POINT_SOURCE = "route-walk-points";
const CHEVRON_IMAGE = "route-walk-chevron";

const LINE_WORK = "route-walk-work";
const LINE_OTHER = "route-walk-other";
const LINE_CHEVRONS = "route-walk-chevrons";
const POINT_CROSS = "route-walk-cross";
const POINT_END = "route-walk-end";
const POINT_START = "route-walk-start";

const WORK_COLOUR = "#1b4aa6";
const OTHER_COLOUR = "#4a5259";
const START_COLOUR = "#1e6b3a";
const MARKER_COLOUR = "#7a2b33";
const HALO = "#fbfaf8";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export type RouteKind = "work" | "cross" | "walk";

/** One step, already reduced to the pavement line. */
export type RoutePaintStep = {
  fid: string;
  variantKey: string;
  stepIndex: number;
  kind: RouteKind;
  walk: [number, number][];
};

export type RoutePaintPoint = {
  fid: string;
  variantKey: string;
  role: "start" | "end" | "cross";
  lon: number;
  lat: number;
};

export type RoutePaintModel = {
  steps: RoutePaintStep[];
  points: RoutePaintPoint[];
};

/**
 * A row from `territory_route_steps` (`walkline`) or `route_steps`
 * (`walk_geom`), or a `WalkStep` (`walkline` as coordinate pairs). The
 * adapter reads one of those two fields and nothing else — callers do not
 * reshape the row first.
 */
export type RouteStepInput = {
  step_index: number;
  kind: string | null;
  walkline?: unknown;
  walk_geom?: unknown;
  variant_key?: string | null;
};

export type RouteEndpointInput = {
  variantKey: string;
  start: unknown;
  end: unknown;
};

export function emptyRouteModel(): RoutePaintModel {
  return { steps: [], points: [] };
}

export function variantLabel(key: string): string {
  if (key === "best") return "Best";
  if (key === "best_reversed") return "Reversed";
  const alt = /^alt_(\d+)$/.exec(key);
  if (alt) return `Alternative ${alt[1]}`;
  return key;
}

export function compareVariantKeys(a: string, b: string): number {
  const rank = (key: string) => {
    if (key === "best") return 0;
    if (key === "best_reversed") return 1;
    const alt = /^alt_(\d+)$/.exec(key);
    return alt ? 100 + Number(alt[1]) : 1000;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

export function handPhrase(hand: string): string {
  if (hand === "left") return "doors on the left";
  if (hand === "right") return "doors on the right";
  return hand;
}

/** Save stays disabled until a preview exists and the boundary still matches it. */
export function routeSaveEnabled(state: { hasPreview: boolean; stale: boolean; busy: boolean }): boolean {
  return state.hasPreview && !state.stale && !state.busy;
}

export function walkResultToPaintInput(result: WalkResult): {
  steps: RouteStepInput[];
  endpoints: RouteEndpointInput[];
} {
  const steps: RouteStepInput[] = [];
  const endpoints: RouteEndpointInput[] = [];
  for (const variant of result.variants) {
    endpoints.push({
      variantKey: variant.key,
      start: [variant.start.lon, variant.start.lat],
      end: [variant.end.lon, variant.end.lat],
    });
    variant.steps.forEach((step, index) => {
      steps.push({
        step_index: index,
        kind: step.kind,
        walkline: step.walkline,
        variant_key: variant.key,
      });
    });
  }
  return { steps, endpoints };
}

function asKind(value: string | null | undefined): RouteKind | null {
  if (value === "work" || value === "cross" || value === "walk") return value;
  return null;
}

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

/** LineString GeoJSON, a JSON string of one, or a bare `[lon, lat][]`. */
export function lineCoordinates(value: unknown): [number, number][] | null {
  if (typeof value === "string") {
    try {
      return lineCoordinates(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    const coordinates: [number, number][] = [];
    for (const item of value) {
      const next = pair(item);
      if (!next) return null;
      coordinates.push(next);
    }
    return coordinates.length >= 2 ? coordinates : null;
  }
  if (value && typeof value === "object" && "type" in value) {
    const row = value as { type?: string; coordinates?: unknown };
    if (row.type === "LineString") return lineCoordinates(row.coordinates);
  }
  return null;
}

/** Point GeoJSON, or a bare `[lon, lat]`. */
export function pointFromGeom(value: unknown): { lon: number; lat: number } | null {
  if (typeof value === "string") {
    try {
      return pointFromGeom(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  const bare = pair(value);
  if (bare) return { lon: bare[0], lat: bare[1] };
  if (value && typeof value === "object" && "type" in value) {
    const row = value as { type?: string; coordinates?: unknown };
    if (row.type === "Point") {
      const coordinates = pair(row.coordinates);
      if (coordinates) return { lon: coordinates[0], lat: coordinates[1] };
    }
  }
  return null;
}

function stepWalk(step: RouteStepInput): [number, number][] | null {
  if (step.walkline !== undefined && step.walkline !== null) {
    const fromWalkline = lineCoordinates(step.walkline);
    if (fromWalkline) return fromWalkline;
  }
  if (step.walk_geom !== undefined && step.walk_geom !== null) {
    return lineCoordinates(step.walk_geom);
  }
  return null;
}

/**
 * One model for both tables and for the in-memory generator. Working legs,
 * crossings and the return walk all come from the pavement line.
 */
export function toRoutePaintModel(input: {
  steps: readonly RouteStepInput[];
  variantKey?: string;
  endpoints?: readonly RouteEndpointInput[];
}): RoutePaintModel {
  const byVariant = new Map<string, RoutePaintStep[]>();
  for (const step of input.steps) {
    const kind = asKind(step.kind);
    const walk = stepWalk(step);
    if (!kind || !walk) continue;
    const variantKey = step.variant_key || input.variantKey || "route";
    const painted: RoutePaintStep = {
      fid: `line:${variantKey}:${step.step_index}`,
      variantKey,
      stepIndex: step.step_index,
      kind,
      walk,
    };
    const list = byVariant.get(variantKey);
    if (list) list.push(painted);
    else byVariant.set(variantKey, [painted]);
  }

  const steps: RoutePaintStep[] = [];
  const points: RoutePaintPoint[] = [];
  const endpointByKey = new Map((input.endpoints ?? []).map((row) => [row.variantKey, row]));

  for (const [variantKey, list] of byVariant) {
    list.sort((a, b) => a.stepIndex - b.stepIndex);
    steps.push(...list);
    const first = list[0];
    const last = list[list.length - 1];
    const ends = endpointByKey.get(variantKey);
    const start = (ends ? pointFromGeom(ends.start) : null) ?? {
      lon: first.walk[0][0],
      lat: first.walk[0][1],
    };
    const lastCoord = last.walk[last.walk.length - 1];
    const end = (ends ? pointFromGeom(ends.end) : null) ?? { lon: lastCoord[0], lat: lastCoord[1] };
    points.push(
      { fid: `point:${variantKey}:start`, variantKey, role: "start", lon: start.lon, lat: start.lat },
      { fid: `point:${variantKey}:end`, variantKey, role: "end", lon: end.lon, lat: end.lat },
    );
    for (const step of list) {
      if (step.kind !== "cross") continue;
      const at = step.walk[Math.floor((step.walk.length - 1) / 2)];
      points.push({
        fid: `point:${variantKey}:cross:${step.stepIndex}`,
        variantKey,
        role: "cross",
        lon: at[0],
        lat: at[1],
      });
    }
  }

  return { steps, points };
}

/**
 * Frames the highlighted variant. Padding is clamped to the canvas: MapLibre
 * leaves the camera where it is when padding is taller than the map, which
 * happens on a short stacked layout.
 */
export function fitRouteBounds(
  map: MapLibreMap,
  model: RoutePaintModel,
  variantKey?: string,
  options?: { padding?: number; maxZoom?: number },
): void {
  const bounds = routeBounds(model, variantKey);
  if (!bounds) return;
  map.resize();
  const canvas = map.getCanvas();
  const room = Math.floor(Math.min(canvas.clientWidth, canvas.clientHeight) / 2) - 4;
  if (room < 0 || canvas.clientWidth < 2 || canvas.clientHeight < 2) return;
  const padding = Math.max(0, Math.min(options?.padding ?? 48, room));
  map.fitBounds(bounds, { padding, maxZoom: options?.maxZoom ?? 17, duration: 0 });
}

export function routeBounds(
  model: RoutePaintModel,
  variantKey?: string,
): [[number, number], [number, number]] | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let any = false;
  for (const step of model.steps) {
    if (variantKey && step.variantKey !== variantKey) continue;
    for (const [lon, lat] of step.walk) {
      any = true;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!any) return null;
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

function linesGeoJson(model: RoutePaintModel): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: model.steps.map((step) => ({
      type: "Feature",
      properties: { fid: step.fid, kind: step.kind, variantKey: step.variantKey },
      geometry: { type: "LineString", coordinates: step.walk },
    })),
  };
}

function pointsGeoJson(model: RoutePaintModel): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: model.points.map((point) => ({
      type: "Feature",
      properties: { fid: point.fid, role: point.role, variantKey: point.variantKey },
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    })),
  };
}

function setRouteData(map: MapLibreMap, model: RoutePaintModel): void {
  const lines = map.getSource(ROUTE_LINE_SOURCE) as GeoJSONSource | undefined;
  const points = map.getSource(ROUTE_POINT_SOURCE) as GeoJSONSource | undefined;
  lines?.setData(model.steps.length > 0 ? linesGeoJson(model) : EMPTY);
  points?.setData(model.points.length > 0 ? pointsGeoJson(model) : EMPTY);
}

/** Highlights one variant. Every other variant stays on the map, dimmed. */
export function applyRouteActive(map: MapLibreMap, model: RoutePaintModel, activeKey: string): void {
  if (!map.getSource(ROUTE_LINE_SOURCE) || !map.getSource(ROUTE_POINT_SOURCE)) return;
  for (const step of model.steps) {
    map.setFeatureState(
      { source: ROUTE_LINE_SOURCE, id: step.fid },
      { active: step.variantKey === activeKey },
    );
  }
  for (const point of model.points) {
    map.setFeatureState(
      { source: ROUTE_POINT_SOURCE, id: point.fid },
      { active: point.variantKey === activeKey },
    );
  }
}

const ACTIVE: ExpressionSpecification = ["boolean", ["feature-state", "active"], false];

const LINE_OPACITY: ExpressionSpecification = ["case", ACTIVE, 0.95, 0.18];
const MARKER_OPACITY: ExpressionSpecification = ["case", ACTIVE, 1, 0];

const LINE_WIDTH: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 3.5, 19, 5.5];
const ICON_SIZE: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 12, 0.45, 16, 0.7, 19, 0.95];

function circleRadius(small: number, mid: number, large: number): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 12, small, 16, mid, 19, large];
}

function ensureChevron(map: MapLibreMap): void {
  if (map.hasImage(CHEVRON_IMAGE)) return;
  const size = 24;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x / (size - 1);
      const ny = y / (size - 1);
      const shaft = nx >= 0.08 && nx <= 0.58 && Math.abs(ny - 0.5) <= 0.12;
      const along = (nx - 0.48) / 0.44;
      const head = nx >= 0.48 && nx <= 0.92 && Math.abs(ny - 0.5) <= 0.34 * (1 - along);
      if (!shaft && !head) continue;
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = 255;
    }
  }
  map.addImage(CHEVRON_IMAGE, { width: size, height: size, data }, { sdf: true });
}

function addBefore(map: MapLibreMap, layer: Parameters<MapLibreMap["addLayer"]>[0], beforeId?: string): void {
  if (map.getLayer(layer.id)) return;
  if (beforeId && map.getLayer(beforeId)) map.addLayer(layer, beforeId);
  else map.addLayer(layer);
}

/**
 * Registers the route sources and layers. `beforeId` is the door-circle
 * layer so the route paints underneath the dots. Idempotent.
 */
export function ensureRouteLayers(map: MapLibreMap, beforeId?: string): void {
  ensureChevron(map);
  if (!map.getSource(ROUTE_LINE_SOURCE)) {
    map.addSource(ROUTE_LINE_SOURCE, { type: "geojson", data: EMPTY, promoteId: "fid" });
  }
  if (!map.getSource(ROUTE_POINT_SOURCE)) {
    map.addSource(ROUTE_POINT_SOURCE, { type: "geojson", data: EMPTY, promoteId: "fid" });
  }

  const workFilter: FilterSpecification = ["==", ["get", "kind"], "work"];
  const otherFilter: FilterSpecification = ["!=", ["get", "kind"], "work"];

  addBefore(
    map,
    {
      id: LINE_OTHER,
      type: "line",
      source: ROUTE_LINE_SOURCE,
      filter: otherFilter,
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": OTHER_COLOUR,
        "line-width": LINE_WIDTH,
        "line-opacity": LINE_OPACITY,
        "line-dasharray": [1.4, 1.3],
      },
    },
    beforeId,
  );
  addBefore(
    map,
    {
      id: LINE_WORK,
      type: "line",
      source: ROUTE_LINE_SOURCE,
      filter: workFilter,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": WORK_COLOUR,
        "line-width": LINE_WIDTH,
        "line-opacity": LINE_OPACITY,
      },
    },
    beforeId,
  );
  addBefore(
    map,
    {
      id: LINE_CHEVRONS,
      type: "symbol",
      source: ROUTE_LINE_SOURCE,
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 70,
        "icon-image": CHEVRON_IMAGE,
        "icon-size": ICON_SIZE,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
      },
      paint: {
        "icon-color": "#1c2226",
        "icon-opacity": MARKER_OPACITY,
      },
    },
    beforeId,
  );
  addBefore(
    map,
    {
      id: POINT_CROSS,
      type: "circle",
      source: ROUTE_POINT_SOURCE,
      filter: ["==", ["get", "role"], "cross"],
      paint: {
        "circle-radius": circleRadius(3, 4, 5),
        "circle-color": MARKER_COLOUR,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": HALO,
        "circle-opacity": MARKER_OPACITY,
        "circle-stroke-opacity": MARKER_OPACITY,
      },
    },
    beforeId,
  );
  addBefore(
    map,
    {
      id: POINT_END,
      type: "circle",
      source: ROUTE_POINT_SOURCE,
      filter: ["==", ["get", "role"], "end"],
      paint: {
        "circle-radius": circleRadius(4, 5.5, 7),
        "circle-color": MARKER_COLOUR,
        "circle-stroke-width": 2,
        "circle-stroke-color": HALO,
        "circle-opacity": MARKER_OPACITY,
        "circle-stroke-opacity": MARKER_OPACITY,
      },
    },
    beforeId,
  );
  addBefore(
    map,
    {
      id: POINT_START,
      type: "circle",
      source: ROUTE_POINT_SOURCE,
      filter: ["==", ["get", "role"], "start"],
      paint: {
        "circle-radius": circleRadius(5, 7, 9),
        "circle-color": START_COLOUR,
        "circle-stroke-width": 2,
        "circle-stroke-color": HALO,
        "circle-opacity": MARKER_OPACITY,
        "circle-stroke-opacity": MARKER_OPACITY,
      },
    },
    beforeId,
  );
}

/**
 * Writes the model and highlights `activeKey`. Call this from `style.load`
 * and from the effect that watches the model — either one alone leaves the
 * highlight unset after a style reload.
 */
export function paintRouteLayers(map: MapLibreMap, model: RoutePaintModel, activeKey: string, beforeId?: string): void {
  // Do not consult `isStyleLoaded()` here. It is still false inside the
  // `style.load` handler, and bailing there is how the highlight gets lost.
  if (!map.getStyle()) return;
  ensureRouteLayers(map, beforeId);
  setRouteData(map, model);
  applyRouteActive(map, model, activeKey);
}

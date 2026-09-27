/**
 * One route renderer for the field map, the draw page and the frozen
 * assignment view.
 *
 * The line is the walkline (pavement), never `centreline`, `geom` or
 * `route_geom`. MapLibre's `line-offset` moves a line but not the symbols
 * placed along it.
 *
 * `["zoom"]` is only ever the top-level input of `interpolate`. Nesting it
 * inside `case` or `match` throws and the layer paints nothing.
 *
 * Line colour and width come from feature-state `tier`. Chevrons are the
 * exception: one merged line per leg-run, rebuilt with setData when the
 * current step moves, with `tier` as a feature property. A stable per-leg
 * feature cannot show chevrons on only the undone part of the current leg.
 *
 * Feature-state is applied by `paintRouteLayers` and `applyRouteProgress`,
 * which callers run from `style.load` and from the React effect. State does
 * not survive `setData`.
 */

import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from "maplibre-gl";

import type { WalkResult } from "@/lib/geo/walk/types";
import { legRuns, type RouteTiers } from "@/lib/map/route-progress";

export const ROUTE_LINE_SOURCE = "route-walk-lines";
export const ROUTE_POINT_SOURCE = "route-walk-points";
const CHEVRON_SOURCE = "route-walk-chevron-runs";

const CHEVRON_IMAGE = "route-chevron";
const BADGE_START = "route-badge-start";
const BADGE_END = "route-badge-end";

const LINE_WORK = "route-walk-work";
const LINE_OTHER = "route-walk-other";
const LINE_CHEVRONS = "route-walk-chevrons";
const POINT_END = "route-walk-end";
const POINT_START = "route-walk-start";

/** Dataset order for the field map. Paint order is separate. */
export const ROUTE_LAYER_IDS = [
  LINE_WORK,
  LINE_OTHER,
  LINE_CHEVRONS,
  POINT_START,
  POINT_END,
] as const;

const FOCUS = "#c2410c";
const PAPER = "#fbfaf8";
const NEAR_MIX = 0.55;
const FAR_MIX = 0.35;
const DONE = "#a3a9ae";
const INK = "#1c2226";
const START_FILL = "#1e6b3a";
const END_FILL = "#7a2b33";

/** Owner tunes these. Near and far are solid mixes, drawn at opacity 1. */
function hexChannels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function mixHex(focus: string, paper: string, amount: number): string {
  const from = hexChannels(focus);
  const into = hexChannels(paper);
  const channel = (index: number) => Math.round(from[index]! * amount + into[index]! * (1 - amount));
  return `#${[0, 1, 2].map((index) => channel(index).toString(16).padStart(2, "0")).join("")}`;
}

const NEAR = mixHex(FOCUS, PAPER, NEAR_MIX);
const FAR = mixHex(FOCUS, PAPER, FAR_MIX);

export const ROUTE_TIER_COLOURS = {
  focus: FOCUS,
  near: NEAR,
  far: FAR,
  done: DONE,
} as const;

/** Joints closer than this become one vertex so a chevron is not planted on the join. */
const JOINT_M = 0.1;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export type RouteKind = "work" | "cross" | "walk";

/** One step, already reduced to the pavement line. */
export type RoutePaintStep = {
  fid: string;
  variantKey: string;
  stepIndex: number;
  kind: RouteKind;
  walk: [number, number][];
  street?: string | null;
  firstSeq?: number;
  lastSeq?: number;
};

export type BadgeAnchor = "top" | "bottom";

export type RoutePaintPoint = {
  fid: string;
  variantKey: string;
  role: "start" | "end";
  lon: number;
  lat: number;
  anchor: BadgeAnchor;
};

export type RoutePaintModel = {
  steps: RoutePaintStep[];
  points: RoutePaintPoint[];
};

/**
 * A row from `territory_route_steps` (`walkline`) or `route_steps`
 * (`walk_geom`), or a `WalkStep` (`walkline` as coordinate pairs). The
 * adapter reads one of those two fields and nothing else — callers do not
 * reshape the row first. Street and sequence are optional and only used
 * to merge legs.
 */
export type RouteStepInput = {
  step_index: number;
  kind: string | null;
  walkline?: unknown;
  walk_geom?: unknown;
  variant_key?: string | null;
  street_name?: string | null;
  first_seq?: number | null;
  last_seq?: number | null;
};

export type RouteEndpointInput = {
  variantKey: string;
  start: unknown;
  end: unknown;
};

type ChevronRef = { fid: string; variantKey: string };

const chevronRefs = new WeakMap<MapLibreMap, ChevronRef[]>();
const chevronSignature = new WeakMap<GeoJSONSource, string>();
const activeKeyByMap = new WeakMap<MapLibreMap, string>();

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
        street_name: step.street_name,
        first_seq: step.first_seq,
        last_seq: step.last_seq,
      });
    });
  }
  return { steps, endpoints };
}

function asKind(value: string | null | undefined): RouteKind | null {
  if (value === "work" || value === "cross" || value === "walk") return value;
  return null;
}

function optionalCount(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
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
 * The further-north endpoint keeps its badge above the point. On a tie,
 * START sits below and END sits above.
 */
function badgeAnchors(startLat: number, endLat: number): { start: BadgeAnchor; end: BadgeAnchor } {
  if (endLat > startLat) return { start: "top", end: "bottom" };
  if (startLat > endLat) return { start: "bottom", end: "top" };
  return { start: "top", end: "bottom" };
}

/**
 * One model for both tables and for the in-memory generator. Working legs
 * and the connectors between them all come from the pavement line. Cross
 * steps stay in the line; they are not drawn as dots.
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
      street: step.street_name ?? null,
      firstSeq: optionalCount(step.first_seq),
      lastSeq: optionalCount(step.last_seq),
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
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const ends = endpointByKey.get(variantKey);
    const start = (ends ? pointFromGeom(ends.start) : null) ?? {
      lon: first.walk[0]![0],
      lat: first.walk[0]![1],
    };
    const lastCoord = last.walk[last.walk.length - 1]!;
    const end = (ends ? pointFromGeom(ends.end) : null) ?? { lon: lastCoord[0], lat: lastCoord[1] };
    const anchors = badgeAnchors(start.lat, end.lat);
    points.push(
      {
        fid: `point:${variantKey}:start`,
        variantKey,
        role: "start",
        lon: start.lon,
        lat: start.lat,
        anchor: anchors.start,
      },
      {
        fid: `point:${variantKey}:end`,
        variantKey,
        role: "end",
        lon: end.lon,
        lat: end.lat,
        anchor: anchors.end,
      },
    );
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
      type: "Feature" as const,
      properties: { fid: step.fid, kind: step.kind, variantKey: step.variantKey },
      geometry: { type: "LineString" as const, coordinates: step.walk },
    })),
  };
}

function pointsGeoJson(model: RoutePaintModel): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: model.points.map((point) => ({
      type: "Feature" as const,
      properties: {
        fid: point.fid,
        role: point.role,
        variantKey: point.variantKey,
        anchor: point.anchor,
      },
      geometry: { type: "Point" as const, coordinates: [point.lon, point.lat] },
    })),
  };
}

function equirectangularMetres(a: [number, number], b: [number, number]): number {
  const radius = 6_371_000;
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = ((b[0] - a[0]) * Math.PI) / 180 * Math.cos(lat) * radius;
  const y = ((b[1] - a[1]) * Math.PI) / 180 * radius;
  return Math.hypot(x, y);
}

function appendWalk(out: [number, number][], walk: readonly [number, number][]): void {
  for (const coord of walk) {
    const prev = out[out.length - 1];
    // Any vertex within JOINT_M of the previous one, not only the first.
    // A collapsed step stored as [J, J] then adds no duplicate vertex.
    if (prev && equirectangularMetres(prev, coord) < JOINT_M) continue;
    out.push(coord);
  }
}

function stepsByVariant(model: RoutePaintModel): Map<string, RoutePaintStep[]> {
  const grouped = new Map<string, RoutePaintStep[]>();
  for (const step of model.steps) {
    const list = grouped.get(step.variantKey);
    if (list) list.push(step);
    else grouped.set(step.variantKey, [step]);
  }
  for (const list of grouped.values()) list.sort((a, b) => a.stepIndex - b.stepIndex);
  return grouped;
}

function chevronsGeoJson(
  model: RoutePaintModel,
  tiers: RouteTiers | null,
): { collection: GeoJSON.FeatureCollection; refs: ChevronRef[] } {
  const features: GeoJSON.Feature[] = [];
  const refs: ChevronRef[] = [];
  for (const [variantKey, steps] of stepsByVariant(model)) {
    for (const run of legRuns(steps, tiers)) {
      const coordinates: [number, number][] = [];
      for (const stepIndex of run.stepIndexes) {
        const step = steps.find((row) => row.stepIndex === stepIndex);
        if (step) appendWalk(coordinates, step.walk);
      }
      if (coordinates.length < 2) continue;
      const fid = `chev:${variantKey}:${run.leg}:${run.firstStep}`;
      features.push({
        type: "Feature",
        properties: { fid, tier: run.tier, variantKey },
        geometry: { type: "LineString", coordinates },
      });
      refs.push({ fid, variantKey });
    }
  }
  return { collection: { type: "FeatureCollection", features }, refs };
}

function setRouteData(map: MapLibreMap, model: RoutePaintModel): void {
  const lines = map.getSource(ROUTE_LINE_SOURCE) as GeoJSONSource | undefined;
  const points = map.getSource(ROUTE_POINT_SOURCE) as GeoJSONSource | undefined;
  lines?.setData(model.steps.length > 0 ? linesGeoJson(model) : EMPTY);
  points?.setData(model.points.length > 0 ? pointsGeoJson(model) : EMPTY);
}

/**
 * Rebuilds the chevron source when the run signature changes. Skips setData
 * when it has not, so a tier repaint does not wipe feature-state for nothing.
 * The signature map is keyed by the source object, so a style reload starts clean.
 */
function syncChevrons(map: MapLibreMap, model: RoutePaintModel, tiers: RouteTiers | null): void {
  const source = map.getSource(CHEVRON_SOURCE) as GeoJSONSource | undefined;
  if (!source) return;
  const { collection, refs } = chevronsGeoJson(model, tiers);
  chevronRefs.set(map, refs);
  const signature = JSON.stringify(collection);
  if (chevronSignature.get(source) === signature) return;
  source.setData(collection.features.length > 0 ? collection : EMPTY);
  chevronSignature.set(source, signature);
}

function applyChevronActive(map: MapLibreMap, activeKey: string): void {
  if (!map.getSource(CHEVRON_SOURCE)) return;
  for (const ref of chevronRefs.get(map) ?? []) {
    map.setFeatureState(
      { source: CHEVRON_SOURCE, id: ref.fid },
      { active: ref.variantKey === activeKey },
    );
  }
}

/** Highlights one variant. Every other variant stays on the map, dimmed. */
export function applyRouteActive(map: MapLibreMap, model: RoutePaintModel, activeKey: string): void {
  if (!map.getSource(ROUTE_LINE_SOURCE) || !map.getSource(ROUTE_POINT_SOURCE)) return;
  activeKeyByMap.set(map, activeKey);
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
  applyChevronActive(map, activeKey);
}

const ACTIVE: ExpressionSpecification = ["boolean", ["feature-state", "active"], false];
const TIER: ExpressionSpecification = ["coalesce", ["feature-state", "tier"], "focus"];
const LINE_COLOUR: ExpressionSpecification = ["match", TIER, "near", NEAR, "far", FAR, "done", DONE, FOCUS];
const LINE_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  12,
  ["match", TIER, "near", 1.75, "far", 1.5, "done", 1, 2.25],
  16,
  ["match", TIER, "near", 3, "far", 2.5, "done", 1.75, 4.5],
  19,
  ["match", TIER, "near", 4.5, "far", 3.5, "done", 2.5, 7],
];
const LINE_OPACITY: ExpressionSpecification = ["case", ACTIVE, 1, 0.18];
const CHEVRON_TIER: ExpressionSpecification = ["get", "tier"];

function chevronOpacityAt(near: number, far: number): ExpressionSpecification {
  return ["case", ACTIVE, ["match", CHEVRON_TIER, "focus", 1, "near", near, "far", far, 0], 0];
}

const CHEVRON_OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  16,
  chevronOpacityAt(0, 0),
  17.5,
  chevronOpacityAt(0.5, 0.35),
];
const CHEVRON_SIZE: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  14,
  0.4,
  16,
  0.55,
  19,
  0.75,
];
const BADGE_OPACITY: ExpressionSpecification = ["case", ACTIVE, 1, 0];
const BADGE_ANCHOR: ExpressionSpecification = ["match", ["get", "anchor"], "top", "top", "bottom"];
const BADGE_OFFSET: ExpressionSpecification = [
  "match",
  ["get", "anchor"],
  "top",
  ["literal", [0, 5]],
  ["literal", [0, -5]],
];

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

/**
 * Open ">" as a true distance field. Edge at alpha 0.75, one eighth per
 * pixel, which is MapLibre's SDF scale. No DOM.
 */
function ensureChevron(map: MapLibreMap): void {
  if (map.hasImage(CHEVRON_IMAGE)) return;
  const size = 64;
  const data = new Uint8ClampedArray(size * size * 4);
  const ax = 24;
  const ay = 14;
  const bx = 40;
  const by = 32;
  const cx = 24;
  const cy = 50;
  const radius = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d =
        Math.min(distToSegment(px, py, ax, ay, bx, by), distToSegment(px, py, bx, by, cx, cy)) - radius;
      const alpha = Math.round(255 * Math.max(0, Math.min(1, 0.75 - d / 8)));
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = alpha;
    }
  }
  map.addImage(CHEVRON_IMAGE, { width: size, height: size, data }, { pixelRatio: 2, sdf: true });
}

const BADGE_FONT = '700 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Raster pill with the word baked in. Null outside a browser, or with no 2D context. */
function drawBadge(text: string, fill: string): ImageData | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = BADGE_FONT;
  const logicalW = Math.ceil(ctx.measureText(text).width) + 12;
  const logicalH = 16;
  canvas.width = logicalW * 2;
  canvas.height = logicalH * 2;
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.font = BADGE_FONT;
  ctx.beginPath();
  const inset = 0.75;
  const x = inset;
  const y = inset;
  const width = logicalW - inset * 2;
  const height = logicalH - inset * 2;
  const r = height / 2;
  ctx.arc(x + r, y + height / 2, r, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.arc(x + width - r, y + height / 2, r, (Math.PI * 3) / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, logicalW / 2, logicalH / 2);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function ensureBadge(map: MapLibreMap, id: string, text: string, fill: string): boolean {
  if (map.hasImage(id)) return true;
  const image = drawBadge(text, fill);
  if (!image) return false;
  map.addImage(id, image, { pixelRatio: 2 });
  return map.hasImage(id);
}

type RouteLayer = Parameters<MapLibreMap["addLayer"]>[0];

function routeLayerList(includeBadges: boolean): RouteLayer[] {
  const workFilter: FilterSpecification = ["==", ["get", "kind"], "work"];
  const otherFilter: FilterSpecification = ["!=", ["get", "kind"], "work"];
  const doneFilter: FilterSpecification = ["!=", ["get", "tier"], "done"];
  const layers: RouteLayer[] = [
    {
      id: LINE_OTHER,
      type: "line",
      source: ROUTE_LINE_SOURCE,
      filter: otherFilter,
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": LINE_COLOUR,
        "line-width": LINE_WIDTH,
        "line-opacity": LINE_OPACITY,
        "line-dasharray": [1.4, 1.3],
      },
    },
    {
      id: LINE_WORK,
      type: "line",
      source: ROUTE_LINE_SOURCE,
      filter: workFilter,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": LINE_COLOUR,
        "line-width": LINE_WIDTH,
        "line-opacity": LINE_OPACITY,
      },
    },
    {
      id: LINE_CHEVRONS,
      type: "symbol",
      source: CHEVRON_SOURCE,
      filter: doneFilter,
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 120,
        "icon-image": CHEVRON_IMAGE,
        "icon-size": CHEVRON_SIZE,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
      },
      paint: {
        "icon-color": INK,
        "icon-halo-color": PAPER,
        "icon-halo-width": 1,
        "icon-opacity": CHEVRON_OPACITY,
      },
    },
  ];
  if (!includeBadges) return layers;
  layers.push(
    {
      id: POINT_END,
      type: "symbol",
      source: ROUTE_POINT_SOURCE,
      filter: ["==", ["get", "role"], "end"],
      layout: {
        "icon-image": BADGE_END,
        "icon-size": 1,
        "icon-anchor": BADGE_ANCHOR,
        "icon-offset": BADGE_OFFSET,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-rotation-alignment": "viewport",
        "icon-pitch-alignment": "viewport",
      },
      paint: { "icon-opacity": BADGE_OPACITY },
    },
    {
      id: POINT_START,
      type: "symbol",
      source: ROUTE_POINT_SOURCE,
      filter: ["==", ["get", "role"], "start"],
      layout: {
        "icon-image": BADGE_START,
        "icon-size": 1,
        "icon-anchor": BADGE_ANCHOR,
        "icon-offset": BADGE_OFFSET,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-rotation-alignment": "viewport",
        "icon-pitch-alignment": "viewport",
      },
      paint: { "icon-opacity": BADGE_OPACITY },
    },
  );
  return layers;
}

function addBefore(map: MapLibreMap, layer: RouteLayer, beforeId?: string): void {
  if (map.getLayer(layer.id)) return;
  if (beforeId && map.getLayer(beforeId)) map.addLayer(layer, beforeId);
  else map.addLayer(layer);
}

/**
 * The layer specs the acceptance script validates. Badge layers are included
 * so their expressions are checked; images are registered at runtime.
 */
export function routeValidationStyle(): {
  version: 8;
  sources: Record<string, { type: "geojson"; data: GeoJSON.FeatureCollection }>;
  layers: RouteLayer[];
} {
  const source = { type: "geojson" as const, data: EMPTY };
  return {
    version: 8,
    sources: {
      [ROUTE_LINE_SOURCE]: source,
      [ROUTE_POINT_SOURCE]: source,
      [CHEVRON_SOURCE]: source,
    },
    layers: routeLayerList(true),
  };
}

/**
 * Registers the route sources and layers. `beforeId` is the door-circle
 * layer so the route paints underneath the dots. Idempotent, including
 * after a style reload, which drops images.
 */
export function ensureRouteLayers(map: MapLibreMap, beforeId?: string): void {
  ensureChevron(map);
  const badges = ensureBadge(map, BADGE_START, "START", START_FILL) && ensureBadge(map, BADGE_END, "END", END_FILL);
  if (!map.getSource(ROUTE_LINE_SOURCE)) {
    map.addSource(ROUTE_LINE_SOURCE, { type: "geojson", data: EMPTY, promoteId: "fid" });
  }
  if (!map.getSource(ROUTE_POINT_SOURCE)) {
    map.addSource(ROUTE_POINT_SOURCE, { type: "geojson", data: EMPTY, promoteId: "fid" });
  }
  if (!map.getSource(CHEVRON_SOURCE)) {
    map.addSource(CHEVRON_SOURCE, { type: "geojson", data: EMPTY, promoteId: "fid" });
  }
  for (const layer of routeLayerList(badges)) addBefore(map, layer, beforeId);
}

/**
 * Sets `tier` on every line. Missing tiers paint as focus, which is the
 * admin path. Rebuilds chevrons when the runs changed and puts `active`
 * back on them, because setData clears feature-state.
 */
export function applyRouteProgress(
  map: MapLibreMap,
  model: RoutePaintModel,
  tiers?: RouteTiers | null,
): void {
  if (!map.getSource(ROUTE_LINE_SOURCE)) return;
  const resolved = tiers ?? null;
  for (const step of model.steps) {
    map.setFeatureState(
      { source: ROUTE_LINE_SOURCE, id: step.fid },
      { tier: resolved?.get(step.stepIndex) ?? "focus" },
    );
  }
  syncChevrons(map, model, resolved);
  const activeKey = activeKeyByMap.get(map);
  if (activeKey !== undefined) applyChevronActive(map, activeKey);
}

/**
 * Writes the model and highlights `activeKey`. Call this from `style.load`
 * and from the effect that watches the model — either one alone leaves the
 * highlight unset after a style reload. `tiers` is omitted on admin maps.
 */
export function paintRouteLayers(
  map: MapLibreMap,
  model: RoutePaintModel,
  activeKey: string,
  beforeId?: string,
  tiers?: RouteTiers | null,
): void {
  // Do not consult `isStyleLoaded()` here. It is still false inside the
  // `style.load` handler, and bailing there is how the highlight gets lost.
  if (!map.getStyle()) return;
  ensureRouteLayers(map, beforeId);
  setRouteData(map, model);
  syncChevrons(map, model, tiers ?? null);
  applyRouteActive(map, model, activeKey);
  applyRouteProgress(map, model, tiers ?? null);
}

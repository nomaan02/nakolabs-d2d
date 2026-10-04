"use client";

import { useEffect, useRef } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { DoorLabels } from "@/lib/field/labels";
import { mapLabel } from "@/lib/field/labels";
import type { LocalOutcomes } from "@/lib/field/local-outcomes";
import { useMapView, type MapView } from "@/lib/field/map-view";
import { ATTRIBUTION_LINES, fieldMapStyle } from "@/lib/field/map-style";
import type { DoorCollection } from "@/lib/geo/todays-assignment";
import { mapColours, type MapMode } from "@/lib/map/map-palette";
import {
  applyRouteProgress,
  paintRouteLayers,
  ROUTE_LAYER_IDS,
  ROUTE_LINE_SOURCE,
  type RoutePaintModel,
} from "@/lib/map/route-layers";
import { formatTierCounts, type RouteTiers } from "@/lib/map/route-progress";

const BRISTOL: [number, number] = [-2.5879, 51.4545];
const DOORS_SOURCE = "field-doors";
const DOORS_LAYER = "field-doors";
const FOCUS_LAYER = "field-doors-focus";
const LABELS_LAYER = "field-door-labels";
/** Logger "Show on map" and a map tap both land here. Terrace dots need 19. */
const FOCUS_ZOOM = 19;
/** UI item 1, Session C (2026-09-29): the compact Logger mini map's own focus zoom (plan decision 7). */
const COMPACT_ZOOM = 17.5;

/** SEAM (Stage 5b). Registered now, fed by `route_geom` then. Renders nothing. */
const ROUTE_SOURCE = "field-route";
const ROUTE_LAYER = "route-line";

/** SEAM (Stage 16). Registered now, hidden. Becomes the live position marker. */
const POSITION_SOURCE = "field-position";
const POSITION_LAYER = "you-are-here";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const FOOTPRINTS_SOURCE = "field-footprints";
const FOOTPRINTS_FILL = "field-footprints-fill";
const FOOTPRINTS_LINE = "field-footprints-line";
const FOOTPRINTS_3D = "field-footprints-3d";
const BASEMAP_BUILDINGS_3D = "basemap-buildings-3d";
const LEADER_SOURCE = "field-door-leader";
const LEADER_LINE = "field-door-leader-line";
const LEADER_END = "field-door-leader-end";

type FieldColours = ReturnType<typeof mapColours>;

/** Outcome tint. `fallback` is transparent in 2D and the building fill in 3D. */
function footprintTint(tint: FieldColours["tint"], fallback: string): ExpressionSpecification {
  return [
    "match",
    ["coalesce", ["feature-state", "outcome"], "none"],
    "lead",
    tint.lead,
    "answered",
    tint.answered,
    "no_opportunity",
    tint.no_opportunity,
    "no_answer",
    tint.no_answer,
    "refused",
    tint.other,
    "do_not_call",
    tint.other,
    "inaccessible",
    tint.other,
    "callback",
    tint.other,
    fallback,
  ];
}

function buildingFillSource(instance: MapLibreMap): { source: string; sourceLayer: string } | null {
  const layers = instance.getStyle()?.layers;
  if (!layers) return null;
  for (const layer of layers) {
    if (layer.type !== "fill") continue;
    if (!("source-layer" in layer) || layer["source-layer"] !== "building") continue;
    if (typeof layer.source !== "string") continue;
    return { source: layer.source, sourceLayer: layer["source-layer"] };
  }
  return null;
}

function mountFootprints(
  instance: MapLibreMap,
  data: GeoJSON.FeatureCollection | null,
  view: MapView,
  beforeId: string,
  colours: FieldColours,
) {
  const showFlat = view === "2d" ? "visible" : "none";
  const show3d = view === "3d" ? "visible" : "none";
  const before = instance.getLayer(beforeId) ? beforeId : undefined;

  if (!instance.getSource(FOOTPRINTS_SOURCE)) {
    instance.addSource(FOOTPRINTS_SOURCE, {
      type: "geojson",
      data: data ?? EMPTY,
      promoteId: "fid",
    });
  }

  if (!instance.getLayer(BASEMAP_BUILDINGS_3D)) {
    const building = buildingFillSource(instance);
    if (building && instance.getSource(building.source)) {
      instance.addLayer(
        {
          id: BASEMAP_BUILDINGS_3D,
          type: "fill-extrusion",
          source: building.source,
          "source-layer": building.sourceLayer,
          minzoom: 15,
          layout: { visibility: show3d },
          paint: {
            "fill-extrusion-color": colours.palette.building,
            "fill-extrusion-opacity": 0.9,
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          },
        },
        before,
      );
    }
  }

  if (!instance.getLayer(FOOTPRINTS_FILL)) {
    instance.addLayer(
      {
        id: FOOTPRINTS_FILL,
        type: "fill",
        source: FOOTPRINTS_SOURCE,
        filter: ["!=", ["get", "shared"], true],
        layout: { visibility: showFlat },
        paint: {
          "fill-color": [
            "case",
            [
              "all",
              ["boolean", ["feature-state", "selected"], false],
              ["==", ["coalesce", ["feature-state", "outcome"], "none"], "none"],
            ],
            colours.focus.tint,
            footprintTint(colours.tint, "rgba(0,0,0,0)"),
          ],
        },
      },
      before,
    );
  }

  if (!instance.getLayer(FOOTPRINTS_LINE)) {
    instance.addLayer(
      {
        id: FOOTPRINTS_LINE,
        type: "line",
        source: FOOTPRINTS_SOURCE,
        layout: { visibility: showFlat },
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            colours.focus.line,
            colours.palette.buildingEdge,
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            2.5,
            1,
          ],
        },
      },
      before,
    );
  }

  if (!instance.getLayer(FOOTPRINTS_3D)) {
    instance.addLayer(
      {
        id: FOOTPRINTS_3D,
        type: "fill-extrusion",
        source: FOOTPRINTS_SOURCE,
        layout: { visibility: show3d },
        paint: {
          "fill-extrusion-color": [
            "case",
            [
              "all",
              ["boolean", ["feature-state", "selected"], false],
              ["==", ["coalesce", ["feature-state", "outcome"], "none"], "none"],
            ],
            colours.focus.tint,
            footprintTint(colours.tint, colours.palette.building),
          ],
          "fill-extrusion-height": [
            "+",
            ["get", "height_m"],
            ["case", ["boolean", ["feature-state", "selected"], false], 1.5, 0.5],
          ],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.95,
        },
      },
      before,
    );
  }

  if (!instance.getSource(LEADER_SOURCE)) {
    instance.addSource(LEADER_SOURCE, { type: "geojson", data: EMPTY });
  }
  if (!instance.getLayer(LEADER_LINE)) {
    instance.addLayer(
      {
        id: LEADER_LINE,
        type: "line",
        source: LEADER_SOURCE,
        layout: { "line-cap": "butt" },
        paint: {
          "line-color": colours.focus.line,
          "line-width": 1.5,
          "line-opacity": 0.9,
          "line-dasharray": [2, 1.5],
        },
      },
      before,
    );
  }
  if (!instance.getLayer(LEADER_END)) {
    instance.addLayer(
      {
        id: LEADER_END,
        type: "circle",
        source: LEADER_SOURCE,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 3,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": colours.focus.line,
          "circle-stroke-width": 1.5,
        },
      },
      before,
    );
  }
}

function applyMapView(instance: MapLibreMap, view: MapView, mapVariant: "full" | "compact") {
  const flat = view === "2d" ? "visible" : "none";
  const extruded = view === "3d" ? "visible" : "none";
  for (const id of [FOOTPRINTS_FILL, FOOTPRINTS_LINE]) {
    if (instance.getLayer(id)) instance.setLayoutProperty(id, "visibility", flat);
  }
  for (const id of [BASEMAP_BUILDINGS_3D, FOOTPRINTS_3D]) {
    if (instance.getLayer(id)) instance.setLayoutProperty(id, "visibility", extruded);
  }
  const pitch = view === "3d" ? (mapVariant === "compact" ? 50 : 55) : 0;
  instance.easeTo({ pitch, duration: 400 });
}

/**
 * Outcome styling, per invariant 2 as amended 2026-09-17.
 *
 * Colour applies to doors logged within the CURRENT ASSIGNMENT only. A
 * previous visit's outcome colour is never carried onto a new visit's map:
 * that is straightforward cherry-picking fuel. Nothing here is a score, a
 * rank or a rate.
 *
 * Colour is never the sole carrier. Each state also differs in radius and in
 * whether it has a pale core, so the five states stay distinguishable in
 * glare, in greyscale, and to a colour-blind canvasser:
 *
 * Colours 2026-10-01 (owner F2, Figma: Map style v1). Sizes the same day (F3).
 *
 *   unlogged        white,        base radius, no core
 *   no_answer       grey,         base radius, no core  (reads as spent)
 *   answered        blue,         base radius, core     (ringed)
 *   no_opportunity  amber,        SMALL radius, no core (a closed door)
 *   lead            green,        LARGE radius, core    (biggest thing on screen)
 *
 * Driven by `feature-state`, not baked into the source data — coverage is
 * derived, and the source is the frozen snapshot.
 */
/** The logged outcome for this door on this assignment, or "none". */
const OUTCOME_STATE: ExpressionSpecification = [
  "coalesce",
  ["feature-state", "outcome"],
  "none",
];

function fillByState(dot: FieldColours["dot"]): ExpressionSpecification {
  return [
    "match",
    OUTCOME_STATE,
    "no_answer",
    dot.no_answer,
    "answered",
    dot.answered,
    "lead",
    dot.lead,
    "no_opportunity",
    dot.no_opportunity,
    // refused, do_not_call, inaccessible, callback: worked, nothing more said.
    "refused",
    dot.other,
    "do_not_call",
    dot.other,
    "inaccessible",
    dot.other,
    "callback",
    dot.other,
    dot.open,
  ];
}

function strokeByState(dot: FieldColours["dot"], selected: string): ExpressionSpecification {
  return [
    "case",
    ["boolean", ["feature-state", "selected"], false],
    selected,
    ["case", ["==", OUTCOME_STATE, "none"], dot.openRing, dot.ring],
  ];
}

/**
 * MapLibre only allows `["zoom"]` as the input of a *top-level* interpolate
 * or step. Nesting that interpolate inside `*` or `case` throws at runtime
 * and the doors layer never paints.
 */
function radiusAt(base: number): ExpressionSpecification {
  return [
    "match",
    OUTCOME_STATE,
    "lead",
    base * 1.6,
    "no_opportunity",
    base * 0.65,
    "answered",
    base * 1.15,
    base,
  ];
}

const CIRCLE_RADIUS: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  14,
  radiusAt(3),
  17,
  radiusAt(5),
  19,
  radiusAt(8),
  20,
  radiusAt(10),
];

function coreAt(size: number): ExpressionSpecification {
  return [
    "case",
    ["in", OUTCOME_STATE, ["literal", ["answered", "lead"]]],
    size,
    0,
  ];
}

const CORE_RADIUS: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  14,
  coreAt(1),
  17,
  coreAt(2),
  19,
  coreAt(3),
  20,
  coreAt(4),
];

/** Dark halo around the focused door. Size, not hue, is the distinct mark. */
function focusHaloAt(size: number): ExpressionSpecification {
  return ["case", ["boolean", ["feature-state", "selected"], false], size, 0];
}

const FOCUS_HALO_RADIUS: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  14,
  focusHaloAt(7),
  17,
  focusHaloAt(11),
  19,
  focusHaloAt(16),
  20,
  focusHaloAt(20),
];

function fitDoors(map: MapLibreMap, doors: DoorCollection) {
  if (doors.features.length === 0) return;
  const lngs = doors.features.map((f) => f.geometry.coordinates[0]);
  const lats = doors.features.map((f) => f.geometry.coordinates[1]);
  map.fitBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: 48, maxZoom: 19, duration: 0 },
  );
}

function flyToDoor(
  map: MapLibreMap,
  doors: DoorCollection,
  uprn: number | null,
  mode: "jump" | "ease",
  zoom: number = FOCUS_ZOOM,
  durationMs: number = 400,
  bearing?: number,
): boolean {
  if (uprn === null) return false;
  const feature = doors.features.find((f) => f.properties.uprn === uprn);
  if (!feature) return false;
  const center = feature.geometry.coordinates as [number, number];
  const pitch = map.getPitch();
  if (mode === "jump") {
    map.jumpTo({ center, zoom, pitch, ...(bearing === undefined ? {} : { bearing }) });
  } else {
    map.easeTo({ center, zoom, pitch, ...(bearing === undefined ? {} : { bearing }), duration: durationMs });
  }
  return true;
}

/**
 * Doors plus their display label. The label rides on the source because a
 * symbol layer needs it there; it is still only ever a display string, never
 * an identifier, and `sub_building` is not in `v_door_label` to begin with.
 */
function withLabels(doors: DoorCollection, labels: DoorLabels): DoorCollection {
  if (labels.size === 0) return doors;
  return {
    type: "FeatureCollection",
    features: doors.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        label: mapLabel(labels.get(feature.properties.uprn)) ?? "",
      },
    })),
  };
}

function applyRoute(
  instance: MapLibreMap,
  model: RoutePaintModel,
  tiers: RouteTiers | null,
  mode: MapMode,
) {
  const source = instance.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
  source?.setData(EMPTY);
  const key = model.steps[0]?.variantKey || "route";
  paintRouteLayers(instance, model, key, FOCUS_LAYER, tiers, mode);
}

const FIELD_LAYER_ORDER = [
  ROUTE_LAYER,
  FOCUS_LAYER,
  DOORS_LAYER,
  `${DOORS_LAYER}-core`,
  LABELS_LAYER,
  POSITION_LAYER,
];

function recordLayerOrder(
  instance: MapLibreMap,
  container: HTMLElement,
  model: RoutePaintModel,
  tiers: RouteTiers | null,
) {
  const ids = new Set(instance.getStyle()?.layers?.map((layer) => layer.id) ?? []);
  container.dataset.layerOrder = FIELD_LAYER_ORDER.filter((id) => ids.has(id)).join(",");
  container.dataset.routeVertices = String(model.steps.length);
  container.dataset.routeCrossings = String(model.steps.filter((step) => step.kind === "cross").length);
  container.dataset.routeTiers = formatTierCounts(tiers, model.steps.length);
  const present = (instance.getStyle()?.layers ?? []).map((layer) => layer.id);
  container.dataset.routeLayers = ROUTE_LAYER_IDS.filter((id) => present.includes(id)).join(",");
}
/** Cheap equirectangular metres. Used only to hide a leader shorter than 1.5 m. */
function metresBetween(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const lat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const x = (bLng - aLng) * Math.cos(lat) * 111_320;
  const y = (bLat - aLat) * 110_540;
  return Math.hypot(x, y);
}

function leaderFor(doors: DoorCollection, uprn: number | null): GeoJSON.FeatureCollection {
  if (uprn === null) return EMPTY;
  const door = doors.features.find((feature) => feature.properties.uprn === uprn);
  if (!door) return EMPTY;
  const props = door.properties as { raw_lng?: unknown; raw_lat?: unknown };
  if (typeof props.raw_lng !== "number" || typeof props.raw_lat !== "number") return EMPTY;
  const dotLng = door.geometry.coordinates[0];
  const dotLat = door.geometry.coordinates[1];
  if (dotLng === undefined || dotLat === undefined) return EMPTY;
  if (metresBetween(dotLng, dotLat, props.raw_lng, props.raw_lat) < 1.5) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [dotLng, dotLat],
            [props.raw_lng, props.raw_lat],
          ],
        },
      },
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [props.raw_lng, props.raw_lat] },
      },
    ],
  };
}

function paintOutcomeSource(
  instance: MapLibreMap,
  source: string,
  outcomes: LocalOutcomes,
  selectedUprn: number | null,
) {
  if (!instance.getSource(source)) return;
  instance.removeFeatureState({ source });
  for (const [uprn, entry] of outcomes) {
    instance.setFeatureState({ source, id: uprn }, { outcome: entry.outcome });
  }
  if (selectedUprn !== null) {
    instance.setFeatureState({ source, id: selectedUprn }, { selected: true });
  }
}

function applyOutcomeState(
  instance: MapLibreMap,
  outcomes: LocalOutcomes,
  selectedUprn: number | null,
) {
  paintOutcomeSource(instance, DOORS_SOURCE, outcomes, selectedUprn);
  paintOutcomeSource(instance, FOOTPRINTS_SOURCE, outcomes, selectedUprn);
}

export function FieldMap({
  doors,
  labels,
  outcomes,
  routeModel,
  routeTiers,
  footprints = null,
  selectedUprn,
  cameraNonce,
  onSelectUprn,
  active,
  variant = "full",
  mode = "light",
  onUserMove,
  recenterNonce = 0,
}: {
  doors: DoorCollection;
  labels: DoorLabels;
  outcomes: LocalOutcomes;
  routeModel: RoutePaintModel;
  routeTiers: RouteTiers | null;
  footprints?: GeoJSON.FeatureCollection | null;
  selectedUprn: number | null;
  cameraNonce: number;
  onSelectUprn: (uprn: number) => void;
  active: boolean;
  /**
   * UI item 1, Session C (2026-09-29, owner decision 7): "compact" is the
   * Logger's own mini map — no Navigation/Scale control, and marks that
   * door with a prop-blue halo on the SAME `selected` feature-state the
   * full map already uses for a tapped door. Still one MapLibre instance at
   * a time: the Map tab and the Logger are separate routes, and this
   * component `remove()`s on unmount either way (see `lib/field/map-style.ts`).
   * 2026-09-30 owner E6, amended 2026-10-04 UI-6 B1: pan, pinch and rotate allowed, no pitch gesture; re-centres on every door change.
   */
  variant?: "full" | "compact";
  /** Read once. A theme change remounts this map via `key={mode}`. */
  mode?: MapMode;
  /**
   * UI-6 B1 (compact only). Called with true when the canvasser moves the
   * camera themselves (pan, pinch, rotate), and false when the map is
   * re-centred (door change or the recentre button).
   */
  onUserMove?: (moved: boolean) => void;
  /** UI-6 B1 (compact only). Bump to re-centre on the current door, north-up. */
  recenterNonce?: number;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const onSelect = useRef(onSelectUprn);
  const onUserMoveRef = useRef(onUserMove);
  const doorsRef = useRef(doors);
  const labelsRef = useRef(labels);
  const outcomesRef = useRef(outcomes);
  const selectedRef = useRef(selectedUprn);
  const routeRef = useRef(routeModel);
  const tiersRef = useRef(routeTiers);
  const footprintsRef = useRef(footprints);
  const mapView = useMapView();
  const mapViewRef = useRef(mapView);
  // Read-once: `variant` never changes for a mounted instance (a route
  // never toggles compact/full), but the mount effect below intentionally
  // has an empty dependency array, so it is captured the same way every
  // other prop that effect reads is — via a ref, not a render-time closure.
  const variantRef = useRef(variant);
  const modeRef = useRef(mode);
  onSelect.current = onSelectUprn;
  onUserMoveRef.current = onUserMove;
  doorsRef.current = doors;
  labelsRef.current = labels;
  outcomesRef.current = outcomes;
  selectedRef.current = selectedUprn;
  routeRef.current = routeModel;
  tiersRef.current = routeTiers;
  footprintsRef.current = footprints;
  mapViewRef.current = mapView;

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;
    const mapVariant = variantRef.current;
    const mapMode = modeRef.current;
    const c = mapColours(mapMode);
    const openingPitch =
      mapViewRef.current === "3d" ? (mapVariant === "compact" ? 50 : 55) : 0;

    void (async () => {
      const style = await fieldMapStyle(mapMode);
      if (cancelled || !container.current) return;

      const instance = new MapLibreMap({
        container: container.current,
        style,
        center: BRISTOL,
        zoom: 12.4,
        pitch: openingPitch,
        interactive: true,
        attributionControl: { compact: true, customAttribution: [...ATTRIBUTION_LINES] },
      });
      map.current = instance;

      // Compact only (2026-09-30 owner E6, 2026-10-01 F6; amended 2026-10-04 UI-6 B1, owner P2.2): pan, pinch and two-finger rotate are on. Pitch is not a gesture — 3D sets it in code. Keyboard off. No Navigation or Scale control (owner decision 7). Attribution is unchanged.
      if (mapVariant === "compact") {
        instance.touchPitch.disable();
        instance.keyboard.disable();
      }
      // UI-6 B1. Only a real gesture carries an originalEvent; code-driven
      // eases (door change, recentre) do not, so they never show the button.
      if (mapVariant === "compact") {
        instance.on("movestart", (event) => {
          if ((event as { originalEvent?: unknown }).originalEvent) onUserMoveRef.current?.(true);
        });
      }
      if (mapVariant === "full") {
        instance.addControl(new NavigationControl({ showCompass: false }), "bottom-left");
        instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
      }

      instance.on("load", () => {
        const attrib = instance.getContainer().querySelector(".maplibregl-ctrl-attrib");
        if (attrib instanceof HTMLDetailsElement) attrib.open = false;
        attrib?.classList.remove("maplibregl-compact-show");

        const current = withLabels(doorsRef.current, labelsRef.current);

        // promoteId makes the UPRN the feature id, which is what
        // setFeatureState addresses. Without it, outcome styling silently
        // does nothing.
        instance.addSource(DOORS_SOURCE, {
          type: "geojson",
          data: current,
          promoteId: "uprn",
        });

        // The route line is added BEFORE the door circles, so it paints
        // underneath them. Clicks are bound to the circle layer; the line
        // does not take the tap.
        instance.addSource(ROUTE_SOURCE, { type: "geojson", data: EMPTY });
        instance.addLayer({
          id: ROUTE_LAYER,
          type: "line",
          source: ROUTE_SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": c.ui.placeholderLine, "line-width": 4, "line-opacity": 0.85 },
        });
        mountFootprints(instance, footprintsRef.current, mapViewRef.current, ROUTE_LAYER, c);

        // Focus halo sits under the dots so a selected door reads as a ring,
        // not a colour change. Unselected radius is 0 — cheap at 2,000 points.
        // Compact (the Logger's mini map) marks the CURRENT door with a
        // prop-blue halo on this same `selected` state (owner decision 7);
        // full (the Map tab) keeps the dark halo for a tapped door's panel.
        instance.addLayer({
          id: FOCUS_LAYER,
          type: "circle",
          source: DOORS_SOURCE,
          paint: {
            "circle-radius": FOCUS_HALO_RADIUS,
            "circle-color": mapVariant === "compact" ? c.ui.position : c.ui.halo,
            "circle-opacity": 0.9,
          },
        });

        instance.addLayer({
          id: DOORS_LAYER,
          type: "circle",
          source: DOORS_SOURCE,
          paint: {
            "circle-radius": CIRCLE_RADIUS,
            "circle-color": fillByState(c.dot),
            "circle-stroke-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              4,
              1.5,
            ],
            "circle-stroke-color": strokeByState(c.dot, c.ui.halo),
          },
        });

        // The pale core that separates "answered" and "lead" from the rest
        // without relying on hue.
        instance.addLayer({
          id: `${DOORS_LAYER}-core`,
          type: "circle",
          source: DOORS_SOURCE,
          paint: {
            "circle-radius": CORE_RADIUS,
            "circle-color": c.ui.core,
          },
        });

        // Address labels: a SEPARATE symbol layer above the circles, minzoom
        // 18. Text at every zoom would put symbol collision detection across
        // 2,000 points and break the Stage 14 performance target. If the
        // Dexie addresses store is empty the label property is absent and
        // this layer draws nothing — the circles are unaffected.
        instance.addLayer({
          id: LABELS_LAYER,
          type: "symbol",
          source: DOORS_SOURCE,
          minzoom: 18,
          filter: ["all", ["has", "label"], ["!=", ["get", "label"], ""]],
          layout: {
            "text-field": ["get", "label"],
            "text-size": 12,
            "text-offset": [0, 1.4],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-optional": true,
          },
          paint: {
            "text-color": c.ui.labelText,
            "text-halo-color": c.ui.labelHalo,
            "text-halo-width": 1.6,
          },
        });

        // SEAM (Stage 16): the canvasser's own position. Registered and
        // hidden. Nothing writes to it this stage and nothing may, because
        // there is no geolocation call in this repo yet.
        instance.addSource(POSITION_SOURCE, { type: "geojson", data: EMPTY });
        instance.addLayer({
          id: POSITION_LAYER,
          type: "circle",
          source: POSITION_SOURCE,
          layout: { visibility: "none" },
          paint: {
            "circle-radius": 8,
            "circle-color": c.ui.position,
            "circle-stroke-width": 3,
            "circle-stroke-color": c.ui.positionRing,
          },
        });

        // Outcomes and the focused door often arrive before the style is
        // ready. The effect below bails in that case; paint them here so a
        // remount still colours, and jump to a focused door instead of
        // fitting the whole prop — "Show on map" asked for this door.
        applyOutcomeState(instance, outcomesRef.current, selectedRef.current);
        (instance.getSource(LEADER_SOURCE) as GeoJSONSource | undefined)?.setData(
          leaderFor(doorsRef.current, selectedRef.current),
        );
        applyRoute(instance, routeRef.current, tiersRef.current, mapMode);
        if (container.current) recordLayerOrder(instance, container.current, routeRef.current, tiersRef.current);
        instance.on("style.load", () => {
          const anchor = instance.getLayer(ROUTE_LAYER)
            ? ROUTE_LAYER
            : instance.getLayer("route-walk-other")
              ? "route-walk-other"
              : FOCUS_LAYER;
          if (!instance.getSource(FOOTPRINTS_SOURCE) && instance.getLayer(anchor)) {
            mountFootprints(instance, footprintsRef.current, mapViewRef.current, anchor, c);
          }
          applyOutcomeState(instance, outcomesRef.current, selectedRef.current);
          (instance.getSource(LEADER_SOURCE) as GeoJSONSource | undefined)?.setData(
            leaderFor(doorsRef.current, selectedRef.current),
          );
          applyMapView(instance, mapViewRef.current, mapVariant);
          applyRoute(instance, routeRef.current, tiersRef.current, mapMode);
          if (container.current) recordLayerOrder(instance, container.current, routeRef.current, tiersRef.current);
        });
        const initialZoom = mapVariant === "compact" ? COMPACT_ZOOM : FOCUS_ZOOM;
        if (flyToDoor(instance, current, selectedRef.current, "jump", initialZoom)) {
          if (mapVariant === "compact" && container.current) {
            const node = container.current;
            node.dataset.cameraJumps = String((Number(node.dataset.cameraJumps) || 0) + 1);
          }
        } else {
          fitDoors(instance, current);
        }
        applyMapView(instance, mapViewRef.current, mapVariant);

        instance.on("click", DOORS_LAYER, (event) => {
          const feature = event.features?.[0];
          const uprn = feature?.properties?.uprn;
          if (typeof uprn === "number") onSelect.current(uprn);
          else if (typeof uprn === "string" && uprn !== "") onSelect.current(Number(uprn));
        });
        instance.on("mouseenter", DOORS_LAYER, () => {
          instance.getCanvas().style.cursor = "pointer";
        });
        instance.on("mouseleave", DOORS_LAYER, () => {
          instance.getCanvas().style.cursor = "";
        });
      });
    })();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    // 2026-10-02 G1: gate on the source, not isStyleLoaded(). setData makes
    // isStyleLoaded() false while it re-tiles, which skipped outcome updates.
    if (!instance) return;
    const source = instance.getSource(DOORS_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(withLabels(doors, labels));
    applyOutcomeState(instance, outcomes, selectedUprn);
    (instance.getSource(LEADER_SOURCE) as GeoJSONSource | undefined)?.setData(
      leaderFor(doors, selectedUprn),
    );
  }, [doors, labels, outcomes, selectedUprn]);

  useEffect(() => {
    const instance = map.current;
    const node = container.current;
    if (!instance?.getStyle() || !instance.getSource(ROUTE_SOURCE) || !node) return;
    applyRoute(instance, routeModel, tiersRef.current, modeRef.current);
    recordLayerOrder(instance, node, routeModel, tiersRef.current);
  }, [routeModel]);

  // Tiers move as the next door moves. This must not setData on the line
  // source: only the chevron runs are rebuilt, inside applyRouteProgress.
  // Bail until the line source exists, so an early run does not publish an
  // empty layer list over the one style.load writes.
  useEffect(() => {
    const instance = map.current;
    const node = container.current;
    if (!instance?.getStyle() || !node || !instance.getSource(ROUTE_LINE_SOURCE)) return;
    applyRouteProgress(instance, routeRef.current, routeTiers, modeRef.current);
    recordLayerOrder(instance, node, routeRef.current, routeTiers);
  }, [routeTiers]);

  // Outcome colour, current assignment only, applied as feature state.
  useEffect(() => {
    const instance = map.current;
    if (!instance?.getSource(FOOTPRINTS_SOURCE)) return;
    (instance.getSource(FOOTPRINTS_SOURCE) as GeoJSONSource).setData(footprints ?? EMPTY);
    applyOutcomeState(instance, outcomesRef.current, selectedRef.current);
  }, [footprints]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!instance.getLayer(FOOTPRINTS_FILL) && !instance.getLayer(FOOTPRINTS_3D)) return;
    applyMapView(instance, mapView, variant);
  }, [mapView, variant]);

  useEffect(() => {
    const instance = map.current;
    // 2026-10-02 G1: gate on the source, not isStyleLoaded(). setData makes
    // isStyleLoaded() false while it re-tiles, which skipped outcome updates.
    if (!instance) return;
    if (!instance.getSource(DOORS_SOURCE) && !instance.getSource(FOOTPRINTS_SOURCE)) return;
    applyOutcomeState(instance, outcomes, selectedUprn);
    (instance.getSource(LEADER_SOURCE) as GeoJSONSource | undefined)?.setData(
      leaderFor(doorsRef.current, selectedUprn),
    );
  }, [outcomes, selectedUprn]);

  useEffect(() => {
    if (active) map.current?.resize();
  }, [active]);

  // The full map eases to a tapped door (a deliberate camera move on top of
  // whatever the canvasser was looking at), 400 ms. The compact mini map
  // eases too, 300 ms, once per cursor settle, at COMPACT_ZOOM. The move is
  // still counted in `dataset.cameraJumps` for the 2,000-door evidence
  // (amendment 6).
  useEffect(() => {
    const instance = map.current;
    const node = container.current;
    // 2026-09-30: camera moves do not need the style. The old
    // `isStyleLoaded()` guard skipped the move whenever a source was
    // updating, e.g. right after a log.
    if (!instance || selectedUprn === null) return;
    if (variant === "compact") {
      const moved = flyToDoor(instance, doors, selectedUprn, "ease", COMPACT_ZOOM, 300);
      onUserMoveRef.current?.(false);
      if (moved && node) {
        node.dataset.cameraJumps = String((Number(node.dataset.cameraJumps) || 0) + 1);
      }
      return;
    }
    flyToDoor(instance, doors, selectedUprn, "ease", FOCUS_ZOOM);
  }, [selectedUprn, doors, cameraNonce, variant]);

  // UI-6 B1. Recentre button: back to the current door, north-up.
  useEffect(() => {
    const instance = map.current;
    if (!instance || variant !== "compact" || recenterNonce === 0) return;
    if (flyToDoor(instance, doors, selectedUprn, "ease", COMPACT_ZOOM, 300, 0)) {
      onUserMoveRef.current?.(false);
    }
    // Only the nonce triggers this; door changes have their own effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterNonce]);

  return <div ref={container} className="h-full w-full" data-testid="field-map" />;
}

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
import { ATTRIBUTION_LINES, fieldMapStyle } from "@/lib/field/map-style";
import type { DoorCollection } from "@/lib/geo/todays-assignment";
import { OUTCOME_DOT } from "@/lib/map/map-palette";
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
const UNLOGGED = OUTCOME_DOT.open;

/** The logged outcome for this door on this assignment, or "none". */
const OUTCOME_STATE: ExpressionSpecification = [
  "coalesce",
  ["feature-state", "outcome"],
  "none",
];

const FILL_BY_STATE: ExpressionSpecification = [
  "match",
  OUTCOME_STATE,
  "no_answer",
  OUTCOME_DOT.no_answer,
  "answered",
  OUTCOME_DOT.answered,
  "lead",
  OUTCOME_DOT.lead,
  "no_opportunity",
  OUTCOME_DOT.no_opportunity,
  // refused, do_not_call, inaccessible, callback: worked, nothing more said.
  "refused",
  OUTCOME_DOT.other,
  "do_not_call",
  OUTCOME_DOT.other,
  "inaccessible",
  OUTCOME_DOT.other,
  "callback",
  OUTCOME_DOT.other,
  UNLOGGED,
];

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
): boolean {
  if (uprn === null) return false;
  const feature = doors.features.find((f) => f.properties.uprn === uprn);
  if (!feature) return false;
  const center = feature.geometry.coordinates as [number, number];
  if (mode === "jump") {
    map.jumpTo({ center, zoom });
  } else {
    map.easeTo({ center, zoom, duration: durationMs });
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

function applyRoute(instance: MapLibreMap, model: RoutePaintModel, tiers: RouteTiers | null) {
  const source = instance.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
  source?.setData(EMPTY);
  const key = model.steps[0]?.variantKey || "route";
  paintRouteLayers(instance, model, key, FOCUS_LAYER, tiers);
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
function applyOutcomeState(
  instance: MapLibreMap,
  outcomes: LocalOutcomes,
  selectedUprn: number | null,
) {
  if (!instance.getSource(DOORS_SOURCE)) return;
  instance.removeFeatureState({ source: DOORS_SOURCE });
  for (const [uprn, entry] of outcomes) {
    instance.setFeatureState({ source: DOORS_SOURCE, id: uprn }, { outcome: entry.outcome });
  }
  if (selectedUprn !== null) {
    instance.setFeatureState({ source: DOORS_SOURCE, id: selectedUprn }, { selected: true });
  }
}

export function FieldMap({
  doors,
  labels,
  outcomes,
  routeModel,
  routeTiers,
  selectedUprn,
  cameraNonce,
  onSelectUprn,
  active,
  variant = "full",
}: {
  doors: DoorCollection;
  labels: DoorLabels;
  outcomes: LocalOutcomes;
  routeModel: RoutePaintModel;
  routeTiers: RouteTiers | null;
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
   * 2026-09-30 owner E6: pan and pinch allowed, no rotate or pitch; re-centres on every door change.
   */
  variant?: "full" | "compact";
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const onSelect = useRef(onSelectUprn);
  const doorsRef = useRef(doors);
  const labelsRef = useRef(labels);
  const outcomesRef = useRef(outcomes);
  const selectedRef = useRef(selectedUprn);
  const routeRef = useRef(routeModel);
  const tiersRef = useRef(routeTiers);
  // Read-once: `variant` never changes for a mounted instance (a route
  // never toggles compact/full), but the mount effect below intentionally
  // has an empty dependency array, so it is captured the same way every
  // other prop that effect reads is — via a ref, not a render-time closure.
  const variantRef = useRef(variant);
  onSelect.current = onSelectUprn;
  doorsRef.current = doors;
  labelsRef.current = labels;
  outcomesRef.current = outcomes;
  selectedRef.current = selectedUprn;
  routeRef.current = routeModel;
  tiersRef.current = routeTiers;

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;
    const mapVariant = variantRef.current;

    void (async () => {
      const style = await fieldMapStyle();
      if (cancelled || !container.current) return;

      const instance = new MapLibreMap({
        container: container.current,
        style,
        center: BRISTOL,
        zoom: 12.4,
        interactive: true,
        attributionControl: { compact: true, customAttribution: [...ATTRIBUTION_LINES] },
      });
      map.current = instance;

      // Compact only (2026-09-30 owner E6): pan and pinch stay on.
      // Rotate, pitch and keyboard do not. No Navigation or Scale control
      // (owner decision 7). Attribution is unchanged.
      if (mapVariant === "compact") {
        instance.dragRotate.disable();
        instance.touchPitch.disable();
        instance.touchZoomRotate.disableRotation();
        instance.keyboard.disable();
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
          paint: { "line-color": "#1c2226", "line-width": 4, "line-opacity": 0.85 },
        });

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
            "circle-color": mapVariant === "compact" ? "#1b4aa6" : "#1c2226",
            "circle-opacity": 0.9,
          },
        });

        instance.addLayer({
          id: DOORS_LAYER,
          type: "circle",
          source: DOORS_SOURCE,
          paint: {
            "circle-radius": CIRCLE_RADIUS,
            "circle-color": FILL_BY_STATE,
            "circle-stroke-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              4,
              1.5,
            ],
            "circle-stroke-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              "#1c2226",
              ["case", ["==", OUTCOME_STATE, "none"], OUTCOME_DOT.openRing, OUTCOME_DOT.ring],
            ],
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
            "circle-color": "#fbfaf8",
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
            "text-color": "#1c2226",
            "text-halo-color": "#fbfaf8",
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
            "circle-color": "#1b4aa6",
            "circle-stroke-width": 3,
            "circle-stroke-color": "#fbfaf8",
          },
        });

        // Outcomes and the focused door often arrive before the style is
        // ready. The effect below bails in that case; paint them here so a
        // remount still colours, and jump to a focused door instead of
        // fitting the whole prop — "Show on map" asked for this door.
        applyOutcomeState(instance, outcomesRef.current, selectedRef.current);
        applyRoute(instance, routeRef.current, tiersRef.current);
        if (container.current) recordLayerOrder(instance, container.current, routeRef.current, tiersRef.current);
        instance.on("style.load", () => {
          applyRoute(instance, routeRef.current, tiersRef.current);
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
    if (!instance?.isStyleLoaded()) return;
    const source = instance.getSource(DOORS_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(withLabels(doors, labels));
    applyOutcomeState(instance, outcomes, selectedUprn);
  }, [doors, labels, outcomes, selectedUprn]);

  useEffect(() => {
    const instance = map.current;
    const node = container.current;
    if (!instance?.getStyle() || !instance.getSource(ROUTE_SOURCE) || !node) return;
    applyRoute(instance, routeModel, tiersRef.current);
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
    applyRouteProgress(instance, routeRef.current, routeTiers);
    recordLayerOrder(instance, node, routeRef.current, routeTiers);
  }, [routeTiers]);

  // Outcome colour, current assignment only, applied as feature state.
  useEffect(() => {
    const instance = map.current;
    if (!instance?.isStyleLoaded() || !instance.getSource(DOORS_SOURCE)) return;
    applyOutcomeState(instance, outcomes, selectedUprn);
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
      if (moved && node) {
        node.dataset.cameraJumps = String((Number(node.dataset.cameraJumps) || 0) + 1);
      }
      return;
    }
    flyToDoor(instance, doors, selectedUprn, "ease", FOCUS_ZOOM);
  }, [selectedUprn, doors, cameraNonce, variant]);

  return <div ref={container} className="h-full w-full" data-testid="field-map" />;
}

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
import { paintRouteLayers, type RoutePaintModel } from "@/lib/map/route-layers";

const BRISTOL: [number, number] = [-2.5879, 51.4545];
const DOORS_SOURCE = "field-doors";
const DOORS_LAYER = "field-doors";
const FOCUS_LAYER = "field-doors-focus";
const LABELS_LAYER = "field-door-labels";
/** Logger "Show on map" and a map tap both land here. Terrace dots need 19. */
const FOCUS_ZOOM = 19;

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
 *   unlogged        dark neutral, base radius, no core
 *   no_answer       pale neutral, base radius, no core  (reads as spent)
 *   answered        blue,         base radius, core     (ringed)
 *   no_opportunity  red,          SMALL radius, no core (a closed door)
 *   lead            green,        LARGE radius, core    (biggest thing on screen)
 *
 * Driven by `feature-state`, not baked into the source data — coverage is
 * derived, and the source is the frozen snapshot.
 */
const UNLOGGED = "#4a5259";

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
  "#d2d6c9",
  "answered",
  "#1b4aa6",
  "lead",
  "#1e6b3a",
  "no_opportunity",
  "#7a2b33",
  // refused, do_not_call, inaccessible, callback: worked, nothing more said.
  "refused",
  UNLOGGED,
  "do_not_call",
  UNLOGGED,
  "inaccessible",
  UNLOGGED,
  "callback",
  UNLOGGED,
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
  radiusAt(5),
  17,
  radiusAt(10),
  19,
  radiusAt(16),
  20,
  radiusAt(20),
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
  coreAt(2),
  17,
  coreAt(4),
  19,
  coreAt(6),
  20,
  coreAt(8),
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
  focusHaloAt(10),
  17,
  focusHaloAt(18),
  19,
  focusHaloAt(26),
  20,
  focusHaloAt(32),
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
): boolean {
  if (uprn === null) return false;
  const feature = doors.features.find((f) => f.properties.uprn === uprn);
  if (!feature) return false;
  const center = feature.geometry.coordinates as [number, number];
  if (mode === "jump") {
    map.jumpTo({ center, zoom: FOCUS_ZOOM });
  } else {
    map.easeTo({ center, zoom: FOCUS_ZOOM, duration: 400 });
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

function applyRoute(instance: MapLibreMap, model: RoutePaintModel) {
  const source = instance.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
  source?.setData(EMPTY);
  const key = model.steps[0]?.variantKey || "route";
  paintRouteLayers(instance, model, key, FOCUS_LAYER);
}

const FIELD_LAYER_ORDER = [
  ROUTE_LAYER,
  FOCUS_LAYER,
  DOORS_LAYER,
  `${DOORS_LAYER}-core`,
  LABELS_LAYER,
  POSITION_LAYER,
];

function recordLayerOrder(instance: MapLibreMap, container: HTMLElement, model: RoutePaintModel) {
  const ids = new Set(instance.getStyle()?.layers?.map((layer) => layer.id) ?? []);
  container.dataset.layerOrder = FIELD_LAYER_ORDER.filter((id) => ids.has(id)).join(",");
  container.dataset.routeVertices = String(model.steps.length);
  container.dataset.routeCrossings = String(model.points.filter((point) => point.role === "cross").length);
  const present = (instance.getStyle()?.layers ?? []).map((layer) => layer.id);
  container.dataset.routeLayers = [
    "route-walk-work",
    "route-walk-other",
    "route-walk-chevrons",
    "route-walk-cross",
    "route-walk-start",
    "route-walk-end",
  ]
    .filter((id) => present.includes(id))
    .join(",");
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
  selectedUprn,
  cameraNonce,
  onSelectUprn,
  active,
}: {
  doors: DoorCollection;
  labels: DoorLabels;
  outcomes: LocalOutcomes;
  routeModel: RoutePaintModel;
  selectedUprn: number | null;
  cameraNonce: number;
  onSelectUprn: (uprn: number) => void;
  active: boolean;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const onSelect = useRef(onSelectUprn);
  const doorsRef = useRef(doors);
  const labelsRef = useRef(labels);
  const outcomesRef = useRef(outcomes);
  const selectedRef = useRef(selectedUprn);
  const routeRef = useRef(routeModel);
  onSelect.current = onSelectUprn;
  doorsRef.current = doors;
  labelsRef.current = labels;
  outcomesRef.current = outcomes;
  selectedRef.current = selectedUprn;
  routeRef.current = routeModel;

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;

    void (async () => {
      const style = await fieldMapStyle();
      if (cancelled || !container.current) return;

      const instance = new MapLibreMap({
        container: container.current,
        style,
        center: BRISTOL,
        zoom: 12.4,
        attributionControl: { compact: true, customAttribution: [...ATTRIBUTION_LINES] },
      });
      map.current = instance;

      instance.addControl(new NavigationControl({ showCompass: false }), "bottom-left");
      instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

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
        instance.addLayer({
          id: FOCUS_LAYER,
          type: "circle",
          source: DOORS_SOURCE,
          paint: {
            "circle-radius": FOCUS_HALO_RADIUS,
            "circle-color": "#1c2226",
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
              "#fbfaf8",
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
        applyRoute(instance, routeRef.current);
        if (container.current) recordLayerOrder(instance, container.current, routeRef.current);
        instance.on("style.load", () => {
          applyRoute(instance, routeRef.current);
          if (container.current) recordLayerOrder(instance, container.current, routeRef.current);
        });
        if (!flyToDoor(instance, current, selectedRef.current, "jump")) {
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
    applyRoute(instance, routeModel);
    recordLayerOrder(instance, node, routeModel);
  }, [routeModel]);

  // Outcome colour, current assignment only, applied as feature state.
  useEffect(() => {
    const instance = map.current;
    if (!instance?.isStyleLoaded() || !instance.getSource(DOORS_SOURCE)) return;
    applyOutcomeState(instance, outcomes, selectedUprn);
  }, [outcomes, selectedUprn]);

  useEffect(() => {
    if (active) map.current?.resize();
  }, [active]);

  useEffect(() => {
    const instance = map.current;
    if (!instance?.isStyleLoaded() || selectedUprn === null) return;
    flyToDoor(instance, doors, selectedUprn, "ease");
  }, [selectedUprn, doors, cameraNonce]);

  return <div ref={container} className="h-full w-full" data-testid="field-map" />;
}
